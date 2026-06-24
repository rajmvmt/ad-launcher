"""Traffic Armor cloaker campaign management endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import CloakerCampaign, Domain, Persona, AffiliateUrl, User, FacebookConnection, TrackedPage, SafePage
from app.api.v1.auth import get_current_active_user
from app.services import traffic_armor_service as ta
from app.services.facebook_service import FacebookService
from app.core.config import settings
import httpx
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_ad_account_name_map(db: Session) -> dict:
    """Build a map of ad_account_id -> name from the Facebook API."""
    acct_map = {}
    try:
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_default == True).first()
        svc = FacebookService(conn) if conn else FacebookService()
        accounts = svc.get_ad_accounts()
        for a in accounts:
            if a.get("name"):
                acct_map[a["id"]] = a["name"]
                acct_map[a.get("account_id", "")] = a["name"]
                acct_map[f'act_{a.get("account_id", "")}'] = a["name"]
    except Exception as e:
        logger.warning(f"Failed to fetch FB ad accounts: {e}")
    return acct_map


# ─── Schemas ─────────────────────────────────────────────────────────────────

class CloakerCreate(BaseModel):
    domain_id: str
    name: str
    money_page_url: str
    ad_account_id: Optional[str] = None
    persona_id: Optional[str] = None
    fb_page_id: Optional[str] = None
    safe_page_id: Optional[str] = None
    safe_page_content: Optional[str] = None
    rules: Optional[dict] = None  # Traffic Armor cloaking rules (uses smart defaults if omitted)
    consent_prompt: Optional[bool] = False  # Cookie consent modal (cloaking layer)
    delivery_method: Optional[str] = "iframe"  # iframe | custom_js | paste_html
    ta_integration_code: Optional[str] = None  # Paste from TA dashboard Integration tab

class CloakerUpdate(BaseModel):
    name: Optional[str] = None
    money_page_url: Optional[str] = None
    ad_account_id: Optional[str] = None
    persona_id: Optional[str] = None
    fb_page_id: Optional[str] = None
    safe_page_id: Optional[str] = None
    safe_page_content: Optional[str] = None
    status: Optional[str] = None
    rules: Optional[dict] = None  # Update cloaking rules
    consent_prompt: Optional[bool] = None
    delivery_method: Optional[str] = None  # iframe | custom_js | paste_html
    ta_integration_code: Optional[str] = None  # Paste from TA dashboard Integration tab


# ─── Local CRUD ──────────────────────────────────────────────────────────────

@router.get("")
def list_cloaker_campaigns(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all cloaker campaigns with domain info."""
    acct_map = _get_ad_account_name_map(db)
    campaigns = (
        db.query(CloakerCampaign)
        .order_by(CloakerCampaign.created_at.desc())
        .all()
    )

    # Batch-fetch all related objects to avoid N+1 queries
    domain_ids = {c.domain_id for c in campaigns if c.domain_id}
    persona_ids = {c.persona_id for c in campaigns if c.persona_id}
    safe_page_ids = {c.safe_page_id for c in campaigns if c.safe_page_id}

    domains_by_id = {}
    if domain_ids:
        for d in db.query(Domain).filter(Domain.id.in_(domain_ids)).all():
            domains_by_id[d.id] = d

    personas_by_id = {}
    if persona_ids:
        for p in db.query(Persona).filter(Persona.id.in_(persona_ids)).all():
            personas_by_id[p.id] = p

    # Also fetch personas by domain_id for fallback
    personas_by_domain = {}
    if domain_ids:
        for p in db.query(Persona).filter(Persona.domain_id.in_(domain_ids)).all():
            if p.domain_id not in personas_by_domain:
                personas_by_domain[p.domain_id] = p

    safe_pages_by_id = {}
    if safe_page_ids:
        for sp in db.query(SafePage).filter(SafePage.id.in_(safe_page_ids)).all():
            safe_pages_by_id[sp.id] = sp

    # Fetch all tracked pages at once
    all_tracked_pages = db.query(TrackedPage).all()
    tracked_by_fb_page_id = {tp.fb_page_id: tp for tp in all_tracked_pages}

    result = []
    for c in campaigns:
        domain = domains_by_id.get(c.domain_id)
        # Use stored IDs on campaign, fall back to domain-linked data
        acct_id = c.ad_account_id or (domain.ad_account_id if domain else None)
        ad_account_name = acct_map.get(acct_id) if acct_id else None
        persona = None
        if c.persona_id:
            persona = personas_by_id.get(c.persona_id)
        elif domain:
            persona = personas_by_domain.get(c.domain_id)
        fb_page_name = None
        fb_pid = c.fb_page_id or (persona.fb_page_id if persona else None)
        if fb_pid:
            page = tracked_by_fb_page_id.get(fb_pid)
            fb_page_name = page.name if page else None
        safe_page = safe_pages_by_id.get(c.safe_page_id) if c.safe_page_id else None
        result.append({
            "id": c.id,
            "domain_id": c.domain_id,
            "domain_name": domain.name if domain else None,
            "ad_account_id": acct_id,
            "ad_account_name": ad_account_name,
            "persona_id": c.persona_id or (persona.id if persona else None),
            "persona_name": persona.name if persona else None,
            "fb_page_id": fb_pid,
            "fb_page_name": fb_page_name,
            "ta_campaign_number": c.ta_campaign_number,
            "ta_campaign_id": c.ta_campaign_id,
            "name": c.name,
            "safe_page_id": c.safe_page_id,
            "safe_page_name": (safe_page.name or safe_page.page_title or f"{safe_page.theme} — {safe_page.language}") if safe_page else None,
            "money_page_url": c.money_page_url,
            "status": c.status,
            "deadbolt": c.deadbolt or False,
            "consent_prompt": c.consent_prompt or False,
            "delivery_method": c.delivery_method or "iframe",
            "ta_integration_code": c.ta_integration_code,
            "ta_rules": c.ta_rules or ta.DEFAULT_RULES,
            "worker_deployed": c.worker_deployed,
            "worker_route": c.worker_route,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        })
    return result


