"""Deep AI analysis of ad creatives — two-pass Gemini vision + Claude strategy."""
import os
import json
import httpx

try:
    from google import genai
except ImportError:
    genai = None

try:
    import anthropic
except ImportError:
    anthropic = None

from app.services.swipe_analyzer import _parse_json_response

# ── Pass 1: Gemini Flash Vision ─────────────────────────────────────

VISUAL_ANALYSIS_PROMPT = """You are an expert ad creative analyst working for a performance marketing agency. Analyze this advertisement with extreme precision.

Return ONLY valid JSON with this exact structure:

{
  "layout_type": "ugc_selfie | product_hero | before_after | text_overlay | lifestyle | split_screen | carousel | talking_head | slideshow | demonstration",
  "dominant_colors": ["#hex1", "#hex2", "#hex3"],
  "color_strategy": "1-2 sentences: What mood do the colors create? Warm/cool? High/low contrast? How do they serve the ad's goal?",
  "focal_point": "Where does the eye go first? What visual hierarchy is created?",
  "text_in_image": "Transcribe ALL text visible in the image/video exactly as shown. If none, say 'None'.",
  "text_placement": "Where is text positioned? How large? What font style? Overlay or bar?",
  "thumbnail_scroll_stop": "Would this stop a thumb-scroll in a Facebook feed? Why or why not? Be brutally honest.",
  "visual_hooks": ["List each specific visual element that grabs attention"],
  "production_quality": "ugc_raw | ugc_polished | semi_pro | professional | studio",
  "subject_matter": "What is physically shown? Describe the product, person, setting in detail.",
  "brand_elements": "Any logos, brand colors, watermarks visible. If none, say 'None'.",
  "recreate_instructions": "Detailed step-by-step instructions for recreating a similar visual. Include: subject, setting, lighting, camera angle, color grading, text overlay style, and any props. Be specific enough that an AI image generator could reproduce this style.",
  "video_specific": null
}

If this is a VIDEO, also fill in video_specific:
{
  "video_specific": {
    "estimated_duration_seconds": 30,
    "hook_window": "Describe exactly what happens in the first 0-3 seconds",
    "pacing_description": "Fast cuts / slow build / talking head / b-roll heavy / etc.",
    "audio_description": "Music type, voiceover style, sound effects. If no audio detected, say so.",
    "transcript_highlights": "Key phrases spoken or shown as text overlays",
    "scene_breakdown": "Brief description of each major scene/section",
    "retention_techniques": "What techniques keep the viewer watching?"
  }
}

Be specific, not generic. "White sans-serif bold text centered on a dark navy blue gradient background with a thin gold border" is good. "Text overlay on blue background" is bad.

Return ONLY valid JSON, no markdown fences."""


# ── Pass 2: Claude Sonnet Strategic Analysis ─────────────────────────

