import os
from slowapi import Limiter
from slowapi.util import get_remote_address

# Rate limiter - uses client IP for rate limiting
# Disabled during tests so auth fixtures don't get throttled
limiter = Limiter(
    key_func=get_remote_address,
    enabled=os.getenv("TESTING") != "1",
)
