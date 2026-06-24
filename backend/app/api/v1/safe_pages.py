"""Safe Pages — generator, uniqueizer, and data tools."""
import io
import os
import uuid
import json as _json
import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
import httpx

from app.database import get_db
from app.models import SafePage, CodePreset, User, Domain, CloakerCampaign
from app.core.deps import get_current_active_user
from app.core.config import settings as app_settings
from app.services.safe_page_generator import (
    build_safe_page_zip, THEMES, LANGUAGES,
)
from app.services import traffic_armor_service as ta
from app.services.uniqueizer import uniqueize_image, uniqueize_video
from app.services.data_generator import (
    generate_address, generate_phone, SUPPORTED_COUNTRIES,
)
from app.services.ftp_deploy_service import FTPDeployService
from app.core.encryption import decrypt_value

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────

class SafePageCreate(BaseModel):
    generator_type: str = "blog"
    template_category: Optional[str] = None  # e.g. "akemi_detox_tea"
    template_id: Optional[str] = None  # e.g. "lulutox_fb_rip"
    theme: Optional[str] = "lifestyle"
    language: Optional[str] = "en"
    keywords: Optional[str] = None
    domain_name: Optional[str] = None
    domain_id: Optional[str] = None  # Link to Domain for auto-deploy
    num_pages: Optional[int] = 1
    page_title: Optional[str] = None
    redirect_link: Optional[str] = None  # CTA link — all links on brand templates point here
    button_redirect: Optional[bool] = False
    form_redirect: Optional[bool] = False
    index_filename: Optional[str] = "index.html"
    company_name: Optional[str] = None
    tos_domain: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    pixel_code: Optional[str] = None
    head_code: Optional[str] = None
    body_start_code: Optional[str] = None
    body_end_code: Optional[str] = None
    link_name: Optional[str] = None  # Name for /links/{name}/ path on hosting deploy
    auto_deploy: Optional[bool] = True  # Auto-deploy to domain CF Worker when domain_id is set
    # Traffic Armor — just adds script tag, no automatic campaign creation
    ta_campaign_id: Optional[str] = None  # If set, adds TA script to the page


class SafePageUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class CodePresetCreate(BaseModel):
    name: str
    slot: str
    code: str


class CodePresetUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None


# ── Helpers ──────────────────────────────────────────

def _serialize_page(p: SafePage, db: Session = None) -> dict:
    domain_name_resolved = p.domain_name
    if not domain_name_resolved and p.domain_id and db:
        d = db.query(Domain).filter(Domain.id == p.domain_id).first()
        if d:
            domain_name_resolved = d.name
    # Look up linked TA campaign
    ta_info = None
    if db and p.id:
        cloaker = db.query(CloakerCampaign).filter(CloakerCampaign.safe_page_id == p.id).first()
        if cloaker:
            ta_info = {
                "ta_campaign_id": cloaker.ta_campaign_id,
                "ta_campaign_number": cloaker.ta_campaign_number,
                "money_page_url": cloaker.money_page_url,
                "delivery_method": cloaker.delivery_method,
                "status": cloaker.status,
                "live_url": f"https://{domain_name_resolved}/links/{cloaker.ta_campaign_id}" if domain_name_resolved and cloaker.ta_campaign_id else None,
            }

    return {
        "id": p.id,
        "name": p.name,
        "generator_type": p.generator_type,
        "theme": p.theme,
        "language": p.language,
        "keywords": p.keywords,
        "domain_name": domain_name_resolved,
        "domain_id": p.domain_id,
        "num_pages": p.num_pages,
        "page_title": p.page_title,
        "redirect_link": p.redirect_link,
        "button_redirect": p.button_redirect,
        "form_redirect": p.form_redirect,
        "index_filename": p.index_filename,
        "company_name": p.company_name,
        "tos_domain": p.tos_domain,
        "phone_number": p.phone_number,
        "email": p.email,
        "pixel_code": p.pixel_code,
        "head_code": p.head_code,
        "body_start_code": p.body_start_code,
        "body_end_code": p.body_end_code,
        "status": p.status,
        "deployed": p.deployed if hasattr(p, 'deployed') else False,
        "preview_html": p.preview_html,
        "zip_url": p.zip_url,
        "error_message": p.error_message,
        "ta_campaign": ta_info,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _serialize_preset(p: CodePreset) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "slot": p.slot,
        "code": p.code,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


# ── Reference data endpoints ────────────────────────

@router.get("/themes")
def list_themes(current_user: User = Depends(get_current_active_user)):
    """Return available themes."""
    return [{"value": k, "label": k.title(), "topics": v} for k, v in THEMES.items()]


@router.get("/languages")
def list_languages(current_user: User = Depends(get_current_active_user)):
    """Return available languages."""
    return [{"value": k, "label": v} for k, v in LANGUAGES.items()]


@router.get("/brand-templates")
def list_brand_templates_endpoint(current_user: User = Depends(get_current_active_user)):
    """Return available brand lander templates."""
    from app.templates import list_brand_templates
    return list_brand_templates()


# ── Safe Page CRUD ───────────────────────────────────

@router.get("/")
def list_safe_pages(
    search: Optional[str] = None,
    status: Optional[str] = None,
    theme: Optional[str] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(SafePage).order_by(SafePage.created_at.desc())
    if search:
        query = query.filter(
            (SafePage.name.ilike(f"%{search}%"))
            | (SafePage.keywords.ilike(f"%{search}%"))
            | (SafePage.domain_name.ilike(f"%{search}%"))
        )
    if status:
        query = query.filter(SafePage.status == status)
    if theme:
        query = query.filter(SafePage.theme == theme)
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    return {"total": total, "items": [_serialize_page(p, db) for p in items]}


@router.get("/{page_id}")
def get_safe_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    p = db.query(SafePage).filter(SafePage.id == page_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Safe page not found")
    return _serialize_page(p, db)


@router.delete("/{page_id}")
def delete_safe_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    p = db.query(SafePage).filter(SafePage.id == page_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Safe page not found")
    db.delete(p)
    db.commit()
    return {"success": True}


@router.delete("/bulk/delete")
def bulk_delete_safe_pages(
    ids: list[str],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    deleted = db.query(SafePage).filter(SafePage.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


# ── Generate endpoint ────────────────────────────────

@router.post("/generate")
async def generate_safe_page(
    body: SafePageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate a new safe page. If domain_id is set, auto-deploys to domain via CF Worker."""
    # Resolve domain if domain_id provided
    domain = None
    domain_name = body.domain_name
    if body.domain_id:
        domain = db.query(Domain).filter(Domain.id == body.domain_id).first()
        if domain:
            domain_name = domain.name
        else:
            raise HTTPException(status_code=404, detail="Domain not found")

    # Create DB record
    page = SafePage(
        name=body.page_title or domain_name or f"Safe Page - {body.theme}",
        generator_type=body.generator_type,
        theme=body.theme,
        language=body.language,
        keywords=body.keywords,
        domain_name=domain_name,
        domain_id=body.domain_id,
        num_pages=body.num_pages,
        page_title=body.page_title,
        redirect_link=body.redirect_link,
        button_redirect=body.button_redirect,
        form_redirect=body.form_redirect,
        index_filename=body.index_filename or "index.html",
        company_name=body.company_name,
        tos_domain=body.tos_domain,
        phone_number=body.phone_number,
        email=body.email,
        pixel_code=body.pixel_code,
        head_code=body.head_code,
        body_start_code=body.body_start_code,
        body_end_code=body.body_end_code,
        status="generating",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    try:
        gen_settings = body.dict()
        # Override domain_name with resolved value
        gen_settings["domain_name"] = domain_name
        preview_html, zip_bytes = await build_safe_page_zip(gen_settings)

        # Upload ZIP to R2 if available, else save locally
        zip_url = await _save_zip(zip_bytes, page.id)

        page.status = "completed"
        page.preview_html = preview_html
        page.zip_url = zip_url
        db.commit()
        db.refresh(page)

        # ── TA script injection ──────────────────────────
        if body.ta_campaign_id:
            ta_host = domain_name or "ta.advicealchemy.com"
            ta_script = f'\n<script src="//{ta_host}/track/{body.ta_campaign_id}"></script>'
            if "</head>" in preview_html:
                preview_html = preview_html.replace("</head>", f"{ta_script}\n</head>")
            else:
                preview_html = ta_script + "\n" + preview_html
            page.preview_html = preview_html
            db.commit()

        # Auto-deploy to domain
        deploy_result = None
        deploy_url = None
        if body.auto_deploy and domain:
            # Use cPanel API deploy when link_name is provided and domain has hosting
            if domain.hosting_account_id and body.link_name:
                try:
                    deploy_result = await _auto_deploy_cpanel(
                        page, domain, body.link_name, db
                    )
                    if deploy_result.get("success"):
                        page.deployed = True
                        deploy_url = deploy_result.get("url")
                        db.commit()
                except Exception as deploy_err:
                    logger.warning(f"cPanel auto-deploy failed: {deploy_err}")
                    deploy_result = {"error": str(deploy_err)}
            # Fall back to Cloudflare Worker if no hosting but has CF zone
            elif domain.cloudflare_zone_id:
                try:
                    deploy_result = await _deploy_safe_page_to_domain(page, domain, db)
                    page.deployed = True
                    db.commit()
                except Exception as deploy_err:
                    logger.warning(f"CF auto-deploy failed: {deploy_err}")
                    deploy_result = {"error": str(deploy_err)}

        result = _serialize_page(page, db)
        if deploy_result:
            result["deploy_result"] = deploy_result
        if deploy_url:
            result["deploy_url"] = deploy_url
        return result

    except Exception as e:
        logger.exception("Safe page generation failed")
        page.status = "failed"
        page.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")


class IntegrationCodeRequest(BaseModel):
    code: str


@router.put("/{page_id}/integration-code")
def set_safe_page_integration_code(
    page_id: str,
    body: IntegrationCodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Save TA integration code to a safe page's linked campaign, re-inject, and redeploy."""
    page = db.query(SafePage).filter(SafePage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Safe page not found")

    cloaker = db.query(CloakerCampaign).filter(CloakerCampaign.safe_page_id == page_id).first()
    if not cloaker:
        raise HTTPException(status_code=400, detail="No TA campaign linked to this safe page")

    # Save integration code on the cloaker
    cloaker.ta_integration_code = body.code.strip()

    # Re-generate HTML with new integration code
    # Start from the original safe page HTML (before any TA injection)
    # We need to strip old TA code first, then re-inject
    from app.services.safe_page_generator import build_safe_page_zip
    html = page.preview_html or ""

    # Remove old TA injection (between markers)
    import re
    html = re.sub(
        r'\n?<!-- Traffic Armor Integration -->.*?(?=</head>)',
        '',
        html,
        flags=re.DOTALL,
    )

    # Re-inject with new integration code
    html = ta.inject_ta_code(
        html=html,
        ta_campaign_id=cloaker.ta_campaign_id,
        consent_prompt=bool(cloaker.consent_prompt),
        money_page_url=cloaker.money_page_url,
        ta_integration_code=body.code.strip(),
    )
    page.preview_html = html
    cloaker.safe_page_content = html

    # Redeploy via FTP if domain has hosting
    deploy_result = None
    if page.domain_id:
        domain = db.query(Domain).filter(Domain.id == page.domain_id).first()
        if domain and domain.hosting_account_id:
            subdirectory = f"links/{cloaker.ta_campaign_id}" if cloaker.ta_campaign_id else None
            try:
                deploy_result = _auto_deploy_ftp(page, domain, db, subdirectory=subdirectory, skip_ta_inject=True)
            except Exception as e:
                deploy_result = {"error": str(e)}

    db.commit()
    return {
        "success": True,
        "page_id": page.id,
        "ta_campaign_id": cloaker.ta_campaign_id,
        "code_saved": True,
        "deploy_result": deploy_result,
    }


def _auto_deploy_ftp(page: SafePage, domain: Domain, db: Session,
                     subdirectory: str = None, skip_ta_inject: bool = False) -> dict:
    """Auto-deploy safe page to domain's hosting account via FTP."""
    from app.models import HostingAccount

    hosting = db.query(HostingAccount).filter(HostingAccount.id == domain.hosting_account_id).first()
    if not hosting:
        return {"success": False, "error": "Hosting account not found"}

    html = page.preview_html or ""
    if not html:
        return {"success": False, "error": "No HTML content"}

    # Inject TA code if domain has cloaker campaign (skip if already injected)
    if not skip_ta_inject:
        cloaker = db.query(CloakerCampaign).filter(CloakerCampaign.domain_id == domain.id).first()
        if cloaker:
            html = ta.inject_ta_code(
                html=html,
                ta_campaign_id=cloaker.ta_campaign_id,
                consent_prompt=bool(cloaker.consent_prompt),
                money_page_url=cloaker.money_page_url,
                ftp_subdirectory=subdirectory,
            )

    filename = page.index_filename or "index.html"
    if subdirectory:
        filepath = f"{subdirectory}/{filename}"
    else:
        filepath = filename
    files = {filepath: html.encode("utf-8")}

    # Deploy TA PHP proxy + .htaccess alongside index.html for TA campaigns
    if subdirectory:
        cloaker_check = db.query(CloakerCampaign).filter(
            CloakerCampaign.safe_page_id == page.id
        ).first()
        if cloaker_check and cloaker_check.ta_campaign_id:
            ta_campaign_id = cloaker_check.ta_campaign_id
            track_php = ta.get_ta_track_php(ta_campaign_id)
            htaccess = ta.get_ta_htaccess()
            files[f"{subdirectory}/track.php"] = track_php.encode("utf-8")
            files[f"{subdirectory}/.htaccess"] = htaccess.encode("utf-8")

    password = decrypt_value(hosting.ftp_password_encrypted)
    service = FTPDeployService()

    result = service.deploy(
        ftp_host=hosting.ftp_host,
        ftp_port=hosting.ftp_port,
        ftp_username=hosting.ftp_username,
        ftp_password=password,
        ftp_protocol=hosting.ftp_protocol,
        remote_base_path=hosting.base_path,
        domain_name=domain.name,
        primary_domain=hosting.primary_domain or "",
        files=files,
    )
    logger.info("FTP auto-deploy for %s: %s", domain.name, result)
    return {"success": True, "domain": domain.name, "method": "ftp", **result}


async def _auto_deploy_cpanel(page: SafePage, domain: Domain, link_name: str, db: Session) -> dict:
    """Auto-deploy safe page to domain's hosting account via cPanel API."""
    from app.models import HostingAccount

    hosting = db.query(HostingAccount).filter(HostingAccount.id == domain.hosting_account_id).first()
    if not hosting:
        return {"success": False, "error": "Hosting account not found"}
    if not hosting.cpanel_host or not hosting.cpanel_username or not hosting.cpanel_api_token:
        return {"success": False, "error": "Hosting account missing cPanel credentials"}

    html = page.preview_html or ""
    if not html:
        return {"success": False, "error": "No HTML content"}

    cpanel_token = decrypt_value(hosting.cpanel_api_token)
    auth_header = f"cpanel {hosting.cpanel_username}:{cpanel_token}"
    base_url = f"https://{hosting.cpanel_host}:2083"
    doc_root = f"/home/{hosting.cpanel_username}/public_html/{domain.name}"
    target_dir = f"{doc_root}/links/{link_name}"

    async with httpx.AsyncClient(verify=False, timeout=30) as client:
        # Create directory structure
        for parent, name in [
            (doc_root, "links"),
            (f"{doc_root}/links", link_name),
        ]:
            await client.get(
                f"{base_url}/json-api/cpanel",
                params={
                    "cpanel_jsonapi_user": hosting.cpanel_username,
                    "cpanel_jsonapi_apiversion": "2",
                    "cpanel_jsonapi_module": "Fileman",
                    "cpanel_jsonapi_func": "mkdir",
                    "path": parent,
                    "name": name,
                },
                headers={"Authorization": auth_header},
            )

        # Upload index.html
        resp = await client.post(
            f"{base_url}/execute/Fileman/save_file_content",
            headers={"Authorization": auth_header},
            data={"dir": target_dir, "file": "index.html", "content": html},
        )
        result = resp.json()
        if result.get("status") != 1:
            return {"success": False, "error": f"cPanel upload failed: {result.get('errors')}"}

    live_url = f"https://{domain.name}/links/{link_name}/"
    return {"success": True, "domain": domain.name, "path": f"/links/{link_name}/", "url": live_url}


async def _deploy_safe_page_to_domain(page: SafePage, domain: Domain, db: Session) -> dict:
    """Deploy safe page HTML to a domain via Cloudflare Worker.

    If the domain has a CloakerCampaign, inject TA JS code.
    Otherwise, deploy as a plain static site.
    """
    cf_token = app_settings.CLOUDFLARE_API_TOKEN
    if not cf_token:
        return {"error": "CLOUDFLARE_API_TOKEN not configured"}

    html = page.preview_html or ""
    if not html:
        return {"error": "No HTML content to deploy"}

    # Check if this domain has a CloakerCampaign — if so, inject TA code
    cloaker = db.query(CloakerCampaign).filter(
        CloakerCampaign.domain_id == domain.id
    ).first()

    if cloaker:
        html = ta.inject_ta_code(
            html=html,
            ta_campaign_id=cloaker.ta_campaign_id,
            consent_prompt=bool(cloaker.consent_prompt),
            money_page_url=cloaker.money_page_url,
        )
        # Update the cloaker's safe page reference
        cloaker.safe_page_id = page.id
        cloaker.safe_page_content = html

    html_escaped = html.replace("`", "\\`").replace("${", "\\${")

    # Railway PHP service proxies to js-cdn.com (handles SSL issues)
    php_service = (app_settings.TA_PHP_SERVICE_URL or
                   "https://traffic-armor-php-production.up.railway.app")

    worker_script = f'''
// Static Safe Page + TA Proxy — auto-deployed by MVMT Printer
const SAFE_PAGE_HTML = `{html_escaped}`;
const PHP_SERVICE = "{php_service}";

async function handleTrackRequest(request, campaignId) {{
  const url = new URL(request.url);
  const phpUrl = new URL(`${{PHP_SERVICE}}/track/${{campaignId}}`);
  for (const [k, v] of url.searchParams.entries()) phpUrl.searchParams.set(k, v);

  // Forward safe browser headers (NOT accept-encoding — we need uncompressed response)
  const fwdHeaders = {{}};
  for (const [k, v] of request.headers.entries()) {{
    if (["user-agent","accept","accept-language","cookie","referer"].includes(k))
      fwdHeaders[k] = v;
  }}
  // Pass real visitor IP from Cloudflare
  fwdHeaders["x-forwarded-for"] = request.headers.get("cf-connecting-ip") || "";
  // Tell PHP to use our domain for the JS callback URL (so callback also goes
  // through Cloudflare → Worker → PHP, keeping the same IP for TA fingerprinting)
  fwdHeaders["x-original-host"] = url.host;
  const trackPath = url.pathname.replace(/\\/track\\/[^/]+$/, "") + "/track/" + campaignId;
  fwdHeaders["x-original-track-path"] = trackPath;

  try {{
    const phpResp = await fetch(phpUrl.toString(), {{ headers: fwdHeaders, redirect: "follow" }});
    const body = await phpResp.text();
    const respHeaders = new Headers({{
      "content-type": "application/javascript",
      "cache-control": "no-store, no-cache, must-revalidate",
      "pragma": "no-cache",
    }});
    for (const [key, val] of phpResp.headers.entries()) {{
      if (key.toLowerCase() === "set-cookie") respHeaders.append("set-cookie", val);
    }}
    return new Response(body, {{ headers: respHeaders }});
  }} catch (err) {{
    return new Response("// TA proxy error: " + err.message, {{
      headers: {{ "content-type": "application/javascript" }}, status: 502,
    }});
  }}
}}

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    if (url.pathname === "/favicon.ico") return new Response(null, {{ status: 204 }});
    if (url.pathname.match(/\\.(css|js|png|jpg|gif|svg|woff|woff2)$/)) return new Response(null, {{ status: 204 }});

    const trackMatch = url.pathname.match(/\\/(?:links\\/[^/]+\\/)?track\\/([a-zA-Z0-9]+)/);
    if (trackMatch) return handleTrackRequest(request, trackMatch[1]);

    return new Response(SAFE_PAGE_HTML, {{
      headers: {{ "content-type": "text/html;charset=UTF-8", "cache-control": "no-store" }},
    }});
  }},
}};
'''

    worker_name = f"safe-{domain.name.replace('.', '-')}"

    async with httpx.AsyncClient(timeout=60) as client:
        auth = {"Authorization": f"Bearer {cf_token}"}

        # Get CF account ID
        acct_resp = await client.get("https://api.cloudflare.com/client/v4/accounts", headers=auth)
        acct_data = acct_resp.json()
        if not acct_data.get("success") or not acct_data.get("result"):
            return {"error": "Failed to get Cloudflare account ID"}
        account_id = acct_data["result"][0]["id"]

        # Upload worker
        metadata = _json.dumps({"main_module": "worker.js", "compatibility_date": "2024-01-01"})
        upload_resp = await client.put(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{worker_name}",
            headers=auth,
            files={
                "metadata": ("metadata.json", metadata, "application/json"),
                "worker.js": ("worker.js", worker_script.encode(), "application/javascript+module"),
            },
        )
        upload_data = upload_resp.json()
        if not upload_data.get("success"):
            return {"error": f"Worker upload failed: {upload_data.get('errors', [])}"}

        # Add route
        route_pattern = f"*{domain.name}/*"
        route_resp = await client.post(
            f"https://api.cloudflare.com/client/v4/zones/{domain.cloudflare_zone_id}/workers/routes",
            headers={**auth, "Content-Type": "application/json"},
            json={"pattern": route_pattern, "script": worker_name},
        )
        route_data = route_resp.json()
        if not route_data.get("success"):
            errors = route_data.get("errors", [])
            already_exists = any("duplicate" in str(e).lower() or "already exists" in str(e).lower() for e in errors)
            if not already_exists:
                return {"error": f"Route failed: {errors}", "worker_deployed": True}

    # Update cloaker if exists
    if cloaker:
        cloaker.worker_deployed = True
        cloaker.worker_route = route_pattern

    return {
        "success": True,
        "worker_name": worker_name,
        "route": route_pattern,
        "ta_injected": bool(cloaker and cloaker.ta_campaign_id),
        "domain": domain.name,
    }


@router.post("/{page_id}/deploy")
async def deploy_safe_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Deploy (or re-deploy) a safe page to its linked domain."""
    page = db.query(SafePage).filter(SafePage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Safe page not found")
    if not page.domain_id:
        raise HTTPException(status_code=400, detail="Safe page has no linked domain. Set domain_id first.")
    if page.status != "completed" or not page.preview_html:
        raise HTTPException(status_code=400, detail="Safe page not generated yet")

    domain = db.query(Domain).filter(Domain.id == page.domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Linked domain not found")
    if not domain.cloudflare_zone_id:
        raise HTTPException(status_code=400, detail=f"Domain {domain.name} has no Cloudflare zone")

    result = await _deploy_safe_page_to_domain(page, domain, db)

    if result.get("success"):
        page.deployed = True
        db.commit()

    return result


@router.post("/{page_id}/deploy-hosting")
async def deploy_safe_page_hosting(
    page_id: str,
    link_name: str = Query(..., description="Name for the /links/{name}/ path"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Deploy a safe page to Namecheap hosting via cPanel API.

    Uploads to /links/{link_name}/index.html on the domain's hosting account.
    No TA integration — user handles that manually on the TA dashboard.
    """
    from app.models import HostingAccount

    page = db.query(SafePage).filter(SafePage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Safe page not found")
    if not page.domain_id:
        raise HTTPException(status_code=400, detail="Safe page has no linked domain")
    if page.status != "completed" or not page.preview_html:
        raise HTTPException(status_code=400, detail="Safe page not generated yet")

    domain = db.query(Domain).filter(Domain.id == page.domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Linked domain not found")
    if not domain.hosting_account_id:
        raise HTTPException(status_code=400, detail=f"Domain {domain.name} has no hosting account assigned")

    hosting = db.query(HostingAccount).filter(HostingAccount.id == domain.hosting_account_id).first()
    if not hosting:
        raise HTTPException(status_code=404, detail="Hosting account not found")
    if not hosting.cpanel_host or not hosting.cpanel_username or not hosting.cpanel_api_token:
        raise HTTPException(status_code=400, detail="Hosting account missing cPanel credentials")

    cpanel_token = decrypt_value(hosting.cpanel_api_token)
    auth_header = f"cpanel {hosting.cpanel_username}:{cpanel_token}"
    base_url = f"https://{hosting.cpanel_host}:2083"

    # Document root: /home/{cpanel_user}/public_html/{domain_name}
    # Addon domains on Namecheap cPanel use this layout.
    doc_root = f"/home/{hosting.cpanel_username}/public_html/{domain.name}"
    target_dir = f"{doc_root}/links/{link_name}"

    html = page.preview_html

    try:
        async with httpx.AsyncClient(verify=False, timeout=30) as client:
            # Create directory structure via cPanel API2 (mkdir)
            for parent, name in [
                (f"{doc_root}", "links"),
                (f"{doc_root}/links", link_name),
            ]:
                await client.get(
                    f"{base_url}/json-api/cpanel",
                    params={
                        "cpanel_jsonapi_user": hosting.cpanel_username,
                        "cpanel_jsonapi_apiversion": "2",
                        "cpanel_jsonapi_module": "Fileman",
                        "cpanel_jsonapi_func": "mkdir",
                        "path": parent,
                        "name": name,
                    },
                    headers={"Authorization": auth_header},
                )

            # Upload index.html via UAPI
            resp = await client.post(
                f"{base_url}/execute/Fileman/save_file_content",
                headers={"Authorization": auth_header},
                data={"dir": target_dir, "file": "index.html", "content": html},
            )
            result = resp.json()
            if result.get("status") != 1:
                raise HTTPException(
                    status_code=500,
                    detail=f"cPanel upload failed: {result.get('errors')}",
                )

        page.deployed = True
        db.commit()

        live_url = f"https://{domain.name}/links/{link_name}/"
        return {
            "success": True,
            "domain": domain.name,
            "path": f"/links/{link_name}/",
            "url": live_url,
            "message": f"Safe page deployed to {live_url}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("cPanel deploy failed")
        raise HTTPException(status_code=500, detail=f"Deploy failed: {e}")


# Keep old FTP endpoint for backwards compatibility
@router.post("/{page_id}/deploy-ftp")
async def deploy_safe_page_ftp(
    page_id: str,
    link_name: str = Query(None, description="Name for the /links/{name}/ path"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Alias for deploy-hosting (backwards compatibility)."""
    if not link_name:
        raise HTTPException(status_code=400, detail="link_name query parameter required")
    return await deploy_safe_page_hosting(page_id, link_name, db, current_user)


async def _save_zip(zip_bytes: bytes, page_id: str) -> str:
    """Save ZIP to R2 or local filesystem."""
    from app.core.config import settings as app_settings

    filename = f"safe-pages/{page_id}.zip"

    if app_settings.r2_enabled:
        from app.api.v1.uploads import upload_to_r2
        return await upload_to_r2(zip_bytes, filename, "application/zip")
    else:
        # Local fallback
        upload_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads", "safe-pages")
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, f"{page_id}.zip")
        with open(filepath, "wb") as f:
            f.write(zip_bytes)
        return f"/uploads/safe-pages/{page_id}.zip"


# ── Re-download endpoint ────────────────────────────

@router.get("/{page_id}/download")
async def download_safe_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Re-generate and download a fresh ZIP (re-randomized)."""
    p = db.query(SafePage).filter(SafePage.id == page_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Safe page not found")

    settings = {
        "generator_type": p.generator_type, "theme": p.theme, "language": p.language,
        "keywords": p.keywords, "domain_name": p.domain_name, "num_pages": p.num_pages,
        "page_title": p.page_title, "redirect_link": p.redirect_link,
        "button_redirect": p.button_redirect, "form_redirect": p.form_redirect,
        "index_filename": p.index_filename, "company_name": p.company_name,
        "tos_domain": p.tos_domain, "phone_number": p.phone_number, "email": p.email,
        "pixel_code": p.pixel_code, "head_code": p.head_code,
        "body_start_code": p.body_start_code, "body_end_code": p.body_end_code,
    }

    _, zip_bytes = await build_safe_page_zip(settings)

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=safe-page-{page_id[:8]}.zip"},
    )


# ── Uniqueizer endpoints ────────────────────────────

@router.post("/tools/uniqueize-image")
async def uniqueize_image_endpoint(
    file: UploadFile = File(...),
    degree: str = Query("medium", regex="^(light|medium|strong)$"),
    current_user: User = Depends(get_current_active_user),
):
    """Uniqueize an image. Returns the modified image."""
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    try:
        result = uniqueize_image(content, degree)
        return Response(
            content=result,
            media_type="image/png",
            headers={"Content-Disposition": f"attachment; filename=unique-{file.filename}"},
        )
    except Exception as e:
        logger.exception("Image uniqueization failed")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


@router.post("/tools/uniqueize-video")
async def uniqueize_video_endpoint(
    file: UploadFile = File(...),
    degree: str = Query("medium", regex="^(light|medium|strong)$"),
    current_user: User = Depends(get_current_active_user),
):
    """Uniqueize a video. Returns the modified video."""
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Video too large (max 50MB)")

    ext = os.path.splitext(file.filename or ".mp4")[1] or ".mp4"

    try:
        result = uniqueize_video(content, degree, ext)
        return Response(
            content=result,
            media_type="video/mp4",
            headers={"Content-Disposition": f"attachment; filename=unique-{file.filename}"},
        )
    except Exception as e:
        logger.exception("Video uniqueization failed")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


# ── Data generator endpoints ─────────────────────────

@router.get("/tools/countries")
def list_countries(current_user: User = Depends(get_current_active_user)):
    """Return supported countries for data generators."""
    from app.services.data_generator import _COUNTRY_NAMES
    return [{"code": k, "name": v} for k, v in _COUNTRY_NAMES.items()]


@router.post("/tools/generate-address")
def generate_address_endpoint(
    country: str = Query("US"),
    current_user: User = Depends(get_current_active_user),
):
    return generate_address(country)


@router.post("/tools/generate-phone")
def generate_phone_endpoint(
    country: str = Query("US"),
    current_user: User = Depends(get_current_active_user),
):
    return generate_phone(country)


# ── Code Presets CRUD ────────────────────────────────

@router.get("/presets")
def list_presets(
    slot: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(CodePreset).order_by(CodePreset.name)
    if slot:
        query = query.filter(CodePreset.slot == slot)
    return [_serialize_preset(p) for p in query.all()]


@router.post("/presets")
def create_preset(
    body: CodePresetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if body.slot not in ("pixel", "head", "body_start", "body_end"):
        raise HTTPException(status_code=400, detail="Invalid slot")
    p = CodePreset(name=body.name, slot=body.slot, code=body.code)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _serialize_preset(p)


@router.put("/presets/{preset_id}")
def update_preset(
    preset_id: str,
    body: CodePresetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    p = db.query(CodePreset).filter(CodePreset.id == preset_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Preset not found")
    if body.name is not None:
        p.name = body.name
    if body.code is not None:
        p.code = body.code
    db.commit()
    db.refresh(p)
    return _serialize_preset(p)


@router.delete("/presets/{preset_id}")
def delete_preset(
    preset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    p = db.query(CodePreset).filter(CodePreset.id == preset_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(p)
    db.commit()
    return {"success": True}
