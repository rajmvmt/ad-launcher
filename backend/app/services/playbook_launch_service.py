"""
Playbook-driven ad launch service.

Scrapes competitor URLs, loads a playbook, and uses Gemini to generate
ad copy + image prompts — then hands off to Higgsfield + Facebook.
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
) -> dict:
    """
    Use Claude to generate headline, primary_text, and image_prompt
    based on the playbook rules, competitor intel, and offer context.

    Returns: {"headline": str, "primary_text": str, "image_prompt": str,
              "image_model": str, "aspect_ratio": str, "cta": str}
    """
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    system_prompt = """You are an expert Facebook ad copywriter and creative director.
You will be given:
1. A PLAYBOOK with rules for writing copy and generating images
2. COMPETITOR INTEL scraped from competitor ads/pages
3. OFFER CONTEXT about the product/offer being advertised

Your job: generate Facebook ad content following the playbook rules exactly.

Output ONLY valid JSON with these fields:
- "headline": short punchy headline (follow playbook length rules)
- "primary_text": the ad body text (follow playbook tone and length rules)
- "cta": call to action type (SHOP_NOW, LEARN_MORE, SIGN_UP, etc.)
- "image_prompt": a detailed image generation prompt following the playbook Image Style section
- "image_model": the Higgsfield model specified in the playbook (default: soul_2)
- "aspect_ratio": from the playbook (default: 1:1)

Study the competitor intel to understand what angles and hooks work in this space,
then create something BETTER using the playbook rules. Output raw JSON only, no markdown."""

    user_prompt = f"""## PLAYBOOK
{playbook_text}

## COMPETITOR INTEL
{competitor_intel if competitor_intel else "No competitor data available."}

## OFFER CONTEXT
{offer_context}
{f"Brand: {brand_name}" if brand_name else ""}
{f"Product: {product_name}" if product_name else ""}

Generate the ad content JSON now."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
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
