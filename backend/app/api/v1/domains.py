"""
Domains API — domain registration (Namecheap) + DNS management (Cloudflare).
"""
import json
import logging
import os
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, List
from app.database import get_db
from app.models import Domain, DomainDnsRecord, HostingAccount, User
from app.core.deps import get_current_active_user
from app.core.config import settings
from app.core.encryption import decrypt_value
from app.services.domain_service import DomainService
from app.services.cpanel_service import add_addon_domain as cpanel_add_addon
from app.services.assignment_sync import sync_from_domain

logger = logging.getLogger(__name__)
router = APIRouter()

_service = DomainService()


# ── Schemas ──────────────────────────────────────────

class DomainCheckRequest(BaseModel):
    domain: str

class DomainRegisterRequest(BaseModel):
    domain: str
    brand_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    notes: Optional[str] = None
    # Registrant contact (defaults provided for convenience)
    first_name: str = "Domain"
    last_name: str = "Admin"
    address: str = "123 Main St"
    city: str = "Miami"
    state: str = "FL"
    postal_code: str = "33101"
    country: str = "US"
    phone: str = "+1.5551234567"
    email: str = "roly@digitalmvmt.com"

class DomainUpdateRequest(BaseModel):
    brand_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    hosting_account_id: Optional[str] = None
    notes: Optional[str] = None

class DnsRecordRequest(BaseModel):
    record_type: str  # A, CNAME, TXT, MX
    name: str
    value: str
    proxied: bool = False  # DNS-only — CF proxy causes IP mismatch with TA

class DomainSuggestRequest(BaseModel):
    niche: str = "general"  # health, finance, lifestyle, general


# ── AI Domain Suggestions ────────────────────────────

