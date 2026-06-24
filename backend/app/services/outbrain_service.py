"""
Outbrain Amplify API service.
Docs: https://developer.outbrain.com/home-page/amplify-api/
Base URL: https://api.outbrain.com/amplify/v0.1/
Auth: Basic Auth → OB-TOKEN-V1 header (30-day token) OR pre-obtained token
"""
import requests

BASE_URL = "https://api.outbrain.com/amplify/v0.1"


class OutbrainService:
    def __init__(self, connection=None):
        self.username = None
        self.password = None
        self.account_id = None
        self.token = None

        if connection:
            self.username = connection.client_id
            self.password = connection.client_secret
            self.account_id = connection.account_id
            # If api_token is set, use it directly as the OB-TOKEN-V1
            if connection.api_token:
                self.token = connection.api_token

    def authenticate(self):
        """Login via Basic Auth or verify existing token."""
        if self.token:
            # Verify token by fetching marketers
            marketers = self.get_marketers()
            return {"authenticated": True, "marketers": len(marketers) if isinstance(marketers, list) else 0}

        if not self.username or not self.password:
            raise ValueError("Either api_token (OB-TOKEN-V1) or client_id (email) + client_secret (password) required")

        resp = requests.get(f"{BASE_URL}/login", auth=(self.username, self.password))
        if resp.status_code != 200:
            raise Exception(f"Outbrain auth failed ({resp.status_code}): {resp.text}")

        self.token = resp.json().get("OB-TOKEN-V1")
        if not self.token:
            raise Exception("Outbrain auth: no token returned")
        return {"authenticated": True}

    def _headers(self):
        if not self.token:
            self.authenticate()
        return {
            "OB-TOKEN-V1": self.token,
            "Content-Type": "application/json",
        }

    def _get(self, path, params=None):
        resp = requests.get(f"{BASE_URL}/{path}", headers=self._headers(), params=params)
        if resp.status_code == 401:
            # Token may have expired, try re-auth if credentials available
            if self.username and self.password:
                self.token = None
                self.authenticate()
                resp = requests.get(f"{BASE_URL}/{path}", headers=self._headers(), params=params)
        if resp.status_code != 200:
            raise Exception(f"Outbrain GET {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _post(self, path, data=None):
        resp = requests.post(f"{BASE_URL}/{path}", headers=self._headers(), json=data)
        if resp.status_code not in (200, 201):
            raise Exception(f"Outbrain POST {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _put(self, path, data=None):
        resp = requests.put(f"{BASE_URL}/{path}", headers=self._headers(), json=data)
        if resp.status_code != 200:
            raise Exception(f"Outbrain PUT {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    # ── Marketers ─────────────────────────────────────────────────

    def get_marketers(self):
        data = self._get("marketers")
        return data.get("marketers", data)

    # ── Campaigns ─────────────────────────────────────────────────

    def get_campaigns(self, marketer_id=None):
        mid = marketer_id or self.account_id
        if not mid:
            raise ValueError("marketer_id (account_id) is required")
        data = self._get(f"marketers/{mid}/campaigns")
        return data.get("campaigns", data)

    def get_campaign(self, campaign_id):
        return self._get(f"campaigns/{campaign_id}")

    def create_campaign(self, campaign_data, marketer_id=None):
        mid = marketer_id or self.account_id
        return self._post(f"marketers/{mid}/campaigns", campaign_data)

    def update_campaign(self, campaign_id, campaign_data):
        return self._put(f"campaigns/{campaign_id}", campaign_data)

    def update_campaign_status(self, campaign_id, enabled):
        """enabled: True (active) or False (paused)"""
        return self._put(f"campaigns/{campaign_id}", {"enabled": enabled})

    # ── PromotedLinks (Ads) ───────────────────────────────────────

    def get_promoted_links(self, campaign_id):
        data = self._get(f"campaigns/{campaign_id}/promotedLinks")
        return data.get("promotedLinks", data)

    def get_promoted_link(self, link_id):
        return self._get(f"promotedLinks/{link_id}")

    def create_promoted_link(self, campaign_id, link_data):
        return self._post(f"campaigns/{campaign_id}/promotedLinks", link_data)

    def update_promoted_link(self, link_id, link_data):
        return self._put(f"promotedLinks/{link_id}", link_data)

    def update_promoted_link_status(self, link_id, enabled):
        return self._put(f"promotedLinks/{link_id}", {"enabled": enabled})

    # ── Budgets ───────────────────────────────────────────────────

    def get_budgets(self, marketer_id=None):
        mid = marketer_id or self.account_id
        data = self._get(f"marketers/{mid}/budgets")
        return data.get("budgets", data)

    def create_budget(self, budget_data, marketer_id=None):
        mid = marketer_id or self.account_id
        return self._post(f"marketers/{mid}/budgets", budget_data)

    def update_budget(self, budget_id, budget_data):
        return self._put(f"budgets/{budget_id}", budget_data)

    # ── Reporting ─────────────────────────────────────────────────

    def get_campaign_report(self, since, until, marketer_id=None):
        """Campaign-level performance report."""
        mid = marketer_id or self.account_id
        data = self._get(f"reports/marketers/{mid}/campaigns", params={
            "from": since,
            "to": until,
            "limit": 500,
        })
        return data.get("campaignResults", data)

    def get_campaign_periodic_report(self, since, until, marketer_id=None, breakdown="daily"):
        """Daily/weekly/monthly breakdown by campaign."""
        mid = marketer_id or self.account_id
        data = self._get(f"reports/marketers/{mid}/campaigns/periodic", params={
            "from": since,
            "to": until,
            "breakdown": breakdown,
            "limit": 500,
        })
        return data.get("campaignResults", data)

    def get_promoted_links_report(self, campaign_id, since, until, marketer_id=None, breakdown="daily"):
        """Per-ad performance within a campaign."""
        mid = marketer_id or self.account_id
        data = self._get(
            f"reports/marketers/{mid}/campaigns/{campaign_id}/periodicContent",
            params={"from": since, "to": until, "breakdown": breakdown, "limit": 500},
        )
        return data.get("results", data)
