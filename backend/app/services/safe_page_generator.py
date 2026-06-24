"""Safe Page Generator — AI-powered compliant landing page builder."""
import os
import io
import re
import json
import random
import string
import zipfile
import logging
from typing import Optional
from datetime import datetime

try:
    from google import genai
except ImportError:
    genai = None

logger = logging.getLogger(__name__)

# ── Theme → topic mapping ─────────────────────────────
THEMES = {
    "health": ["wellness tips", "healthy living", "nutrition advice", "fitness routines", "mental health"],
    "finance": ["personal finance", "investing basics", "budgeting tips", "retirement planning", "credit scores"],
    "tech": ["gadget reviews", "software tutorials", "cybersecurity tips", "AI trends", "app recommendations"],
    "lifestyle": ["home decor", "travel tips", "productivity hacks", "self-improvement", "cooking recipes"],
    "fitness": ["workout routines", "yoga guides", "running tips", "gym equipment reviews", "sports nutrition"],
    "beauty": ["skincare routines", "makeup tutorials", "hair care tips", "product reviews", "anti-aging advice"],
    "education": ["study tips", "online courses", "career development", "language learning", "skill building"],
    "food": ["recipe collections", "restaurant reviews", "meal planning", "cooking techniques", "food photography"],
    "travel": ["destination guides", "travel hacks", "budget travel", "adventure activities", "packing tips"],
    "parenting": ["child development", "parenting advice", "family activities", "education tips", "health for kids"],
    "pets": ["pet care tips", "dog training", "cat health", "pet nutrition", "pet product reviews"],
    "gardening": ["plant care", "garden design", "indoor gardening", "organic growing", "seasonal planting"],
    "diy": ["home improvement", "craft projects", "woodworking", "upcycling ideas", "repair guides"],
    "automotive": ["car reviews", "maintenance tips", "driving safety", "electric vehicles", "car accessories"],
    "sports": ["game analysis", "training tips", "sports news", "equipment reviews", "fan guides"],
}

LANGUAGES = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian",
    "pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "ru": "Russian", "ja": "Japanese",
    "ko": "Korean", "zh": "Chinese", "ar": "Arabic", "hi": "Hindi", "tr": "Turkish",
    "sv": "Swedish", "no": "Norwegian", "da": "Danish", "fi": "Finnish", "cs": "Czech",
    "ro": "Romanian", "hu": "Hungarian", "el": "Greek", "th": "Thai", "vi": "Vietnamese",
    "id": "Indonesian", "ms": "Malay", "tl": "Filipino", "uk": "Ukrainian", "bg": "Bulgarian",
    "hr": "Croatian", "sk": "Slovak", "sl": "Slovenian", "lt": "Lithuanian", "lv": "Latvian",
    "et": "Estonian", "he": "Hebrew", "fa": "Persian", "bn": "Bengali", "ta": "Tamil",
    "te": "Telugu", "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam",
    "sw": "Swahili", "af": "Afrikaans", "ca": "Catalan", "sr": "Serbian",
}


def _get_gemini_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    return genai.Client(api_key=api_key)


def _random_class(length=8):
    """Generate a random CSS class name."""
    return ''.join(random.choices(string.ascii_lowercase, k=length))


def _randomize_html(html: str) -> str:
    """Randomize CSS class names and add structural variation for uniqueness."""
    # Generate unique class names for this generation
    classes = {
        'container': _random_class(),
        'header': _random_class(),
        'nav': _random_class(),
        'main': _random_class(),
        'article': _random_class(),
        'sidebar': _random_class(),
        'footer': _random_class(),
        'card': _random_class(),
        'title': _random_class(),
        'content': _random_class(),
        'meta': _random_class(),
        'btn': _random_class(),
    }
    for original, replacement in classes.items():
        html = html.replace(f'class="{original}"', f'class="{replacement}"')
        html = html.replace(f'.{original}', f'.{replacement}')

    # Add random invisible elements for structural uniqueness
    invisible_div = f'<div style="position:absolute;left:-9999px;font-size:0">{_random_class(16)}</div>'
    html = html.replace('</body>', f'{invisible_div}\n</body>')

    # Randomize whitespace slightly
    html = html.replace('  ', ' ' + ' ' * random.randint(1, 3))

    return html


