"""
Airtable → Facebook Ad Launch endpoint (Playbook mode).

Flow: competitor URLs + offer context + playbook
  → Scrape competitors → Gemini generates copy + image prompt
  → Higgsfield generates image → Facebook campaign created (PAUSED)
"""
import logging
import os
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FacebookConnection
from app.services.facebook_service import FacebookService
from app.services.playbook_launch_service import (
    load_playbook, list_playbooks, scrape_competitors, generate_ad_content,
)

logger = logging.getLogger(__name__)
router = APIRouter()

AIRTABLE_WEBHOOK_SECRET = os.getenv("AIRTABLE_WEBHOOK_SECRET", "")


class AirtableLaunchRequest(BaseModel):
    webhook_secret: Optional[str] = None

    # Playbook + context
    playbook: str
    competitor_urls: Optional[List[str]] = None
    offer_context: str
    brand_name: Optional[str] = None
    product_name: Optional[str] = None

    # Campaign settings
    website_url: str
    campaign_name: str
    objective: str = "OUTCOME_TRAFFIC"
    budget_type: str = "ABO"
    daily_budget: float = 20.0
    adset_name: Optional[str] = None
    age_min: int = 18
    age_max: int = 65
    genders: Optional[List[int]] = None
    countries: List[str] = ["US"]
    optimization_goal: str = "LINK_CLICKS"

    # Facebook IDs
    page_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    connection_id: Optional[int] = None


class AirtableLaunchResponse(BaseModel):
    status: str
    generated_copy: Optional[dict] = None
    campaign_id: Optional[str] = None
    adset_id: Optional[str] = None
    creative_id: Optional[str] = None
    ad_id: Optional[str] = None
    image_url: Optional[str] = None
    error: Optional[str] = None


def _get_fb_service(db: Session, connection_id: Optional[int] = None):
    if connection_id:
        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == connection_id,
            FacebookConnection.is_active == True
        ).first()
        if not conn:
            raise HTTPException(status_code=404, detail="Facebook connection not found")
        service = FacebookService(connection=conn)
    else:
        default_conn = db.query(FacebookConnection).filter(
            FacebookConnection.is_default == True,
            FacebookConnection.is_active == True
        ).first()
        service = FacebookService(connection=default_conn) if default_conn else FacebookService()

    if not service.api:
        service.initialize()
    return service


@router.get("/playbooks")
async def get_playbooks():
    return {"playbooks": list_playbooks()}


@router.post("/preview")
async def preview_ad_content(req: AirtableLaunchRequest):
    """Dry run — generates copy + image prompt without creating a FB campaign."""
    try:
        playbook_text = load_playbook(req.playbook)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    competitor_intel = ""
    if req.competitor_urls:
        competitor_intel = await scrape_competitors(req.competitor_urls)

    content = generate_ad_content(
        playbook_text=playbook_text,
        competitor_intel=competitor_intel,
        offer_context=req.offer_context,
        brand_name=req.brand_name,
        product_name=req.product_name,
    )

    return {
        "status": "preview",
        "generated_copy": content,
        "playbook_used": req.playbook,
        "competitors_scraped": len(req.competitor_urls or []),
    }


@router.post("/launch", response_model=AirtableLaunchResponse)
async def airtable_launch(
    req: AirtableLaunchRequest,
    db: Session = Depends(get_db),
):
    if AIRTABLE_WEBHOOK_SECRET and req.webhook_secret != AIRTABLE_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    # Step 1: Load playbook + scrape competitors + generate copy
    try:
        playbook_text = load_playbook(req.playbook)
    except FileNotFoundError as e:
        return AirtableLaunchResponse(status="error", error=str(e))

    competitor_intel = ""
    if req.competitor_urls:
        logger.info(f"Scraping {len(req.competitor_urls)} competitor URLs")
        competitor_intel = await scrape_competitors(req.competitor_urls)

    try:
        generated = generate_ad_content(
            playbook_text=playbook_text,
            competitor_intel=competitor_intel,
            offer_context=req.offer_context,
            brand_name=req.brand_name,
            product_name=req.product_name,
        )
    except Exception as e:
        logger.exception("AI content generation failed")
        return AirtableLaunchResponse(status="error", error=f"AI generation failed: {e}")

    # Step 2: Generate image via Higgsfield
    image_prompt = generated.get("image_prompt")
    image_model = generated.get("image_model", "soul_2")
    aspect_ratio = generated.get("aspect_ratio", "1:1")
    image_url = None
    if image_prompt:
        try:
            from app.services import higgsfield_service
            logger.info(f"Generating image via Higgsfield ({image_model}): {image_prompt[:80]}")
            local_paths = higgsfield_service.generate_image_sync(
                prompt=image_prompt,
                model=image_model,
                aspect_ratio=aspect_ratio,
            )
            image_url = f"http://localhost:8000{local_paths[0]}"
        except Exception as e:
            logger.exception("Image generation failed")
            return AirtableLaunchResponse(
                status="error", generated_copy=generated,
                error=f"Image generation failed: {e}",
            )

    if not image_url:
        return AirtableLaunchResponse(
            status="error", generated_copy=generated,
            error="Playbook did not produce an image_prompt",
        )

    # Step 3: Create Facebook campaign pipeline
    try:
        service = _get_fb_service(db, req.connection_id)
        acct = req.ad_account_id

        campaign = service.create_campaign({
            "name": req.campaign_name,
            "objective": req.objective,
            "status": "PAUSED",
            "budget_type": req.budget_type,
            "daily_budget": req.daily_budget if req.budget_type == "CBO" else None,
        }, ad_account_id=acct)
        campaign_id = campaign.get("id") or campaign.get_id()

        targeting = {
            "age_min": req.age_min,
            "age_max": req.age_max,
            "geo_locations": {"countries": req.countries},
        }
        if req.genders:
            targeting["genders"] = req.genders

        adset = service.create_adset({
            "name": req.adset_name or f"{req.campaign_name} - Ad Set",
            "campaign_id": campaign_id,
            "optimization_goal": req.optimization_goal,
            "status": "PAUSED",
            "daily_budget": req.daily_budget if req.budget_type != "CBO" else None,
            "budget_type": req.budget_type,
            "targeting": targeting,
        }, ad_account_id=acct)
        adset_id = adset.get("id") or adset.get_id()

        page_id = req.page_id
        if not page_id:
            pages = service.get_pages(ad_account_id=acct)
            if pages:
                page_id = pages[0].get("id")
        if not page_id:
            return AirtableLaunchResponse(
                status="error", campaign_id=campaign_id, adset_id=adset_id,
                generated_copy=generated, error="No page_id found",
            )

        ad_result = service.quick_create_ad(
            adset_id=adset_id,
            creative_data={
                "name": f"{req.campaign_name} - Creative",
                "page_id": page_id,
                "image_url": image_url,
                "primary_text": generated.get("primary_text"),
                "headline": generated.get("headline"),
                "website_url": req.website_url,
                "cta": generated.get("cta", "LEARN_MORE"),
            },
            ad_account_id=acct,
        )

        return AirtableLaunchResponse(
            status="success",
            generated_copy=generated,
            campaign_id=campaign_id,
            adset_id=adset_id,
            creative_id=ad_result.get("creative_id"),
            ad_id=ad_result.get("ad_id"),
            image_url=image_url,
        )

    except Exception as e:
        logger.exception("Facebook launch failed")
        return AirtableLaunchResponse(
            status="error", generated_copy=generated, error=str(e),
        )
