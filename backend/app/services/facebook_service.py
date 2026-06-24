import os
import json
import logging
from facebook_business.api import FacebookAdsApi
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.campaign import Campaign
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.adimage import AdImage
from facebook_business.adobjects.adcreative import AdCreative
from facebook_business.adobjects.ad import Ad
from facebook_business.adobjects.advideo import AdVideo
from facebook_business.exceptions import FacebookRequestError
from app.services.fb_rate_limit import fb_retry
from dotenv import load_dotenv
from pathlib import Path
from facebook_business.adobjects.user import User
import time

# Load .env from project root (parent of backend)
env_path = Path(__file__).resolve().parent.parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)


class VideoUploadStalled(Exception):
    """Raised when FB's file_url ingest stalls (length=0 across multiple polls).

    Caller should tear down the stalled video and retry via _manual_chunked_upload.
    """
    pass


# Files above this size go straight to chunked upload — FB's file_url path
# depends on the source URL serving FB at full speed, which R2's free public
# bucket cannot do reliably for large files.
LARGE_VIDEO_THRESHOLD_BYTES = 100 * 1024 * 1024

def _extract_results(actions):
    """
    Extract 'website purchases' count from Facebook actions list.
    Checks purchase-related action types in priority order to avoid double-counting.
    """
    if not actions:
        return 0
    by_type = {}
    for a in actions:
        by_type[a.get('action_type', '')] = int(a.get('value', 0))

    # Priority order — return first match to avoid double-counting
    for t in ('purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'):
        if by_type.get(t, 0) > 0:
            return by_type[t]
    return 0


def _extract_purchase_revenue(action_values):
    """Extract purchase revenue from Facebook action_values list."""
    if not action_values:
        return 0.0
    by_type = {}
    for a in action_values:
        by_type[a.get('action_type', '')] = float(a.get('value', 0))
    for t in ('purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'):
        if by_type.get(t, 0) > 0:
            return by_type[t]
    return 0.0


logger = logging.getLogger(__name__)


