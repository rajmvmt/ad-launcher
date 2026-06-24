"""Sonnet vs Opus — side-by-side model comparison for persona ad copy."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models import Persona, Brand, User
from app.core.deps import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter()

# Pricing per 1M tokens (as of March 2026)
MODEL_PRICING = {
    "claude-sonnet-4-5-20250929": {"input": 3.00, "output": 15.00, "label": "Sonnet 4.5"},
    "claude-opus-4-6-20250918": {"input": 15.00, "output": 75.00, "label": "Opus 4.6"},
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.00, "label": "Haiku 4.5"},
}


def _calc_cost(usage: dict) -> dict:
    """Calculate cost from token usage."""
    model = usage.get("model", "")
    pricing = MODEL_PRICING.get(model, {"input": 3.00, "output": 15.00, "label": model})
    input_cost = (usage.get("input_tokens", 0) / 1_000_000) * pricing["input"]
    output_cost = (usage.get("output_tokens", 0) / 1_000_000) * pricing["output"]
    return {
        "model": pricing["label"],
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "input_cost": round(input_cost, 4),
        "output_cost": round(output_cost, 4),
        "total_cost": round(input_cost + output_cost, 4),
    }


class ComparisonRequest(BaseModel):
    persona_id: str


@router.post("/generate-comparison")
def generate_comparison(
    data: ComparisonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate posts for a persona using both Sonnet and Opus for comparison."""
    persona = db.query(Persona).filter(Persona.id == data.persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    from app.services.persona_content_service import PersonaContentService

    # Get brand name for product-specific copy
    brand_name = ""
    if persona.brand_id:
        brand = db.query(Brand).filter(Brand.id == persona.brand_id).first()
        if brand:
            brand_name = brand.name or ""

    persona_dict = {
        "name": persona.name,
        "gender": persona.gender,
        "age": persona.age,
        "location_city": persona.location_city,
        "location_state": persona.location_state,
        "occupation": persona.occupation,
        "family_details": persona.family_details,
        "weight_loss_backstory": persona.weight_loss_backstory,
        "personality_voice": persona.personality_voice,
        "story_angle": persona.story_angle,
        "body_type_description": persona.body_type_description,
        "timeline_months": persona.timeline_months,
        "before_weight": persona.before_weight,
        "after_weight": persona.after_weight,
        "total_lost": persona.total_lost,
        "brand_name": brand_name,
    }

    results = {
        "persona_name": persona.name,
        "persona_details": {
            "age": persona.age,
            "gender": persona.gender,
            "location": f"{persona.location_city}, {persona.location_state}",
            "occupation": persona.occupation,
            "brand_name": brand_name,
        },
        "sonnet": [],
        "opus": [],
        "costs": {},
    }

    # Generate with Sonnet
    try:
        sonnet_service = PersonaContentService(model="sonnet")
        results["sonnet"] = sonnet_service.generate_posts(persona_dict)
        results["costs"]["sonnet"] = _calc_cost(getattr(sonnet_service, '_last_usage', {}))
    except Exception as e:
        logger.exception("Sonnet generation failed")
        raise HTTPException(status_code=500, detail=f"Sonnet generation failed: {str(e)}")

    # Generate with Opus
    try:
        opus_service = PersonaContentService(model="opus")
        results["opus"] = opus_service.generate_posts(persona_dict)
        results["costs"]["opus"] = _calc_cost(getattr(opus_service, '_last_usage', {}))
    except Exception as e:
        logger.exception("Opus generation failed")
        raise HTTPException(status_code=500, detail=f"Opus generation failed: {str(e)}")

    # Add cost comparison summary
    sonnet_cost = results["costs"].get("sonnet", {}).get("total_cost", 0)
    opus_cost = results["costs"].get("opus", {}).get("total_cost", 0)
    results["costs"]["summary"] = {
        "sonnet_total": sonnet_cost,
        "opus_total": opus_cost,
        "difference": round(opus_cost - sonnet_cost, 4),
        "opus_multiplier": round(opus_cost / sonnet_cost, 1) if sonnet_cost > 0 else 0,
        "cost_per_44_personas_sonnet": round(sonnet_cost * 44, 2),
        "cost_per_44_personas_opus": round(opus_cost * 44, 2),
    }

    return results
