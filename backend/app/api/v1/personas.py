"""Persona Farm — manage personas, generate content, track deployment."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func
from typing import Optional, List
from pydantic import BaseModel
from app.database import get_db
from app.models import (
    Persona, PersonaPost, PersonaComment, PersonaImagePrompt,
    PersonaImage, AffiliateUrl, User, FacebookConnection, PersonaQueueItem,
    Brand,
)
from app.core.deps import get_current_active_user
from app.data.persona_seeds import PERSONA_SEEDS
from app.services.assignment_sync import sync_from_persona
from app.services.hero_sync_service import sync_persona_to_hero_map, remove_persona_from_hero_map, bulk_remove_personas_from_hero_map
from app.services.facebook_service import FacebookService

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class PersonaCreate(BaseModel):
    name: str
    gender: str
    age: int
    location_city: str
    location_state: str
    occupation: str
    family_details: Optional[dict] = None
    weight_loss_backstory: Optional[str] = None
    personality_voice: Optional[str] = None
    story_angle: Optional[str] = None
    body_type_description: Optional[str] = None
    brand_id: Optional[str] = None
    offer: Optional[str] = "akemi"


class PersonaUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    occupation: Optional[str] = None
    family_details: Optional[dict] = None
    weight_loss_backstory: Optional[str] = None
    personality_voice: Optional[str] = None
    story_angle: Optional[str] = None
    body_type_description: Optional[str] = None
    fb_page_id: Optional[str] = None
    fb_ad_account_id: Optional[str] = None
    domain_id: Optional[str] = None
    brand_id: Optional[str] = None
    offer: Optional[str] = None
    is_active: Optional[bool] = None


class PostUpdate(BaseModel):
    headline: Optional[str] = None
    body_text: Optional[str] = None
    status: Optional[str] = None
    photo_type: Optional[str] = None


class CommentUpdate(BaseModel):
    body_text: Optional[str] = None
    status: Optional[str] = None


class ImagePromptUpdate(BaseModel):
    prompt_text: Optional[str] = None


class WinnerPromote(BaseModel):
    notes: Optional[str] = None
    proven_offers: Optional[List[str]] = None


class WinnerNotesUpdate(BaseModel):
    notes: Optional[str] = None
    proven_offers: Optional[List[str]] = None
    status: Optional[str] = None
    generated_image_path: Optional[str] = None


class AffiliateUrlCreate(BaseModel):
    url: str
    domain: str
    offer: str = "akemi"


class GenerateContentRequest(BaseModel):
    content_type: str = "all"  # posts, comments, image_prompts, all
    model: str = "sonnet"  # sonnet, haiku


class GenerateAllRequest(BaseModel):
    offer: Optional[str] = "akemi"
    model: str = "sonnet"


class GenerateBatchPersonasRequest(BaseModel):
    brand_id: str
    count: int = 1
    gender: Optional[str] = None  # "female", "male", or None (AI decides mix)
    image_prompt_templates: Optional[List[str]] = None
    model: str = "sonnet"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _serialize_persona_with_counts(p, post_count: int, comment_count: int, prompt_count: int,
                                   thumbnail_url: str = None, fb_page_name: str = None, domain_name: str = None):
    """Serialize a Persona ORM object to dict with pre-fetched content counts."""
    return {
        "id": p.id,
        "name": p.name,
        "gender": p.gender,
        "age": p.age,
        "subject_gender": p.subject_gender,
        "subject_age": p.subject_age,
        "posting_about": p.posting_about,
        "location_city": p.location_city,
        "location_state": p.location_state,
        "occupation": p.occupation,
        "family_details": p.family_details,
        "weight_loss_backstory": p.weight_loss_backstory,
        "personality_voice": p.personality_voice,
        "story_angle": p.story_angle,
        "body_type_description": p.body_type_description,
        "before_weight": p.before_weight,
        "after_weight": p.after_weight,
        "total_lost": p.total_lost,
        "timeline_months": p.timeline_months,
        "start_month": p.start_month,
        "body_type_before": p.body_type_before,
        "body_type_after": p.body_type_after,
        "hair": p.hair,
        "ethnicity": p.ethnicity,
        "distinguishing_features": p.distinguishing_features,
        "shame_moment": p.shame_moment,
        "authority_figure": p.authority_figure,
        "fb_page_id": p.fb_page_id,
        "fb_page_name": fb_page_name,
        "fb_ad_account_id": p.fb_ad_account_id,
        "domain_id": p.domain_id,
        "domain_name": domain_name,
        "profile_photo_set": p.profile_photo_set,
        "before_after_photo_sets": p.before_after_photo_sets,
        "brand_id": p.brand_id,
        "offer": p.offer,
        "is_active": p.is_active,
        "is_winner": p.is_winner or False,
        "winner_notes": p.winner_notes,
        "winner_proven_offers": p.winner_proven_offers,
        "winner_promoted_at": p.winner_promoted_at.isoformat() if p.winner_promoted_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "post_count": post_count,
        "comment_count": comment_count,
        "prompt_count": prompt_count,
        "thumbnail_url": thumbnail_url,
    }


def _serialize_persona(p, db: Session):
    """Serialize a Persona ORM object to dict with content counts (single-persona use)."""
    post_count = db.query(sa_func.count(PersonaPost.id)).filter(PersonaPost.persona_id == p.id).scalar() or 0
    comment_count = db.query(sa_func.count(PersonaComment.id)).filter(PersonaComment.persona_id == p.id).scalar() or 0
    prompt_count = db.query(sa_func.count(PersonaImagePrompt.id)).filter(PersonaImagePrompt.persona_id == p.id).scalar() or 0
    return _serialize_persona_with_counts(p, post_count, comment_count, prompt_count)


def _serialize_post(p):
    return {
        "id": p.id,
        "persona_id": p.persona_id,
        "post_type": p.post_type,
        "headline": p.headline,
        "body_text": p.body_text,
        "photo_type": p.photo_type,
        "photo_set_index": p.photo_set_index,
        "status": p.status,
        "fb_post_id": p.fb_post_id,
        "posted_at": p.posted_at.isoformat() if p.posted_at else None,
        "engagement_count": p.engagement_count,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _serialize_comment(c):
    return {
        "id": c.id,
        "persona_id": c.persona_id,
        "post_id": c.post_id,
        "commenter_persona_id": c.commenter_persona_id,
        "comment_type": c.comment_type,
        "body_text": c.body_text,
        "photo_path": c.photo_path,
        "affiliate_url": c.affiliate_url,
        "delay_minutes": c.delay_minutes,
        "status": c.status,
        "fb_comment_id": c.fb_comment_id,
        "posted_at": c.posted_at.isoformat() if c.posted_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _serialize_prompt(p):
    return {
        "id": p.id,
        "persona_id": p.persona_id,
        "prompt_type": p.prompt_type,
        "prompt_text": p.prompt_text,
        "generated_image_path": p.generated_image_path,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


# ─── Persona CRUD ────────────────────────────────────────────────────────────

@router.get("/")
def list_personas(
    is_active: Optional[bool] = None,
    offer: Optional[str] = None,
    brand_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(Persona)
    if is_active is not None:
        q = q.filter(Persona.is_active == is_active)
    if offer:
        q = q.filter(Persona.offer == offer)
    if brand_id:
        q = q.filter(Persona.brand_id == brand_id)
    personas = q.order_by(Persona.created_at).offset(skip).limit(limit).all()

    if not personas:
        return []

    # Batch-fetch counts to avoid N+1 queries (1 query per table instead of 3 per persona)
    persona_ids = [p.id for p in personas]
    post_counts = dict(
        db.query(PersonaPost.persona_id, sa_func.count(PersonaPost.id))
        .filter(PersonaPost.persona_id.in_(persona_ids))
        .group_by(PersonaPost.persona_id)
        .all()
    )
    comment_counts = dict(
        db.query(PersonaComment.persona_id, sa_func.count(PersonaComment.id))
        .filter(PersonaComment.persona_id.in_(persona_ids))
        .group_by(PersonaComment.persona_id)
        .all()
    )
    prompt_counts = dict(
        db.query(PersonaImagePrompt.persona_id, sa_func.count(PersonaImagePrompt.id))
        .filter(PersonaImagePrompt.persona_id.in_(persona_ids))
        .group_by(PersonaImagePrompt.persona_id)
        .all()
    )

    # Batch-fetch first image (thumbnail) per persona — prefer profile, then after, then any
    from sqlalchemy import case
    thumbnail_q = (
        db.query(PersonaImage.persona_id, PersonaImage.url)
        .filter(PersonaImage.persona_id.in_(persona_ids))
        .order_by(
            PersonaImage.persona_id,
            case(
                (PersonaImage.category == 'profile', 0),
                (PersonaImage.category == 'after', 1),
                (PersonaImage.category == 'before_after', 2),
                else_=3,
            ),
            PersonaImage.sort_order,
        )
        .all()
    )
    thumbnails = {}
    for pid, url in thumbnail_q:
        if pid not in thumbnails:
            thumbnails[pid] = url

    # Batch-fetch page names for assigned fb_page_ids
    fb_page_ids = [p.fb_page_id for p in personas if p.fb_page_id]
    page_names = {}
    if fb_page_ids:
        from app.models import TrackedPage
        pages = db.query(TrackedPage.fb_page_id, TrackedPage.name).filter(
            TrackedPage.fb_page_id.in_(fb_page_ids)
        ).all()
        page_names = {pid: name for pid, name in pages}

    # Batch-fetch domain names
    domain_ids = [p.domain_id for p in personas if p.domain_id]
    domain_names_map = {}
    if domain_ids:
        from app.models import Domain
        doms = db.query(Domain.id, Domain.name).filter(Domain.id.in_(domain_ids)).all()
        domain_names_map = {did: name for did, name in doms}

    return [
        _serialize_persona_with_counts(
            p,
            post_counts.get(p.id, 0),
            comment_counts.get(p.id, 0),
            prompt_counts.get(p.id, 0),
            thumbnail_url=thumbnails.get(p.id),
            fb_page_name=page_names.get(p.fb_page_id),
            domain_name=domain_names_map.get(p.domain_id),
        )
        for p in personas
    ]


@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    total_personas = db.query(sa_func.count(Persona.id)).scalar() or 0
    active_personas = db.query(sa_func.count(Persona.id)).filter(Persona.is_active == True).scalar() or 0
    total_posts = db.query(sa_func.count(PersonaPost.id)).scalar() or 0
    draft_posts = db.query(sa_func.count(PersonaPost.id)).filter(PersonaPost.status == "draft").scalar() or 0
    posted_posts = db.query(sa_func.count(PersonaPost.id)).filter(PersonaPost.status == "posted").scalar() or 0
    total_comments = db.query(sa_func.count(PersonaComment.id)).scalar() or 0
    total_prompts = db.query(sa_func.count(PersonaImagePrompt.id)).scalar() or 0
    approved_prompts = db.query(sa_func.count(PersonaImagePrompt.id)).filter(PersonaImagePrompt.status == "approved").scalar() or 0

    return {
        "total_personas": total_personas,
        "active_personas": active_personas,
        "total_posts": total_posts,
        "draft_posts": draft_posts,
        "posted_posts": posted_posts,
        "total_comments": total_comments,
        "total_prompts": total_prompts,
        "approved_prompts": approved_prompts,
    }


# ─── Winner Endpoints ────────────────────────────────────────────────────────


@router.get("/winners")
def list_winners(
    offer: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all winning personas, optionally filtered by proven offer."""
    from datetime import datetime
    from sqlalchemy import case

    q = db.query(Persona).filter(Persona.is_winner == True)
    if offer:
        from sqlalchemy import String
        q = q.filter(Persona.winner_proven_offers.cast(String).contains(offer))
    personas = q.order_by(Persona.winner_promoted_at.desc()).all()

    if not personas:
        return []

    persona_ids = [p.id for p in personas]
    post_counts = dict(
        db.query(PersonaPost.persona_id, sa_func.count(PersonaPost.id))
        .filter(PersonaPost.persona_id.in_(persona_ids))
        .group_by(PersonaPost.persona_id)
        .all()
    )
    comment_counts = dict(
        db.query(PersonaComment.persona_id, sa_func.count(PersonaComment.id))
        .filter(PersonaComment.persona_id.in_(persona_ids))
        .group_by(PersonaComment.persona_id)
        .all()
    )
    prompt_counts = dict(
        db.query(PersonaImagePrompt.persona_id, sa_func.count(PersonaImagePrompt.id))
        .filter(PersonaImagePrompt.persona_id.in_(persona_ids))
        .group_by(PersonaImagePrompt.persona_id)
        .all()
    )

    thumbnail_q = (
        db.query(PersonaImage.persona_id, PersonaImage.url)
        .filter(PersonaImage.persona_id.in_(persona_ids))
        .order_by(
            PersonaImage.persona_id,
            case(
                (PersonaImage.category == 'profile', 0),
                (PersonaImage.category == 'after', 1),
                (PersonaImage.category == 'before_after', 2),
                else_=3,
            ),
            PersonaImage.sort_order,
        )
        .all()
    )
    thumbnails = {}
    for pid, url in thumbnail_q:
        if pid not in thumbnails:
            thumbnails[pid] = url

    fb_page_ids = [p.fb_page_id for p in personas if p.fb_page_id]
    page_names = {}
    if fb_page_ids:
        from app.models import TrackedPage
        pages = db.query(TrackedPage.fb_page_id, TrackedPage.name).filter(
            TrackedPage.fb_page_id.in_(fb_page_ids)
        ).all()
        page_names = {pid: name for pid, name in pages}

    domain_ids = [p.domain_id for p in personas if p.domain_id]
    domain_names_map = {}
    if domain_ids:
        from app.models import Domain
        doms = db.query(Domain.id, Domain.name).filter(Domain.id.in_(domain_ids)).all()
        domain_names_map = {did: name for did, name in doms}

    return [
        _serialize_persona_with_counts(
            p,
            post_counts.get(p.id, 0),
            comment_counts.get(p.id, 0),
            prompt_counts.get(p.id, 0),
            thumbnail_url=thumbnails.get(p.id),
            fb_page_name=page_names.get(p.fb_page_id),
            domain_name=domain_names_map.get(p.domain_id),
        )
        for p in personas
    ]


