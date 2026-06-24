import logging
import random
import uuid
import json
import re
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import threading
from app.services.facebook_service import FacebookService
from app.services.fb_cache import cached_or_fetch
from app.services.pacing import compute_sleep_for_index
from facebook_business.exceptions import FacebookRequestError
from datetime import datetime, timedelta
import pytz
from app.models import FacebookAd, FacebookAdSet, FacebookCampaign, FacebookConnection, PublishBatch, User, ScheduledBudgetChange, AutoSafeLog, DaypartSchedule, BudgetSurfConfig, BudgetSurfLog, BidSchedule, BidSchedulePreset, account_brands, Product as ProductModel
from app.database import get_db, SessionLocal
from app.core.deps import get_current_active_user, require_permission
from app.core.config import settings
from sqlalchemy.orm import Session
from sqlalchemy import delete, insert

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Safe Conversion Campaign Constants ───────────────────────────────────────

SAFE_NICHE_IMAGE_PROMPTS = {
    "foot_care": [
        "Close-up of woman relaxing bare feet on soft towel after spa pedicure, warm bathroom lighting, product photography",
        "Elderly person comfortably walking barefoot on grass in morning sunlight, foot wellness, lifestyle photography",
        "Hands applying natural cream to feet, clean white background, skincare product commercial style",
        "Comfortable orthopedic shoes on wooden shelf next to green plant, product lifestyle shot, soft lighting",
        "Feet soaking in warm herbal foot bath with flower petals, relaxation spa concept, overhead shot",
        "Close-up of healthy feet stepping on smooth river stones, reflexology path, outdoor natural light",
        "Woman sitting on bed massaging her foot with oil, cozy bedroom setting, soft warm tones",
        "Display of natural foot care products on marble countertop, clean minimal product photography",
    ],
    "weight_loss": [
        "Colorful meal prep containers with balanced portions of protein, vegetables, and grains, overhead food photography",
        "Fresh green smoothie next to dumbbells on kitchen counter, health lifestyle flat lay",
        "Healthy breakfast bowl with avocado, eggs, and vegetables on white plate, food photography",
        "Group fitness class doing light exercises in bright modern studio, wellness community, candid shot",
        "Person jogging on scenic trail at sunrise, active lifestyle, warm golden light photography",
        "Yoga mat with water bottle and fresh fruit on wooden floor, morning workout setup, bright natural light",
        "Couple cooking healthy meal together in modern kitchen, lifestyle photography, warm tones",
        "Fresh salad ingredients arranged on cutting board, meal preparation, bright overhead food photography",
    ],
    "skincare": [
        "Close-up of woman with clear glowing skin applying serum, beauty product photography, studio lighting",
        "Elegant skincare bottles arranged on marble surface with green leaf accents, product flat lay",
        "Woman looking in bathroom mirror touching her face smiling, morning skincare routine, soft lighting",
        "Natural skincare ingredients - aloe vera, honey, coconut oil - arranged on wooden board, ingredient photography",
        "Dermatologist examining skin with magnifying light, professional skincare consultation, clinical setting",
        "Close-up of hand applying moisturizer cream, clean minimal background, beauty commercial style",
        "Shelf display of premium skincare products with botanical elements, retail product photography",
        "Woman with towel on head applying face mask, self-care night routine, warm cozy bathroom lighting",
    ],
    "supplements": [
        "Premium supplement bottles arranged on clean white surface with fresh herbs, product photography",
        "Person opening supplement bottle at kitchen table with healthy breakfast, morning routine lifestyle",
        "Close-up of natural capsules spilling from amber glass bottle, pharmaceutical product photography",
        "Wooden spoon with various supplement powder next to fresh ingredients, natural health product shot",
        "Doctor in white coat holding supplement bottle, professional healthcare setting, clean background",
        "Supplement bottles next to fresh fruits and vegetables, healthy lifestyle flat lay, bright lighting",
        "Person reading supplement label in modern pharmacy, informed consumer, natural daylight",
        "Arrangement of vitamins, minerals, and herbal supplements on wooden tray, wellness product display",
    ],
    "hair_care": [
        "Woman with thick shiny hair flowing in natural wind, beauty photography, golden hour backlight",
        "Close-up of hands applying hair oil treatment, salon-quality hair care, studio lighting",
        "Premium hair care product bottles on bathroom shelf, product lifestyle photography, soft focus",
        "Before and after hair styling comparison, salon transformation, professional photography",
        "Natural hair care ingredients - argan oil, coconut, rosemary - on marble surface, flat lay",
        "Man examining his healthy hair in mirror, grooming routine, modern bathroom, natural light",
        "Hairstylist applying treatment in bright modern salon, professional hair care, candid shot",
        "Assortment of hair brushes and natural products on wooden vanity, styling essentials flat lay",
    ],
    "cbd_wellness": [
        "Premium CBD oil dropper bottle on natural wood surface with hemp leaves, product photography",
        "Person adding CBD drops to morning tea in sunny kitchen, wellness routine, lifestyle shot",
        "Elegant CBD product line displayed on marble shelf, premium brand photography, soft lighting",
        "Close-up of hemp plant leaves in natural sunlight, botanical photography, green tones",
        "CBD wellness products arranged with candles and crystals, self-care flat lay, warm tones",
        "Person relaxing on couch with CBD product on side table, evening routine, cozy interior lighting",
        "Lab technician examining CBD extract in modern facility, quality testing, professional setting",
        "Natural CBD balm jar open on wooden table with lavender sprigs, topical product photography",
    ],
    "dental_care": [
        "Bright confident smile close-up, dental health concept, studio portrait photography",
        "Premium toothpaste and mouthwash products on bathroom counter, oral care product display",
        "Person flossing teeth in modern bathroom mirror, dental hygiene routine, clean bright lighting",
        "Dentist office with modern equipment, professional dental care, clean clinical setting",
        "Electric toothbrush next to natural toothpaste on marble surface, oral care product flat lay",
        "Family brushing teeth together in bathroom, dental health lifestyle, warm natural lighting",
        "Close-up of white teeth biting into green apple, dental health concept, studio photography",
        "Dental care products arranged with mint leaves on white background, fresh clean product photography",
    ],
    "telehealth": [
        "Person having video consultation with doctor on laptop in living room, telehealth lifestyle, natural light",
        "Doctor smiling on tablet screen, online medical consultation, clean modern interface",
        "Patient sitting comfortably at home desk during virtual appointment, remote healthcare, warm lighting",
        "Smartphone showing telehealth app interface on kitchen table with coffee, modern healthcare lifestyle",
        "Professional doctor in white coat at computer, virtual consultation from office, clinical setting",
        "Couple reviewing health information on tablet together on couch, health-conscious lifestyle",
        "Modern telemedicine setup with laptop, stethoscope, and notepad, healthcare technology flat lay",
        "Person checking health app on phone while relaxing at home, digital wellness, casual lifestyle",
    ],
    "general_wellness": [
        "Happy diverse group of friends enjoying outdoor picnic in sunny park, lifestyle photography, warm lighting",
        "Woman doing morning yoga in bright modern living room, wellness lifestyle, soft natural light",
        "Fresh colorful fruits and vegetables on rustic wooden table, healthy eating concept, food photography",
        "Senior couple walking on sandy beach at golden hour, active retirement lifestyle, warm tones",
        "Person meditating in garden surrounded by green plants, mindfulness concept, soft morning light",
        "Group of seniors doing stretching exercises in park, active aging lifestyle, bright outdoor lighting",
        "Woman stretching at sunrise on wooden deck overlooking nature, wellness routine, golden hour",
        "Person walking golden retriever on scenic lakeside path at sunrise, active morning routine",
    ],
}

SAFE_NICHE_LABELS = {
    "foot_care": "Foot Care / Neuropathy",
    "weight_loss": "Weight Loss / Fitness",
    "skincare": "Skincare / Anti-Aging",
    "supplements": "Supplements / Vitamins",
    "hair_care": "Hair Care / Hair Growth",
    "cbd_wellness": "CBD / Hemp Wellness",
    "dental_care": "Dental / Oral Care",
    "telehealth": "Telehealth / Online Doctor",
    "general_wellness": "General Wellness / Lifestyle",
}

SAFE_COPY_SYSTEM_PROMPT = """You are writing ultra-safe, policy-compliant Facebook ad copy for a {niche_label} brand.
Your copy MUST pass Facebook's ad review with zero issues.
The ads should look like REAL product ads that a legitimate brand would run — not generic filler.

ABSOLUTE RULES:
- NO health claims whatsoever (no "cure", "treat", "fix", "heal", "eliminate", "reverse")
- NO before/after implications or transformation promises
- NO urgency tactics ("limited time", "act now", "hurry", "ending soon")
- NO income or financial claims
- NO personal attributes callouts ("your pain", "your weight", "your condition")
- NO superlatives ("best", "fastest", "#1", "most effective")
- NO scientific or medical claims ("clinically proven", "doctor approved", "studies show")
- NO emotional manipulation or fear-based language
- NO power words ("revolutionary", "breakthrough", "secret", "miracle", "shocking")
- NO emojis
- NO exclamation marks
- NO ALL CAPS words
- CTA must be LEARN_MORE (softest possible)

NICHE: {niche_label}
TONE: Professional, informative, trustworthy — like a real DTC brand ad. Not generic fluff.
Write copy that sounds like it's from a real company selling real products in this niche.
Reference the product category naturally. Use conversational language appropriate for the niche audience.

Return ONLY valid JSON (no markdown, no code fences):
{{
  "variations": [
    {{
      "headline": "Short product-relevant headline under 40 chars",
      "body": "2-3 sentences that sound like a real product ad. Reference the product category naturally. Informative, trustworthy, no claims.",
      "description": "One sentence link description"
    }}
  ]
}}

Generate {num_ads} variations. Each must be completely different but sound like real ads from different angles.
Website: {website_url}"""


class SafeCampaignRequest(BaseModel):
    ad_account_id: str
    page_id: str
    pixel_id: str
    niche: str = "general_wellness"
    conversion_event: str = "PURCHASE"
    daily_budget: float = 20.0
    num_ads: int = 5
    website_url: str
    campaign_name: Optional[str] = None
    connection_id: Optional[str] = None

def get_facebook_service(
    connection_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    if connection_id:
        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == connection_id,
            FacebookConnection.is_active == True
        ).first()
        if not conn:
            raise HTTPException(status_code=404, detail="Facebook connection not found")
        service = FacebookService(connection=conn)
    else:
        # Check for default connection in DB
        default_conn = db.query(FacebookConnection).filter(
            FacebookConnection.is_default == True,
            FacebookConnection.is_active == True
        ).first()
        if default_conn:
            service = FacebookService(connection=default_conn)
        else:
            service = FacebookService()

    try:
        if not service.api:
            service.initialize()
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")
    return service

_accounts_cache = {}  # key: connection_id → (result, timestamp)
_pages_cache = {}     # key: connection_id → (result, timestamp)
_page_info_cache = {} # key: page_id → (result, timestamp)
_adsets_cache = {}    # key: (connection_id, campaign_id, ad_account_id) → (result, timestamp)
_API_CACHE_TTL = 300  # 5 minutes for all FB API caches
_ADSETS_CACHE_TTL = 60  # 1 minute — adsets change infrequently within a session


def _fb_http_error(e: FacebookRequestError, default_status: int = 500) -> HTTPException:
    """Map a FacebookRequestError to a meaningful HTTPException.

    Rate limits (17/32/4/613) → 429 with Retry-After so the frontend can show
    a clear toast and the user knows to wait rather than seeing opaque 500/400.
    Token errors (190) → 401. Everything else uses default_status — read paths
    pass 500, write paths pass 400 so validation-style FB errors surface as
    bad-request with the FB user_msg attached.
    """
    code = e.api_error_code()
    msg = e.api_error_message() or "Facebook API error"
    if code in (17, 32, 4, 613):
        return HTTPException(
            status_code=429,
            detail=f"Facebook rate limit reached: {msg}. Please wait a few minutes and try again.",
            headers={"Retry-After": "300"},
        )
    if code == 190:
        return HTTPException(status_code=401, detail=f"Facebook token error: {msg}")
    # Append FB's user-friendly message when present (useful on write paths).
    body = e.body() if callable(getattr(e, 'body', None)) else {}
    err = body.get('error', {}) if isinstance(body, dict) else {}
    user_msg = err.get('error_user_msg', '') if isinstance(err, dict) else ''
    detail = msg + (f" | {user_msg}" if user_msg else "")
    prefix = "Facebook API error: " if default_status >= 500 else ""
    return HTTPException(status_code=default_status, detail=f"{prefix}{detail}")