STRATEGIC_ANALYSIS_PROMPT = """You are a world-class direct response advertising strategist who has spent 20 years studying what makes ads convert. You combine the analytical mind of Claude Hopkins with the persuasion instincts of Gary Halbert and the data-driven approach of a modern performance marketer.

You are analyzing a competitor's ad to understand exactly WHY it works and HOW to replicate its strategy for a different brand/product.

## THE AD BEING ANALYZED:

**Headline:** {headline}
**Primary Text (Body Copy):** {primary_text}
**CTA:** {cta_text}
**Description:** {description}

**Visual Analysis (from AI vision):**
{visual_analysis_json}

## YOUR TASK:

Produce a comprehensive strategic analysis. Return ONLY valid JSON:

{{
  "hook_analysis": {{
    "hook_text": "The exact first line or visual element that stops the scroll",
    "hook_type": "curiosity | fear | social_proof | authority | benefit | pain_point | contrarian | story | question | statistic | bold_claim",
    "why_it_works": "2-3 sentences explaining the psychological mechanism. Be specific — don't just say 'it creates curiosity.' Explain HOW and what unresolved tension it opens.",
    "hook_strength_score": 8,
    "improvement_suggestions": "How could this hook be stronger? Give a specific rewritten example."
  }},
  "copy_strategy": {{
    "framework_used": "PAS | AIDA | BAB | FAB | storytelling | listicle | testimonial | direct_offer | hybrid",
    "framework_breakdown": "Walk through the copy paragraph by paragraph, labeling each section: 'Lines 1-2: Hook (fear-based pattern interrupt). Lines 3-5: Problem amplification...' etc.",
    "headline_analysis": "Which of the 7 Laws of DR Headlines does this use? (Open Loop, Pain Amplification, Mechanism Framing, Specificity, Simplicity, Credibility, Time Compression). Explain how.",
    "body_structure": "The architectural blueprint of the copy: how many sections, what each does, how they flow.",
    "cta_analysis": "Is the CTA strong? Does it add urgency or value? Could it be better?",
    "tone_voice": "Describe the voice like a person: 'Warm but authoritative grandmother who uses short sentences and specific numbers to build credibility.'",
    "power_words_used": ["list", "every", "specific", "power", "word"],
    "copy_length_assessment": "Is the copy the right length for its funnel position? TOFU cold traffic needs 8-15 lines. Assess fit."
  }},
  "psychological_triggers": {{
    "primary_trigger": "The ONE dominant lever (fear, greed, vanity, curiosity, urgency, belonging, authority, relief, identity)",
    "primary_trigger_explanation": "Exactly how this trigger is deployed in THIS specific ad.",
    "secondary_triggers": [
      {{"trigger": "name", "how_used": "Specific explanation"}}
    ],
    "persuasion_sequence": "The order in which elements build: 'Opens with FEAR, transitions to AUTHORITY, builds HOPE, closes with URGENCY'",
    "objection_handling": "List each objection the ad handles and how."
  }},
  "audience_signals": {{
    "primary_audience": "Detailed 2-3 sentence description of who this ad targets",
    "age_range": "e.g. 55-75",
    "gender_skew": "female | male | neutral",
    "awareness_level": "unaware | problem_aware | solution_aware | product_aware | most_aware",
    "pain_points_targeted": ["specific pain 1", "specific pain 2"],
    "desires_targeted": ["desire 1", "desire 2"],
    "targeting_suggestions": "Facebook targeting recommendations: specific interests, behaviors, lookalikes. Be specific."
  }},
  "competitive_intel": {{
    "estimated_niche": "The broad vertical",
    "specific_category": "The specific product sub-category (e.g. 'EMS neuropathy device' not 'health product')",
    "offer_structure": "What is being offered? Price, bundles, guarantees, risk reversal.",
    "funnel_position": "tofu | mofu | bofu",
    "compliance_risk": "low | medium | high",
    "compliance_notes": "Any specific compliance concerns"
  }},
  "why_it_works_summary": "3-5 paragraphs. Cover: (1) Hook and why it stops the scroll, (2) Emotional journey the copy creates, (3) Persuasion architecture — how triggers, objections, and proof stack, (4) Visual-copy synergy, (5) What to keep, change, and test.",
  "recreation_blueprint": {{
    "visual_prompt": "Detailed AI image generation prompt to create a similar visual for a DIFFERENT product. Include: subject, setting, lighting, camera angle, mood, color palette, text overlay instructions.",
    "copy_template": "Fill-in-the-blank template following the same framework: '[HOOK: Fear-based question about {{CONDITION}}]\\n\\n[PAIN: 2-3 sentences about {{PROBLEM}}]\\n\\n[CTA: Urgency + link]'",
    "headline_formulas": ["3 headline formulas with {{PLACEHOLDERS}} for adaptation"],
    "key_elements_to_keep": ["structural elements that drive effectiveness"],
    "elements_to_vary": ["what to test differently"]
  }},
  "scores": {{
    "overall": 8,
    "hook_strength": 9,
    "copy_quality": 7,
    "visual_impact": 8,
    "offer_strength": 6,
    "audience_match": 8,
    "compliance_safety": 7
  }}
}}

CRITICAL RULES:
- Be SPECIFIC to THIS ad. Every insight must be grounded in the actual content.
- "This ad uses social proof" is worthless. "This ad uses social proof by citing '2 million Americans' — a number large enough for bandwagon effect but specific enough to feel real" is good.
- The why_it_works_summary should let a junior media buyer understand and replicate the strategy.
- The recreation_blueprint should let someone create a competing ad without seeing the original.
- Return ONLY valid JSON, no markdown fences."""


# ── Create Similar Copy Prompt ───────────────────────────────────────

