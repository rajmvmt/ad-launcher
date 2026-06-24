"""Tests for fb_cache: stale-on-throttle fallback for Facebook API calls."""

import time
from unittest.mock import MagicMock

import pytest
from facebook_business.exceptions import FacebookRequestError

from app.services import fb_cache


@pytest.fixture(autouse=True)
def reset_caches():
    fb_cache._store.clear()
    fb_cache._throttle_seen_at.clear()
    yield
    fb_cache._store.clear()
    fb_cache._throttle_seen_at.clear()


def _rate_limit_error(subcode=2446079, code=4, http_status=400):
    """Build a FacebookRequestError that fb_cache should recognize as rate-limit."""
    err = FacebookRequestError(
        message="Rate limited",
        request_context={},
        http_status=http_status,
        http_headers={},
        body={
            "error": {
                "code": code,
                "error_subcode": subcode,
                "message": "Rate limited",
            }
        },
    )
    return err


def test_fresh_fetch_caches_result():
    fn = MagicMock(return_value=[{"id": "1"}])
    val, src = fb_cache.cached_or_fetch("k1", fn, fresh_ttl_seconds=60)
    assert val == [{"id": "1"}]
    assert src == "fresh"
    assert fn.call_count == 1


def test_cache_hit_within_ttl_skips_fn():
    fn = MagicMock(return_value=[1])
    fb_cache.cached_or_fetch("k2", fn, fresh_ttl_seconds=60)
    val, src = fb_cache.cached_or_fetch("k2", fn, fresh_ttl_seconds=60)
    assert val == [1]
    assert src == "cache"
    assert fn.call_count == 1  # second call hits cache


def test_rate_limit_serves_stale_cache():
    """When Meta throttles AND we have a previous success, return that stale value."""
    counter = {"n": 0}

    def fn():
        counter["n"] += 1
        if counter["n"] == 1:
            return [{"v": "first"}]
        raise _rate_limit_error()

    # 1st call: success -> caches
    val, src = fb_cache.cached_or_fetch("k3", fn, fresh_ttl_seconds=0, ad_account_id="acct1")
    assert val == [{"v": "first"}]
    assert src == "fresh"

    # 2nd call: TTL=0 forces refetch, but Meta throttles -> serve stale
    val, src = fb_cache.cached_or_fetch("k3", fn, fresh_ttl_seconds=0, ad_account_id="acct1")
    assert val == [{"v": "first"}]
    assert src == "stale-throttled"
    assert fb_cache.is_currently_throttled("acct1") is True


def test_rate_limit_with_no_cache_propagates():
    """If Meta throttles and we have nothing cached, raise — caller can return 500."""
    fn = MagicMock(side_effect=_rate_limit_error())
    with pytest.raises(FacebookRequestError):
        fb_cache.cached_or_fetch("k4", fn, fresh_ttl_seconds=60, ad_account_id="acct2")


def test_throttled_account_skips_meta_entirely():
    """While in backoff window, don't even try Meta — serve cache directly."""
    fn = MagicMock(return_value=[{"v": "cached"}])
    # Seed the cache once
    fb_cache.cached_or_fetch("k5", fn, fresh_ttl_seconds=60, ad_account_id="acct3")
    fn.reset_mock()

    # Mark account as throttled
    fb_cache.mark_throttled("acct3")

    # Force expiry of the fresh window so we'd normally refetch
    fb_cache._store["k5"] = (
        fb_cache._store["k5"][0],
        time.time() - 999,
        fb_cache._store["k5"][2],
    )

    val, src = fb_cache.cached_or_fetch("k5", fn, fresh_ttl_seconds=10, ad_account_id="acct3")
    assert val == [{"v": "cached"}]
    assert src == "stale-throttled"
    assert fn.call_count == 0  # Meta was skipped entirely


def test_non_rate_limit_error_propagates():
    """Real errors (auth, validation, etc) must NOT be swallowed by the cache."""
    fn = MagicMock(side_effect=ValueError("boom"))
    with pytest.raises(ValueError):
        fb_cache.cached_or_fetch("k6", fn, fresh_ttl_seconds=60, ad_account_id="acct4")
    assert fb_cache.is_currently_throttled("acct4") is False


def test_http_429_recognized_as_rate_limit():
    """HTTP 429 with no body subcode should still be treated as throttle."""
    err = FacebookRequestError(
        message="Throttled",
        request_context={},
        http_status=429,
        http_headers={},
        body={"error": {"code": 999, "message": "Throttled"}},
    )
    assert fb_cache._is_rate_limit_error(err) is True
