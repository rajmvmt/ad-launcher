import json
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models import Headline as HeadlineModel, Brand as BrandModel, Product as ProductModel, Prompt as PromptModel, User
from app.schemas.headline import Headline, HeadlineCreate, HeadlineBatchDelete
from app.core.deps import get_current_active_user
from app.core.config import settings

router = APIRouter()

CLAUDE_MODELS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-5-20250929",
}

HEADLINE_PROMPT = """You are a 7-figure affiliate media buyer who writes Facebook ad headlines every single day. You spend $50k+/day on ads and you've split-tested thousands of headlines. You know what actually stops the scroll in 2024-2025 — not textbook copywriting theory, but real patterns that print money on Facebook right now.

Your headlines get CTRs above 3% because you understand:
- Pattern interrupts that break the scroll (weird specificity, odd numbers, contradiction)
- Natives-style headlines that look like news articles, not ads
- Callouts that make the RIGHT person feel personally attacked
- Hooks that create an information gap the reader CANNOT ignore
- Conversational language that sounds like a friend texting, not a corporation selling

BRAND: {brand_name}
BRAND VOICE: {brand_voice}
PRODUCT: {product_name}
PRODUCT DESCRIPTION: {product_description}

RESEARCH & PRODUCT DATA:
{doc_content}

Generate 15 Facebook ad headlines. IMPORTANT RULES:

1. Each headline MUST be under 40 characters (this is a hard limit — Facebook truncates longer ones)
2. Write headlines that would ACTUALLY run on Facebook — not generic marketing fluff
3. Ground every headline in REAL details from the research doc (specific ingredients, claims, numbers, mechanisms)
4. Do NOT use banned/flagged words: "shocking", "doctors hate", "one weird trick", "you won't believe"
5. Mix these proven affiliate styles across your 15:

STYLES (use the category name exactly as shown):
- "curiosity" (4-5 headlines): Open loops, information gaps, "why" questions
  Examples of the VIBE: "The $3 Fix Podiatrists Use" / "Why Your Feet Hurt After 40" / "Found: A 30-Sec Foot Hack"
- "benefit" (4-5 headlines): Lead with the #1 outcome, specific result
  Examples of the VIBE: "Walk Pain-Free In 7 Days" / "Finally Sleep Through The Night" / "Drop A Jean Size This Month"
- "callout" (3-4 headlines): Target the exact person — age, situation, identity
  Examples of the VIBE: "Attention: Tired Feet Over 50" / "If You Stand All Day, Read This" / "For Women Who Gave Up On Heels"
- "native" (2-3 headlines): Looks like a news headline or article title
  Examples of the VIBE: "New Study: Walking Barefoot May..." / "Local Woman's Foot Discovery" / "Experts Now Recommend This"

6. Be SPECIFIC — pull real product details. "This $29 Insole" beats "This Product". "97% Saw Relief" beats "Many People Improved"
7. NO generic motivational crap — every headline should make someone think "wait, what?" or "that's literally me"

Return ONLY valid JSON:
{{
  "headlines": [
    {{ "text": "Headline text here", "category": "curiosity" }},
    {{ "text": "Another headline", "category": "benefit" }}
  ]
}}

Return ONLY the JSON, no markdown, no code blocks, no explanation."""


def _parse_ai_response(raw_text: str) -> dict:
    import re
    json_text = raw_text.strip()

    # Strip markdown code fences (```json ... ``` or ``` ... ```)
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", json_text, re.DOTALL)
    if fence_match:
        json_text = fence_match.group(1).strip()

    # If still not valid JSON, try to find the JSON object
    if not json_text.startswith("{") and not json_text.startswith("["):
        start = json_text.find("{")
        end = json_text.rfind("}") + 1
        if start != -1 and end > start:
            json_text = json_text[start:end]

    return json.loads(json_text)


async def _fetch_file_content(url: str) -> bytes:
    """Download file content from a URL (R2 or local)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def _extract_text_from_research_doc(research_doc) -> str:
    """Extract text from a research doc's template/notes and attached files."""
    parts = []

    # Add template text if it's real content (not placeholder)
    if research_doc.template and research_doc.template.strip() != '(files only)':
        parts.append(research_doc.template)

    # Add notes
    if research_doc.notes and research_doc.notes.strip() != '(files only)':
        parts.append(research_doc.notes)

    # Download and extract text from attached files
    if research_doc.files:
        for f in research_doc.files:
            try:
                content = await _fetch_file_content(f['url'])
                text = _extract_text_from_file(content, f['name'])
                if text.strip():
                    parts.append(text)
            except Exception as e:
                print(f"[headlines] Failed to fetch file {f.get('name')}: {e}")

    return "\n\n".join(parts)