@router.get("/domains-info")
def get_domains_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all domains with their linked ad account name, persona, and FB page."""
    acct_map = _get_ad_account_name_map(db)
    domains = db.query(Domain).order_by(Domain.name).all()
    result = []
    for d in domains:
        persona = db.query(Persona).filter(Persona.domain_id == d.id).first()
        ad_account_name = acct_map.get(d.ad_account_id) if d.ad_account_id else None
        fb_page_name = None
        if persona and persona.fb_page_id:
            page = db.query(TrackedPage).filter(
                TrackedPage.fb_page_id == persona.fb_page_id
            ).first()
            fb_page_name = page.name if page else None
        result.append({
            "id": d.id,
            "name": d.name,
            "brand_id": d.brand_id,
            "ad_account_id": d.ad_account_id,
            "ad_account_name": ad_account_name,
            "persona_id": persona.id if persona else None,
            "persona_name": persona.name if persona else None,
            "fb_page_id": persona.fb_page_id if persona else None,
            "fb_page_name": fb_page_name,
            "cloudflare_zone_id": d.cloudflare_zone_id,
        })
    return result


@router.get("/domain-map")
async def get_domain_map(
    key: str = None,
    db: Session = Depends(get_db),
):
    """Return domain->TA campaign ID mapping for the PHP cloaker.

    Public endpoint (no auth) but protected by deploy key.
    Called by index.php when campaigns.json is missing (after redeploy).
    Must be defined BEFORE /{campaign_id} to avoid route shadowing.
    """
    deploy_key = settings.TA_PHP_DEPLOY_KEY
    if deploy_key and key != deploy_key:
        raise HTTPException(status_code=403, detail="Invalid key")

    campaigns = db.query(CloakerCampaign).filter(
        CloakerCampaign.ta_campaign_id.isnot(None),
        CloakerCampaign.status == "active",
    ).all()

    domain_map = {}
    for c in campaigns:
        domain = db.query(Domain).filter(Domain.id == c.domain_id).first()
        if domain and domain.name and c.ta_campaign_id:
            domain_map[domain.name] = c.ta_campaign_id

    return domain_map


@router.get("/{campaign_id}")
def get_cloaker_campaign(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a single cloaker campaign."""
    c = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")
    domain = db.query(Domain).filter(Domain.id == c.domain_id).first()
    return {
        "id": c.id,
        "domain_id": c.domain_id,
        "domain_name": domain.name if domain else None,
        "ta_campaign_number": c.ta_campaign_number,
        "ta_campaign_id": c.ta_campaign_id,
        "name": c.name,
        "safe_page_url": c.safe_page_url,
        "money_page_url": c.money_page_url,
        "safe_page_content": c.safe_page_content,
        "status": c.status,
        "worker_deployed": c.worker_deployed,
        "worker_route": c.worker_route,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.post("")
async def create_cloaker_campaign(
    data: CloakerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a cloaker campaign — saves locally and creates on Traffic Armor."""
    # Validate domain exists
    domain = db.query(Domain).filter(Domain.id == data.domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    # If a safe page was selected, pull its HTML
    safe_html = data.safe_page_content
    if data.safe_page_id:
        sp = db.query(SafePage).filter(SafePage.id == data.safe_page_id).first()
        if sp and sp.preview_html:
            safe_html = sp.preview_html

    # Merge user rules with smart defaults
    rules = {**ta.DEFAULT_RULES, **(data.rules or {})}

    # Create local record first
    campaign = CloakerCampaign(
        domain_id=data.domain_id,
        ad_account_id=data.ad_account_id or None,
        persona_id=data.persona_id or None,
        fb_page_id=data.fb_page_id or None,
        name=data.name,
        money_page_url=data.money_page_url,
        safe_page_id=data.safe_page_id or None,
        safe_page_content=safe_html,
        ta_rules=rules,
        consent_prompt=data.consent_prompt or False,
        delivery_method=data.delivery_method or "iframe",
        ta_integration_code=data.ta_integration_code,
        status="draft",
    )
    db.add(campaign)
    db.flush()

    # Create on Traffic Armor if API key is set
    if settings.TRAFFIC_ARMOR_API_KEY:
        try:
            # Build v1 form-data (flat field names — reliably persisted by TA)
            form_data = ta.build_ta_form_data_v1(
                name=data.name,
                money_page_url=data.money_page_url,
                safe_url=f"https://{domain.name}",
                rules=rules,
                consent_prompt=data.consent_prompt or False,
                delivery_method=data.delivery_method or "iframe",
            )
            result = await ta.create_campaign(form_data, rules=rules)
            if result.get("success"):
                ta_data = result.get("data", result)
                campaign.ta_campaign_number = int(ta_data.get("cloak_link_id", 0)) or None
                campaign.ta_campaign_id = str(ta_data.get("cli_key", ta_data.get("c8_key", "")))
                campaign.status = "active"

                # Set up proxy detection domain
                if campaign.ta_campaign_number:
                    try:
                        await ta.check_proxy_domain(campaign.ta_campaign_number, domain.name)
                    except Exception:
                        pass  # Non-critical
            else:
                campaign.status = "draft"
        except Exception as e:
            # Save locally even if TA fails — user can retry
            campaign.status = "draft"
            db.commit()
            return {
                "id": campaign.id,
                "domain_name": domain.name,
                "name": campaign.name,
                "status": "draft",
                "ta_error": str(e),
                "message": "Saved locally but Traffic Armor creation failed. You can retry from the UI.",
            }

    # Auto-create affiliate URL for the persona linked to this domain
    persona = db.query(Persona).filter(Persona.domain_id == data.domain_id).first()
    affiliate_url_created = False
    if persona:
        cloaked_url = f"https://{domain.name}"
        existing_url = db.query(AffiliateUrl).filter(
            AffiliateUrl.url == cloaked_url
        ).first()
        if not existing_url:
            db.add(AffiliateUrl(
                url=cloaked_url,
                domain=domain.name,
                offer=persona.offer or "akemi",
            ))
            affiliate_url_created = True

    db.commit()
    return {
        "id": campaign.id,
        "domain_id": campaign.domain_id,
        "domain_name": domain.name,
        "persona_name": persona.name if persona else None,
        "ta_campaign_number": campaign.ta_campaign_number,
        "ta_campaign_id": campaign.ta_campaign_id,
        "name": campaign.name,
        "money_page_url": campaign.money_page_url,
        "safe_page_url": campaign.safe_page_url,
        "status": campaign.status,
        "affiliate_url_created": affiliate_url_created,
    }


@router.put("/{campaign_id}")
async def update_cloaker_campaign(
    campaign_id: str,
    data: CloakerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a cloaker campaign locally and optionally sync to Traffic Armor."""
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    updates = data.model_dump(exclude_unset=True)

    # If safe_page_id changed, pull the HTML from the SafePage record
    if "safe_page_id" in updates:
        sp_id = updates["safe_page_id"]
        if sp_id:
            sp = db.query(SafePage).filter(SafePage.id == sp_id).first()
            if sp and sp.preview_html:
                updates["safe_page_content"] = sp.preview_html
        else:
            updates["safe_page_content"] = None  # Reset to default

    # Handle rules update — merge with existing
    if "rules" in updates:
        existing_rules = campaign.ta_rules or ta.DEFAULT_RULES
        campaign.ta_rules = {**existing_rules, **updates.pop("rules")}

    for key, val in updates.items():
        setattr(campaign, key, val)

    # Sync ALL rules to Traffic Armor (TA requires full rules on every edit)
    sync_fields = ("money_page_url", "name", "rules", "consent_prompt", "delivery_method")
    raw_updates = data.model_dump(exclude_unset=True)
    if campaign.ta_campaign_number and settings.TRAFFIC_ARMOR_API_KEY:
        if any(k in raw_updates for k in sync_fields):
            try:
                domain = db.query(Domain).filter(Domain.id == campaign.domain_id).first()
                form_data = ta.build_ta_form_data_v1(
                    name=campaign.name,
                    money_page_url=campaign.money_page_url,
                    safe_url=f"https://{domain.name}" if domain else "",
                    rules=campaign.ta_rules,
                    consent_prompt=bool(campaign.consent_prompt),
                    delivery_method=campaign.delivery_method or "iframe",
                )
                await ta.edit_campaign(campaign.ta_campaign_number, form_data, rules=campaign.ta_rules)
            except Exception as e:
                logger.warning(f"Failed to sync rules to TA: {e}")

    db.commit()
    domain = db.query(Domain).filter(Domain.id == campaign.domain_id).first()
    return {
        "id": campaign.id,
        "domain_id": campaign.domain_id,
        "domain_name": domain.name if domain else None,
        "ta_campaign_number": campaign.ta_campaign_number,
        "name": campaign.name,
        "money_page_url": campaign.money_page_url,
        "safe_page_url": campaign.safe_page_url,
        "status": campaign.status,
    }


@router.delete("/{campaign_id}")
async def delete_cloaker_campaign(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a cloaker campaign. Archives on Traffic Armor if linked."""
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    # Archive on Traffic Armor
    if campaign.ta_campaign_number and settings.TRAFFIC_ARMOR_API_KEY:
        try:
            await ta.archive_campaigns([campaign.ta_campaign_number])
        except Exception:
            pass

    db.delete(campaign)
    db.commit()
    return {"message": f"Cloaker campaign '{campaign.name}' deleted"}


# ─── Traffic Armor Live Status ────────────────────────────────────────────────

@router.get("/ta/live-status")
async def ta_live_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Fetch live campaign status from TA API for all linked campaigns.

    Returns a dict keyed by ta_campaign_id (cli_key) with the real TA state:
    deadbolt, integration_method, hybrid_mode, cloaking_disabled, etc.
    Frontend merges this with local DB data to show the true TA status.
    """
    campaigns = db.query(CloakerCampaign).filter(
        CloakerCampaign.ta_campaign_id.isnot(None),
    ).all()

    if not campaigns or not settings.TRAFFIC_ARMOR_API_KEY:
        return {}

    result = {}
    for c in campaigns:
        try:
            data = await ta.get_campaign(c.ta_campaign_id)
            if isinstance(data, dict) and data.get("success"):
                d = data["data"]
                result[c.ta_campaign_id] = {
                    "deadbolt": d.get("deadbolt") == "1",
                    "integration_method": d.get("integration_method"),
                    "hybrid_mode": d.get("hybrid_mode") == "1",
                    "cloaking_disabled": d.get("cloaking_disabled") == "1",
                    "sticky_cloaking": d.get("sticky_cloaking") == "1",
                    "cloak_spoofed_browser": d.get("cloak_spoofed_browser") == "1",
                    "cloak_spoofed_os": d.get("cloak_spoofed_os") == "1",
                    "cloak_commercial_isps": d.get("cloak_commercial_isps") == "1",
                    "cloak_proxies": d.get("cloak_proxies") == "1",
                    "cloak_headless_browsers": d.get("cloak_headless_browsers") == "1",
                    "cloak_uncommon_isps": d.get("cloak_uncommon_isps") == "1",
                    "proxy_detection": d.get("proxy_detection") == "1",
                    "maximum_ip_visits": d.get("maximum_ip_visits", "0"),
                    "maximum_browser_visits": d.get("maximum_browser_visits", "0"),
                    "uncloaking_action": d.get("uncloaking_action"),
                    "real_url_1": d.get("real_url_1"),
                }
        except Exception as e:
            logger.warning(f"Failed to fetch TA status for {c.ta_campaign_id}: {e}")
            continue

    return result


# ─── Traffic Armor Proxy Endpoints ───────────────────────────────────────────

@router.get("/ta/campaigns")
async def ta_list_campaigns(
    current_user: User = Depends(get_current_active_user),
):
    """List all campaigns directly from Traffic Armor."""
    try:
        return await ta.list_campaigns()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/stats/{campaign_number}")
async def ta_get_stats(
    campaign_number: int,
    daterange: str = None,
    current_user: User = Depends(get_current_active_user),
):
    """Get campaign stats from Traffic Armor."""
    try:
        return await ta.get_stats(campaign_number, daterange)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/clicks")
async def ta_get_clicks(
    campaign: int = None, daterange: str = None, page: int = None,
    cloak_reason: str = None, isp: int = None, ip: str = None,
    visitor_id: str = None, device: str = None, ip_address: str = None,
    location: int = None, agent_contains: str = None,
    safe_url_contains: str = None, destination_url_contains: str = None,
    referrer_contains: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get click logs from Traffic Armor with full filter support.

    When no campaign is specified, fetches clicks across all local campaigns
    (TA API requires a campaign number to return results).
    """
    # Get all campaign numbers for "all campaigns" mode
    # Fetch from TA API directly (includes archived campaigns with click history)
    all_numbers = None
    if campaign is None:
        try:
            ta_campaigns = await ta.list_campaigns()
            if isinstance(ta_campaigns, dict):
                ta_campaigns = ta_campaigns.get("data", [])
            all_numbers = [
                int(c["cloak_link_id"]) for c in ta_campaigns
                if isinstance(c, dict) and c.get("cloak_link_id") and not c.get("deleted_at")
            ]
            # Also include local DB campaigns (may have click history even if archived on TA)
            local_nums = {
                c.ta_campaign_number for c in db.query(CloakerCampaign).filter(
                    CloakerCampaign.ta_campaign_number.isnot(None)
                ).all()
            }
            all_numbers = list(set(all_numbers) | local_nums)
        except Exception as e:
            logger.warning(f"Failed to list TA campaigns for click logs: {e}")
            # Fallback to local DB
            local_camps = db.query(CloakerCampaign).filter(
                CloakerCampaign.ta_campaign_number.isnot(None)
            ).all()
            all_numbers = [c.ta_campaign_number for c in local_camps]
    try:
        return await ta.get_click_logs(
            campaign=campaign, daterange=daterange, page=page,
            cloak_reason=cloak_reason, isp=isp, ip=ip,
            visitor_id=visitor_id, device=device, ip_address=ip_address,
            location=location, agent_contains=agent_contains,
            safe_url_contains=safe_url_contains,
            destination_url_contains=destination_url_contains,
            referrer_contains=referrer_contains,
            all_campaign_numbers=all_numbers,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/balance")
async def ta_get_balance(
    current_user: User = Depends(get_current_active_user),
):
    """Get Traffic Armor clicks balance."""
    try:
        return await ta.get_clicks_balance()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/global-stats")
async def ta_get_global_stats(
    daterange: str = None,
    current_user: User = Depends(get_current_active_user),
):
    """Get global stats across all campaigns."""
    try:
        return await ta.get_global_stats(daterange)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/find-location/{search}")
async def ta_find_location(
    search: str,
    current_user: User = Depends(get_current_active_user),
):
    """Search for location IDs (for geo-filtering rules)."""
    try:
        return await ta.find_location(search)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/find-org/{search}")
async def ta_find_org(
    search: str,
    current_user: User = Depends(get_current_active_user),
):
    """Search for ORG/ISP IDs."""
    try:
        return await ta.find_org(search)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/lists")
async def ta_get_lists(
    current_user: User = Depends(get_current_active_user),
):
    """Get all user lists (IP, UA, referrer blocklists)."""
    try:
        return await ta.get_lists()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/lists/global-db")
async def ta_get_global_db_lists(
    current_user: User = Depends(get_current_active_user),
):
    """Get global database lists (shared bot databases)."""
    try:
        return await ta.get_global_db_lists()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/lists/{list_type}/{list_id}")
async def ta_get_list_detail(
    list_type: str, list_id: int,
    current_user: User = Depends(get_current_active_user),
):
    """Get details of a specific list."""
    try:
        return await ta.get_list_detail(list_type, list_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


class ListCreate(BaseModel):
    label: str
    content: str  # entries separated by newlines


@router.post("/ta/lists/{list_type}")
async def ta_create_list(
    list_type: str, data: ListCreate,
    current_user: User = Depends(get_current_active_user),
):
    """Create a new list (IP, UA, referrer, etc)."""
    try:
        return await ta.create_list(list_type, data.label, data.content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.put("/ta/lists/{list_type}/{list_id}")
async def ta_edit_list(
    list_type: str, list_id: int, data: ListCreate,
    current_user: User = Depends(get_current_active_user),
):
    """Edit an existing list."""
    try:
        return await ta.edit_list(list_type, list_id, data.label, data.content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/campaign-postdata/{campaign_number}")
async def ta_get_campaign_postdata(
    campaign_number: int,
    current_user: User = Depends(get_current_active_user),
):
    """Get full campaign config including location data from TA."""
    try:
        return await ta.get_campaign_postdata(campaign_number)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Traffic Armor API error: {e}")


@router.get("/ta/defaults")
async def ta_get_defaults(
    current_user: User = Depends(get_current_active_user),
):
    """Return the smart default rules for new campaigns."""
    return ta.DEFAULT_RULES



# ─── Cloudflare Worker Deployment (Static Site — TA handles all cloaking) ────
#
# ARCHITECTURE: Traffic Armor's JavaScript integration does ALL cloaking.
# The CF Worker simply serves the safe page HTML as a static site.
# TA's JS (injected into the page) handles: fingerprinting, proxy detection,
# bot detection, residential proxy detection, headless browser detection, etc.
# No bot detection logic in the worker — that's TA's job.

WORKER_TEMPLATE = '''
// Multi-campaign Safe Page Server — Traffic Armor JS handles all cloaking
// Auto-generated by MVMT Printer. DO NOT add bot detection here.
// Routes by ?ta= param to serve different TA campaigns on same domain.

const PAGES = {pages_json};
const DEFAULT_CAMPAIGN = "{default_campaign}";

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    const path = url.pathname;

    // Favicon — return empty
    if (path === "/favicon.ico") {{
      return new Response(null, {{ status: 204 }});
    }}

    // Static asset requests — return 204 (no real assets hosted)
    if (path.match(/\\.(css|js|png|jpg|gif|svg|woff|woff2)$/)) {{
      return new Response(null, {{ status: 204 }});
    }}

    // Route by ?ta= param, fall back to default campaign
    const taId = url.searchParams.get("ta") || DEFAULT_CAMPAIGN;
    const html = PAGES[taId] || PAGES[DEFAULT_CAMPAIGN] || "Not found";

    return new Response(html, {{
      headers: {{
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "no-store",
      }},
    }});
  }},
}};
'''


def _build_worker_script(campaign, safe_html=None, all_domain_campaigns=None):
    """Build the CF Worker JS — multi-campaign safe page server with TA JS per campaign."""
    import json as _json

    campaigns = all_domain_campaigns or [campaign]
    pages = {}
    default_campaign = campaign.ta_campaign_id or ""

    for c in campaigns:
        html = c.safe_page_content or DEFAULT_SAFE_PAGE
        html = ta.inject_ta_code(
            html=html,
            ta_campaign_id=c.ta_campaign_id,
            consent_prompt=bool(c.consent_prompt),
            money_page_url=c.money_page_url,
            ta_integration_code=c.ta_integration_code,
        )
        if c.ta_campaign_id:
            pages[c.ta_campaign_id] = html

    pages_json = _json.dumps(pages)
    # Escape backticks and template literals for JS template string safety
    pages_json = pages_json.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

    return WORKER_TEMPLATE.format(
        pages_json=pages_json,
        default_campaign=default_campaign,
    )


@router.post("/{campaign_id}/generate-worker")
async def generate_worker_script(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate the CF Worker script — static site server with TA JS injected."""
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    return {
        "worker_script": _build_worker_script(campaign),
        "architecture": "Traffic Armor JS handles all cloaking. Worker is static site only.",
        "instructions": (
            "1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker\n"
            "2. Paste this script and deploy\n"
            "3. Add a route for your domain: *.yourdomain.com/* → this worker\n"
            "4. Traffic Armor's injected JS will handle all visitor filtering"
        ),
    }


@router.post("/{campaign_id}/deploy")
async def deploy_safe_page(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Deploy safe page HTML to the Railway PHP cloaker service.

    The PHP service hosts TA's cloaker (bootloader + index.php).
    This endpoint pushes the safe page HTML so filtered visitors see it.
    TA handles all cloaking decisions — PHP just serves the page.
    """
    php_url = settings.TA_PHP_SERVICE_URL
    deploy_key = settings.TA_PHP_DEPLOY_KEY
    if not php_url:
        raise HTTPException(status_code=400, detail="TA_PHP_SERVICE_URL not configured. Set the Railway PHP service URL.")

    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    # Get domain name and TA campaign CLI key
    domain = campaign.domain
    if not domain:
        raise HTTPException(status_code=400, detail="Campaign has no domain linked")
    domain_name = domain.name
    ta_cli_key = campaign.ta_campaign_id
    if not ta_cli_key:
        raise HTTPException(status_code=400, detail="Campaign has no TA campaign ID (CLI key). Create the TA campaign first.")

    # Get safe page HTML
    html = campaign.safe_page_content
    if not html and campaign.safe_page_id:
        sp = db.query(SafePage).filter(SafePage.id == campaign.safe_page_id).first()
        if sp and sp.preview_html:
            html = sp.preview_html
    if not html:
        html = DEFAULT_SAFE_PAGE

    # Push domain→campaign mapping + safe page to Railway PHP service
    import json as json_lib
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{php_url.rstrip('/')}/deploy_safe_page.php",
            headers={
                "X-Deploy-Key": deploy_key or "",
                "Content-Type": "application/json",
            },
            content=json_lib.dumps({
                "domain": domain_name,
                "campaign_id": ta_cli_key,
                "html": html,
            }),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Failed to deploy safe page: {resp.text}")

    campaign.worker_deployed = True
    campaign.worker_route = f"Railway PHP: {domain_name} → {ta_cli_key}"
    db.commit()

    return {
        "success": True,
        "service": "Railway PHP cloaker",
        "domain": domain_name,
        "campaign_id": ta_cli_key,
        "safe_page_bytes": len(html),
        "message": f"Deployed: {domain_name} → campaign {ta_cli_key}",
    }


@router.post("/{campaign_id}/deploy-worker")
async def deploy_worker(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """[LEGACY] Deploy safe page via CF Worker. Use /deploy instead for TA PHP cloaking."""
    cf_token = settings.CLOUDFLARE_API_TOKEN
    if not cf_token:
        raise HTTPException(status_code=400, detail="CLOUDFLARE_API_TOKEN not configured")

    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    domain = db.query(Domain).filter(Domain.id == campaign.domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if not domain.cloudflare_zone_id:
        raise HTTPException(status_code=400, detail=f"Domain {domain.name} has no Cloudflare zone. Add it to Cloudflare first.")

    worker_name = f"safe-{domain.name.replace('.', '-')}"
    # Get ALL active campaigns for this domain so the worker routes by ?ta= param
    all_domain_campaigns = db.query(CloakerCampaign).filter(
        CloakerCampaign.domain_id == campaign.domain_id,
        CloakerCampaign.status == "active",
    ).all()
    script = _build_worker_script(campaign, all_domain_campaigns=all_domain_campaigns)
    import json as _json

    async with httpx.AsyncClient(timeout=60) as client:
        auth_header = {"Authorization": f"Bearer {cf_token}"}

        # Step 1: Get account ID
        acct_resp = await client.get(
            "https://api.cloudflare.com/client/v4/accounts",
            headers=auth_header,
        )
        acct_data = acct_resp.json()
        if not acct_data.get("success") or not acct_data.get("result"):
            raise HTTPException(status_code=502, detail="Failed to get Cloudflare account ID")
        account_id = acct_data["result"][0]["id"]

        # Step 2: Upload worker script as ES module
        metadata = _json.dumps({
            "main_module": "worker.js",
            "compatibility_date": "2024-01-01",
        })
        upload_resp = await client.put(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{worker_name}",
            headers=auth_header,
            files={
                "metadata": ("metadata.json", metadata, "application/json"),
                "worker.js": ("worker.js", script.encode(), "application/javascript+module"),
            },
        )
        upload_data = upload_resp.json()
        if not upload_data.get("success"):
            errors = upload_data.get("errors", [])
            raise HTTPException(status_code=502, detail=f"Failed to upload worker: {errors}")

        # Step 3: Add or update route for the domain
        route_pattern = f"*{domain.name}/*"
        zone_routes_url = f"https://api.cloudflare.com/client/v4/zones/{domain.cloudflare_zone_id}/workers/routes"

        # Try creating new route
        route_resp = await client.post(
            zone_routes_url,
            headers={"Authorization": f"Bearer {cf_token}", "Content-Type": "application/json"},
            json={"pattern": route_pattern, "script": worker_name},
        )
        route_data = route_resp.json()
        if not route_data.get("success"):
            # Route might already exist (pointing to old worker) — find and update it
            list_resp = await client.get(zone_routes_url, headers=auth_header)
            existing = list_resp.json().get("result", [])
            updated = False
            for r in existing:
                if r.get("pattern") == route_pattern:
                    upd = await client.put(
                        f"{zone_routes_url}/{r['id']}",
                        headers={"Authorization": f"Bearer {cf_token}", "Content-Type": "application/json"},
                        json={"pattern": route_pattern, "script": worker_name},
                    )
                    if not upd.json().get("success"):
                        raise HTTPException(status_code=502, detail=f"Failed to update route: {upd.json().get('errors')}")
                    updated = True
                    break
            if not updated:
                raise HTTPException(status_code=502, detail=f"Worker deployed but route failed: {route_data.get('errors')}")

    campaign.worker_deployed = True
    campaign.worker_route = route_pattern
    db.commit()

    ta_status = "TA JS injected" if campaign.ta_campaign_id else "No TA campaign linked — deploy safe page only"

    return {
        "success": True,
        "worker_name": worker_name,
        "route": route_pattern,
        "ta_status": ta_status,
        "consent_prompt": bool(campaign.consent_prompt),
        "message": f"Safe page deployed to {domain.name}. {ta_status}.",
    }


class IntegrationCodeUpdate(BaseModel):
    code: str  # Raw HTML/JS from TA dashboard Integration tab


@router.put("/{campaign_id}/integration-code")
async def set_integration_code(
    campaign_id: str,
    data: IntegrationCodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Save the TA integration code (pasted from TA dashboard). Auto-redeploys worker if deployed."""
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    campaign.ta_integration_code = data.code.strip()
    db.flush()

    # Auto re-deploy worker to inject the new integration code
    redeploy_result = None
    if campaign.worker_deployed:
        try:
            redeploy_result = await _redeploy_worker(campaign, db)
        except Exception as e:
            redeploy_result = f"Re-deploy error: {e}"

    db.commit()
    return {
        "id": campaign.id,
        "ta_integration_code_set": True,
        "code_length": len(campaign.ta_integration_code),
        "redeploy": redeploy_result,
        "message": "Integration code saved. Worker will use this code for cloaking.",
    }


@router.post("/{campaign_id}/toggle-deadbolt")
async def toggle_deadbolt(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Toggle deadbolt mode on Traffic Armor — when ON, ALL traffic sees safe page."""
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    campaign.deadbolt = not campaign.deadbolt
    db.flush()

    # Sync to Traffic Armor (deadbolt is a TA-side setting)
    ta_synced = False
    if campaign.ta_campaign_number and settings.TRAFFIC_ARMOR_API_KEY:
        try:
            domain = db.query(Domain).filter(Domain.id == campaign.domain_id).first()
            rules = campaign.ta_rules or ta.DEFAULT_RULES
            rules_with_deadbolt = {**rules, "deadbolt": campaign.deadbolt}
            form_data = ta.build_ta_form_data_v2(
                name=campaign.name,
                money_page_url=campaign.money_page_url,
                safe_url=f"https://{domain.name}" if domain else "",
                rules=rules_with_deadbolt,
                consent_prompt=bool(campaign.consent_prompt),
            )
            await ta.edit_campaign(campaign.ta_campaign_number, form_data, rules=rules_with_deadbolt)
            ta_synced = True
        except Exception as e:
            logger.warning(f"Failed to sync deadbolt to TA: {e}")

    db.commit()
    return {
        "id": campaign.id,
        "deadbolt": campaign.deadbolt,
        "ta_synced": ta_synced,
        "message": f"Deadbolt {'ON — all traffic sees safe page (testing mode)' if campaign.deadbolt else 'OFF — TA cloaking active'}",
    }


@router.post("/{campaign_id}/toggle-consent-prompt")
async def toggle_consent_prompt(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Toggle consent prompt — cookie modal where allowed visitors click → money page opens."""
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")

    campaign.consent_prompt = not (campaign.consent_prompt or False)
    db.flush()

    # Sync to Traffic Armor — change allowed visitor action
    ta_synced = False
    if campaign.ta_campaign_number and settings.TRAFFIC_ARMOR_API_KEY:
        try:
            domain = db.query(Domain).filter(Domain.id == campaign.domain_id).first()
            form_data = ta.build_ta_form_data_v1(
                name=campaign.name,
                money_page_url=campaign.money_page_url,
                safe_url=f"https://{domain.name}" if domain else "",
                rules=campaign.ta_rules,
                consent_prompt=campaign.consent_prompt,
            )
            await ta.edit_campaign(campaign.ta_campaign_number, form_data, rules=campaign.ta_rules)
            ta_synced = True
        except Exception as e:
            logger.warning(f"Failed to sync consent prompt to TA: {e}")

    # Auto re-deploy worker to inject/remove consent modal HTML
    redeploy_result = None
    if campaign.worker_deployed:
        try:
            redeploy_result = await _redeploy_worker(campaign, db)
        except Exception as e:
            redeploy_result = f"Re-deploy error: {e}"

    db.commit()
    return {
        "id": campaign.id,
        "consent_prompt": campaign.consent_prompt,
        "ta_synced": ta_synced,
        "redeploy": redeploy_result,
        "message": f"Consent prompt {'ON — modal overlay active, clicks open money page' if campaign.consent_prompt else 'OFF — standard TA iframe flow'}",
    }


async def _redeploy_worker(campaign, db):
    """Re-deploy the CF Worker with updated safe page content."""
    cf_token = settings.CLOUDFLARE_API_TOKEN
    if not cf_token:
        return "CLOUDFLARE_API_TOKEN not configured"

    domain = db.query(Domain).filter(Domain.id == campaign.domain_id).first()
    if not domain:
        return "Domain not found"

    worker_name = f"safe-{domain.name.replace('.', '-')}"
    script = _build_worker_script(campaign)
    import json as _json
    metadata = _json.dumps({"main_module": "worker.js", "compatibility_date": "2024-01-01"})

    async with httpx.AsyncClient(timeout=60) as client:
        acct_resp = await client.get(
            "https://api.cloudflare.com/client/v4/accounts",
            headers={"Authorization": f"Bearer {cf_token}"},
        )
        account_id = acct_resp.json()["result"][0]["id"]
        upload_resp = await client.put(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{worker_name}",
            headers={"Authorization": f"Bearer {cf_token}"},
            files={
                "metadata": ("metadata.json", metadata, "application/json"),
                "worker.js": ("worker.js", script.encode(), "application/javascript+module"),
            },
        )
        if upload_resp.json().get("success"):
            return "Worker re-deployed"
        return f"Re-deploy failed: {upload_resp.json().get('errors')}"


@router.get("/{campaign_id}/preview-safe-page")
def preview_safe_page(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return the safe page HTML for preview."""
    from fastapi.responses import HTMLResponse
    campaign = db.query(CloakerCampaign).filter(CloakerCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Cloaker campaign not found")
    html = campaign.safe_page_content or DEFAULT_SAFE_PAGE
    return HTMLResponse(content=html)


DEFAULT_SAFE_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Healthy Living Tips - Natural Wellness Guide</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Georgia, serif; color: #333; background: #fafaf7; line-height: 1.8; }
        header { background: #2d5016; color: white; padding: 20px 0; text-align: center; }
        header h1 { font-size: 28px; margin-bottom: 5px; }
        header p { opacity: 0.85; font-size: 14px; }
        .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
        article { background: white; border-radius: 8px; padding: 30px; margin-bottom: 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        article h2 { color: #2d5016; font-size: 22px; margin-bottom: 15px; }
        article p { margin-bottom: 15px; font-size: 16px; }
        .meta { color: #888; font-size: 13px; margin-bottom: 20px; }
        footer { text-align: center; padding: 30px; color: #999; font-size: 13px; }
        img { max-width: 100%; border-radius: 8px; margin: 15px 0; }
    </style>
</head>
<body>
    <header>
        <h1>Healthy Living Tips</h1>
        <p>Your guide to natural wellness and balanced living</p>
    </header>
    <div class="container">
        <article>
            <h2>5 Morning Habits That Can Transform Your Day</h2>
            <div class="meta">Published: March 2026 &bull; 4 min read</div>
            <p>Starting your morning with intention can set the tone for your entire day. Research shows that people who follow a consistent morning routine report higher levels of productivity and well-being.</p>
            <p><strong>1. Hydrate First Thing</strong> — Before reaching for coffee, drink a full glass of water. After 7-8 hours of sleep, your body is naturally dehydrated. Water helps kickstart your metabolism and flush out toxins.</p>
            <p><strong>2. Move Your Body</strong> — Even 10 minutes of gentle stretching or a short walk can boost circulation and energy levels. You do not need an intense gym session to reap the benefits of morning movement.</p>
            <p><strong>3. Practice Gratitude</strong> — Take a moment to think about three things you are grateful for. Studies from Harvard Medical School show gratitude practice can improve both mental and physical health.</p>
            <p><strong>4. Eat a Balanced Breakfast</strong> — Include protein, healthy fats, and fiber in your first meal. This combination helps maintain steady blood sugar levels throughout the morning.</p>
            <p><strong>5. Limit Screen Time</strong> — Try to avoid checking emails or social media for the first 30 minutes after waking. This allows your brain to ease into the day without the stress of external demands.</p>
        </article>
        <article>
            <h2>Understanding the Benefits of Green Tea</h2>
            <div class="meta">Published: February 2026 &bull; 3 min read</div>
            <p>Green tea has been consumed for centuries in Asian cultures, valued for its subtle flavor and numerous health properties. Modern science continues to validate many of these traditional beliefs.</p>
            <p>Rich in antioxidants called catechins, green tea may support heart health and help maintain healthy cholesterol levels. The moderate caffeine content provides a gentle energy boost without the jitters often associated with coffee.</p>
            <p>For those looking to incorporate green tea into their routine, experts suggest 2-3 cups per day. Brewing at around 175 degrees Fahrenheit for 2-3 minutes produces the best flavor without excessive bitterness.</p>
        </article>
        <article>
            <h2>The Importance of Quality Sleep</h2>
            <div class="meta">Published: January 2026 &bull; 3 min read</div>
            <p>Sleep is one of the most important factors in overall health, yet it is often overlooked. Adults need 7-9 hours of quality sleep per night for optimal functioning.</p>
            <p>Creating a consistent sleep schedule, keeping your bedroom cool and dark, and avoiding screens before bed are all evidence-based strategies for improving sleep quality. Small changes to your evening routine can make a significant difference.</p>
        </article>
    </div>
    <footer>
        &copy; 2026 Healthy Living Tips. All information is for educational purposes only. Consult your healthcare provider before making changes to your health routine.
    </footer>
</body>
</html>"""