async def generate_articles(theme: str, keywords: str, language: str, num_articles: int = 5) -> list[dict]:
    """Use Gemini Flash to generate blog articles for the safe page."""
    client = _get_gemini_client()

    topics = THEMES.get(theme, THEMES["lifestyle"])
    topic_str = ", ".join(random.sample(topics, min(3, len(topics))))
    keyword_str = keywords if keywords else topic_str

    lang_name = LANGUAGES.get(language, "English")

    prompt = f"""Generate {num_articles} unique blog articles for a {topic_str} website.
Keywords to incorporate naturally: {keyword_str}

For each article, return a JSON array where each element has:
- "title": catchy, SEO-friendly headline
- "excerpt": 1-2 sentence summary
- "body": 3-4 paragraphs of genuine, helpful content (HTML formatted with <p> tags)
- "author": realistic author name
- "date": date in format "Month DD, YYYY" (use dates from the past 2 months)
- "category": article category
- "read_time": estimated read time like "5 min read"

Write in {lang_name}. Make the content genuinely useful and natural — not salesy or promotional.
The articles should read like a real blog that someone actually maintains.

Return ONLY valid JSON array, no markdown fences."""

    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt
        )
        text = response.text.strip()
        # Clean markdown fences if present
        if text.startswith("```"):
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
        articles = json.loads(text)
        return articles
    except Exception as e:
        logger.error(f"Gemini article generation failed: {e}")
        # Return fallback articles
        return _fallback_articles(theme, num_articles)


def _fallback_articles(theme: str, count: int) -> list[dict]:
    """Generate basic fallback articles without AI."""
    topics = THEMES.get(theme, THEMES["lifestyle"])
    articles = []
    for i in range(count):
        topic = topics[i % len(topics)]
        articles.append({
            "title": f"Essential Guide to {topic.title()}",
            "excerpt": f"Discover the latest insights and tips about {topic}.",
            "body": f"<p>In today's fast-paced world, understanding {topic} has become more important than ever. Whether you're a beginner or experienced, there's always something new to learn.</p><p>Our team of experts has compiled the most up-to-date information to help you make informed decisions. From practical tips to in-depth analysis, we cover everything you need to know.</p><p>Stay tuned for more updates as we continue to bring you the best content in the field of {topic}.</p>",
            "author": random.choice(["Sarah Johnson", "Michael Chen", "Emily Roberts", "David Kim", "Jessica Martinez"]),
            "date": f"February {random.randint(1,28)}, 2026",
            "category": topic.split()[0].title(),
            "read_time": f"{random.randint(3,8)} min read",
        })
    return articles


def generate_tos_page(company_name: str, domain: str, email: str, phone: str) -> str:
    """Generate a Terms of Service page."""
    company = company_name or "Our Company"
    dom = domain or "example.com"
    em = email or f"contact@{dom}"
    ph = phone or ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Terms of Service - {company}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.7; }}
