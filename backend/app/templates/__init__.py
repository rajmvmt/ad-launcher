"""Brand lander templates registry."""
import os

TEMPLATES_DIR = os.path.dirname(__file__)

# category -> list of templates
BRAND_TEMPLATES = {
    "akemi_detox_tea": {
        "label": "Akemi Detox Tea",
        "templates": [
            {
                "id": "lulutox_fb_rip",
                "label": "Lulutox FB Rip",
                "file": "akemi_tea_lander.html",
                "description": "5 Reasons Why article-style advertorial with reviews and CTA buttons",
            },
        ],
    },
}


def get_template_html(category: str, template_id: str) -> str:
    """Load a brand template HTML file and return its contents."""
    cat = BRAND_TEMPLATES.get(category)
    if not cat:
        raise ValueError(f"Unknown template category: {category}")

    tmpl = next((t for t in cat["templates"] if t["id"] == template_id), None)
    if not tmpl:
        raise ValueError(f"Unknown template: {template_id} in category {category}")

    path = os.path.join(TEMPLATES_DIR, tmpl["file"])
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def list_brand_templates() -> list:
    """Return all brand template categories and their templates for the API."""
    result = []
    for cat_id, cat in BRAND_TEMPLATES.items():
        result.append({
            "id": cat_id,
            "label": cat["label"],
            "templates": [
                {"id": t["id"], "label": t["label"], "description": t["description"]}
                for t in cat["templates"]
            ],
        })
    return result
