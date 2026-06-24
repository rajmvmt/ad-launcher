"""Unit tests for scheduled-budget datetime parsing + validation."""
from datetime import datetime, timedelta
import pytest
import pytz

from app.api.v1.facebook import _parse_scheduled_for


EST = pytz.timezone('US/Eastern')


def test_none_returns_next_midnight_est():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    result = _parse_scheduled_for(None, now_est=now)
    assert result.tzinfo is not None
    assert result.astimezone(EST) == EST.localize(datetime(2026, 4, 24, 0, 0))


def test_naive_iso_treated_as_est():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    result = _parse_scheduled_for('2026-04-23T23:59:00', now_est=now)
    assert result.astimezone(EST) == EST.localize(datetime(2026, 4, 23, 23, 59))


def test_aware_iso_preserved():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    result = _parse_scheduled_for('2026-04-24T04:00:00+00:00', now_est=now)
    assert result.astimezone(pytz.UTC) == pytz.UTC.localize(datetime(2026, 4, 24, 4, 0))


def test_past_time_raises():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    with pytest.raises(ValueError, match="must be in the future"):
        _parse_scheduled_for('2026-04-23T20:00:00', now_est=now)


def test_too_soon_raises():
    now = EST.localize(datetime(2026, 4, 23, 21, 0, 0))
    target = (now + timedelta(seconds=30)).strftime('%Y-%m-%dT%H:%M:%S')
    with pytest.raises(ValueError, match="at least 60 seconds"):
        _parse_scheduled_for(target, now_est=now)


def test_malformed_raises():
    now = EST.localize(datetime(2026, 4, 23, 21, 0))
    with pytest.raises(ValueError, match="Invalid"):
        _parse_scheduled_for('not a date', now_est=now)
