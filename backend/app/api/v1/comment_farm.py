"""Comment Farm — seed posts with realistic comment conversations from persona pages."""
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models import (
    CommentFarmJob, CommentFarmEntry, CommentFarmReaction,
    Persona, PersonaPost, FacebookConnection, User,
)
from app.core.deps import get_current_active_user
from app.services.facebook_service import FacebookService
from app.services.persona_content_service import PersonaContentService

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class CreateJobRequest(BaseModel):
    target_post_id: str  # FB post ID (pageId_postId)
    target_type: str = "persona_post"  # persona_post, ad, manual
    persona_post_id: Optional[str] = None
    owner_persona_id: Optional[str] = None
    connection_id: str
    commenter_persona_ids: List[str]
    affiliate_url: Optional[str] = None
    original_post_text: Optional[str] = None
    name: Optional[str] = None


class GenerateRequest(BaseModel):
    model: str = "sonnet"  # sonnet, haiku


class UpdateEntryRequest(BaseModel):
    message: Optional[str] = None
    delay_minutes: Optional[int] = None
    image_url: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_job(job: CommentFarmJob) -> dict:
    return {
        "id": job.id,
        "name": job.name,
        "target_post_id": job.target_post_id,
        "target_type": job.target_type,
        "persona_post_id": job.persona_post_id,
        "owner_persona_id": job.owner_persona_id,
        "owner_persona_name": job.owner_persona.name if job.owner_persona else None,
        "connection_id": job.connection_id,
        "affiliate_url": job.affiliate_url,
        "original_post_text": job.original_post_text,
        "status": job.status,
        "total_entries": job.total_entries,
        "posted_entries": job.posted_entries,
        "failed_entries": job.failed_entries,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


def _serialize_entry(entry: CommentFarmEntry) -> dict:
    return {
        "id": entry.id,
        "job_id": entry.job_id,
        "persona_id": entry.persona_id,
        "persona_name": entry.persona.name if entry.persona else None,
        "persona_fb_page_id": entry.persona.fb_page_id if entry.persona else None,
        "entry_type": entry.entry_type,
        "message": entry.message,
        "image_url": entry.image_url,
        "parent_entry_id": entry.parent_entry_id,
        "delay_minutes": entry.delay_minutes,
        "sort_order": entry.sort_order,
        "fb_comment_id": entry.fb_comment_id,
        "status": entry.status,
        "posted_at": entry.posted_at.isoformat() if entry.posted_at else None,
        "error_message": entry.error_message,
    }


def _serialize_reaction(r: CommentFarmReaction) -> dict:
    return {
        "id": r.id,
        "job_id": r.job_id,
        "entry_id": r.entry_id,
        "persona_id": r.persona_id,
        "persona_name": r.persona.name if r.persona else None,
        "reaction_type": r.reaction_type,
        "delay_minutes": r.delay_minutes,
        "status": r.status,
        "error_message": r.error_message,
    }


def _persona_to_dict(p: Persona) -> dict:
    """Convert Persona ORM object to dict for the content service."""
    return {
        "name": p.name,
        "gender": p.gender,
        "age": p.age,
        "location_city": p.location_city,
        "location_state": p.location_state,
        "occupation": p.occupation,
        "family_details": p.family_details,
        "weight_loss_backstory": p.weight_loss_backstory,
        "personality_voice": p.personality_voice,
        "story_angle": p.story_angle,
        "before_weight": p.before_weight,
        "after_weight": p.after_weight,
        "total_lost": p.total_lost,
        "timeline_months": p.timeline_months,
        "before_after_photo_sets": p.before_after_photo_sets,
        "images": [{"category": img.category, "url": img.url} for img in p.images] if p.images else [],
        "fb_page_id": p.fb_page_id,
        "fb_page_access_token": p.fb_page_access_token,
    }


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/jobs")
def create_job(
    data: CreateJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new comment farm job."""
    # Validate connection
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == data.connection_id,
        FacebookConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Facebook connection not found")

    # Validate owner persona if provided
    if data.owner_persona_id:
        owner = db.query(Persona).filter(Persona.id == data.owner_persona_id).first()
        if not owner:
            raise HTTPException(status_code=404, detail="Owner persona not found")

    # Validate commenter personas
    commenters = db.query(Persona).filter(Persona.id.in_(data.commenter_persona_ids)).all()
    if len(commenters) != len(data.commenter_persona_ids):
        raise HTTPException(status_code=400, detail="One or more commenter personas not found")

    # Check that commenters have FB pages assigned
    missing_pages = [p.name for p in commenters if not p.fb_page_id]
    if missing_pages:
        raise HTTPException(
            status_code=400,
            detail=f"These personas have no FB page assigned: {', '.join(missing_pages)}"
        )

    job = CommentFarmJob(
        name=data.name,
        target_post_id=data.target_post_id,
        target_type=data.target_type,
        persona_post_id=data.persona_post_id,
        owner_persona_id=data.owner_persona_id,
        connection_id=data.connection_id,
        affiliate_url=data.affiliate_url,
        original_post_text=data.original_post_text,
        status="draft",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _serialize_job(job)


@router.get("/jobs")
def list_jobs(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all comment farm jobs."""
    q = db.query(CommentFarmJob)
    if status:
        q = q.filter(CommentFarmJob.status == status)
    jobs = q.order_by(CommentFarmJob.created_at.desc()).all()
    return [_serialize_job(j) for j in jobs]


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get job detail with all entries and reactions."""
    job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    entries = (
        db.query(CommentFarmEntry)
        .filter(CommentFarmEntry.job_id == job_id)
        .order_by(CommentFarmEntry.sort_order)
        .all()
    )
    reactions = (
        db.query(CommentFarmReaction)
        .filter(CommentFarmReaction.job_id == job_id)
        .order_by(CommentFarmReaction.delay_minutes)
        .all()
    )

    result = _serialize_job(job)
    result["entries"] = [_serialize_entry(e) for e in entries]
    result["reactions"] = [_serialize_reaction(r) for r in reactions]
    return result


@router.delete("/jobs/{job_id}")
def delete_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a comment farm job and all its entries."""
    job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"message": "Job deleted"}


@router.post("/jobs/{job_id}/generate")
def generate_conversation(
    job_id: str,
    data: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """AI-generate the full comment conversation for a job."""
    job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not job.original_post_text:
        raise HTTPException(status_code=400, detail="Job has no original_post_text — set it first")

    # Get owner persona
    owner = db.query(Persona).filter(Persona.id == job.owner_persona_id).first()
    if not owner:
        raise HTTPException(status_code=400, detail="Owner persona not found")

    # Get commenter personas from existing entries, or from the job's initial setup
    # If entries already exist, get persona IDs from them; otherwise need them passed
    existing_entries = db.query(CommentFarmEntry).filter(CommentFarmEntry.job_id == job_id).all()

    if existing_entries:
        # Clear old entries and reactions before regenerating
        db.query(CommentFarmReaction).filter(CommentFarmReaction.job_id == job_id).delete()
        db.query(CommentFarmEntry).filter(CommentFarmEntry.job_id == job_id).delete()
        # Get unique persona IDs from old entries (excluding owner)
        commenter_ids = list(set(
            e.persona_id for e in existing_entries
            if e.persona_id and e.persona_id != job.owner_persona_id
        ))
    else:
        # No entries yet — this shouldn't normally happen since we need to know who the commenters are
        raise HTTPException(
            status_code=400,
            detail="No commenter personas assigned. Use /jobs/{id}/add-commenters first or create job with commenter_persona_ids."
        )

    commenters = db.query(Persona).filter(Persona.id.in_(commenter_ids)).all()

    # Generate conversation via AI
    service = PersonaContentService(model=data.model)
    owner_dict = _persona_to_dict(owner)
    commenter_dicts = [_persona_to_dict(p) for p in commenters]

    result = service.generate_comment_farm_conversation(
        post_text=job.original_post_text,
        owner_persona=owner_dict,
        commenter_personas=commenter_dicts,
        affiliate_url=job.affiliate_url,
    )

    # Map persona names to IDs
    name_to_persona = {owner.name: owner}
    for p in commenters:
        name_to_persona[p.name] = p

    # Create entries
    entries_data = result.get("entries", [])
    created_entries = []
    for i, entry_data in enumerate(entries_data):
        persona_name = entry_data.get("persona_name", "")
        persona = name_to_persona.get(persona_name)
        if not persona:
            # Try fuzzy match
            for name, p in name_to_persona.items():
                if name.lower() in persona_name.lower() or persona_name.lower() in name.lower():
                    persona = p
                    break

        # Get photo URL if this is a testimonial with photo
        image_url = None
        if entry_data.get("has_photo") and persona:
            # Find a comment_photo or before_after image for this persona
            for img in (persona.images or []):
                if img.category in ("comment_photo", "before_after", "after"):
                    image_url = img.url
                    break

        entry = CommentFarmEntry(
            job_id=job_id,
            persona_id=persona.id if persona else None,
            entry_type=entry_data.get("entry_type", "short_reaction"),
            message=entry_data.get("message", ""),
            image_url=image_url,
            parent_entry_id=None,  # resolved below
            delay_minutes=entry_data.get("delay_minutes", i * 3),
            sort_order=entry_data.get("sort_order", i + 1),
            status="pending",
        )
        db.add(entry)
        db.flush()
        created_entries.append(entry)

    # Resolve parent_entry references (replies)
    for i, entry_data in enumerate(entries_data):
        parent_idx = entry_data.get("parent_index")
        if parent_idx is not None and 0 <= parent_idx < len(created_entries):
            created_entries[i].parent_entry_id = created_entries[parent_idx].id

    # Create reactions
    for react_data in result.get("reactions", []):
        reactor_name = react_data.get("reactor_persona_name", "")
        reactor = name_to_persona.get(reactor_name)
        if not reactor:
            for name, p in name_to_persona.items():
                if name.lower() in reactor_name.lower() or reactor_name.lower() in name.lower():
                    reactor = p
                    break

        target_idx = react_data.get("target_entry_index", 0)
        if 0 <= target_idx < len(created_entries):
            reaction = CommentFarmReaction(
                job_id=job_id,
                entry_id=created_entries[target_idx].id,
                persona_id=reactor.id if reactor else None,
                reaction_type=react_data.get("reaction_type", "LIKE"),
                delay_minutes=react_data.get("delay_minutes", 10),
                status="pending",
            )
            db.add(reaction)

    # Update job counts
    job.total_entries = len(created_entries)
    job.posted_entries = 0
    job.failed_entries = 0
    job.status = "draft"

    db.commit()
    db.refresh(job)

    return get_job(job_id, db, current_user)


class AddCommentersRequest(BaseModel):
    persona_ids: List[str]


@router.post("/jobs/{job_id}/add-commenters")
def add_commenters(
    job_id: str,
    data: AddCommentersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Add commenter personas to a job (creates placeholder entries)."""
    job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    personas = db.query(Persona).filter(Persona.id.in_(data.persona_ids)).all()
    missing_pages = [p.name for p in personas if not p.fb_page_id]
    if missing_pages:
        raise HTTPException(
            status_code=400,
            detail=f"These personas have no FB page assigned: {', '.join(missing_pages)}"
        )

    # Add placeholder entries for each commenter
    for i, persona in enumerate(personas):
        entry = CommentFarmEntry(
            job_id=job_id,
            persona_id=persona.id,
            entry_type="pending_generation",
            message="(awaiting AI generation)",
            delay_minutes=(i + 1) * 5,
            sort_order=i + 1,
            status="pending",
        )
        db.add(entry)

    db.commit()
    return {"message": f"Added {len(personas)} commenters", "count": len(personas)}


@router.put("/entries/{entry_id}")
def update_entry(
    entry_id: str,
    data: UpdateEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Edit a comment farm entry before posting."""
    entry = db.query(CommentFarmEntry).filter(CommentFarmEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, key, value)

    db.commit()
    db.refresh(entry)
    return _serialize_entry(entry)


@router.delete("/entries/{entry_id}")
def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a single entry from a job."""
    entry = db.query(CommentFarmEntry).filter(CommentFarmEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"message": "Entry deleted"}


# ─── Execution ─────────────────────────────────────────────────────────────────

def _execute_job_background(job_id: str):
    """Background thread: post comments with staggered delays."""
    db = SessionLocal()
    try:
        job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
        if not job:
            logger.error(f"Comment farm job {job_id} not found")
            return

        conn = db.query(FacebookConnection).filter(
            FacebookConnection.id == job.connection_id
        ).first()
        if not conn:
            job.status = "failed"
            db.commit()
            logger.error(f"Connection not found for job {job_id}")
            return

        fb_service = FacebookService(connection=conn)
        fb_service.initialize()

        # Get all pending entries sorted by delay
        entries = (
            db.query(CommentFarmEntry)
            .filter(
                CommentFarmEntry.job_id == job_id,
                CommentFarmEntry.status == "pending",
            )
            .order_by(CommentFarmEntry.sort_order)
            .all()
        )

        # Get all pending reactions sorted by delay
        reactions = (
            db.query(CommentFarmReaction)
            .filter(
                CommentFarmReaction.job_id == job_id,
                CommentFarmReaction.status == "pending",
            )
            .order_by(CommentFarmReaction.delay_minutes)
            .all()
        )

        # Build a unified timeline of actions
        actions = []
        for entry in entries:
            actions.append(("comment", entry.delay_minutes, entry))
        for reaction in reactions:
            actions.append(("reaction", reaction.delay_minutes, reaction))
        actions.sort(key=lambda x: x[1])

        job.status = "in_progress"
        db.commit()

        start_time = time.time()
        posted = 0
        failed = 0

        for action_type, delay_min, item in actions:
            # Wait until it's time
            target_time = start_time + (delay_min * 60)
            wait_seconds = target_time - time.time()
            if wait_seconds > 0:
                logger.info(f"Comment farm {job_id}: waiting {wait_seconds:.0f}s for next action")
                time.sleep(wait_seconds)

            try:
                if action_type == "comment":
                    entry = item
                    persona = db.query(Persona).filter(Persona.id == entry.persona_id).first()
                    if not persona or not persona.fb_page_id:
                        entry.status = "failed"
                        entry.error_message = "Persona has no FB page"
                        failed += 1
                        db.commit()
                        continue

                    # Get page token
                    page_token = fb_service.get_page_token_for_persona(
                        persona.fb_page_id, persona.fb_page_access_token
                    )

                    if entry.parent_entry_id:
                        # This is a reply to another comment
                        parent = db.query(CommentFarmEntry).filter(
                            CommentFarmEntry.id == entry.parent_entry_id
                        ).first()
                        if parent and parent.fb_comment_id:
                            result = fb_service.reply_to_comment(
                                comment_id=parent.fb_comment_id,
                                message=entry.message,
                                page_access_token=page_token,
                                attachment_url=entry.image_url,
                            )
                        else:
                            # Parent wasn't posted, post as top-level instead
                            result = fb_service.comment_as_page(
                                post_id=job.target_post_id,
                                message=entry.message,
                                page_access_token=page_token,
                                attachment_url=entry.image_url,
                            )
                    else:
                        # Top-level comment
                        result = fb_service.comment_as_page(
                            post_id=job.target_post_id,
                            message=entry.message,
                            page_access_token=page_token,
                            attachment_url=entry.image_url,
                        )

                    entry.fb_comment_id = result.get("id")
                    entry.status = "posted"
                    entry.posted_at = datetime.now(timezone.utc)
                    posted += 1
                    logger.info(f"Comment farm {job_id}: posted entry {entry.id} as {persona.name}")

                elif action_type == "reaction":
                    reaction = item
                    # Get the target entry's fb_comment_id
                    target_entry = db.query(CommentFarmEntry).filter(
                        CommentFarmEntry.id == reaction.entry_id
                    ).first()
                    if not target_entry or not target_entry.fb_comment_id:
                        reaction.status = "failed"
                        reaction.error_message = "Target comment not posted yet"
                        db.commit()
                        continue

                    persona = db.query(Persona).filter(Persona.id == reaction.persona_id).first()
                    if not persona or not persona.fb_page_id:
                        reaction.status = "failed"
                        reaction.error_message = "Persona has no FB page"
                        db.commit()
                        continue

                    page_token = fb_service.get_page_token_for_persona(
                        persona.fb_page_id, persona.fb_page_access_token
                    )

                    fb_service.react_to_comment(
                        comment_id=target_entry.fb_comment_id,
                        reaction_type=reaction.reaction_type,
                        page_access_token=page_token,
                    )
                    reaction.status = "done"
                    logger.info(f"Comment farm {job_id}: {persona.name} reacted {reaction.reaction_type}")

                db.commit()

            except Exception as e:
                logger.error(f"Comment farm {job_id}: action failed: {e}")
                if action_type == "comment":
                    item.status = "failed"
                    item.error_message = str(e)[:500]
                    failed += 1
                elif action_type == "reaction":
                    item.status = "failed"
                    item.error_message = str(e)[:500]
                db.commit()

        # Final status
        job.posted_entries = posted
        job.failed_entries = failed
        job.status = "completed" if failed == 0 else ("failed" if posted == 0 else "completed")
        db.commit()
        logger.info(f"Comment farm {job_id}: done. Posted={posted}, Failed={failed}")

    except Exception as e:
        logger.error(f"Comment farm {job_id}: critical error: {e}")
        try:
            job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
            if job:
                job.status = "failed"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/jobs/{job_id}/execute")
def execute_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Launch comment farm execution (staggered posting in background thread)."""
    job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "in_progress":
        raise HTTPException(status_code=400, detail="Job is already running")

    # Count pending entries
    pending = (
        db.query(CommentFarmEntry)
        .filter(
            CommentFarmEntry.job_id == job_id,
            CommentFarmEntry.status == "pending",
        )
        .count()
    )
    if pending == 0:
        raise HTTPException(status_code=400, detail="No pending entries to post")

    # Launch background thread
    thread = threading.Thread(
        target=_execute_job_background,
        args=(job_id,),
        daemon=True,
    )
    thread.start()

    job.status = "in_progress"
    db.commit()

    return {"message": f"Execution started. {pending} entries will be posted with staggered delays.", "pending": pending}


@router.get("/jobs/{job_id}/status")
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Quick status check for a running job."""
    job = db.query(CommentFarmJob).filter(CommentFarmJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    entries = db.query(CommentFarmEntry).filter(CommentFarmEntry.job_id == job_id).all()
    reactions = db.query(CommentFarmReaction).filter(CommentFarmReaction.job_id == job_id).all()

    return {
        "id": job.id,
        "status": job.status,
        "total_entries": len(entries),
        "posted": sum(1 for e in entries if e.status == "posted"),
        "pending": sum(1 for e in entries if e.status == "pending"),
        "failed": sum(1 for e in entries if e.status == "failed"),
        "reactions_done": sum(1 for r in reactions if r.status == "done"),
        "reactions_pending": sum(1 for r in reactions if r.status == "pending"),
    }
