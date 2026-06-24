"""Tests for the bulk-ad pacing helper used by the existing-post batch worker."""
from app.services.pacing import compute_sleep_for_index


def test_no_sleep_at_index_zero():
    # First ad never sleeps.
    assert compute_sleep_for_index(0, total=10) == 0


def test_short_sleep_between_ads_in_a_wave():
    # 1s between ads inside a wave of 5.
    assert compute_sleep_for_index(1, total=10) == 1
    assert compute_sleep_for_index(2, total=10) == 1
    assert compute_sleep_for_index(4, total=10) == 1


def test_long_sleep_at_wave_boundary():
    # Every 5th ad (index 5, 10, 15) gets a 5s wave-end sleep.
    assert compute_sleep_for_index(5, total=10) == 5
    assert compute_sleep_for_index(10, total=20) == 5
    assert compute_sleep_for_index(15, total=20) == 5


def test_small_batches_use_legacy_2s_rhythm():
    # <=5 ads: keep today's 2s rhythm, no waves (zero regression for non-bulk).
    assert compute_sleep_for_index(0, total=3) == 0
    assert compute_sleep_for_index(1, total=3) == 2
    assert compute_sleep_for_index(2, total=3) == 2
    assert compute_sleep_for_index(4, total=5) == 2


def test_boundary_at_total_equals_5():
    # total=5 is the threshold - still legacy rhythm.
    assert compute_sleep_for_index(1, total=5) == 2
    assert compute_sleep_for_index(4, total=5) == 2


def test_boundary_at_total_equals_6():
    # total=6 switches to bulk pacing.
    assert compute_sleep_for_index(1, total=6) == 1
    assert compute_sleep_for_index(5, total=6) == 5