class FacebookService:
    def __init__(self, connection=None):
        if connection:
            # Initialize from a database FacebookConnection model
            self.access_token = connection.access_token
            self.app_id = connection.app_id
            self.app_secret = connection.app_secret
            self.ad_account_id = connection.ad_account_id
            self._connection_id = connection.id
        else:
            # Fallback to env vars (backward compatible)
            self.access_token = os.getenv("FACEBOOK_ACCESS_TOKEN") or os.getenv("VITE_FACEBOOK_ACCESS_TOKEN")
            self.ad_account_id = os.getenv("FACEBOOK_AD_ACCOUNT_ID") or os.getenv("VITE_FACEBOOK_AD_ACCOUNT_ID")
            self.app_id = os.getenv("FACEBOOK_APP_ID") or os.getenv("VITE_FACEBOOK_APP_ID")
            self.app_secret = os.getenv("FACEBOOK_APP_SECRET") or os.getenv("VITE_FACEBOOK_APP_SECRET")
            self._connection_id = 'default'
        self.api = None
        self.account = None
        self.api_version = os.getenv("FACEBOOK_API_VERSION") or os.getenv("VITE_FACEBOOK_API_VERSION") or "v24.0"

        if self.access_token:
            self.initialize()

    def initialize(self):
        """Initialize the Facebook API connection."""
        try:
            FacebookAdsApi.init(
                app_id=self.app_id,
                app_secret=self.app_secret,
                access_token=self.access_token
            )
            self.api = FacebookAdsApi.get_default_api()
            
            # Only set up the AdAccount object if we have an ID
            if self.ad_account_id:
                # Ensure ad account ID has 'act_' prefix
                account_id = self.ad_account_id
                if not account_id.startswith('act_'):
                    account_id = f'act_{account_id}'
                self.account = AdAccount(account_id)
            
            return True
        except Exception as e:
            # Re-raise the exception so the caller knows what went wrong
            raise Exception(f"Facebook API Init Error: {str(e)}")


    # Page access tokens are required to upload videos via /<page_id>/videos.
    # System User tokens cannot upload videos to /<ad_account>/advideos —
    # FB silently quarantines those uploads (uploading_phase: in_progress forever).
    # The page endpoint is what the Ads Manager UI uses internally.
    _page_token_cache = {}

    def get_page_access_token(self, page_id):
        """Return a Page Access Token for the given page_id.

        Uses /me/accounts to enumerate pages and pick out the matching one's
        access_token. Cached on the service instance (page tokens issued from
        a SU don't expire as long as the SU has admin rights).

        Raises Exception if the SU doesn't have the page in /me/accounts.
        """
        if page_id in self.__class__._page_token_cache:
            return self.__class__._page_token_cache[page_id]

        import requests
        if not self.api:
            self.initialize()

        url = "https://graph.facebook.com/v24.0/me/accounts"
        params = {'fields': 'id,access_token', 'access_token': self.access_token, 'limit': 100}
        resp = requests.get(url, params=params, timeout=15).json()
        if 'error' in resp:
            raise Exception(f"Failed to list pages for SU: {resp['error'].get('message', resp['error'])}")

        for page in resp.get('data', []):
            if str(page.get('id')) == str(page_id):
                tok = page.get('access_token')
                if not tok:
                    raise Exception(f"Page {page_id} found but no access_token in /me/accounts response — SU may lack page admin rights")
                self.__class__._page_token_cache[page_id] = tok
                print(f"[get_page_access_token] Cached page token for {page_id} (len {len(tok)})")
                return tok

        # Walk paginated results if there are more than 100 pages
        next_url = resp.get('paging', {}).get('next')
        while next_url:
            resp = requests.get(next_url, timeout=15).json()
            if 'error' in resp:
                break
            for page in resp.get('data', []):
                if str(page.get('id')) == str(page_id):
                    tok = page.get('access_token')
                    if not tok:
                        raise Exception(f"Page {page_id} found (paginated) but no access_token")
                    self.__class__._page_token_cache[page_id] = tok
                    return tok
            next_url = resp.get('paging', {}).get('next')

        raise Exception(f"Page {page_id} not in this System User's /me/accounts — assign the page to the SU in Business Manager")

    def get_ad_accounts(self):
        """Fetch all ad accounts for the current user or system user."""
        if not self.api:
            self.initialize()

        # First try /me/adaccounts (works for user tokens)
        print("Fetching ad accounts for user 'me'...")
        try:
            me = User(fbid='me', api=self.api)
            my_accounts = me.get_ad_accounts(fields=['id', 'name', 'account_id', 'account_status', 'currency', 'balance', 'amount_spent'])
            if len(my_accounts) > 0:
                print(f"Found {len(my_accounts)} accounts.")
                return [dict(acc) for acc in my_accounts]
            print("/me/adaccounts returned 0 accounts, falling back to direct account lookup...")
        except Exception as e:
            print(f"/me/adaccounts failed ({e}), falling back to direct account lookup...")

        # Fallback for system user tokens: query the configured ad account directly
        if self.account:
            try:
                fields = ['id', 'name', 'account_id', 'account_status', 'currency', 'balance', 'amount_spent']
                account_data = self.account.api_get(fields=fields)
                print(f"Found configured account: {account_data.get('name')}")
                return [dict(account_data)]
            except Exception as e2:
                print(f"Direct account lookup also failed: {e2}")
                raise e2

        raise Exception("No ad accounts found and no default account configured.")

    def _get_account(self, ad_account_id=None):
        """Helper to get AdAccount object."""
        if ad_account_id:
            if not ad_account_id.startswith('act_'):
                ad_account_id = f'act_{ad_account_id}'
            return AdAccount(ad_account_id, api=self.api)
        
        if self.account:
            return self.account
            
        raise Exception("No Ad Account ID provided and no default account set.")

    def get_campaigns(self, ad_account_id=None):
        """Fetch all campaigns from the ad account."""
        account = self._get_account(ad_account_id)
            
        fields = [
            Campaign.Field.id,
            Campaign.Field.name,
            Campaign.Field.objective,
            Campaign.Field.status,
            Campaign.Field.daily_budget,
            Campaign.Field.lifetime_budget,
            Campaign.Field.budget_remaining,
            Campaign.Field.bid_strategy,
            'is_adset_budget_sharing_enabled',
        ]

        
        return account.get_campaigns(fields=fields)

    def create_campaign(self, campaign_data, ad_account_id=None):
        """Create a new campaign."""
        account = self._get_account(ad_account_id)

        params = {
            Campaign.Field.name: campaign_data.get('name'),
            Campaign.Field.objective: campaign_data.get('objective'),
            Campaign.Field.status: campaign_data.get('status', 'ACTIVE'),
            Campaign.Field.special_ad_categories: [],
        }

        # Handle budget based on budget type
        budget_type = campaign_data.get('budget_type') or campaign_data.get('budgetType')
        daily_budget = campaign_data.get('daily_budget') or campaign_data.get('dailyBudget')
        
        is_cbo = budget_type == 'CBO' and daily_budget
        if is_cbo:
            # Campaign Budget Optimization
            # Set budget at campaign level, do NOT set is_adset_budget_sharing_enabled
            params[Campaign.Field.daily_budget] = int(float(daily_budget) * 100)
        else:
            # Ad Set Budget Optimization (ABO)
            # Budget is set at ad set level, not campaign level
            # Starting with API v24.0+, is_adset_budget_sharing_enabled is REQUIRED for ABO
            # Set to False to enforce strict ad set budgets
            params['is_adset_budget_sharing_enabled'] = False

        # bid_strategy at the campaign level is only valid on CBO campaigns.
        # On ABO, the bid strategy must live on the ad set — Facebook rejects
        # campaign-level bid_strategy without a campaign budget (subcode 1885737).
        bid_strategy = campaign_data.get('bid_strategy') or campaign_data.get('bidStrategy')
        if bid_strategy and is_cbo:
            params[Campaign.Field.bid_strategy] = bid_strategy

        return account.create_campaign(params=params)


    def get_pixels(self, ad_account_id=None):
        """Fetch all pixels for the ad account."""
        from facebook_business.adobjects.adspixel import AdsPixel

        account = self._get_account(ad_account_id)

        fields = [
            AdsPixel.Field.id,
            AdsPixel.Field.name,
        ]

        pixels = account.get_ads_pixels(fields=fields)
        return [dict(pixel) for pixel in pixels]

    def _resolve_pixel_business(self, ad_account_id: str) -> dict:
        """Find the right business to create a new pixel under for this ad account.

        FB enforces 1 pixel per ad account (`/act_xxx/adspixels` returns 6200),
        so new pixels must be created on a business. Prefer a CONFIRMED agency
        (the operating BM, where existing per-offer pixels live); fall back to
        the ad account's owner business if no agency relationship exists.
        """
        import requests as _req

        r = _req.get(
            f"https://graph.facebook.com/v24.0/{ad_account_id}/agencies",
            params={"access_token": self.access_token},
            timeout=15,
        )
        agencies = (r.json() or {}).get("data", [])
        if agencies:
            confirmed = next((a for a in agencies if a.get("access_status") == "CONFIRMED"), agencies[0])
            return {"id": confirmed["id"], "name": confirmed.get("name", ""), "source": "agency"}

        r2 = _req.get(
            f"https://graph.facebook.com/v24.0/{ad_account_id}",
            params={"access_token": self.access_token, "fields": "business"},
            timeout=15,
        )
        biz = (r2.json() or {}).get("business") or {}
        if biz.get("id"):
            return {"id": biz["id"], "name": biz.get("name", ""), "source": "owner"}

        raise RuntimeError(f"No business found for {ad_account_id} to create a pixel under")

    def create_pixel(self, name: str, ad_account_id=None):
        """Create a new FB pixel on the agency/owner business of the given ad account.

        Targets the business (not the ad account) because FB caps ad accounts at
        1 pixel. On the 100-pixel business cap (error_subcode 1784017), raises
        with a guidance string — callers should fall back to rename_pixel().
        """
        import requests as _req

        acct = (ad_account_id or "").strip() or getattr(self, "_default_account_id", None)
        if not acct:
            raise ValueError("ad_account_id required")
        if not acct.startswith("act_"):
            acct = f"act_{acct}"

        target = self._resolve_pixel_business(acct)

        r = _req.post(
            f"https://graph.facebook.com/v24.0/{target['id']}/adspixels",
            data={"name": name, "access_token": self.access_token},
            timeout=20,
        )
        body = r.json() if r.text else {}
        if "id" in body:
            return {
                "id": body["id"],
                "name": name,
                "owner_business": {"id": target["id"], "name": target["name"]},
                "via": target["source"],
            }

        err = body.get("error", {})
        sub = err.get("error_subcode")
        msg = err.get("message", str(body))
        if sub == 1784017:
            raise RuntimeError(
                f"Business {target['name']} ({target['id']}) is at the 100-pixel cap. "
                f"Rename a stale pixel via /pixels/owned-list (sorted by last_fired) "
                f"and /pixels/{{id}}/rename. No new pixel was created."
            )
        raise RuntimeError(f"FB pixel create failed on {target['id']}: {msg}")

    def list_owned_pixels(self, ad_account_id=None, business_id: str | None = None):
        """List pixels owned by a business (default: agency/owner of the ad account).

        Returns each pixel's id, name, last_fired_time, creation_time, plus the
        target business meta. Useful for finding stalest pixels to rename when
        the 100-cap is hit.
        """
        import requests as _req

        if business_id:
            biz = {"id": business_id, "name": ""}
        else:
            acct = (ad_account_id or "").strip() or getattr(self, "_default_account_id", None)
            if not acct:
                raise ValueError("ad_account_id or business_id required")
            if not acct.startswith("act_"):
                acct = f"act_{acct}"
            biz = self._resolve_pixel_business(acct)

        r = _req.get(
            f"https://graph.facebook.com/v24.0/{biz['id']}/owned_pixels",
            params={
                "access_token": self.access_token,
                "fields": "id,name,last_fired_time,creation_time",
                "limit": 200,
            },
            timeout=20,
        )
        data = (r.json() or {}).get("data", [])
        for p in data:
            p.setdefault("last_fired_time", None)
        data.sort(key=lambda p: p.get("last_fired_time") or "0000")
        return {"business": biz, "count": len(data), "cap": 100, "pixels": data}

    def rename_pixel(self, pixel_id: str, name: str) -> dict:
        """Rename an existing pixel in place. Used to repurpose a stale pixel
        when the business has hit the 100-cap."""
        import requests as _req

        r = _req.post(
            f"https://graph.facebook.com/v24.0/{pixel_id}",
            data={"name": name, "access_token": self.access_token},
            timeout=20,
        )
        body = r.json() if r.text else {}
        if body.get("success"):
            return {"id": pixel_id, "name": name}
        err = body.get("error", {}) or {}
        raise RuntimeError(f"FB pixel rename failed: {err.get('message', str(body))}")

    def get_custom_audiences(self, ad_account_id=None):
        """Fetch all custom audiences (including lookalikes) for the ad account."""
        from facebook_business.adobjects.customaudience import CustomAudience

        account = self._get_account(ad_account_id)
        fields = [
            CustomAudience.Field.id,
            CustomAudience.Field.name,
            CustomAudience.Field.subtype,
            CustomAudience.Field.approximate_count_lower_bound,
            CustomAudience.Field.delivery_status,
        ]
        audiences = account.get_custom_audiences(fields=fields, params={'limit': 200})
        return [dict(a) for a in audiences]

    def get_pages(self, ad_account_id=None):
        """Fetch all Facebook Pages accessible via ad accounts and user token."""
        from facebook_business.adobjects.page import Page
        from facebook_business.adobjects.user import User

        me = User(fbid='me', api=self.api)
        page_fields = [Page.Field.id, Page.Field.name, Page.Field.category]

        seen_ids = set()
        all_pages = []

        # 1) User-owned/admin pages (me/accounts)
        try:
            user_pages = me.get_accounts(fields=page_fields + [Page.Field.access_token])
            count = 0
            for p in user_pages:
                d = dict(p)
                if d.get("id") and d["id"] not in seen_ids:
                    seen_ids.add(d["id"])
                    all_pages.append(d)
                    count += 1
            print(f"[get_pages] User pages: {count}")
        except Exception as e:
            print(f"[get_pages] Failed to fetch user pages: {e}")

        # 2) Discover pages from ad creatives on each ad account
        #    Every running/paused ad references a page_id — extract unique pages
        try:
            import requests
            ad_accounts = self.get_ad_accounts()
            print(f"[get_pages] Scanning ads on {len(ad_accounts)} ad accounts for page IDs")
            page_ids_found = set()
            for acct in ad_accounts:
                acct_id = acct.get("id")
                if not acct_id:
                    continue
                try:
                    # Use Graph API directly — get ads with their creative page_id
                    url = f"https://graph.facebook.com/v21.0/{acct_id}/ads"
                    params = {
                        "fields": "creative{effective_object_story_id}",
                        "limit": 200,
                        "access_token": self.access_token,
                    }
                    resp = requests.get(url, params=params, timeout=30)
                    if resp.ok:
                        for ad in resp.json().get("data", []):
                            story_id = (ad.get("creative") or {}).get("effective_object_story_id", "")
                            if "_" in story_id:
                                pid = story_id.split("_")[0]
                                if pid and pid not in seen_ids:
                                    page_ids_found.add(pid)
                except Exception as e:
                    print(f"[get_pages] Failed scanning ads for {acct_id}: {e}")

            # Now fetch page name/category for each discovered page ID
            for pid in page_ids_found:
                try:
                    url = f"https://graph.facebook.com/v21.0/{pid}"
                    params = {
                        "fields": "id,name,category",
                        "access_token": self.access_token,
                    }
                    resp = requests.get(url, params=params, timeout=10)
                    if resp.ok:
                        d = resp.json()
                        if d.get("id") and d["id"] not in seen_ids:
                            seen_ids.add(d["id"])
                            all_pages.append(d)
                            print(f"[get_pages] Found page from ads: {d.get('name')} ({d['id']})")
                except Exception as e:
                    # Can't read page info — add with just the ID
                    all_pages.append({"id": pid, "name": f"Page {pid}", "category": None})
                    seen_ids.add(pid)
                    print(f"[get_pages] Added page {pid} (couldn't fetch name: {e})")
        except Exception as e:
            print(f"[get_pages] Failed ad-based page discovery: {e}")

        # 3) Also try promote_pages on each ad account
        try:
            for acct in ad_accounts:
                acct_id = acct.get("id")
                if not acct_id:
                    continue
                try:
                    a = AdAccount(acct_id, api=self.api)
                    promo_pages = a.get_promote_pages(fields=page_fields)
                    for p in promo_pages:
                        d = dict(p)
                        if d.get("id") and d["id"] not in seen_ids:
                            seen_ids.add(d["id"])
                            all_pages.append(d)
                            print(f"[get_pages] Promote page: {d.get('name')} ({d['id']})")
                except Exception:
                    pass
        except Exception:
            pass

        # 3) Business Manager pages (owned + client) — if token has business_management
        try:
            businesses = me.get_businesses(fields=["id", "name"])
            biz_list = list(businesses)
            if biz_list:
                print(f"[get_pages] Found {len(biz_list)} businesses")
                for biz in biz_list:
                    biz_id = biz.get("id")
                    biz_name = biz.get("name", "?")
                    if not biz_id:
                        continue
                    try:
                        from facebook_business.adobjects.business import Business
                        b = Business(fbid=biz_id, api=self.api)
                        for method_name in ("get_owned_pages", "get_client_pages"):
                            try:
                                bm_pages = getattr(b, method_name)(fields=page_fields)
                                count = 0
                                for p in bm_pages:
                                    d = dict(p)
                                    if d.get("id") and d["id"] not in seen_ids:
                                        seen_ids.add(d["id"])
                                        all_pages.append(d)
                                        count += 1
                                if count > 0:
                                    print(f"[get_pages] BM '{biz_name}' {method_name}: {count} new pages")
                            except Exception as e:
                                print(f"[get_pages] BM '{biz_name}' {method_name} failed: {e}")
                    except Exception as e:
                        print(f"[get_pages] Failed BM '{biz_name}': {e}")
        except Exception as e:
            print(f"[get_pages] No business access via SDK: {e}")

        # 4) System user fallback — query /me to get the system user's BM,
        #    then fetch pages assigned to that BM via Graph API directly
        if not all_pages:
            try:
                import requests as req
                # Get system user identity and their business
                me_resp = req.get(
                    "https://graph.facebook.com/v21.0/me",
                    params={"fields": "id,name", "access_token": self.access_token},
                    timeout=15,
                ).json()
                me_id = me_resp.get("id")
                print(f"[get_pages] System user fallback — me={me_resp.get('name')} ({me_id})")

                if me_id:
                    # Try assigned_pages on the system user
                    pages_resp = req.get(
                        f"https://graph.facebook.com/v21.0/{me_id}/assigned_pages",
                        params={
                            "fields": "id,name,category",
                            "access_token": self.access_token,
                        },
                        timeout=15,
                    ).json()
                    for p in pages_resp.get("data", []):
                        if p.get("id") and p["id"] not in seen_ids:
                            seen_ids.add(p["id"])
                            all_pages.append(p)
                    if pages_resp.get("data"):
                        print(f"[get_pages] System user assigned_pages: {len(pages_resp['data'])} pages")

                    # Also try getting BM owned/client pages via the business
                    biz_resp = req.get(
                        f"https://graph.facebook.com/v21.0/{me_id}",
                        params={"fields": "business{id,name}", "access_token": self.access_token},
                        timeout=15,
                    ).json()
                    biz = biz_resp.get("business", {})
                    biz_id = biz.get("id")
                    if biz_id:
                        print(f"[get_pages] Found BM via system user: {biz.get('name')} ({biz_id})")
                        for edge in ("owned_pages", "client_pages"):
                            try:
                                edge_resp = req.get(
                                    f"https://graph.facebook.com/v21.0/{biz_id}/{edge}",
                                    params={
                                        "fields": "id,name,category",
                                        "access_token": self.access_token,
                                    },
                                    timeout=15,
                                ).json()
                                count = 0
                                for p in edge_resp.get("data", []):
                                    if p.get("id") and p["id"] not in seen_ids:
                                        seen_ids.add(p["id"])
                                        all_pages.append(p)
                                        count += 1
                                if count:
                                    print(f"[get_pages] BM {edge}: {count} new pages")
                            except Exception as e2:
                                print(f"[get_pages] BM {edge} failed: {e2}")
            except Exception as e:
                print(f"[get_pages] System user fallback failed: {e}")

        print(f"[get_pages] Total: {len(all_pages)} pages")
        return all_pages

    def get_page_info(self, page_id: str):
        """Fetch a single Facebook Page's name by ID."""
        from facebook_business.adobjects.page import Page

        page = Page(fbid=page_id, api=self.api)
        page.api_get(fields=[Page.Field.id, Page.Field.name])
        return {"id": page[Page.Field.id], "name": page[Page.Field.name]}

    def get_adsets(self, ad_account_id=None, campaign_id=None):
        """Fetch all ad sets."""
        fields = [
            AdSet.Field.id,
            AdSet.Field.name,
            AdSet.Field.status,
            AdSet.Field.daily_budget,
            AdSet.Field.targeting,
            AdSet.Field.optimization_goal,
            AdSet.Field.billing_event,
            AdSet.Field.bid_amount,
            AdSet.Field.promoted_object,
            AdSet.Field.campaign_id,
        ]

        if campaign_id:
            # Fetch from campaign
            campaign = Campaign(campaign_id, api=self.api)
            return campaign.get_ad_sets(fields=fields)
        
        account = self._get_account(ad_account_id)
        return account.get_ad_sets(fields=fields)

    def get_ads(self, adset_id):
        """Fetch all ads for a specific ad set."""
        adset = AdSet(adset_id, api=self.api)
        fields = [
            Ad.Field.id,
            Ad.Field.name,
            Ad.Field.status,
            Ad.Field.creative,
        ]
        return adset.get_ads(fields=fields)

    def create_adset(self, adset_data, ad_account_id=None):
        """Create a new ad set."""
        account = self._get_account(ad_account_id)

        # Transform targeting from camelCase to snake_case
        targeting = adset_data.get('targeting', {})
        transformed_targeting = {}
        
        # Handle age fields
        if 'ageMin' in targeting:
            transformed_targeting['age_min'] = targeting['ageMin']
        if 'ageMax' in targeting:
            transformed_targeting['age_max'] = targeting['ageMax']
        
        # Handle genders
        if 'genders' in targeting:
            transformed_targeting['genders'] = targeting['genders']
        
        # Handle geo_locations - clean up empty arrays
        if 'geo_locations' in targeting:
            geo_locs = targeting['geo_locations']
            cleaned_geo_locs = {}

            # FB requires `countries` and `excluded_countries` as plain ISO-code
            # strings (e.g. ["US","CA"]). The frontend picker stores selected
            # locations as objects { key, name, type, country_code, ... } for
            # consistency across types — normalize country entries back to
            # strings so FB doesn't 400 with "Country Code must be a string".
            # Non-country geo types (regions/cities/geo_markets) stay as objects.
            COUNTRY_KEYS = ('countries', 'excluded_countries')
            for key, value in geo_locs.items():
                if isinstance(value, list):
                    if len(value) == 0:
                        continue
                    if key in COUNTRY_KEYS:
                        normalized = []
                        for entry in value:
                            if isinstance(entry, str):
                                normalized.append(entry)
                            elif isinstance(entry, dict):
                                code = entry.get('country_code') or entry.get('key')
                                if code:
                                    normalized.append(code)
                        if normalized:
                            cleaned_geo_locs[key] = normalized
                    else:
                        cleaned_geo_locs[key] = value
                else:
                    # Include non-list values (e.g. location_types) as-is
                    cleaned_geo_locs[key] = value

            if cleaned_geo_locs:
                transformed_targeting['geo_locations'] = cleaned_geo_locs
        elif 'countries' in targeting:
            # Fallback: handle flat countries key (legacy format)
            transformed_targeting['geo_locations'] = {'countries': targeting['countries']}
        
        # Handle publisher_platforms
        if 'publisher_platforms' in targeting:
            transformed_targeting['publisher_platforms'] = targeting['publisher_platforms']

        # Handle custom audiences (custom + lookalike)
        if 'custom_audiences' in targeting and targeting['custom_audiences']:
            transformed_targeting['custom_audiences'] = [
                {'id': aid} for aid in targeting['custom_audiences']
            ]

        # Handle excluded custom audiences
        if 'excluded_custom_audiences' in targeting and targeting['excluded_custom_audiences']:
            transformed_targeting['excluded_custom_audiences'] = [
                {'id': aid} for aid in targeting['excluded_custom_audiences']
            ]

        # Fix for Advantage Audience Flag Required error
        # Facebook now requires explicit opt-in/out for Advantage+ Audience
        # Default to 0 (Off) if not provided, unless user explicitly sets it
        advantage_audience = adset_data.get('advantage_audience') or adset_data.get('advantageAudience') or 0
        transformed_targeting['targeting_automation'] = {
            'advantage_audience': advantage_audience
        }

        params = {
            AdSet.Field.name: adset_data.get('name'),
            AdSet.Field.campaign_id: adset_data.get('campaign_id'),
            AdSet.Field.billing_event: 'IMPRESSIONS',
            AdSet.Field.optimization_goal: adset_data.get('optimization_goal') or adset_data.get('optimizationGoal'),
            AdSet.Field.is_dynamic_creative: False,
            AdSet.Field.status: adset_data.get('status', 'ACTIVE'),
            AdSet.Field.targeting: transformed_targeting,
        }

        # Handle destination_type (e.g. ON_POST for engagement without external URL)
        destination_type = adset_data.get('destination_type') or adset_data.get('destinationType')
        if destination_type:
            params[AdSet.Field.destination_type] = destination_type

        # Handle promoted_object
        if adset_data.get('promoted_object'):
            # Direct promoted_object dict (e.g. {"page_id": "123"} for engagement)
            params[AdSet.Field.promoted_object] = adset_data['promoted_object']
        elif adset_data.get('optimization_goal') == 'OFFSITE_CONVERSIONS' or adset_data.get('optimizationGoal') == 'OFFSITE_CONVERSIONS':
            pixel_id = adset_data.get('pixelId') or adset_data.get('pixel_id')
            conversion_event = adset_data.get('conversionEvent') or adset_data.get('conversion_event')

            if pixel_id and conversion_event:
                params[AdSet.Field.promoted_object] = {
                    'pixel_id': pixel_id,
                    'custom_event_type': conversion_event
                }


        # Handle budget - only set for ABO campaigns (not CBO)
        # CBO = Campaign Budget Optimization (budget at campaign level)
        # ABO = Ad Set Budget Optimization (budget at ad set level)
        budget_type = adset_data.get('budget_type') or adset_data.get('budgetType')

        if budget_type != 'CBO':
            # For ABO campaigns, budget is required at ad set level
            budget = adset_data.get('daily_budget') or adset_data.get('dailyBudget')
            if budget:
                params[AdSet.Field.daily_budget] = int(float(budget) * 100)
        # For CBO campaigns, don't set daily_budget - it's managed at campaign level

        # Handle start time
        if adset_data.get('start_time') or adset_data.get('startTime'):
            start_time = adset_data.get('start_time') or adset_data.get('startTime')
            params[AdSet.Field.start_time] = start_time

        # Handle bid strategy and bid amount
        # For CBO campaigns, bid_strategy is set at campaign level — do NOT set bid_strategy at ad set level
        # BUT: if the campaign's bid strategy is LOWEST_COST_WITH_BID_CAP / COST_CAP / TARGET_COST,
        # Facebook still requires bid_amount on each ad set (subcode 1815857).
        # For ABO campaigns, we can set bid_strategy at ad set level.
        bid_amount = adset_data.get('bid_amount') or adset_data.get('bidAmount')
        bid_strategy = adset_data.get('bid_strategy') or adset_data.get('bidStrategy')

        if budget_type == 'CBO':
            campaign_bid_strategy = None
            try:
                camp_id = adset_data.get('campaign_id')
                if camp_id:
                    camp = Campaign(camp_id, api=self.api).api_get(fields=[Campaign.Field.bid_strategy])
                    campaign_bid_strategy = camp.get(Campaign.Field.bid_strategy)
            except Exception as e:
                logger.warning(f"Could not fetch campaign bid_strategy for {adset_data.get('campaign_id')}: {e}")

            if campaign_bid_strategy in ('LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'TARGET_COST') and bid_amount:
                params[AdSet.Field.bid_amount] = int(float(bid_amount) * 100)
        else:
            if bid_amount:
                params[AdSet.Field.bid_amount] = int(float(bid_amount) * 100)
                if bid_strategy:
                    params[AdSet.Field.bid_strategy] = bid_strategy
            elif bid_strategy:
                params[AdSet.Field.bid_strategy] = bid_strategy
            else:
                params[AdSet.Field.bid_strategy] = 'LOWEST_COST_WITHOUT_CAP'

        return account.create_ad_set(params=params)

    def upload_image(self, image_path_or_url, ad_account_id=None):
        """Upload an image to the ad library."""
        import tempfile
        import requests

        account = self._get_account(ad_account_id)

        # Reject blob: URLs — these are browser-only and can't be read server-side
        if image_path_or_url.startswith('blob:'):
            raise Exception(f"Cannot upload blob URL server-side. The frontend must upload local files to R2 first. Got: {image_path_or_url[:80]}")

        # Resolve /uploads/... relative URLs to actual filesystem paths
        if image_path_or_url.startswith('/uploads/'):
            from pathlib import Path
            base_dir = Path(__file__).parent.parent.parent  # backend/
            image_path_or_url = str((base_dir / image_path_or_url.lstrip('/')).resolve())

        # Check if it's a URL or local file path
        if image_path_or_url.startswith('http://') or image_path_or_url.startswith('https://'):
            # Download the image to a temp file
            response = requests.get(image_path_or_url, timeout=30)
            response.raise_for_status()

            # Get file extension from URL or default to .jpg
            ext = '.jpg'
            if '.' in image_path_or_url.split('/')[-1]:
                ext = '.' + image_path_or_url.split('.')[-1].split('?')[0]

            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(response.content)
                local_path = tmp.name

            image = AdImage(parent_id=account.get_id_assured())
            image.api = self.api
            image[AdImage.Field.filename] = local_path
            image.remote_create()

            # Clean up temp file
            try:
                os.remove(local_path)
            except:
                pass

            return image[AdImage.Field.hash]
        else:
            # Local file path
            image = AdImage(parent_id=account.get_id_assured())
            image.api = self.api
            image[AdImage.Field.filename] = image_path_or_url
            image.remote_create()
            return image[AdImage.Field.hash]

    def upload_images(self, variant_urls, ad_account_id=None):
        """Upload multiple image variants to Facebook.

        Args:
            variant_urls: dict like {"1:1": "https://...", "9:16": "https://..."}
            ad_account_id: Optional ad account ID

        Returns:
            dict like {"1:1": "abc123hash", "9:16": "def456hash"}
        """
        result = {}
        for aspect_ratio, url in variant_urls.items():
            print(f"[upload_images] Uploading {aspect_ratio} variant: {url[:80]}...")
            image_hash = self.upload_image(url, ad_account_id)
            result[aspect_ratio] = image_hash
            print(f"[upload_images] {aspect_ratio} -> hash: {image_hash}")
        return result

    def upload_video(self, video_path_or_url, ad_account_id=None, wait_for_ready=True, timeout=600, page_id=None):
        """Upload a video so it can be used in an ad creative.

        CRITICAL: Uploads MUST go to /<page_id>/videos with a Page Access
        Token. Uploads to /<ad_account>/advideos with a System User token
        silently quarantine (FB accepts bytes but never advances the video
        past uploading_phase: in_progress). The Ads Manager UI also uploads
        through the page endpoint — this matches what FB actually expects.

        Args:
            video_path_or_url: Local file path or URL to video
            ad_account_id: Kept for signature compat; not used for upload
                           any more (page endpoint is account-agnostic). Was
                           previously used to upload to /act_X/advideos which
                           is the broken path.
            wait_for_ready: Whether to wait for video processing to complete
            timeout: Max seconds to wait for processing (default 10 min)
            page_id: Required. The page whose /videos endpoint receives the
                     upload. Must be a page the SU has admin rights on.

        Returns:
            dict with video_id, status, and thumbnails (if ready)
        """
        import tempfile
        import requests

        if not page_id:
            raise Exception(
                "upload_video requires page_id — uploads must go to /<page_id>/videos. "
                "Pass page_id from the campaign/creative config."
            )

        # Resolve the page access token up front. Cached per service class
        # so repeated uploads to the same page don't re-fetch.
        page_token = self.get_page_access_token(page_id)

        # Reject blob: URLs — these are browser-only and can't be read server-side
        if video_path_or_url.startswith('blob:'):
            raise Exception(f"Cannot upload blob URL server-side. The frontend must upload local files to R2 first. Got: {video_path_or_url[:80]}")

        is_https_url = video_path_or_url.startswith('https://')
        is_url = is_https_url or video_path_or_url.startswith('http://')
        local_path = None

        # HEAD probe to size-route: FB's file_url path may still time out
        # for very large videos because FB pulls bytes from the source URL
        # and our R2 public bucket throttles egress. Anything over
        # LARGE_VIDEO_THRESHOLD_BYTES goes straight to manual chunked upload
        # (backend pushes bytes to FB) — much more reliable for big files.
        skip_file_url = False
        if is_https_url:
            try:
                import requests as _req
                head = _req.head(video_path_or_url, timeout=15, allow_redirects=True)
                cl = head.headers.get('Content-Length')
                if cl and int(cl) > LARGE_VIDEO_THRESHOLD_BYTES:
                    print(f"[upload_video] Source is {int(cl)/1048576:.0f}MB > {LARGE_VIDEO_THRESHOLD_BYTES/1048576:.0f}MB, skipping file_url and going chunked")
                    skip_file_url = True
            except Exception as e:
                print(f"[upload_video] HEAD probe failed ({e}), trying file_url anyway")

        # Fast path: ask FB to pull the video directly from the public URL.
        # Skip if we don't have an https URL or if the file is large enough
        # that file_url has historically stalled.
        if is_https_url and not skip_file_url:
            try:
                video_id = self._upload_video_via_url(video_path_or_url, page_id, page_token)
                print(f"[upload_video] file_url path succeeded: video_id={video_id}")
            except Exception as e:
                print(f"[upload_video] file_url path failed ({e}), falling back to manual chunked upload")
                video_id = None
        else:
            video_id = None

        try:
            if video_id is None:
                # Slow path: download to tmp + manual chunked upload.
                if is_url:
                    print(f"Downloading video from URL: {video_path_or_url[:100]}...")
                    response = requests.get(video_path_or_url, timeout=120, stream=True)
                    response.raise_for_status()
                    ext = '.mp4'
                    if '.' in video_path_or_url.split('/')[-1]:
                        url_ext = video_path_or_url.split('.')[-1].split('?')[0].lower()
                        if url_ext in ['mp4', 'mov', 'avi', 'webm']:
                            ext = '.' + url_ext
                    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                        for chunk in response.iter_content(chunk_size=8192):
                            tmp.write(chunk)
                        local_path = tmp.name
                    print(f"Video downloaded to temp file: {local_path}")
                else:
                    local_path = video_path_or_url

                video_id = self._manual_chunked_upload(local_path, page_id, page_token)
                uploaded_via_chunked = True
            else:
                uploaded_via_chunked = False

            if wait_for_ready:
                # Stall detection only makes sense for the file_url path
                # (where FB has to pull bytes from a URL and can genuinely
                # stall). For chunked uploads we already pushed every byte,
                # so any "uploading / length=0" we see is just FB assembling
                # chunks and extracting metadata — not a stall.
                try:
                    status = self.wait_for_video_ready(
                        video_id, timeout=timeout,
                        detect_stall=not uploaded_via_chunked,
                    )
                except VideoUploadStalled as stall_err:
                    # file_url ingest is stuck — abandon this video object and
                    # redo via chunked upload (backend pushes bytes to FB).
                    print(f"[upload_video] {stall_err} — retrying via chunked upload")
                    if is_url and local_path is None:
                        print(f"Downloading video for chunked retry: {video_path_or_url[:100]}...")
                        response = requests.get(video_path_or_url, timeout=120, stream=True)
                        response.raise_for_status()
                        ext = '.mp4'
                        if '.' in video_path_or_url.split('/')[-1]:
                            url_ext = video_path_or_url.split('.')[-1].split('?')[0].lower()
                            if url_ext in ['mp4', 'mov', 'avi', 'webm']:
                                ext = '.' + url_ext
                        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                            for chunk in response.iter_content(chunk_size=8192):
                                tmp.write(chunk)
                            local_path = tmp.name
                        print(f"Video downloaded to temp file: {local_path}")
                    video_id = self._manual_chunked_upload(local_path, page_id, page_token)
                    status = self.wait_for_video_ready(
                        video_id, timeout=timeout, detect_stall=False,
                    )
            else:
                status = self.get_video_status(video_id)

            thumbnails = []
            if status.get('status') == 'ready':
                try:
                    thumbnails = self.get_video_thumbnails(video_id)
                except Exception as e:
                    print(f"Warning: Could not fetch thumbnails: {e}")

            return {
                'video_id': video_id,
                'status': status.get('status', 'processing'),
                'thumbnails': thumbnails
            }

        finally:
            if local_path and is_url:
                try:
                    os.remove(local_path)
                except Exception:
                    pass

    def _upload_video_via_url(self, file_url, page_id, page_token):
        """Use FB's file_url parameter to have FB pull the video directly.

        Uploads to /<page_id>/videos (NOT /<ad_account>/advideos — that
        endpoint silently quarantines uploads from SU tokens). Requires a
        Page Access Token; raise if caller didn't provide one.

        Returns the video_id. Raises on any error so caller can fall back
        to chunked upload.
        """
        import requests as req
        # Cheap HEAD probe: skip file_url path for huge files so we don't wait
        # 60s for FB to start the download just to be told the file is too big.
        try:
            head = req.head(file_url, timeout=15, allow_redirects=True)
            cl = head.headers.get('Content-Length')
            if cl and int(cl) > 1024 * 1024 * 1024:  # 1 GB
                raise Exception(f"file_url path skipped: video is {int(cl)/1048576:.0f}MB > 1GB FB limit")
        except req.exceptions.RequestException as e:
            # If HEAD fails, fall through and let FB try anyway
            print(f"[upload_video_via_url] HEAD probe failed (non-fatal): {e}")

        api_url = f"https://graph-video.facebook.com/v24.0/{page_id}/videos"
        print(f"[upload_video_via_url] Asking FB to pull from {file_url[:80]}... to /{page_id}/videos")
        resp = req.post(api_url, data={
            'access_token': page_token,
            'file_url': file_url,
            # Don't post to the page feed — we only want the video object
            # available for ad creatives, not visible on the page wall.
            'no_story': 'true',
            'published': 'false',
        }, timeout=120)
        try:
            data = resp.json()
        except Exception:
            raise Exception(f"file_url upload returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}")
        if 'error' in data:
            err = data['error']
            raise Exception(f"file_url upload error: {err.get('message', err)}")
        video_id = data.get('id') or data.get('video_id')
        if not video_id:
            raise Exception(f"file_url upload missing video_id in response: {data}")
        return video_id

    def _manual_chunked_upload(self, local_path, page_id, page_token, chunk_size=4 * 1024 * 1024):
        """Resumable chunked video upload to /<page_id>/videos.

        Uses FB's resumable upload protocol (start → transfer → finish)
        directly against the page endpoint with a Page Access Token. The
        SDK's AdVideo.remote_create points at /<ad_account>/advideos which
        FB silently quarantines — we cannot use it here.

        Validates the FB-required bits the hand-rolled code used to miss:
          - MIME 'multipart/form-data' on video_file_chunk (NOT octet-stream)
          - sends the full FB-offered window (no client-side chunk cap)
          - asserts success:true on finish phase
          - is_transient retry on chunk failures

        Args:
            local_path: filesystem path to the video file
            page_id: FB page ID — uploads go to /<page_id>/videos
            page_token: page access token (NOT system user token)
            chunk_size: unused; retained for signature stability

        Returns:
            video_id (str)
        """
        import requests as req

        file_size = os.path.getsize(local_path)
        api_url = f"https://graph-video.facebook.com/v24.0/{page_id}/videos"
        print(f"[manual_upload] File size: {file_size / (1024*1024):.1f}MB → /{page_id}/videos (chunked, page token)")

        # Phase 1: START
        start_resp = req.post(api_url, data={
            'access_token': page_token,
            'upload_phase': 'start',
            'file_size': file_size,
        }, timeout=120)
        start_data = start_resp.json()
        if 'error' in start_data:
            raise Exception(f"Video start phase failed: {start_data['error'].get('message', start_data['error'])}")

        session_id = start_data['upload_session_id']
        video_id = start_data['video_id']
        start_offset = int(start_data['start_offset'])
        end_offset = int(start_data['end_offset'])
        print(f"[manual_upload] Session started: video_id={video_id}, first chunk: {start_offset}-{end_offset}")

        # Phase 2: TRANSFER — send full FB-offered window per chunk (no client cap)
        chunks_sent = 0
        with open(local_path, 'rb') as f:
            while start_offset != end_offset:
                f.seek(start_offset)
                chunk_data = f.read(end_offset - start_offset)

                for attempt in range(5):
                    try:
                        transfer_resp = req.post(api_url, data={
                            'access_token': page_token,
                            'upload_phase': 'transfer',
                            'start_offset': start_offset,
                            'upload_session_id': session_id,
                        }, files={
                            # MIME must be multipart/form-data — anything else
                            # (e.g. octet-stream) and FB accepts the bytes
                            # but the assembled video silently quarantines.
                            'video_file_chunk': (
                                os.path.basename(local_path),
                                chunk_data,
                                'multipart/form-data',
                            ),
                        }, timeout=120)

                        try:
                            transfer_data = transfer_resp.json()
                        except Exception:
                            if attempt < 4:
                                print(f"[manual_upload] Empty/invalid response (HTTP {transfer_resp.status_code}), retry {attempt + 1}/5...")
                                time.sleep(3 * (attempt + 1))
                                continue
                            raise Exception(f"Video transfer failed at offset {start_offset}: empty response after 5 attempts (HTTP {transfer_resp.status_code})")

                        if 'error' in transfer_data:
                            error_info = transfer_data['error']
                            error_data = error_info.get('error_data', {})
                            if 'start_offset' in error_data:
                                start_offset = int(error_data['start_offset'])
                                end_offset = int(error_data['end_offset'])
                                print(f"[manual_upload] Server adjusted offsets: {start_offset}-{end_offset}")
                                f.seek(start_offset)
                                chunk_data = f.read(end_offset - start_offset)
                                continue
                            if error_info.get('is_transient') and attempt < 4:
                                print(f"[manual_upload] Transient error, retry {attempt + 1}/5...")
                                time.sleep(2 * (attempt + 1))
                                continue
                            raise Exception(f"Video transfer failed at offset {start_offset}: {error_info.get('message', error_info)}")

                        start_offset = int(transfer_data['start_offset'])
                        end_offset = int(transfer_data['end_offset'])
                        chunks_sent += 1
                        progress_pct = (start_offset / file_size * 100) if file_size > 0 else 0
                        if chunks_sent % 5 == 0:
                            print(f"[manual_upload] Progress: {progress_pct:.0f}% ({chunks_sent} chunks sent)")
                        break
                    except req.exceptions.Timeout:
                        if attempt < 4:
                            print(f"[manual_upload] Timeout on chunk at offset {start_offset}, retry {attempt + 1}/5...")
                            time.sleep(3 * (attempt + 1))
                            continue
                        raise Exception(f"Video upload timed out at offset {start_offset} after 5 attempts")

        print(f"[manual_upload] Transfer complete: {chunks_sent} chunks sent")

        # Phase 3: FINISH — verify {success: true} explicitly
        for attempt in range(3):
            finish_resp = req.post(api_url, data={
                'access_token': page_token,
                'upload_phase': 'finish',
                'upload_session_id': session_id,
                'title': os.path.basename(local_path),
                'no_story': 'true',
                'published': 'false',
            }, timeout=120)
            try:
                finish_data = finish_resp.json()
            except Exception:
                if attempt < 2:
                    print(f"[manual_upload] Finish phase non-JSON (HTTP {finish_resp.status_code}), retry {attempt + 1}/3...")
                    time.sleep(5 * (attempt + 1))
                    continue
                raise Exception(f"Video finish phase returned non-JSON (HTTP {finish_resp.status_code}): {finish_resp.text[:200]}")

            if 'error' in finish_data:
                error_info = finish_data['error']
                if error_info.get('is_transient') and attempt < 2:
                    print(f"[manual_upload] Finish phase transient error, retry {attempt + 1}/3...")
                    time.sleep(5 * (attempt + 1))
                    continue
                raise Exception(f"Video finish phase failed: {error_info.get('message', error_info)}")

            if not finish_data.get('success'):
                raise Exception(f"Video finish phase did not return success: {finish_data}")

            break

        print(f"[manual_upload] Upload finished successfully: video_id={video_id}")
        return video_id

    def _manual_chunked_upload_legacy(self, local_path, account_id, chunk_size=4 * 1024 * 1024):
        """Old hand-rolled implementation, kept only for reference / rollback."""
        import requests as req

        file_size = os.path.getsize(local_path)
        api_url = f"https://graph-video.facebook.com/v24.0/{account_id}/advideos"
        print(f"[manual_upload] File size: {file_size / (1024*1024):.1f}MB, chunk size: {chunk_size / (1024*1024):.0f}MB")

        # Phase 1: START
        start_resp = req.post(api_url, data={
            'access_token': self.access_token,
            'upload_phase': 'start',
            'file_size': file_size,
        }, timeout=120)
        start_data = start_resp.json()
        if 'error' in start_data:
            raise Exception(f"Video start phase failed: {start_data['error'].get('message', start_data['error'])}")

        session_id = start_data['upload_session_id']
        video_id = start_data['video_id']
        start_offset = int(start_data['start_offset'])
        end_offset = int(start_data['end_offset'])
        print(f"[manual_upload] Session started: video_id={video_id}, first chunk: {start_offset}-{end_offset}")

        # Phase 2: TRANSFER (small chunks)
        chunks_sent = 0
        with open(local_path, 'rb') as f:
            while start_offset != end_offset:
                f.seek(start_offset)
                # Use our smaller chunk size or the server's suggested size, whichever is smaller
                read_size = min(end_offset - start_offset, chunk_size)
                chunk_data = f.read(read_size)

                for attempt in range(5):
                    try:
                        transfer_resp = req.post(api_url, data={
                            'access_token': self.access_token,
                            'upload_phase': 'transfer',
                            'start_offset': start_offset,
                            'upload_session_id': session_id,
                        }, files={
                            'video_file_chunk': (os.path.basename(local_path), chunk_data, 'application/octet-stream'),
                        }, timeout=120)

                        # Handle empty/non-JSON responses (connection issues)
                        try:
                            transfer_data = transfer_resp.json()
                        except Exception:
                            if attempt < 4:
                                print(f"[manual_upload] Empty/invalid response (HTTP {transfer_resp.status_code}), retry {attempt + 1}/5...")
                                time.sleep(3 * (attempt + 1))
                                continue
                            raise Exception(f"Video transfer failed at offset {start_offset}: empty response after 5 attempts (HTTP {transfer_resp.status_code})")

                        if 'error' in transfer_data:
                            error_info = transfer_data['error']
                            error_data = error_info.get('error_data', {})
                            if 'start_offset' in error_data:
                                # Server wants us to retry with different offsets
                                start_offset = int(error_data['start_offset'])
                                end_offset = int(error_data['end_offset'])
                                print(f"[manual_upload] Server adjusted offsets: {start_offset}-{end_offset}")
                                f.seek(start_offset)
                                chunk_data = f.read(min(end_offset - start_offset, chunk_size))
                                continue
                            # "reduce the amount of data" — halve chunk size and retry
                            if 'reduce the amount of data' in error_info.get('message', '').lower():
                                chunk_size = max(chunk_size // 2, 256 * 1024)  # min 256KB
                                print(f"[manual_upload] Reducing chunk size to {chunk_size // 1024}KB and retrying...")
                                f.seek(start_offset)
                                chunk_data = f.read(min(end_offset - start_offset, chunk_size))
                                continue
                            if error_info.get('is_transient') and attempt < 4:
                                print(f"[manual_upload] Transient error, retry {attempt + 1}/5...")
                                time.sleep(2 * (attempt + 1))
                                continue
                            raise Exception(f"Video transfer failed at offset {start_offset}: {error_info.get('message', error_info)}")

                        start_offset = int(transfer_data['start_offset'])
                        end_offset = int(transfer_data['end_offset'])
                        chunks_sent += 1
                        progress_pct = (start_offset / file_size * 100) if file_size > 0 else 0
                        if chunks_sent % 5 == 0:
                            print(f"[manual_upload] Progress: {progress_pct:.0f}% ({chunks_sent} chunks sent)")
                        break
                    except req.exceptions.Timeout:
                        if attempt < 4:
                            print(f"[manual_upload] Timeout on chunk at offset {start_offset}, retry {attempt + 1}/5...")
                            time.sleep(3 * (attempt + 1))
                            continue
                        raise Exception(f"Video upload timed out at offset {start_offset} after 5 attempts")

        print(f"[manual_upload] Transfer complete: {chunks_sent} chunks sent")

        # Phase 3: FINISH (with retry — Facebook may take time to assemble chunks)
        for attempt in range(3):
            try:
                finish_resp = req.post(api_url, data={
                    'access_token': self.access_token,
                    'upload_phase': 'finish',
                    'upload_session_id': session_id,
                    'title': os.path.basename(local_path),
                }, timeout=120)
                finish_data = finish_resp.json()
                if 'error' in finish_data:
                    error_info = finish_data['error']
                    if error_info.get('is_transient') and attempt < 2:
                        print(f"[manual_upload] Finish phase transient error, retry {attempt + 1}/3...")
                        time.sleep(5 * (attempt + 1))
                        continue
                    raise Exception(f"Video finish phase failed: {error_info.get('message', error_info)}")
                break
            except req.exceptions.Timeout:
                if attempt < 2:
                    print(f"[manual_upload] Finish phase timeout, retry {attempt + 1}/3...")
                    time.sleep(5 * (attempt + 1))
                    continue
                raise Exception(f"Video finish phase timed out after 3 attempts")

        print(f"[manual_upload] Upload finished successfully: video_id={video_id}")
        return video_id

    def get_video_status(self, video_id):
        """Check the processing status of a video.

        Returns:
            dict with status ('processing', 'ready', 'error', or 'transient_error').
            Caller (wait_for_video_ready) treats 'transient_error' as retry-and-wait,
            never as a permanent failure. The bytes are already on FB at this point
            so any rate-limit on the status endpoint is recoverable.
        """
        import requests

        # FB rate limits and transient hiccups should not nuke an already-
        # uploaded video. Distinguish transient errors from real ones.
        TRANSIENT_CODES = {1, 2, 4, 17, 32, 341, 368, 613}  # incl. (#4) app rate limit

        url = f"https://graph.facebook.com/v21.0/{video_id}"
        params = {
            'fields': 'id,status,length,source',
            'access_token': self.access_token
        }

        try:
            response = requests.get(url, params=params, timeout=30)
        except requests.exceptions.RequestException as e:
            return {'status': 'transient_error', 'error': f"network: {e}", 'video_id': video_id}

        try:
            data = response.json()
        except ValueError:
            return {'status': 'transient_error', 'error': f"non-JSON HTTP {response.status_code}", 'video_id': video_id}

        if 'error' in data:
            err = data['error']
            code = err.get('code')
            is_transient = err.get('is_transient') or code in TRANSIENT_CODES
            return {
                'status': 'transient_error' if is_transient else 'error',
                'error': err.get('message', 'Unknown error'),
                'error_code': code,
                'video_id': video_id,
            }

        # Facebook video status can be: processing, ready, error
        fb_status = data.get('status', {})
        if isinstance(fb_status, dict):
            video_status = fb_status.get('video_status', 'processing').lower()
        else:
            video_status = str(fb_status).lower()

        return {
            'status': video_status,
            'video_id': video_id,
            'length': data.get('length'),
            'source': data.get('source')
        }

    def wait_for_video_ready(self, video_id, timeout=600, interval=10, stall_threshold=3, detect_stall=True):
        """Wait for video processing to complete.

        Stall detection only applies when bytes are still being ingested by
        FB (the file_url path, where FB pulls from a URL we gave it). For
        chunked uploads we already pushed every byte before this call, so
        `length=0` is just FB extracting metadata — pass detect_stall=False
        in that case.

        Transient errors on the status endpoint (FB app rate limit #4,
        network blips, non-JSON 5xx) are NOT permanent failures — the bytes
        are already on FB at this point and the video is processing or
        ready. Keep polling with exponential backoff; only give up if
        transient errors persist past the outer timeout.

        Args:
            video_id: Facebook video ID
            timeout: Max seconds to wait
            interval: Seconds between status checks
            stall_threshold: Consecutive 0-length polls before raising stall
            detect_stall: Enable VideoUploadStalled detection (file_url only)

        Returns:
            dict with final status
        """
        start_time = time.time()
        zero_length_polls = 0
        transient_streak = 0

        while (time.time() - start_time) < timeout:
            status = self.get_video_status(video_id)
            state = status.get('status')

            if state == 'transient_error':
                transient_streak += 1
                # Exponential backoff capped at 60s. FB's per-app rate-limit
                # window is rolling — even short sleeps usually clear it.
                backoff = min(interval * (2 ** min(transient_streak - 1, 5)), 60)
                print(f"Video {video_id} status: transient_error (#{status.get('error_code')}: {status.get('error')}) — retrying in {backoff}s [streak {transient_streak}]")
                time.sleep(backoff)
                continue

            length = status.get('length') or 0
            print(f"Video {video_id} status: {state} length={length}")
            transient_streak = 0

            if state == 'ready':
                return status
            elif state == 'error':
                raise Exception(f"Video processing failed: {status.get('error', 'Unknown error')}")

            if detect_stall and state == 'uploading' and length == 0:
                zero_length_polls += 1
                if zero_length_polls >= stall_threshold:
                    raise VideoUploadStalled(
                        f"Video {video_id} stalled: length=0 after {zero_length_polls} polls "
                        f"(~{zero_length_polls * interval}s) — FB ingest from URL not progressing"
                    )
            else:
                zero_length_polls = 0

            time.sleep(interval)

        raise Exception(f"Video processing timeout after {timeout} seconds")

    def get_video_thumbnails(self, video_id):
        """Get auto-generated thumbnails for a video.

        Returns:
            list of thumbnail URLs
        """
        import requests

        url = f"https://graph.facebook.com/v21.0/{video_id}/thumbnails"
        params = {
            'access_token': self.access_token
        }

        response = requests.get(url, params=params, timeout=30)
        data = response.json()

        if 'error' in data:
            print(f"Thumbnail fetch error: {data['error']}")
            return []

        thumbnails = []
        for thumb in data.get('data', []):
            if 'uri' in thumb:
                thumbnails.append(thumb['uri'])

        return thumbnails

    def extract_video_frames(self, video_path_or_url, video_id=None, n=12):
        """Extract N smart-picked frames from a video via ffmpeg + PIL scoring.

        Oversamples ~2.5x candidate frames, then scores each with PIL:
          - Brightness sweet spot (rejects black / blown-out frames)
          - Contrast (rejects flat / solid-color frames)
          - Edge density (sharpness proxy — rejects blurry frames)
        Dedupes frames within 2s of each other and returns the top N
        sorted chronologically so the picker shows them in video order.

        Accepts a local path, a /uploads/... relative URL, or an http(s) URL.
        Saves JPEGs to backend/uploads/thumbnails/<video_id>/frame_NN.jpg.

        Returns:
            list of relative URLs (e.g. '/uploads/thumbnails/abc/frame_01.jpg')
        """
        import hashlib
        import json as _json
        import subprocess
        import tempfile
        import uuid
        import requests
        from PIL import Image, ImageFilter, ImageStat

        cleanup_path = None
        if video_path_or_url.startswith('blob:'):
            raise Exception("Cannot extract frames from blob URL server-side. Upload to /uploads first.")
        if video_path_or_url.startswith('/uploads/'):
            base_dir = Path(__file__).parent.parent.parent  # backend/
            local_path = str((base_dir / video_path_or_url.lstrip('/')).resolve())
        elif video_path_or_url.startswith(('http://', 'https://')):
            response = requests.get(video_path_or_url, timeout=120, stream=True)
            response.raise_for_status()
            ext = '.mp4'
            last_seg = video_path_or_url.split('?')[0].rsplit('/', 1)[-1]
            if '.' in last_seg:
                candidate = '.' + last_seg.rsplit('.', 1)[-1].lower()
                if candidate in ('.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi'):
                    ext = candidate
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    tmp.write(chunk)
                local_path = tmp.name
                cleanup_path = local_path
        else:
            local_path = video_path_or_url

        def _score_frame(path):
            """Return (brightness, contrast, edge_density) or None on failure."""
            try:
                img = Image.open(path).convert('L')  # grayscale
                if max(img.size) > 640:
                    img.thumbnail((640, 640))
                stat = ImageStat.Stat(img)
                brightness = stat.mean[0]
                contrast = stat.stddev[0]
                edges = img.filter(ImageFilter.FIND_EDGES)
                edge_density = ImageStat.Stat(edges).stddev[0]
                return brightness, contrast, edge_density
            except Exception as e:
                print(f"[extract_video_frames] score failed for {path}: {e}")
                return None

        try:
            probe = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=nw=1:nk=1', local_path],
                capture_output=True, text=True, timeout=30,
            )
            try:
                duration = float(probe.stdout.strip())
            except ValueError:
                duration = 0.0
            if duration <= 0:
                raise Exception(f"Could not determine video duration (ffprobe returned: {probe.stderr[:200]})")

            # Derive a stable folder name from the video URL so a re-open of
            # the picker hits the same folder and its ai_scores.json cache.
            out_id = video_id or hashlib.md5(video_path_or_url.encode('utf-8')).hexdigest()[:16]
            base_dir = Path(__file__).parent.parent.parent  # backend/
            out_dir = base_dir / 'uploads' / 'thumbnails' / out_id
            out_dir.mkdir(parents=True, exist_ok=True)

            # Candidate timestamps = hook samples + evenly-spaced grid.
            #   - Hook samples target the first 3 seconds, where the video's
            #     hook/scroll-stopper usually lives.
            #   - Evenly-spaced grid covers the rest of the video, skipping
            #     the last 5% to dodge outro/end cards.
            #   PIL + Gemini filtering will drop any black intro frames
            #   naturally, so we don't need to skip the start.
            hook_timestamps = [0.4, 0.9, 1.5, 2.2, 3.0]
            hook_timestamps = [t for t in hook_timestamps if t < duration]

            grid_count = min(max(n, 8) * 3, 30) - len(hook_timestamps)
            margin_end = duration * 0.05
            grid_start = min(3.5, duration * 0.1)  # pick up where hooks leave off
            grid_end = max(grid_start + 1.0, duration - margin_end)
            grid_timestamps = [
                grid_start + ((grid_end - grid_start) * i / max(grid_count - 1, 1))
                for i in range(grid_count)
            ] if grid_count > 0 else []

            # Combine + dedupe near-duplicates (< 0.4s apart).
            all_timestamps = sorted(hook_timestamps + grid_timestamps)
            deduped = []
            for t in all_timestamps:
                if not deduped or (t - deduped[-1]) >= 0.4:
                    deduped.append(t)

            candidates = []  # list of (timestamp, filename, path)
            for i, t in enumerate(deduped):
                frame_filename = f'frame_{i+1:02d}.jpg'
                frame_path = out_dir / frame_filename
                subprocess.run(
                    ['ffmpeg', '-y', '-ss', f'{t:.3f}', '-i', local_path,
                     '-vframes', '1', '-q:v', '2', str(frame_path)],
                    capture_output=True, timeout=60,
                )
                if frame_path.exists() and frame_path.stat().st_size > 0:
                    candidates.append((t, frame_filename, frame_path))

            if not candidates:
                raise Exception("ffmpeg produced no frames")

            # Forced opening frames: the first ~0.5s of the video. These are
            # the clickbait/hook the user sees as they scroll — extracted
            # unconditionally and NOT put through PIL/Gemini filtering, since
            # rough title cards, white flashes, and black fade-ins are all
            # legitimate hook choices. They live in their own filename prefix
            # so they don't collide with frame_NN.jpg in the cache folder.
            opening_timestamps = [t for t in (0.0, 0.1, 0.25, 0.5) if t < duration]
            opening_urls = []
            for i, t in enumerate(opening_timestamps):
                opening_filename = f'opening_{i:02d}.jpg'
                opening_path = out_dir / opening_filename
                subprocess.run(
                    ['ffmpeg', '-y', '-ss', f'{t:.3f}', '-i', local_path,
                     '-vframes', '1', '-q:v', '2', str(opening_path)],
                    capture_output=True, timeout=60,
                )
                if opening_path.exists() and opening_path.stat().st_size > 0:
                    opening_urls.append(f'/uploads/thumbnails/{out_id}/{opening_filename}')

            # Score and filter candidates.
            scored = []
            for ts, filename, path in candidates:
                result = _score_frame(path)
                if result is None:
                    continue
                brightness, contrast, edge_density = result

                # Hard rejects
                if brightness < 15 or brightness > 240:
                    continue
                if contrast < 18:
                    continue

                # Brightness sweet-spot factor (peaks in 80-180, falls off outside)
                if 80 <= brightness <= 180:
                    brightness_factor = 1.0
                else:
                    dist = min(abs(brightness - 80), abs(brightness - 180))
                    brightness_factor = max(0.4, 1.0 - dist / 100)

                score = ((contrast * edge_density) ** 0.5) * brightness_factor
                scored.append((score, ts, filename, path))

            # Fallback: if scoring killed too many, use evenly-spaced candidates.
            if len(scored) < n:
                step = max(1, len(candidates) // n)
                picks = candidates[::step][:n]
                selected_filenames = {p[1] for p in picks}
                for ts, filename, path in candidates:
                    if filename not in selected_filenames:
                        try:
                            path.unlink()
                        except Exception:
                            pass
                return opening_urls + [f'/uploads/thumbnails/{out_id}/{p[1]}' for p in picks]

            scored.sort(reverse=True)  # highest PIL score first

            # Send top ~10 PIL survivors to Gemini Vision for ad-thumbnail scoring.
            # Per-video cache (ai_scores.json keyed by filename) means re-opening
            # the picker for the same video is free — no Gemini call needed.
            ai_candidates = scored[:10]
            ai_paths = [entry[3] for entry in ai_candidates]

            # v2: frame timestamps changed when hook sampling was added, so any
            # pre-existing ai_scores.json is stale (frame_01 used to be at 5%
            # margin, now it's at 0.4s). Different filename invalidates cleanly.
            cache_file = out_dir / 'ai_scores_v2.json'
            cached_scores = {}
            if cache_file.exists():
                try:
                    with open(cache_file, 'r') as f:
                        cached_scores = _json.load(f)
                except Exception as e:
                    print(f"[extract_video_frames] cache read failed: {e}")
                    cached_scores = {}

            ai_scores = {}
            missing_paths = []
            for path in ai_paths:
                filename = path.name
                if filename in cached_scores:
                    ai_scores[str(path)] = cached_scores[filename]
                else:
                    missing_paths.append(path)

            if missing_paths:
                try:
                    from app.services.thumbnail_scorer import score_thumbnails_with_ai
                    new_scores = score_thumbnails_with_ai(missing_paths)
                except Exception as e:
                    print(f"[extract_video_frames] AI scorer import/call failed: {e}")
                    new_scores = {}

                if new_scores:
                    for path_str, score in new_scores.items():
                        ai_scores[path_str] = score
                        cached_scores[Path(path_str).name] = score
                    try:
                        with open(cache_file, 'w') as f:
                            _json.dump(cached_scores, f)
                    except Exception as e:
                        print(f"[extract_video_frames] cache write failed: {e}")
            else:
                print(f"[extract_video_frames] AI cache hit: {len(ai_scores)} frames (0 Gemini calls)")

            if ai_scores:
                # Re-rank: AI score primary, PIL score tiebreaker.
                reranked = []
                for pil_score, ts, filename, path in scored:
                    ai = ai_scores.get(str(path))
                    # If this frame wasn't in the AI batch, use a neutral 5.0 so
                    # it ranks below AI-liked frames but above AI-disliked ones.
                    effective_ai = ai if ai is not None else 5.0
                    reranked.append((effective_ai, pil_score, ts, filename, path))
                reranked.sort(reverse=True)  # highest AI score first
                scored = [(r[0], r[2], r[3], r[4]) for r in reranked]

            # Pick top N, deduping any frames within 2 seconds of an already-selected one.
            selected = []
            for entry in scored:
                _, ts, _, _ = entry
                if any(abs(ts - s_ts) < 2.0 for _, s_ts, _, _ in selected):
                    continue
                selected.append(entry)
                if len(selected) >= n:
                    break

            # If dedup was too aggressive, top up with the next-best remaining.
            if len(selected) < n:
                chosen_ts = {s[1] for s in selected}
                for entry in scored:
                    if entry[1] not in chosen_ts:
                        selected.append(entry)
                        chosen_ts.add(entry[1])
                        if len(selected) >= n:
                            break

            # Sort chronologically for the picker grid.
            selected.sort(key=lambda x: x[1])

            # Clean up unselected candidates to save disk.
            # (ai_scores.json is not in `candidates`, so it's safe — won't be deleted.)
            selected_filenames = {s[2] for s in selected}
            for ts, filename, path in candidates:
                if filename not in selected_filenames:
                    try:
                        path.unlink()
                    except Exception:
                        pass

            return opening_urls + [f'/uploads/thumbnails/{out_id}/{s[2]}' for s in selected]
        finally:
            if cleanup_path:
                try:
                    os.remove(cleanup_path)
                except Exception:
                    pass

    def diagnose_permissions(self, page_id=None):
        """Diagnose token permissions, app status, and page access."""
        import requests

        results = {}

        # 1. Check app status (is it in dev mode?)
        if self.app_id:
            try:
                url = f"https://graph.facebook.com/v21.0/{self.app_id}"
                params = {'fields': 'id,name,status,link', 'access_token': self.access_token}
                resp = requests.get(url, params=params, timeout=15).json()
                results['app'] = resp
            except Exception as e:
                results['app'] = {'error': str(e)}

        # 2. Check token info (what app generated it, scopes, etc.)
        try:
            url = "https://graph.facebook.com/v21.0/debug_token"
            params = {'input_token': self.access_token, 'access_token': self.access_token}
            resp = requests.get(url, params=params, timeout=15).json()
            results['token_debug'] = resp.get('data', resp)
        except Exception as e:
            results['token_debug'] = {'error': str(e)}

        # 3. Check what pages the token can access
        try:
            url = "https://graph.facebook.com/v21.0/me/accounts"
            params = {'fields': 'id,name,access_token,tasks', 'access_token': self.access_token}
            resp = requests.get(url, params=params, timeout=15).json()
            pages = resp.get('data', [])
            results['pages'] = [
                {'id': p.get('id'), 'name': p.get('name'), 'tasks': p.get('tasks', [])}
                for p in pages
            ]
        except Exception as e:
            results['pages'] = {'error': str(e)}

        # 4. Check permissions granted to the token
        try:
            url = "https://graph.facebook.com/v21.0/me/permissions"
            params = {'access_token': self.access_token}
            resp = requests.get(url, params=params, timeout=15).json()
            results['permissions'] = resp.get('data', resp)
        except Exception as e:
            results['permissions'] = {'error': str(e)}

        # 5. Check who "me" is (user or system user)
        try:
            url = "https://graph.facebook.com/v21.0/me"
            params = {'fields': 'id,name', 'access_token': self.access_token}
            resp = requests.get(url, params=params, timeout=15).json()
            results['identity'] = resp
        except Exception as e:
            results['identity'] = {'error': str(e)}

        # 6. If a specific page_id was given, check access via /me/accounts results
        if page_id:
            # Check if page appears in the pages list (from /me/accounts)
            pages_list = results.get('pages', [])
            matched_page = None
            if isinstance(pages_list, list):
                matched_page = next((p for p in pages_list if p.get('id') == str(page_id)), None)

            if matched_page:
                tasks = matched_page.get('tasks', [])
                has_advertise = 'ADVERTISE' in tasks
                has_create = 'CREATE_CONTENT' in tasks
                has_manage = 'MANAGE' in tasks
                results['target_page'] = matched_page
                if has_advertise and has_create:
                    results['target_page_verdict'] = 'FULL ACCESS - page has ADVERTISE and CREATE_CONTENT tasks'
                else:
                    missing = []
                    if not has_advertise:
                        missing.append('ADVERTISE')
                    if not has_create:
                        missing.append('CREATE_CONTENT')
                    results['target_page_verdict'] = f'PARTIAL ACCESS - missing tasks: {", ".join(missing)}'
            else:
                # Page not in /me/accounts — try direct query as fallback
                try:
                    url = f"https://graph.facebook.com/v21.0/{page_id}"
                    params = {'fields': 'id,name', 'access_token': self.access_token}
                    resp = requests.get(url, params=params, timeout=15).json()
                    if 'error' in resp:
                        results['target_page'] = resp
                        results['target_page_verdict'] = 'NO ACCESS - token cannot read this page'
                    else:
                        results['target_page'] = resp
                        results['target_page_verdict'] = 'PARTIAL ACCESS - can read page but not listed in managed pages'
                except Exception as e:
                    results['target_page'] = {'error': str(e)}
                    results['target_page_verdict'] = 'NO ACCESS - failed to query page'

        return results

    # Mapping of aspect ratios to Facebook/Instagram placement positions
    ASPECT_RATIO_PLACEMENTS = {
        '1:1': {
            'facebook_positions': ['feed', 'marketplace', 'video_feeds', 'search'],
            'instagram_positions': ['stream', 'explore', 'explore_home'],
        },
        '9:16': {
            'facebook_positions': ['story', 'facebook_reels'],
            'instagram_positions': ['story', 'reels'],
        },
    }

    def _resolve_instagram_actor(self, creative_data, page_id, ad_account_id=None):
        """Resolve Instagram actor ID for the creative.

        Priority: explicit IG ID > ad account's connected IG accounts > Page's IG business account.
        Returns None if nothing found — ads still post, just with limited IG Stories rendering.
        """
        ig_actor = creative_data.get('instagram_actor_id') or creative_data.get('instagramId')
        if not ig_actor and page_id:
            ad_acct = self._get_account(ad_account_id)
            # Try 1: Ad account's connected Instagram accounts (most reliable)
            try:
                ig_accounts = ad_acct.get_instagram_accounts(fields=['id', 'username'])
                for acct in ig_accounts:
                    ig_actor = acct.get('id')
                    print(f"[create_creative] Found ad account IG: {ig_actor} ({acct.get('username', '?')})")
                    break
            except Exception as e:
                print(f"[create_creative] No ad account IG accounts: {e}")
            # Try 2: Page's connected Instagram Business Account
            if not ig_actor:
                try:
                    from facebook_business.adobjects.page import Page as FBPage
                    fb_page = FBPage(page_id, api=self.api)
                    page_data = fb_page.api_get(fields=['instagram_business_account'])
                    ig_account = page_data.get('instagram_business_account')
                    if ig_account:
                        ig_actor = ig_account.get('id') if isinstance(ig_account, dict) else str(ig_account)
                        print(f"[create_creative] Found Page IG business account: {ig_actor}")
                except Exception as e:
                    print(f"[create_creative] No Page IG business account: {e}")
            # Note: page-backed IG accounts (via /page_backed_instagram_accounts) are NOT
            # usable as instagram_actor_id for asset_feed_spec. Facebook rejects them.
            # A real Instagram Business/Creator account must be connected in Meta Business Suite.
            if not ig_actor:
                print(f"[create_creative] No Instagram account found — IG Stories may show limited preview")
        return ig_actor

    def _create_multi_image_creative(self, account, creative_data, image_hashes, page_id, website_url, ig_actor):
        """Create creative using asset_feed_spec with placement-specific images.

        Uses asset_customization_rules to map different aspect ratio images
        to different placements (e.g., 1:1 for Feed, 9:16 for Stories).
        """
        primary_text = creative_data.get('primary_text', '')
        headline = creative_data.get('headline', '')
        description = creative_data.get('description', '')
        cta = creative_data.get('cta', 'LEARN_MORE')
        has_ig = bool(ig_actor)

        # Build images array with ad labels + customization rules
        images = []
        asset_customization_rules = []
        default_ratio = '1:1' if '1:1' in image_hashes else list(image_hashes.keys())[0]

        for aspect_ratio, img_hash in image_hashes.items():
            label_name = f"label_{aspect_ratio.replace(':', 'x')}"

            images.append({
                'hash': img_hash,
                'adlabels': [{'name': label_name}],
            })

            placement_spec = self.ASPECT_RATIO_PLACEMENTS.get(aspect_ratio)
            if placement_spec:
                customization = {}
                publisher_platforms = ['facebook']
                customization['facebook_positions'] = placement_spec['facebook_positions']
                if has_ig and placement_spec.get('instagram_positions'):
                    publisher_platforms.append('instagram')
                    customization['instagram_positions'] = placement_spec['instagram_positions']
                customization['publisher_platforms'] = publisher_platforms
                rule = {
                    'image_label': {'name': label_name},
                    'customization_spec': customization,
                }
                asset_customization_rules.append(rule)
            else:
                print(f"[create_creative] No placement mapping for aspect ratio {aspect_ratio}, skipping rule")

        if not has_ig:
            print(f"[create_creative] No Instagram account — excluding IG positions from asset_customization_rules")

        # Facebook requires a default fallback rule with empty customization_spec (lowest priority, last in list)
        default_label = f"label_{default_ratio.replace(':', 'x')}"
        asset_customization_rules.append({
            'image_label': {'name': default_label},
            'customization_spec': {},
            'is_default': True,
        })

        asset_feed_spec = {
            'images': images,
            'bodies': [{'text': primary_text}],
            'titles': [{'text': headline}],
            'link_urls': [{'website_url': website_url}],
            'call_to_action_types': [cta],
            'ad_formats': ['SINGLE_IMAGE'],
            'asset_customization_rules': asset_customization_rules,
        }
        if description:
            asset_feed_spec['descriptions'] = [{'text': description}]

        object_story_spec = {'page_id': page_id}
        if ig_actor:
            object_story_spec['instagram_actor_id'] = ig_actor

        creative_name = creative_data.get('name') or creative_data.get('headline') or 'Ad Creative'
        if len(creative_name) > 990:
            creative_name = creative_name[:990] + '...'
        params = {
            AdCreative.Field.name: creative_name,
            AdCreative.Field.asset_feed_spec: asset_feed_spec,
            AdCreative.Field.object_story_spec: object_story_spec,
        }

        print(f"[create_creative] Using asset_feed_spec with {len(images)} image variants: {list(image_hashes.keys())}")
        return account.create_ad_creative(params=params)

    def create_creative(self, creative_data, ad_account_id=None):
        """Create an ad creative (supports single image, multi-image placement, and video)."""
        account = self._get_account(ad_account_id)

        page_id = creative_data.get('page_id')
        image_hash = creative_data.get('image_hash')
        image_hashes = creative_data.get('image_hashes')  # {"1:1": "hash1", "9:16": "hash2"}
        video_id = creative_data.get('video_id')
        website_url = creative_data.get('website_url')

        no_link = creative_data.get('no_link', False)

        # Validate required fields
        if not page_id:
            raise ValueError("page_id is required to create a creative")
        if not website_url and not no_link:
            raise ValueError("website_url is required to create a creative")
        if not video_id and not image_hash and not image_hashes:
            raise ValueError("Either video_id, image_hash, or image_hashes is required")

        print(f"[create_creative] video_id={video_id}, image_hash={image_hash}, image_hashes={image_hashes}, page_id={page_id}, url={website_url}")

        # Resolve Instagram actor ID
        ig_actor = self._resolve_instagram_actor(creative_data, page_id, ad_account_id)

        # Multi-image placement customization path (requires IG actor for Instagram placements)
        if image_hashes and len(image_hashes) > 1:
            if ig_actor:
                return self._create_multi_image_creative(
                    account, creative_data, image_hashes, page_id, website_url, ig_actor
                )
            else:
                # Fall back to single-image with degrees_of_freedom_spec (auto-crop)
                # Multi-image requires a connected Instagram account
                default_ratio = '1:1' if '1:1' in image_hashes else list(image_hashes.keys())[0]
                image_hash = image_hashes[default_ratio]
                print(f"[create_creative] No IG actor — falling back to single-image ({default_ratio}, hash={image_hash}). Connect Instagram to Page for multi-image placement support.")

        # Determine if this is a video, image-link, or simple photo creative
        if no_link and image_hash:
            # Simple photo post — no link, no CTA, no pixel required
            object_story_spec = {
                'page_id': page_id,
                'photo_data': {
                    'image_hash': image_hash,
                    'caption': creative_data.get('primary_text', ''),
                }
            }
        elif video_id:
            # Video creative
            video_data_spec = {
                'video_id': video_id,
                'message': creative_data.get('primary_text', ''),
                'title': creative_data.get('headline', ''),
                'call_to_action': {
                    'type': creative_data.get('cta', 'LEARN_MORE'),
                    'value': {
                        'link': website_url
                    }
                }
            }

            # Add description if provided
            if creative_data.get('description'):
                video_data_spec['link_description'] = creative_data['description']

            object_story_spec = {
                'page_id': page_id,
                'video_data': video_data_spec
            }

            # Add custom thumbnail if provided.
            # Precedence: image_hash > local /uploads/ URL (converted to hash) > external URL.
            thumb_hash = creative_data.get('thumbnail_image_hash')
            thumb_url = creative_data.get('thumbnail_url')
            if not thumb_hash and thumb_url and thumb_url.startswith('/uploads/'):
                # FB can't fetch server-local URLs — pre-upload and convert to hash.
                try:
                    thumb_hash = self.upload_image(thumb_url, ad_account_id)
                    print(f"[create_creative] Local thumbnail converted to image_hash: {thumb_hash}")
                except Exception as e:
                    print(f"[create_creative] Failed to convert local thumbnail to hash: {e}")
            if thumb_hash:
                object_story_spec['video_data']['image_hash'] = thumb_hash
            elif thumb_url:
                object_story_spec['video_data']['image_url'] = thumb_url
        else:
            # Single image creative
            headline = creative_data.get('headline') or ''
            if len(headline) > 250:
                headline = headline[:250] + '...'
            description = creative_data.get('description') or ''
            if len(description) > 250:
                description = description[:250] + '...'
            object_story_spec = {
                'page_id': page_id,
                'link_data': {
                    'image_hash': image_hash,
                    'link': creative_data.get('website_url'),
                    'message': creative_data.get('primary_text'),
                    'name': headline,
                    'description': description,
                    'call_to_action': {
                        'type': creative_data.get('cta', 'LEARN_MORE'),
                        'value': {
                            'link': creative_data.get('website_url')
                        }
                    }
                }
            }

        if ig_actor:
            object_story_spec['instagram_actor_id'] = ig_actor

        creative_name = creative_data.get('name') or creative_data.get('headline') or 'Ad Creative'
        if len(creative_name) > 990:
            creative_name = creative_name[:990] + '...'
        params = {
            AdCreative.Field.name: creative_name,
            AdCreative.Field.object_story_spec: object_story_spec,
        }

        # Enable image/video auto-crop + uncrop so FB properly handles different placements
        # (Feed 1.91:1, Stories 9:16, Explore 1:1, etc.) instead of showing blank.
        if image_hash:
            params['degrees_of_freedom_spec'] = {
                'creative_features_spec': {
                    'image_auto_crop': {
                        'enroll_status': 'OPT_IN'
                    },
                    'image_uncrop': {
                        'enroll_status': 'OPT_IN'
                    },
                }
            }
        elif video_id:
            params['degrees_of_freedom_spec'] = {
                'creative_features_spec': {
                    'video_auto_crop': {
                        'enroll_status': 'OPT_IN'
                    },
                }
            }

        return account.create_ad_creative(params=params)

    def create_ad(self, ad_data, ad_account_id=None):
        """Create an ad."""
        account = self._get_account(ad_account_id)

        params = {
            Ad.Field.name: ad_data.get('name'),
            Ad.Field.adset_id: ad_data.get('adset_id'),
            Ad.Field.creative: {'creative_id': ad_data.get('creative_id')},
            Ad.Field.status: ad_data.get('status', 'ACTIVE'),  # Changed from PAUSED to ACTIVE
        }

        return account.create_ad(params=params)

    def create_creative_from_post(self, post_id, page_id=None, name=None, ad_account_id=None):
        """Create an ad creative that references an existing page post.

        Using object_story_id (format: '<page_id>_<post_id>') makes the new ad inherit
        all engagement (likes, comments, shares) from the existing post.

        post_id can be either the full 'pageId_postId' or just the postId (page_id required in that case).
        """
        account = self._get_account(ad_account_id)

        if '_' not in post_id:
            if not page_id:
                raise ValueError("page_id is required when post_id is not in 'pageId_postId' format")
            object_story_id = f"{page_id}_{post_id}"
        else:
            object_story_id = post_id

        params = {
            AdCreative.Field.name: (name or f'Existing Post {object_story_id}')[:990],
            AdCreative.Field.object_story_id: object_story_id,
        }
        return account.create_ad_creative(params=params)

    def quick_create_ad(self, adset_id, creative_data, ad_account_id=None):
        """Create a creative + ad in one shot. For quick ad creation from the reporting page.

        creative_data: { page_id, image_url OR video_id, primary_text, headline, description, cta, website_url, name }
        OR for existing posts: { existing_post_id, page_id (optional if post_id has '_'), name }
        """
        # Existing post path: skip upload + creative composition, just reference the post
        existing_post_id = creative_data.get('existing_post_id')
        if existing_post_id:
            creative_result = self.create_creative_from_post(
                post_id=existing_post_id,
                page_id=creative_data.get('page_id'),
                name=creative_data.get('name'),
                ad_account_id=ad_account_id,
            )
            creative_id = dict(creative_result).get('id') or str(creative_result)
            ad_name = creative_data.get('name') or f'Existing Post Ad {existing_post_id}'
            ad_result = self.create_ad({
                'name': ad_name,
                'adset_id': adset_id,
                'creative_id': creative_id,
                'status': 'ACTIVE',
            }, ad_account_id)
            return {
                'creative_id': creative_id,
                'ad_id': dict(ad_result).get('id', str(ad_result)),
                'name': ad_name,
                'status': 'ACTIVE',
                'from_existing_post': existing_post_id,
            }

        # Step 1: Upload image if it's a URL (get image_hash)
        image_hash = creative_data.get('image_hash')
        if not image_hash and creative_data.get('image_url') and not creative_data.get('video_id'):
            uploaded = self.upload_image(creative_data['image_url'], ad_account_id)
            if isinstance(uploaded, str):
                image_hash = uploaded
            elif isinstance(uploaded, dict):
                image_hash = uploaded.get('hash') or uploaded.get('image_hash')
                if not image_hash:
                    for key, val in uploaded.items():
                        if isinstance(val, dict) and 'hash' in val:
                            image_hash = val['hash']
                            break

        # Step 2: Create the creative
        creative_result = self.create_creative({
            **creative_data,
            'image_hash': image_hash,
        }, ad_account_id)

        creative_id = creative_result.get('id') or (dict(creative_result).get('id') if hasattr(creative_result, '__iter__') else None)
        if not creative_id:
            creative_id = str(creative_result)

        # Step 3: Create the ad
        ad_name = creative_data.get('name') or creative_data.get('headline') or 'New Ad'
        ad_result = self.create_ad({
            'name': ad_name,
            'adset_id': adset_id,
            'creative_id': creative_id,
            'status': 'ACTIVE',
        }, ad_account_id)

        return {
            'creative_id': creative_id,
            'ad_id': dict(ad_result).get('id', str(ad_result)),
            'name': ad_name,
            'status': 'ACTIVE',
        }

    def post_first_comment(self, ad_id: str, message: str, ad_account_id=None):
        """Post a first comment on an ad's post as the Page.

        1. Get the ad's effective_object_story_id (pageId_postId)
        2. POST /{story_id}/comments with the message
        """
        from facebook_business.adobjects.ad import Ad as AdObj
        import requests

        ad = AdObj(ad_id)
        ad_data = ad.api_get(fields=['creative{effective_object_story_id}'])
        creative = ad_data.get('creative', {})
        story_id = creative.get('effective_object_story_id')
        if not story_id:
            raise ValueError(f"No story ID found for ad {ad_id} — ad may not be published yet")

        # Extract page ID from story_id (format: pageId_postId)
        page_id = story_id.split('_')[0]
        page_token = self.get_page_access_token(page_id)

        # Post comment using page access token so it's publicly visible
        resp = requests.post(
            f"https://graph.facebook.com/{self.api_version}/{story_id}/comments",
            data={
                'message': message,
                'access_token': page_token,
            }
        )
        resp.raise_for_status()
        return resp.json()

    def get_page_access_token(self, page_id: str) -> str:
        """Get a page access token for publishing."""
        import requests
        resp = requests.get(
            f"https://graph.facebook.com/{self.api_version}/{page_id}",
            params={'fields': 'access_token,name', 'access_token': self.access_token}
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get('access_token')
        if not token:
            raise ValueError(f"No access token returned for page {page_id}. Ensure the system user has manage_pages permission.")
        return token

    def publish_page_post(self, page_id: str, message: str, image_url: str = None, link: str = None) -> dict:
        """Publish an organic post to a Facebook Page."""
        import requests
        page_token = self.get_page_access_token(page_id)

        if image_url:
            # Photo post
            resp = requests.post(
                f"https://graph.facebook.com/{self.api_version}/{page_id}/photos",
                data={
                    'message': message,
                    'url': image_url,
                    'access_token': page_token,
                }
            )
        elif link:
            # Link share post
            resp = requests.post(
                f"https://graph.facebook.com/{self.api_version}/{page_id}/feed",
                data={
                    'message': message,
                    'link': link,
                    'access_token': page_token,
                }
            )
        else:
            # Text-only post
            resp = requests.post(
                f"https://graph.facebook.com/{self.api_version}/{page_id}/feed",
                data={
                    'message': message,
                    'access_token': page_token,
                }
            )
        resp.raise_for_status()
        return resp.json()

    def get_page_posts(self, page_id: str, limit: int = 10) -> list:
        """Fetch recent posts from a Facebook Page."""
        import requests
        page_token = self.get_page_access_token(page_id)
        resp = requests.get(
            f"https://graph.facebook.com/{self.api_version}/{page_id}/posts",
            params={
                'fields': 'id,message,created_time,permalink_url,type,full_picture,shares',
                'limit': min(limit, 25),
                'access_token': page_token,
            }
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get('data', [])

    def get_post_preview(self, post_id, page_id=None):
        """Fetch a single post's preview info (image, message, type, permalink).

        post_id may be 'pageId_postId' or just 'postId'. If only 'postId' is provided,
        page_id is required to look up the page access token.

        Falls back to a slim field set when the full query 400s — dark/unpublished
        page posts (typical `122xxxxx` IDs) reject content fields like message/
        full_picture/permalink_url but can still be referenced by ads. We return
        whatever Graph will give us and flag is_dark_post=True so the UI can show
        a placeholder while the post ID still works for ad creation.
        """
        import requests
        if '_' in post_id:
            inferred_page_id, raw_post_id = post_id.split('_', 1)
            target_page_id = page_id or inferred_page_id
            full_post_id = post_id
        else:
            if not page_id:
                raise ValueError("page_id is required when post_id is not in 'pageId_postId' format")
            target_page_id = page_id
            raw_post_id = post_id
            full_post_id = f"{page_id}_{post_id}"

        page_token = self.get_page_access_token(target_page_id)
        url = f"https://graph.facebook.com/{self.api_version}/{full_post_id}"

        full_fields = 'id,message,full_picture,picture,permalink_url,type,attachments{media,media_type,subattachments}'
        resp = requests.get(url, params={'fields': full_fields, 'access_token': page_token})
        if resp.ok:
            return resp.json()

        slim_fields = 'id,created_time,attachments{media,media_type,subattachments}'
        slim_resp = requests.get(url, params={'fields': slim_fields, 'access_token': page_token})
        if slim_resp.ok:
            data = slim_resp.json()
            data['is_dark_post'] = True
            data['preview_note'] = "Dark/unpublished post — content fields unavailable, but post ID is valid for ad creation."
            return data

        id_resp = requests.get(url, params={'fields': 'id', 'access_token': page_token})
        if id_resp.ok:
            return {
                'id': id_resp.json().get('id', full_post_id),
                'is_dark_post': True,
                'preview_note': "Dark/unpublished post — preview unavailable, but post ID is valid for ad creation.",
            }

        resp.raise_for_status()
        return resp.json()

    def comment_on_page_post(self, page_id: str, post_id: str, message: str) -> dict:
        """Post a comment on a page post as the Page."""
        import requests
        page_token = self.get_page_access_token(page_id)
        resp = requests.post(
            f"https://graph.facebook.com/{self.api_version}/{post_id}/comments",
            data={'message': message, 'access_token': page_token}
        )
        resp.raise_for_status()
        return resp.json()

    def comment_as_page(self, post_id: str, message: str, page_access_token: str,
                        attachment_url: str = None) -> dict:
        """Post a comment on a post using a specific page access token.
        Used by comment farm to comment from different persona pages.
        """
        import requests
        data = {'message': message, 'access_token': page_access_token}
        if attachment_url:
            data['attachment_url'] = attachment_url
        resp = requests.post(
            f"https://graph.facebook.com/{self.api_version}/{post_id}/comments",
            data=data
        )
        resp.raise_for_status()
        return resp.json()

    def reply_to_comment(self, comment_id: str, message: str, page_access_token: str,
                         attachment_url: str = None) -> dict:
        """Reply to an existing comment (nested reply)."""
        import requests
        data = {'message': message, 'access_token': page_access_token}
        if attachment_url:
            data['attachment_url'] = attachment_url
        resp = requests.post(
            f"https://graph.facebook.com/{self.api_version}/{comment_id}/comments",
            data=data
        )
        resp.raise_for_status()
        return resp.json()

    def react_to_comment(self, comment_id: str, reaction_type: str,
                         page_access_token: str) -> dict:
        """React to a comment (LIKE, LOVE, WOW, HAHA, etc)."""
        import requests
        resp = requests.post(
            f"https://graph.facebook.com/{self.api_version}/{comment_id}/reactions",
            data={'type': reaction_type, 'access_token': page_access_token}
        )
        resp.raise_for_status()
        return resp.json()

    def get_page_token_for_persona(self, persona_page_id: str,
                                   persona_page_token: str = None) -> str:
        """Get a usable page access token for a persona's FB page.
        Uses the stored persona token if available, otherwise fetches via user token.
        """
        if persona_page_token:
            return persona_page_token
        return self.get_page_access_token(persona_page_id)

    def search_locations(self, query, location_type='city', limit=10, ad_account_id=None):
        """Search for targeting geo locations.

        Calls the Graph API /search?type=adgeolocation endpoint directly
        because AdAccount.get_targeting_search() hits /targetingsearch,
        which is for interests/behaviors/employers and silently drops
        type=adgeolocation, returning interest results for geo queries.

        location_type may be a single string ('city') or a list
        (['country','region','city','geo_market']).
        """
        # Ensure account is initialised so the global FacebookAdsApi is set up
        self._get_account(ad_account_id)

        if isinstance(location_type, str):
            location_types = [location_type]
        else:
            location_types = list(location_type)

        from facebook_business.api import FacebookAdsApi
        api = FacebookAdsApi.get_default_api()
        response = api.call(
            'GET',
            ('search',),
            params={
                'type': 'adgeolocation',
                'q': query,
                'location_types': json.dumps(location_types),
                'limit': limit,
            },
        )
        data = response.json().get('data', []) if hasattr(response, 'json') else []
        return data

    # ── Insights / Campaign Browser ──────────────────────────────────

    def _default_time_range(self):
        """Return last 7 days as {since, until} dict in US Eastern time."""
        from datetime import datetime, timedelta, timezone
        # Use US Eastern (UTC-5, or UTC-4 during DST)
        try:
            from zoneinfo import ZoneInfo
            eastern = ZoneInfo('America/New_York')
        except ImportError:
            # Fallback for older Python
            eastern = timezone(timedelta(hours=-5))
        now = datetime.now(eastern)
        today = now.strftime('%Y-%m-%d')
        week_ago = (now - timedelta(days=7)).strftime('%Y-%m-%d')
        return {'since': week_ago, 'until': today}

    @fb_retry()
    def get_account_insights(self, ad_account_id=None, time_range=None, level='campaign'):
        """
        Fetch insights at a given level (campaign/adset/ad) for the whole account.
        Returns a list of dicts with object ID + performance metrics.
        One API call regardless of how many campaigns exist.
        """
        account = self._get_account(ad_account_id)
        tr = time_range or self._default_time_range()

        fields = [
            'campaign_id', 'campaign_name',
            'adset_id', 'adset_name',
            'ad_id', 'ad_name',
            'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm',
            'reach', 'actions', 'cost_per_action_type', 'action_values',
        ]

        params = {
            'time_range': tr,
            'level': level,
            'filtering': [
                {'field': 'campaign.effective_status', 'operator': 'IN', 'value': ['ACTIVE', 'PAUSED']},
            ],
        }

        cursor = account.get_insights(fields=fields, params=params)
        results = []
        for row in cursor:
            d = dict(row)
            d['results'] = _extract_results(d.get('actions'))
            d['purchase_revenue'] = _extract_purchase_revenue(d.get('action_values'))
            results.append(d)
        return results

    def get_daily_insights(self, ad_account_id=None, time_range=None, campaign_ids=None):
        """
        Fetch daily aggregate insights for an ad account.
        Returns a list of { date, spend, impressions, clicks, results } per day.
        If campaign_ids is provided, only include data from those campaigns.
        """
        account = self._get_account(ad_account_id)
        tr = time_range or self._default_time_range()

        fields = [
            'spend', 'impressions', 'clicks', 'reach', 'actions',
        ]
        params = {
            'time_range': tr,
            'time_increment': 1,  # daily breakdown
        }

        # When filtering by brand, use campaign-level daily data and filter
        if campaign_ids is not None:
            params['level'] = 'campaign'
            params['filtering'] = [
                {'field': 'campaign.id', 'operator': 'IN', 'value': campaign_ids}
            ]
            cursor = account.get_insights(fields=['campaign_id'] + fields, params=params)

            # Aggregate per day across matching campaigns
            daily_map = {}
            for row in cursor:
                d = dict(row)
                date = d.get('date_start', '')
                if date not in daily_map:
                    daily_map[date] = {'date': date, 'spend': 0, 'impressions': 0, 'clicks': 0, 'reach': 0, 'results': 0}
                daily_map[date]['spend'] += float(d.get('spend', 0))
                daily_map[date]['impressions'] += int(d.get('impressions', 0))
                daily_map[date]['clicks'] += int(d.get('clicks', 0))
                daily_map[date]['reach'] += int(d.get('reach', 0))
                for action in (d.get('actions') or []):
                    if action.get('action_type') in ('offsite_conversion.fb_pixel_purchase', 'purchase'):
                        daily_map[date]['results'] += int(action.get('value', 0))

            return sorted(daily_map.values(), key=lambda x: x['date'])

        cursor = account.get_insights(fields=fields, params=params)
        results = []
        for row in cursor:
            d = dict(row)
            # Extract purchase/conversion results
            result_count = 0
            for action in (d.get('actions') or []):
                if action.get('action_type') in ('offsite_conversion.fb_pixel_purchase', 'purchase'):
                    result_count += int(action.get('value', 0))
            results.append({
                'date': d.get('date_start', ''),
                'spend': float(d.get('spend', 0)),
                'impressions': int(d.get('impressions', 0)),
                'clicks': int(d.get('clicks', 0)),
                'reach': int(d.get('reach', 0)),
                'results': result_count,
            })
        return results

    @fb_retry()
    def get_disapproved_ads(self, ad_account_id=None):
        """
        Fetch ads with DISAPPROVED status for an ad account.
        Only targets fully rejected ads, not WITH_ISSUES (still delivering).
        Includes page_id from creative so safe-ad swap can work.
        """
        account = self._get_account(ad_account_id)

        fields = [
            Ad.Field.id,
            Ad.Field.name,
            Ad.Field.effective_status,
            Ad.Field.ad_review_feedback,
            Ad.Field.creative,
        ]
        params = {
            'filtering': [
                {'field': 'effective_status', 'operator': 'IN',
                 'value': ['DISAPPROVED']},
            ],
            'limit': 100,
        }

        ads_raw = account.get_ads(fields=fields, params=params)
        results = []
        for ad in ads_raw:
            ad_dict = dict(ad)
            feedback = ad_dict.get('ad_review_feedback', {})
            # Extract rejection reasons
            reasons = []
            if isinstance(feedback, dict):
                global_reasons = feedback.get('global', {})
                if isinstance(global_reasons, dict):
                    for key, val in global_reasons.items():
                        if isinstance(val, str):
                            reasons.append(val)
                        elif isinstance(val, list):
                            reasons.extend(val)

            # Extract page_id from creative's object_story_spec
            page_id = None
            creative_ref = ad_dict.get('creative', {})
            creative_id = creative_ref.get('id') if isinstance(creative_ref, dict) else None
            if creative_id:
                try:
                    creative_obj = AdCreative(creative_id)
                    creative_obj.api = self.api
                    creative_data = creative_obj.api_get(fields=['object_story_spec', 'effective_object_story_id'])
                    oss = creative_data.get('object_story_spec', {})
                    page_id = oss.get('page_id')
                    if not page_id:
                        # Try from effective_object_story_id (format: pageId_postId)
                        eosi = creative_data.get('effective_object_story_id', '')
                        if '_' in str(eosi):
                            page_id = str(eosi).split('_')[0]
                except Exception as e:
                    logger.warning(f"Failed to get page_id for ad {ad_dict.get('id')}: {e}")

            results.append({
                'ad_id': ad_dict.get('id'),
                'ad_name': ad_dict.get('name', 'Unknown'),
                'status': ad_dict.get('effective_status'),
                'reasons': reasons,
                'page_id': page_id,
            })

        # Backfill missing page_ids from other ads (all from same account/page)
        known_page_id = next((r['page_id'] for r in results if r['page_id']), None)
        if not known_page_id and results:
            # No page_id from any rejected ad — try getting from account's pages
            try:
                pages = self.get_pages(ad_account_id)
                if pages:
                    known_page_id = pages[0].get('id')
            except Exception:
                pass
        if known_page_id:
            for r in results:
                if not r['page_id']:
                    r['page_id'] = known_page_id

        return results

    @fb_retry()
    def get_campaigns_with_insights(self, ad_account_id=None, time_range=None, campaign_ids=None):
        """
        Return campaigns list merged with their insights.
        Two calls: one for campaign objects (status, objective, budget), one for insights.
        If campaign_ids is provided, only return campaigns matching those Facebook IDs.
        """
        account = self._get_account(ad_account_id)
        tr = time_range or self._default_time_range()

        # 1) Campaign objects
        campaign_fields = [
            Campaign.Field.id,
            Campaign.Field.name,
            Campaign.Field.status,
            Campaign.Field.effective_status,
            Campaign.Field.objective,
            Campaign.Field.daily_budget,
            Campaign.Field.lifetime_budget,
            Campaign.Field.bid_strategy,
            Campaign.Field.bid_amount,
            Campaign.Field.buying_type,
            Campaign.Field.special_ad_categories,
            Campaign.Field.start_time,
            Campaign.Field.stop_time,
        ]
        campaigns_raw = account.get_campaigns(
            fields=campaign_fields,
            params={
                'filtering': [
                    {'field': 'effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'CREDIT_CARD_NEEDED', 'PREAPPROVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED']},
                ],
                'limit': 200,
            }
        )
        campaigns = {c['id']: dict(c) for c in campaigns_raw}

        # Filter to specific campaign IDs if provided (brand filtering)
        if campaign_ids is not None:
            campaign_id_set = set(campaign_ids)
            campaigns = {cid: c for cid, c in campaigns.items() if cid in campaign_id_set}

        # 2) Insights at campaign level
        insights = self.get_account_insights(ad_account_id, tr, level='campaign')
        insights_map = {row['campaign_id']: row for row in insights}

        # 3) Merge
        result = []
        for cid, camp in campaigns.items():
            ins = insights_map.get(cid, {})
            result.append({**camp, 'insights': ins})

        return result

    @fb_retry()
    def get_adsets_with_insights(self, campaign_id, ad_account_id=None, time_range=None):
        """
        Return ad sets for a campaign, merged with insights.
        """
        from facebook_business.adobjects.campaign import Campaign as CampaignObj
        tr = time_range or self._default_time_range()

        campaign = CampaignObj(campaign_id)
        campaign.api = self.api

        adset_fields = [
            AdSet.Field.id,
            AdSet.Field.name,
            AdSet.Field.status,
            AdSet.Field.effective_status,
            AdSet.Field.daily_budget,
            AdSet.Field.lifetime_budget,
            AdSet.Field.targeting,
            AdSet.Field.optimization_goal,
            AdSet.Field.bid_amount,
            AdSet.Field.bid_strategy,
            AdSet.Field.billing_event,
            AdSet.Field.start_time,
            AdSet.Field.end_time,
        ]
        adsets_raw = campaign.get_ad_sets(
            fields=adset_fields,
            params={
                'filtering': [
                    {'field': 'effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'CREDIT_CARD_NEEDED', 'PREAPPROVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED']},
                ],
                'limit': 200,
            }
        )
        adsets = {a['id']: dict(a) for a in adsets_raw}

        # Insights at adset level for this campaign
        account = self._get_account(ad_account_id)
        ins_fields = [
            'adset_id', 'adset_name',
            'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm',
            'reach', 'actions', 'cost_per_action_type', 'action_values',
        ]
        cursor = account.get_insights(
            fields=ins_fields,
            params={
                'time_range': tr,
                'level': 'adset',
                'filtering': [
                    {'field': 'campaign.id', 'operator': 'EQUAL', 'value': campaign_id},
                    {'field': 'adset.effective_status', 'operator': 'IN', 'value': ['ACTIVE', 'PAUSED']},
                ],
            }
        )
        insights_map = {}
        for row in cursor:
            d = dict(row)
            d['results'] = _extract_results(d.get('actions'))
            d['purchase_revenue'] = _extract_purchase_revenue(d.get('action_values'))
            insights_map[d['adset_id']] = d

        result = []
        for aid, adset in adsets.items():
            ins = insights_map.get(aid, {})
            result.append({**adset, 'insights': ins})

        return result

    @fb_retry()
    def get_ads_with_insights(self, adset_id, ad_account_id=None, time_range=None):
        """
        Return ads for an ad set, merged with insights and creative thumbnails.
        """
        tr = time_range or self._default_time_range()

        adset = AdSet(adset_id)
        adset.api = self.api

        ad_fields = [
            Ad.Field.id,
            Ad.Field.name,
            Ad.Field.status,
            Ad.Field.effective_status,
            Ad.Field.creative,
            Ad.Field.adset_id,
            Ad.Field.campaign_id,
            Ad.Field.issues_info,
        ]
        ads_raw = adset.get_ads(
            fields=ad_fields,
            params={
                'filtering': [
                    {'field': 'effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'CREDIT_CARD_NEEDED', 'PREAPPROVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED']},
                ],
                'limit': 200,
            }
        )
        ads = {a['id']: dict(a) for a in ads_raw}

        # Fetch creative thumbnails
        creative_ids = []
        for ad in ads.values():
            cid = (ad.get('creative') or {}).get('id')
            if cid:
                creative_ids.append(cid)

        creative_map = self._batch_fetch_creatives(creative_ids)

        # Insights at ad level for this adset
        account = self._get_account(ad_account_id)
        ins_fields = [
            'ad_id', 'ad_name',
            'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm',
            'reach', 'actions', 'cost_per_action_type', 'action_values',
        ]
        cursor = account.get_insights(
            fields=ins_fields,
            params={
                'time_range': tr,
                'level': 'ad',
                'filtering': [
                    {'field': 'adset.id', 'operator': 'EQUAL', 'value': adset_id},
                    {'field': 'ad.effective_status', 'operator': 'IN', 'value': ['ACTIVE', 'PAUSED']},
                ],
            }
        )
        insights_map = {}
        for row in cursor:
            d = dict(row)
            d['results'] = _extract_results(d.get('actions'))
            d['purchase_revenue'] = _extract_purchase_revenue(d.get('action_values'))
            insights_map[d['ad_id']] = d

        result = []
        for ad_id, ad in ads.items():
            ins = insights_map.get(ad_id, {})
            cid = (ad.get('creative') or {}).get('id')
            creative_info = creative_map.get(cid, {})
            result.append({**ad, 'insights': ins, 'creative_data': creative_info})

        return result

    @fb_retry()
    def get_all_ads_with_insights(self, ad_account_id=None, time_range=None):
        """
        Return ALL ads across all campaigns/adsets for an ad account,
        merged with insights and creative thumbnails.
        """
        tr = time_range or self._default_time_range()
        account = self._get_account(ad_account_id)

        ad_fields = [
            Ad.Field.id,
            Ad.Field.name,
            Ad.Field.status,
            Ad.Field.effective_status,
            Ad.Field.creative,
            Ad.Field.adset_id,
            Ad.Field.campaign_id,
            Ad.Field.issues_info,
        ]
        ads_raw = account.get_ads(
            fields=ad_fields,
            params={
                'filtering': [
                    {'field': 'effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'CREDIT_CARD_NEEDED',
                               'PREAPPROVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED',
                               'ADSET_PAUSED', 'DISAPPROVED']},
                ],
                'limit': 500,
            }
        )
        ads = {a['id']: dict(a) for a in ads_raw}

        # Fetch creative thumbnails (batch)
        creative_ids = []
        for ad in ads.values():
            cid = (ad.get('creative') or {}).get('id')
            if cid:
                creative_ids.append(cid)

        creative_map = self._batch_fetch_creatives(creative_ids)

        # Insights at ad level for entire account
        ins_fields = [
            'ad_id', 'ad_name',
            'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm',
            'reach', 'actions', 'cost_per_action_type', 'action_values',
        ]
        cursor = account.get_insights(
            fields=ins_fields,
            params={
                'time_range': tr,
                'level': 'ad',
                'filtering': [
                    {'field': 'ad.effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED']},
                ],
                'limit': 500,
            }
        )
        insights_map = {}
        for row in cursor:
            d = dict(row)
            d['results'] = _extract_results(d.get('actions'))
            d['purchase_revenue'] = _extract_purchase_revenue(d.get('action_values'))
            insights_map[d['ad_id']] = d

        result = []
        for ad_id, ad in ads.items():
            ins = insights_map.get(ad_id, {})
            cid = (ad.get('creative') or {}).get('id')
            creative_info = creative_map.get(cid, {})
            result.append({**ad, 'insights': ins, 'creative_data': creative_info})

        return result

    @fb_retry()
    def get_all_adsets_with_insights(self, ad_account_id=None, time_range=None):
        """
        Return ALL ad sets across all campaigns for an ad account,
        merged with insights. No creative fetching needed.
        """
        tr = time_range or self._default_time_range()
        account = self._get_account(ad_account_id)

        adset_fields = [
            AdSet.Field.id,
            AdSet.Field.name,
            AdSet.Field.status,
            AdSet.Field.effective_status,
            AdSet.Field.daily_budget,
            AdSet.Field.lifetime_budget,
            AdSet.Field.campaign_id,
            AdSet.Field.optimization_goal,
        ]
        adsets_raw = account.get_ad_sets(
            fields=adset_fields,
            params={
                'filtering': [
                    {'field': 'effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'CREDIT_CARD_NEEDED',
                               'PREAPPROVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED',
                               'DISAPPROVED']},
                ],
                'limit': 500,
            }
        )
        adsets = {a['id']: dict(a) for a in adsets_raw}

        # Insights at adset level for entire account
        ins_fields = [
            'adset_id', 'adset_name',
            'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm',
            'reach', 'actions', 'cost_per_action_type',
        ]
        cursor = account.get_insights(
            fields=ins_fields,
            params={
                'time_range': tr,
                'level': 'adset',
                'filtering': [
                    {'field': 'adset.effective_status', 'operator': 'IN',
                     'value': ['ACTIVE', 'PAUSED']},
                ],
                'limit': 500,
            }
        )
        insights_map = {row['adset_id']: dict(row) for row in cursor}

        result = []
        for adset_id, adset in adsets.items():
            ins = insights_map.get(adset_id, {})
            result.append({**adset, 'insights': ins})

        return result

    def get_ad_preview(self, ad_id, ad_format='DESKTOP_FEED_STANDARD'):
        """
        Get Facebook-rendered ad preview HTML using the Previews API.
        Uses direct HTTP call to avoid SDK appsecret_proof issues.
        """
        import requests
        resp = requests.get(
            f"https://graph.facebook.com/v24.0/{ad_id}/previews",
            params={'ad_format': ad_format, 'access_token': self.access_token}
        )
        data = resp.json()
        if 'error' in data:
            raise ValueError(data['error'].get('message', 'Preview API error'))
        results = []
        for p in data.get('data', []):
            results.append({'body': p.get('body', ''), 'ad_format': ad_format})
        return results

    def duplicate_ad(self, ad_id, ad_account_id=None, new_name=None):
        """
        Duplicate an ad: reads its creative + adset, creates a new ad with same creative.
        """
        source = Ad(ad_id)
        source.api = self.api
        data = source.api_get(fields=[
            Ad.Field.name,
            Ad.Field.adset_id,
            Ad.Field.creative,
            Ad.Field.status,
        ])

        creative_id = (data.get('creative') or {}).get('id')
        if not creative_id:
            raise ValueError("Could not read creative from source ad")

        account = self._get_account(ad_account_id)
        params = {
            Ad.Field.name: (new_name or (data.get('name', 'Ad') + ' (Copy)'))[:254],
            Ad.Field.adset_id: data['adset_id'],
            Ad.Field.creative: {'creative_id': creative_id},
            Ad.Field.status: 'PAUSED',
        }
        try:
            new_ad = account.create_ad(params=params)
        except FacebookRequestError as e:
            error_msg = ''
            try:
                error_msg = e.body().get('error', {}).get('message', '')
            except Exception:
                error_msg = str(e)
            if 'permission' in error_msg.lower() or 'advertiser' in error_msg.lower():
                raise PermissionError(
                    "Missing ADVERTISE permission on the Page linked to this ad's creative. "
                    "Go to Business Manager > Pages and assign the ADVERTISE task to your user/token."
                )
            raise
        return dict(new_ad)

    def duplicate_campaign(self, campaign_id, ad_account_id=None, new_name=None):
        """
        Duplicate a campaign and all its child ad sets + ads.
        New campaign starts PAUSED.
        """
        source = Campaign(campaign_id)
        source.api = self.api
        data = source.api_get(fields=[
            Campaign.Field.name,
            Campaign.Field.objective,
            Campaign.Field.status,
            Campaign.Field.special_ad_categories,
            Campaign.Field.buying_type,
            Campaign.Field.bid_strategy,
            Campaign.Field.daily_budget,
            Campaign.Field.lifetime_budget,
        ])

        account = self._get_account(ad_account_id)

        # Create the new campaign
        params = {
            Campaign.Field.name: (new_name or (data.get('name', 'Campaign') + ' (Copy)'))[:254],
            Campaign.Field.objective: data.get('objective', 'OUTCOME_TRAFFIC'),
            Campaign.Field.status: 'PAUSED',
            Campaign.Field.special_ad_categories: data.get('special_ad_categories', []),
        }
        if data.get('buying_type'):
            params[Campaign.Field.buying_type] = data['buying_type']
        if data.get('bid_strategy'):
            params[Campaign.Field.bid_strategy] = data['bid_strategy']
        if data.get('daily_budget'):
            params[Campaign.Field.daily_budget] = data['daily_budget']
        if data.get('lifetime_budget'):
            params[Campaign.Field.lifetime_budget] = data['lifetime_budget']

        new_campaign = account.create_campaign(params=params)
        new_campaign_id = new_campaign['id']

        # Duplicate all ad sets under this campaign
        adsets = source.get_ad_sets(fields=[AdSet.Field.id])
        duplicated_adsets = 0
        duplicated_ads = 0
        for adset in adsets:
            result = self.duplicate_adset(
                adset['id'],
                ad_account_id=ad_account_id,
                target_campaign_id=new_campaign_id,
            )
            duplicated_adsets += 1
            duplicated_ads += result.get('ads_duplicated', 0)

        return {
            'id': new_campaign_id,
            'name': params[Campaign.Field.name],
            'adsets_duplicated': duplicated_adsets,
            'ads_duplicated': duplicated_ads,
        }

    def duplicate_adset(self, adset_id, ad_account_id=None, target_campaign_id=None, new_name=None):
        """
        Duplicate an ad set and all its child ads.
        If target_campaign_id is provided, the new ad set goes there;
        otherwise it stays in the same campaign. New ad set starts PAUSED
        with start_time set to next midnight EST.
        """
        from datetime import datetime, timedelta
        from zoneinfo import ZoneInfo

        source = AdSet(adset_id)
        source.api = self.api
        data = source.api_get(fields=[
            AdSet.Field.name,
            AdSet.Field.campaign_id,
            AdSet.Field.status,
            AdSet.Field.targeting,
            AdSet.Field.billing_event,
            AdSet.Field.optimization_goal,
            AdSet.Field.bid_amount,
            AdSet.Field.daily_budget,
            AdSet.Field.lifetime_budget,
            AdSet.Field.start_time,
            AdSet.Field.end_time,
            AdSet.Field.promoted_object,
        ])

        account = self._get_account(ad_account_id)
        campaign_id = target_campaign_id or data.get('campaign_id')

        # Set start_time to next midnight EST
        eastern = ZoneInfo("America/New_York")
        now_est = datetime.now(eastern)
        next_1am = (now_est + timedelta(days=1)).replace(hour=1, minute=0, second=0, microsecond=0)
        start_time_iso = next_1am.isoformat()

        params = {
            AdSet.Field.name: (new_name or (data.get('name', 'Ad Set') + ' (Copy)'))[:254],
            AdSet.Field.campaign_id: campaign_id,
            AdSet.Field.status: 'ACTIVE',
            AdSet.Field.billing_event: data.get('billing_event', 'IMPRESSIONS'),
            AdSet.Field.optimization_goal: data.get('optimization_goal', 'LINK_CLICKS'),
            AdSet.Field.start_time: start_time_iso,
        }
        if data.get('targeting'):
            params[AdSet.Field.targeting] = data['targeting']
        if data.get('bid_amount'):
            params[AdSet.Field.bid_amount] = data['bid_amount']
        if data.get('daily_budget'):
            params[AdSet.Field.daily_budget] = data['daily_budget']
        if data.get('lifetime_budget'):
            params[AdSet.Field.lifetime_budget] = data['lifetime_budget']
        if data.get('promoted_object'):
            params[AdSet.Field.promoted_object] = data['promoted_object']

        new_adset = account.create_ad_set(params=params)
        new_adset_id = new_adset['id']

        # Duplicate all ads under this ad set
        ads = source.get_ads(fields=[Ad.Field.id])
        duplicated_ads = 0
        for ad in ads:
            try:
                ad_source = Ad(ad['id'])
                ad_source.api = self.api
                ad_data = ad_source.api_get(fields=[
                    Ad.Field.name,
                    Ad.Field.creative,
                ])
                creative_id = (ad_data.get('creative') or {}).get('id')
                if not creative_id:
                    continue
                ad_params = {
                    Ad.Field.name: (ad_data.get('name', 'Ad') + ' (Copy)')[:254],
                    Ad.Field.adset_id: new_adset_id,
                    Ad.Field.creative: {'creative_id': creative_id},
                    Ad.Field.status: 'ACTIVE',
                }
                account.create_ad(params=ad_params)
                duplicated_ads += 1
            except Exception:
                continue  # skip ads that fail to duplicate

        return {
            'id': new_adset_id,
            'name': params[AdSet.Field.name],
            'ads_duplicated': duplicated_ads,
        }

    def clone_campaign_to_account(self, campaign_id, target_account_id, new_name=None,
                                     target_page_id=None, target_pixel_id=None,
                                     clone_ads=True):
        """
        Clone a campaign's full structure to a different ad account.
        Includes campaign + ad sets + ads with creatives (re-uploads images/videos).
        """
        import requests as http_requests
        import tempfile

        source = Campaign(campaign_id)
        source.api = self.api
        data = source.api_get(fields=[
            Campaign.Field.name,
            Campaign.Field.objective,
            Campaign.Field.special_ad_categories,
            Campaign.Field.buying_type,
            Campaign.Field.bid_strategy,
            Campaign.Field.daily_budget,
            Campaign.Field.lifetime_budget,
        ])

        target_account = self._get_account(target_account_id)

        # Create campaign in target account
        params = {
            Campaign.Field.name: (new_name or (data.get('name', 'Campaign') + ' (Clone)'))[:254],
            Campaign.Field.objective: data.get('objective', 'OUTCOME_TRAFFIC'),
            Campaign.Field.status: 'PAUSED',
            Campaign.Field.special_ad_categories: data.get('special_ad_categories', []),
        }
        if data.get('buying_type'):
            params[Campaign.Field.buying_type] = data['buying_type']
        if data.get('bid_strategy'):
            params[Campaign.Field.bid_strategy] = data['bid_strategy']
        if data.get('daily_budget'):
            params[Campaign.Field.daily_budget] = data['daily_budget']
        if data.get('lifetime_budget'):
            params[Campaign.Field.lifetime_budget] = data['lifetime_budget']
        # Required by FB API when not using campaign budget optimization
        if not data.get('daily_budget') and not data.get('lifetime_budget'):
            params['is_adset_budget_sharing_enabled'] = False

        new_campaign = target_account.create_campaign(params=params)
        new_campaign_id = new_campaign['id']
        print(f"[clone] Created campaign {new_campaign_id} in {target_account_id}")

        # Read all ad sets from source
        adsets = source.get_ad_sets(fields=[
            AdSet.Field.id,
            AdSet.Field.name,
            AdSet.Field.targeting,
            AdSet.Field.billing_event,
            AdSet.Field.optimization_goal,
            AdSet.Field.bid_amount,
            AdSet.Field.bid_strategy,
            AdSet.Field.daily_budget,
            AdSet.Field.lifetime_budget,
            AdSet.Field.promoted_object,
            AdSet.Field.start_time,
        ])

        cloned_adsets = 0
        cloned_ads = 0
        errors = []

        for adset_data in adsets:
            try:
                adset_params = {
                    AdSet.Field.name: adset_data.get('name', 'Ad Set'),
                    AdSet.Field.campaign_id: new_campaign_id,
                    AdSet.Field.status: 'PAUSED',
                    AdSet.Field.billing_event: adset_data.get('billing_event', 'IMPRESSIONS'),
                    AdSet.Field.optimization_goal: adset_data.get('optimization_goal', 'LINK_CLICKS'),
                }
                if adset_data.get('targeting'):
                    adset_params[AdSet.Field.targeting] = adset_data['targeting']
                if adset_data.get('bid_amount'):
                    adset_params[AdSet.Field.bid_amount] = adset_data['bid_amount']
                if adset_data.get('bid_strategy'):
                    adset_params[AdSet.Field.bid_strategy] = adset_data['bid_strategy']
                if adset_data.get('daily_budget'):
                    adset_params[AdSet.Field.daily_budget] = adset_data['daily_budget']
                if adset_data.get('lifetime_budget'):
                    adset_params[AdSet.Field.lifetime_budget] = adset_data['lifetime_budget']

                # Handle promoted_object — swap pixel if target provided
                promoted = adset_data.get('promoted_object')
                if promoted:
                    new_promoted = dict(promoted)
                    if target_pixel_id:
                        new_promoted['pixel_id'] = target_pixel_id
                    adset_params[AdSet.Field.promoted_object] = new_promoted

                new_adset = target_account.create_ad_set(params=adset_params)
                new_adset_id = new_adset['id']
                cloned_adsets += 1
                print(f"[clone] Created adset {new_adset_id}")

                # Clone ads if requested
                if clone_ads:
                    source_adset = AdSet(adset_data['id'])
                    source_adset.api = self.api
                    ads = source_adset.get_ads(fields=[
                        Ad.Field.id,
                        Ad.Field.name,
                        Ad.Field.status,
                        Ad.Field.creative,
                    ])

                    for ad_data in ads:
                        try:
                            creative_ref = ad_data.get('creative')
                            creative_id = None
                            if creative_ref:
                                # SDK returns AdCreative object, not plain dict
                                creative_id = creative_ref.get('id') if hasattr(creative_ref, 'get') else getattr(creative_ref, 'id', None)
                            if not creative_id:
                                print(f"[clone] Ad {ad_data['id']} has no creative (ref={type(creative_ref).__name__}), skipping")
                                continue

                            # Read full creative details
                            src_creative = AdCreative(creative_id)
                            src_creative.api = self.api
                            creative_details = src_creative.api_get(fields=[
                                AdCreative.Field.name,
                                AdCreative.Field.object_story_spec,
                                AdCreative.Field.image_hash,
                                AdCreative.Field.image_url,
                                AdCreative.Field.thumbnail_url,
                            ])

                            oss = creative_details.get('object_story_spec', {})
                            link_data = oss.get('link_data', {})
                            video_data = oss.get('video_data', {})

                            # Determine page_id to use
                            page_id = target_page_id or oss.get('page_id', '')

                            if link_data:
                                # Image creative — re-upload image to target account
                                image_url = (
                                    creative_details.get('image_url')
                                    or link_data.get('picture')
                                    or creative_details.get('thumbnail_url')
                                )
                                print(f"[clone] Ad '{ad_data.get('name')}' image_url={image_url}")
                                new_image_hash = None
                                if image_url:
                                    try:
                                        new_image_hash = self.upload_image(image_url, target_account_id)
                                        print(f"[clone] Re-uploaded image → hash {new_image_hash}")
                                    except Exception as img_err:
                                        err_detail = str(img_err)
                                        if hasattr(img_err, 'api_error_message'):
                                            err_detail = f"code={getattr(img_err, '_error', {}).get('code', '?')} msg={img_err.api_error_message()}"
                                        print(f"[clone] Image re-upload failed for {image_url}: {type(img_err).__name__}: {err_detail}")
                                        errors.append(f"Ad '{ad_data.get('name')}': image re-upload failed")
                                        continue
                                else:
                                    print(f"[clone] No image URL found. link_data keys={list(link_data.keys())}, creative keys={list(dict(creative_details).keys())}")
                                    errors.append(f"Ad '{ad_data.get('name')}': no image URL found")
                                    continue

                                new_creative_params = {
                                    AdCreative.Field.name: creative_details.get('name', 'Cloned Creative'),
                                    AdCreative.Field.object_story_spec: {
                                        'page_id': page_id,
                                        'link_data': {
                                            'image_hash': new_image_hash or link_data.get('image_hash'),
                                            'link': link_data.get('link', ''),
                                            'message': link_data.get('message', ''),
                                            'name': link_data.get('name', ''),
                                            'description': link_data.get('description', ''),
                                            'call_to_action': link_data.get('call_to_action', {
                                                'type': 'LEARN_MORE',
                                                'value': {'link': link_data.get('link', '')}
                                            }),
                                        }
                                    },
                                }

                            elif video_data:
                                # Video creative — re-upload video to target account
                                video_url = video_data.get('video_url') or video_data.get('image_url')
                                new_video_id = None

                                # Try to get the source video URL
                                src_video_id = video_data.get('video_id')
                                if src_video_id:
                                    try:
                                        src_video = AdVideo(src_video_id)
                                        src_video.api = self.api
                                        vid_details = src_video.api_get(fields=['source'])
                                        video_source_url = vid_details.get('source')
                                        if video_source_url:
                                            upload_result = self.upload_video(video_source_url, target_account_id, page_id=page_id)
                                            new_video_id = upload_result['video_id'] if isinstance(upload_result, dict) else upload_result
                                            print(f"[clone] Re-uploaded video → id {new_video_id}")
                                    except Exception as vid_err:
                                        print(f"[clone] Video re-upload failed: {vid_err}")

                                if not new_video_id:
                                    print(f"[clone] Skipping video ad {ad_data['id']} — couldn't re-upload video")
                                    errors.append(f"Ad '{ad_data.get('name')}': video re-upload failed")
                                    continue

                                new_creative_params = {
                                    AdCreative.Field.name: creative_details.get('name', 'Cloned Creative'),
                                    AdCreative.Field.object_story_spec: {
                                        'page_id': page_id,
                                        'video_data': {
                                            'video_id': new_video_id,
                                            'message': video_data.get('message', ''),
                                            'title': video_data.get('title', ''),
                                            'call_to_action': video_data.get('call_to_action', {
                                                'type': 'LEARN_MORE',
                                                'value': {'link': ''}
                                            }),
                                        }
                                    },
                                }
                            else:
                                print(f"[clone] Unknown creative type for ad {ad_data['id']}, skipping")
                                continue

                            new_creative = target_account.create_ad_creative(params=new_creative_params)
                            new_creative_id = new_creative['id']

                            # Create the ad
                            ad_params = {
                                Ad.Field.name: ad_data.get('name', 'Cloned Ad'),
                                Ad.Field.adset_id: new_adset_id,
                                Ad.Field.creative: {'creative_id': new_creative_id},
                                Ad.Field.status: 'PAUSED',
                            }
                            target_account.create_ad(params=ad_params)
                            cloned_ads += 1
                            print(f"[clone] Created ad in adset {new_adset_id}")

                        except Exception as ad_err:
                            print(f"[clone] Failed to clone ad {ad_data.get('id')}: {ad_err}")
                            errors.append(f"Ad '{ad_data.get('name')}': {str(ad_err)[:100]}")
                            continue

            except Exception as e:
                print(f"[clone] Failed to clone adset {adset_data.get('id')}: {e}")
                errors.append(f"AdSet '{adset_data.get('name')}': {str(e)[:100]}")
                continue

        return {
            'id': new_campaign_id,
            'name': params[Campaign.Field.name],
            'target_account': target_account_id,
            'adsets_cloned': cloned_adsets,
            'ads_cloned': cloned_ads,
            'errors': errors,
        }

    def update_object_name(self, object_id, object_type, new_name):
        """Rename a campaign, ad set, or ad."""
        type_map = {'campaign': Campaign, 'adset': AdSet, 'ad': Ad}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        obj = cls(object_id)
        obj.api = self.api
        obj.api_update(params={cls.Field.name: new_name})
        return {'id': object_id, 'name': new_name}

    def update_ad_name(self, ad_id, new_name):
        """Rename an ad (backward compat)."""
        return self.update_object_name(ad_id, 'ad', new_name)

    def update_ad_creative(self, ad_id, creative_data, ad_account_id=None):
        """
        Replace an ad's creative by creating a new AdCreative and updating the Ad.
        Supports both image and video ads:
          - Image: resolve image_hash (from payload, new upload, or existing creative)
          - Video: reuse video_id (from payload or existing creative); optional thumbnail_url
        """
        import json as _json

        page_id = creative_data.get('page_id')
        if not page_id:
            raise ValueError("page_id is required")

        video_id = creative_data.get('video_id')
        image_hash = None

        # If caller didn't supply a video_id but also no image inputs, try to detect from existing creative
        if not video_id and not creative_data.get('image_hash') and not creative_data.get('image_url'):
            try:
                ad_obj = Ad(ad_id)
                ad_obj.api = self.api
                ad_fields = ad_obj.api_get(fields=['creative'])
                existing_creative_id = ad_fields.get('creative', {}).get('id')
                if existing_creative_id:
                    existing_creative = AdCreative(existing_creative_id)
                    existing_creative.api = self.api
                    creative_fields = existing_creative.api_get(
                        fields=['object_story_spec', 'image_hash']
                    )
                    oss = creative_fields.get('object_story_spec', {})
                    video_data = oss.get('video_data', {})
                    if video_data.get('video_id'):
                        video_id = video_data['video_id']
                        print(f"[update_ad_creative] Reusing existing video_id: {video_id}")
                    else:
                        image_hash = creative_fields.get('image_hash') or oss.get('link_data', {}).get('image_hash')
                        if image_hash:
                            print(f"[update_ad_creative] Reusing existing image_hash: {image_hash}")
            except Exception as e:
                print(f"[update_ad_creative] Failed to fetch existing creative media: {e}")

        if not video_id:
            # ─── Image path ────────────────────────────────────────
            image_hash = image_hash or creative_data.get('image_hash')

            if not image_hash:
                image_url = creative_data.get('image_url', '')

                # If the image URL is from our own uploads (R2 / local), download & upload to FB
                if image_url and not image_url.startswith('https://scontent') and not image_url.startswith('https://external'):
                    try:
                        image_hash = self.upload_image(image_url, ad_account_id)
                        print(f"[update_ad_creative] Uploaded image, hash: {image_hash}")
                    except Exception as e:
                        print(f"[update_ad_creative] Failed to upload image from URL ({image_url}): {e}")
                        raise ValueError(f"Failed to upload image to Facebook: {e}")

                # If still no hash, try to pull the existing hash from the current ad's creative
                if not image_hash:
                    try:
                        ad_obj = Ad(ad_id)
                        ad_obj.api = self.api
                        ad_fields = ad_obj.api_get(fields=['creative'])
                        existing_creative_id = ad_fields.get('creative', {}).get('id')
                        if existing_creative_id:
                            existing_creative = AdCreative(existing_creative_id)
                            existing_creative.api = self.api
                            creative_fields = existing_creative.api_get(
                                fields=['object_story_spec', 'image_hash']
                            )
                            image_hash = creative_fields.get('image_hash')
                            if not image_hash:
                                oss = creative_fields.get('object_story_spec', {})
                                link_data = oss.get('link_data', {})
                                image_hash = link_data.get('image_hash')
                            if image_hash:
                                print(f"[update_ad_creative] Reusing existing image_hash: {image_hash}")
                    except Exception as e:
                        print(f"[update_ad_creative] Failed to fetch existing creative image_hash: {e}")

            if not image_hash:
                raise ValueError("Could not resolve image_hash. Provide an image_hash, upload a new image, or ensure the existing ad has an image creative.")

        # Step 2: Create new AdCreative
        new_creative_data = {
            'name': creative_data.get('name', f'Edited creative for {ad_id}'),
            'page_id': page_id,
            'primary_text': creative_data.get('primary_text', ''),
            'headline': creative_data.get('headline', ''),
            'description': creative_data.get('description', ''),
            'cta': creative_data.get('cta', 'LEARN_MORE'),
            'website_url': creative_data.get('website_url', ''),
        }
        if video_id:
            new_creative_data['video_id'] = video_id
            if creative_data.get('thumbnail_url'):
                new_creative_data['thumbnail_url'] = creative_data['thumbnail_url']
        else:
            new_creative_data['image_hash'] = image_hash
        if creative_data.get('instagram_actor_id'):
            new_creative_data['instagram_actor_id'] = creative_data['instagram_actor_id']

        try:
            new_creative = self.create_creative(new_creative_data, ad_account_id)
            new_creative_id = new_creative['id']
            print(f"[update_ad_creative] Created new creative: {new_creative_id}")
        except Exception as e:
            raise Exception(f"Failed to create replacement creative: {e}")

        # Step 3: Update Ad to point to new creative
        ad = Ad(ad_id)
        ad.api = self.api
        try:
            ad.api_update(params={
                'creative': {'creative_id': new_creative_id}
            })
        except Exception as e:
            # For DISAPPROVED ads, try setting status to PAUSED alongside the creative swap
            print(f"[update_ad_creative] Direct creative update failed ({e}), retrying with status=PAUSED")
            try:
                ad.api_update(params={
                    'creative': {'creative_id': new_creative_id},
                    'status': 'PAUSED',
                })
            except Exception as e2:
                raise Exception(f"Failed to update ad with new creative: {e2}")

        return {'ad_id': ad_id, 'new_creative_id': new_creative_id, 'image_hash': image_hash}

    def _batch_fetch_creatives(self, creative_ids):
        """Fetch multiple ad creatives in batched calls using ?ids= parameter.
        Much faster than N individual API calls — does ceil(N/50) calls instead of N.
        """
        import requests as _requests
        creative_fields = 'thumbnail_url,image_url,image_hash,name,object_story_spec,effective_object_story_id,body,title,link_url'
        creative_map = {}

        # Process in batches of 50 (FB API limit for ?ids=)
        for i in range(0, len(creative_ids), 50):
            batch = creative_ids[i:i+50]
            try:
                resp = _requests.get(
                    f"https://graph.facebook.com/{self.api_version}/",
                    params={
                        'ids': ','.join(batch),
                        'fields': creative_fields,
                        'access_token': self.access_token,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                results = resp.json()

                for cid, data in results.items():
                    if 'error' in data:
                        creative_map[cid] = {}
                        continue
                    oss = data.get('object_story_spec', {})
                    link_data = oss.get('link_data', {})
                    video_data = oss.get('video_data', {})
                    ad_data = link_data or video_data
                    image = (ad_data.get('picture', '')
                             or data.get('image_url', '')
                             or video_data.get('image_url', '')
                             or data.get('thumbnail_url', ''))
                    img_hash = data.get('image_hash') or link_data.get('image_hash', '')
                    # Boosted-post creatives have no object_story_spec.page_id;
                    # derive it from effective_object_story_id (format: pageId_postId).
                    eosi = data.get('effective_object_story_id', '')
                    page_id_val = oss.get('page_id', '')
                    if not page_id_val and eosi and '_' in str(eosi):
                        page_id_val = str(eosi).split('_')[0]
                    creative_map[cid] = {
                        'thumbnail_url': data.get('thumbnail_url', ''),
                        'image_url': image,
                        'image_hash': img_hash,
                        'creative_name': data.get('name', ''),
                        'primary_text': ad_data.get('message', '') or data.get('body', ''),
                        'headline': ad_data.get('name', '') or data.get('title', ''),
                        'description': ad_data.get('description', ''),
                        'cta': (ad_data.get('call_to_action', {}) or {}).get('type', ''),
                        'website_url': ad_data.get('link', '') or data.get('link_url', ''),
                        'is_video': bool(video_data),
                        'video_id': video_data.get('video_id', ''),
                        'page_id': page_id_val,
                        'story_id': eosi,
                        'post_url': f"https://www.facebook.com/{eosi}" if eosi else '',
                    }
            except Exception as e:
                logger.error(f"Batch creative fetch error: {e}")
                for cid in batch:
                    if cid not in creative_map:
                        creative_map[cid] = {}

        return creative_map

    # ── Budget Scheduling (FB Native) ──────────────────────────────

    def get_budget_schedules(self, object_id, object_type='campaign'):
        """Get existing budget schedules for a campaign or adset."""
        type_map = {'campaign': Campaign, 'adset': AdSet}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        obj = cls(object_id)
        obj.api = self.api
        schedules = obj.get_budget_schedules(fields=[
            'id', 'budget_value', 'budget_value_type',
            'time_start', 'time_end', 'recurrence_type',
            'status',
        ])
        return [dict(s) for s in schedules]

    def create_budget_schedule(self, object_id, object_type, schedule_data):
        """Create a budget schedule (native FB budget scheduling).

        schedule_data should contain:
            - budget_value: additional budget in cents (e.g. 80000 = $800)
            - budget_value_type: 'ABSOLUTE' (additional amount) or 'MULTIPLIER'
            - time_start: ISO datetime for start of schedule window
            - time_end: ISO datetime for end of schedule window
            - recurrence_type: 'ONE_TIME' or 'WEEKLY'
        """
        type_map = {'campaign': Campaign, 'adset': AdSet}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        obj = cls(object_id)
        obj.api = self.api

        params = {
            'budget_value': str(schedule_data['budget_value']),
            'budget_value_type': schedule_data.get('budget_value_type', 'ABSOLUTE'),
            'time_start': schedule_data['time_start'],
            'time_end': schedule_data['time_end'],
        }
        if schedule_data.get('recurrence_type'):
            params['recurrence_type'] = schedule_data['recurrence_type']

        result = obj.create_budget_schedule(params=params)
        return dict(result) if result else {'created': True}

    def delete_budget_schedule(self, schedule_id):
        """Remove a budget schedule."""
        import requests
        resp = requests.delete(
            f"https://graph.facebook.com/{self.api_version}/{schedule_id}",
            params={'access_token': self.access_token},
        )
        resp.raise_for_status()
        return resp.json()

    def enable_budget_scheduling(self, object_id, object_type, enabled=True):
        """Enable or disable budget scheduling on a campaign or adset."""
        type_map = {'campaign': Campaign, 'adset': AdSet}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        obj = cls(object_id)
        obj.api = self.api
        obj.api_update(params={'is_budget_schedule_enabled': enabled})
        return {'id': object_id, 'is_budget_schedule_enabled': enabled}

    def update_campaign(self, campaign_id, params):
        """Update a campaign with arbitrary params.
        Supported fields: name, daily_budget, lifetime_budget, bid_strategy,
        status, special_ad_categories, start_time, stop_time.
        """
        campaign = Campaign(campaign_id)
        campaign.api = self.api

        update_params = {}
        field_map = {
            'name': Campaign.Field.name,
            'daily_budget': Campaign.Field.daily_budget,
            'lifetime_budget': Campaign.Field.lifetime_budget,
            'bid_strategy': Campaign.Field.bid_strategy,
            'status': Campaign.Field.status,
            'special_ad_categories': Campaign.Field.special_ad_categories,
            'start_time': Campaign.Field.start_time,
            'stop_time': Campaign.Field.stop_time,
        }
        for key, field in field_map.items():
            if key in params and params[key] is not None:
                update_params[field] = params[key]

        if not update_params:
            return {'id': campaign_id, 'updated': False}

        campaign.api_update(params=update_params)
        return {'id': campaign_id, 'updated': True, 'fields': list(update_params.keys())}

    def update_adset(self, adset_id, params):
        """Update an ad set with arbitrary params.
        Supported fields: name, daily_budget, bid_amount, targeting, optimization_goal,
        billing_event, start_time, end_time, status.
        """
        adset = AdSet(adset_id)
        adset.api = self.api

        update_params = {}
        field_map = {
            'name': AdSet.Field.name,
            'daily_budget': AdSet.Field.daily_budget,
            'lifetime_budget': AdSet.Field.lifetime_budget,
            'bid_amount': AdSet.Field.bid_amount,
            'bid_strategy': AdSet.Field.bid_strategy,
            'billing_event': AdSet.Field.billing_event,
            'optimization_goal': AdSet.Field.optimization_goal,
            'targeting': AdSet.Field.targeting,
            'status': AdSet.Field.status,
            'start_time': AdSet.Field.start_time,
            'end_time': AdSet.Field.end_time,
        }
        for key, field in field_map.items():
            if key in params and params[key] is not None:
                update_params[field] = params[key]

        if not update_params:
            return {'id': adset_id, 'updated': False}

        adset.api_update(params=update_params)
        return {'id': adset_id, 'updated': True, 'fields': list(update_params.keys())}

    def update_budget(self, object_id, object_type, new_budget_cents):
        """Update daily budget for a campaign or ad set. Budget in cents."""
        type_map = {'campaign': Campaign, 'adset': AdSet}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        obj = cls(object_id)
        obj.api = self.api
        obj.api_update(params={cls.Field.daily_budget: int(new_budget_cents)})
        return {'id': object_id, 'daily_budget': new_budget_cents}

    CAPPED_BID_STRATEGIES = ('LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'BID_CAP')

    def update_bid(self, object_id, object_type, new_bid_cents, force=False):
        """Update bid_amount on a capped-strategy adset or CBO campaign. Cents.

        Returns dict with action:
          - 'updated' (FB call made),
          - 'skipped_same' (current bid already matches; no call),
          - 'skipped_strategy' (object not on a capped strategy; no call).
        Raises ValueError on bad input or strategy mismatch if force=False is not enough.
        """
        type_map = {'campaign': Campaign, 'adset': AdSet}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        new_bid_cents = int(new_bid_cents)
        if new_bid_cents <= 0:
            raise ValueError("new_bid_cents must be > 0")

        obj = cls(object_id, api=self.api)
        fields = [cls.Field.bid_strategy, cls.Field.bid_amount]
        if object_type == 'adset':
            fields.append(AdSet.Field.campaign_id)
        current = obj.api_get(fields=fields)

        strategy = current.get(cls.Field.bid_strategy)
        # Adsets in CBO inherit campaign-level strategy.
        if object_type == 'adset' and not strategy:
            camp_id = current.get(AdSet.Field.campaign_id)
            if camp_id:
                try:
                    camp = Campaign(camp_id, api=self.api).api_get(fields=[Campaign.Field.bid_strategy])
                    strategy = camp.get(Campaign.Field.bid_strategy)
                except Exception:
                    pass
        if strategy not in self.CAPPED_BID_STRATEGIES and not force:
            return {
                'id': object_id,
                'action': 'skipped_strategy',
                'bid_strategy': strategy,
            }

        current_bid = current.get(cls.Field.bid_amount)
        if current_bid is not None and int(current_bid) == new_bid_cents:
            return {
                'id': object_id,
                'action': 'skipped_same',
                'bid_amount': new_bid_cents,
            }

        obj.api_update(params={cls.Field.bid_amount: new_bid_cents})
        return {
            'id': object_id,
            'action': 'updated',
            'bid_amount': new_bid_cents,
            'previous_bid': int(current_bid) if current_bid is not None else None,
        }

    def update_object_status(self, object_id, object_type, new_status):
        """
        Toggle a campaign, ad set, or ad between ACTIVE and PAUSED.
        object_type: 'campaign', 'adset', or 'ad'
        new_status: 'ACTIVE' or 'PAUSED'
        """
        type_map = {
            'campaign': Campaign,
            'adset': AdSet,
            'ad': Ad,
        }
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")

        obj = cls(object_id)
        obj.api = self.api
        obj.api_update(params={cls.Field.status: new_status})
        return {'id': object_id, 'status': new_status}

    def bulk_update_status(self, items, new_status):
        """
        Bulk toggle multiple campaigns/adsets/ads to ACTIVE or PAUSED.
        items: list of {"object_id": "...", "object_type": "campaign|adset|ad"}
        """
        type_map = {'campaign': Campaign, 'adset': AdSet, 'ad': Ad}
        succeeded = []
        failed = []
        for item in items:
            object_id = item['object_id']
            object_type = item['object_type']
            cls = type_map.get(object_type)
            if not cls:
                failed.append({'id': object_id, 'error': f'Invalid type: {object_type}'})
                continue
            try:
                obj = cls(object_id)
                obj.api = self.api
                obj.api_update(params={cls.Field.status: new_status})
                succeeded.append(object_id)
            except Exception as e:
                failed.append({'id': object_id, 'error': str(e)})
        return {'succeeded': succeeded, 'failed': failed, 'status': new_status}

    def delete_object(self, object_id, object_type):
        """
        Delete a campaign, ad set, or ad by setting status to DELETED.
        Facebook archives the object — it won't appear in future queries.
        """
        type_map = {'campaign': Campaign, 'adset': AdSet, 'ad': Ad}
        cls = type_map.get(object_type)
        if not cls:
            raise ValueError(f"Invalid object_type: {object_type}")
        obj = cls(object_id)
        obj.api = self.api
        obj.api_update(params={cls.Field.status: 'DELETED'})
        return {'id': object_id, 'deleted': True}