def _extract_text_from_file(content: bytes, filename: str) -> str:
    """Extract text from uploaded file based on extension."""
    lower = filename.lower()
    if lower.endswith('.txt') or lower.endswith('.md') or lower.endswith('.csv'):
        return content.decode('utf-8', errors='replace')
    elif lower.endswith('.pdf'):
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            return "".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            return content.decode('utf-8', errors='replace')
        except Exception as e:
            print(f"[headlines] Failed to read PDF: {e}")
            raise HTTPException(status_code=400, detail="Failed to read PDF file")
    elif lower.endswith('.docx'):
        try:
            import io
            from docx import Document
            doc = Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except ImportError:
            print("[headlines] python-docx not installed, falling back to raw decode")
            return content.decode('utf-8', errors='replace')
        except Exception as e:
            print(f"[headlines] Failed to read .docx: {e}")
            return content.decode('utf-8', errors='replace')
    else:
        return content.decode('utf-8', errors='replace')


@router.get("", response_model=List[Headline])
def list_headlines(
    brand_id: Optional[str] = None,
    product_id: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(HeadlineModel)
    if brand_id:
        query = query.filter(HeadlineModel.brand_id == brand_id)
    if product_id:
        query = query.filter(HeadlineModel.product_id == product_id)
    if category:
        query = query.filter(HeadlineModel.category == category)
    return query.order_by(HeadlineModel.created_at.desc()).all()


@router.post("", response_model=Headline)
def create_headline(
    headline: HeadlineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    db_headline = HeadlineModel(
        brand_id=headline.brand_id,
        product_id=headline.product_id,
        text=headline.text,
        category=headline.category,
        source=headline.source,
    )
    db.add(db_headline)
    db.commit()
    db.refresh(db_headline)
    return db_headline


@router.post("/generate", response_model=List[Headline])
async def generate_headlines(
    brand_id: str = Form(...),
    product_id: Optional[str] = Form(None),
    research_doc_ids: Optional[str] = Form(None),
    model: Optional[str] = Form("sonnet"),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate headlines with Claude (Sonnet default, Haiku available) using brand research docs or uploaded file."""
    if not research_doc_ids and not file:
        raise HTTPException(status_code=400, detail="Provide research docs or upload a file")

    # Fetch brand
    brand = db.query(BrandModel).filter(BrandModel.id == brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    # Fetch product (optional)
    product = None
    if product_id:
        product = db.query(ProductModel).filter(ProductModel.id == product_id).first()

    # Get doc text from research docs or uploaded file
    if research_doc_ids:
        doc_id_list = [did.strip() for did in research_doc_ids.split(",") if did.strip()]
        all_texts = []
        for doc_id in doc_id_list:
            research_doc = db.query(PromptModel).filter(PromptModel.id == doc_id).first()
            if research_doc:
                text = await _extract_text_from_research_doc(research_doc)
                if text.strip():
                    all_texts.append(f"--- {research_doc.name} ---\n{text}")
        doc_text = "\n\n".join(all_texts)
        if not doc_text.strip():
            raise HTTPException(status_code=400, detail="Research docs have no text content")
    else:
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 10MB)")
        doc_text = _extract_text_from_file(content, file.filename or "document.txt")
        if not doc_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from file")

    # Truncate — Sonnet handles more context than Haiku
    max_chars = 15000 if model == "sonnet" else 8000
    if len(doc_text) > max_chars:
        doc_text = doc_text[:max_chars] + f"\n\n[Document truncated at {max_chars} characters]"

    # Build prompt
    prompt = HEADLINE_PROMPT.format(
        brand_name=brand.name,
        brand_voice=brand.voice or "Not specified",
        product_name=product.name if product else "General",
        product_description=product.description if product else "Not specified",
        doc_content=doc_text,
    )

    # Resolve model
    model_key = model if model in CLAUDE_MODELS else "sonnet"
    model_id = CLAUDE_MODELS[model_key]

    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=500, detail="anthropic package not installed")

    api_key = getattr(settings, "ANTHROPIC_API_KEY", None) or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    try:
        print(f"[headlines] Generating with {model_key} ({model_id}), research chars: {len(doc_text)}")
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model_id,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _parse_ai_response(response.content[0].text)
    except json.JSONDecodeError as e:
        print(f"[headlines] JSON parse error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response as JSON")
    except Exception as e:
        print(f"[headlines] AI error: {e}")
        raise HTTPException(status_code=500, detail="Headline generation failed")

    # Save headlines to DB
    generated = result.get("headlines", [])
    saved = []
    for h in generated:
        text = h.get("text", "").strip()
        if not text:
            continue
        db_headline = HeadlineModel(
            brand_id=brand_id,
            product_id=product_id,
            text=text,
            category=h.get("category"),
            source="ai",
        )
        db.add(db_headline)
        db.flush()
        saved.append(db_headline)

    db.commit()
    for h in saved:
        db.refresh(h)

    return saved


@router.delete("/batch")
def delete_headlines_batch(
    body: HeadlineBatchDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    deleted = db.query(HeadlineModel).filter(HeadlineModel.id.in_(body.ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@router.delete("/{headline_id}")
def delete_headline(
    headline_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    headline = db.query(HeadlineModel).filter(HeadlineModel.id == headline_id).first()
    if not headline:
        raise HTTPException(status_code=404, detail="Headline not found")
    db.delete(headline)
    db.commit()
    return {"success": True}
