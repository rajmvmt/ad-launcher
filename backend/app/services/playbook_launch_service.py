"""
Playbook-driven ad launch service.

Loads the ads-framework SKILL.md + relevant framework files, then uses Claude
to generate ad copy + image prompts — then hands off to Higgsfield + Facebook.
"""
import json
import logging
import os
from pathlib import Path
from typing import Optional

import httpx
import anthropic

from app.core.config import settings

logger = logging.getLogger(__name__)

PLAYBOOK_DIR = Path(__file__).resolve().parent.parent.parent / "playbooks"
ADS_FRAMEWORK_DIR = PLAYBOOK_DIR / "ads-framework"

# Files loaded for every generation (core routing + voice)
SKILL_CORE_FILES = [
    "skills/hermes-ad-creation/SKILL.md",
    "00-soul/TONE_VOICE_LIBRARY.md",
    "00-soul/PERSONA_SYSTEM.md",
    "01-frameworks/PRODUCT_INTAKE.md",
    "01-frameworks/MECHANISM_ENGINEERING.md",
    "02-hook-library/HOOK_LIBRARY.md",
]

# Extra files loaded for image track
SKILL_IMAGE_FILES = [
    "01-frameworks/IMAGE_FRAMEWORK.md",
]

# Extra files loaded for video track
SKILL_VIDEO_FILES = [
    "01-frameworks/VIDEO_FRAMEWORK.md",
    "07-production/MASTER_PROMPTS_ASSEMBLY_LINE.md",
]


def _load_framework_file(relative_path: str) -> str:
    """Load a single ads-framework file, return empty string if missing."""
    path = ADS_FRAMEWORK_DIR / relative_path
    if path.exists():
        return path.read_text(encoding="utf-8")
    logger.warning(f"Framework file not found: {path}")
    return ""


def load_ads_framework(track: str = "image") -> str:
    """
    Load the relevant ads-framework files for the given track.
    Returns a combined string to inject as system context.
    """
    files = SKILL_CORE_FILES + (SKILL_IMAGE_FILES if track == "image" else SKILL_VIDEO_FILES)
    sections = []
    for rel_path in files:
        content = _load_framework_file(rel_path)
        if content:
            sections.append(f"### FILE: {rel_path}\n{content}")
    return "\n\n---\n\n".join(sections)


def load_playbook(name: str) -> str:
    path = PLAYBOOK_DIR / f"{name}.md"
    if not path.exists():
        available = [f.stem for f in PLAYBOOK_DIR.glob("*.md") if not f.stem.startswith("_")]
        raise FileNotFoundError(
            f"Playbook '{name}' not found. Available: {available}"
        )
    return path.read_text(encoding="utf-8")


def list_playbooks() -> list[str]:
    return [f.stem for f in PLAYBOOK_DIR.glob("*.md") if not f.stem.startswith("_")]


async def scrape_url(url: str) -> str:
    """Fetch a URL and extract text content."""
    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; MVMTPrinter/1.0)"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type:
                from html.parser import HTMLParser

                class TextExtractor(HTMLParser):
                    def __init__(self):
                        super().__init__()
                        self.parts = []
                        self._skip = False

                    def handle_starttag(self, tag, attrs):
                        if tag in ("script", "style", "nav", "footer", "header"):
                            self._skip = True

                    def handle_endtag(self, tag):
                        if tag in ("script", "style", "nav", "footer", "header"):
                            self._skip = False

                    def handle_data(self, data):
                        if not self._skip:
                            text = data.strip()
                            if text:
                                self.parts.append(text)

                parser = TextExtractor()
                parser.feed(resp.text)
                text = "\n".join(parser.parts)
            else:
                text = resp.text
            return text[:8000]
    except Exception as e:
        logger.warning(f"Failed to scrape {url}: {e}")
        return f"[Failed to scrape: {e}]"


async def scrape_competitors(urls: list[str]) -> str:
    """Scrape multiple competitor URLs and return combined intel."""
    results = []
    for i, url in enumerate(urls[:5]):
        content = await scrape_url(url)
        results.append(f"--- Competitor {i+1}: {url} ---\n{content}\n")
    return "\n".join(results)


def generate_ad_content(
    playbook_text: str,
    competitor_intel: str,
    offer_context: str,
    brand_name: Optional[str] = None,
    product_name: Optional[str] = None,
    track: str = "image",
) -> dict:
    """
    Use Claude + ads-framework SKILL.md to generate headline, primary_text, and image_prompt.

    Returns: {"headline": str, "primary_text": str, "image_prompt": str,
              "image_model": str, "aspect_ratio": str, "cta": str}
    """
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    framework_context = load_ads_framework(track=track)

    system_prompt = f"""You are Hermes — an elite direct-response creative strategist for Meta/Facebook ecommerce ads.

You have been given your full knowledge base below. Follow the SKILL.md routing table and execute Track 1 (Image Ads) for the product brief provided.

Key rules you must follow:
- Never freestyle. Pull frameworks, hooks, and templates directly from the knowledge base.
- Use The Constructed Authority, The Price Anchor, and Specificity rules from SKILL.md.
- Text overlays must appear within 2 seconds. Use loaded words.
- Output ONLY valid JSON — no markdown, no explanation.

JSON output fields:
- "headline": short punchy headline using a hook from HOOK_LIBRARY.md
- "primary_text": the ad body text (use the voice from TONE_VOICE_LIBRARY.md)
- "cta": call to action (SHOP_NOW, LEARN_MORE, SIGN_UP, etc.)
- "image_prompt": detailed Higgsfield image generation prompt following IMAGE_FRAMEWORK.md
- "image_model": Higgsfield model (default: soul_2)
- "aspect_ratio": 1:1 for feed, 9:16 for stories/reels
- "angle": the core angle used (1-2 words)

---

## YOUR KNOWLEDGE BASE
{framework_context}"""

    user_prompt = f"""## PRODUCT BRIEF
Brand: {brand_name or "Unknown"}
Product: {product_name or "Unknown"}

## OFFER CONTEXT
{offer_context}

## OPERATIONAL PLAYBOOK
{playbook_text}

## COMPETITOR INTEL
{competitor_intel if competitor_intel else "No competitor data available."}

Execute Track 1 (Image Ad). Generate the ad content JSON now."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    text = message.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        logger.error(f"Claude returned invalid JSON: {text[:500]}")
        raise ValueError(f"AI returned invalid JSON. Raw: {text[:200]}")

    result.setdefault("image_model", "soul_2")
    result.setdefault("aspect_ratio", "1:1")
    result.setdefault("cta", "LEARN_MORE")

    return result
