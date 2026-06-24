#!/usr/bin/env python3
"""
Cron job for budget surfing — dynamically scale budgets based on performance.

Runs every hour, checks current EST hour, and takes action:
  - Midnight (0): Reset all budgets to base, reactivate surf-paused objects
  - Noon (12): Check today's conversions — pause losers, double winners
  - 4 PM (16): Double winners' budgets again (4x base total)

Railway cron: 0 * * * * (every hour)
Command: python run_budget_surfing.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from collections import defaultdict
from app.database import SessionLocal
from app.models import BudgetSurfConfig, BudgetSurfLog, FacebookConnection
from app.services.facebook_service import FacebookService

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

EST = ZoneInfo("America/New_York")


def log_action(db, config, action, phase, old_budget=None, new_budget=None, conversions=None, error=None):
    entry = BudgetSurfLog(
        surf_config_id=config.id,
        fb_object_id=config.fb_object_id,
        action=action,
        old_budget_cents=old_budget,
        new_budget_cents=new_budget,
        conversions=conversions,
        phase=phase,
        error_message=str(error)[:500] if error else None,
    )
    db.add(entry)
    db.commit()


def get_today_conversions(service, ad_account_id, configs):
    """Fetch today's insights and return {fb_object_id: conversion_count}."""
    today = datetime.now(EST).strftime('%Y-%m-%d')
    time_range = {'since': today, 'until': today}

    # Determine which level to query based on enrolled configs
    has_campaigns = any(c.object_type == 'campaign' for c in configs)
    has_adsets = any(c.object_type == 'adset' for c in configs)

    conversions = {}

    if has_campaigns:
        insights = service.get_account_insights(ad_account_id, time_range, level='campaign')
        for row in insights:
            conversions[row.get('campaign_id')] = row.get('results', 0)

    if has_adsets:
        insights = service.get_account_insights(ad_account_id, time_range, level='adset')
        for row in insights:
            conversions[row.get('adset_id')] = row.get('results', 0)

    return conversions


def phase_midnight(db, service, configs):
    """Reset all budgets to base and reactivate surf-paused objects."""
    reset = 0
    reactivated = 0

    for config in configs:
        try:
            # Reactivate if surf paused it
            if config.paused_by_surf:
                service.update_object_status(config.fb_object_id, config.object_type, 'ACTIVE')
                config.paused_by_surf = False
                log_action(db, config, 'reactivated', 'midnight')
                reactivated += 1

            # Reset budget to base
            service.update_budget(config.fb_object_id, config.object_type, config.base_budget_cents)
            config.current_phase = 'base'
            db.commit()
            log_action(db, config, 'reset', 'midnight',
                       new_budget=config.base_budget_cents)
            reset += 1

        except Exception as e:
            log_action(db, config, 'reset', 'midnight', error=e)
            logger.error(f"Failed to reset {config.fb_object_id}: {e}", exc_info=True)

    logger.info(f"Midnight: {reset} reset, {reactivated} reactivated")


def phase_noon(db, service, configs, conversions):
    """Pause losers, double winners."""
    doubled = 0
    paused = 0

    for config in configs:
        if config.paused_by_surf:
            continue  # already paused

        conv = conversions.get(config.fb_object_id, 0)

        try:
            if conv >= config.min_conversions:
                # Winner — double budget
                new_budget = int(config.base_budget_cents * config.noon_multiplier)
                service.update_budget(config.fb_object_id, config.object_type, new_budget)
                config.current_phase = 'noon'
                db.commit()
                log_action(db, config, 'doubled', 'noon',
                           old_budget=config.base_budget_cents,
                           new_budget=new_budget, conversions=conv)
                doubled += 1
                logger.info(f"Doubled {config.fb_object_id} ({conv} conversions) -> ${new_budget/100:.2f}")
            else:
                # Loser — pause
                service.update_object_status(config.fb_object_id, config.object_type, 'PAUSED')
                config.paused_by_surf = True
                config.current_phase = 'noon'
                db.commit()
                log_action(db, config, 'paused', 'noon', conversions=conv)
                paused += 1
                logger.info(f"Paused {config.fb_object_id} ({conv} conversions, threshold: {config.min_conversions})")

        except Exception as e:
            log_action(db, config, 'error', 'noon', conversions=conv, error=e)
            logger.error(f"Failed noon action on {config.fb_object_id}: {e}", exc_info=True)

    logger.info(f"Noon: {doubled} doubled, {paused} paused")


def phase_afternoon(db, service, configs, conversions):
    """Double winners' budgets again (4x base total)."""
    quadrupled = 0

    for config in configs:
        if config.paused_by_surf:
            continue  # skip paused losers

        conv = conversions.get(config.fb_object_id, 0)

        try:
            if conv >= config.min_conversions:
                # Still winning — quadruple from base
                new_budget = int(config.base_budget_cents * config.afternoon_multiplier)
                old_budget = int(config.base_budget_cents * config.noon_multiplier)
                service.update_budget(config.fb_object_id, config.object_type, new_budget)
                config.current_phase = 'afternoon'
                db.commit()
                log_action(db, config, 'quadrupled', 'afternoon',
                           old_budget=old_budget,
                           new_budget=new_budget, conversions=conv)
                quadrupled += 1
                logger.info(f"Quadrupled {config.fb_object_id} ({conv} conversions) -> ${new_budget/100:.2f}")

        except Exception as e:
            log_action(db, config, 'error', 'afternoon', conversions=conv, error=e)
            logger.error(f"Failed afternoon action on {config.fb_object_id}: {e}", exc_info=True)

    logger.info(f"Afternoon: {quadrupled} quadrupled")


def main():
    now_est = datetime.now(EST)
    hour = now_est.hour
    logger.info(f"Budget surfing check — {now_est.strftime('%Y-%m-%d %H:%M')} EST (hour={hour})")

    if hour not in (0, 12, 16):
        logger.info("Not a surfing hour (0, 12, 16), skipping")
        return

    phase = {0: 'midnight', 12: 'noon', 16: 'afternoon'}[hour]

    db = SessionLocal()
    try:
        configs = db.query(BudgetSurfConfig).filter(
            BudgetSurfConfig.enabled == True,
        ).all()

        if not configs:
            logger.info("No enabled surf configs")
            return

        logger.info(f"Processing {len(configs)} surf config(s) for {phase} phase")

        # Group by connection + account for efficient API usage
        groups = defaultdict(list)
        for c in configs:
            groups[(c.connection_id, c.ad_account_id)].append(c)

        for (connection_id, ad_account_id), group in groups.items():
            conn = db.query(FacebookConnection).filter(
                FacebookConnection.id == connection_id,
                FacebookConnection.is_active == True,
            ).first()
            if not conn:
                logger.error(f"Connection {connection_id} not found or inactive")
                continue

            service = FacebookService(connection=conn)
            if not service.api:
                service.initialize()

            if phase == 'midnight':
                phase_midnight(db, service, group)
            else:
                conversions = get_today_conversions(service, ad_account_id, group)
                if phase == 'noon':
                    phase_noon(db, service, group, conversions)
                elif phase == 'afternoon':
                    phase_afternoon(db, service, group, conversions)

    except Exception as e:
        logger.error(f"Error in budget surfing: {e}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
