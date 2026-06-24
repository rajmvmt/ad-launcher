"""Google Ads API service — campaign management, reporting, keyword planning.

Uses the google-ads Python client library.
Requires: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN env vars.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# Config from env
CLIENT_ID = os.environ.get("GOOGLE_ADS_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_ADS_CLIENT_SECRET", "")
DEVELOPER_TOKEN = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", "")
LOGIN_CUSTOMER_ID = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")  # MCC ID without dashes

OAUTH_SCOPES = ["https://www.googleapis.com/auth/adwords"]
REDIRECT_URI = os.environ.get("GOOGLE_ADS_REDIRECT_URI", "http://localhost:8000/api/v1/google-ads/callback")


class GoogleAdsService:
    def __init__(self, refresh_token: str = None, customer_id: str = None):
        self.refresh_token = refresh_token
        self.customer_id = customer_id  # The ad account customer ID (without dashes)
        self._client = None

    @property
    def client(self):
        if not self._client:
            from google.ads.googleads.client import GoogleAdsClient
            self._client = GoogleAdsClient.load_from_dict({
                "developer_token": DEVELOPER_TOKEN,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "refresh_token": self.refresh_token,
                "login_customer_id": LOGIN_CUSTOMER_ID or None,
                "use_proto_plus": True,
            })
        return self._client

    # ── OAuth ────────────────────────────────────────────────────────

    @staticmethod
    def get_auth_url():
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {"web": {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }},
            scopes=OAUTH_SCOPES,
            redirect_uri=REDIRECT_URI,
        )
        url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
            include_granted_scopes="true",
        )
        return url

    @staticmethod
    def exchange_code(code: str) -> dict:
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {"web": {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }},
            scopes=OAUTH_SCOPES,
            redirect_uri=REDIRECT_URI,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials
        return {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "expiry": str(creds.expiry) if creds.expiry else None,
        }

    def list_accessible_customers(self) -> List[str]:
        """List all customer IDs accessible with this token."""
        customer_service = self.client.get_service("CustomerService")
        response = customer_service.list_accessible_customers()
        return [r.replace("customers/", "") for r in response.resource_names]

    # ── Campaigns ────────────────────────────────────────────────────

    def _date_range(self, since=None, until=None):
        if not since:
            since = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        if not until:
            until = datetime.now().strftime("%Y-%m-%d")
        return since, until

    def get_campaigns(self, since=None, until=None) -> List[dict]:
        since, until = self._date_range(since, until)
        ga_service = self.client.get_service("GoogleAdsService")

        query = f"""
            SELECT
                campaign.id, campaign.name, campaign.status,
                campaign.advertising_channel_type,
                campaign_budget.amount_micros,
                campaign.bidding_strategy_type,
                metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.ctr, metrics.average_cpc,
                metrics.conversions, metrics.cost_per_conversion,
                metrics.conversions_value
            FROM campaign
            WHERE segments.date BETWEEN '{since}' AND '{until}'
                AND campaign.status != 'REMOVED'
            ORDER BY metrics.cost_micros DESC
        """

        results = []
        response = ga_service.search_stream(customer_id=self.customer_id, query=query)
        for batch in response:
            for row in batch.results:
                results.append({
                    "id": str(row.campaign.id),
                    "name": row.campaign.name,
                    "status": row.campaign.status.name,
                    "channel": row.campaign.advertising_channel_type.name,
                    "daily_budget": row.campaign_budget.amount_micros / 1_000_000 if row.campaign_budget.amount_micros else 0,
                    "bid_strategy": row.campaign.bidding_strategy_type.name,
                    "impressions": row.metrics.impressions,
                    "clicks": row.metrics.clicks,
                    "spend": row.metrics.cost_micros / 1_000_000,
                    "ctr": row.metrics.ctr,
                    "avg_cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
                    "conversions": row.metrics.conversions,
                    "cost_per_conversion": row.metrics.cost_per_conversion / 1_000_000 if row.metrics.cost_per_conversion else 0,
                    "conversion_value": row.metrics.conversions_value,
                })
        return results

    def create_campaign(self, data: dict) -> dict:
        """Create a new campaign with budget."""
        campaign_service = self.client.get_service("CampaignService")
        budget_service = self.client.get_service("CampaignBudgetService")

        # Create budget first
        budget_op = self.client.get_type("CampaignBudgetOperation")
        budget = budget_op.create
        budget.name = f"{data['name']} Budget"
        budget.amount_micros = int(float(data.get("daily_budget", 20)) * 1_000_000)
        budget.delivery_method = self.client.enums.BudgetDeliveryMethodEnum.STANDARD

        budget_response = budget_service.mutate_campaign_budgets(
            customer_id=self.customer_id, operations=[budget_op]
        )
        budget_resource = budget_response.results[0].resource_name

        # Create campaign
        campaign_op = self.client.get_type("CampaignOperation")
        campaign = campaign_op.create
        campaign.name = data["name"]
        campaign.campaign_budget = budget_resource
        campaign.status = self.client.enums.CampaignStatusEnum.PAUSED

        # Set channel type
        channel = data.get("channel", "SEARCH").upper()
        if channel == "SEARCH":
            campaign.advertising_channel_type = self.client.enums.AdvertisingChannelTypeEnum.SEARCH
        elif channel == "DISPLAY":
            campaign.advertising_channel_type = self.client.enums.AdvertisingChannelTypeEnum.DISPLAY
        elif channel == "PERFORMANCE_MAX":
            campaign.advertising_channel_type = self.client.enums.AdvertisingChannelTypeEnum.PERFORMANCE_MAX

        # Bid strategy
        bid_strategy = data.get("bid_strategy", "MAXIMIZE_CONVERSIONS").upper()
        if bid_strategy == "MAXIMIZE_CONVERSIONS":
            campaign.maximize_conversions.target_cpa_micros = 0
        elif bid_strategy == "MAXIMIZE_CLICKS":
            campaign.maximize_clicks.cpc_bid_ceiling_micros = 0
        elif bid_strategy == "TARGET_CPA":
            target_cpa = float(data.get("target_cpa", 30))
            campaign.target_cpa.target_cpa_micros = int(target_cpa * 1_000_000)

        # Network settings for Search
        if channel == "SEARCH":
            campaign.network_settings.target_google_search = True
            campaign.network_settings.target_search_network = data.get("search_partners", False)

        response = campaign_service.mutate_campaigns(
            customer_id=self.customer_id, operations=[campaign_op]
        )
        resource_name = response.results[0].resource_name
        campaign_id = resource_name.split("/")[-1]

        return {"id": campaign_id, "name": data["name"], "status": "PAUSED"}

    def update_campaign(self, campaign_id: str, data: dict) -> dict:
        campaign_service = self.client.get_service("CampaignService")
        campaign_op = self.client.get_type("CampaignOperation")
        campaign = campaign_op.update

        campaign.resource_name = f"customers/{self.customer_id}/campaigns/{campaign_id}"

        field_mask = []
        if "name" in data:
            campaign.name = data["name"]
            field_mask.append("name")
        if "status" in data:
            status = data["status"].upper()
            if status == "ENABLED":
                campaign.status = self.client.enums.CampaignStatusEnum.ENABLED
            elif status == "PAUSED":
                campaign.status = self.client.enums.CampaignStatusEnum.PAUSED
            field_mask.append("status")

        campaign_op.update_mask.paths.extend(field_mask)

        campaign_service.mutate_campaigns(
            customer_id=self.customer_id, operations=[campaign_op]
        )
        return {"id": campaign_id, "updated": True}

    # ── Ad Groups ────────────────────────────────────────────────────

    def get_ad_groups(self, campaign_id: str, since=None, until=None) -> List[dict]:
        since, until = self._date_range(since, until)
        ga_service = self.client.get_service("GoogleAdsService")

        query = f"""
            SELECT
                ad_group.id, ad_group.name, ad_group.status,
                ad_group.cpc_bid_micros,
                metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.ctr, metrics.average_cpc,
                metrics.conversions, metrics.cost_per_conversion
            FROM ad_group
            WHERE campaign.id = {campaign_id}
                AND segments.date BETWEEN '{since}' AND '{until}'
                AND ad_group.status != 'REMOVED'
        """

        results = []
        response = ga_service.search_stream(customer_id=self.customer_id, query=query)
        for batch in response:
            for row in batch.results:
                results.append({
                    "id": str(row.ad_group.id),
                    "name": row.ad_group.name,
                    "status": row.ad_group.status.name,
                    "cpc_bid": row.ad_group.cpc_bid_micros / 1_000_000 if row.ad_group.cpc_bid_micros else 0,
                    "impressions": row.metrics.impressions,
                    "clicks": row.metrics.clicks,
                    "spend": row.metrics.cost_micros / 1_000_000,
                    "ctr": row.metrics.ctr,
                    "avg_cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
                    "conversions": row.metrics.conversions,
                    "cost_per_conversion": row.metrics.cost_per_conversion / 1_000_000 if row.metrics.cost_per_conversion else 0,
                })
        return results

    def create_ad_group(self, campaign_id: str, data: dict) -> dict:
        ad_group_service = self.client.get_service("AdGroupService")
        op = self.client.get_type("AdGroupOperation")
        ad_group = op.create

        ad_group.name = data["name"]
        ad_group.campaign = f"customers/{self.customer_id}/campaigns/{campaign_id}"
        ad_group.status = self.client.enums.AdGroupStatusEnum.ENABLED
        ad_group.type_ = self.client.enums.AdGroupTypeEnum.SEARCH_STANDARD

        if data.get("cpc_bid"):
            ad_group.cpc_bid_micros = int(float(data["cpc_bid"]) * 1_000_000)

        response = ad_group_service.mutate_ad_groups(
            customer_id=self.customer_id, operations=[op]
        )
        ag_id = response.results[0].resource_name.split("/")[-1]
        return {"id": ag_id, "name": data["name"]}

    def update_ad_group(self, ad_group_id: str, data: dict) -> dict:
        ad_group_service = self.client.get_service("AdGroupService")
        op = self.client.get_type("AdGroupOperation")
        ag = op.update
        ag.resource_name = f"customers/{self.customer_id}/adGroups/{ad_group_id}"

        field_mask = []
        if "name" in data:
            ag.name = data["name"]
            field_mask.append("name")
        if "status" in data:
            status = data["status"].upper()
            if status == "ENABLED":
                ag.status = self.client.enums.AdGroupStatusEnum.ENABLED
            elif status == "PAUSED":
                ag.status = self.client.enums.AdGroupStatusEnum.PAUSED
            field_mask.append("status")
        if "cpc_bid" in data:
            ag.cpc_bid_micros = int(float(data["cpc_bid"]) * 1_000_000)
            field_mask.append("cpc_bid_micros")

        op.update_mask.paths.extend(field_mask)
        ad_group_service.mutate_ad_groups(customer_id=self.customer_id, operations=[op])
        return {"id": ad_group_id, "updated": True}

    # ── Ads ──────────────────────────────────────────────────────────

    def get_ads(self, ad_group_id: str) -> List[dict]:
        ga_service = self.client.get_service("GoogleAdsService")

        query = f"""
            SELECT
                ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
                ad_group_ad.ad.responsive_search_ad.headlines,
                ad_group_ad.ad.responsive_search_ad.descriptions,
                ad_group_ad.ad.final_urls
            FROM ad_group_ad
            WHERE ad_group.id = {ad_group_id}
                AND ad_group_ad.status != 'REMOVED'
        """

        results = []
        response = ga_service.search_stream(customer_id=self.customer_id, query=query)
        for batch in response:
            for row in batch.results:
                ad = row.ad_group_ad.ad
                rsa = ad.responsive_search_ad
                results.append({
                    "id": str(ad.id),
                    "name": ad.name,
                    "status": row.ad_group_ad.status.name,
                    "headlines": [h.text for h in rsa.headlines] if rsa else [],
                    "descriptions": [d.text for d in rsa.descriptions] if rsa else [],
                    "final_urls": list(ad.final_urls),
                })
        return results

    def create_responsive_search_ad(self, ad_group_id: str, data: dict) -> dict:
        ad_group_ad_service = self.client.get_service("AdGroupAdService")
        op = self.client.get_type("AdGroupAdOperation")
        ad_group_ad = op.create

        ad_group_ad.ad_group = f"customers/{self.customer_id}/adGroups/{ad_group_id}"
        ad_group_ad.status = self.client.enums.AdGroupAdStatusEnum.ENABLED

        ad = ad_group_ad.ad
        ad.final_urls.append(data["final_url"])

        # Add headlines (max 15)
        for headline_text in data.get("headlines", [])[:15]:
            headline = self.client.get_type("AdTextAsset")
            headline.text = headline_text
            ad.responsive_search_ad.headlines.append(headline)

        # Add descriptions (max 4)
        for desc_text in data.get("descriptions", [])[:4]:
            desc = self.client.get_type("AdTextAsset")
            desc.text = desc_text
            ad.responsive_search_ad.descriptions.append(desc)

        response = ad_group_ad_service.mutate_ad_group_ads(
            customer_id=self.customer_id, operations=[op]
        )
        ad_id = response.results[0].resource_name.split("~")[-1]
        return {"id": ad_id, "created": True}

    # ── Keywords ─────────────────────────────────────────────────────

    def get_keywords(self, ad_group_id: str) -> List[dict]:
        ga_service = self.client.get_service("GoogleAdsService")

        query = f"""
            SELECT
                ad_group_criterion.criterion_id,
                ad_group_criterion.keyword.text,
                ad_group_criterion.keyword.match_type,
                ad_group_criterion.status,
                metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.conversions
            FROM keyword_view
            WHERE ad_group.id = {ad_group_id}
                AND ad_group_criterion.status != 'REMOVED'
        """

        results = []
        response = ga_service.search_stream(customer_id=self.customer_id, query=query)
        for batch in response:
            for row in batch.results:
                results.append({
                    "id": str(row.ad_group_criterion.criterion_id),
                    "text": row.ad_group_criterion.keyword.text,
                    "match_type": row.ad_group_criterion.keyword.match_type.name,
                    "status": row.ad_group_criterion.status.name,
                    "impressions": row.metrics.impressions,
                    "clicks": row.metrics.clicks,
                    "spend": row.metrics.cost_micros / 1_000_000,
                    "conversions": row.metrics.conversions,
                })
        return results

    def add_keywords(self, ad_group_id: str, keywords: List[dict]) -> dict:
        ag_criterion_service = self.client.get_service("AdGroupCriterionService")
        operations = []

        match_type_map = {
            "BROAD": self.client.enums.KeywordMatchTypeEnum.BROAD,
            "PHRASE": self.client.enums.KeywordMatchTypeEnum.PHRASE,
            "EXACT": self.client.enums.KeywordMatchTypeEnum.EXACT,
        }

        for kw in keywords:
            op = self.client.get_type("AdGroupCriterionOperation")
            criterion = op.create
            criterion.ad_group = f"customers/{self.customer_id}/adGroups/{ad_group_id}"
            criterion.status = self.client.enums.AdGroupCriterionStatusEnum.ENABLED
            criterion.keyword.text = kw["text"]
            criterion.keyword.match_type = match_type_map.get(kw.get("match_type", "BROAD").upper(),
                                                               self.client.enums.KeywordMatchTypeEnum.BROAD)
            operations.append(op)

        response = ag_criterion_service.mutate_ad_group_criteria(
            customer_id=self.customer_id, operations=operations
        )
        return {"added": len(response.results)}

    def remove_keyword(self, ad_group_id: str, criterion_id: str) -> dict:
        ag_criterion_service = self.client.get_service("AdGroupCriterionService")
        resource_name = f"customers/{self.customer_id}/adGroupCriteria/{ad_group_id}~{criterion_id}"
        op = self.client.get_type("AdGroupCriterionOperation")
        op.remove = resource_name
        ag_criterion_service.mutate_ad_group_criteria(
            customer_id=self.customer_id, operations=[op]
        )
        return {"removed": True}

    # ── Keyword Planning ─────────────────────────────────────────────

    def get_keyword_ideas(self, keywords=None, url=None, language_id="1000", location_ids=None) -> List[dict]:
        kp_service = self.client.get_service("KeywordPlanIdeaService")

        request = self.client.get_type("GenerateKeywordIdeasRequest")
        request.customer_id = self.customer_id
        request.language = f"languageConstants/{language_id}"
        request.geo_target_constants.extend(
            [f"geoTargetConstants/{loc}" for loc in (location_ids or ["2840"])]
        )
        request.keyword_plan_network = self.client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH

        if keywords:
            request.seed.keyword_seeds.keywords.extend(keywords)
        if url:
            request.seed.url_seed.url = url

        results = []
        response = kp_service.generate_keyword_ideas(request=request)
        for idea in response.results:
            metrics = idea.keyword_idea_metrics
            results.append({
                "keyword": idea.text,
                "avg_monthly_searches": metrics.avg_monthly_searches,
                "competition": metrics.competition.name,
                "low_bid": metrics.low_top_of_page_bid_micros / 1_000_000 if metrics.low_top_of_page_bid_micros else 0,
                "high_bid": metrics.high_top_of_page_bid_micros / 1_000_000 if metrics.high_top_of_page_bid_micros else 0,
            })
        return results

    # ── Reporting ────────────────────────────────────────────────────

    def get_reporting(self, since=None, until=None, level="campaign") -> dict:
        since, until = self._date_range(since, until)
        ga_service = self.client.get_service("GoogleAdsService")

        if level == "campaign":
            query = f"""
                SELECT campaign.id, campaign.name, campaign.status,
                    metrics.impressions, metrics.clicks, metrics.cost_micros,
                    metrics.conversions, metrics.cost_per_conversion,
                    metrics.ctr, metrics.average_cpc
                FROM campaign
                WHERE segments.date BETWEEN '{since}' AND '{until}'
                    AND campaign.status != 'REMOVED'
                ORDER BY metrics.cost_micros DESC
            """
        elif level == "ad_group":
            query = f"""
                SELECT ad_group.id, ad_group.name, ad_group.status,
                    campaign.name,
                    metrics.impressions, metrics.clicks, metrics.cost_micros,
                    metrics.conversions, metrics.cost_per_conversion,
                    metrics.ctr, metrics.average_cpc
                FROM ad_group
                WHERE segments.date BETWEEN '{since}' AND '{until}'
                    AND ad_group.status != 'REMOVED'
                ORDER BY metrics.cost_micros DESC
            """
        else:
            return {"items": [], "totals": {}}

        items = []
        totals = {"spend": 0, "clicks": 0, "impressions": 0, "conversions": 0}
        response = ga_service.search_stream(customer_id=self.customer_id, query=query)
        for batch in response:
            for row in batch.results:
                spend = row.metrics.cost_micros / 1_000_000
                totals["spend"] += spend
                totals["clicks"] += row.metrics.clicks
                totals["impressions"] += row.metrics.impressions
                totals["conversions"] += row.metrics.conversions

                if level == "campaign":
                    items.append({
                        "id": str(row.campaign.id), "name": row.campaign.name,
                        "status": row.campaign.status.name,
                        "spend": spend, "clicks": row.metrics.clicks,
                        "impressions": row.metrics.impressions,
                        "conversions": row.metrics.conversions,
                        "cpa": row.metrics.cost_per_conversion / 1_000_000 if row.metrics.cost_per_conversion else 0,
                        "ctr": row.metrics.ctr,
                        "avg_cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
                    })
                elif level == "ad_group":
                    items.append({
                        "id": str(row.ad_group.id), "name": row.ad_group.name,
                        "campaign_name": row.campaign.name,
                        "status": row.ad_group.status.name,
                        "spend": spend, "clicks": row.metrics.clicks,
                        "impressions": row.metrics.impressions,
                        "conversions": row.metrics.conversions,
                        "cpa": row.metrics.cost_per_conversion / 1_000_000 if row.metrics.cost_per_conversion else 0,
                        "ctr": row.metrics.ctr,
                        "avg_cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
                    })

        totals["cpa"] = totals["spend"] / totals["conversions"] if totals["conversions"] > 0 else 0
        totals["ctr"] = totals["clicks"] / totals["impressions"] * 100 if totals["impressions"] > 0 else 0
        return {"items": items, "totals": totals}