@router.patch("/{persona_id}/promote-winner")
def promote_winner(
    persona_id: str,
    body: WinnerPromote,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Promote a persona to winner status."""
    from datetime import datetime, timezone
    p = db.query(Persona).filter(Persona.id == persona_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Persona not found")
    p.is_winner = True
    p.winner_notes = body.notes
    p.winner_proven_offers = body.proven_offers
    p.winner_promoted_at = datetime.now(timezone.utc)
    db.commit()
    return _serialize_persona(p, db)


@router.patch("/{persona_id}/demote-winner")
def demote_winner(
    persona_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Remove winner status from a persona."""
    p = db.query(Persona).filter(Persona.id == persona_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Persona not found")
    p.is_winner = False
    p.winner_notes = None
    p.winner_proven_offers = None
    p.winner_promoted_at = None
    db.commit()
    return _serialize_persona(p, db)


@router.patch("/{persona_id}/winner-notes")
def update_winner_notes(
    persona_id: str,
    body: WinnerNotesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update notes and proven offers on a winning persona."""
    p = db.query(Persona).filter(Persona.id == persona_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Persona not found")
    if not p.is_winner:
        raise HTTPException(status_code=400, detail="Persona is not a winner")
    if body.notes is not None:
        p.winner_notes = body.notes
    if body.proven_offers is not None:
        p.winner_proven_offers = body.proven_offers
    db.commit()
    return _serialize_persona(p, db)


@router.get("/{persona_id}")
def get_persona(
    persona_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    p = db.query(Persona).filter(Persona.id == persona_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Persona not found")
    return _serialize_persona(p, db)


@router.post("/")
def create_persona(
    data: PersonaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    persona = Persona(**data.model_dump())
    db.add(persona)
    db.commit()
    db.refresh(persona)

    # Auto-add persona's before_after images to brand hero map
    added = sync_persona_to_hero_map(persona, db)
    if added:
        db.commit()

    return _serialize_persona(persona, db)


@router.put("/{persona_id}")
def update_persona(
    persona_id: str,
    data: PersonaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    updates = data.model_dump(exclude_unset=True)

    # Validate 1:1 constraints
    if "fb_page_id" in updates and updates["fb_page_id"]:
        conflict = db.query(Persona).filter(
            Persona.fb_page_id == updates["fb_page_id"],
            Persona.id != persona_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail=f"FB page already assigned to persona '{conflict.name}'")

    if "domain_id" in updates and updates["domain_id"]:
        conflict = db.query(Persona).filter(
            Persona.domain_id == updates["domain_id"],
            Persona.id != persona_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail=f"Domain already assigned to persona '{conflict.name}'")

    for key, value in updates.items():
        setattr(persona, key, value)
    db.commit()
    db.refresh(persona)

    # Sync assignments to linked TrackedPage and Domain
    sync_from_persona(persona, db)
    db.commit()

    return _serialize_persona(persona, db)


@router.delete("/all")
def delete_all_personas(
    brand_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete all personas, optionally filtered by brand_id."""
    q = db.query(Persona)
    if brand_id:
        q = q.filter(Persona.brand_id == brand_id)
    personas = q.all()
    count = len(personas)

    # Remove hero map entries before deleting personas
    persona_ids = [p.id for p in personas]
    if persona_ids:
        bulk_remove_personas_from_hero_map(persona_ids, db)

    for p in personas:
        db.delete(p)
    db.commit()
    return {"deleted": count}


@router.delete("/{persona_id}")
def delete_persona(
    persona_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    # Remove hero map entries before deleting persona
    remove_persona_from_hero_map(persona.id, db)

    db.delete(persona)
    db.commit()
    return {"message": f"Persona '{persona.name}' deleted"}


# ─── Seed ─────────────────────────────────────────────────────────────────────

@router.post("/seed")
def seed_personas(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    created = []
    skipped = []
    for seed in PERSONA_SEEDS:
        existing = db.query(Persona).filter(Persona.name == seed["name"]).first()
        if existing:
            skipped.append(seed["name"])
            continue
        persona = Persona(**seed)
        db.add(persona)
        created.append(seed["name"])
    db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "total_created": len(created),
        "total_skipped": len(skipped),
    }


# ─── Batch Generate Personas ──────────────────────────────────────────────────

AKEMI_SYSTEM_PROMPT = """You are a persona generator for wellness-focused Facebook ad campaigns. You generate complete, realistic Facebook personas with profiles, Higgsfield image prompts, and ad copy.

COMPLIANCE RULES (MANDATORY — violating these gets ads rejected):
- NEVER include specific weight numbers ("lost 126 lbs", "down 47 pounds", etc.)
- NEVER claim medical improvements (blood pressure, diabetes, mobility aids, medication changes)
- NEVER imply the product replaces medical care or produces medical outcomes
- NEVER use guaranteed transformation language ("This Changes Everything", "guaranteed results")
- NEVER imply results without lifestyle changes
- Use soft, non-promissory wellness language: "supported my journey", "helped me feel better", "part of my new routine"
- Focus on FEELINGS and LIFESTYLE changes, not numbers or medical outcomes
- Vague progress is OK: "I feel lighter", "my clothes fit differently", "I have more energy"

COPY RULES (apply to ALL ad copy):
1. ABSOLUTELY NO ELLIPSES. Never "..." — use periods or dashes instead.
2. Product is NEVER named. Link goes in Facebook comments.
3. Never sound like an ad. Write like a real Facebook post.
4. 6th-8th grade reading level. Short paragraphs. Short sentences.
5. NO specific weight numbers anywhere. Use vague references: "down several sizes", "feeling like myself again"
6. No marketing language. No "amazing results."
7. Raw, honest, emotional, vulnerable tone.
8. The victory at the end must MIRROR the struggle at the beginning.
9. Frame everything as personal wellness journey, NOT medical transformation.

APPROVED STATES: TX, FL, OH, GA, NC, PA, TN, MO, AZ, AL, SC, IN, KY, LA, MS, AR, OK, VA, WI

STRUGGLE MOMENT BANK (assign one per persona, never repeat in batch):
- Couldn't get off the floor playing with grandkids
- Needed a seatbelt extender on a plane
- Caught spouse looking at her with pity getting dressed
- Didn't recognize herself in a store window
- Wanted to report her own photo on Facebook
- Broke a lawn chair at a family BBQ
- Couldn't fit in a restaurant booth at anniversary dinner
- Couldn't buckle a life jacket on a family boat trip
- Daughter said "you take the photos" at graduation
- Grandson tied her shoes for her without being asked
- Roller coaster lap bar wouldn't close, asked to step off
- Stopped going to church — couldn't fit in the pew
- Had to buy two seats at a sporting event
- Couldn't tie own shoes, switched to slip-ons for 3 years
- Got stuck in a turnstile
- Avoided pool/beach for 8 straight summers
- Couldn't fit in bathtub at hotel on vacation
- Her closet has clothes she hasn't opened in 6 years
- Couldn't cross her legs in a work meeting
- Couldn't walk a full aisle at Costco without leaning on cart
- Granddaughter drew her as a circle at school

AUTHORITY FIGURE BANK (assign one per persona, never repeat in batch):
- Sister-in-law, nurse / nurse practitioner
- Daughter studying biochemistry
- Neighbor, retired nutritionist
- Friend, nurse practitioner
- Acupuncturist
- Pharmacist (a woman her own age)
- College roommate in functional medicine
- Brother-in-law in sports medicine
- Physical therapist
- Massage therapist (lymphatic drainage specialty)
- Friend, nurse at the VA hospital
- Coworker whose husband is a naturopath
- Cousin in holistic health

OLD CLOTHES ITEM ROTATION (don't repeat within batch):
- Enormous old blue jeans
- Enormous old beige underwear / boxers
- Giant old dress / muumuu (female only)
- Giant old sweater (can show couple both inside one sweater)
- Enormous old sweatpants / stretch pants
- Giant old bra / support garment (female only)
"""

AKEMI_PERSONA_PROMPT = """Generate exactly {count} complete wellness persona(s). Each persona includes a full profile, 2 Higgsfield image prompts, and 4 pieces of ad copy.

DEMOGRAPHIC DISTRIBUTION (for batch of 10, scale proportionally):
- 7 female, 3 male (males always post about their wife's transformation)
- 6 white, 2 Black, 1 Hispanic, 1 mixed/other
- Age spread: 2 in 40s, 4 in 50s, 3 in 60s, 1 in late 40s
- Personas describe going from "unhappy with how they looked/felt" to "feeling great" — NO specific weight numbers
- Location spread: no more than 2 from the same state

EXISTING PERSONAS (do NOT reuse names, states, shame moments, authority figures, or occupations):
{existing_info}

Return ONLY valid JSON with this structure:
{{
  "personas": [
    {{
      "name": "First name only — common American name matching ethnicity",
      "posting_about": "wife NAME" or null if female posting about self,
      "gender": "male" or "female" (poster's gender),
      "age": 49,
      "subject_gender": "female" (who the story is about),
      "subject_age": 51 (if different from poster),
      "location_city": "Murfreesboro",
      "location_state": "TN",
      "occupation": "HVAC technician",
      "spouse": "Tammy, 51, medical billing clerk",
      "kids": "Three — two in college, one in high school",
      "grandkids": "None yet",
      "story_angle": "The hook for WHY they're posting. Written in their voice.",
      "voice_style": "2-3 sentences describing how they write. Vocabulary level, personality, quirks, tone.",
      "backstory": "4-6 sentences. How they gained weight, what they tried that failed (3-4 specific programs/diets), the breaking point, how they discovered the tea, current status.",
      "before_weight": 224,
      "after_weight": 126,
      "total_lost": 53,
      "timeline_months": 5,
      "start_month": "September",
      "body_type_before": "5'6, very heavy, carries weight in midsection and hips. Round puffy face, double chin, thick arms.",
      "body_type_after": "Same height, slim, flat stomach, angular face with visible jawline, thin arms.",
      "hair": "Dirty blonde, shoulder-length, usually worn down",
      "ethnicity": "White, fair-skinned",
      "distinguishing_features": "Small gold stud earrings, light freckles across nose",
      "shame_moment": "One specific vivid humiliating scene from the bank",
      "authority_figure": "Specific person + their credential from the bank",
      "old_clothes_item": "Specific item from the rotation bank",
      "image_prompts": {{
        "before": "Full detailed Higgsfield prompt for BEFORE photo (seated, morbidly obese, 600 lb life inspired, NO weight numbers, candid iPhone photo, no text)",
        "after": "Short prompt referencing BEFORE — same person but after losing X lbs. Very thin, flat stomach, skinny arms and legs, sharp jawline, slim face. Wearing fitted clothes. Standing outside in sunlight. Confident smile. iPhone photo. No text.",
        "old_clothes_pants": "Prompt for the SUBJECT (if male persona posting about wife, describe the WIFE not the husband). Ultra-realistic iPhone photo of thin [age] [ethnicity] [gender] standing outdoors or in home, wearing their old jeans/pants from when they were heavy. The person is grabbing the waistband with one hand and pulling it OUT from their body to show a MASSIVE gap — the jeans are absurdly too big, there is a huge empty space between the waistband and their now-slim stomach, like 8+ inches of slack. The pants are real denim jeans (NOT overalls, NOT sweatpants). The person looks down at the gap with a shocked/amused expression. [hair description]. Natural lighting, candid authentic look, no text overlay, no logos.",
        "old_clothes_underwear": "Prompt for the SUBJECT (if male persona posting about wife, describe the WIFE not the husband). Ultra-realistic iPhone photo of thin [age] [ethnicity] [gender] standing in living room or bedroom, holding up a pair of their old underwear/granny panties stretched wide open with BOTH hands, arms fully extended apart. The underwear is ABSURDLY ENORMOUS — like a small bedsheet, the waistband stretched to 3-4 feet wide, big enough to wrap around the person 3 times. The underwear is plain beige/nude colored, massive cotton briefs. The person has a shocked or laughing expression, clearly amazed at how huge the underwear is compared to their now-slim body. [hair description]. Natural home lighting, real messy background, authentic candid iPhone photo, no text overlay."
      }},
      "ad_copy": {{
        "long_form": {{"headline": "Short punchy headline 5-10 words (e.g. 'I Finally Feel Like Myself Again')", "body": "300-500 word story ad. OPENING: 'Since [month] I feel like a different person' + struggle moment. PARA 2: victory mirroring struggle. PARA 3: backstory + failed diets/programs (NO specific weight numbers). PARA 4: authority figure explains wellness angle (sluggish system, years of processed food, body needs a reset). PARA 5: morning ritual, natural ingredients, simple daily habit. PARA 6: progress described in FEELINGS not numbers (clothes fitting, energy levels, confidence, compliments from friends). FINAL LINE: The link is in the comments + soft invitation. NO WEIGHT NUMBERS ANYWHERE."}},
        "week_by_week": {{"headline": "Short punchy headline 5-10 words", "body": "300-500 word progress journal post. OPENING: 'It's been [X months] since I started' + struggle moment (unique from long_form). PARA 2: current victory mirroring struggle. PARA 3: backstory — feeling stuck, list 3-4 things they tried that didn't work (NO weight numbers). PARA 4: authority figure (different from long_form) explains WHY — sluggish system, processed food buildup, body holding onto what it doesn't need, needs a gentle reset. PARA 5: morning ritual, simple daily habit, skepticism but tried anyway. PROGRESS TIMELINE (feelings-based, NO numbers): First week: [felt lighter, less bloated, rings fitting]. First month: [clothes looser, more energy, people noticing]. Today: [overall transformation in how they FEEL, confidence, lifestyle]. FINAL LINE: The link is in the comments + 'if you've been where I was' hook. NO WEIGHT NUMBERS ANYWHERE."}},
        "number_drop": {{"headline": "Short punchy headline 5-10 words", "body": "40-80 words. Describe transformation in terms of clothing sizes dropped or how they feel — NOT weight numbers. [Age + 1-2 sentences context]. [Optional: 1 sentence teasing method]."}},
        "milestone": {{"headline": "Short punchy headline 5-10 words", "body": "40-80 words. [Specific achievement — a MOMENT, not a number]. [What it means — 1-3 sentences]. [Optional: how long ago this was impossible]."}},
        "old_clothes_pants": {{"headline": "Short punchy headline 5-10 words", "body": "40-60 words. [Reference to old pants/jeans that are now huge]. [1-2 sentences of shocked reaction]. NO weight numbers. Paired with the pants photo."}},
        "old_clothes_underwear": {{"headline": "Short punchy headline 5-10 words", "body": "40-60 words. [Reference to old underwear that's now enormous]. [1-2 sentences of embarrassed/laughing reaction]. NO weight numbers. Paired with the underwear photo."}}
      }}
    }}
  ]
}}

VALIDATION:
- Female ages 45-65, male ages 50-65
- location_state MUST be from approved list
- NO ellipses anywhere in ad copy
- Product name "Akemi" MUST NOT appear in ad copy
- All image prompts must end with "No text" instruction
- NO specific weight numbers ANYWHERE in ad copy (no "lost X lbs", no "down X pounds", no "X lbs gone")
- NO medical claims (no blood pressure, diabetes, medication, mobility aids, doctor references)
- NO guaranteed transformation language
- No two personas share same struggle moment, authority figure, state, occupation, or hair color"""


# ─── Vision Prompt for Image-Based Persona Generation ─────────────────────────

VISION_PERSONA_PROMPT = """Analyze these uploaded images carefully. They show a person's weight loss transformation — typically before photos (overweight), after photos (slim/fit), and possibly photos of old clothes that no longer fit or bathroom scale photos.

Based on what you SEE in the images, generate a complete persona profile. Ground everything in the actual photos — don't invent details that contradict what's shown.

ANALYZE FROM THE IMAGES:
- Apparent age (estimate)
- Gender
- Ethnicity/appearance
- Hair color, length, style
- Body type BEFORE (from before photos)
- Body type AFTER (from after photos)
- Estimated before weight and after weight (be realistic based on what you see)
- Distinguishing features (tattoos, glasses, jewelry, etc.)
- Setting details (what does their home/bathroom look like — use for backstory context)

THEN GENERATE (grounded in the images but creative for story details):
- A realistic first name matching their apparent ethnicity
- Location (city + state from approved list)
- Occupation (blue collar or middle class, age-appropriate)
- Family details (spouse, kids, grandkids)
- Weight loss backstory (4-6 sentences, raw and emotional)
- Personality/voice style description
- Story angle (the hook)
- A specific shame moment (vivid, humiliating, makes reader feel it)
- An authority figure who told them about the tea
- Timeline (how many months the transformation took)
- Start month

Also assign a CATEGORY to each uploaded image from these options:
- "before_after" (side-by-side transformation)
- "before" (overweight photo only)
- "after" (slim/fit photo only)
- "old_clothes" (holding up oversized old clothes)
- "scale_before" (on bathroom scale, overweight)
- "scale_after" (on bathroom scale, slim)
- "progress" (general progress shot)

COPY RULES:
1. ABSOLUTELY NO ELLIPSES. Never "..." — use periods or dashes instead.
2. Product is NEVER named. Link goes in Facebook comments.
3. Never sound like an ad. Write like a real Facebook post.
4. 6th-8th grade reading level. Short paragraphs. Short sentences.
5. Weight loss numbers must match the persona's estimated stats.
6. No marketing language. No "amazing results."
7. Raw, honest, emotional, vulnerable tone.
8. The victory at the end must MIRROR the shame at the beginning.

APPROVED STATES: TX, FL, OH, GA, NC, PA, TN, MO, AZ, AL, SC, IN, KY, LA, MS, AR, OK, VA, WI

Return ONLY valid JSON:
{
  "persona": {
    "name": "First name only",
    "gender": "female" or "male",
    "age": 55,
    "subject_gender": "female",
    "subject_age": null,
    "posting_about": null,
    "location_city": "...",
    "location_state": "TX",
    "occupation": "...",
    "spouse": "Name, age, occupation" or null,
    "kids": "..." or null,
    "grandkids": "..." or null,
    "backstory": "4-6 sentences...",
    "voice_style": "2-3 sentences describing how they write...",
    "story_angle": "The hook for WHY they're posting...",
    "before_weight": 245,
    "after_weight": 128,
    "total_lost": 117,
    "timeline_months": 6,
    "start_month": "September",
    "body_type_before": "Detailed description...",
    "body_type_after": "Detailed description...",
    "hair": "Color, length, style",
    "ethnicity": "...",
    "distinguishing_features": "...",
    "shame_moment": "Vivid humiliating scene...",
    "authority_figure": "Specific person + credential"
  },
  "ad_copy": {
    "long_form": {"headline": "Short punchy headline (5-10 words, like a Facebook ad headline)", "body": "300-500 word David Format story ad..."},
    "week_by_week": {"headline": "Short punchy headline", "body": "300-500 word progress journal post..."},
    "number_drop": {"headline": "Short punchy headline", "body": "40-80 words..."},
    "milestone": {"headline": "Short punchy headline", "body": "40-80 words..."},
    "old_clothes_pants": {"headline": "Short punchy headline", "body": "40-60 words..."} or null,
    "old_clothes_underwear": {"headline": "Short punchy headline", "body": "40-60 words..."} or null
  },
  "image_categories": ["before_after", "old_clothes", "scale_before", "scale_after"]
}"""


@router.post("/generate-from-images")
async def generate_persona_from_images(
    files: List[UploadFile] = File(...),
    brand_id: str = Form(...),
    gender: Optional[str] = Form(None),
    ethnicity: Optional[str] = Form(None),
    model: str = Form("sonnet"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Upload 1-5 images, Claude Vision analyzes them and generates a complete persona."""
    import anthropic, json, re, base64, os, uuid
    from app.core.config import settings
    from app.models import Brand

    # Validate
    if len(files) < 1 or len(files) > 5:
        raise HTTPException(status_code=400, detail="Upload 1-5 images")

    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    model_id = {"haiku": "claude-haiku-4-5-20251001", "sonnet": "claude-sonnet-4-5-20250929"}.get(model, "claude-sonnet-4-5-20250929")

    # Read all images and validate
    image_data = []
    for f in files:
        content = await f.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"File {f.filename} too large (max 10MB)")
        ext = os.path.splitext(f.filename or "img.jpg")[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
            raise HTTPException(status_code=400, detail=f"File {f.filename}: only image files allowed")
        media_type = f.content_type or "image/jpeg"
        image_data.append((content, media_type, f.filename, ext))

    # Build Claude Vision message
    vision_content = []
    for i, (img_bytes, media_type, fname, ext) in enumerate(image_data):
        vision_content.append({"type": "text", "text": f"Image {i+1} ({fname}):"})
        vision_content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.standard_b64encode(img_bytes).decode("utf-8"),
            },
        })

    # Add existing persona context for uniqueness
    existing = db.query(Persona).filter(Persona.brand_id == brand_id).all()
    existing_info_parts = []
    for p in existing:
        existing_info_parts.append(
            f"- {p.name} ({p.gender}, {p.age}, {p.location_state}, {p.occupation})"
        )
    existing_note = ""
    if existing_info_parts:
        existing_note = f"\n\nEXISTING PERSONAS (do NOT reuse names, states, or occupations):\n" + "\n".join(existing_info_parts)

    gender_note = ""
    if gender:
        gender_note = f"\n\nIMPORTANT: This persona MUST be {gender}."
        if gender == "male":
            gender_note += " Males post about their wife's transformation."

    ethnicity_note = ""
    if ethnicity:
        ethnicity_note = f"\n\nIMPORTANT: This persona's ethnicity is {ethnicity}. Generate a culturally appropriate name and details."

    vision_content.append({
        "type": "text",
        "text": VISION_PERSONA_PROMPT + existing_note + gender_note + ethnicity_note,
    })

    # Call Claude Vision with streaming
    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        text_parts = []
        with client.messages.stream(
            model=model_id,
            max_tokens=8000,
            messages=[{"role": "user", "content": vision_content}],
        ) as stream:
            for chunk in stream.text_stream:
                text_parts.append(chunk)
        text = "".join(text_parts).strip()

        # Parse JSON
        fence = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        if not text.startswith("{"):
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end > start:
                text = text[start:end]
        result = json.loads(text)
    except json.JSONDecodeError as e:
        logger.exception("Failed to parse AI vision response")
        raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {str(e)}")
    except Exception as e:
        logger.exception("Vision API call failed")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

    p_data = result.get("persona", {})
    ad_copy = result.get("ad_copy", {})
    categories = result.get("image_categories", [])

    # Deduplicate name and location against existing personas
    import random as _rand
    proposed_name = p_data.get("name", "Unknown")
    proposed_city = p_data.get("location_city", "")
    proposed_state = p_data.get("location_state", "")

    all_names = {p.name for p in db.query(Persona.name).all()}
    all_locs = {(p.location_city, p.location_state) for p in db.query(Persona.location_city, Persona.location_state).all()}

    # Fix duplicate name by appending a random last name
    if proposed_name in all_names:
        _fallback_lasts = ["Morris", "Hayes", "Sullivan", "Foster", "Brooks", "Reed", "Bell", "Cooper", "Ward", "Price", "Long", "Perry", "Powell", "Russell", "Griffin", "Barnes", "Fisher", "Webb", "Murray", "Dunn"]
        first = proposed_name.split()[0]
        for ln in _rand.sample(_fallback_lasts, len(_fallback_lasts)):
            candidate = f"{first} {ln}"
            if candidate not in all_names:
                proposed_name = candidate
                break

    # Fix duplicate location by picking a nearby city in the same state
    if (proposed_city, proposed_state) in all_locs:
        _state_cities = {
            "TX": ["Katy", "Sugar Land", "Cypress", "Tomball", "Spring", "Pearland", "League City", "Friendswood"],
            "FL": ["Dunedin", "Palm Harbor", "Largo", "Tarpon Springs", "Seminole", "Safety Harbor"],
            "AZ": ["Gilbert", "Chandler", "Tempe", "Peoria", "Surprise", "Goodyear", "Buckeye"],
            "GA": ["Kennesaw", "Smyrna", "Roswell", "Alpharetta", "Woodstock", "Canton"],
            "OH": ["Cincinnati", "Toledo", "Akron", "Dayton", "Canton", "Youngstown"],
            "NC": ["Cary", "Apex", "Holly Springs", "Garner", "Wake Forest", "Knightdale"],
            "TN": ["Maryville", "Oak Ridge", "Cookeville", "Morristown", "Clarksville"],
            "SC": ["Greenville", "Spartanburg", "Greer", "Mauldin", "Simpsonville"],
            "AL": ["Hoover", "Vestavia Hills", "Homewood", "Trussville", "Gardendale"],
            "LA": ["Mandeville", "Covington", "Madisonville", "Hammond", "Gonzales"],
            "OK": ["Owasso", "Claremore", "Bixby", "Jenks", "Sand Springs"],
            "MS": ["Biloxi", "Gulfport", "Ocean Springs", "Hattiesburg", "Laurel"],
            "IN": ["Carmel", "Fishers", "Bloomington", "Noblesville", "Greenwood"],
            "MO": ["Lee's Summit", "O'Fallon", "St. Charles", "Blue Springs", "Independence"],
            "PA": ["Allentown", "Reading", "Lancaster", "York", "Bethlehem"],
            "MI": ["Ann Arbor", "Grand Rapids", "Troy", "Livonia", "Dearborn"],
        }
        for city in _state_cities.get(proposed_state, []):
            if (city, proposed_state) not in all_locs:
                proposed_city = city
                break
        else:
            # Last resort: append a number to city
            proposed_city = f"{proposed_city} Heights"

    # Create Persona
    persona = Persona(
        name=proposed_name,
        gender=p_data.get("gender", "female"),
        age=p_data.get("age", 55),
        subject_gender=p_data.get("subject_gender"),
        subject_age=p_data.get("subject_age"),
        posting_about=p_data.get("posting_about"),
        location_city=proposed_city,
        location_state=proposed_state,
        occupation=p_data.get("occupation", ""),
        family_details={
            "spouse": p_data.get("spouse"),
            "kids": p_data.get("kids"),
            "grandkids": p_data.get("grandkids"),
        },
        weight_loss_backstory=p_data.get("backstory"),
        personality_voice=p_data.get("voice_style"),
        story_angle=p_data.get("story_angle"),
        before_weight=p_data.get("before_weight"),
        after_weight=p_data.get("after_weight"),
        total_lost=p_data.get("total_lost"),
        timeline_months=p_data.get("timeline_months"),
        start_month=p_data.get("start_month"),
        body_type_before=p_data.get("body_type_before"),
        body_type_after=p_data.get("body_type_after"),
        hair=p_data.get("hair"),
        ethnicity=p_data.get("ethnicity"),
        distinguishing_features=p_data.get("distinguishing_features"),
        shame_moment=p_data.get("shame_moment"),
        authority_figure=p_data.get("authority_figure"),
        brand_id=brand_id,
        offer=brand.name.lower().replace(" ", "_"),
    )
    db.add(persona)
    db.flush()

    # Upload images to R2 and create PersonaImage records
    for i, (img_bytes, media_type, fname, ext) in enumerate(image_data):
        category = categories[i] if i < len(categories) else "progress"
        r2_filename = f"personas/{persona.id}/{category}_{uuid.uuid4().hex[:8]}{ext}"

        if settings.r2_enabled:
            from app.api.v1.uploads import upload_to_r2
            url = await upload_to_r2(img_bytes, r2_filename, media_type)
        else:
            from app.api.v1.uploads import upload_to_local
            url = await upload_to_local(img_bytes, r2_filename)

        db.add(PersonaImage(
            persona_id=persona.id,
            category=category,
            url=url,
            filename=fname,
            sort_order=i,
        ))

    # Save ad copy as posts (supports both {"headline": ..., "body": ...} and plain string)
    for ctype, content in ad_copy.items():
        if not content:
            continue
        if isinstance(content, dict):
            headline = content.get("headline", "")
            body_text = content.get("body", "")
        else:
            headline = ""
            body_text = content
        if body_text:
            db.add(PersonaPost(
                persona_id=persona.id,
                post_type=ctype,
                headline=headline,
                body_text=body_text,
            ))

    db.commit()

    return {
        "id": persona.id,
        "name": persona.name,
        "gender": persona.gender,
        "age": persona.age,
        "location": f"{persona.location_city}, {persona.location_state}",
        "image_count": len(image_data),
        "post_count": len([v for v in ad_copy.values() if v]),
    }


# ─── Persona Queue ────────────────────────────────────────────────────────────

class PersonaQueueItemCreate(BaseModel):
    brand_id: str
    image_urls: List[str]
    gender: Optional[str] = None
    ethnicity: Optional[str] = None


@router.get("/queue")
def list_persona_queue(
    brand_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List queue items for a brand (pending + error + recent done)."""
    items = (
        db.query(PersonaQueueItem)
        .filter(PersonaQueueItem.brand_id == brand_id)
        .order_by(PersonaQueueItem.created_at.asc())
        .all()
    )
    return [
        {
            "id": item.id,
            "brand_id": item.brand_id,
            "image_urls": item.image_urls or [],
            "gender": item.gender,
            "ethnicity": item.ethnicity,
            "status": item.status,
            "result_name": item.result_name,
            "error_message": item.error_message,
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
        for item in items
    ]


@router.post("/queue")
def add_persona_queue_item(
    data: PersonaQueueItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Add a queue item."""
    item = PersonaQueueItem(
        brand_id=data.brand_id,
        image_urls=data.image_urls,
        gender=data.gender,
        ethnicity=data.ethnicity,
        status="pending",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "id": item.id,
        "brand_id": item.brand_id,
        "image_urls": item.image_urls or [],
        "gender": item.gender,
        "ethnicity": item.ethnicity,
        "status": item.status,
        "result_name": item.result_name,
        "error_message": item.error_message,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


@router.delete("/queue/clear")
def clear_persona_queue(
    brand_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Clear done items for a brand."""
    deleted = (
        db.query(PersonaQueueItem)
        .filter(
            PersonaQueueItem.brand_id == brand_id,
            PersonaQueueItem.status.in_(["done"]),
        )
        .delete(synchronize_session="fetch")
    )
    db.commit()
    return {"deleted": deleted}


@router.delete("/queue/{item_id}")
def remove_persona_queue_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Remove a queue item."""
    item = db.query(PersonaQueueItem).filter(PersonaQueueItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}


class GenerateFromUrlsRequest(BaseModel):
    brand_id: str
    image_urls: List[str]
    gender: Optional[str] = None
    ethnicity: Optional[str] = None
    model: str = "sonnet"
    queue_item_id: Optional[str] = None


@router.post("/generate-from-urls")
async def generate_persona_from_urls(
    data: GenerateFromUrlsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate a persona from pre-uploaded R2 image URLs."""
    import anthropic, json, re, base64, os, uuid, httpx
    from app.core.config import settings
    from app.models import Brand

    if len(data.image_urls) < 1 or len(data.image_urls) > 5:
        raise HTTPException(status_code=400, detail="Provide 1-5 image URLs")

    brand = db.query(Brand).filter(Brand.id == data.brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    # Track queue item if provided
    queue_item = None
    if data.queue_item_id:
        queue_item = db.query(PersonaQueueItem).filter(PersonaQueueItem.id == data.queue_item_id).first()
        if queue_item:
            queue_item.status = "processing"
            queue_item.error_message = None
            db.commit()

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    model_id = {"haiku": "claude-haiku-4-5-20251001", "sonnet": "claude-sonnet-4-5-20250929"}.get(data.model, "claude-sonnet-4-5-20250929")

    # Download images for base64 encoding
    image_data = []
    async with httpx.AsyncClient(timeout=30) as client:
        for url in data.image_urls:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Could not download image: {url}")
            content_type = resp.headers.get("content-type", "image/jpeg")
            image_data.append((resp.content, content_type, url.split("/")[-1], os.path.splitext(url)[-1] or ".jpg"))

    # Build Claude Vision message
    vision_content = []
    for i, (img_bytes, media_type, fname, ext) in enumerate(image_data):
        vision_content.append({"type": "text", "text": f"Image {i+1} ({fname}):"})
        vision_content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.standard_b64encode(img_bytes).decode("utf-8"),
            },
        })

    # Add existing persona context for uniqueness
    existing = db.query(Persona).filter(Persona.brand_id == data.brand_id).all()
    existing_info_parts = [
        f"- {p.name} ({p.gender}, {p.age}, {p.location_state}, {p.occupation})"
        for p in existing
    ]
    existing_note = ""
    if existing_info_parts:
        existing_note = f"\n\nEXISTING PERSONAS (do NOT reuse names, states, or occupations):\n" + "\n".join(existing_info_parts)

    gender_note = ""
    if data.gender:
        gender_note = f"\n\nIMPORTANT: This persona MUST be {data.gender}."
        if data.gender == "male":
            gender_note += " Males post about their wife's transformation."

    ethnicity_note = ""
    if data.ethnicity:
        ethnicity_note = f"\n\nIMPORTANT: This persona's ethnicity is {data.ethnicity}. Generate a culturally appropriate name and details."

    vision_content.append({
        "type": "text",
        "text": VISION_PERSONA_PROMPT + existing_note + gender_note + ethnicity_note,
    })

    try:
        ai_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        text_parts = []
        with ai_client.messages.stream(
            model=model_id,
            max_tokens=8000,
            messages=[{"role": "user", "content": vision_content}],
        ) as stream:
            for chunk in stream.text_stream:
                text_parts.append(chunk)
        text = "".join(text_parts).strip()

        fence = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        if not text.startswith("{"):
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end > start:
                text = text[start:end]
        result = json.loads(text)
    except json.JSONDecodeError as e:
        logger.exception("Failed to parse AI vision response")
        if queue_item:
            queue_item.status = "error"
            queue_item.error_message = f"AI returned invalid JSON: {str(e)}"
            db.commit()
        raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {str(e)}")
    except Exception as e:
        logger.exception("Vision API call failed")
        if queue_item:
            queue_item.status = "error"
            queue_item.error_message = f"AI generation failed: {str(e)}"
            db.commit()
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

    p_data = result.get("persona", {})
    ad_copy = result.get("ad_copy", {})
    categories = result.get("image_categories", [])

    # Deduplicate name and location
    import random as _rand
    proposed_name = p_data.get("name", "Unknown")
    proposed_city = p_data.get("location_city", "")
    proposed_state = p_data.get("location_state", "")

    all_names = {p.name for p in db.query(Persona.name).all()}
    all_locs = {(p.location_city, p.location_state) for p in db.query(Persona.location_city, Persona.location_state).all()}

    if proposed_name in all_names:
        _fallback_lasts = ["Morris", "Hayes", "Sullivan", "Foster", "Brooks", "Reed", "Bell", "Cooper", "Ward", "Price", "Long", "Perry", "Powell", "Russell", "Griffin", "Barnes", "Fisher", "Webb", "Murray", "Dunn"]
        first = proposed_name.split()[0]
        for ln in _rand.sample(_fallback_lasts, len(_fallback_lasts)):
            candidate = f"{first} {ln}"
            if candidate not in all_names:
                proposed_name = candidate
                break

    if (proposed_city, proposed_state) in all_locs:
        _state_cities = {
            "TX": ["Katy", "Sugar Land", "Cypress", "Tomball", "Spring", "Pearland", "League City"],
            "FL": ["Dunedin", "Palm Harbor", "Largo", "Tarpon Springs", "Seminole", "Safety Harbor"],
            "AZ": ["Gilbert", "Chandler", "Tempe", "Peoria", "Surprise", "Goodyear"],
            "GA": ["Kennesaw", "Smyrna", "Roswell", "Alpharetta", "Woodstock"],
            "OH": ["Cincinnati", "Toledo", "Akron", "Dayton", "Canton"],
            "NC": ["Cary", "Apex", "Holly Springs", "Garner", "Wake Forest"],
            "TN": ["Maryville", "Oak Ridge", "Cookeville", "Morristown", "Clarksville"],
            "AL": ["Hoover", "Vestavia Hills", "Homewood", "Trussville", "Gardendale"],
            "LA": ["Mandeville", "Covington", "Madisonville", "Hammond", "Gonzales"],
            "OK": ["Owasso", "Claremore", "Bixby", "Jenks", "Sand Springs"],
        }
        for city in _state_cities.get(proposed_state, []):
            if (city, proposed_state) not in all_locs:
                proposed_city = city
                break
        else:
            proposed_city = f"{proposed_city} Heights"

    persona = Persona(
        name=proposed_name,
        gender=p_data.get("gender", "female"),
        age=p_data.get("age", 55),
        subject_gender=p_data.get("subject_gender"),
        subject_age=p_data.get("subject_age"),
        posting_about=p_data.get("posting_about"),
        location_city=proposed_city,
        location_state=proposed_state,
        occupation=p_data.get("occupation", ""),
        family_details={
            "spouse": p_data.get("spouse"),
            "kids": p_data.get("kids"),
            "grandkids": p_data.get("grandkids"),
        },
        weight_loss_backstory=p_data.get("backstory"),
        personality_voice=p_data.get("voice_style"),
        story_angle=p_data.get("story_angle"),
        before_weight=p_data.get("before_weight"),
        after_weight=p_data.get("after_weight"),
        total_lost=p_data.get("total_lost"),
        timeline_months=p_data.get("timeline_months"),
        start_month=p_data.get("start_month"),
        body_type_before=p_data.get("body_type_before"),
        body_type_after=p_data.get("body_type_after"),
        hair=p_data.get("hair"),
        ethnicity=p_data.get("ethnicity"),
        distinguishing_features=p_data.get("distinguishing_features"),
        shame_moment=p_data.get("shame_moment"),
        authority_figure=p_data.get("authority_figure"),
        brand_id=data.brand_id,
        offer=brand.name.lower().replace(" ", "_"),
    )
    db.add(persona)
    db.flush()

    # Images already in R2 — just create PersonaImage records
    for i, url in enumerate(data.image_urls):
        category = categories[i] if i < len(categories) else "progress"
        db.add(PersonaImage(
            persona_id=persona.id,
            category=category,
            url=url,
            filename=url.split("/")[-1],
            sort_order=i,
        ))

    # Save ad copy as posts
    for ctype, content in ad_copy.items():
        if not content:
            continue
        if isinstance(content, dict):
            headline = content.get("headline", "")
            body_text = content.get("body", "")
        else:
            headline = ""
            body_text = content
        if body_text:
            db.add(PersonaPost(
                persona_id=persona.id,
                post_type=ctype,
                headline=headline,
                body_text=body_text,
            ))

    # Update queue item on success
    if queue_item:
        queue_item.status = "done"
        queue_item.result_name = persona.name
        queue_item.error_message = None

    db.commit()

    return {
        "id": persona.id,
        "name": persona.name,
        "gender": persona.gender,
        "age": persona.age,
        "location": f"{persona.location_city}, {persona.location_state}",
        "image_count": len(data.image_urls),
        "post_count": len([v for v in ad_copy.values() if v]),
    }


@router.post("/generate-batch")
def generate_batch_personas(
    data: GenerateBatchPersonasRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate N new personas for a brand using AI — full profile + image prompts + ad copy."""
    from app.models import Brand
    import anthropic, json, re
    from app.core.config import settings

    brand = db.query(Brand).filter(Brand.id == data.brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    model_id = {"haiku": "claude-haiku-4-5-20251001", "sonnet": "claude-sonnet-4-5-20250929"}.get(data.model, "claude-sonnet-4-5-20250929")

    # Get existing persona info for uniqueness
    existing = db.query(Persona).filter(Persona.brand_id == data.brand_id).all()
    existing_info_parts = []
    for p in existing:
        existing_info_parts.append(
            f"- {p.name} ({p.gender}, {p.age}, {p.location_state}, {p.occupation}, shame: {p.shame_moment or 'N/A'}, authority: {p.authority_figure or 'N/A'})"
        )
    existing_info = "\n".join(existing_info_parts) if existing_info_parts else "None yet"

    is_akemi = "akemi" in (brand.name or "").lower()
    if is_akemi:
        system = AKEMI_SYSTEM_PROMPT
        user_prompt = AKEMI_PERSONA_PROMPT.format(count=data.count, existing_info=existing_info)
        # Override gender if specified
        if data.gender:
            gender_instruction = f"\n\nIMPORTANT: ALL {data.count} persona(s) MUST be {data.gender}. Override the demographic distribution — every persona in this batch is {data.gender}."
            if data.gender == "male":
                gender_instruction += " Males post about their wife's transformation."
            user_prompt += gender_instruction
    else:
        # Generic fallback for non-Akemi brands
        system = "You are a persona generator for Facebook ad campaigns."
        user_prompt = f"Generate {data.count} personas for brand '{brand.name}'. Return JSON with a 'personas' array."

    try:
        text_parts = []
        with client.messages.stream(
            model=model_id,
            max_tokens=8000 * max(data.count, 1),
            system=system,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            for chunk in stream.text_stream:
                text_parts.append(chunk)
        text = "".join(text_parts).strip()
        fence = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        if not text.startswith("{"):
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end > start:
                text = text[start:end]
        result = json.loads(text)
        persona_list = result.get("personas", [])
    except Exception as e:
        logger.exception("Failed to generate personas via AI")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

    created = []
    for p_data in persona_list:
        p_name = p_data.get("name", "")
        if db.query(Persona).filter(Persona.name == p_name).first():
            continue

        persona = Persona(
            name=p_name,
            gender=p_data.get("gender", "female"),
            age=p_data.get("age", 55),
            subject_gender=p_data.get("subject_gender"),
            subject_age=p_data.get("subject_age"),
            posting_about=p_data.get("posting_about"),
            location_city=p_data.get("location_city", ""),
            location_state=p_data.get("location_state", ""),
            occupation=p_data.get("occupation", ""),
            family_details={
                "spouse": p_data.get("spouse"),
                "kids": p_data.get("kids"),
                "grandkids": p_data.get("grandkids"),
            },
            weight_loss_backstory=p_data.get("backstory"),
            personality_voice=p_data.get("voice_style"),
            story_angle=p_data.get("story_angle"),
            before_weight=p_data.get("before_weight"),
            after_weight=p_data.get("after_weight"),
            total_lost=p_data.get("total_lost"),
            timeline_months=p_data.get("timeline_months"),
            start_month=p_data.get("start_month"),
            body_type_before=p_data.get("body_type_before"),
            body_type_after=p_data.get("body_type_after"),
            hair=p_data.get("hair"),
            ethnicity=p_data.get("ethnicity"),
            distinguishing_features=p_data.get("distinguishing_features"),
            shame_moment=p_data.get("shame_moment"),
            authority_figure=p_data.get("authority_figure"),
            brand_id=data.brand_id,
            offer=brand.name.lower().replace(" ", "_"),
        )
        db.add(persona)
        db.flush()

        # Save image prompts
        img_prompts = p_data.get("image_prompts", {})
        for ptype in ("before", "after", "old_clothes_pants", "old_clothes_underwear"):
            txt = img_prompts.get(ptype)
            if txt:
                db.add(PersonaImagePrompt(
                    persona_id=persona.id,
                    prompt_type=ptype,
                    prompt_text=txt,
                ))

        # Save ad copy as posts
        ad_copy = p_data.get("ad_copy", {})
        for ctype, content in ad_copy.items():
            if not content:
                continue
            if isinstance(content, dict):
                headline = content.get("headline", "")
                body_text = content.get("body", "")
            else:
                headline = ""
                body_text = content
            if body_text:
                db.add(PersonaPost(
                    persona_id=persona.id,
                    post_type=ctype,
                    headline=headline,
                    body_text=body_text,
                ))

        created.append(p_name)

    db.commit()

    return {
        "created": created,
        "count": len(created),
        "brand": brand.name,
    }


# ─── Posts ────────────────────────────────────────────────────────────────────

@router.get("/{persona_id}/posts")
def list_posts(
    persona_id: str,
    post_type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(PersonaPost).filter(PersonaPost.persona_id == persona_id)
    if post_type:
        q = q.filter(PersonaPost.post_type == post_type)
    if status:
        q = q.filter(PersonaPost.status == status)
    return [_serialize_post(p) for p in q.order_by(PersonaPost.created_at).all()]


@router.put("/posts/{post_id}")
def update_post(
    post_id: str,
    data: PostUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    post = db.query(PersonaPost).filter(PersonaPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(post, key, value)
    db.commit()
    db.refresh(post)
    return _serialize_post(post)


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    post = db.query(PersonaPost).filter(PersonaPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    db.delete(post)
    db.commit()
    return {"message": "Post deleted"}


@router.post("/{persona_id}/generate-headlines")
def generate_headlines_for_posts(
    persona_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate headlines for existing posts that don't have one."""
    import anthropic, json, re
    from app.core.config import settings

    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    posts = db.query(PersonaPost).filter(
        PersonaPost.persona_id == persona_id,
        (PersonaPost.headline == None) | (PersonaPost.headline == ""),
    ).all()

    if not posts:
        return {"message": "All posts already have headlines", "updated": 0}

    post_list = [{"id": p.id, "post_type": p.post_type, "body_text": p.body_text[:300]} for p in posts]

    prompt = f"""Generate short punchy headlines for these Facebook ad posts by {persona.name}.

Headlines should be 5-10 words, emotional, attention-grabbing — like Facebook ad headlines.
Examples: "I Almost Gave Up at 247 lbs", "Down 61 lbs Since October", "This Is What Freedom Looks Like"

Posts needing headlines:
{json.dumps(post_list, indent=2)}

Return ONLY valid JSON:
{{
  "headlines": [
    {{"id": "<post id>", "headline": "Short Punchy Headline Here"}},
    ...
  ]
}}"""

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    text_parts = []
    with client.messages.stream(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for chunk in stream.text_stream:
            text_parts.append(chunk)
    text = "".join(text_parts).strip()

    fence = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    result = json.loads(text)

    updated = 0
    post_map = {p.id: p for p in posts}
    for item in result.get("headlines", []):
        post = post_map.get(item["id"])
        if post and item.get("headline"):
            post.headline = item["headline"]
            updated += 1

    db.commit()
    return {"message": f"Generated {updated} headlines", "updated": updated}


# ─── Publish Post to FB ────────────────────────────────────────────────────────

class PublishPostRequest(BaseModel):
    connection_id: str
    image_url: Optional[str] = None  # photo to attach


@router.post("/{persona_id}/posts/{post_id}/publish")
def publish_post_to_fb(
    persona_id: str,
    post_id: str,
    data: PublishPostRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Publish a persona's draft post to their assigned FB page."""
    from datetime import datetime, timezone

    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    if not persona.fb_page_id:
        raise HTTPException(status_code=400, detail="Persona has no FB page assigned")

    post = db.query(PersonaPost).filter(
        PersonaPost.id == post_id,
        PersonaPost.persona_id == persona_id,
    ).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == data.connection_id,
        FacebookConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Facebook connection not found")

    fb_service = FacebookService(connection=conn)
    fb_service.initialize()

    # Build the message: headline + body
    message = post.body_text
    if post.headline:
        message = f"{post.headline}\n\n{message}"

    try:
        result = fb_service.publish_page_post(
            page_id=persona.fb_page_id,
            message=message,
            image_url=data.image_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to publish: {str(e)}")

    # Update post record
    fb_post_id = result.get("id") or result.get("post_id")
    post.fb_post_id = fb_post_id
    post.status = "posted"
    post.posted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(post)

    return {
        "message": "Post published to Facebook",
        "fb_post_id": fb_post_id,
        "post_id": post.id,
        "persona_id": persona_id,
        "page_id": persona.fb_page_id,
    }


# ─── Page Posts (fetch from FB) ────────────────────────────────────────────────

@router.get("/{persona_id}/page-posts")
def get_page_posts(
    persona_id: str,
    connection_id: str,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Fetch recent posts from a persona's assigned FB page."""
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    if not persona.fb_page_id:
        raise HTTPException(status_code=400, detail="Persona has no FB page assigned")

    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == connection_id,
        FacebookConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Facebook connection not found")

    fb_service = FacebookService(connection=conn)
    fb_service.initialize()

    try:
        posts = fb_service.get_page_posts(page_id=persona.fb_page_id, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch posts: {str(e)}")

    return {"posts": posts, "page_id": persona.fb_page_id}


# ─── Comments ─────────────────────────────────────────────────────────────────

@router.get("/{persona_id}/comments")
def list_comments(
    persona_id: str,
    comment_type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(PersonaComment).filter(PersonaComment.persona_id == persona_id)
    if comment_type:
        q = q.filter(PersonaComment.comment_type == comment_type)
    if status:
        q = q.filter(PersonaComment.status == status)
    return [_serialize_comment(c) for c in q.order_by(PersonaComment.created_at).all()]


@router.put("/comments/{comment_id}")
def update_comment(
    comment_id: str,
    data: CommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    comment = db.query(PersonaComment).filter(PersonaComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(comment, key, value)
    db.commit()
    db.refresh(comment)
    return _serialize_comment(comment)


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    comment = db.query(PersonaComment).filter(PersonaComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()
    return {"message": "Comment deleted"}


# ─── Image Prompts ────────────────────────────────────────────────────────────

@router.get("/{persona_id}/image-prompts")
def list_image_prompts(
    persona_id: str,
    prompt_type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(PersonaImagePrompt).filter(PersonaImagePrompt.persona_id == persona_id)
    if prompt_type:
        q = q.filter(PersonaImagePrompt.prompt_type == prompt_type)
    if status:
        q = q.filter(PersonaImagePrompt.status == status)
    return [_serialize_prompt(p) for p in q.order_by(PersonaImagePrompt.created_at).all()]


@router.put("/image-prompts/{prompt_id}")
def update_image_prompt(
    prompt_id: str,
    data: ImagePromptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    prompt = db.query(PersonaImagePrompt).filter(PersonaImagePrompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Image prompt not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(prompt, key, value)
    db.commit()
    db.refresh(prompt)
    return _serialize_prompt(prompt)


@router.delete("/image-prompts/{prompt_id}")
def delete_image_prompt(
    prompt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    prompt = db.query(PersonaImagePrompt).filter(PersonaImagePrompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(status_code=404, detail="Image prompt not found")
    db.delete(prompt)
    db.commit()
    return {"message": "Image prompt deleted"}


# ─── Persona Images (uploads) ────────────────────────────────────────────────

def _serialize_image(img):
    return {
        "id": img.id,
        "persona_id": img.persona_id,
        "category": img.category,
        "url": img.url,
        "filename": img.filename,
        "notes": img.notes,
        "sort_order": img.sort_order,
        "created_at": img.created_at.isoformat() if img.created_at else None,
    }


@router.get("/{persona_id}/images")
def list_persona_images(
    persona_id: str,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(PersonaImage).filter(PersonaImage.persona_id == persona_id)
    if category:
        q = q.filter(PersonaImage.category == category)
    return [_serialize_image(img) for img in q.order_by(PersonaImage.category, PersonaImage.sort_order).all()]


@router.post("/{persona_id}/images")
async def upload_persona_image(
    persona_id: str,
    file: UploadFile = File(...),
    category: str = Form("before_after"),
    notes: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Upload an image for a persona (e.g. Higgsfield output)."""
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    import os, uuid
    from app.core.config import settings

    # Read file
    content = await file.read(10 * 1024 * 1024 + 1)  # 10MB max
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    ext = os.path.splitext(file.filename or "img.jpg")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        raise HTTPException(status_code=400, detail="Only image files allowed")

    filename = f"personas/{persona_id}/{category}_{uuid.uuid4().hex[:8]}{ext}"

    # Upload to R2 or local
    if settings.r2_enabled:
        from app.api.v1.uploads import upload_to_r2
        url = await upload_to_r2(content, filename, file.content_type or "image/jpeg")
    else:
        from app.api.v1.uploads import upload_to_local
        url = await upload_to_local(content, filename)

    img = PersonaImage(
        persona_id=persona_id,
        category=category,
        url=url,
        filename=file.filename,
        notes=notes,
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    return _serialize_image(img)


@router.delete("/images/{image_id}")
def delete_persona_image(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    img = db.query(PersonaImage).filter(PersonaImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    db.delete(img)
    db.commit()
    return {"message": "Image deleted"}


# ─── Affiliate URLs ──────────────────────────────────────────────────────────

@router.get("/affiliate-urls/list")
def list_affiliate_urls(
    offer: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(AffiliateUrl).filter(AffiliateUrl.is_active == True)
    if offer:
        q = q.filter(AffiliateUrl.offer == offer)
    urls = q.order_by(AffiliateUrl.created_at).all()
    return [
        {
            "id": u.id,
            "url": u.url,
            "domain": u.domain,
            "offer": u.offer,
            "is_active": u.is_active,
            "last_used_at": u.last_used_at.isoformat() if u.last_used_at else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in urls
    ]


@router.post("/affiliate-urls")
def create_affiliate_url(
    data: AffiliateUrlCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    url = AffiliateUrl(**data.model_dump())
    db.add(url)
    db.commit()
    db.refresh(url)
    return {
        "id": url.id,
        "url": url.url,
        "domain": url.domain,
        "offer": url.offer,
        "is_active": url.is_active,
        "created_at": url.created_at.isoformat() if url.created_at else None,
    }


@router.delete("/affiliate-urls/{url_id}")
def delete_affiliate_url(
    url_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    url = db.query(AffiliateUrl).filter(AffiliateUrl.id == url_id).first()
    if not url:
        raise HTTPException(status_code=404, detail="Affiliate URL not found")
    db.delete(url)
    db.commit()
    return {"message": "Affiliate URL deleted"}


# ─── Content Generation ──────────────────────────────────────────────────────

@router.post("/{persona_id}/generate")
def generate_content(
    persona_id: str,
    data: GenerateContentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    from app.services.persona_content_service import PersonaContentService

    try:
        service = PersonaContentService(model=data.model)
    except ValueError as e:
        logger.exception("Persona content service init failed")
        raise HTTPException(status_code=500, detail="Invalid model configuration")

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
        "brand_name": brand_name,
        "before_weight": persona.before_weight,
        "after_weight": persona.after_weight,
        "total_lost": persona.total_lost,
        "timeline_months": persona.timeline_months,
    }

    results = {"posts": 0, "comments": 0, "image_prompts": 0}

    try:
        if data.content_type in ("posts", "all"):
            posts = service.generate_posts(persona_dict)
            for post_data in posts:
                post = PersonaPost(
                    persona_id=persona.id,
                    post_type=post_data.get("post_type", "origin_story"),
                    headline=post_data.get("headline", ""),
                    body_text=post_data.get("body_text", ""),
                    photo_type=post_data.get("photo_type"),
                )
                db.add(post)
            results["posts"] = len(posts)

        if data.content_type in ("comments", "all"):
            comments = service.generate_comments(persona_dict)
            for comment_data in comments:
                comment = PersonaComment(
                    persona_id=persona.id,
                    comment_type=comment_data.get("comment_type", "support_short"),
                    body_text=comment_data.get("body_text", ""),
                    affiliate_url=comment_data.get("affiliate_url"),
                    photo_path=comment_data.get("photo_path"),
                )
                db.add(comment)
            results["comments"] = len(comments)

        if data.content_type in ("image_prompts", "all"):
            prompts = service.generate_image_prompts(persona_dict)
            for prompt_data in prompts:
                prompt = PersonaImagePrompt(
                    persona_id=persona.id,
                    prompt_type=prompt_data.get("prompt_type", "profile"),
                    prompt_text=prompt_data.get("prompt_text", ""),
                )
                db.add(prompt)
            results["image_prompts"] = len(prompts)

        db.commit()

    except Exception as e:
        db.rollback()
        logger.exception(f"Content generation failed for persona {persona.name}")
        raise HTTPException(status_code=500, detail="Content generation failed")

    return {
        "persona": persona.name,
        "generated": results,
        "message": f"Generated content for {persona.name}",
    }


@router.post("/generate-all")
def generate_all_content(
    data: GenerateAllRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    q = db.query(Persona).filter(Persona.is_active == True)
    if data.offer:
        q = q.filter(Persona.offer == data.offer)
    personas = q.all()

    if not personas:
        raise HTTPException(status_code=404, detail="No active personas found")

    from app.services.persona_content_service import PersonaContentService

    try:
        service = PersonaContentService(model=data.model)
    except ValueError as e:
        logger.exception("Persona content service init failed")
        raise HTTPException(status_code=500, detail="Invalid model configuration")

    results = []
    for persona in personas:
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
            "brand_name": brand_name,
            "before_weight": persona.before_weight,
            "after_weight": persona.after_weight,
            "total_lost": persona.total_lost,
            "timeline_months": persona.timeline_months,
        }

        try:
            generated = service.generate_all(persona_dict)

            for post_data in generated.get("posts", []):
                db.add(PersonaPost(
                    persona_id=persona.id,
                    post_type=post_data.get("post_type", "origin_story"),
                    body_text=post_data.get("body_text", ""),
                    photo_type=post_data.get("photo_type"),
                ))

            for comment_data in generated.get("comments", []):
                db.add(PersonaComment(
                    persona_id=persona.id,
                    comment_type=comment_data.get("comment_type", "support_short"),
                    body_text=comment_data.get("body_text", ""),
                    affiliate_url=comment_data.get("affiliate_url"),
                    photo_path=comment_data.get("photo_path"),
                ))

            for prompt_data in generated.get("image_prompts", []):
                db.add(PersonaImagePrompt(
                    persona_id=persona.id,
                    prompt_type=prompt_data.get("prompt_type", "profile"),
                    prompt_text=prompt_data.get("prompt_text", ""),
                ))

            db.commit()
            results.append({
                "persona": persona.name,
                "status": "success",
                "posts": len(generated.get("posts", [])),
                "comments": len(generated.get("comments", [])),
                "image_prompts": len(generated.get("image_prompts", [])),
            })

        except Exception as e:
            db.rollback()
            logger.exception(f"Generation failed for {persona.name}")
            results.append({
                "persona": persona.name,
                "status": "failed",
                "error": "Content generation failed",
            })

    succeeded = sum(1 for r in results if r["status"] == "success")
    return {
        "total_personas": len(personas),
        "succeeded": succeeded,
        "failed": len(personas) - succeeded,
        "results": results,
    }