CREATE_SIMILAR_PROMPT = """You are recreating the strategy of a proven winning ad for a new brand/product. You have a detailed analysis of what made the original work. Apply the same psychological architecture, copy framework, and persuasion sequence — but with completely new content.

## ORIGINAL AD ANALYSIS:

**Hook Strategy:** {hook_analysis}
**Copy Framework:** {framework_used} — {framework_breakdown}
**Psychological Triggers:** Primary: {primary_trigger}. Sequence: {persuasion_sequence}
**Copy Template:** {copy_template}
**Headline Formulas:** {headline_formulas}
**Key Elements to Keep:** {key_elements_to_keep}
**Elements to Vary:** {elements_to_vary}

## YOUR BRAND/PRODUCT:

**Brand:** {brand_name} — Voice: {brand_voice}
**Product:** {product_name} — {product_description}
**Target Audience:** {profile_demographics} — Pain Points: {pain_points} — Goals: {goals}

## GENERATE {variation_count} VARIATIONS

Each variation must:
1. Follow the SAME copy framework as the original ({framework_used})
2. Use the SAME persuasion sequence applied to YOUR product
3. Apply the headline formulas to YOUR product
4. Keep the key elements but vary hooks, angles, emotional triggers
5. Match your brand voice while maintaining DR effectiveness
6. Write LONG body copy (8-15 lines minimum for cold traffic TOFU)
7. Use contractions, short punchy sentences, line breaks
8. Include emotional weight words: "suffering", "desperate", "finally", "relief"
9. NEVER use: "unlock", "revolutionize", "game-changer", "transform", "journey", "discover", "say goodbye to"

Return ONLY valid JSON:
{{
  "variations": [
    {{
      "headline": "Under 40 chars, uses formula from analysis",
      "body": "Full primary text, 8-15 lines, follows the framework and persuasion sequence",
      "cta": "Under 20 chars, compelling action",
      "angle": "Brief description of the angle used"
    }}
  ]
}}

Return ONLY valid JSON, no markdown fences."""


# ── Helper Functions ─────────────────────────────────────────────────

def _get_gemini_client():
    if genai is None:
        raise RuntimeError("google-genai package not installed")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    return genai.Client(api_key=api_key)


def _get_anthropic_client():
    if anthropic is None:
        raise RuntimeError("anthropic package not installed")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    return anthropic.Anthropic(api_key=api_key)


# ── Pass 1: Gemini Vision ───────────────────────────────────────────

async def _gemini_visual_analysis(image_url: str = None, video_url: str = None,
                                   image_data: bytes = None, mime_type: str = None) -> dict:
    """Analyze ad visual with Gemini Flash."""
    client = _get_gemini_client()

    if image_data:
        media_part = genai.types.Part.from_bytes(data=image_data, mime_type=mime_type or "image/jpeg")
    elif image_url:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(image_url)
            if resp.status_code != 200:
                return {"error": f"Failed to download image: HTTP {resp.status_code}"}
            data = resp.content
            ct = resp.headers.get("content-type", "image/jpeg")
            if ";" in ct:
                ct = ct.split(";")[0].strip()
        media_part = genai.types.Part.from_bytes(data=data, mime_type=ct)
    elif video_url:
        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.get(video_url)
            if resp.status_code != 200:
                return {"error": f"Failed to download video: HTTP {resp.status_code}"}
            data = resp.content
            ct = resp.headers.get("content-type", "video/mp4")
            if ";" in ct:
                ct = ct.split(";")[0].strip()
        media_part = genai.types.Part.from_bytes(data=data, mime_type=ct)
    else:
        return {"error": "No image or video provided"}

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[media_part, VISUAL_ANALYSIS_PROMPT],
    )
    return _parse_json_response(response.text)


# ── Pass 2: Claude Strategic Analysis ────────────────────────────────

async def _claude_strategic_analysis(visual_analysis: dict,
                                      headline: str = None,
                                      primary_text: str = None,
                                      cta_text: str = None,
                                      description: str = None) -> dict:
    """Deep strategic analysis with Claude Sonnet."""
    client = _get_anthropic_client()

    prompt = STRATEGIC_ANALYSIS_PROMPT.format(
        headline=headline or "Not provided",
        primary_text=primary_text or "Not provided",
        cta_text=cta_text or "Not provided",
        description=description or "Not provided",
        visual_analysis_json=json.dumps(visual_analysis, indent=2),
    )

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_json_response(response.content[0].text)


# ── Main Analysis Entry Point ────────────────────────────────────────

