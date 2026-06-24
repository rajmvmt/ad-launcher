"""
NewsBreak Advertising API service.
Docs: https://advertising-api.newsbreak.com/hc/en-us/categories/37825505060237-API-Reference
Base URL: https://business.newsbreak.com/business-api/v1/
Auth: Access-Token header

Correct endpoint paths (verified Feb 2026 from Zendesk docs):
- Campaigns: GET campaign/getList, POST campaign/create,
             PUT campaign/update/{id}, PUT campaign/updateStatus/{id},
             DELETE campaign/delete/{id}
- Ad Sets:   GET ad-set/getList, POST ad-set/create,
             PUT ad-set/update/{id}, PUT ad-set/updateStatus/{id},
             DELETE ad-set/delete/{id}
- Ads:       GET ad/getList, POST ad/create,
             PUT ad/update/{id}, PUT ad/updateStatus/{id},
             DELETE ad/delete/{id}
- Reports:   POST reports/getIntegratedReport
- Events:    GET event/getList/{adAccountId}
"""
import requests

BASE_URL = "https://business.newsbreak.com/business-api/v1"

# Default page size for list requests
DEFAULT_PAGE_SIZE = 500


class NewsBreakService:
    def __init__(self, connection=None):
        self.api_token = None
        self.account_id = None

        if connection:
            self.api_token = connection.api_token
            self.account_id = connection.account_id

    def authenticate(self):
        """Verify API token by fetching campaigns (lightweight check)."""
        if not self.api_token:
            raise ValueError("api_token is required for NewsBreak auth")
        # Use a small campaign list request to verify the token works
        params = {"pageNo": 1, "pageSize": 1}
        if self.account_id:
            params["adAccountId"] = self.account_id
        return self._get("campaign/getList", params)

    def _headers(self):
        if not self.api_token:
            raise ValueError("No NewsBreak API token configured")
        return {
            "Access-Token": self.api_token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _handle_response(self, resp, action="request"):
        if resp.status_code != 200:
            raise Exception(f"NewsBreak {action} failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        code = data.get("code", -1)
        if code != 0:
            msg = data.get("errMsg", data.get("message", data.get("msg", f"Error code {code}")))
            raise Exception(f"NewsBreak {action} error: {msg}")
        return data.get("data", data)

    def _extract_rows(self, data):
        """Extract rows from a paginated list response.
        List endpoints use 'rows', report endpoints use 'list'."""
        if isinstance(data, dict):
            if "rows" in data:
                return data["rows"]
            if "list" in data:
                return data["list"]
        if isinstance(data, list):
            return data
        return data

    def _get(self, path, params=None):
        resp = requests.get(f"{BASE_URL}/{path}", headers=self._headers(), params=params)
        return self._handle_response(resp, f"GET {path}")

    def _post(self, path, data=None):
        resp = requests.post(f"{BASE_URL}/{path}", headers=self._headers(), json=data)
        return self._handle_response(resp, f"POST {path}")

    def _put(self, path, data=None):
        resp = requests.put(f"{BASE_URL}/{path}", headers=self._headers(), json=data)
        return self._handle_response(resp, f"PUT {path}")

    def _delete(self, path):
        resp = requests.delete(f"{BASE_URL}/{path}", headers=self._headers())
        return self._handle_response(resp, f"DELETE {path}")

    # ── Campaigns ─────────────────────────────────────────────────

    def get_campaigns(self, ad_account_id=None):
        acct = ad_account_id or self.account_id
        params = {"pageNo": 1, "pageSize": DEFAULT_PAGE_SIZE}
        if acct:
            params["adAccountId"] = acct
        data = self._get("campaign/getList", params)
        return self._extract_rows(data)

    def create_campaign(self, campaign_data):
        if not campaign_data.get("adAccountId") and self.account_id:
            campaign_data["adAccountId"] = self.account_id
        return self._post("campaign/create", campaign_data)

    def update_campaign(self, campaign_id, campaign_data):
        return self._put(f"campaign/update/{campaign_id}", campaign_data)

    def update_campaign_status(self, campaign_id, status):
        """status: 'ON' or 'OFF'"""
        return self._put(f"campaign/updateStatus/{campaign_id}", {"status": status})

    def delete_campaign(self, campaign_id):
        return self._delete(f"campaign/delete/{campaign_id}")

    # ── Ad Sets ───────────────────────────────────────────────────

    def get_ad_sets(self, campaign_id=None, ad_account_id=None):
        acct = ad_account_id or self.account_id
        params = {"pageNo": 1, "pageSize": DEFAULT_PAGE_SIZE}
        if acct:
            params["adAccountId"] = acct
        if campaign_id:
            params["campaignIds"] = campaign_id
        data = self._get("ad-set/getList", params)
        return self._extract_rows(data)

    def create_ad_set(self, adset_data):
        return self._post("ad-set/create", adset_data)

    def update_ad_set(self, adset_id, adset_data):
        return self._put(f"ad-set/update/{adset_id}", adset_data)

    def update_ad_set_status(self, adset_id, status):
        return self._put(f"ad-set/updateStatus/{adset_id}", {"status": status})

    def delete_ad_set(self, adset_id):
        return self._delete(f"ad-set/delete/{adset_id}")

    # ── Ads ───────────────────────────────────────────────────────

    def get_ads(self, ad_set_id=None, ad_account_id=None):
        acct = ad_account_id or self.account_id
        params = {"pageNo": 1, "pageSize": DEFAULT_PAGE_SIZE}
        if acct:
            params["adAccountId"] = acct
        if ad_set_id:
            params["adSetIds"] = ad_set_id
        data = self._get("ad/getList", params)
        return self._extract_rows(data)

    def create_ad(self, ad_data):
        return self._post("ad/create", ad_data)

    def update_ad(self, ad_id, ad_data):
        return self._put(f"ad/update/{ad_id}", ad_data)

    def update_ad_status(self, ad_id, status):
        return self._put(f"ad/updateStatus/{ad_id}", {"status": status})

    def delete_ad(self, ad_id):
        return self._delete(f"ad/delete/{ad_id}")

    # ── Events ────────────────────────────────────────────────────

    def get_events(self, ad_account_id=None):
        acct = ad_account_id or self.account_id
        if not acct:
            raise ValueError("ad_account_id is required for get_events")
        return self._get(f"event/getList/{acct}")

    # ── Reporting ─────────────────────────────────────────────────

    def get_report(self, since, until, dimensions=None, metrics=None, filter_ids=None, name=None):
        """
        Run a synchronous integrated report.
        dimensions: list like ["DATE", "CAMPAIGN", "AD_SET", "AD"]
        metrics: list like ["COST", "IMPRESSIONS", "CLICKS", "CTR", "CPC", "CPM", "CONVERSIONS", "CPA"]
        filter_ids: list of campaign/adset/ad IDs to filter
        name: report name (required by NewsBreak API — cannot be blank)

        NewsBreak returns monetary values (cost, cpc, cpa, cpm) in USD cents;
        this method converts them to dollars before returning so the frontend
        can treat them like every other platform's dollar values.
        """
        body = {
            "name": name or f"adhoc-report-{since}-{until}",
            "dateRange": "FIXED",
            "startDate": since,
            "endDate": until,
            "dimensions": dimensions or ["CAMPAIGN"],
            "metrics": metrics or ["COST", "IMPRESSION", "CLICK", "CTR", "CPC", "CPM", "CONVERSION", "CPA"],
        }
        if self.account_id:
            body["adAccountId"] = self.account_id
        if filter_ids:
            body["filterIds"] = filter_ids
        data = self._post("reports/getIntegratedReport", body)
        rows = self._extract_rows(data)
        return self._cents_to_dollars(rows)

    # Monetary fields NewsBreak returns in cents; convert to dollars.
    _MONEY_KEYS = {"cost", "spend", "spent", "cpc", "ecpc", "cpa", "cpm", "totalCost", "totalCpa"}

    @classmethod
    def _cents_to_dollars(cls, rows):
        if not isinstance(rows, list):
            return rows
        converted = []
        for row in rows:
            if not isinstance(row, dict):
                converted.append(row)
                continue
            new_row = dict(row)
            for key in list(new_row.keys()):
                if key in cls._MONEY_KEYS:
                    try:
                        new_row[key] = float(new_row[key]) / 100.0
                    except (TypeError, ValueError):
                        pass
            converted.append(new_row)
        return converted
