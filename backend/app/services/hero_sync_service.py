"""Auto-sync personas to hero maps.

When a persona is created, add their before_after images to the brand's hero map.
When a persona is deleted, remove their entries from the hero map.
Key format: first name lowercase (e.g. "jennifer"). Duplicates get a suffix: "jennifer2".
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models import HeroMap, HeroMapEntry, Persona, PersonaImage

logger = logging.getLogger(__name__)


def _get_or_create_brand_hero_map(brand_id: str, db: Session) -> HeroMap:
    """Get existing hero map for brand, or create one."""
    hero_map = db.query(HeroMap).filter(HeroMap.brand_id == brand_id).first()
    if hero_map:
        return hero_map

    from app.models import Brand
    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    brand_name = brand.name if brand else "Unknown"

    hero_map = HeroMap(
        brand_id=brand_id,
        name=f"{brand_name} Hero Map",
    )
    db.add(hero_map)
    db.flush()  # get the ID without committing
    logger.info(f"Created hero map '{hero_map.name}' for brand {brand_id}")
    return hero_map


def _make_unique_key(first_name: str, hero_map_id: str, db: Session) -> str:
    """Generate a unique key from first name. Handles duplicates like jennifer, jennifer2."""
    base_key = first_name.lower().strip()
    if not base_key:
        base_key = "persona"

    # Check if base key already exists
    existing = db.query(HeroMapEntry).filter(
        HeroMapEntry.hero_map_id == hero_map_id,
        HeroMapEntry.key == base_key,
    ).first()
    if not existing:
        return base_key

    # Find next available suffix
    suffix = 2
    while True:
        candidate = f"{base_key}{suffix}"
        existing = db.query(HeroMapEntry).filter(
            HeroMapEntry.hero_map_id == hero_map_id,
            HeroMapEntry.key == candidate,
        ).first()
        if not existing:
            return candidate
        suffix += 1


def sync_persona_to_hero_map(persona: Persona, db: Session) -> int:
    """Add a persona's before_after images to the brand's hero map.

    Returns count of entries added.
    """
    if not persona.brand_id:
        logger.debug(f"Persona '{persona.name}' has no brand_id, skipping hero sync")
        return 0

    # Get before_after images for this persona
    images = db.query(PersonaImage).filter(
        PersonaImage.persona_id == persona.id,
        PersonaImage.category == "before_after",
    ).order_by(PersonaImage.sort_order).all()

    if not images:
        logger.debug(f"Persona '{persona.name}' has no before_after images, skipping hero sync")
        return 0

    hero_map = _get_or_create_brand_hero_map(persona.brand_id, db)

    # Check if persona already has entries in this map
    existing_count = db.query(HeroMapEntry).filter(
        HeroMapEntry.hero_map_id == hero_map.id,
        HeroMapEntry.persona_id == persona.id,
    ).count()
    if existing_count > 0:
        logger.debug(f"Persona '{persona.name}' already has {existing_count} entries in hero map")
        return 0

    first_name = persona.name.split()[0] if persona.name else "persona"
    added = 0

    for img in images:
        key = _make_unique_key(first_name, hero_map.id, db)
        entry = HeroMapEntry(
            hero_map_id=hero_map.id,
            persona_id=persona.id,
            key=key,
            image_url=img.url,
            label=first_name.capitalize(),
        )
        db.add(entry)
        db.flush()  # so next _make_unique_key sees this entry
        added += 1

    logger.info(f"Added {added} hero map entries for persona '{persona.name}' (key base: {first_name})")
    return added


def remove_persona_from_hero_map(persona_id: str, db: Session) -> int:
    """Remove all hero map entries linked to a persona.

    Returns count of entries removed.
    """
    entries = db.query(HeroMapEntry).filter(
        HeroMapEntry.persona_id == persona_id,
    ).all()

    count = len(entries)
    for entry in entries:
        db.delete(entry)

    if count:
        logger.info(f"Removed {count} hero map entries for persona {persona_id}")
    return count


def bulk_remove_personas_from_hero_map(persona_ids: list[str], db: Session) -> int:
    """Remove hero map entries for multiple personas at once."""
    count = db.query(HeroMapEntry).filter(
        HeroMapEntry.persona_id.in_(persona_ids),
    ).delete(synchronize_session="fetch")

    if count:
        logger.info(f"Bulk removed {count} hero map entries for {len(persona_ids)} personas")
    return count