@router.post("/suggest")
def suggest_domains(
    body: DomainSuggestRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Generate AI-powered domain name suggestions, filtered to available .com only."""
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    niche_desc = {
        "health": "health, wellness, detox, supplements, skincare, weight loss, natural remedies",
        "finance": "personal finance, investing, credit repair, money saving, insurance, loans",
        "lifestyle": "home improvement, travel, fashion, beauty, self-care, relationships",
        "general": "mixed affiliate marketing niches — health, finance, lifestyle, tech, self-improvement",
    }.get(body.niche, "mixed affiliate marketing niches")

    import random
    style_pool = [
        "compound words (e.g. brightpathwellness.com)",
        "invented brandable words (e.g. voritex.com, zelphi.com)",
        "short punchy names (e.g. nutravibe.com)",
        "editorial/magazine style (e.g. thedailydetox.com)",
        "advisor/authority style (e.g. smartchoiceadvisor.com)",
        "nature-inspired (e.g. willowrootlabs.com)",
        "modern/techy (e.g. pulselogic.com)",
        "friendly/approachable (e.g. heyglowup.com)",
    ]
    styles = random.sample(style_pool, 4)
    style_hint = ", ".join(styles)

    prompt = f"""Generate 25 unique, creative, brandable .com domain names for affiliate marketing websites.

Niche focus: {niche_desc}

Requirements:
- Blog sites, review sites, advisor sites, article/editorial sites
- Short and memorable (6-16 characters before .com)
- No hyphens, no numbers
- Must sound like a real website name — professional, trustworthy
- Include .com extension in each name
- Be HIGHLY creative and diverse — avoid generic patterns like "[word]hub.com" or "[word]daily.com"
- Prioritize these styles: {style_hint}
- Every name must be completely different from the others — no shared roots or prefixes

Return ONLY a JSON array of strings, nothing else. Example: ["brightpathwellness.com", "zelphi.com"]"""

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            temperature=1.0,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        # Parse JSON array from response
        fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", raw, re.DOTALL)
        if fence_match:
            raw = fence_match.group(1).strip()
        names = json.loads(raw)

        if not isinstance(names, list):
            raise ValueError("Expected JSON array")

        # Normalize: lowercase, ensure .com, strip whitespace
        names = [n.strip().lower() for n in names if isinstance(n, str)]
        names = [n if n.endswith(".com") else n + ".com" for n in names]
        # Remove any with hyphens or numbers that slipped through
        names = [n for n in names if not re.search(r"[-0-9]", n.replace(".com", ""))]

    except (json.JSONDecodeError, ValueError, KeyError) as e:
        logger.error(f"Failed to parse AI domain suggestions: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate suggestions")
    except Exception as e:
        logger.error(f"AI domain suggestion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Batch check availability via Namecheap
    available = []
    try:
        nc = _service._get_namecheap()
        result = nc.domains_check(names)
        available = [name for name in names if result.get(name, False)]
    except Exception as e:
        logger.error(f"Namecheap batch check failed: {e}")
        # If Namecheap not configured, return names unchecked with a flag
        return {"suggestions": names, "availability_checked": False}

    return {"suggestions": available, "availability_checked": True}


# ── List / Get ───────────────────────────────────────

@router.get("")
def list_domains(
    brand_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all domains, optionally filtered by brand or status."""
    q = db.query(Domain).order_by(Domain.created_at.desc())
    if brand_id:
        q = q.filter(Domain.brand_id == brand_id)
    if status:
        q = q.filter(Domain.status == status)
    domains = q.all()
    return [_domain_to_dict(d) for d in domains]


@router.get("/{domain_id}")
def get_domain(
    domain_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a single domain with its DNS records."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    result = _domain_to_dict(domain)
    result["dns_records"] = [
        {
            "id": r.id,
            "record_type": r.record_type,
            "name": r.name,
            "value": r.value,
            "proxied": r.proxied,
            "cf_record_id": r.cf_record_id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in domain.dns_records
    ]
    return result


# ── Check Availability ───────────────────────────────

@router.post("/check")
def check_domain(
    body: DomainCheckRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Check if a domain is available for registration."""
    return _service.check_availability(body.domain)


# ── Register + Auto-Setup ────────────────────────────

@router.post("/register")
def register_domain(
    body: DomainRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Register a domain on Namecheap and auto-setup Cloudflare DNS."""
    # Check if already in DB
    existing = db.query(Domain).filter(Domain.name == body.domain).first()
    if existing:
        raise HTTPException(status_code=409, detail="Domain already exists in system")

    # Create DB record first (pending)
    domain = Domain(
        name=body.domain,
        brand_id=body.brand_id,
        ad_account_id=body.ad_account_id,
        notes=body.notes,
        status="pending",
    )
    db.add(domain)
    db.commit()
    db.refresh(domain)

    # Step 1: Register on Namecheap
    reg_result = _service.register_domain(
        domain_name=body.domain,
        first_name=body.first_name,
        last_name=body.last_name,
        address=body.address,
        city=body.city,
        state=body.state,
        postal_code=body.postal_code,
        country=body.country,
        phone=body.phone,
        email=body.email,
    )

    if not reg_result.get("success"):
        domain.status = "failed"
        db.commit()
        return {
            "domain_id": domain.id,
            "status": "failed",
            "step": "registration",
            "message": reg_result.get("message", "Registration failed"),
        }

    domain.status = "registered"
    domain.namecheap_order_id = str(reg_result.get("result", ""))
    db.commit()

    # Step 2: Full DNS setup (CF zone + NS + CNAME)
    setup_result = _service.full_setup(body.domain)

    if setup_result.get("success"):
        domain.status = "active"
        domain.cloudflare_zone_id = setup_result.get("zone_id")
        domain.cloudflare_nameservers = setup_result.get("nameservers")
        domain.dns_configured = True
    else:
        domain.status = "registered"  # registered but DNS failed
        domain.cloudflare_zone_id = setup_result.get("zone_id")
        domain.cloudflare_nameservers = setup_result.get("nameservers")

    db.commit()

    # Step 3: Auto-add to cPanel hosting + DNS A record
    cpanel_result = None
    hosting = db.query(HostingAccount).filter(
        HostingAccount.cpanel_host.isnot(None),
        HostingAccount.cpanel_username.isnot(None),
        HostingAccount.cpanel_api_token.isnot(None),
    ).first()

    if hosting:
        try:
            token = decrypt_value(hosting.cpanel_api_token)
            cpanel_result = cpanel_add_addon(
                cpanel_host=hosting.cpanel_host,
                cpanel_username=hosting.cpanel_username,
                cpanel_token=token,
                domain_name=body.domain,
                base_path=hosting.base_path,
            )
            if cpanel_result.get("success"):
                domain.hosting_account_id = hosting.id
                logger.info("Auto-added %s to cPanel hosting %s", body.domain, hosting.name)
            else:
                logger.warning("cPanel auto-add failed for %s: %s", body.domain, cpanel_result.get("message"))
        except Exception as e:
            logger.warning("cPanel auto-add failed for %s: %s", body.domain, e)
            cpanel_result = {"success": False, "message": str(e)}

        # Add A record pointing to hosting IP if we have a CF zone
        if domain.cloudflare_zone_id:
            try:
                # Get hosting server IP from the hosting account's FTP host
                import socket
                hosting_ip = socket.gethostbyname(hosting.ftp_host)
                a_result = _service.create_dns_record(
                    zone_id=domain.cloudflare_zone_id,
                    record_type="A",
                    name=body.domain,
                    content=hosting_ip,
                    proxied=False,
                )
                if a_result.get("success"):
                    logger.info("Added A record for %s -> %s", body.domain, hosting_ip)
                    # Save DNS record
                    record = DomainDnsRecord(
                        domain_id=domain.id,
                        record_type="A",
                        name=body.domain,
                        value=hosting_ip,
                        proxied=False,
                        cf_record_id=a_result.get("cf_record_id"),
                    )
                    db.add(record)
            except Exception as e:
                logger.warning("DNS A record auto-add failed for %s: %s", body.domain, e)

    db.commit()
    db.refresh(domain)

    return {
        "domain_id": domain.id,
        "status": domain.status,
        "dns_configured": domain.dns_configured,
        "hosting_added": bool(cpanel_result and cpanel_result.get("success")),
        "hosting_account_id": domain.hosting_account_id,
        "setup_steps": setup_result.get("steps", {}),
        "nameservers": domain.cloudflare_nameservers,
    }


# ── Update ───────────────────────────────────────────

@router.put("/{domain_id}")
def update_domain(
    domain_id: str,
    body: DomainUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a domain's brand, account, or notes."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    if body.brand_id is not None:
        domain.brand_id = body.brand_id or None
    if body.ad_account_id is not None:
        new_acct = body.ad_account_id or None
        if new_acct:
            conflict = db.query(Domain).filter(
                Domain.ad_account_id == new_acct,
                Domain.id != domain_id,
            ).first()
            if conflict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Ad account {new_acct} is already assigned to domain '{conflict.name}'. One ad account per domain.",
                )
        domain.ad_account_id = new_acct
    if body.hosting_account_id is not None:
        domain.hosting_account_id = body.hosting_account_id or None
    if body.notes is not None:
        domain.notes = body.notes or None

    db.commit()
    db.refresh(domain)

    # Sync assignments to linked TrackedPage and Persona
    sync_from_domain(domain, db)
    db.commit()

    return _domain_to_dict(domain)


# ── Delete ───────────────────────────────────────────

@router.delete("/{domain_id}")
def delete_domain(
    domain_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a domain record (does NOT cancel the Namecheap registration)."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    db.delete(domain)
    db.commit()
    return {"status": "deleted", "domain": domain.name}


# ── DNS Record Management ────────────────────────────

@router.post("/{domain_id}/dns")
def add_dns_record(
    domain_id: str,
    body: DnsRecordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Add a custom DNS record to Cloudflare for this domain."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if not domain.cloudflare_zone_id:
        raise HTTPException(status_code=400, detail="Domain has no Cloudflare zone — run setup first")

    result = _service.create_dns_record(
        zone_id=domain.cloudflare_zone_id,
        record_type=body.record_type,
        name=body.name,
        content=body.value,
        proxied=body.proxied,
    )

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("message", "Failed to create DNS record"))

    record = DomainDnsRecord(
        domain_id=domain.id,
        record_type=body.record_type,
        name=body.name,
        value=body.value,
        proxied=body.proxied,
        cf_record_id=result.get("cf_record_id"),
    )
    db.add(record)
    db.commit()

    return {
        "id": record.id,
        "record_type": record.record_type,
        "name": record.name,
        "value": record.value,
        "proxied": record.proxied,
        "cf_record_id": record.cf_record_id,
    }


@router.delete("/{domain_id}/dns/{record_id}")
def remove_dns_record(
    domain_id: str,
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Remove a DNS record from Cloudflare and the database."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    record = db.query(DomainDnsRecord).filter(
        DomainDnsRecord.id == record_id,
        DomainDnsRecord.domain_id == domain_id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="DNS record not found")

    # Delete from Cloudflare
    if record.cf_record_id and domain.cloudflare_zone_id:
        _service.delete_dns_record(domain.cloudflare_zone_id, record.cf_record_id)

    db.delete(record)
    db.commit()
    return {"status": "deleted"}


# ── Retry Setup ──────────────────────────────────────

@router.post("/{domain_id}/retry-setup")
def retry_setup(
    domain_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Retry the Cloudflare DNS setup for a domain that failed."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    setup_result = _service.full_setup(domain.name)

    if setup_result.get("success"):
        domain.status = "active"
        domain.cloudflare_zone_id = setup_result.get("zone_id")
        domain.cloudflare_nameservers = setup_result.get("nameservers")
        domain.dns_configured = True
    else:
        domain.cloudflare_zone_id = setup_result.get("zone_id")
        domain.cloudflare_nameservers = setup_result.get("nameservers")

    db.commit()
    db.refresh(domain)

    return {
        "domain_id": domain.id,
        "status": domain.status,
        "dns_configured": domain.dns_configured,
        "setup_steps": setup_result.get("steps", {}),
    }


# ── Add to Hosting (one-click) ────────────────────────

@router.post("/{domain_id}/add-to-hosting")
def add_domain_to_hosting(
    domain_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """One-click: add domain to cPanel hosting + create A record."""
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    hosting = db.query(HostingAccount).filter(
        HostingAccount.cpanel_host.isnot(None),
        HostingAccount.cpanel_username.isnot(None),
        HostingAccount.cpanel_api_token.isnot(None),
    ).first()
    if not hosting:
        raise HTTPException(status_code=400, detail="No cPanel-configured hosting account found")

    # Add addon domain to cPanel
    token = decrypt_value(hosting.cpanel_api_token)
    cpanel_result = cpanel_add_addon(
        cpanel_host=hosting.cpanel_host,
        cpanel_username=hosting.cpanel_username,
        cpanel_token=token,
        domain_name=domain.name,
        base_path=hosting.base_path,
    )

    already_exists = False
    if not cpanel_result.get("success"):
        msg = cpanel_result.get("message", "")
        # If domain already exists on cPanel, still link it
        if "already" in msg.lower() or "exists" in msg.lower():
            already_exists = True
        else:
            return {"success": False, "message": msg or "cPanel add failed"}

    domain.hosting_account_id = hosting.id

    # Upload TA index.php to /track/index.php
    ta_php_uploaded = False
    try:
        ta_php_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
            "traffic-armor", "js_track.php"
        )
        if os.path.exists(ta_php_path):
            with open(ta_php_path, "r") as f:
                ta_php_content = f.read()

            auth_header = f"cpanel {hosting.cpanel_username}:{token}"
            base_url = f"https://{hosting.cpanel_host}:2083"
            doc_root = f"/home/{hosting.cpanel_username}/public_html/{domain.name}"

            import httpx as _httpx
            with _httpx.Client(verify=False, timeout=30) as client:
                # Create /track/ directory
                client.get(
                    f"{base_url}/json-api/cpanel",
                    params={
                        "cpanel_jsonapi_user": hosting.cpanel_username,
                        "cpanel_jsonapi_apiversion": "2",
                        "cpanel_jsonapi_module": "Fileman",
                        "cpanel_jsonapi_func": "mkdir",
                        "path": doc_root,
                        "name": "track",
                    },
                    headers={"Authorization": auth_header},
                )
                # Upload index.php
                resp = client.post(
                    f"{base_url}/execute/Fileman/save_file_content",
                    headers={"Authorization": auth_header},
                    data={"dir": f"{doc_root}/track", "file": "index.php", "content": ta_php_content},
                )
                if resp.json().get("status") == 1:
                    ta_php_uploaded = True

                # Upload .htaccess to domain root for /track/{id} and /imp/{id}.js rewriting
                # TA's JS callback uses /imp/{campaignId}.js for the fingerprint callback
                htaccess = (
                    "RewriteEngine On\n"
                    "RewriteRule ^track/([a-zA-Z0-9]+)$ /track/index.php?c=$1 [L,QSA]\n"
                    "RewriteRule ^imp/([a-zA-Z0-9]+)\\.js$ /track/index.php?c=$1 [L,QSA]\n"
                )
                client.post(
                    f"{base_url}/execute/Fileman/save_file_content",
                    headers={"Authorization": auth_header},
                    data={"dir": doc_root, "file": ".htaccess", "content": htaccess},
                )
    except Exception as e:
        logger.warning("TA PHP upload failed for %s: %s", domain.name, e)

    # Add A record pointing to hosting IP
    a_record_added = False
    if domain.cloudflare_zone_id:
        try:
            import socket
            hosting_ip = socket.gethostbyname(hosting.ftp_host)
            a_result = _service.create_dns_record(
                zone_id=domain.cloudflare_zone_id,
                record_type="A",
                name=domain.name,
                content=hosting_ip,
                proxied=False,  # DNS-only — CF proxy causes IP mismatch with TA
            )
            if a_result.get("success"):
                record = DomainDnsRecord(
                    domain_id=domain.id,
                    record_type="A",
                    name=domain.name,
                    value=hosting_ip,
                    proxied=False,
                    cf_record_id=a_result.get("cf_record_id"),
                )
                db.add(record)
                a_record_added = True
        except Exception as e:
            logger.warning("DNS A record failed for %s: %s", domain.name, e)

    db.commit()
    db.refresh(domain)

    return {
        "success": True,
        "message": f"Added {domain.name} to hosting",
        "hosting_account_id": hosting.id,
        "a_record_added": a_record_added,
        "ta_php_uploaded": ta_php_uploaded,
    }


# ── Helpers ──────────────────────────────────────────

def _domain_to_dict(d: Domain) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "brand_id": d.brand_id,
        "ad_account_id": d.ad_account_id,
        "registrar": d.registrar,
        "status": d.status,
        "namecheap_order_id": d.namecheap_order_id,
        "cloudflare_zone_id": d.cloudflare_zone_id,
        "cloudflare_nameservers": d.cloudflare_nameservers,
        "dns_configured": d.dns_configured,
        "expires_at": d.expires_at.isoformat() if d.expires_at else None,
        "hosting_account_id": d.hosting_account_id if hasattr(d, 'hosting_account_id') else None,
        "notes": d.notes,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }
