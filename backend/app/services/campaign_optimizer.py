"""Campaign Optimizer — AI-powered campaign management using claude -p (OAuth, no API credits)."""
import subprocess
import json
import re
import logging
from app.database import SessionLocal
from app.models import FBSyncCampaign, FBSyncAdSet, FBSyncAd
from app.services.facebook_service import FacebookService

logger = logging.getLogger(__name__)


def _call_claude(prompt: str, timeout: int = 120) -> str:
    """Call Claude — tries OAuth (free) first, falls back to API key on Railway."""
    import shutil

    # Try claude CLI with OAuth first (free, local only)
    if shutil.which('claude'):
        try:
            result = subprocess.run(
                ['env', '-u', 'ANTHROPIC_API_KEY', 'claude', '-p', '--output-format', 'text'],
                input=prompt, capture_output=True, text=True, timeout=timeout,
            )
            if result.returncode == 0 and result.stdout.strip():
                logger.info("Optimizer: used OAuth (free)")
                return result.stdout
        except Exception as e:
            logger.warning(f"OAuth call failed, trying API key: {e}")

    # Fallback: Anthropic API key (costs credits, works on Railway)
    import os
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        from app.core.config import settings
        api_key = getattr(settings, 'ANTHROPIC_API_KEY', None)

    if api_key:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        logger.warning("Optimizer: used API key — this costs credits! Run locally with Claude CLI for free OAuth.")
        return "⚠️ API_KEY_USED\n" + resp.content[0].text

    raise Exception("No authentication available — need claude CLI (OAuth) or ANTHROPIC_API_KEY")


def _parse_json(text):
    """Extract JSON from response (handle ```json blocks)."""
    text = text.strip()
    m = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    start = text.find('{')
    end = text.rfind('}') + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    return None


class CampaignOptimizer:
    def __init__(self, ad_account_id: str, connection_id: str = None):
        self.ad_account_id = ad_account_id
        self.connection_id = connection_id

    def analyze(self) -> dict:
        """Read campaign data from DB and ask Claude to analyze it."""
        db = SessionLocal()
        # Normalize account ID
        plain_id = self.ad_account_id.replace('act_', '')

        campaigns = db.query(FBSyncCampaign).filter(
            FBSyncCampaign.ad_account_id == plain_id
        ).all()

        ads = db.query(FBSyncAd).filter(
            FBSyncAd.ad_account_id == plain_id
        ).all()
        db.close()

        # Build campaign summary for Claude
        campaign_data = []
        for c in campaigns:
            spend = float(c.spend or 0)
            results = int(c.results or 0)
            cpa = spend / results if results > 0 else 0
            revenue = float(c.purchase_revenue or 0)
            roas = revenue / spend if spend > 0 else 0
            campaign_data.append({
                'id': c.fb_campaign_id,
                'name': c.name,
                'status': c.effective_status,
                'spend': round(spend, 2),
                'results': results,
                'cpa': round(cpa, 2),
                'revenue': round(revenue, 2),
                'roas': round(roas, 2),
                'impressions': c.impressions,
                'clicks': c.clicks,
                'ctr': c.ctr,
            })

        ad_data = []
        for a in ads:
            spend = float(a.spend or 0)
            results = int(a.results or 0)
            cpa = spend / results if results > 0 else 0
            ad_data.append({
                'id': a.fb_ad_id,
                'name': a.name,
                'campaign_id': a.fb_campaign_id,
                'status': a.effective_status,
                'spend': round(spend, 2),
                'results': results,
                'cpa': round(cpa, 2),
            })

        # Sort by spend descending
        campaign_data.sort(key=lambda x: x['spend'], reverse=True)
        ad_data.sort(key=lambda x: x['spend'], reverse=True)

        prompt = f"""You are an expert Facebook media buyer analyzing campaign performance data. Analyze this data and provide specific, actionable optimization recommendations.

CAMPAIGN DATA (sorted by spend):
{json.dumps(campaign_data, indent=2)}

TOP ADS BY SPEND:
{json.dumps(ad_data[:30], indent=2)}

Analyze and return JSON with this structure:
{{
    "summary": "2-3 sentence overall account health assessment",
    "total_spend": X,
    "total_results": X,
    "avg_cpa": X,
    "recommendations": [
        {{
            "action": "pause|scale|adjust_budget|monitor",
            "object_type": "campaign|ad",
            "object_id": "...",
            "object_name": "...",
            "reason": "Why this action should be taken",
            "priority": "high|medium|low",
            "details": "Specific details like new budget amount"
        }}
    ],
    "top_performers": [
        {{"id": "...", "name": "...", "why": "..."}}
    ],
    "worst_performers": [
        {{"id": "...", "name": "...", "why": "..."}}
    ]
}}

Rules:
- Campaigns with $0 spend and no results: recommend "monitor" not "pause" (they might be new)
- High CPA (>2x account average): recommend "pause" or "adjust_budget"
- Low CPA + good volume: recommend "scale" with suggested budget increase
- Consider ROAS if revenue data is available
- Be specific with budget recommendations (actual dollar amounts)
- Limit to top 10 most impactful recommendations"""

        response = _call_claude(prompt)
        used_api_key = response.startswith("⚠️ API_KEY_USED")
        if used_api_key:
            response = response.replace("⚠️ API_KEY_USED\n", "", 1)

        analysis = _parse_json(response)

        if not analysis:
            return {"error": "Failed to parse analysis", "raw": response[:500]}

        analysis["billing"] = "api_key" if used_api_key else "oauth"
        return analysis

    def execute_recommendation(self, rec: dict, service: FacebookService) -> dict:
        """Execute a single recommendation (pause, scale, etc.)."""
        action = rec.get('action')
        obj_type = rec.get('object_type', 'campaign')
        obj_id = rec.get('object_id')

        if not obj_id:
            return {"error": "No object_id"}

        try:
            if action == 'pause':
                service.update_object_status(obj_id, obj_type, 'PAUSED')
                return {"success": True, "action": "paused", "id": obj_id}
            elif action == 'scale':
                # Extract budget from details
                details = rec.get('details', '')
                # For now just return the recommendation, don't auto-scale
                return {"success": True, "action": "scale_recommended", "id": obj_id, "details": details}
            elif action == 'adjust_budget':
                return {"success": True, "action": "budget_adjustment_recommended", "id": obj_id, "details": rec.get('details', '')}
            else:
                return {"action": "no_action", "id": obj_id}
        except Exception as e:
            return {"error": str(e), "id": obj_id}
