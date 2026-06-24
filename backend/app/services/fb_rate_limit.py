"""Rate-limit aware retry for Facebook API calls."""
import time
import logging
from functools import wraps
from facebook_business.exceptions import FacebookRequestError

logger = logging.getLogger(__name__)

def fb_retry(max_retries=3, base_delay=10):
    """Decorator that retries on Facebook rate limit (error code 17/32/4)."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except FacebookRequestError as e:
                    error_code = e.api_error_code()
                    if error_code in (17, 32, 4) and attempt < max_retries:
                        wait = base_delay * (2 ** attempt)
                        logger.warning(f"FB rate limit hit (code {error_code}), waiting {wait}s (attempt {attempt + 1}/{max_retries})")
                        time.sleep(wait)
                    else:
                        raise
            return func(*args, **kwargs)
        return wrapper
    return decorator