@router.get("/accounts")
def get_ad_accounts(
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    import time as _time
    cache_key = getattr(service, '_connection_id', 'default')
    cached = _accounts_cache.get(cache_key)
    if cached:
        result, ts = cached
        if _time.time() - ts < _API_CACHE_TTL:
            return result
    try:
        result = service.get_ad_accounts()
        _accounts_cache[cache_key] = (result, _time.time())
        return result
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/campaigns")
def read_campaigns(
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    cache_key = f"campaigns:{getattr(service, '_connection_id', 'default')}:{ad_account_id or '_'}"
    try:
        result, _src = cached_or_fetch(
            cache_key,
            lambda: [dict(c) for c in service.get_campaigns(ad_account_id)],
            fresh_ttl_seconds=30,
            ad_account_id=ad_account_id,
        )
        return result
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/campaigns")
def create_campaign(
    campaign: Dict[str, Any],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        # Check if ad_account_id is in query or body (body takes precedence if we structured it that way, but here we use query or separate param)
        # For POST, usually better to have it in the body or query. Let's support query for consistency with GET
        result = service.create_campaign(campaign, ad_account_id)
        return dict(result)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

_audiences_cache = {}  # key: ad_account_id → (result, timestamp)
_AUDIENCES_TTL = 3600  # 1 hour


@router.get("/audiences")
def get_audiences(
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get custom audiences and lookalikes for an ad account. Cached 1 hour."""
    import time as _time
    cached = _audiences_cache.get(ad_account_id)
    if cached:
        result, ts = cached
        if _time.time() - ts < _AUDIENCES_TTL:
            return result
    try:
        audiences = service.get_custom_audiences(ad_account_id)
        result = [
            {
                'id': a.get('id'),
                'name': a.get('name'),
                'subtype': a.get('subtype'),  # CUSTOM, LOOKALIKE, etc.
                'approximate_count': a.get('approximate_count_lower_bound'),
                'delivery_status': a.get('delivery_status'),
            }
            for a in audiences
        ]
        _audiences_cache[ad_account_id] = (result, _time.time())
        return result
    except Exception as e:
        # Return cached if available on error
        if cached:
            logger.warning(f"FB API failed for audiences, serving stale cache: {e}")
            return cached[0]
        logger.exception("Facebook API error fetching audiences")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")


@router.get("/pixels")
def read_pixels(
    ad_account_id: Optional[str] = None,
    force_refresh: bool = False,
    service: FacebookService = Depends(get_facebook_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get pixels — served from DB cache, refreshed from FB API once per day."""
    from datetime import datetime, timedelta, timezone
    from app.models import CachedPixel

    acct_id = (ad_account_id or '').replace('act_', '')

    # Check DB cache
    if not force_refresh:
        cached = db.query(CachedPixel).filter(CachedPixel.ad_account_id == acct_id).all()
        if cached:
            oldest = min(c.synced_at for c in cached)
            if oldest and oldest > datetime.now(timezone.utc) - timedelta(hours=24):
                return [{"id": c.fb_pixel_id, "name": c.name} for c in cached]

    # Fetch from FB API and update cache
    try:
        pixels = service.get_pixels(ad_account_id)
        result = [dict(p) for p in pixels]

        # Upsert into DB cache
        for p in result:
            pid = p.get('id', '')
            existing = db.query(CachedPixel).filter(
                CachedPixel.fb_pixel_id == pid,
                CachedPixel.ad_account_id == acct_id,
            ).first()
            if existing:
                existing.name = p.get('name', '')
                existing.synced_at = datetime.now(timezone.utc)
            else:
                db.add(CachedPixel(
                    fb_pixel_id=pid,
                    ad_account_id=acct_id,
                    name=p.get('name', ''),
                ))
        db.commit()
        return result
    except Exception as e:
        db.rollback()
        # If FB API fails, try serving stale cache
        cached = db.query(CachedPixel).filter(CachedPixel.ad_account_id == acct_id).all()
        if cached:
            logger.warning(f"FB API failed for pixels, serving stale cache: {e}")
            return [{"id": c.fb_pixel_id, "name": c.name} for c in cached]
        logger.exception("Facebook API error and no cached pixels")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/pixels")
def create_pixel(
    body: dict,
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
):
    try:
        name = body.get("name", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Pixel name is required")
        acct = body.get("ad_account_id") or ad_account_id
        result = service.create_pixel(name, acct)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Facebook API error creating pixel")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pixels/owned-list")
def list_owned_pixels(
    ad_account_id: Optional[str] = None,
    business_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
):
    """List pixels owned by a business, sorted by last_fired ascending (stalest first).

    Pass either ad_account_id (resolves to its agency/owner BM) or business_id directly.
    Used to find rename candidates when the business hits the 100-pixel cap.
    """
    try:
        return service.list_owned_pixels(ad_account_id=ad_account_id, business_id=business_id)
    except Exception as e:
        logger.exception("Facebook API error listing owned pixels")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pixels/{pixel_id}/rename")
def rename_pixel(
    pixel_id: str,
    body: dict,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
):
    """Rename an existing pixel in place. Fallback for 100-cap businesses."""
    try:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        return service.rename_pixel(pixel_id, name)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Facebook API error renaming pixel")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pixels/create-and-link-clickflare")
def create_pixel_and_link_clickflare(
    body: dict,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
):
    """One-shot: create FB pixel + wire it into ClickFlare's FB traffic source.

    Body:
      name (required)                  pixel + CF integration name
      ad_account_id (required)         FB ad account (act_xxx)
      cf_traffic_source_id (required)  CF "fb" traffic source _id
      cf_api_key (optional)            CF key (else env CLICKFLARE_API_KEY or ~/.clickflare-api-key)
      event_mapping (optional)         default {"2": "Purchase", "conversion": "Purchase"}
      action_source (optional)         default "website"
      test_code (optional)             FB CAPI test code (enables testMode if set)
    """
    import os
    import requests as _req
    from pathlib import Path

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    acct = body.get("ad_account_id")
    if not acct:
        raise HTTPException(400, "ad_account_id required")
    cf_source_id = (body.get("cf_traffic_source_id") or "").strip()
    if not cf_source_id:
        raise HTTPException(400, "cf_traffic_source_id required")

    cf_key = body.get("cf_api_key") or os.environ.get("CLICKFLARE_API_KEY")
    if not cf_key:
        key_file = Path.home() / ".clickflare-api-key"
        if key_file.exists():
            cf_key = key_file.read_text().strip()
    if not cf_key:
        raise HTTPException(400, "ClickFlare API key not found (set CLICKFLARE_API_KEY or ~/.clickflare-api-key)")

    event_mapping = body.get("event_mapping") or {"2": "Purchase", "conversion": "Purchase"}
    action_source = body.get("action_source") or "website"
    test_code = body.get("test_code") or ""

    pixel = service.create_pixel(name, acct)
    pixel_id = pixel.get("id")
    if not pixel_id:
        raise HTTPException(500, f"FB returned no pixel id: {pixel}")

    capi_token = service.access_token
    if not capi_token:
        raise HTTPException(500, "No FB access token on connection for CAPI")

    cf_base = "https://public-api.clickflare.io/api"
    cf_headers = {
        "api-key": cf_key,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    }

    def _cf(method: str, path: str, payload: dict | None = None):
        r = _req.request(method, f"{cf_base}{path}", json=payload, headers=cf_headers, timeout=30)
        if r.status_code >= 300:
            raise HTTPException(500, f"CF {method} {path} failed ({r.status_code}): {r.text}")
        return r.json() if r.text else {}

    setting = _cf("POST", "/integration-settings", {
        "name": name,
        "type": "facebookpixel",
        "settings": {"pixel_id": pixel_id, "access_token": capi_token},
        "status": True,
    })
    setting_id = setting.get("_id")
    if not setting_id:
        raise HTTPException(500, f"CF integration-settings returned no _id: {setting}")

    integration = _cf("POST", "/integration", {
        "name": name,
        "type": "facebook",
        "integration_setting_id": setting_id,
        "metadata": {
            "pixelId": pixel_id,
            "action_source": action_source,
            "testMode": bool(test_code),
            "testCode": test_code,
            "event_mapping": event_mapping,
        },
        "configuration": {"fbp": "visit_id", "value": "payout"},
        "event_type": list(event_mapping.keys()),
        "status": True,
    })
    integration_id = integration.get("_id")
    if not integration_id:
        raise HTTPException(500, f"CF integration returned no _id: {integration}")

    ts = _cf("GET", f"/traffic-sources/{cf_source_id}")
    existing = list(ts.get("integrations") or [])
    if integration_id not in existing:
        existing.append(integration_id)
        _cf("PATCH", f"/traffic-sources/{cf_source_id}", {"integrations": existing})

    return {
        "pixel_id": pixel_id,
        "pixel_name": name,
        "clickflare": {
            "integration_setting_id": setting_id,
            "integration_id": integration_id,
            "traffic_source_id": cf_source_id,
        },
    }

@router.get("/pages")
def read_pages(
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    cache_key = f"pages:{getattr(service, '_connection_id', 'default')}"
    try:
        result, _src = cached_or_fetch(
            cache_key,
            service.get_pages,
            fresh_ttl_seconds=300,  # pages rarely change
            ad_account_id=None,
        )
        return result
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")


@router.get("/pages/{page_id}")
def read_page_info(
    page_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    import time as _time
    cached = _page_info_cache.get(page_id)
    if cached:
        result, ts = cached
        if _time.time() - ts < _API_CACHE_TTL:
            return result
    try:
        result = service.get_page_info(page_id)
        _page_info_cache[page_id] = (result, _time.time())
        return result
    except Exception as e:
        logger.exception("Could not find Facebook page")
        raise HTTPException(status_code=404, detail="Could not find page")


@router.get("/posts/{post_id}/preview")
def read_post_preview(
    post_id: str,
    page_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
):
    """Preview an existing FB post — returns thumbnail/full_picture, message, type."""
    try:
        return service.get_post_preview(post_id, page_id=page_id)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception(f"Failed to fetch post preview for {post_id}")
        raise HTTPException(status_code=404, detail=f"Post not found or inaccessible: {e}")


@router.get("/adsets")
def read_adsets(
    ad_account_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    import time as _time
    cache_key = (getattr(service, '_connection_id', 'default'), campaign_id, ad_account_id)
    cached = _adsets_cache.get(cache_key)
    if cached:
        result, ts = cached
        if _time.time() - ts < _ADSETS_CACHE_TTL:
            return result
    try:
        adsets = service.get_adsets(ad_account_id, campaign_id)
        result = [dict(a) for a in adsets]
        _adsets_cache[cache_key] = (result, _time.time())
        return result
    except FacebookRequestError as e:
        # On rate limit, fall back to local fb_sync_adsets so users can still
        # select an existing adset and complete uploads. FB write-path quota
        # is separate from read-path, so publishing ads will still work.
        if e.api_error_code() in (17, 32, 4, 613) and campaign_id:
            from app.models import FBSyncAdSet
            rows = db.query(FBSyncAdSet).filter(
                FBSyncAdSet.fb_campaign_id == campaign_id
            ).all()
            if rows:
                logger.warning(
                    f"FB rate-limited on /adsets; serving {len(rows)} rows "
                    f"from fb_sync_adsets for campaign {campaign_id}"
                )
                return [{
                    "id": r.fb_adset_id,
                    "name": r.name,
                    "status": r.status,
                    "effective_status": r.effective_status,
                    "campaign_id": r.fb_campaign_id,
                    "daily_budget": r.daily_budget,
                    "optimization_goal": r.optimization_goal,
                    "billing_event": r.billing_event,
                    "targeting": r.targeting,
                    "_source": "local_sync",
                } for r in rows]
        logger.exception("Facebook API error (adsets)")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error (adsets)")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/adsets")
def create_adset(
    adset: Dict[str, Any],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        result = service.create_adset(adset, ad_account_id)
        return dict(result)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/diagnose")
def diagnose_permissions(
    page_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Diagnose Facebook token permissions, app status, and page access."""
    try:
        return service.diagnose_permissions(page_id)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

_preflight_cache = {}  # key: (page_id, ad_account_id) → (result, timestamp)
_PREFLIGHT_TTL = 300   # 5 minutes


@router.post("/preflight")
def preflight_check(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Run pre-flight checks before publishing ads. Results cached for 5 min."""
    page_id = data.get("page_id")
    ad_account_id = data.get("ad_account_id")

    # Return cached result if recent enough
    import time as _time
    cache_key = (page_id, ad_account_id)
    cached = _preflight_cache.get(cache_key)
    if cached:
        result, ts = cached
        if _time.time() - ts < _PREFLIGHT_TTL:
            return result

    checks = []
    all_passed = True

    diag = service.diagnose_permissions(page_id)

    # 1. Token validity
    token_data = diag.get("token_debug", {})
    token_valid = token_data.get("is_valid", False)
    checks.append({
        "name": "token_valid",
        "label": "Access token is valid",
        "passed": token_valid,
        "detail": None if token_valid else "Token is expired or invalid. Re-authenticate in Settings."
    })
    if not token_valid:
        all_passed = False

    # 2. Required scopes — prefer debug_token (authoritative for both User
    # and System User tokens, never rate-limited the way /me/permissions is).
    # Fall back to /me/permissions only if debug_token didn't return scopes.
    debug_scopes = token_data.get("scopes") if isinstance(token_data, dict) else None
    if isinstance(debug_scopes, list) and debug_scopes:
        granted_scopes = set(debug_scopes)
    else:
        permissions = diag.get("permissions", [])
        if isinstance(permissions, list):
            granted_scopes = {p["permission"] for p in permissions if p.get("status") == "granted"}
        else:
            granted_scopes = set()
    required = {"ads_management", "pages_manage_ads"}
    missing = required - granted_scopes
    scope_ok = len(missing) == 0
    checks.append({
        "name": "scopes",
        "label": "Required permissions granted",
        "passed": scope_ok,
        "detail": None if scope_ok else f"Missing scopes: {', '.join(missing)}"
    })
    if not scope_ok:
        all_passed = False

    # 3. Page access — for System User tokens, pages don't appear in
    # /me/accounts even when the SU has full admin rights via Business
    # Manager. As long as the token can read the page (PARTIAL ACCESS
    # verdict), accept it; only fail on NO ACCESS.
    if page_id:
        verdict = diag.get("target_page_verdict", "")
        token_type_p = token_data.get("type") if isinstance(token_data, dict) else None
        page_ok = (
            "FULL ACCESS" in verdict
            or (token_type_p == "SYSTEM_USER" and "PARTIAL ACCESS" in verdict)
        )
        page_name = diag.get("target_page", {}).get("name", page_id)
        checks.append({
            "name": "page_access",
            "label": f"Page \"{page_name}\" is accessible",
            "passed": page_ok,
            "detail": None if page_ok else verdict
        })
        if not page_ok:
            all_passed = False

    # 4. Ad account accessible
    if ad_account_id:
        try:
            account = service._get_account(ad_account_id)
            account_data = account.api_get(fields=["id", "name", "account_status"])
            acct_status = account_data.get("account_status")
            # account_status: 1=Active, 2=Disabled, 3=Unsettled, 7=Pending Review
            acct_active = acct_status == 1
            acct_name = account_data.get("name", ad_account_id)
            checks.append({
                "name": "ad_account",
                "label": f"Ad account \"{acct_name}\" is accessible",
                "passed": acct_active,
                "detail": None if acct_active else f"Account status: {acct_status} (1=Active, 2=Disabled, 3=Unsettled)"
            })
            if not acct_active:
                all_passed = False
        except Exception as e:
            checks.append({
                "name": "ad_account",
                "label": "Ad account is accessible",
                "passed": False,
                "detail": str(e)
            })
            all_passed = False

    # 5. Identity check — System User tokens don't have a /me identity and
    # /me itself is rate-limited under load. If debug_token says the token
    # is valid (and especially if it's a SYSTEM_USER), that's authoritative
    # identity; skip the /me-based label as a hard gate.
    identity = diag.get("identity", {})
    token_type = token_data.get("type") if isinstance(token_data, dict) else None
    is_system_user = token_type == "SYSTEM_USER"
    identity_from_me = "id" in identity and "error" not in identity
    identity_ok = identity_from_me or (token_valid and is_system_user)
    if identity_from_me:
        label_name = identity.get("name", "Unknown")
    elif is_system_user:
        label_name = f"System User (app {token_data.get('app_id', '?')})"
    else:
        label_name = identity.get("name", "Unknown")
    checks.append({
        "name": "identity",
        "label": f"Authenticated as \"{label_name}\"",
        "passed": identity_ok,
        "detail": None if identity_ok else "Could not verify token identity"
    })
    if not identity_ok:
        all_passed = False

    result = {"passed": all_passed, "checks": checks}
    import time as _time
    _preflight_cache[cache_key] = (result, _time.time())
    return result

@router.post("/creatives")
def create_creative(
    creative: Dict[str, Any],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        print(f"[facebook:create_creative] page_id={creative.get('page_id')}, image_hash={creative.get('image_hash')}, video_id={creative.get('video_id')}, ad_account_id={ad_account_id}")
        print(f"[facebook:create_creative] Full payload: {creative}")
        result = service.create_creative(creative, ad_account_id)
        print(f"[facebook:create_creative] Success: {dict(result)}")
        return dict(result)
    except Exception as e:
        import traceback
        print(f"[facebook:create_creative] FAILED: {type(e).__name__}: {e}")
        print(f"[facebook:create_creative] Full traceback:")
        traceback.print_exc()
        # Try to extract Facebook API error details
        if hasattr(e, 'api_error_message'):
            print(f"[facebook:create_creative] FB API error: {e.api_error_message()}")
        if hasattr(e, 'body'):
            print(f"[facebook:create_creative] FB body: {e.body()}")
        if hasattr(e, '_body'):
            print(f"[facebook:create_creative] FB _body: {e._body}")
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/ads")
def create_ad(
    ad: Dict[str, Any],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        result = service.create_ad(ad, ad_account_id)
        return dict(result)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/ads/{ad_id}/first-comment")
def post_first_comment(
    ad_id: str,
    body: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Post a first comment on an ad's post as the Page."""
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Comment message is required")
    try:
        result = service.post_first_comment(ad_id, message)
        return {"success": True, "comment_id": result.get("id"), "message": "First comment posted"}
    except Exception as e:
        logger.exception("Failed to post first comment")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pages/{page_id}/posts")
def publish_page_post(
    page_id: str,
    body: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Publish an organic post to a Facebook Page, with optional first comment."""
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Post message is required")
    image_url = body.get("image_url", "").strip() or None
    link = body.get("link", "").strip() or None
    first_comment = body.get("first_comment", "").strip() or None
    try:
        result = service.publish_page_post(page_id, message, image_url=image_url, link=link)
        post_id = result.get("id") or result.get("post_id", "")
        comment_id = None

        # Post first comment if provided
        if first_comment and post_id:
            import time
            time.sleep(2)
            try:
                comment_result = service.comment_on_page_post(page_id, post_id, first_comment)
                comment_id = comment_result.get("id")
            except Exception as ce:
                logger.warning(f"First comment failed for post {post_id}: {ce}")

        return {
            "success": True,
            "post_id": post_id,
            "post_url": f"https://www.facebook.com/{post_id}" if post_id else None,
            "comment_id": comment_id,
            "message": "Post published successfully",
        }
    except Exception as e:
        logger.exception("Failed to publish page post")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ads")
def read_ads(
    adset_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    cache_key = f"ads:{getattr(service, '_connection_id', 'default')}:{adset_id}"
    try:
        result, _src = cached_or_fetch(
            cache_key,
            lambda: [dict(a) for a in service.get_ads(adset_id)],
            fresh_ttl_seconds=30,
            ad_account_id=None,
        )
        return result
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/campaigns/save")
def save_campaign_locally(
    campaign_data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        # Check if exists
        existing = db.query(FacebookCampaign).filter(FacebookCampaign.id == campaign_data.get('id')).first()
        if existing:
            return {"message": "Campaign already exists", "id": existing.id}

        # Handle daily_budget casting
        daily_budget = campaign_data.get('dailyBudget')
        if daily_budget is not None:
            daily_budget = int(float(daily_budget))

        new_campaign = FacebookCampaign(
            id=campaign_data.get('id'),
            name=campaign_data.get('name'),
            objective=campaign_data.get('objective'),
            budget_type=campaign_data.get('budgetType', 'ABO'),
            daily_budget=daily_budget,
            bid_strategy=campaign_data.get('bidStrategy'),
            status=campaign_data.get('status'),
            fb_campaign_id=campaign_data.get('fbCampaignId'),
            brand_id=campaign_data.get('brandId')
        )
        db.add(new_campaign)
        db.commit()
        db.refresh(new_campaign)
        return {"message": "Campaign saved locally", "id": new_campaign.id}
    except Exception as e:
        db.rollback()
        print(f"Error saving campaign locally: {e}")
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.patch("/campaigns/{fb_campaign_id}/brand")
def tag_campaign_brand(
    fb_campaign_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Tag a campaign with a brand. Creates a local record if one doesn't exist yet."""
    brand_id = data.get('brand_id')  # None = untag

    # Try to find by fb_campaign_id first
    campaign = db.query(FacebookCampaign).filter(
        FacebookCampaign.fb_campaign_id == fb_campaign_id
    ).first()

    if campaign:
        campaign.brand_id = brand_id
    else:
        # Campaign exists on Facebook but not in our local DB — create a minimal record
        campaign = FacebookCampaign(
            name=data.get('name', fb_campaign_id),
            objective=data.get('objective', 'UNKNOWN'),
            budget_type='ABO',
            fb_campaign_id=fb_campaign_id,
            brand_id=brand_id,
        )
        db.add(campaign)

    db.commit()
    return {"fb_campaign_id": fb_campaign_id, "brand_id": brand_id}

@router.get("/campaigns/brand-map")
def get_campaign_brand_map(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get a mapping of fb_campaign_id -> brand_id for all tagged campaigns."""
    campaigns = db.query(FacebookCampaign).filter(
        FacebookCampaign.brand_id.isnot(None),
        FacebookCampaign.fb_campaign_id.isnot(None)
    ).all()
    return {c.fb_campaign_id: c.brand_id for c in campaigns}

@router.get("/account-brands")
def get_account_brands(
    ad_account_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get brand IDs assigned to a specific ad account."""
    rows = db.execute(
        account_brands.select().where(account_brands.c.ad_account_id == ad_account_id)
    ).fetchall()
    return [row.brand_id for row in rows]

@router.put("/account-brands")
def set_account_brands(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Replace all brand assignments for an ad account."""
    ad_account_id = data.get("ad_account_id")
    brand_ids = data.get("brand_ids", [])
    if not ad_account_id:
        raise HTTPException(status_code=400, detail="ad_account_id is required")
    # Delete existing
    db.execute(delete(account_brands).where(account_brands.c.ad_account_id == ad_account_id))
    # Insert new
    for bid in brand_ids:
        db.execute(insert(account_brands).values(ad_account_id=ad_account_id, brand_id=bid))
    db.commit()
    return {"status": "ok", "ad_account_id": ad_account_id, "brand_ids": brand_ids}

@router.get("/account-brands/map")
def get_account_brand_map(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get mapping of all ad accounts -> brand IDs."""
    rows = db.execute(account_brands.select()).fetchall()
    result = {}
    for row in rows:
        result.setdefault(row.ad_account_id, []).append(row.brand_id)
    return result

@router.post("/adsets/save")
def save_adset_locally(
    adset_data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        # Check if exists
        existing = db.query(FacebookAdSet).filter(FacebookAdSet.id == adset_data.get('id')).first()
        if existing:
            return {"message": "AdSet already exists", "id": existing.id}
            
        # Ensure campaign exists (FK check)
        campaign_id = adset_data.get('campaignId')
        if not campaign_id:
             raise HTTPException(status_code=400, detail="campaignId is required")
             
        # We assume campaign is already saved by the frontend calling /campaigns/save first

        # Handle numeric fields casting
        daily_budget = adset_data.get('dailyBudget')
        if daily_budget is not None:
            daily_budget = int(float(daily_budget))
            
        bid_amount = adset_data.get('bidAmount')
        if bid_amount is not None:
            bid_amount = int(float(bid_amount))

        new_adset = FacebookAdSet(
            id=adset_data.get('id'),
            campaign_id=campaign_id,
            name=adset_data.get('name'),
            optimization_goal=adset_data.get('optimizationGoal'),
            daily_budget=daily_budget,
            bid_strategy=adset_data.get('bidStrategy'),
            bid_amount=bid_amount,
            targeting=adset_data.get('targeting'),
            pixel_id=adset_data.get('pixelId'),
            conversion_event=adset_data.get('conversionEvent'),
            status=adset_data.get('status'),
            fb_adset_id=adset_data.get('fbAdsetId')
        )
        db.add(new_adset)
        db.commit()
        db.refresh(new_adset)
        return {"message": "AdSet saved locally", "id": new_adset.id}
    except Exception as e:
        db.rollback()
        print(f"Error saving adset locally: {e}")
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/ads/save")
def save_ad_locally(
    ad_data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        # Check if adset exists locally, if not we might need to create it or handle error
        # For now, assuming adset exists or we just save the ID

        new_ad = FacebookAd(
            id=ad_data.get('id'),
            adset_id=ad_data.get('adsetId'),
            name=ad_data.get('name'),
            creative_name=ad_data.get('creativeName'),
            image_url=ad_data.get('imageUrl'),
            # Video support fields
            media_type=ad_data.get('mediaType', 'image'),
            video_url=ad_data.get('videoUrl'),
            video_id=ad_data.get('videoId'),
            thumbnail_url=ad_data.get('thumbnailUrl'),
            bodies=ad_data.get('bodies'),
            headlines=ad_data.get('headlines'),
            description=ad_data.get('description'),
            cta=ad_data.get('cta'),
            website_url=ad_data.get('websiteUrl'),
            status=ad_data.get('status'),
            fb_ad_id=ad_data.get('fbAdId'),
            fb_creative_id=ad_data.get('fbCreativeId')
        )
        db.add(new_ad)
        db.commit()
        db.refresh(new_ad)
        return {"message": "Ad saved locally", "id": new_ad.id}
    except Exception as e:
        db.rollback()
        print(f"Error saving ad locally: {e}")
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/upload-image")
def upload_image(
    data: Dict[str, str],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    try:
        image_url = data.get("image_url")
        if not image_url:
            raise HTTPException(status_code=400, detail="image_url is required")
        image_hash = service.upload_image(image_url, ad_account_id)
        return {"image_hash": image_hash}
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/upload-images")
def upload_images(
    data: Dict[str, Any],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Upload multiple image variants to Facebook for placement customization.

    Request body:
        variant_urls: dict of {aspect_ratio: image_url}
            e.g. {"1:1": "https://...", "9:16": "https://..."}

    Returns:
        image_hashes: dict of {aspect_ratio: image_hash}
    """
    try:
        variant_urls = data.get("variant_urls")
        if not variant_urls or not isinstance(variant_urls, dict):
            raise HTTPException(status_code=400, detail="variant_urls dict is required")

        image_hashes = service.upload_images(variant_urls, ad_account_id)
        return {"image_hashes": image_hashes}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/upload-video")
def upload_video(
    data: Dict[str, Any],
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Upload a video to Facebook Ad Library.

    Request body:
        video_url: URL of the video to upload
        wait_for_ready: Whether to wait for processing (default True)
        timeout: Max seconds to wait (default 600)

    Returns:
        video_id: Facebook video ID
        status: 'processing', 'ready', or 'error'
        thumbnails: List of auto-generated thumbnail URLs (if ready)
    """
    video_url = data.get("video_url")
    if not video_url:
        raise HTTPException(status_code=400, detail="video_url is required")
    page_id = data.get("page_id")
    if not page_id:
        raise HTTPException(status_code=400, detail="page_id is required — uploads go to /<page_id>/videos")

    try:
        wait_for_ready = data.get("wait_for_ready", False)  # Default to False — frontend polls instead
        timeout = min(data.get("timeout", 120), 240)  # Cap at 4 min to avoid Railway timeout

        print(f"[upload-video] URL: {video_url[:100]}..., page_id={page_id}, wait_for_ready={wait_for_ready}, timeout={timeout}")

        result = service.upload_video(
            video_url,
            ad_account_id,
            wait_for_ready=wait_for_ready,
            timeout=timeout,
            page_id=page_id,
        )
        print(f"[upload-video] Success: video_id={result.get('video_id')}, status={result.get('status')}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"[upload-video] FAILED: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/video-status/{video_id}")
def get_video_status(
    video_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Check the processing status of a video.

    Returns:
        status: 'processing', 'ready', or 'error'
        video_id: The video ID
        length: Video duration in seconds (if ready)
    """
    try:
        return service.get_video_status(video_id)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/video-frames/extract")
def extract_video_frames(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Extract candidate thumbnail frames from a video via ffmpeg.

    Request body:
        video_url: URL or /uploads/... path of the video (NOT a blob: URL)
        n: Number of frames to extract (default 8, max 16)
        video_id: Optional ID to use for the output folder name

    Returns:
        frames: List of relative URLs to extracted JPEGs
                e.g. ["/uploads/thumbnails/abc/frame_01.jpg", ...]
    """
    video_url = data.get("video_url")
    if not video_url:
        raise HTTPException(status_code=400, detail="video_url is required")
    n = min(max(int(data.get("n", 8)), 1), 16)
    video_id = data.get("video_id")
    try:
        frames = service.extract_video_frames(video_url, video_id=video_id, n=n)
        opening_count = sum(1 for f in frames if '/opening_' in f)

        # Railway containers have ephemeral disk — every backend redeploy wipes
        # /uploads/. If we hand the frontend a /uploads/thumbnails/... path and
        # the user picks a thumbnail, then we redeploy before they finish
        # publishing, FB will hit a 404 when it tries to download the image.
        # Upload each frame to R2 (persistent) and return R2 URLs instead.
        from app.api.v1.uploads import get_s3_client, UPLOAD_DIR
        s3 = get_s3_client()
        if s3 and settings.r2_enabled and settings.R2_PUBLIC_URL:
            r2_frames = []
            for f in frames:
                if not f.startswith('/uploads/'):
                    r2_frames.append(f)
                    continue
                local_path = (UPLOAD_DIR.parent / f.lstrip('/')).resolve()
                try:
                    if not local_path.exists():
                        r2_frames.append(f)
                        continue
                    # Key under thumbnails/<videoId>/frame_NN.jpg so we don't collide
                    key = f.lstrip('/').replace('uploads/', '', 1)
                    with open(local_path, 'rb') as fh:
                        s3.put_object(
                            Bucket=settings.R2_BUCKET_NAME,
                            Key=key,
                            Body=fh.read(),
                            ContentType='image/jpeg',
                        )
                    r2_frames.append(f"{settings.R2_PUBLIC_URL}/{key}")
                except Exception as ue:
                    logger.warning(f"R2 upload failed for {f}: {ue}; falling back to local URL")
                    r2_frames.append(f)
            frames = r2_frames

        return {"frames": frames, "opening_count": opening_count}
    except Exception as e:
        print(f"[extract-frames] FAILED: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Frame extraction failed: {e}")


@router.get("/video-thumbnails/{video_id}")
def get_video_thumbnails(
    video_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get auto-generated thumbnails for a video.

    Returns:
        thumbnails: List of thumbnail URLs
    """
    try:
        thumbnails = service.get_video_thumbnails(video_id)
        return {"thumbnails": thumbnails}
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/pages/{page_id}/picture")
def get_page_picture(
    page_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Proxy page profile picture URL (avoids exposing token to frontend)."""
    import requests as req
    try:
        url = f"https://graph.facebook.com/v21.0/{page_id}/picture"
        params = {'type': 'small', 'redirect': 'false', 'access_token': service.access_token}
        resp = req.get(url, params=params, timeout=10).json()
        return {"url": resp.get("data", {}).get("url", "")}
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

# ── Insights / Campaign Browser ──────────────────────────────────

@router.get("/insights/campaigns")
def get_campaign_insights(
    ad_account_id: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
    brand_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get all campaigns with performance insights for an ad account."""
    try:
        time_range = None
        if since and until:
            time_range = {'since': since, 'until': until}

        # Get brand-tagged campaign IDs if filtering by brand
        campaign_ids = None
        if brand_id:
            tagged = db.query(FacebookCampaign).filter(
                FacebookCampaign.brand_id == brand_id,
                FacebookCampaign.fb_campaign_id.isnot(None)
            ).all()
            campaign_ids = [c.fb_campaign_id for c in tagged]
            if not campaign_ids:
                return []  # No campaigns tagged with this brand

        cache_key = f"insights_campaigns:{getattr(service, '_connection_id', 'default')}:{ad_account_id}:{since or '_'}:{until or '_'}:{brand_id or '_'}"
        result, _src = cached_or_fetch(
            cache_key,
            lambda: service.get_campaigns_with_insights(ad_account_id, time_range, campaign_ids=campaign_ids),
            fresh_ttl_seconds=60,  # insights change slower; longer TTL reduces Meta hits
            ad_account_id=ad_account_id,
        )
        return result
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/insights/daily")
def get_daily_insights(
    ad_account_id: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
    brand_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get daily aggregate insights for an ad account (spend, clicks, impressions per day)."""
    try:
        time_range = None
        if since and until:
            time_range = {'since': since, 'until': until}

        # Get brand-tagged campaign IDs if filtering by brand
        campaign_ids = None
        if brand_id:
            tagged = db.query(FacebookCampaign).filter(
                FacebookCampaign.brand_id == brand_id,
                FacebookCampaign.fb_campaign_id.isnot(None)
            ).all()
            campaign_ids = [c.fb_campaign_id for c in tagged]
            if not campaign_ids:
                return []

        return service.get_daily_insights(ad_account_id, time_range, campaign_ids=campaign_ids)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/ad-alerts")
def get_ad_alerts(
    ad_account_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get disapproved or flagged ads for an ad account.

    Cached for 15 minutes per (account, user) to avoid hammering Meta's
    user-level rate limit when the Reporting page polls or remounts.
    On rate-limit error, the helper serves the last cached value.
    """
    cache_key = f"ad-alerts:{current_user.id}:{ad_account_id}"
    try:
        alerts, _source = cached_or_fetch(
            cache_key=cache_key,
            fetch_fn=lambda: service.get_disapproved_ads(ad_account_id),
            fresh_ttl_seconds=900,
            ad_account_id=ad_account_id,
        )
        return {"alerts": alerts, "count": len(alerts)}
    except FacebookRequestError as e:
        logger.exception("Facebook API error (ad-alerts)")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error (ad-alerts)")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/insights/adsets/{campaign_id}")
def get_adset_insights(
    campaign_id: str,
    ad_account_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get ad sets with performance insights for a campaign."""
    try:
        time_range = None
        if since and until:
            time_range = {'since': since, 'until': until}
        return service.get_adsets_with_insights(campaign_id, ad_account_id, time_range)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/insights/ads/{adset_id}")
def get_ad_insights(
    adset_id: str,
    ad_account_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get ads with performance insights for an ad set."""
    try:
        time_range = None
        if since and until:
            time_range = {'since': since, 'until': until}
        return service.get_ads_with_insights(adset_id, ad_account_id, time_range)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/insights/all-ads")
def get_all_ad_insights(
    ad_account_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get ALL ads across all campaigns for an ad account with insights."""
    try:
        time_range = None
        if since and until:
            time_range = {'since': since, 'until': until}
        return service.get_all_ads_with_insights(ad_account_id, time_range)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/insights/all-adsets")
def get_all_adset_insights(
    ad_account_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get ALL ad sets across all campaigns for an ad account with insights."""
    try:
        time_range = None
        if since and until:
            time_range = {'since': since, 'until': until}
        return service.get_all_adsets_with_insights(ad_account_id, time_range)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/status")
def update_status(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Toggle campaign/adset/ad status between ACTIVE and PAUSED."""
    try:
        object_id = data.get('object_id')
        object_type = data.get('object_type')
        status = data.get('status')
        if not all([object_id, object_type, status]):
            raise HTTPException(status_code=400, detail="object_id, object_type, and status are required")
        return service.update_object_status(object_id, object_type, status)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except ValueError as e:
        logger.exception("Facebook API request error")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/bulk-status")
def bulk_update_status(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Bulk update status of multiple campaigns/adsets/ads."""
    try:
        items = data.get('items')
        status = data.get('status')
        if not items or not status:
            raise HTTPException(status_code=400, detail="items and status are required")
        if status not in ('ACTIVE', 'PAUSED'):
            raise HTTPException(status_code=400, detail="status must be ACTIVE or PAUSED")
        return service.bulk_update_status(items, status)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/delete-object")
def delete_object(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Delete a campaign, ad set, or ad (sets status to DELETED on Facebook)."""
    try:
        object_id = data.get('object_id')
        object_type = data.get('object_type')
        if not object_id or not object_type:
            raise HTTPException(status_code=400, detail="object_id and object_type are required")
        if object_type not in ('campaign', 'adset', 'ad'):
            raise HTTPException(status_code=400, detail="object_type must be campaign, adset, or ad")
        return service.delete_object(object_id, object_type)
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except ValueError as e:
        logger.exception("Facebook API request error")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/ad-preview/{ad_id}")
def get_ad_preview(
    ad_id: str,
    ad_format: str = "DESKTOP_FEED_STANDARD",
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    """Get Facebook-rendered ad preview HTML."""
    try:
        return service.get_ad_preview(ad_id, ad_format)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/duplicate-ad")
def duplicate_ad(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Duplicate an ad (same creative, new ad object, starts PAUSED)."""
    try:
        ad_id = data.get('ad_id')
        ad_account_id = data.get('ad_account_id')
        if not ad_id:
            raise HTTPException(status_code=400, detail="ad_id is required")
        return service.duplicate_ad(ad_id, ad_account_id, new_name=data.get('new_name'))
    except PermissionError as e:
        logger.warning(f"Page permission error duplicating ad: {e}")
        raise HTTPException(status_code=403, detail=str(e))
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except ValueError as e:
        logger.exception("Facebook API request error")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/duplicate-campaign")
def duplicate_campaign(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Duplicate a campaign and all its ad sets + ads (starts PAUSED)."""
    try:
        campaign_id = data.get('campaign_id')
        ad_account_id = data.get('ad_account_id')
        if not campaign_id:
            raise HTTPException(status_code=400, detail="campaign_id is required")
        return service.duplicate_campaign(campaign_id, ad_account_id, new_name=data.get('new_name'))
    except FacebookRequestError as e:
        logger.exception("Facebook API error")
        raise _fb_http_error(e)
    except ValueError as e:
        logger.exception("Facebook API request error")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/clone-campaign")
def clone_campaign_to_account(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Clone a campaign's full structure (campaign + ad sets + ads with creatives) to a different ad account."""
    try:
        campaign_id = data.get('campaign_id')
        target_account_id = data.get('target_account_id')
        if not campaign_id:
            raise HTTPException(status_code=400, detail="campaign_id is required")
        if not target_account_id:
            raise HTTPException(status_code=400, detail="target_account_id is required")
        return service.clone_campaign_to_account(
            campaign_id,
            target_account_id,
            new_name=data.get('new_name'),
            target_page_id=data.get('target_page_id'),
            target_pixel_id=data.get('target_pixel_id'),
            clone_ads=data.get('clone_ads', True),
        )
    except FacebookRequestError as e:
        logger.exception("Facebook API error (clone-campaign)")
        raise _fb_http_error(e)
    except ValueError as e:
        logger.exception("Facebook API request error")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.exception("Facebook API error (clone-campaign)")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/duplicate-adset")
def duplicate_adset(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Duplicate an ad set and all its ads (starts PAUSED)."""
    try:
        adset_id = data.get('adset_id')
        ad_account_id = data.get('ad_account_id')
        if not adset_id:
            raise HTTPException(status_code=400, detail="adset_id is required")
        return service.duplicate_adset(adset_id, ad_account_id, new_name=data.get('new_name'))
    except FacebookRequestError as e:
        logger.exception("Facebook API error (duplicate-adset)")
        raise _fb_http_error(e)
    except ValueError as e:
        logger.exception("Facebook API request error")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.exception("Facebook API error (duplicate-adset)")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/rename")
def rename_object(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Rename a campaign, ad set, or ad."""
    try:
        object_id = data.get('object_id') or data.get('ad_id')
        object_type = data.get('object_type', 'ad')
        new_name = data.get('name')
        if not object_id or not new_name:
            raise HTTPException(status_code=400, detail="object_id and name are required")
        if object_type not in ('campaign', 'adset', 'ad'):
            raise HTTPException(status_code=400, detail="object_type must be campaign, adset, or ad")
        return service.update_object_name(object_id, object_type, new_name)
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.post("/edit-creative")
def edit_ad_creative(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Edit an ad's creative: upload new image if changed, create new AdCreative, update Ad."""
    try:
        ad_id = data.get('ad_id')
        if not ad_id:
            raise HTTPException(status_code=400, detail="ad_id is required")
        ad_account_id = data.get('ad_account_id')
        result = service.update_ad_creative(ad_id, data, ad_account_id)
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.exception("Edit creative validation error")
        raise HTTPException(status_code=400, detail=str(e))
    except FacebookRequestError as e:
        logger.exception("Facebook API error in edit-creative")
        raise _fb_http_error(e)
    except Exception as e:
        logger.exception("Unexpected error in edit-creative")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")

@router.get("/locations/search")
def search_locations(
    q: str,
    type: str = "country,region,city,geo_market,zip",
    limit: int = 10,
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user)
):
    try:
        location_types = [t.strip() for t in type.split(",") if t.strip()]
        locations = service.search_locations(q, location_types, limit, ad_account_id)
        return [dict(loc) for loc in locations]
    except Exception as e:
        logger.exception("Facebook API error")
        raise HTTPException(status_code=500, detail=f"Facebook API error: {str(e)}")


# --- Bahiana Scale Launch ---

@router.post("/bahiana-launch")
def bahiana_launch(
    data: Dict[str, Any],
    background_tasks: BackgroundTasks,
    service: FacebookService = Depends(get_facebook_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Bahiana Scale: 1 campaign → N ad sets at $1/day → 1 ad each (same creative).

    Expected payload:
    {
        campaign_data: { name, objective, status, ... },
        adset_data: { targeting, optimizationGoal, pixelId, conversionEvent, ... },
        creative_data: { creatives: [...], headlines, bodies, description, cta, websiteUrl, pageId },
        ad_account_id: str,
        connection_id: str,
        num_adsets: int (default 50),
        budget_per_adset: float (default 1.0, in dollars)
    }
    """
    campaign_data = data.get('campaign_data', {})
    adset_data = data.get('adset_data', {})
    creative_data = data.get('creative_data', {})
    ad_account_id = data.get('ad_account_id')
    num_adsets = data.get('num_adsets', 50)
    budget_per_adset = data.get('budget_per_adset', 1.0)

    # Step 1: Create the campaign
    try:
        campaign_result = service.create_campaign(campaign_data, ad_account_id)
        fb_campaign_id = dict(campaign_result).get('id')
        if not fb_campaign_id:
            raise Exception("No campaign ID returned")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create campaign: {str(e)}")

    # Step 2: Upload image + create creative ONCE upfront (before background task)
    # This saves 2 API calls per ad set (image upload + creative creation)
    creative = creative_data.get('creatives', [{}])[0]
    headlines = creative_data.get('headlines') or creative.get('headlines') or ['']
    bodies = creative_data.get('bodies') or creative.get('bodies') or ['']

    try:
        # Upload image once
        image_url = creative.get('imageUrl') or creative.get('previewUrl', '')
        video_id = creative.get('videoId')
        image_hash = None
        if image_url and not video_id:
            uploaded = service.upload_image(image_url, ad_account_id)
            # upload_image returns either a bare hash string (typical) or a dict with 'hash'/'image_hash'
            if isinstance(uploaded, str):
                image_hash = uploaded
            else:
                image_hash = uploaded.get('hash') or uploaded.get('image_hash')
                if not image_hash:
                    for key, val in uploaded.items():
                        if isinstance(val, dict) and 'hash' in val:
                            image_hash = val['hash']
                            break

        # Create creative once
        creative_payload = {
            'name': f"{campaign_data.get('name', 'Bahiana')} Creative",
            'page_id': creative_data.get('pageId'),
            'headline': headlines[0] if headlines else '',
            'primary_text': bodies[0] if bodies else '',
            'description': creative_data.get('description') or creative.get('description', ''),
            'cta': creative_data.get('cta') or creative.get('cta', 'LEARN_MORE'),
            'website_url': creative_data.get('websiteUrl', ''),
            'image_hash': image_hash,
            'video_id': video_id,
        }
        creative_result = service.create_creative(creative_payload, ad_account_id)
        shared_creative_id = creative_result.get('id') or (dict(creative_result).get('id') if hasattr(creative_result, '__iter__') else None)
        if not shared_creative_id:
            raise Exception("No creative ID returned")
        logger.info(f"Bahiana: shared creative created: {shared_creative_id}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create creative: {str(e)}")

    # Step 3: Create N ad sets + 1 ad each in background (only 2 API calls per set now)
    def _run_bahiana():
        from app.database import SessionLocal
        import time as _time
        bg_db = SessionLocal()
        try:
            bg_service = FacebookService(connection=None)
            bg_service.api = service.api
            bg_service.account = service.account

            results = {"created": 0, "failed": 0, "errors": [], "adset_ids": []}

            for i in range(num_adsets):
                try:
                    # Create ad set (1 API call)
                    adset_payload = {
                        **adset_data,
                        'name': f"{campaign_data.get('name', 'Bahiana')} - Set {i+1}",
                        'campaign_id': fb_campaign_id,
                        'dailyBudget': budget_per_adset,
                        'daily_budget': budget_per_adset,
                        'budget_type': 'ABO',
                    }
                    adset_result = bg_service.create_adset(adset_payload, ad_account_id)
                    fb_adset_id = dict(adset_result).get('id')

                    if not fb_adset_id:
                        results["failed"] += 1
                        results["errors"].append(f"Set {i+1}: no adset ID returned")
                        continue

                    # Create ad using shared creative (1 API call — no image upload or creative creation)
                    from facebook_business.adobjects.ad import Ad
                    account = bg_service._get_account(ad_account_id)
                    ad_params = {
                        Ad.Field.name: f"{campaign_data.get('name', 'Ad')} - Set {i+1}",
                        Ad.Field.adset_id: fb_adset_id,
                        Ad.Field.creative: {'creative_id': shared_creative_id},
                        Ad.Field.status: campaign_data.get('status', 'ACTIVE'),
                    }
                    account.create_ad(params=ad_params)

                    results["created"] += 1
                    results["adset_ids"].append(fb_adset_id)
                    logger.info(f"Bahiana set {i+1}/{num_adsets} created")

                    # Pace: 1s between each (only 2 API calls per iteration now)
                    if i < num_adsets - 1:
                        _time.sleep(1)

                except Exception as e:
                    results["failed"] += 1
                    results["errors"].append(f"Set {i+1}: {str(e)[:100]}")
                    logger.warning(f"Bahiana set {i+1} failed: {e}")
                    _time.sleep(5)

            logger.info(f"Bahiana launch done: {results['created']}/{num_adsets} created, {results['failed']} failed")
        except Exception as e:
            logger.error(f"Bahiana launch error: {e}", exc_info=True)
        finally:
            bg_db.close()

    background_tasks.add_task(_run_bahiana)

    return {
        "message": f"Bahiana launch started: 1 campaign + {num_adsets} ad sets at ${budget_per_adset}/each",
        "fb_campaign_id": fb_campaign_id,
        "num_adsets": num_adsets,
        "budget_per_adset": budget_per_adset,
    }


# --- Publish Batch endpoints ---

@router.post("/publish-batches")
def create_publish_batch(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Create a batch snapshot AND auto-spawn the background worker.

    Previously this only created the DB row and relied on the frontend (or a
    manual /process call) to actually start the worker. If the frontend never
    called /process — or the page got closed / navigated away mid-publish —
    the batch sat at 0/N forever.
    """
    # Hard cap: max 250 ads per submission (defense in depth; frontend also blocks).
    creative_data = data.get('creative_data') or {}
    creatives = (creative_data.get('creatives') or [])
    existing_post_creatives = [c for c in creatives if c.get('existing_post_id')]
    if len(existing_post_creatives) > 250:
        raise HTTPException(
            status_code=400,
            detail=f"Too many existing-post ads in one submission: {len(existing_post_creatives)} (max 250). Reduce post IDs or copies.",
        )

    # Each existing-post creative must have a unique name (Meta would silently
    # auto-suffix duplicates and break tracking).
    names = [c.get('name') for c in existing_post_creatives if c.get('name')]
    if len(names) != len(set(names)):
        duplicates = sorted({n for n in names if names.count(n) > 1})
        raise HTTPException(
            status_code=400,
            detail=f"Duplicate ad names in submission: {duplicates}. Each copy must have a unique name.",
        )

    batch = PublishBatch(
        status='in_progress',
        fb_campaign_id=data.get('fb_campaign_id'),
        fb_adset_id=data.get('fb_adset_id'),
        campaign_data=data.get('campaign_data'),
        adset_data=data.get('adset_data'),
        creative_data=data.get('creative_data'),
        ads_data=data.get('ads_data'),
        connection_id=data.get('connection_id'),
        ad_account_id=data.get('ad_account_id'),
        total_ads=data.get('total_ads', 0),
        completed_ads=0,
        failed_ads=0,
        error_log=[],
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    # Auto-spawn the worker thread. Uses the connection on the batch so we
    # don't depend on whatever connection the request came in with.
    spawn_error = None
    try:
        conn = None
        if batch.connection_id:
            conn = db.query(FacebookConnection).filter(
                FacebookConnection.id == batch.connection_id,
                FacebookConnection.is_active == True
            ).first()
        if not conn:
            conn = db.query(FacebookConnection).filter(
                FacebookConnection.is_default == True,
                FacebookConnection.is_active == True
            ).first()
        if conn:
            service = FacebookService(connection=conn)
            if not service.api:
                service.initialize()
            thread = threading.Thread(
                target=_process_batch_worker,
                args=(batch.id, service),
                daemon=True,
            )
            thread.start()
            logger.info(f"[publish-batches] auto-spawned worker for batch {batch.id}")
        else:
            spawn_error = f"No active Facebook connection found (batch.connection_id={batch.connection_id}). Reconnect on the Connections page and retry."
            logger.warning(f"[publish-batches] {spawn_error} — worker NOT started for batch {batch.id}")
    except Exception as e:
        import traceback as _tb
        spawn_error = f"Worker spawn failed: {e}"
        logger.exception(f"[publish-batches] failed to auto-spawn worker for batch {batch.id}: {e}")
        # Persist the spawn-failure traceback so we can debug if it happens again
        spawn_error = f"{spawn_error}\n{_tb.format_exc()[-1000:]}"

    # If spawn never produced a worker, surface the failure on the batch row so
    # the UI doesn't show "in_progress" forever. The user can then retry.
    if spawn_error:
        try:
            batch.status = 'failed'
            batch.error_log = (batch.error_log or []) + [{
                'event': 'worker_spawn_failed',
                'error': spawn_error,
            }]
            db.commit()
        except Exception as _e:
            db.rollback()
            logger.exception(f"[publish-batches] couldn't persist spawn error: {_e}")

    return {"id": batch.id, "status": batch.status}


@router.put("/publish-batches/{batch_id}")
def update_publish_batch(
    batch_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Update batch progress after each ad."""
    batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if 'status' in data:
        batch.status = data['status']
    if 'fb_campaign_id' in data:
        batch.fb_campaign_id = data['fb_campaign_id']
    if 'fb_adset_id' in data:
        batch.fb_adset_id = data['fb_adset_id']
    if 'ads_data' in data:
        batch.ads_data = data['ads_data']
    if 'completed_ads' in data:
        batch.completed_ads = data['completed_ads']
    if 'failed_ads' in data:
        batch.failed_ads = data['failed_ads']
    if 'error_log' in data:
        batch.error_log = data['error_log']

    db.commit()
    return {"id": batch.id, "status": batch.status, "completed_ads": batch.completed_ads}


@router.get("/publish-batches/active")
def get_active_batch(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get the most recent active/recent batch. Always returns in_progress; completed/partial only if < 1 hour old."""
    from datetime import datetime, timedelta, timezone
    # Always show in-progress batches
    batch = db.query(PublishBatch).filter(
        PublishBatch.status == 'in_progress'
    ).order_by(PublishBatch.created_at.desc()).first()

    if not batch:
        # Show completed/partial only if less than 1 hour old
        cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
        batch = db.query(PublishBatch).filter(
            PublishBatch.status.in_(['completed', 'partial']),
            PublishBatch.created_at >= cutoff
        ).order_by(PublishBatch.created_at.desc()).first()

    if not batch:
        return None

    return {
        "id": batch.id,
        "status": batch.status,
        "fb_campaign_id": batch.fb_campaign_id,
        "fb_adset_id": batch.fb_adset_id,
        "campaign_data": batch.campaign_data,
        "adset_data": batch.adset_data,
        "creative_data": batch.creative_data,
        "ads_data": batch.ads_data,
        "connection_id": batch.connection_id,
        "ad_account_id": batch.ad_account_id,
        "total_ads": batch.total_ads,
        "completed_ads": batch.completed_ads,
        "failed_ads": batch.failed_ads,
        "error_log": batch.error_log,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


@router.delete("/publish-batches/{batch_id}")
def discard_publish_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Mark batch as discarded."""
    batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch.status = 'discarded'
    db.commit()
    return {"message": "Batch discarded"}


@router.get("/publish-batches/recent")
def get_recent_publish_batches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get the 5 most recent publish batches (for copy restoration)."""
    batches = db.query(PublishBatch).order_by(
        PublishBatch.created_at.desc()
    ).limit(5).all()
    return [{
        "id": b.id,
        "status": b.status,
        "total_ads": b.total_ads,
        "creative_data": b.creative_data,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    } for b in batches]


@router.get("/publish-batches/{batch_id}")
def get_publish_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get a specific batch by ID (for polling progress)."""
    batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {
        "id": batch.id,
        "status": batch.status,
        "fb_campaign_id": batch.fb_campaign_id,
        "fb_adset_id": batch.fb_adset_id,
        "campaign_data": batch.campaign_data,
        "adset_data": batch.adset_data,
        "creative_data": batch.creative_data,
        "ads_data": batch.ads_data,
        "connection_id": batch.connection_id,
        "ad_account_id": batch.ad_account_id,
        "total_ads": batch.total_ads,
        "completed_ads": batch.completed_ads,
        "failed_ads": batch.failed_ads,
        "error_log": batch.error_log,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "updated_at": batch.updated_at.isoformat() if batch.updated_at else None,
    }


# Track active background workers to prevent double-processing
_active_batch_workers = set()
_active_batch_workers_lock = threading.Lock()


@router.post("/publish-batches/{batch_id}/process")
def process_publish_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Start background processing of a publish batch."""
    batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.status not in ('in_progress', 'partial'):
        raise HTTPException(status_code=400, detail=f"Batch is {batch.status}, cannot process")
    # Idempotent: if a worker is already running for this batch (e.g. auto-spawned
    # by POST /publish-batches), report success instead of 409 so the caller's
    # wizard advances cleanly. Cleanup in _process_batch_worker's finally block
    # guarantees this set drains on completion.
    with _active_batch_workers_lock:
        if batch_id in _active_batch_workers:
            return {"status": "already_processing", "batch_id": batch_id}

    # Resolve the Facebook service from connection
    connection_id = batch.connection_id
    if connection_id:
        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == connection_id,
            FacebookConnection.is_active == True
        ).first()
        if conn:
            service = FacebookService(connection=conn)
        else:
            service = FacebookService()
    else:
        default_conn = db.query(FacebookConnection).filter(
            FacebookConnection.is_default == True,
            FacebookConnection.is_active == True
        ).first()
        service = FacebookService(connection=default_conn) if default_conn else FacebookService()

    if not service.api:
        service.initialize()

    # Start background thread
    thread = threading.Thread(
        target=_process_batch_worker,
        args=(batch_id, service),
        daemon=True
    )
    thread.start()

    return {"status": "processing", "batch_id": batch_id}


def _process_batch_worker(batch_id: str, service: FacebookService):
    """Background worker that processes all pending ads in a batch."""
    import hashlib as _hashlib
    import time as _time
    from sqlalchemy import text as _text

    # Cross-process lock: only ONE worker anywhere (across uvicorn worker
    # processes, across containers) may process a given batch at a time.
    # Prevents duplicate ads when auto-resume fires on all 4 uvicorn workers
    # simultaneously after a deploy. pg_advisory_lock is session-scoped, so
    # we keep lock_db open for the entire worker lifetime.
    lock_key = int(_hashlib.md5(batch_id.encode()).hexdigest()[:15], 16) % (2**31)
    lock_db = SessionLocal()
    try:
        got_lock = lock_db.execute(_text("SELECT pg_try_advisory_lock(:k)"), {"k": lock_key}).scalar()
    except Exception as _e:
        print(f"[batch_worker] Advisory lock query failed for {batch_id}: {_e}")
        lock_db.close()
        return
    if not got_lock:
        print(f"[batch_worker] Another worker already holds lock for {batch_id} — skipping")
        lock_db.close()
        return

    with _active_batch_workers_lock:
        _active_batch_workers.add(batch_id)
    db = SessionLocal()
    try:
        batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
        if not batch:
            print(f"[batch_worker] Batch {batch_id} not found")
            return

        # Heartbeat: record that the worker actually started executing. If the
        # worker dies silently before processing the first ad, this row tells us
        # that the spawn worked but execution failed mid-flight (vs. spawn never
        # happening at all). Writes to error_log + bumps updated_at.
        try:
            import os as _os
            startup_marker = {
                'event': 'worker_started',
                'pid': _os.getpid(),
                'timestamp': _time.time(),
            }
            existing_log = batch.error_log or []
            batch.error_log = existing_log + [startup_marker]
            db.commit()
            print(f"[batch_worker] Started for batch {batch_id} (pid={_os.getpid()})")
        except Exception as _hb_err:
            print(f"[batch_worker] Heartbeat write failed (non-fatal): {_hb_err}")
            db.rollback()

        ads_data = batch.ads_data or []
        ad_account_id = batch.ad_account_id
        creative_data = batch.creative_data or {}
        fb_campaign_id = batch.fb_campaign_id
        fb_adset_id = batch.fb_adset_id
        campaign_data = batch.campaign_data or {}
        adset_data = batch.adset_data or {}
        page_id = creative_data.get('pageId')

        completed_count = batch.completed_ads or 0
        failed_count = batch.failed_ads or 0
        error_log = batch.error_log or []

        def _set_stage(idx, stage):
            """Mark current ad's stage and commit so the widget can display it."""
            try:
                ads_data[idx]['stage'] = stage
                b = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
                if b:
                    b.ads_data = ads_data
                    db.commit()
            except Exception as _e:
                print(f"[batch_worker] stage update failed (non-fatal): {_e}")
                try: db.rollback()
                except Exception: pass

        print(f"[batch_worker] Starting batch {batch_id}: {len(ads_data)} ads, {completed_count} already done")

        # Count existing-post ads up-front so the pacing helper knows the total
        # (mixed batches: video/image/existing-post; pacing only applies to existing-post).
        existing_post_total = sum(
            1 for a in ads_data
            if a.get('publishStatus') != 'created' and any(
                (c.get('id') == a.get('creativeId') and c.get('existing_post_id'))
                for c in (creative_data.get('creatives') or [])
            )
        ) or sum(
            # Fallback: count by creative_data.existing_post_id (legacy single-post path)
            1 for a in ads_data
            if a.get('publishStatus') != 'created' and creative_data.get('existing_post_id')
        )
        existing_post_seen = 0

        for i, ad in enumerate(ads_data):
            if ad.get('publishStatus') == 'created':
                continue  # Already published

            ad_name = ad.get('name', f'Ad {i+1}')
            print(f"[batch_worker] Processing ad {i+1}/{len(ads_data)}: {ad_name}")

            try:
                # Find the specific creative for this ad
                creative_id_ref = ad.get('creativeId')
                specific_creative = None
                for c in (creative_data.get('creatives') or []):
                    if c.get('id') == creative_id_ref:
                        specific_creative = c
                        break

                is_video = specific_creative.get('mediaType') == 'video' if specific_creative else False

                # Existing-post path: skip media upload + creative composition.
                # The ad references an existing FB post via object_story_id and inherits its engagement.
                existing_post_id = (specific_creative or {}).get('existing_post_id') or creative_data.get('existing_post_id')
                if existing_post_id and str(existing_post_id).strip():
                    print(f"[batch_worker] Creating ad from existing post: {existing_post_id}")
                    # Pace bulk-copy submissions to avoid Meta 429s.
                    import time as _pacing_time
                    sleep_s = compute_sleep_for_index(existing_post_seen, existing_post_total)
                    if sleep_s > 0:
                        print(f"[batch_worker] Pacing sleep {sleep_s}s before existing-post ad {existing_post_seen + 1}/{existing_post_total}")
                        _pacing_time.sleep(sleep_s)
                    existing_post_seen += 1
                    creative_result = service.create_creative_from_post(
                        post_id=str(existing_post_id).strip(),
                        page_id=page_id,
                        name=ad_name[:250],
                        ad_account_id=ad_account_id,
                    )
                    fb_creative_id = creative_result.get('id') or dict(creative_result).get('id')

                    ad_payload = {
                        'name': ad_name,
                        'adset_id': fb_adset_id,
                        'creative_id': fb_creative_id,
                        'status': 'ACTIVE',
                    }
                    ad_result = service.create_ad(ad_payload, ad_account_id)
                    fb_ad_id = ad_result.get('id') or dict(ad_result).get('id')

                    ads_data[i]['publishStatus'] = 'created'
                    ads_data[i]['fbAdId'] = fb_ad_id
                    ads_data[i]['fbCreativeId'] = fb_creative_id
                    ads_data[i]['existingPostId'] = str(existing_post_id).strip()
                    completed_count += 1
                    print(f"[batch_worker] Existing-post ad created: {ad_name} -> {fb_ad_id}")

                    # Inline DB progress update (mirrors the post-loop block) so the
                    # frontend sees the batch advance instead of being stuck at 0%.
                    try:
                        batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
                        if batch:
                            batch.ads_data = ads_data
                            batch.completed_ads = completed_count
                            batch.failed_ads = failed_count
                            batch.error_log = error_log
                            total = len(ads_data)
                            if completed_count + failed_count >= total:
                                batch.status = 'partial' if failed_count > 0 else 'completed'
                            db.commit()
                    except Exception as db_err:
                        print(f"[batch_worker] DB update failed (non-fatal): {db_err}")
                        db.rollback()
                    continue

                # Resolve copy for this ad
                if ad.get('perCreative') and specific_creative:
                    c_headlines = [h for h in (specific_creative.get('headlines') or []) if h and h.strip()]
                    c_bodies = [b for b in (specific_creative.get('bodies') or []) if b and b.strip()]
                    ad_headlines = [c_headlines[ad.get('headlineIndex', 0)] if c_headlines else 'Headline']
                    ad_bodies = [c_bodies[ad.get('bodyIndex', 0)] if c_bodies else 'Body']
                    ad_description = specific_creative.get('description') or creative_data.get('description')
                    ad_cta = specific_creative.get('cta') or creative_data.get('cta')
                else:
                    headlines_list = creative_data.get('headlines') or ['Headline']
                    bodies_list = creative_data.get('bodies') or ['Body']
                    ad_headlines = [headlines_list[ad.get('headlineIndex', 0)] if headlines_list else 'Headline']
                    ad_bodies = [bodies_list[ad.get('bodyIndex', 0)] if bodies_list else 'Body']
                    ad_description = creative_data.get('description')
                    ad_cta = creative_data.get('cta')

                # Build creative payload (same format the frontend sends)
                # Use ad_name (short) as creative name, not the full copy
                # Per-ad URL takes precedence over campaign-wide default
                ad_website_url = (ad.get('websiteUrl') or '').strip() or creative_data.get('websiteUrl', '')
                creative_payload = {
                    'name': ad_name[:250],
                    'page_id': page_id,
                    'primary_text': ad_bodies[0],
                    'headline': ad_headlines[0][:250] if ad_headlines[0] else '',
                    'description': (ad_description or '')[:250],
                    'cta': ad_cta or 'LEARN_MORE',
                    'website_url': ad_website_url,
                    'bodies': ad_bodies,
                    'headlines': ad_headlines,
                }

                # Upload media and create creative
                image_hash = None
                video_data = None

                if is_video:
                    # Pre-uploaded video escape hatch: if the ad/creative supplies
                    # an existing FB video_id (e.g. uploaded manually via Ads
                    # Manager), skip our broken upload pipeline entirely and use
                    # that ID directly. The video is already on FB.
                    preuploaded_video_id = (
                        ad.get('fb_video_id')
                        or specific_creative.get('fb_video_id')
                        or specific_creative.get('videoId')
                    )
                    if preuploaded_video_id:
                        print(f"[batch_worker] Using pre-uploaded video_id={preuploaded_video_id} (skipping API upload)")
                        _set_stage(i, 'uploading_to_fb')
                        video_result = {'video_id': str(preuploaded_video_id), 'thumbnails': []}
                    else:
                        video_url = specific_creative.get('videoUrl') or specific_creative.get('previewUrl')
                        if not video_url:
                            raise Exception('Video URL missing for this creative')

                        print(f"[batch_worker] Uploading video: {video_url[:80]}...")
                        _set_stage(i, 'uploading_to_fb')
                        # Uploads go to /<page_id>/videos (NOT /<account>/advideos
                        # which silently quarantines). Page comes from creative_data.
                        # 20 min ceiling — file_url path needs time for FB to download
                        # from R2 AND transcode, so 10 min was sometimes tight.
                        video_result = service.upload_video(
                            video_url,
                            ad_account_id,
                            wait_for_ready=True,
                            timeout=1200,
                            page_id=page_id,
                        )
                    creative_payload['video_id'] = video_result['video_id']
                    # User-picked thumbnail wins; fall back to FB's auto-generated one.
                    user_thumb = specific_creative.get('thumbnailUrl') if specific_creative else None
                    # FB requires absolute https URLs. Frame paths from the picker
                    # come back as /uploads/thumbnails/... — resolve them against
                    # BACKEND_PUBLIC_URL (or Railway's public domain).
                    def _absolute_url(u):
                        if not u: return u
                        if u.startswith('http://') or u.startswith('https://'): return u
                        if u.startswith('/') and settings.BACKEND_PUBLIC_URL:
                            return f"{settings.BACKEND_PUBLIC_URL.rstrip('/')}{u}"
                        return u
                    if user_thumb:
                        user_thumb = _absolute_url(user_thumb)
                        creative_payload['thumbnail_url'] = user_thumb
                        print(f"[batch_worker] Using user-picked thumbnail: {user_thumb[:120]}")
                    elif video_result.get('thumbnails'):
                        creative_payload['thumbnail_url'] = _absolute_url(video_result['thumbnails'][0])
                    video_data = video_result
                else:
                    image_url = specific_creative.get('imageUrl') or specific_creative.get('previewUrl')
                    if not image_url:
                        raise Exception('Image URL missing for this creative')

                    # Check for multi-aspect-ratio variants
                    variants = specific_creative.get('variants')
                    if variants and isinstance(variants, dict) and len(variants) > 1:
                        image_hashes = service.upload_images(variants, ad_account_id)
                        creative_payload['image_hashes'] = image_hashes
                    else:
                        image_hash = service.upload_image(image_url, ad_account_id)
                        creative_payload['image_hash'] = image_hash

                print(f"[batch_worker] Creating creative for: {ad_name}")
                _set_stage(i, 'creating_creative')
                creative_result = service.create_creative(creative_payload, ad_account_id)
                fb_creative_id = creative_result.get('id') or dict(creative_result).get('id')

                # Create the ad
                print(f"[batch_worker] Creating ad: {ad_name}")
                _set_stage(i, 'creating_ad')
                ad_payload = {
                    'name': ad_name,
                    'adset_id': fb_adset_id,
                    'creative_id': fb_creative_id,
                    'status': 'ACTIVE',
                }
                ad_result = service.create_ad(ad_payload, ad_account_id)
                fb_ad_id = ad_result.get('id') or dict(ad_result).get('id')

                # Post first comment if provided
                first_comment = None
                if ad.get('perCreative') and specific_creative:
                    first_comment = specific_creative.get('first_comment')
                if not first_comment:
                    first_comment = ad.get('first_comment') or creative_data.get('first_comment')
                if first_comment and first_comment.strip() and fb_ad_id:
                    try:
                        import time
                        time.sleep(2)  # Brief delay for ad post to propagate
                        comment_result = service.post_first_comment(fb_ad_id, first_comment.strip())
                        print(f"[batch_worker] First comment posted on {fb_ad_id}: {comment_result.get('id')}")
                        ads_data[i]['firstCommentId'] = comment_result.get('id')
                    except Exception as ce:
                        print(f"[batch_worker] First comment failed for {fb_ad_id}: {ce}")
                        # Non-fatal — ad was still created successfully

                # Mark success
                ads_data[i]['publishStatus'] = 'created'
                ads_data[i]['fbAdId'] = fb_ad_id
                ads_data[i]['fbCreativeId'] = fb_creative_id
                if video_data:
                    ads_data[i]['videoId'] = video_data.get('video_id')
                completed_count += 1
                print(f"[batch_worker] Ad created: {ad_name} -> {fb_ad_id}")

            except Exception as e:
                print(f"[batch_worker] Failed ad {ad_name}: {e}")
                ads_data[i]['publishStatus'] = 'failed'
                ads_data[i]['error'] = str(e)
                failed_count += 1
                error_log.append({'adId': ad.get('id'), 'adName': ad_name, 'error': str(e)})

            # Update batch progress in DB after each ad
            try:
                batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
                if batch:
                    batch.ads_data = ads_data
                    batch.completed_ads = completed_count
                    batch.failed_ads = failed_count
                    batch.error_log = error_log
                    total = len(ads_data)
                    if completed_count + failed_count >= total:
                        batch.status = 'partial' if failed_count > 0 else 'completed'
                    db.commit()
            except Exception as db_err:
                print(f"[batch_worker] DB update failed (non-fatal): {db_err}")
                db.rollback()

        print(f"[batch_worker] Batch {batch_id} done: {completed_count} created, {failed_count} failed")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[batch_worker] Fatal error in batch {batch_id}: {e}\n{tb}")
        # Surface the failure in the batch row so the UI shows it, instead of
        # leaving the batch stuck in 'in_progress' forever (the silent-death case).
        try:
            batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
            if batch:
                existing = batch.error_log or []
                batch.error_log = existing + [{
                    'event': 'worker_fatal',
                    'error': str(e),
                    'traceback': tb[-1500:],  # last 1500 chars
                }]
                # If anything was created, mark partial; otherwise flip to failed
                # so the UI doesn't keep showing the batch as "still working".
                if (batch.completed_ads or 0) > 0:
                    batch.status = 'partial'
                else:
                    batch.status = 'failed'
                db.commit()
        except Exception as _persist_err:
            print(f"[batch_worker] Could not persist fatal error to batch row: {_persist_err}")
            try: db.rollback()
            except: pass
    finally:
        with _active_batch_workers_lock:
            _active_batch_workers.discard(batch_id)
        db.close()
        try:
            lock_db.execute(_text("SELECT pg_advisory_unlock(:k)"), {"k": lock_key})
            lock_db.commit()
        except Exception:
            pass
        lock_db.close()


# ── Scheduled Budget Changes ────────────────────────────────────────


def _parse_scheduled_for(value: Optional[str], now_est: Optional[datetime] = None) -> datetime:
    """Parse optional ISO datetime. None → next midnight EST. Naive → assumed EST."""
    est = pytz.timezone('US/Eastern')
    if now_est is None:
        now_est = datetime.now(est)

    if value is None:
        base = datetime(now_est.year, now_est.month, now_est.day) + timedelta(days=1)
        return est.localize(base)

    try:
        parsed = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid scheduled_for: {value!r}")

    if parsed.tzinfo is None:
        parsed = est.localize(parsed)

    delta_s = (parsed - now_est).total_seconds()
    if delta_s <= 0:
        raise ValueError("scheduled_for must be in the future")
    if delta_s < 60:
        raise ValueError("scheduled_for must be at least 60 seconds in the future")
    return parsed


@router.post("/schedule-budget")
def schedule_budget_change(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write"))
):
    """Schedule a budget change for a specified EST time (defaults to next midnight EST)."""
    object_id = data.get('object_id')
    object_type = data.get('object_type')
    new_budget_cents = data.get('new_budget_cents')
    ad_account_id = data.get('ad_account_id')
    connection_id = data.get('connection_id')

    if not all([object_id, object_type, new_budget_cents, ad_account_id, connection_id]):
        raise HTTPException(status_code=400, detail="object_id, object_type, new_budget_cents, ad_account_id, and connection_id are required")
    if object_type not in ('campaign', 'adset'):
        raise HTTPException(status_code=400, detail="object_type must be 'campaign' or 'adset'")

    try:
        scheduled_for_dt = _parse_scheduled_for(data.get('scheduled_for'))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Cancel any existing pending change for this object
    db.query(ScheduledBudgetChange).filter(
        ScheduledBudgetChange.fb_object_id == object_id,
        ScheduledBudgetChange.status == 'pending',
    ).update({'status': 'cancelled'})

    change = ScheduledBudgetChange(
        fb_object_id=object_id,
        object_type=object_type,
        new_daily_budget=int(new_budget_cents),
        scheduled_for=scheduled_for_dt,
        connection_id=connection_id,
        ad_account_id=ad_account_id,
    )
    db.add(change)
    db.commit()

    return {
        "id": change.id,
        "fb_object_id": object_id,
        "new_daily_budget": change.new_daily_budget,
        "scheduled_for": scheduled_for_dt.isoformat(),
        "status": "pending",
    }


@router.get("/scheduled-budgets")
def get_scheduled_budgets(
    ad_account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List pending scheduled budget changes."""
    q = db.query(ScheduledBudgetChange).filter(ScheduledBudgetChange.status == 'pending')
    if ad_account_id:
        q = q.filter(ScheduledBudgetChange.ad_account_id == ad_account_id)
    changes = q.order_by(ScheduledBudgetChange.scheduled_for).all()
    return [
        {
            "id": c.id,
            "fb_object_id": c.fb_object_id,
            "object_type": c.object_type,
            "new_daily_budget": c.new_daily_budget,
            "scheduled_for": c.scheduled_for.isoformat() if c.scheduled_for else None,
            "status": c.status,
            "ad_account_id": c.ad_account_id,
        }
        for c in changes
    ]


@router.delete("/scheduled-budgets/{change_id}")
def cancel_scheduled_budget(
    change_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Cancel a pending scheduled budget change."""
    change = db.query(ScheduledBudgetChange).filter(
        ScheduledBudgetChange.id == change_id,
        ScheduledBudgetChange.status == 'pending',
    ).first()
    if not change:
        raise HTTPException(status_code=404, detail="Scheduled change not found or already applied")
    change.status = 'cancelled'
    db.commit()
    return {"status": "cancelled", "id": change_id}


# ── Bid Scheduling (recurring bid-cap changes by hour) ───────────────


def _serialize_bid_schedule(s: BidSchedule) -> Dict[str, Any]:
    return {
        "id": s.id,
        "fb_object_id": s.fb_object_id,
        "object_type": s.object_type or "adset",
        "ad_account_id": s.ad_account_id,
        "connection_id": s.connection_id,
        "hour": s.hour,
        "minute": s.minute or 0,
        "active_days": s.active_days or [0, 1, 2, 3, 4, 5, 6],
        "timezone": s.timezone,
        "bid_amount_cents": s.bid_amount_cents,
        "enabled": s.enabled,
        "label": s.label,
        "last_applied_at": s.last_applied_at.isoformat() if s.last_applied_at else None,
        "last_applied_bid_cents": s.last_applied_bid_cents,
        "last_error": s.last_error,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/bid-schedules")
def list_bid_schedules(
    fb_object_id: Optional[str] = Query(None),
    ad_account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List bid schedules, optionally filtered by adset/campaign or ad account."""
    q = db.query(BidSchedule)
    if fb_object_id:
        q = q.filter(BidSchedule.fb_object_id == fb_object_id)
    if ad_account_id:
        q = q.filter(BidSchedule.ad_account_id == ad_account_id)
    rows = q.order_by(BidSchedule.fb_object_id, BidSchedule.hour, BidSchedule.minute).all()
    return [_serialize_bid_schedule(s) for s in rows]


@router.post("/bid-schedules")
def create_bid_schedule(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a recurring bid-cap rule.

    Body: { fb_object_id, object_type ('adset'|'campaign'), ad_account_id, connection_id,
            hour (0-23), minute (0-59, default 0), bid_amount_cents,
            timezone (default 'America/New_York'),
            active_days (list of 0=Mon..6=Sun, default all),
            label (optional), enabled (default true) }
    """
    required = ['fb_object_id', 'ad_account_id', 'connection_id', 'hour', 'bid_amount_cents']
    # Truthy check — rejects None, "", 0 (hour=0 is legitimate, handled below).
    missing = [k for k in required if data.get(k) in (None, "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"missing fields: {', '.join(missing)}")

    object_type = data.get('object_type', 'adset')
    if object_type not in ('adset', 'campaign'):
        raise HTTPException(status_code=400, detail="object_type must be 'adset' or 'campaign'")

    try:
        hour = int(data['hour'])
        minute = int(data.get('minute') or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="hour and minute must be integers")
    if not (0 <= hour <= 23) or not (0 <= minute <= 59):
        raise HTTPException(status_code=400, detail="hour must be 0-23 and minute 0-59")

    try:
        bid_cents = int(data['bid_amount_cents'])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="bid_amount_cents must be an integer")
    if bid_cents <= 0:
        raise HTTPException(status_code=400, detail="bid_amount_cents must be > 0")

    active_days = data.get('active_days')
    if active_days is None:
        active_days = [0, 1, 2, 3, 4, 5, 6]
    if not isinstance(active_days, list) or len(active_days) == 0:
        raise HTTPException(status_code=400, detail="active_days must contain at least one day (0=Mon..6=Sun)")
    if any(not isinstance(d, int) or d not in range(7) for d in active_days):
        raise HTTPException(status_code=400, detail="active_days entries must be integers 0-6")

    tz_str = data.get('timezone') or 'America/New_York'
    try:
        from zoneinfo import ZoneInfo as _Z
        _Z(tz_str)
    except Exception:
        raise HTTPException(status_code=400, detail=f"invalid timezone: {tz_str}")

    # Verify the FK connection exists before insert so we return a clean 400
    # instead of letting Postgres throw an IntegrityError → 500.
    conn_id = str(data['connection_id'])
    if not db.query(FacebookConnection).filter(FacebookConnection.id == conn_id).first():
        raise HTTPException(status_code=400, detail=f"connection_id {conn_id} not found")

    row = BidSchedule(
        fb_object_id=str(data['fb_object_id']),
        object_type=object_type,
        ad_account_id=str(data['ad_account_id']),
        connection_id=conn_id,
        hour=hour,
        minute=minute,
        active_days=active_days,
        timezone=tz_str,
        bid_amount_cents=bid_cents,
        label=data.get('label'),
        enabled=bool(data.get('enabled', True)),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_bid_schedule(row)


@router.patch("/bid-schedules/{schedule_id}")
def update_bid_schedule(
    schedule_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Update a bid schedule. Any of: hour, minute, active_days, timezone,
    bid_amount_cents, enabled, label."""
    row = db.query(BidSchedule).filter(BidSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="bid schedule not found")

    if 'hour' in data:
        try:
            h = int(data['hour'])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="hour must be an integer")
        if not (0 <= h <= 23):
            raise HTTPException(status_code=400, detail="hour must be 0-23")
        row.hour = h
    if 'minute' in data:
        try:
            m = int(data['minute'])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="minute must be an integer")
        if not (0 <= m <= 59):
            raise HTTPException(status_code=400, detail="minute must be 0-59")
        row.minute = m
    if 'active_days' in data:
        days = data['active_days']
        if not isinstance(days, list) or len(days) == 0:
            raise HTTPException(status_code=400, detail="active_days must contain at least one day (0=Mon..6=Sun)")
        if any(not isinstance(d, int) or d not in range(7) for d in days):
            raise HTTPException(status_code=400, detail="active_days entries must be integers 0-6")
        row.active_days = days
    if 'timezone' in data:
        tz_val = data.get('timezone')
        if not tz_val:
            raise HTTPException(status_code=400, detail="timezone cannot be empty")
        try:
            from zoneinfo import ZoneInfo as _Z
            _Z(tz_val)
        except Exception:
            raise HTTPException(status_code=400, detail=f"invalid timezone: {tz_val}")
        row.timezone = tz_val
    if 'bid_amount_cents' in data:
        try:
            bc = int(data['bid_amount_cents'])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="bid_amount_cents must be an integer")
        if bc <= 0:
            raise HTTPException(status_code=400, detail="bid_amount_cents must be > 0")
        row.bid_amount_cents = bc
    if 'enabled' in data:
        row.enabled = bool(data['enabled'])
    if 'label' in data:
        row.label = data['label']

    db.commit()
    db.refresh(row)
    return _serialize_bid_schedule(row)


@router.delete("/bid-schedules/{schedule_id}")
def delete_bid_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    row = db.query(BidSchedule).filter(BidSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="bid schedule not found")
    db.delete(row)
    db.commit()
    return {"deleted": schedule_id}


@router.post("/bid-schedules/{schedule_id}/run-now")
def run_bid_schedule_now(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Manually trigger one bid schedule (for testing). Bypasses the time-window check."""
    row = db.query(BidSchedule).filter(BidSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="bid schedule not found")
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == row.connection_id,
        FacebookConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=400, detail="connection inactive or missing")

    service = FacebookService(connection=conn)
    if not service.api:
        service.initialize()
    try:
        result = service.update_bid(
            row.fb_object_id, row.object_type or 'adset', row.bid_amount_cents
        )
    except FacebookRequestError as e:
        row.last_applied_at = datetime.utcnow()
        row.last_error = str(e)[:500]
        db.commit()
        raise _fb_http_error(e, default_status=400)
    except Exception as e:
        row.last_applied_at = datetime.utcnow()
        row.last_error = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))

    row.last_applied_at = datetime.utcnow()
    if result.get('action') in ('updated', 'skipped_same'):
        row.last_applied_bid_cents = row.bid_amount_cents
        row.last_error = None
    elif result.get('action') == 'skipped_strategy':
        row.last_error = f"strategy={result.get('bid_strategy')} not capped"
    db.commit()
    return {"schedule": _serialize_bid_schedule(row), "fb_result": result}


# ── Bid Schedule Presets (named templates of bid-cap rules) ──────────


def _normalize_preset_rule(r: Dict[str, Any]) -> Dict[str, Any]:
    """Validate + normalize one rule for storage in a preset."""
    try:
        hour = int(r['hour'])
        minute = int(r.get('minute') or 0)
        bid_cents = int(r['bid_amount_cents'])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"rule missing/invalid hour/minute/bid_amount_cents: {r}")
    if not (0 <= hour <= 23) or not (0 <= minute <= 59):
        raise HTTPException(status_code=400, detail="rule hour must be 0-23 and minute 0-59")
    if bid_cents <= 0:
        raise HTTPException(status_code=400, detail="rule bid_amount_cents must be > 0")
    # Explicit None check — `or` falsy-mask would silently turn an empty list
    # into "all days", lying to the user (caught by edge agent).
    days = r.get('active_days')
    if days is None:
        days = [0, 1, 2, 3, 4, 5, 6]
    if not isinstance(days, list) or len(days) == 0 or any(not isinstance(d, int) or d not in range(7) for d in days):
        raise HTTPException(status_code=400, detail="rule active_days must be a non-empty list of ints 0-6")
    tz_str = r.get('timezone') or 'America/New_York'
    try:
        from zoneinfo import ZoneInfo as _Z
        _Z(tz_str)
    except Exception:
        raise HTTPException(status_code=400, detail=f"rule invalid timezone: {tz_str}")
    return {
        "hour": hour,
        "minute": minute,
        "bid_amount_cents": bid_cents,
        "active_days": sorted(days),
        "timezone": tz_str,
        "label": r.get('label'),
    }


def _serialize_preset(p: BidSchedulePreset) -> Dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "rules": p.rules or [],
        "rule_count": len(p.rules or []),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/bid-schedule-presets")
def list_bid_schedule_presets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all bid-schedule presets, alphabetical by name."""
    return [_serialize_preset(p) for p in db.query(BidSchedulePreset).order_by(BidSchedulePreset.name).all()]


@router.post("/bid-schedule-presets")
def create_bid_schedule_preset(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a named preset from a list of rule templates.

    Body: { name: "FSP-USA", rules: [{hour, minute, bid_amount_cents, active_days, timezone, label}, ...] }

    Or to clone from an existing object's current rules:
    Body: { name: "FSP-USA", from_object_id: "..." }
    """
    name = (data.get('name') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if db.query(BidSchedulePreset).filter(BidSchedulePreset.name == name).first():
        raise HTTPException(status_code=409, detail=f"preset '{name}' already exists")

    rules_in = data.get('rules')
    from_object_id = data.get('from_object_id')
    if rules_in is None and from_object_id:
        existing = db.query(BidSchedule).filter(BidSchedule.fb_object_id == str(from_object_id)).all()
        if not existing:
            raise HTTPException(status_code=400, detail=f"no bid schedules on object {from_object_id}")
        rules_in = [
            {
                'hour': s.hour, 'minute': s.minute or 0,
                'bid_amount_cents': s.bid_amount_cents,
                'active_days': s.active_days or [0, 1, 2, 3, 4, 5, 6],
                'timezone': s.timezone, 'label': s.label,
            } for s in existing
        ]
    if not isinstance(rules_in, list) or len(rules_in) == 0:
        raise HTTPException(status_code=400, detail="rules must be a non-empty list")

    normalized = [_normalize_preset_rule(r) for r in rules_in]

    preset = BidSchedulePreset(name=name, rules=normalized)
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return _serialize_preset(preset)


@router.delete("/bid-schedule-presets/{preset_id}")
def delete_bid_schedule_preset(
    preset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    preset = db.query(BidSchedulePreset).filter(BidSchedulePreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="preset not found")
    db.delete(preset)
    db.commit()
    return {"deleted": preset_id}


@router.post("/bid-schedule-presets/{preset_id}/apply")
def apply_bid_schedule_preset(
    preset_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Apply a preset's rules to a target campaign or adset.

    Body: { fb_object_id, object_type ('adset'|'campaign'), ad_account_id, connection_id,
            replace: bool (default false — append + skip duplicates by (hour, minute)) }

    Returns: { created: [...new schedule rows...], skipped_duplicates: [{hour, minute}, ...] }
    """
    preset = db.query(BidSchedulePreset).filter(BidSchedulePreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="preset not found")

    required = ['fb_object_id', 'ad_account_id', 'connection_id']
    missing = [k for k in required if data.get(k) in (None, "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"missing fields: {', '.join(missing)}")

    object_type = data.get('object_type', 'adset')
    if object_type not in ('adset', 'campaign'):
        raise HTTPException(status_code=400, detail="object_type must be 'adset' or 'campaign'")

    fb_object_id = str(data['fb_object_id'])
    conn_id = str(data['connection_id'])
    if not db.query(FacebookConnection).filter(FacebookConnection.id == conn_id).first():
        raise HTTPException(status_code=400, detail=f"connection_id {conn_id} not found")

    replace = bool(data.get('replace', False))
    if replace:
        db.query(BidSchedule).filter(BidSchedule.fb_object_id == fb_object_id).delete()
        db.commit()
        existing_keys = set()
    else:
        existing = db.query(BidSchedule).filter(BidSchedule.fb_object_id == fb_object_id).all()
        existing_keys = {(s.hour, s.minute or 0) for s in existing}

    created = []
    skipped = []
    for rule in (preset.rules or []):
        key = (rule['hour'], rule.get('minute') or 0)
        if key in existing_keys:
            skipped.append({'hour': key[0], 'minute': key[1]})
            continue
        row = BidSchedule(
            fb_object_id=fb_object_id,
            object_type=object_type,
            ad_account_id=str(data['ad_account_id']),
            connection_id=conn_id,
            hour=rule['hour'],
            minute=rule.get('minute') or 0,
            active_days=rule.get('active_days') or [0, 1, 2, 3, 4, 5, 6],
            timezone=rule.get('timezone') or 'America/New_York',
            bid_amount_cents=rule['bid_amount_cents'],
            label=rule.get('label'),
            enabled=True,
        )
        db.add(row)
        existing_keys.add(key)
        created.append(row)

    db.commit()
    for row in created:
        db.refresh(row)
    return {
        "preset": _serialize_preset(preset),
        "created": [_serialize_bid_schedule(r) for r in created],
        "skipped_duplicates": skipped,
        "replaced": replace,
    }


# ── Quick Create Ad Set ──────────────────────────────────────────────


@router.post("/quick-create-adset")
def quick_create_adset(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Quick-create an ad set into an existing campaign."""
    campaign_id = data.get("campaign_id")
    if not campaign_id:
        raise HTTPException(status_code=400, detail="campaign_id is required")
    try:
        result = service.create_adset(data, data.get("ad_account_id"))
        return {"id": dict(result).get("id", str(result)), "created": True}
    except FacebookRequestError as e:
        raise _fb_http_error(e, default_status=400)


# ── Quick Create Ad ──────────────────────────────────────────────────


@router.post("/quick-create-ad")
def quick_create_ad(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a creative + ad in one shot into an existing adset."""
    adset_id = data.get("adset_id")
    ad_account_id = data.get("ad_account_id")
    if not adset_id:
        raise HTTPException(status_code=400, detail="adset_id is required")
    try:
        result = service.quick_create_ad(adset_id, data, ad_account_id)
        return result
    except FacebookRequestError as e:
        raise _fb_http_error(e, default_status=400)


# ── Budget Scheduling (FB Native) ────────────────────────────────────


@router.get("/budget-schedules/{object_id}")
def get_budget_schedules(
    object_id: str,
    object_type: str = Query("campaign"),
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(get_current_active_user),
):
    """Get budget schedules for a campaign or adset."""
    try:
        return service.get_budget_schedules(object_id, object_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/budget-schedules/{object_id}")
def create_budget_schedule(
    object_id: str,
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Create a budget schedule. Body: { object_type, budget_value (cents), time_start, time_end }"""
    try:
        object_type = data.pop("object_type", "campaign")
        return service.create_budget_schedule(object_id, object_type, data)
    except FacebookRequestError as e:
        raise _fb_http_error(e, default_status=400)


@router.delete("/budget-schedules/{schedule_id}")
def delete_budget_schedule(
    schedule_id: str,
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Remove a budget schedule."""
    try:
        return service.delete_budget_schedule(schedule_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Edit Campaign ────────────────────────────────────────────────────


@router.patch("/campaign/{campaign_id}")
def update_campaign(
    campaign_id: str,
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Update a campaign — name, budget, bid strategy, etc."""
    try:
        result = service.update_campaign(campaign_id, data)
        return result
    except FacebookRequestError as e:
        raise _fb_http_error(e, default_status=400)


# ── Edit Ad Set ──────────────────────────────────────────────────────


@router.patch("/adset/{adset_id}")
def update_adset(
    adset_id: str,
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Update an ad set — budget, targeting, bid, name, schedule, etc."""
    try:
        result = service.update_adset(adset_id, data)
        return result
    except FacebookRequestError as e:
        raise _fb_http_error(e, default_status=400)


# ── Quick Bid Edit (live change, not scheduled) ─────────────────────


@router.post("/quick-bid")
def quick_bid(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Live-update bid_amount on a campaign or adset.

    Body: { object_id, object_type ('campaign'|'adset'), bid_amount_cents, force? }

    Wraps service.update_bid which validates the object is on a capped
    bid strategy (LOWEST_COST_WITH_BID_CAP / COST_CAP / etc.) before
    pushing to Meta. Returns action: 'updated' | 'skipped_same' | 'skipped_strategy'.
    """
    object_id = data.get('object_id')
    object_type = data.get('object_type')
    bid_amount_cents = data.get('bid_amount_cents')
    force = bool(data.get('force', False))

    if not object_id:
        raise HTTPException(status_code=400, detail="object_id required")
    if object_type not in ('campaign', 'adset'):
        raise HTTPException(
            status_code=400,
            detail="object_type must be 'campaign' or 'adset'",
        )
    try:
        bid_cents = int(bid_amount_cents)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="bid_amount_cents must be an integer")
    if bid_cents <= 0:
        raise HTTPException(status_code=400, detail="bid_amount_cents must be > 0")

    try:
        return service.update_bid(object_id, object_type, bid_cents, force=force)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FacebookRequestError as e:
        raise _fb_http_error(e, default_status=400)


# ── Auto-Safe Log ───────────────────────────────────────────────────


@router.get("/auto-safe-log")
def get_auto_safe_log(
    ad_account_id: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """View recent auto-safe actions."""
    q = db.query(AutoSafeLog)
    if ad_account_id:
        q = q.filter(AutoSafeLog.ad_account_id == ad_account_id)
    logs = q.order_by(AutoSafeLog.safed_at.desc()).limit(limit).all()
    return [
        {
            "id": l.id,
            "fb_ad_id": l.fb_ad_id,
            "fb_ad_name": l.fb_ad_name,
            "rejection_reasons": l.rejection_reasons,
            "status": l.status,
            "error_message": l.error_message,
            "safed_at": l.safed_at.isoformat() if l.safed_at else None,
        }
        for l in logs
    ]


# ── Dayparting ──────────────────────────────────────────────────────

@router.post("/daypart")
def upsert_daypart_schedule(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    fb_adset_id = data.get("fb_adset_id")
    if not fb_adset_id:
        raise HTTPException(status_code=400, detail="fb_adset_id is required")

    existing = db.query(DaypartSchedule).filter(
        DaypartSchedule.fb_adset_id == fb_adset_id
    ).first()

    if existing:
        existing.ad_account_id = data.get("ad_account_id", existing.ad_account_id)
        existing.connection_id = data.get("connection_id", existing.connection_id)
        existing.active_start_hour = data.get("active_start_hour", existing.active_start_hour)
        existing.active_start_minute = data.get("active_start_minute", existing.active_start_minute)
        existing.active_end_hour = data.get("active_end_hour", existing.active_end_hour)
        existing.active_end_minute = data.get("active_end_minute", existing.active_end_minute)
        existing.active_days = data.get("active_days", existing.active_days)
        existing.timezone = data.get("timezone", existing.timezone)
        existing.enabled = data.get("enabled", existing.enabled)
        existing.object_type = data.get("object_type", existing.object_type)
        # Reset last_action so cron re-evaluates
        existing.last_action = None
        existing.last_action_at = None
        db.commit()
        db.refresh(existing)
        schedule = existing
    else:
        schedule = DaypartSchedule(
            fb_adset_id=fb_adset_id,
            object_type=data.get("object_type", "adset"),
            ad_account_id=data.get("ad_account_id", ""),
            connection_id=data.get("connection_id", ""),
            active_start_hour=data.get("active_start_hour", 6),
            active_start_minute=data.get("active_start_minute", 0),
            active_end_hour=data.get("active_end_hour", 22),
            active_end_minute=data.get("active_end_minute", 0),
            active_days=data.get("active_days", [0, 1, 2, 3, 4, 5, 6]),
            timezone=data.get("timezone", "America/New_York"),
            enabled=data.get("enabled", True),
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)

    return _serialize_daypart(schedule)


@router.get("/daypart")
def list_daypart_schedules(
    ad_account_id: Optional[str] = Query(None),
    connection_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(DaypartSchedule)
    if ad_account_id:
        q = q.filter(DaypartSchedule.ad_account_id == ad_account_id)
    if connection_id:
        q = q.filter(DaypartSchedule.connection_id == connection_id)
    schedules = q.order_by(DaypartSchedule.created_at.desc()).all()
    return [_serialize_daypart(s) for s in schedules]


@router.delete("/daypart/{schedule_id}")
def delete_daypart_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    schedule = db.query(DaypartSchedule).filter(DaypartSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Daypart schedule not found")
    db.delete(schedule)
    db.commit()
    return {"success": True}


@router.patch("/daypart/{schedule_id}/toggle")
def toggle_daypart_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    schedule = db.query(DaypartSchedule).filter(DaypartSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Daypart schedule not found")
    schedule.enabled = not schedule.enabled
    # Reset last_action so cron re-evaluates on next run
    schedule.last_action = None
    schedule.last_action_at = None
    db.commit()
    db.refresh(schedule)
    return _serialize_daypart(schedule)


def _serialize_daypart(s: DaypartSchedule) -> dict:
    return {
        "id": s.id,
        "fb_adset_id": s.fb_adset_id,
        "object_type": getattr(s, 'object_type', 'adset') or 'adset',
        "ad_account_id": s.ad_account_id,
        "connection_id": s.connection_id,
        "active_start_hour": s.active_start_hour,
        "active_start_minute": s.active_start_minute,
        "active_end_hour": s.active_end_hour,
        "active_end_minute": s.active_end_minute,
        "active_days": s.active_days,
        "timezone": s.timezone,
        "enabled": s.enabled,
        "last_action": s.last_action,
        "last_action_at": s.last_action_at.isoformat() if s.last_action_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


# ─── Budget Surfing ──────────────────────────────────────────────────────────


def _serialize_surf_config(c: BudgetSurfConfig) -> dict:
    return {
        "id": c.id,
        "fb_object_id": c.fb_object_id,
        "object_type": c.object_type,
        "ad_account_id": c.ad_account_id,
        "connection_id": c.connection_id,
        "base_budget_cents": c.base_budget_cents,
        "noon_multiplier": c.noon_multiplier,
        "afternoon_multiplier": c.afternoon_multiplier,
        "min_conversions": c.min_conversions,
        "enabled": c.enabled,
        "paused_by_surf": c.paused_by_surf,
        "current_phase": c.current_phase,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.post("/budget-surf")
def create_budget_surf(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Enroll a campaign or adset in budget surfing."""
    fb_object_id = data.get("fb_object_id")
    object_type = data.get("object_type")
    ad_account_id = data.get("ad_account_id")
    connection_id = data.get("connection_id")
    base_budget_cents = data.get("base_budget_cents")

    if not all([fb_object_id, object_type, ad_account_id, connection_id, base_budget_cents]):
        raise HTTPException(status_code=400, detail="fb_object_id, object_type, ad_account_id, connection_id, and base_budget_cents are required")
    if object_type not in ('campaign', 'adset'):
        raise HTTPException(status_code=400, detail="object_type must be 'campaign' or 'adset'")

    existing = db.query(BudgetSurfConfig).filter(BudgetSurfConfig.fb_object_id == fb_object_id).first()
    if existing:
        existing.base_budget_cents = int(base_budget_cents)
        existing.noon_multiplier = data.get("noon_multiplier", existing.noon_multiplier)
        existing.afternoon_multiplier = data.get("afternoon_multiplier", existing.afternoon_multiplier)
        existing.min_conversions = data.get("min_conversions", existing.min_conversions)
        existing.enabled = True
        db.commit()
        db.refresh(existing)
        return _serialize_surf_config(existing)

    config = BudgetSurfConfig(
        fb_object_id=fb_object_id,
        object_type=object_type,
        ad_account_id=ad_account_id,
        connection_id=connection_id,
        base_budget_cents=int(base_budget_cents),
        noon_multiplier=data.get("noon_multiplier", 2.0),
        afternoon_multiplier=data.get("afternoon_multiplier", 4.0),
        min_conversions=data.get("min_conversions", 10),
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return _serialize_surf_config(config)


@router.get("/budget-surf")
def list_budget_surf(
    ad_account_id: Optional[str] = Query(None),
    connection_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List budget surfing configs."""
    q = db.query(BudgetSurfConfig)
    if ad_account_id:
        q = q.filter(BudgetSurfConfig.ad_account_id == ad_account_id)
    if connection_id:
        q = q.filter(BudgetSurfConfig.connection_id == connection_id)
    return [_serialize_surf_config(c) for c in q.order_by(BudgetSurfConfig.created_at.desc()).all()]


@router.patch("/budget-surf/{config_id}")
def update_budget_surf(
    config_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Update a budget surfing config."""
    config = db.query(BudgetSurfConfig).filter(BudgetSurfConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Surf config not found")

    for field in ['base_budget_cents', 'noon_multiplier', 'afternoon_multiplier', 'min_conversions', 'enabled']:
        if field in data:
            setattr(config, field, data[field])
    db.commit()
    db.refresh(config)
    return _serialize_surf_config(config)


@router.delete("/budget-surf/{config_id}")
def delete_budget_surf(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("campaigns:write")),
):
    """Remove a campaign/adset from budget surfing."""
    config = db.query(BudgetSurfConfig).filter(BudgetSurfConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Surf config not found")
    db.delete(config)
    db.commit()
    return {"status": "deleted", "id": config_id}


@router.get("/budget-surf/{config_id}/logs")
def get_budget_surf_logs(
    config_id: str,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get action logs for a budget surfing config."""
    logs = db.query(BudgetSurfLog).filter(
        BudgetSurfLog.surf_config_id == config_id,
    ).order_by(BudgetSurfLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": l.id,
            "fb_object_id": l.fb_object_id,
            "action": l.action,
            "old_budget_cents": l.old_budget_cents,
            "new_budget_cents": l.new_budget_cents,
            "conversions": l.conversions,
            "phase": l.phase,
            "error_message": l.error_message,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


# ─── Safe Conversion Campaign (AI-powered) ───────────────────────────────────

@router.get("/product-urls")
def get_product_urls(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return products that have a default_url set, for the safe campaign URL dropdown."""
    from app.models import Brand
    products = (
        db.query(ProductModel)
        .filter(ProductModel.default_url.isnot(None), ProductModel.default_url != "")
        .all()
    )
    results = []
    for p in products:
        brand = db.query(Brand).filter(Brand.id == p.brand_id).first()
        results.append({
            "id": p.id,
            "name": p.name,
            "brand_name": brand.name if brand else None,
            "url": p.default_url,
        })
    return results


@router.post("/generate-safe-campaign")
def generate_safe_campaign(
    request: SafeCampaignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Generate and publish an ultra-safe Facebook conversion campaign.
    Returns immediately with a batch_id. Background worker handles image gen,
    copy gen, and Facebook publishing. All ads created PAUSED.
    """
    niche_short = SAFE_NICHE_LABELS.get(request.niche, "Lifestyle").split("/")[0].strip()
    campaign_name = request.campaign_name or f"Safe - {niche_short} - {datetime.now().strftime('%b %d %Y %I:%M%p')}"
    num_ads = min(request.num_ads, 20)

    # Create batch record immediately so frontend can poll
    batch = PublishBatch(
        status="in_progress",
        campaign_data={
            "name": campaign_name,
            "objective": "OUTCOME_SALES",
            "budgetType": "CBO",
            "dailyBudget": request.daily_budget,
            "bidStrategy": "LOWEST_COST_WITHOUT_CAP",
            "status": "PAUSED",
        },
        adset_data={},
        creative_data={},
        ads_data=[],
        connection_id=request.connection_id,
        ad_account_id=request.ad_account_id,
        total_ads=num_ads,
        completed_ads=0,
        failed_ads=0,
        error_log=[],
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    batch_id = batch.id

    # Resolve Facebook service
    if request.connection_id:
        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == request.connection_id,
            FacebookConnection.is_active == True,
        ).first()
        service = FacebookService(connection=conn) if conn else FacebookService()
    else:
        default_conn = db.query(FacebookConnection).filter(
            FacebookConnection.is_default == True,
            FacebookConnection.is_active == True,
        ).first()
        service = FacebookService(connection=default_conn) if default_conn else FacebookService()

    if not service.api:
        service.initialize()

    # Spawn background worker
    thread = threading.Thread(
        target=_safe_campaign_worker,
        args=(batch_id, service, request),
        daemon=True,
    )
    thread.start()

    return {"batch_id": batch_id, "campaign_name": campaign_name, "num_ads": num_ads}


def _safe_campaign_worker(batch_id: str, service: FacebookService, request: SafeCampaignRequest):
    """Background worker: generate images + copy, create campaign/adset, then delegate to batch worker."""
    db = SessionLocal()
    try:
        batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
        if not batch:
            return

        num_ads = min(request.num_ads, 20)
        niche_short = SAFE_NICHE_LABELS.get(request.niche, "Lifestyle").split("/")[0].strip()
        campaign_name = request.campaign_name or f"Safe - {niche_short} - {datetime.now().strftime('%b %d %Y %I:%M%p')}"
        ad_account_id = request.ad_account_id

        # ── Step 1: Generate safe images via Fal.ai FLUX.2 dev Turbo ($0.008/image) ──
        from app.api.v1.generated_ads import save_image_bytes
        import fal_client
        import os
        import requests as img_requests
        os.environ["FAL_KEY"] = settings.FAL_KEY

        niche = request.niche if request.niche in SAFE_NICHE_IMAGE_PROMPTS else "general_wellness"
        niche_prompts = SAFE_NICHE_IMAGE_PROMPTS[niche]
        selected_prompts = random.sample(niche_prompts, min(num_ads, len(niche_prompts)))

        generated_images = []
        for i, prompt in enumerate(selected_prompts):
            try:
                print(f"[safe_campaign] Generating image {i+1}/{num_ads} (FLUX dev): {prompt[:60]}...")
                # Enforce ultra-safe image generation — boring, generic, stock-photo style
                safe_prefix = "IMPORTANT: Generate an extremely safe, boring, generic stock photo. NO people in underwear, NO body measurements, NO scales, NO before/after bodies, NO medical imagery, NO skin exposure. Keep it PG, bland, and advertiser-safe. "
                result = fal_client.subscribe(
                    "fal-ai/flux/dev",
                    arguments={
                        "prompt": safe_prefix + prompt,
                        "image_size": "square_hd",
                        "num_images": 1,
                    },
                )
                if not result or not result.get("images"):
                    raise RuntimeError("FLUX returned no images")
                image_url_remote = result["images"][0]["url"]
                resp = img_requests.get(image_url_remote, timeout=60)
                resp.raise_for_status()
                local_url = save_image_bytes(resp.content, prefix="safe_flux")

                # Upload to R2 if enabled
                if settings.r2_enabled:
                    import asyncio
                    from app.api.v1.uploads import upload_to_r2
                    from pathlib import Path
                    uploads_dir = Path(__file__).parent.parent.parent / "uploads"
                    local_filename = local_url.lstrip("/uploads/")
                    local_path = uploads_dir / local_filename
                    if local_path.exists():
                        with open(local_path, "rb") as f:
                            img_bytes = f.read()
                        r2_filename = f"safe_campaign/{uuid.uuid4().hex}.png"
                        loop = asyncio.new_event_loop()
                        try:
                            r2_url = loop.run_until_complete(upload_to_r2(img_bytes, r2_filename, "image/png"))
                        finally:
                            loop.close()
                        generated_images.append(r2_url)
                    else:
                        generated_images.append(local_url)
                else:
                    generated_images.append(local_url)
            except Exception as e:
                print(f"[safe_campaign] Image generation {i+1} failed: {e}")
                continue

        if not generated_images:
            batch.status = "partial"
            batch.error_log = [{"error": "All image generations failed"}]
            db.commit()
            return

        actual_num_ads = len(generated_images)

        # ── Step 2: Generate safe copy via Gemini Flash ──
        print(f"[safe_campaign] Generating {actual_num_ads} safe copy variations...")
        variations = []
        try:
            import google.generativeai as genai
            gemini_key = settings.GEMINI_API_KEY
            if gemini_key:
                genai.configure(api_key=gemini_key)
                model = genai.GenerativeModel("gemini-2.0-flash")
                niche_label = SAFE_NICHE_LABELS.get(niche, "General Wellness / Lifestyle")
                copy_prompt = SAFE_COPY_SYSTEM_PROMPT.format(
                    niche_label=niche_label,
                    num_ads=actual_num_ads,
                    website_url=request.website_url,
                )
                response = model.generate_content(copy_prompt)
                raw_text = response.text.strip()
                # Parse JSON from response (strip markdown fences if present)
                json_match = re.search(r"\{[\s\S]*\}", raw_text)
                if json_match:
                    parsed = json.loads(json_match.group())
                    variations = parsed.get("variations", [])
        except Exception as e:
            print(f"[safe_campaign] Copy generation failed: {e}")

        # Fallback copy if Gemini failed
        fallback_copies = [
            {"headline": "A Simple Daily Wellness Approach", "body": "Many people are discovering simple daily habits that support their overall wellbeing. From morning routines to mindful practices, small changes can make a difference in how you feel throughout the day.", "description": "Learn about simple wellness habits"},
            {"headline": "Explore Natural Lifestyle Habits", "body": "Exploring natural wellness practices has become increasingly popular. Whether you prefer gentle movement, mindful eating, or simply spending time outdoors, there are many ways to support your daily routine.", "description": "Discover natural lifestyle approaches"},
            {"headline": "Small Steps for Everyday Wellbeing", "body": "Sometimes the smallest changes in your daily routine can have the most meaningful impact on how you feel. Learn about simple approaches that thousands of people have incorporated into their lives.", "description": "Simple steps for daily wellbeing"},
            {"headline": "Learn About Simple Daily Routines", "body": "A good daily routine can set the tone for your entire day. Discover how simple morning and evening practices are helping people feel more balanced and centered in their everyday lives.", "description": "Explore daily routine ideas"},
            {"headline": "Discover Everyday Wellness Ideas", "body": "From mindful breathing to a simple walk in nature, there are many gentle ways to support your overall sense of wellbeing. Explore some of the most popular wellness approaches people are trying today.", "description": "Everyday wellness inspiration"},
        ]
        while len(variations) < actual_num_ads:
            variations.append(fallback_copies[len(variations) % len(fallback_copies)])

        # ── Step 3: Create Campaign on Facebook (PAUSED) ──
        print(f"[safe_campaign] Creating Facebook campaign: {campaign_name}")
        try:
            fb_campaign = service.create_campaign({
                "name": campaign_name,
                "objective": "OUTCOME_SALES",
                "status": "PAUSED",
                "budget_type": "CBO",
                "daily_budget": request.daily_budget,
                "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            }, ad_account_id)
            fb_campaign_id = fb_campaign.get("id") or dict(fb_campaign).get("id")
        except Exception as e:
            print(f"[safe_campaign] Campaign creation failed: {e}")
            batch.status = "partial"
            batch.error_log = [{"error": f"Campaign creation failed: {e}"}]
            db.commit()
            return

        # ── Step 4: Create Ad Set on Facebook (PAUSED) ──
        print(f"[safe_campaign] Creating ad set...")
        tomorrow = (datetime.now() + timedelta(days=1)).replace(hour=1, minute=0, second=0)
        try:
            fb_adset = service.create_adset({
                "name": f"{campaign_name} - Ad Set",
                "campaign_id": fb_campaign_id,
                "optimization_goal": "OFFSITE_CONVERSIONS",
                "status": "PAUSED",
                "budget_type": "CBO",
                "targeting": {
                    "geo_locations": {"countries": ["US"]},
                    "ageMin": 18,
                    "ageMax": 65,
                    "publisher_platforms": ["facebook", "instagram"],
                },
                "promoted_object": {
                    "pixel_id": request.pixel_id,
                    "custom_event_type": request.conversion_event,
                },
                "start_time": tomorrow.isoformat(),
                "advantage_audience": 0,
            }, ad_account_id)
            fb_adset_id = fb_adset.get("id") or dict(fb_adset).get("id")
        except Exception as e:
            print(f"[safe_campaign] Ad set creation failed: {e}")
            batch.status = "partial"
            batch.error_log = [{"error": f"Ad set creation failed: {e}"}]
            db.commit()
            return

        # ── Step 5: Build batch data for the standard batch worker ──
        creatives = []
        ads_data = []
        for i in range(actual_num_ads):
            v = variations[i]
            creative_id = f"safe_creative_{uuid.uuid4().hex[:8]}"
            creatives.append({
                "id": creative_id,
                "name": f"Safe Creative {i+1}",
                "mediaType": "image",
                "previewUrl": generated_images[i],
                "imageUrl": generated_images[i],
                "headlines": [v.get("headline", "Explore Simple Wellness Habits")],
                "bodies": [v.get("body", "Discover simple approaches to everyday wellbeing.")],
                "description": v.get("description", ""),
                "cta": "LEARN_MORE",
            })
            ads_data.append({
                "id": f"safe_ad_{uuid.uuid4().hex[:8]}",
                "name": f"{campaign_name} - Ad {i+1}",
                "creativeId": creative_id,
                "headlineIndex": 0,
                "bodyIndex": 0,
                "mediaType": "image",
                "useDefaultCreative": True,
                "perCreative": True,
                "publishStatus": "pending",
            })

        creative_data = {
            "creativeMode": "per_creative",
            "creativeName": f"{campaign_name} Creative",
            "creatives": creatives,
            "cta": "LEARN_MORE",
            "description": "",
            "websiteUrl": request.website_url,
            "pageId": request.page_id,
        }

        # Update batch with all the data + FB IDs
        batch.fb_campaign_id = fb_campaign_id
        batch.fb_adset_id = fb_adset_id
        batch.campaign_data = {
            "name": campaign_name,
            "objective": "OUTCOME_SALES",
            "budgetType": "CBO",
            "dailyBudget": request.daily_budget,
            "bidStrategy": "LOWEST_COST_WITHOUT_CAP",
            "status": "PAUSED",
        }
        batch.adset_data = {
            "name": f"{campaign_name} - Ad Set",
            "optimizationGoal": "OFFSITE_CONVERSIONS",
            "pixelId": request.pixel_id,
            "conversionEvent": request.conversion_event,
            "status": "PAUSED",
        }
        batch.creative_data = creative_data
        batch.ads_data = ads_data
        batch.total_ads = actual_num_ads
        db.commit()

        # ── Step 6: Delegate ad creation to existing batch worker ──
        print(f"[safe_campaign] Handing off {actual_num_ads} ads to batch worker...")
        _process_batch_worker(batch_id, service)

    except Exception as e:
        print(f"[safe_campaign] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        try:
            batch = db.query(PublishBatch).filter(PublishBatch.id == batch_id).first()
            if batch:
                batch.status = "partial"
                batch.error_log = (batch.error_log or []) + [{"error": str(e)}]
                db.commit()
        except:
            pass
    finally:
        db.close()


# ─── Safe Engagement Warmup Campaign ─────────────────────────────────────────

SAFE_AD_COPIES = [
    "Having a great day today. Hope everyone is doing well!",
    "Just wanted to share some positivity with everyone today. Wishing you all a wonderful week!",
    "Life is better when you focus on the good things. Sending good vibes to everyone reading this.",
    "Grateful for another beautiful day. What's something that made you smile today?",
    "Taking a moment to appreciate the little things. Hope your day is going great!",
]


@router.post("/safe-engagement-campaign")
def create_safe_engagement_campaign(
    data: Dict[str, Any],
    service: FacebookService = Depends(get_facebook_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create a safe engagement campaign for account warmup.
    Uses page profile picture + neutral copy. $30/day budget.
    Schedules pause at midnight local time.
    """
    import random
    import requests as http_requests

    ad_account_id = data.get("ad_account_id")
    page_id = data.get("page_id")
    timezone = data.get("timezone", "America/New_York")

    if not ad_account_id or not page_id:
        raise HTTPException(status_code=400, detail="ad_account_id and page_id are required")

    try:
        # Check if an active warmup campaign already exists
        existing_campaigns = service.get_campaigns_with_insights(ad_account_id)
        for camp in existing_campaigns:
            if camp.get('name', '').startswith('Warmup -') and camp.get('effective_status') in ('ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED'):
                return {
                    "success": True,
                    "campaign_id": camp['id'],
                    "message": f"Active warmup campaign already exists: {camp.get('name')}",
                    "already_exists": True,
                }

        # 1) Create campaign — engagement objective, CBO, $5/day
        campaign_name = f"Warmup - {datetime.now().strftime('%m/%d %I:%M%p')}"
        campaign = service.create_campaign({
            "name": campaign_name,
            "objective": "OUTCOME_ENGAGEMENT",
            "status": "ACTIVE",
            "budget_type": "CBO",
            "daily_budget": 5,
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
        }, ad_account_id)
        campaign_id = campaign["id"]

        # 2) Create ad set — broad targeting US, 25-65+, all genders
        #    destination_type=ON_POST avoids the external URL requirement
        adset_name = f"Warmup Adset"
        adset = service.create_adset({
            "name": adset_name,
            "campaign_id": campaign_id,
            "optimization_goal": "POST_ENGAGEMENT",
            "destination_type": "ON_POST",
            "promoted_object": {"page_id": page_id},
            "status": "ACTIVE",
            "budget_type": "CBO",
            "targeting": {
                "geo_locations": {"countries": ["US"]},
                "ageMin": 25,
                "ageMax": 65,
            },
        }, ad_account_id)
        adset_id = adset["id"]

        # 3) Create an unpublished page photo post to use as the ad creative
        #    This avoids the external URL requirement entirely
        #    Must use the PAGE access token (not user token) to post as the page
        import requests as http_requests
        ad_text = random.choice(SAFE_AD_COPIES)

        # Get page access token — required for posting as the page itself
        page_token_resp = http_requests.get(
            f"https://graph.facebook.com/v21.0/{page_id}",
            params={
                "fields": "access_token",
                "access_token": service.access_token,
            }
        )
        page_token_data = page_token_resp.json()
        if "access_token" not in page_token_data:
            raise Exception(
                f"Could not get page access token. Make sure the user has admin access to this page "
                f"and the token has pages_manage_posts permission. Response: {page_token_data}"
            )
        page_access_token = page_token_data["access_token"]

        page_pic_url = f"https://graph.facebook.com/{page_id}/picture?type=large&width=600&height=600"
        post_resp = http_requests.post(
            f"https://graph.facebook.com/v21.0/{page_id}/photos",
            params={
                "access_token": page_access_token,
                "url": page_pic_url,
                "message": ad_text,
                "published": "false",
            }
        )
        post_data = post_resp.json()
        if "id" not in post_data:
            raise Exception(f"Failed to create page post: {post_data}")
        # photo_id is the photo object; post_id is the page post
        photo_post_id = post_data.get("post_id") or f"{page_id}_{post_data['id']}"

        # 4) Create creative using object_story_id (existing post — no URL/CTA needed)
        from facebook_business.adobjects.adcreative import AdCreative
        account = service._get_account(ad_account_id)
        creative_params = {
            AdCreative.Field.name: "Warmup Creative",
            AdCreative.Field.object_story_id: photo_post_id,
        }
        creative_result = account.create_ad_creative(params=creative_params)
        creative_id = creative_result["id"]

        # 5) Create ad
        ad = service.create_ad({
            "name": f"Warmup Ad",
            "adset_id": adset_id,
            "creative_id": creative_id,
            "status": "ACTIVE",
        }, ad_account_id)
        ad_id = ad["id"]

        # 6) Schedule campaign pause at midnight local time
        tz = pytz.timezone(timezone)
        now_local = datetime.now(tz)
        midnight = (now_local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

        # Schedule pause at midnight by toggling status directly (no budget change model needed)
        # Use a background thread with sleep instead of ScheduledBudgetChange
        import threading
        def _pause_at_midnight():
            import time as _time
            seconds_until = (midnight - datetime.now(tz)).total_seconds()
            if seconds_until > 0:
                _time.sleep(seconds_until)
            try:
                service.update_object_status(campaign_id, 'campaign', 'PAUSED')
                logger.info(f"Paused warmup campaign {campaign_id} at midnight {timezone}")
            except Exception as e:
                logger.error(f"Failed to pause warmup campaign {campaign_id}: {e}")
        threading.Thread(target=_pause_at_midnight, daemon=True).start()

        return {
            "success": True,
            "campaign_id": campaign_id,
            "adset_id": adset_id,
            "creative_id": creative_id,
            "ad_id": ad_id,
            "campaign_name": campaign_name,
            "pauses_at": midnight.isoformat(),
            "message": f"Safe engagement campaign created. Will pause at midnight {timezone}.",
        }

    except FacebookRequestError as e:
        logger.exception("Safe campaign creation failed")
        body = e.body() if callable(getattr(e, 'body', None)) else {}
        err_detail = body.get('error', {}) if isinstance(body, dict) else {}
        msg = e.api_error_message()
        subcode = err_detail.get('error_subcode', '')
        user_msg = err_detail.get('error_user_msg', '')
        user_title = err_detail.get('error_user_title', '')
        full = f"Facebook API error: {msg}"
        if user_title:
            full += f" | {user_title}"
        if user_msg:
            full += f" | {user_msg}"
        if subcode:
            full += f" (subcode: {subcode})"
        logger.error(f"FB error body: {body}")
        raise HTTPException(status_code=500, detail=full)
    except Exception as e:
        logger.exception("Safe campaign creation failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Comment Monitor ───────────────────────────────────────────────────────────

def _get_page_tokens(db):
    """Get page access tokens for all connected pages."""
    import requests as http_req
    connections = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).all()
    tokens = {}
    for conn in connections:
        try:
            resp = http_req.get('https://graph.facebook.com/v21.0/me/accounts', params={
                'access_token': conn.access_token,
                'fields': 'id,name,access_token',
                'limit': 100,
            }, timeout=30)
            if resp.status_code == 200:
                for p in resp.json().get('data', []):
                    tokens[p['id']] = p['access_token']
        except Exception:
            pass
    return tokens


@router.get("/ad-comments")
def get_ad_comments(
    ad_account_id: Optional[str] = None,
    service: FacebookService = Depends(get_facebook_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all ads with their comments across accounts (or a single account)."""
    import requests as http_req
    from facebook_business.adobjects.adaccount import AdAccount

    page_tokens = _get_page_tokens(db)

    accounts = []
    if ad_account_id:
        accounts = [{'account_id': ad_account_id.replace('act_', ''), 'name': ad_account_id}]
    else:
        raw = service.get_ad_accounts()
        accounts = [{'account_id': a.get('account_id', a.get('id', '').replace('act_', '')), 'name': a.get('name', '')} for a in raw]

    result = []
    for acct in accounts:
        acct_id = acct['account_id']
        full_id = f"act_{acct_id}" if not acct_id.startswith('act_') else acct_id
        account = AdAccount(full_id)
        account.api = service.api

        ads = []
        try:
            cursor = account.get_ads(
                fields=['id', 'name', 'status', 'effective_status', 'creative{effective_object_story_id,thumbnail_url}'],
                params={
                    'filtering': [{'field': 'effective_status', 'operator': 'IN', 'value': ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'WITH_ISSUES']}],
                    'limit': 200,
                }
            )
            seen_stories = set()
            for ad in cursor:
                ad_dict = dict(ad)
                creative = ad_dict.get('creative', {})
                story_id = creative.get('effective_object_story_id', '')
                page_id = story_id.split('_')[0] if '_' in story_id else ''
                permalink = f"https://www.facebook.com/{story_id}" if story_id else ''

                comments = []
                if story_id and story_id not in seen_stories:
                    seen_stories.add(story_id)
                    token = page_tokens.get(page_id)
                    if token:
                        try:
                            resp = http_req.get(
                                f"https://graph.facebook.com/v21.0/{story_id}/comments",
                                params={
                                    'access_token': token,
                                    'fields': 'id,message,from{name,id},created_time,comment_count,is_hidden',
                                    'limit': 100,
                                    'filter': 'stream',
                                },
                                timeout=30,
                            )
                            if resp.status_code == 200:
                                for c in resp.json().get('data', []):
                                    comment = {
                                        'id': c.get('id'),
                                        'from_name': c.get('from', {}).get('name', 'Unknown'),
                                        'from_id': c.get('from', {}).get('id', ''),
                                        'message': c.get('message', ''),
                                        'created_time': c.get('created_time', ''),
                                        'is_hidden': c.get('is_hidden', False),
                                        'reply_count': c.get('comment_count', 0),
                                        'replies': [],
                                    }
                                    if comment['reply_count'] > 0:
                                        rr = http_req.get(
                                            f"https://graph.facebook.com/v21.0/{comment['id']}/comments",
                                            params={
                                                'access_token': token,
                                                'fields': 'id,message,from{name,id},created_time,is_hidden',
                                                'limit': 50,
                                            },
                                            timeout=30,
                                        )
                                        if rr.status_code == 200:
                                            comment['replies'] = [{
                                                'id': r.get('id'),
                                                'from_name': r.get('from', {}).get('name', 'Unknown'),
                                                'from_id': r.get('from', {}).get('id', ''),
                                                'message': r.get('message', ''),
                                                'created_time': r.get('created_time', ''),
                                                'is_hidden': r.get('is_hidden', False),
                                            } for r in rr.json().get('data', [])]
                                    comments.append(comment)
                        except Exception as e:
                            logger.warning(f"Error fetching comments for {story_id}: {e}")

                ads.append({
                    'ad_id': ad_dict.get('id'),
                    'ad_name': ad_dict.get('name'),
                    'status': ad_dict.get('effective_status'),
                    'story_id': story_id,
                    'page_id': page_id,
                    'permalink': permalink,
                    'comments': comments,
                })
        except Exception as e:
            logger.warning(f"Error fetching ads for {acct_id}: {e}")

        result.append({
            'account_id': acct_id,
            'account_name': acct['name'],
            'ads': ads,
        })

    return result


@router.post("/comments/{comment_id}/hide")
def hide_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Hide a comment on a Facebook post."""
    import requests as http_req
    page_tokens = _get_page_tokens(db)

    # Try each page token until one works
    for page_id, token in page_tokens.items():
        resp = http_req.post(
            f"https://graph.facebook.com/v21.0/{comment_id}",
            params={'access_token': token},
            json={'is_hidden': True},
            timeout=15,
        )
        if resp.status_code == 200:
            return {"success": True, "hidden": True}

    raise HTTPException(status_code=400, detail="Could not hide comment — no valid page token")


@router.post("/comments/{comment_id}/unhide")
def unhide_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Unhide a comment on a Facebook post."""
    import requests as http_req
    page_tokens = _get_page_tokens(db)

    for page_id, token in page_tokens.items():
        resp = http_req.post(
            f"https://graph.facebook.com/v21.0/{comment_id}",
            params={'access_token': token},
            json={'is_hidden': False},
            timeout=15,
        )
        if resp.status_code == 200:
            return {"success": True, "hidden": False}

    raise HTTPException(status_code=400, detail="Could not unhide comment — no valid page token")


# ── Account-Level Safe All Ads ─────────────────────────────────────────────────

SAFE_AD_IMAGES = [
    'puppy.jpg', 'puppy2.jpg', 'kitten.jpg', 'sunset.jpg',
    'coffee.jpg', 'mountain.jpg', 'beach.jpg', 'garden.jpg', 'flowers.jpg',
]

SAFE_AD_COPY = [
    {'primary_text': 'Check out this helpful resource for more information.', 'headline': 'Learn More Today', 'description': 'Discover useful tips and information.'},
    {'primary_text': 'Looking for something new? Start here.', 'headline': 'Explore Now', 'description': 'Find helpful tips and ideas.'},
    {'primary_text': 'Brighten your day with something wonderful.', 'headline': 'Something Special', 'description': 'Discover what everyone is talking about.'},
    {'primary_text': 'Take a moment to discover something amazing.', 'headline': 'A Fresh Perspective', 'description': 'See what inspires people every day.'},
    {'primary_text': 'Start your day with a great new find.', 'headline': 'Your Daily Inspiration', 'description': 'Simple ideas for a better day.'},
    {'primary_text': 'Relax and discover something new today.', 'headline': 'Unwind & Discover', 'description': 'Your go-to source for feel-good content.'},
]


class SafeAllAdsRequest(BaseModel):
    ad_account_id: str
    connection_id: Optional[str] = None


@router.post("/safe-all-ads")
async def safe_all_ads(
    request: SafeAllAdsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Convert ALL active ads in an account to safe creatives and pause them."""
    conn = None
    if request.connection_id:
        conn = db.query(FacebookConnection).filter(FacebookConnection.id == request.connection_id).first()
    if not conn:
        conn = db.query(FacebookConnection).filter(FacebookConnection.is_active == True).first()
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection")

    def _safe_all_worker():
        import time as _time
        sdb = SessionLocal()
        try:
            svc = FacebookService(connection=conn)
            if not svc.api:
                svc.initialize()

            # Get all active ads
            ads = svc.get_all_ads_with_insights(request.ad_account_id)
            active_ads = [a for a in ads if a.get('effective_status') in ('ACTIVE', 'PENDING_REVIEW', 'PREAPPROVED')]

            logger.info(f"Safe-all: found {len(active_ads)} active ads in {request.ad_account_id}")

            # Get a page_id from any ad's creative
            page_id = None
            for a in ads:
                pid = (a.get('creative_data') or {}).get('page_id')
                if pid:
                    page_id = pid
                    break
            if not page_id:
                try:
                    pages = svc.get_pages(request.ad_account_id)
                    if pages:
                        page_id = pages[0].get('id')
                except Exception:
                    pass
            if not page_id:
                logger.error("Safe-all: no page_id found, cannot proceed")
                return

            converted = 0
            failed = 0
            for ad in active_ads:
                try:
                    img = random.choice(SAFE_AD_IMAGES)
                    copy = random.choice(SAFE_AD_COPY)
                    svc.update_ad_creative(ad['id'], {
                        'page_id': page_id,
                        'name': f"{ad.get('name', 'Ad')} - Safe {datetime.now().strftime('%m/%d')}",
                        'image_url': f'https://pub-11870393a7f1464a9a0bf4fce09be525.r2.dev/safe-ad/{img}',
                        'primary_text': copy['primary_text'],
                        'headline': copy['headline'],
                        'description': copy['description'],
                        'cta': 'LEARN_MORE',
                        'website_url': 'https://www.google.com',
                    }, request.ad_account_id)

                    # Pause the ad
                    try:
                        svc.update_object_status(ad['id'], 'ad', 'PAUSED')
                    except Exception:
                        pass

                    converted += 1
                    logger.info(f"Safe-all: converted + paused ad {ad['id']}")
                    _time.sleep(0.5)  # Small delay to avoid rate limits
                except Exception as e:
                    failed += 1
                    logger.warning(f"Safe-all: failed ad {ad['id']}: {e}")

            logger.info(f"Safe-all complete: {converted} converted, {failed} failed out of {len(active_ads)}")
        except Exception as e:
            logger.error(f"Safe-all error: {e}", exc_info=True)
        finally:
            sdb.close()

    background_tasks.add_task(_safe_all_worker)
    return {"message": "Safe-all started in background", "ad_account_id": request.ad_account_id}


# ─── Warmup Content Generator (no Facebook API needed) ───────────────────────

WARMUP_CONTENT_PROMPT = """You are generating safe, engagement-focused Facebook ad content for a {niche_label} brand.
This content is for warming up new ad accounts. It must be ultra-safe and compliant.

The ads should invite engagement (comments, likes, shares) — NOT sell products.
Think: educational tips, relatable questions, listicles, conversation starters.

ABSOLUTE RULES:
- NO health claims (no "cure", "treat", "fix", "heal", "eliminate", "reverse")
- NO before/after implications or transformation promises
- NO urgency tactics ("limited time", "act now", "hurry")
- NO income or financial claims
- NO personal attributes callouts ("your pain", "your weight")
- NO superlatives ("best", "#1", "most effective")
- NO scientific/medical claims ("clinically proven", "studies show")
- NO power words ("revolutionary", "breakthrough", "secret", "miracle")
- NO emojis, NO exclamation marks, NO ALL CAPS
- NO direct product pitches or URLs
- NO aggressive CTAs — only soft engagement prompts like "What do you think?" or "Share your experience"
- Content should feel like organic posts from a wellness/lifestyle page

NICHE: {niche_label}
TONE: Warm, conversational, educational. Like a friendly expert sharing tips.

Return ONLY valid JSON (no markdown, no code fences):
{{
  "ads": [
    {{
      "primary_text": "2-4 sentences of engaging, educational content. End with a soft question or invitation to comment.",
      "headline": "Short attention-grabbing headline under 40 chars",
      "image_suggestion": "Detailed description of a safe, compliant stock photo or image to use"
    }}
  ]
}}

Generate exactly {num_ads} variations. Each must take a completely different angle or topic within the niche."""


class WarmupContentRequest(BaseModel):
    niche: str = "general_wellness"
    num_ads: int = 5


@router.post("/generate-warmup-content")
def generate_warmup_content(
    request: WarmupContentRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Generate safe warmup ad content (copy + image suggestions) without touching the Facebook API."""
    import subprocess
    import shutil

    niche = request.niche
    num_ads = max(1, min(10, request.num_ads))
    niche_label = SAFE_NICHE_LABELS.get(niche, "General Wellness / Lifestyle")

    prompt = WARMUP_CONTENT_PROMPT.format(
        niche_label=niche_label,
        num_ads=num_ads,
    )

    raw_text = None

    # Try Claude CLI (OAuth, free) first, then Anthropic API key
    if shutil.which('claude'):
        try:
            result = subprocess.run(
                ['env', '-u', 'ANTHROPIC_API_KEY', 'claude', '-p', '--output-format', 'text'],
                input=prompt, capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                logger.info("Warmup generator: used OAuth (free)")
                raw_text = result.stdout
        except Exception as e:
            logger.warning(f"OAuth call failed, trying API key: {e}")

    if not raw_text:
        import os
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            api_key = getattr(settings, 'ANTHROPIC_API_KEY', None)
        if api_key:
            try:
                import anthropic
                client = anthropic.Anthropic(api_key=api_key)
                resp = client.messages.create(
                    model="claude-sonnet-4-5-20250929",
                    max_tokens=4000,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw_text = resp.content[0].text
                logger.warning("Warmup generator: used API key (costs credits)")
            except Exception as e:
                logger.error(f"Warmup generator API key call failed: {e}")

    # Try Gemini Flash as a last resort
    if not raw_text:
        try:
            import google.generativeai as genai
            gemini_key = settings.GEMINI_API_KEY
            if gemini_key:
                genai.configure(api_key=gemini_key)
                model = genai.GenerativeModel("gemini-2.0-flash")
                response = model.generate_content(prompt)
                raw_text = response.text.strip()
                logger.info("Warmup generator: used Gemini Flash fallback")
        except Exception as e:
            logger.error(f"Warmup generator Gemini call failed: {e}")

    # Parse AI response
    ads = []
    if raw_text:
        try:
            json_match = re.search(r"\{[\s\S]*\}", raw_text)
            if json_match:
                parsed = json.loads(json_match.group())
                ads = parsed.get("ads", [])
        except Exception as e:
            logger.error(f"Warmup generator JSON parse failed: {e}")

    # Fallback content if all AI calls failed
    fallback_ads = [
        {"primary_text": "Many people find that simple daily habits make a meaningful difference in how they feel. From a morning walk to choosing whole foods, small changes add up over time. What is one simple wellness habit you have added to your routine recently?", "headline": "Simple Daily Wellness Habits", "image_suggestion": "Person walking on a scenic nature trail in morning sunlight, active lifestyle photography"},
        {"primary_text": "Taking a few minutes each day for yourself can help you feel more centered and balanced. Whether it is a quiet cup of tea or a few deep breaths, these small moments matter. How do you take time for yourself during a busy day?", "headline": "Taking Time for Yourself", "image_suggestion": "Person sitting peacefully with a cup of tea near a window with natural light, cozy lifestyle photography"},
        {"primary_text": "Staying hydrated is one of the simplest things you can do to support your overall wellbeing. Yet so many of us forget to drink enough water throughout the day. Do you have any tips for remembering to stay hydrated?", "headline": "The Power of Staying Hydrated", "image_suggestion": "Glass of water with lemon slices on a clean white countertop, fresh and bright food photography"},
        {"primary_text": "A good night of rest can set the tone for your entire next day. Creating a calming evening routine is something many people find helpful. What does your evening wind-down routine look like?", "headline": "Better Evenings, Better Mornings", "image_suggestion": "Cozy bedroom with soft lighting, books on nightstand, calm evening atmosphere photography"},
        {"primary_text": "Spending time outdoors, even just a short walk around the block, can do wonders for your mood and energy levels. Nature has a way of helping us feel more grounded. Do you prefer morning or evening walks?", "headline": "The Joy of Getting Outside", "image_suggestion": "Person walking through a green park on a sunny day, outdoor lifestyle photography"},
        {"primary_text": "Meal prepping on the weekend can save time and help you make better food choices throughout the week. It does not have to be complicated — even preparing a few staples can help. What is your go-to meal prep staple?", "headline": "Easy Weekend Meal Prep Ideas", "image_suggestion": "Colorful meal prep containers with healthy food on a kitchen counter, overhead food photography"},
        {"primary_text": "Stretching for just five to ten minutes a day can help your body feel more limber and relaxed. It is a simple practice that many people overlook. Do you stretch in the morning, evening, or both?", "headline": "A Few Minutes of Stretching", "image_suggestion": "Person doing gentle stretching on a yoga mat in a bright modern living room, wellness lifestyle photography"},
        {"primary_text": "Connecting with friends and loved ones is an important part of overall wellbeing that sometimes gets overlooked. Even a quick phone call can brighten your day. Who is someone you have been meaning to reach out to?", "headline": "Staying Connected Matters", "image_suggestion": "Two friends laughing together over coffee at a cafe table, warm lifestyle photography"},
        {"primary_text": "Reading for just 15 minutes a day can be a wonderful way to unwind and learn something new. Whether it is fiction or nonfiction, books offer a screen-free escape. What are you reading right now?", "headline": "The Simple Joy of Reading", "image_suggestion": "Person reading a book in a comfortable chair near a window, cozy lifestyle photography"},
        {"primary_text": "Gratitude journaling is a practice that many people find uplifting. Writing down a few things you are thankful for each day can shift your perspective over time. Have you ever tried keeping a gratitude journal?", "headline": "The Practice of Gratitude", "image_suggestion": "Open journal with pen on a wooden desk next to a plant, minimalist lifestyle photography"},
    ]

    while len(ads) < num_ads:
        ads.append(fallback_ads[len(ads) % len(fallback_ads)])

    # Add image suggestions from SAFE_NICHE_IMAGE_PROMPTS if not already present
    niche_images = SAFE_NICHE_IMAGE_PROMPTS.get(niche, SAFE_NICHE_IMAGE_PROMPTS["general_wellness"])
    for i, ad in enumerate(ads[:num_ads]):
        if not ad.get("image_suggestion"):
            ad["image_suggestion"] = niche_images[i % len(niche_images)]

    return {"ads": ads[:num_ads], "niche": niche, "niche_label": niche_label}