async def deep_analyze_ad(image_url: str = None, video_url: str = None,
                           headline: str = None, primary_text: str = None,
                           cta_text: str = None, description: str = None,
                           image_data: bytes = None, mime_type: str = None) -> dict:
    """Run two-pass deep analysis. Returns full analysis JSON."""

    # Pass 1: Gemini vision
    print("[deep_analyzer] Pass 1: Gemini visual analysis...")
    visual = await _gemini_visual_analysis(
        image_url=image_url, video_url=video_url,
        image_data=image_data, mime_type=mime_type,
    )
    if "error" in visual:
        return {"error": f"Visual analysis failed: {visual['error']}"}

    # Pass 2: Claude strategy
    print("[deep_analyzer] Pass 2: Claude strategic analysis...")
    strategy = await _claude_strategic_analysis(
        visual_analysis=visual,
        headline=headline,
        primary_text=primary_text,
        cta_text=cta_text,
        description=description,
    )
    if "error" in strategy:
        return {"error": f"Strategic analysis failed: {strategy['error']}"}

    # Merge visual + strategy into single result
    result = {
        "visual_strategy": visual,
        **strategy,
    }

    # Pull video_specific from visual into top-level if present
    if visual.get("video_specific"):
        result["video_analysis"] = visual.pop("video_specific")

    return result


# ── Create Similar Copy ──────────────────────────────────────────────

async def generate_similar_copy(deep_analysis: dict, brand: dict, product: dict,
                                 profile: dict, variation_count: int = 3,
                                 model: str = "sonnet") -> dict:
    """Generate ad copy variations based on deep analysis + brand context."""

    hook = deep_analysis.get("hook_analysis", {})
    copy_strat = deep_analysis.get("copy_strategy", {})
    psych = deep_analysis.get("psychological_triggers", {})
    blueprint = deep_analysis.get("recreation_blueprint", {})

    prompt = CREATE_SIMILAR_PROMPT.format(
        hook_analysis=json.dumps(hook),
        framework_used=copy_strat.get("framework_used", "PAS"),
        framework_breakdown=copy_strat.get("framework_breakdown", ""),
        primary_trigger=psych.get("primary_trigger", ""),
        persuasion_sequence=psych.get("persuasion_sequence", ""),
        copy_template=blueprint.get("copy_template", ""),
        headline_formulas=json.dumps(blueprint.get("headline_formulas", [])),
        key_elements_to_keep=json.dumps(blueprint.get("key_elements_to_keep", [])),
        elements_to_vary=json.dumps(blueprint.get("elements_to_vary", [])),
        brand_name=brand.get("name", ""),
        brand_voice=brand.get("voice", ""),
        product_name=product.get("name", ""),
        product_description=product.get("description", ""),
        profile_demographics=profile.get("demographics", ""),
        pain_points=profile.get("pain_points", ""),
        goals=profile.get("goals", ""),
        variation_count=variation_count,
    )

    CLAUDE_MODELS = {
        "sonnet": "claude-sonnet-4-5-20250929",
        "haiku": "claude-haiku-4-5-20251001",
        "group_voice": "claude-sonnet-4-5-20250929",
    }

    if model in ("sonnet", "haiku", "group_voice"):
        client = _get_anthropic_client()
        response = client.messages.create(
            model=CLAUDE_MODELS.get(model, CLAUDE_MODELS["sonnet"]),
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        return _parse_json_response(response.content[0].text)
    else:
        # Gemini fallback
        gemini = _get_gemini_client()
        response = gemini.models.generate_content(
            model="gemini-2.0-flash",
            contents=[prompt],
        )
        return _parse_json_response(response.text)


# ── Image Prompt Builder ─────────────────────────────────────────────

def build_image_generation_prompt(deep_analysis: dict, brand: dict, product: dict) -> str:
    """Build a fal.ai image prompt from the recreation blueprint + brand context."""
    blueprint = deep_analysis.get("recreation_blueprint", {})
    visual = deep_analysis.get("visual_strategy", {})

    base_prompt = blueprint.get("visual_prompt", "")
    if not base_prompt:
        base_prompt = visual.get("recreate_instructions", "Professional advertising image")

    brand_context = f" for {brand.get('name', 'the brand')}"
    product_context = f" featuring {product.get('name', 'the product')}: {product.get('description', '')}"
    quality = " High quality, photorealistic, 4k, advertising standard."

    return base_prompt + brand_context + product_context + quality
