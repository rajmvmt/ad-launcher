"""CLI wrapper around app.services.r2_cleanup.sweep_orphans.

    python -m scripts.cleanup_r2_orphans              # 24h cutoff
    HOURS=6 python -m scripts.cleanup_r2_orphans      # 6h cutoff
    DRY_RUN=1 python -m scripts.cleanup_r2_orphans    # list, don't abort
"""
import logging
import os
import sys

from app.services.r2_cleanup import sweep_orphans


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    hours = int(os.getenv("HOURS", "24"))
    dry_run = os.getenv("DRY_RUN") == "1"
    sweep_orphans(hours=hours, dry_run=dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
