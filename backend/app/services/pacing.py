"""
Pacing helpers for bulk Meta ad creation.

Meta's Marketing API throttles aggressive ad creation with 429 errors. The
validated pattern (see feedback_meta_avoid_rate_limits.md) is sequential
creation, sleep 1s between ads, and a longer 5s pause every 5 ads (one "wave").

For small batches (<=5 ads) we preserve the legacy 2s inter-ad rhythm so nothing
changes for non-bulk submissions.
"""

WAVE_SIZE = 5
BULK_THRESHOLD = 5  # batches > 5 enable wave pacing
LEGACY_INTER_AD_SLEEP = 2
BULK_INTER_AD_SLEEP = 1
WAVE_END_SLEEP = 5


def compute_sleep_for_index(index: int, total: int) -> int:
    """How many seconds to sleep BEFORE creating the ad at `index` (0-based).

    Args:
        index: 0-based index of the ad about to be created.
        total: total number of ads in this batch.

    Returns:
        Sleep duration in seconds. Always 0 for index 0.
    """
    if index == 0:
        return 0
    if total <= BULK_THRESHOLD:
        return LEGACY_INTER_AD_SLEEP
    # Bulk mode: wave end gets the long sleep, otherwise short.
    if index % WAVE_SIZE == 0:
        return WAVE_END_SLEEP
    return BULK_INTER_AD_SLEEP
