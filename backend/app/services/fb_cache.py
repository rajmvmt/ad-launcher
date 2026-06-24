"""In-memory cache with stale-on-throttle fallback for Facebook API calls.

When Meta returns a rate-limit error (subcode 2446079, 1487225, 80004 etc.) or HTTP 429/613,
serve the last successful response instead of propagating a 500. This stops the UI from breaking
during Meta's per-ad-account throttling windows.

Cache is in-memory and per-process. That's fine for this use case — Railway runs a small
number of replicas and the worst case is a few extra Meta calls right after deploy.
"""

import logging
import time
from typing import Any, Callable, Optional, Tuple

from facebook_business.exceptions import FacebookRequestError

logger = logging.getLogger(__name__)

# Meta error codes/subcodes that indicate per-account or per-app rate-limiting.
# When we see these, prefer to serve stale cache rather than 500.
_RATE_LIMIT_SUBCODES = {
    2446079,   # "Ad Account Has Too Many API Calls"
    1487225,   # Insights account-level rate limit
    1487742,   # Application-level rate limit on Insights
    80004,     # Ads Management throttle
    80000,     # Ads Insights throttle (CUSL)
    80001,     # Ads Insights throttle
    80002,     # Insights API rate limit reached
    80003,     # Reads per hour
    80014,     # Custom audience rate limit
}
_RATE_LIMIT_CODES = {4, 17, 32, 613}  # generic API rate-limit error codes


def _is_rate_limit_error(exc: Exception) -> bool:
    if not isinstance(exc, FacebookRequestError):
        return False
    body = exc.body() if callable(getattr(exc, "body", None)) else {}
    err = (body or {}).get("error", {}) if isinstance(body, dict) else {}
    code = err.get("code")
    subcode = err.get("error_subcode")
    if subcode in _RATE_LIMIT_SUBCODES:
        return True
    if code in _RATE_LIMIT_CODES:
        return True
    # Some throttles surface as HTTP 429 / 613 only on the status, not in the body
    try:
        status = exc.http_status() if callable(getattr(exc, "http_status", None)) else None
    except Exception:
        status = None
    if status in (429, 613):
        return True
    return False


# key -> (value, fresh_ts, last_success_ts)
_store: dict[str, Tuple[Any, float, float]] = {}

# Track when each ad_account_id was last seen rate-limited
_throttle_seen_at: dict[str, float] = {}
_THROTTLE_BACKOFF_SECONDS = 300  # serve stale for 5 min after a throttle event


def mark_throttled(ad_account_id: Optional[str]) -> None:
    if ad_account_id:
        _throttle_seen_at[ad_account_id] = time.time()


def is_currently_throttled(ad_account_id: Optional[str]) -> bool:
    if not ad_account_id:
        return False
    last = _throttle_seen_at.get(ad_account_id)
    if not last:
        return False
    return (time.time() - last) < _THROTTLE_BACKOFF_SECONDS


def cached_or_fetch(
    cache_key: str,
    fetch_fn: Callable[[], Any],
    fresh_ttl_seconds: int = 30,
    ad_account_id: Optional[str] = None,
) -> Tuple[Any, str]:
    """Return (data, source) where source is 'fresh' | 'cache' | 'stale-throttled'.

    - If the ad_account_id is currently in a throttle backoff window AND we have a cached value,
      serve cache without hitting Meta.
    - Otherwise call fetch_fn(). On success, refresh cache. On rate-limit error, mark throttled
      and serve the last cached value if available (any age). On non-rate-limit error, propagate.
    """
    now = time.time()

    # 1. Throttle backoff: skip Meta entirely if we have anything cached
    if is_currently_throttled(ad_account_id):
        cached = _store.get(cache_key)
        if cached:
            value, _fresh_ts, _success_ts = cached
            return value, "stale-throttled"

    # 2. Fresh cache hit
    cached = _store.get(cache_key)
    if cached:
        value, fresh_ts, _success_ts = cached
        if (now - fresh_ts) < fresh_ttl_seconds:
            return value, "cache"

    # 3. Fetch from Meta
    try:
        value = fetch_fn()
        _store[cache_key] = (value, now, now)
        return value, "fresh"
    except Exception as exc:
        if _is_rate_limit_error(exc):
            mark_throttled(ad_account_id)
            cached = _store.get(cache_key)
            if cached:
                value, _fresh_ts, success_ts = cached
                age_s = int(now - success_ts)
                logger.warning(
                    "FB rate-limit on %s — serving stale cache (age=%ds, ad_acct=%s)",
                    cache_key, age_s, ad_account_id,
                )
                return value, "stale-throttled"
            logger.warning(
                "FB rate-limit on %s and no cached value to serve (ad_acct=%s)",
                cache_key, ad_account_id,
            )
        raise
