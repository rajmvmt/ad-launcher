"""
Assignment sync — keeps ad_account, domain, and brand assignments consistent
across TrackedPage, Domain, and Persona records.
"""
import logging
from sqlalchemy.orm import Session
from app.models import TrackedPage, Domain, Persona

logger = logging.getLogger(__name__)


def sync_from_page(page: TrackedPage, db: Session):
    """After updating a TrackedPage, propagate assignments to Domain and Persona."""
    # Sync to linked Domain
    if page.domain_id:
        domain = db.query(Domain).filter(Domain.id == page.domain_id).first()
        if domain:
            changed = False
            if page.ad_account_id and domain.ad_account_id != page.ad_account_id:
                domain.ad_account_id = page.ad_account_id
                changed = True
            if page.brand_id and domain.brand_id != page.brand_id:
                domain.brand_id = page.brand_id
                changed = True
            if changed:
                logger.info("Synced page '%s' assignments to domain '%s'", page.name, domain.name)

    # Sync to linked Persona (by fb_page_id)
    if page.fb_page_id:
        persona = db.query(Persona).filter(Persona.fb_page_id == page.fb_page_id).first()
        if persona:
            changed = False
            if page.ad_account_id and persona.fb_ad_account_id != page.ad_account_id:
                persona.fb_ad_account_id = page.ad_account_id
                changed = True
            if page.domain_id and persona.domain_id != page.domain_id:
                persona.domain_id = page.domain_id
                changed = True
            if page.brand_id and persona.brand_id != page.brand_id:
                persona.brand_id = page.brand_id
                changed = True
            if changed:
                logger.info("Synced page '%s' assignments to persona '%s'", page.name, persona.name)


def sync_from_domain(domain: Domain, db: Session):
    """After updating a Domain, propagate assignments to TrackedPage and Persona."""
    # Sync to linked TrackedPage
    page = db.query(TrackedPage).filter(TrackedPage.domain_id == domain.id).first()
    if page:
        changed = False
        if domain.ad_account_id and page.ad_account_id != domain.ad_account_id:
            page.ad_account_id = domain.ad_account_id
            changed = True
        if domain.brand_id and page.brand_id != domain.brand_id:
            page.brand_id = domain.brand_id
            changed = True
        if changed:
            logger.info("Synced domain '%s' assignments to page '%s'", domain.name, page.name)

    # Sync to linked Persona
    persona = db.query(Persona).filter(Persona.domain_id == domain.id).first()
    if persona:
        changed = False
        if domain.ad_account_id and persona.fb_ad_account_id != domain.ad_account_id:
            persona.fb_ad_account_id = domain.ad_account_id
            changed = True
        if domain.brand_id and persona.brand_id != domain.brand_id:
            persona.brand_id = domain.brand_id
            changed = True
        if changed:
            logger.info("Synced domain '%s' assignments to persona '%s'", domain.name, persona.name)


def sync_from_persona(persona: Persona, db: Session):
    """After updating a Persona, propagate assignments to TrackedPage and Domain."""
    # Sync to linked TrackedPage
    if persona.fb_page_id:
        page = db.query(TrackedPage).filter(TrackedPage.fb_page_id == persona.fb_page_id).first()
        if page:
            changed = False
            if persona.fb_ad_account_id and page.ad_account_id != persona.fb_ad_account_id:
                page.ad_account_id = persona.fb_ad_account_id
                changed = True
            if persona.domain_id and page.domain_id != persona.domain_id:
                page.domain_id = persona.domain_id
                changed = True
            if persona.brand_id and page.brand_id != persona.brand_id:
                page.brand_id = persona.brand_id
                changed = True
            if changed:
                logger.info("Synced persona '%s' assignments to page '%s'", persona.name, page.name)

    # Sync to linked Domain
    if persona.domain_id:
        domain = db.query(Domain).filter(Domain.id == persona.domain_id).first()
        if domain:
            changed = False
            if persona.fb_ad_account_id and domain.ad_account_id != persona.fb_ad_account_id:
                domain.ad_account_id = persona.fb_ad_account_id
                changed = True
            if persona.brand_id and domain.brand_id != persona.brand_id:
                domain.brand_id = persona.brand_id
                changed = True
            if changed:
                logger.info("Synced persona '%s' assignments to domain '%s'", persona.name, domain.name)
