#!/usr/bin/env python3
"""Cron job: apply scheduled bid-cap changes.

Crontab: */15 * * * * (every 15 minutes)
Command: python run_bid_schedule.py

For each enabled BidSchedule row, fires once per day when "now" (in the row's
timezone) crosses its (hour, minute) trigger. Tracks last_applied_at so we
never double-fire even if the cron tick is jittery.

Idempotent: skips the FB call when the current bid already matches. Skips
silently when the object is not on a capped strategy (logs to last_error).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from collections import defaultdict
from app.database import SessionLocal
from app.models import BidSchedule, FacebookConnection
from app.services.facebook_service import FacebookService

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def should_fire(schedule: BidSchedule, now_local: datetime) -> bool:
    """True if `now_local` has crossed the trigger today and we haven't fired today."""
    active_days = schedule.active_days or [0, 1, 2, 3, 4, 5, 6]
    if now_local.weekday() not in active_days:
        return False

    trigger_today = now_local.replace(
        hour=schedule.hour,
        minute=schedule.minute or 0,
        second=0,
        microsecond=0,
    )
    if now_local < trigger_today:
        return False

    # Once-per-day: if we already attempted today (success OR failure), skip.
    # Compares calendar date in the row's tz so a same-day reschedule (hour edit)
    # can't trigger a re-fire, and a transient FB failure can't cause a retry
    # storm (re-attempting every 15 min until the 2h stale window).
    if schedule.last_applied_at:
        last_local = schedule.last_applied_at.astimezone(ZoneInfo(schedule.timezone))
        if last_local.date() == now_local.date():
            return False

    # Don't fire stale triggers more than 2h late (cron was down, etc.) —
    # better to wait for tomorrow than slam an old bid mid-day.
    if now_local - trigger_today > timedelta(hours=2):
        return False

    return True


def main():
    db = SessionLocal()
    try:
        schedules = db.query(BidSchedule).filter(BidSchedule.enabled == True).all()

        if not schedules:
            logger.info("No enabled bid schedules")
            return

        # Group by connection for FB API instance reuse.
        by_connection = defaultdict(list)
        for s in schedules:
            by_connection[s.connection_id].append(s)

        applied = skipped_same = skipped_strategy = skipped_window = failed = 0

        for connection_id, group in by_connection.items():
            conn = db.query(FacebookConnection).filter(
                FacebookConnection.id == connection_id,
                FacebookConnection.is_active == True,
            ).first()
            if not conn:
                logger.error(f"Connection {connection_id} missing/inactive — skipping {len(group)}")
                failed += len(group)
                continue

            service = FacebookService(connection=conn)
            if not service.api:
                service.initialize()

            for schedule in group:
                try:
                    tz = ZoneInfo(schedule.timezone)
                    now_local = datetime.now(tz)
                    if not should_fire(schedule, now_local):
                        skipped_window += 1
                        continue

                    obj_type = schedule.object_type or 'adset'
                    result = service.update_bid(
                        schedule.fb_object_id, obj_type, schedule.bid_amount_cents
                    )
                    action = result.get('action')

                    schedule.last_applied_at = datetime.utcnow()
                    schedule.last_error = None
                    if action == 'updated':
                        schedule.last_applied_bid_cents = schedule.bid_amount_cents
                        applied += 1
                        logger.info(
                            f"{obj_type} {schedule.fb_object_id} bid -> "
                            f"${schedule.bid_amount_cents/100:.2f} at "
                            f"{schedule.hour:02d}:{schedule.minute or 0:02d} "
                            f"{schedule.timezone}"
                        )
                    elif action == 'skipped_same':
                        schedule.last_applied_bid_cents = schedule.bid_amount_cents
                        skipped_same += 1
                    elif action == 'skipped_strategy':
                        schedule.last_error = (
                            f"strategy={result.get('bid_strategy')} not capped — "
                            f"set bid_strategy first"
                        )
                        skipped_strategy += 1
                        logger.warning(
                            f"{obj_type} {schedule.fb_object_id} skipped: {schedule.last_error}"
                        )
                    db.commit()

                except Exception as e:
                    failed += 1
                    schedule.last_applied_at = datetime.utcnow()
                    schedule.last_error = str(e)[:500]
                    db.commit()
                    logger.error(
                        f"Failed bid update for {schedule.fb_object_id}: {e}",
                        exc_info=True,
                    )

        logger.info(
            f"bid_schedule complete: {applied} applied, {skipped_same} same, "
            f"{skipped_strategy} strategy, {skipped_window} window, {failed} failed"
        )

    except Exception as e:
        logger.error(f"Fatal in bid_schedule: {e}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