h1 {{ color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 10px; }}
h2 {{ color: #2a2a2a; margin-top: 30px; }}
a {{ color: #0066cc; }}
</style>
</head>
<body>
<h1>Terms of Service</h1>
<p><strong>Last Updated:</strong> {datetime.now().strftime('%B %d, %Y')}</p>
<p>Welcome to {company}. By accessing or using our website at {dom}, you agree to be bound by these Terms of Service.</p>

<h2>1. Acceptance of Terms</h2>
<p>By using this website, you confirm that you accept these terms and agree to comply with them. If you do not agree, you must not use our website.</p>

<h2>2. Use of Website</h2>
<p>You may use our website only for lawful purposes. You must not use our website in any way that breaches any applicable local, national, or international law or regulation.</p>

<h2>3. Intellectual Property</h2>
<p>All content on this website, including text, graphics, logos, and images, is the property of {company} and is protected by copyright laws.</p>

<h2>4. Limitation of Liability</h2>
<p>{company} shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the website.</p>

<h2>5. Changes to Terms</h2>
<p>We may revise these terms at any time by amending this page. Please check this page regularly to take notice of any changes.</p>

<h2>6. Contact</h2>
<p>For questions about these Terms, contact us at <a href="mailto:{em}">{em}</a>{f' or call {ph}' if ph else ''}.</p>

<p><a href="index.html">&larr; Back to Home</a></p>
</body>
</html>"""


def generate_privacy_page(company_name: str, domain: str, email: str, phone: str) -> str:
    """Generate a Privacy Policy page."""
    company = company_name or "Our Company"
    dom = domain or "example.com"
    em = email or f"contact@{dom}"
    ph = phone or ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Privacy Policy - {company}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.7; }}
h1 {{ color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 10px; }}
h2 {{ color: #2a2a2a; margin-top: 30px; }}
a {{ color: #0066cc; }}
</style>
</head>
<body>
<h1>Privacy Policy</h1>
<p><strong>Last Updated:</strong> {datetime.now().strftime('%B %d, %Y')}</p>
<p>{company} ("we", "us", "our") operates the website {dom}. This page informs you of our policies regarding the collection, use, and disclosure of personal information.</p>

<h2>1. Information We Collect</h2>
<p>We may collect personal information that you voluntarily provide when using our website, including your name, email address, and browsing behavior.</p>

<h2>2. How We Use Your Information</h2>
<p>We use the information we collect to operate, maintain, and improve our website, to communicate with you, and to comply with legal obligations.</p>

<h2>3. Cookies</h2>
<p>Our website uses cookies to enhance your browsing experience. You can set your browser to refuse all cookies, but some features of the website may not function properly.</p>

<h2>4. Third-Party Services</h2>
<p>We may employ third-party companies and individuals to facilitate our website. These third parties have access to your personal information only to perform tasks on our behalf.</p>

<h2>5. Data Security</h2>
<p>We value your trust and strive to use commercially acceptable means of protecting your personal information, but no method of transmission over the Internet is 100% secure.</p>

<h2>6. Your Rights</h2>
<p>You have the right to access, correct, or delete your personal data. You may also opt out of marketing communications at any time.</p>

<h2>7. Contact Us</h2>
<p>If you have questions about this Privacy Policy, please contact us at <a href="mailto:{em}">{em}</a>{f' or call {ph}' if ph else ''}.</p>

<p><a href="index.html">&larr; Back to Home</a></p>
</body>
</html>"""


def _build_blog_template(articles: list, settings: dict) -> str:
    """Build a blog-style safe page from generated articles."""
    site_name = settings.get("page_title") or settings.get("domain_name") or "Daily Insights"
    theme = settings.get("theme", "lifestyle")
    keywords = settings.get("keywords", "")
    redirect_link = settings.get("redirect_link", "")

    # Generate unique color scheme per generation
    hues = random.choice([
        ("#1a73e8", "#174ea6", "#e8f0fe"),  # Blue
        ("#0d9488", "#0f766e", "#f0fdfa"),  # Teal
        ("#7c3aed", "#6d28d9", "#f5f3ff"),  # Purple
        ("#dc2626", "#b91c1c", "#fef2f2"),  # Red
        ("#ea580c", "#c2410c", "#fff7ed"),  # Orange
        ("#16a34a", "#15803d", "#f0fdf4"),  # Green
    ])
    primary, dark, light = hues

    # Build article cards
    article_cards = ""
    for i, art in enumerate(articles):
        article_cards += f"""
        <article class="card">
            <div class="card-category">{art.get('category', 'General')}</div>
            <h2 class="card-title"><a href="article-{i+1}.html">{art['title']}</a></h2>
            <p class="card-excerpt">{art.get('excerpt', '')}</p>
            <div class="card-meta">
                <span>{art.get('author', 'Staff Writer')}</span>
                <span>&middot;</span>
                <span>{art.get('date', 'March 2026')}</span>
                <span>&middot;</span>
                <span>{art.get('read_time', '5 min read')}</span>
            </div>
        </article>"""

    # Build navigation links
    nav_links = f"""
        <a href="index.html">Home</a>
        <a href="about.html">About</a>
        <a href="privacy.html">Privacy Policy</a>
        <a href="terms.html">Terms of Service</a>"""

    # Redirect code
    redirect_html = ""
    if redirect_link:
        btn_redirect = settings.get("button_redirect", False)
        form_redirect = settings.get("form_redirect", False)
        if btn_redirect:
            redirect_html = f'<div style="text-align:center;margin:30px 0"><a href="{redirect_link}" class="btn" style="display:inline-block;padding:14px 32px;background:{primary};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">Learn More</a></div>'
        if form_redirect:
            redirect_html += f'<form action="{redirect_link}" method="GET" style="text-align:center;margin:20px 0"><button type="submit" class="btn" style="padding:14px 32px;background:{primary};color:#fff;border:none;border-radius:8px;font-weight:600;font-size:16px;cursor:pointer">Get Started</button></form>'

    # Code injection
    pixel = settings.get("pixel_code", "") or ""
    head_code = settings.get("head_code", "") or ""
    body_start = settings.get("body_start_code", "") or ""
    body_end = settings.get("body_end_code", "") or ""

    html = f"""<!DOCTYPE html>
<html lang="{settings.get('language', 'en')}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{site_name} — Your trusted source for {theme} content.">
<meta name="keywords" content="{keywords}">
<title>{site_name}</title>
{pixel}
{head_code}
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; color: #1a1a1a; background: #fafafa; line-height: 1.6; }}
.container {{ max-width: 1100px; margin: 0 auto; padding: 0 20px; }}
header {{ background: #fff; border-bottom: 1px solid #e5e7eb; padding: 16px 0; position: sticky; top: 0; z-index: 100; }}
header .container {{ display: flex; justify-content: space-between; align-items: center; }}
.logo {{ font-size: 24px; font-weight: 700; color: {primary}; text-decoration: none; }}
nav {{ display: flex; gap: 24px; }}
nav a {{ color: #4b5563; text-decoration: none; font-size: 15px; font-weight: 500; transition: color 0.2s; }}
nav a:hover {{ color: {primary}; }}
.hero {{ background: linear-gradient(135deg, {primary}, {dark}); color: #fff; padding: 60px 0; text-align: center; }}
.hero h1 {{ font-size: 36px; margin-bottom: 12px; font-weight: 700; }}
.hero p {{ font-size: 18px; opacity: 0.9; max-width: 600px; margin: 0 auto; }}
.articles {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; padding: 40px 0; }}
.card {{ background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: box-shadow 0.2s, transform 0.2s; }}
.card:hover {{ box-shadow: 0 4px 12px rgba(0,0,0,0.12); transform: translateY(-2px); }}
.card-category {{ font-size: 12px; font-weight: 600; text-transform: uppercase; color: {primary}; letter-spacing: 0.5px; margin-bottom: 8px; }}
.card-title {{ font-size: 20px; font-weight: 700; margin-bottom: 10px; line-height: 1.3; }}
.card-title a {{ color: #1a1a1a; text-decoration: none; }}
.card-title a:hover {{ color: {primary}; }}
.card-excerpt {{ color: #6b7280; font-size: 15px; margin-bottom: 16px; }}
.card-meta {{ display: flex; gap: 8px; font-size: 13px; color: #9ca3af; }}
footer {{ background: #1a1a1a; color: #9ca3af; padding: 40px 0; margin-top: 40px; text-align: center; }}
footer a {{ color: #d1d5db; text-decoration: none; }}
footer a:hover {{ color: #fff; }}
.footer-links {{ display: flex; justify-content: center; gap: 24px; margin-bottom: 16px; }}
@media (max-width: 768px) {{
    .hero h1 {{ font-size: 28px; }}
    nav {{ display: none; }}
    .articles {{ grid-template-columns: 1fr; }}
}}
</style>
</head>
<body>
{body_start}
<header>
    <div class="container">
        <a href="index.html" class="logo">{site_name}</a>
        <nav>{nav_links}</nav>
    </div>
</header>

<section class="hero">
    <div class="container">
        <h1>Welcome to {site_name}</h1>
        <p>Your trusted source for the latest insights, tips, and guides on {theme}.</p>
    </div>
</section>

{redirect_html}

<main class="container">
    <div class="articles">
        {article_cards}
    </div>
</main>

<footer>
    <div class="container">
        <div class="footer-links">
            <a href="about.html">About</a>
            <a href="privacy.html">Privacy Policy</a>
            <a href="terms.html">Terms of Service</a>
        </div>
        <p>&copy; {datetime.now().year} {settings.get('company_name') or site_name}. All rights reserved.</p>
    </div>
</footer>
{body_end}
</body>
</html>"""

    return html


def _build_article_page(article: dict, index: int, site_name: str, settings: dict) -> str:
    """Build an individual article page."""
    pixel = settings.get("pixel_code", "") or ""
    head_code = settings.get("head_code", "") or ""
    body_start = settings.get("body_start_code", "") or ""
    body_end = settings.get("body_end_code", "") or ""

    return f"""<!DOCTYPE html>
<html lang="{settings.get('language', 'en')}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{article['title']} - {site_name}</title>
{pixel}
{head_code}
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fafafa; line-height: 1.8; }}
.container {{ max-width: 740px; margin: 0 auto; padding: 0 20px; }}
header {{ background: #fff; border-bottom: 1px solid #e5e7eb; padding: 16px 0; }}
header a {{ color: #1a73e8; text-decoration: none; font-size: 24px; font-weight: 700; }}
article {{ background: #fff; border-radius: 12px; padding: 40px; margin: 30px auto; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }}
article h1 {{ font-size: 32px; font-weight: 700; margin-bottom: 16px; line-height: 1.3; }}
.meta {{ color: #6b7280; font-size: 14px; margin-bottom: 24px; display: flex; gap: 12px; }}
.body-content p {{ margin-bottom: 16px; font-size: 17px; }}
.back {{ display: inline-block; margin: 20px 0; color: #1a73e8; text-decoration: none; font-weight: 500; }}
footer {{ text-align: center; color: #9ca3af; padding: 30px 0; font-size: 14px; }}
</style>
</head>
<body>
{body_start}
<header>
    <div class="container">
        <a href="index.html">{site_name}</a>
    </div>
</header>
<div class="container">
    <a href="index.html" class="back">&larr; Back to Home</a>
    <article>
        <h1>{article['title']}</h1>
        <div class="meta">
            <span>{article.get('author', 'Staff Writer')}</span>
            <span>&middot;</span>
            <span>{article.get('date', 'March 2026')}</span>
            <span>&middot;</span>
            <span>{article.get('read_time', '5 min read')}</span>
        </div>
        <div class="body-content">
            {article.get('body', '<p>Article content.</p>')}
        </div>
    </article>
</div>
<footer>
    <p>&copy; {datetime.now().year} {site_name}. All rights reserved.</p>
</footer>
{body_end}
</body>
</html>"""


def _build_about_page(site_name: str, settings: dict) -> str:
    """Build an About page."""
    company = settings.get("company_name") or site_name
    theme = settings.get("theme", "lifestyle")

    return f"""<!DOCTYPE html>
<html lang="{settings.get('language', 'en')}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>About - {site_name}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.7; }}
h1 {{ color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 10px; }}
a {{ color: #1a73e8; }}
</style>
</head>
<body>
<h1>About {company}</h1>
<p>We are a dedicated team passionate about {theme}. Our mission is to provide valuable, up-to-date content that helps our readers make informed decisions.</p>
<p>Founded with a commitment to quality and accuracy, {company} brings together experts and enthusiasts to create content that matters. We believe in transparency, integrity, and the power of well-researched information.</p>
<p>Our editorial team reviews every piece of content to ensure it meets our high standards. We welcome feedback and suggestions from our readers.</p>
<p><a href="index.html">&larr; Back to Home</a></p>
</body>
</html>"""


async def build_brand_template_zip(settings: dict) -> tuple[str, bytes]:
    """Build a safe page from a brand lander template. Returns (preview_html, zip_bytes)."""
    from app.templates import get_template_html

    category = settings.get("template_category", "")
    template_id = settings.get("template_id", "")
    html = get_template_html(category, template_id)

    # Replace placeholders
    cta_url = settings.get("redirect_link") or "#"
    pixel_code = settings.get("pixel_code") or ""
    head_code = settings.get("head_code") or ""
    body_start_code = settings.get("body_start_code") or ""
    body_end_code = settings.get("body_end_code") or ""

    html = html.replace("{{CTA_URL}}", cta_url)
    html = html.replace("{{PIXEL_CODE}}", pixel_code + head_code)
    html = html.replace("{{BODY_END_CODE}}", body_end_code)

    index_filename = settings.get("index_filename") or "index.html"

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(index_filename, html)
    zip_buffer.seek(0)

    return html, zip_buffer.getvalue()


async def build_safe_page_zip(settings: dict) -> tuple[str, bytes]:
    """
    Generate a complete safe page site and return (preview_html, zip_bytes).

    settings keys: generator_type, theme, language, keywords, domain_name,
    num_pages, page_title, redirect_link, button_redirect, form_redirect,
    index_filename, company_name, tos_domain, phone_number, email,
    pixel_code, head_code, body_start_code, body_end_code
    """
    # Route to brand template builder if template-based
    if settings.get("generator_type") == "brand_template":
        return await build_brand_template_zip(settings)

    theme = settings.get("theme", "lifestyle")
    keywords = settings.get("keywords", "")
    language = settings.get("language", "en")
    num_pages = settings.get("num_pages", 1)
    num_articles = max(3, num_pages * 5)
    site_name = settings.get("page_title") or settings.get("domain_name") or "Daily Insights"
    index_filename = settings.get("index_filename") or "index.html"

    # Generate articles via AI
    articles = await generate_articles(theme, keywords, language, num_articles)

    # Build pages
    index_html = _build_blog_template(articles, settings)
    index_html = _randomize_html(index_html)

    # Build article pages
    article_pages = {}
    for i, art in enumerate(articles):
        page_html = _build_article_page(art, i, site_name, settings)
        page_html = _randomize_html(page_html)
        article_pages[f"article-{i+1}.html"] = page_html

    # Legal pages
    company = settings.get("company_name", "")
    domain = settings.get("tos_domain") or settings.get("domain_name", "")
    email = settings.get("email", "")
    phone = settings.get("phone_number", "")

    tos_html = _randomize_html(generate_tos_page(company, domain, email, phone))
    privacy_html = _randomize_html(generate_privacy_page(company, domain, email, phone))
    about_html = _randomize_html(_build_about_page(site_name, settings))

    # Package into ZIP
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(index_filename, index_html)
        for filename, content in article_pages.items():
            zf.writestr(filename, content)
        zf.writestr("terms.html", tos_html)
        zf.writestr("privacy.html", privacy_html)
        zf.writestr("about.html", about_html)

    zip_buffer.seek(0)
    return index_html, zip_buffer.getvalue()
