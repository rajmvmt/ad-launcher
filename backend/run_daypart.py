#!/usr/bin/env python3
"""
Cron job script for dayparting — pause/activate ad sets on schedule.

Railway cron: */15 * * * * (every 15 minutes)
Command: python run_daypart.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from collections import defaultdict
from app.database import SessionLocal
from app.models import DaypartSchedule, FacebookConnection
from app.services.facebook_service import FacebookService

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def is_within_active_window(schedule: DaypartSchedule) -> bool:
    """Check if current time in schedule's timezone is within the active window."""
    tz = ZoneInfo(schedule.timezone)
    now = datetime.now(tz)
    current_minutes = now.hour * 60 + now.minute
    start_minutes = schedule.active_start_hour * 60 + (schedule.active_start_minute or 0)
    end_minutes = schedule.active_end_hour * 60 + (schedule.active_end_minute or 0)

    # Check day of week (Python: 0=Mon..6=Sun matches our schema)
    active_days = schedule.active_days or [0, 1, 2, 3, 4, 5, 6]
    if now.weekday() not in active_days:
        return False

    # Normal window (e.g. 6:00 - 22:00)
    if start_minutes < end_minutes:
        return start_minutes <= current_minutes < end_minutes

    # Overnight window (e.g. 22:00 - 6:00)
    if start_minutes > end_minutes:
        return current_minutes >= start_minutes or current_minutes < end_minutes

    # start == end means always active (24h)
    return True


def main():
    db = SessionLocal()
    try:
        schedules = db.query(DaypartSchedule).filter(
            DaypartSchedule.enabled == True,
        ).all()

        if not schedules:
            logger.info("No enabled daypart schedules")
            return

        logger.info(f"Processing {len(schedules)} daypart schedule(s)")

        # Group by connection_id to reuse FB API instances
        by_connection = defaultdict(list)
        for s in schedules:
            by_connection[s.connection_id].append(s)

        activated = 0
        paused = 0
        skipped = 0
        failed = 0

        for connection_id, group in by_connection.items():
            conn = db.query(FacebookConnection).filter(
                FacebookConnection.id == connection_id,
                FacebookConnection.is_active == True,
            ).first()
            if not conn:
                logger.error(f"Connection {connection_id} not found or inactive, skipping {len(group)} schedule(s)")
                failed += len(group)
                continue

            service = FacebookService(connection=conn)
            if not service.api:
                service.initialize()

            for schedule in group:
                try:
                    active = is_within_active_window(schedule)
                    desired_action = 'activated' if active else 'paused'

                    if schedule.last_action == desired_action:
                        skipped += 1
                        continue

                    status = 'ACTIVE' if active else 'PAUSED'
                    obj_type = getattr(schedule, 'object_type', 'adset') or 'adset'
                    service.update_object_status(schedule.fb_adset_id, obj_type, status)

                    schedule.last_action = desired_action
                    schedule.last_action_at = datetime.utcnow()
                    db.commit()

                    if active:
                        activated += 1
                    else:
                        paused += 1

                    logger.info(
                        f"{obj_type.title()} {schedule.fb_adset_id} -> {status} "
                        f"(schedule {schedule.active_start_hour}:{schedule.active_start_minute:02d}"
                        f"-{schedule.active_end_hour}:{schedule.active_end_minute:02d} "
                        f"{schedule.timezone})"
                    )
                except Exception as e:
                    failed += 1
                    logger.error(
                        f"Failed to update {getattr(schedule, 'object_type', 'adset')} {schedule.fb_adset_id}: {e}",
                        exc_info=True,
                    )

        logger.info(
            f"Daypart complete: {activated} activated, {paused} paused, "
            f"{skipped} skipped, {failed} failed"
        )

    except Exception as e:
        logger.error(f"Error in daypart job: {e}", exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
