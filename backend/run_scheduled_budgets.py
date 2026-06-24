#!/usr/bin/env python3
"""
Cron job script to apply scheduled budget changes at midnight EST.

Railway cron: 0 5 * * * (5 UTC = midnight EST)
Command: python run_scheduled_budgets.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logging
from datetime import datetime
from app.database import SessionLocal
from app.models import ScheduledBudgetChange, FacebookConnection
from app.services.facebook_service import FacebookService

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        pending = db.query(ScheduledBudgetChange).filter(
            ScheduledBudgetChange.status == 'pending',
            ScheduledBudgetChange.scheduled_for <= now,
        ).all()

        if not pending:
            logger.info("No pending budget changes to apply")
            return

        logger.info(f"Found {len(pending)} pending budget change(s)")

        for change in pending:
            try:
                conn = db.query(FacebookConnection).filter(
                    FacebookConnection.id == change.connection_id,
                    FacebookConnection.is_active == True,
                ).first()
                if not conn:
                    change.status = 'failed'
                    change.error_message = 'Facebook connection not found or inactive'
                    db.commit()
                    logger.error(f"Connection {change.connection_id} not found for change {change.id}")
                    continue

                service = FacebookService(connection=conn)
                if not service.api:
                    service.initialize()

                result = service.update_budget(
                    change.fb_object_id,
                    change.object_type,
                    change.new_daily_budget,
                )
                change.status = 'applied'
                change.applied_at = datetime.utcnow()
                db.commit()
                logger.info(
                    f"Applied budget change {change.id}: "
                    f"{change.object_type} {change.fb_object_id} -> "
                    f"${change.new_daily_budget / 100:.2f}/day"
                )
            except Exception as e:
                change.status = 'failed'
                change.error_message = str(e)[:500]
                db.commit()
                logger.error(f"Failed to apply budget change {change.id}: {e}", exc_info=True)

        applied = sum(1 for c in pending if c.status == 'applied')
        failed = sum(1 for c in pending if c.status == 'failed')
        logger.info(f"Budget changes complete: {applied} applied, {failed} failed")

    except Exception as e:
        logger.error(f"Error in scheduled budgets job: {e}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
