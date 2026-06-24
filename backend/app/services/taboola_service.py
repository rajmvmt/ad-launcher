"""
Taboola Backstage API service.
Docs: https://developers.taboola.com/backstage-api/reference/welcome
Base URL: https://backstage.taboola.com/backstage/api/1.0/
Auth: OAuth 2.0 Client Credentials
"""
import requests
from datetime import datetime, timedelta


BASE_URL = "https://backstage.taboola.com/backstage/api/1.0"
TOKEN_URL = "https://backstage.taboola.com/backstage/oauth/token"


class TaboolaService:
    def __init__(self, connection=None):
        self.client_id = None
        self.client_secret = None
        self.account_id = None
        self.access_token = None
        self.token_expires_at = None

        if connection:
            self.client_id = connection.client_id
            self.client_secret = connection.client_secret
            self.account_id = connection.account_id

    def authenticate(self):
        """Obtain OAuth2 access token using client credentials."""
        if not self.client_id or not self.client_secret:
            raise ValueError("client_id and client_secret are required for Taboola auth")

        resp = requests.post(TOKEN_URL, data={
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "client_credentials",
        })
        if resp.status_code != 200:
            raise Exception(f"Taboola auth failed ({resp.status_code}): {resp.text}")

        data = resp.json()
        self.access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        self.token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in - 60)

    def _ensure_auth(self):
        if not self.access_token or (self.token_expires_at and datetime.utcnow() >= self.token_expires_at):
            self.authenticate()

    def _headers(self):
        self._ensure_auth()
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _get(self, path, params=None):
        resp = requests.get(f"{BASE_URL}/{path}", headers=self._headers(), params=params)
        if resp.status_code != 200:
            raise Exception(f"Taboola GET {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _post(self, path, data=None):
        resp = requests.post(f"{BASE_URL}/{path}", headers=self._headers(), json=data)
        if resp.status_code not in (200, 201):
            raise Exception(f"Taboola POST {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _put(self, path, data=None):
        resp = requests.put(f"{BASE_URL}/{path}", headers=self._headers(), json=data)
        if resp.status_code != 200:
            raise Exception(f"Taboola PUT {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _delete(self, path):
        resp = requests.delete(f"{BASE_URL}/{path}", headers=self._headers())
        if resp.status_code not in (200, 204):
            raise Exception(f"Taboola DELETE {path} failed ({resp.status_code}): {resp.text}")
        return {"deleted": True}

    # ── Campaigns ──────────────────────────────────────────────────

    def get_campaigns(self, account_id=None):
        acct = account_id or self.account_id
        data = self._get(f"{acct}/campaigns/")
        return data.get("results", data) if isinstance(data, dict) else data

    def get_campaign(self, campaign_id, account_id=None):
        acct = account_id or self.account_id
        return self._get(f"{acct}/campaigns/{campaign_id}/")

    def create_campaign(self, campaign_data, account_id=None):
        acct = account_id or self.account_id
        return self._post(f"{acct}/campaigns/", campaign_data)

    def update_campaign(self, campaign_id, campaign_data, account_id=None):
        acct = account_id or self.account_id
        return self._put(f"{acct}/campaigns/{campaign_id}/", campaign_data)

    def delete_campaign(self, campaign_id, account_id=None):
        acct = account_id or self.account_id
        return self._delete(f"{acct}/campaigns/{campaign_id}/")

    # ── Campaign Items (Ads) ──────────────────────────────────────

    def get_campaign_items(self, campaign_id, account_id=None):
        acct = account_id or self.account_id
        data = self._get(f"{acct}/campaigns/{campaign_id}/items/")
        return data.get("results", data) if isinstance(data, dict) else data

    def get_campaign_item(self, campaign_id, item_id, account_id=None):
        acct = account_id or self.account_id
        return self._get(f"{acct}/campaigns/{campaign_id}/items/{item_id}/")

    def create_campaign_item(self, campaign_id, item_data, account_id=None):
        acct = account_id or self.account_id
        return self._post(f"{acct}/campaigns/{campaign_id}/items/", item_data)

    def update_campaign_item(self, campaign_id, item_id, item_data, account_id=None):
        acct = account_id or self.account_id
        return self._put(f"{acct}/campaigns/{campaign_id}/items/{item_id}/", item_data)

    def delete_campaign_item(self, campaign_id, item_id, account_id=None):
        acct = account_id or self.account_id
        return self._delete(f"{acct}/campaigns/{campaign_id}/items/{item_id}/")

    # ── Reporting ─────────────────────────────────────────────────

    def get_campaign_summary_report(self, since, until, account_id=None):
        """
        Campaign summary report with performance metrics.
        since/until: YYYY-MM-DD strings
        """
        acct = account_id or self.account_id
        data = self._get(
            f"{acct}/reports/campaign-summary/dimensions/campaign_breakdown",
            params={"start_date": since, "end_date": until},
        )
        return data.get("results", data) if isinstance(data, dict) else data

    def get_top_campaign_content_report(self, campaign_id, since, until, account_id=None):
        acct = account_id or self.account_id
        data = self._get(
            f"{acct}/reports/top-campaign-content/dimensions/item_breakdown",
            params={
                "start_date": since,
                "end_date": until,
                "campaign": campaign_id,
            },
        )
        return data.get("results", data) if isinstance(data, dict) else data
