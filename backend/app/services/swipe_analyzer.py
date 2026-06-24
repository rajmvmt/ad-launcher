"""AI-powered swipe file analysis using Gemini Flash."""
import os
import json
import httpx

try:
    from google import genai
except ImportError:
    genai = None

ANALYSIS_PROMPT = """Analyze this advertisement image and return a JSON object with the following fields.
Be specific and practical — this is for a media buyer studying winning ad creatives.

{
  "hook_type": "curiosity | fear | social_proof | authority | benefit | pain_point | contrarian | story",
  "copy_framework": "PAS | AIDA | BAB | FAB | storytelling | listicle | testimonial | direct_offer",
  "creative_style": "ugc | studio_product | lifestyle | before_after | text_overlay | meme | carousel | editorial",
  "offer_type": "free_trial | discount | free_shipping | bogo | lead_magnet | direct_sale | quiz_funnel | webinar",
  "target_audience": "brief description of who this ad targets",
  "emotional_trigger": "fear | greed | vanity | curiosity | urgency | belonging | authority | relief",
  "cta_style": "shop_now | learn_more | get_offer | sign_up | watch_video | take_quiz | claim_deal",
  "estimated_niche": "health | beauty | finance | ecommerce | saas | education | fitness | supplements | other",
  "category": "specific product/offer sub-category. Examples: neuropathy patches, detox tea, weight loss patch, telehealth GLP-1, skincare serum, ED supplements, hair loss treatment, debt relief, Medicare plans, CBD oil, foot pads, knee pain, collagen, probiotics, teeth whitening, solar panels, home insurance, pet supplements. Be specific to the actual product/service shown.",
  "color_palette": "warm | cool | neutral | bold | muted | dark | bright",
  "text_heaviness": "none | light | moderate | heavy",
  "standout_elements": "1-2 sentence description of what makes this ad effective or notable"
}

Return ONLY valid JSON, no markdown fences, no extra text."""

TEXT_ANALYSIS_PROMPT = """Analyze this advertisement copy and return a JSON object with the following fields.
Be specific and practical — this is for a media buyer studying winning ad copy.

Ad copy to analyze:
---
{text}
---

{
  "hook_type": "curiosity | fear | social_proof | authority | benefit | pain_point | contrarian | story",
  "copy_framework": "PAS | AIDA | BAB | FAB | storytelling | listicle | testimonial | direct_offer",
  "offer_type": "free_trial | discount | free_shipping | bogo | lead_magnet | direct_sale | quiz_funnel | webinar",
  "target_audience": "brief description of who this ad targets",
  "emotional_trigger": "fear | greed | vanity | curiosity | urgency | belonging | authority | relief",
  "cta_style": "shop_now | learn_more | get_offer | sign_up | watch_video | take_quiz | claim_deal",
  "estimated_niche": "health | beauty | finance | ecommerce | saas | education | fitness | supplements | other",
  "category": "specific product/offer sub-category. Examples: neuropathy patches, detox tea, weight loss patch, telehealth GLP-1, skincare serum, ED supplements, hair loss treatment, debt relief, Medicare plans, CBD oil, foot pads, knee pain, collagen, probiotics, teeth whitening, solar panels, home insurance, pet supplements. Be specific to the actual product/service mentioned.",
  "tone": "casual | professional | urgent | friendly | authoritative | playful | emotional",
  "standout_elements": "1-2 sentence description of what makes this copy effective"
}

Return ONLY valid JSON, no markdown fences, no extra text."""


def _get_gemini_client():
    """Get Gemini client with API key."""
    if genai is None:
        raise RuntimeError("google-genai package not installed")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    return genai.Client(api_key=api_key)


def _parse_json_response(text: str) -> dict:
    """Parse JSON from AI response, handling markdown fences."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    if text.startswith("json"):
        text = text[4:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Failed to parse AI response", "raw": text[:500]}


async def analyze_image_url(image_url: str) -> dict:
    """Analyze an ad image from URL using Gemini Flash vision."""
    client = _get_gemini_client()

    # Download the image
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.get(image_url)
        if resp.status_code != 200:
            return {"error": f"Failed to download image: HTTP {resp.status_code}"}
        image_data = resp.content
        content_type = resp.headers.get("content-type", "image/jpeg")
        if ";" in content_type:
            content_type = content_type.split(";")[0].strip()

    image_part = genai.types.Part.from_bytes(data=image_data, mime_type=content_type)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[image_part, ANALYSIS_PROMPT],
    )
    return _parse_json_response(response.text)


def analyze_image_bytes(image_data: bytes, mime_type: str = "image/jpeg") -> dict:
    """Analyze ad image from raw bytes using Gemini Flash vision."""
    client = _get_gemini_client()
    image_part = genai.types.Part.from_bytes(data=image_data, mime_type=mime_type)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[image_part, ANALYSIS_PROMPT],
    )
    return _parse_json_response(response.text)


def analyze_text(ad_text: str) -> dict:
    """Analyze ad copy text using Gemini Flash."""
    client = _get_gemini_client()
    prompt = TEXT_ANALYSIS_PROMPT.format(text=ad_text)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[prompt],
    )
    return _parse_json_response(response.text)


async def auto_categorize_swipe(swipe_id: str):
    """Auto-categorize a swipe file entry using AI. Runs as a fire-and-forget background task."""
    from app.database import SessionLocal
    from app.models import SwipeFile

    db = SessionLocal()
    try:
        swipe = db.query(SwipeFile).filter(SwipeFile.id == swipe_id).first()
        if not swipe:
            return

        analysis = None
        if swipe.image_url or swipe.thumbnail_url:
            url = swipe.image_url or swipe.thumbnail_url
            analysis = await analyze_image_url(url)
        elif swipe.primary_text or swipe.headline:
            text = (swipe.headline or "") + "\n\n" + (swipe.primary_text or "")
            analysis = analyze_text(text.strip())

        if analysis and "error" not in analysis:
            swipe.ai_analysis = analysis
            if analysis.get("estimated_niche") and not swipe.niche:
                swipe.niche = analysis["estimated_niche"]
            if analysis.get("category") and not swipe.category:
                swipe.category = analysis["category"]
            if analysis.get("creative_style") and not swipe.creative_type:
                swipe.creative_type = analysis["creative_style"]
            db.commit()
    except Exception as e:
        print(f"Auto-categorize failed for swipe {swipe_id}: {e}")
        db.rollback()
    finally:
        db.close()
