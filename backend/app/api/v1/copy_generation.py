from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from app.models import User
from app.core.deps import get_current_active_user
import google.generativeai as genai
import os
import json
import re
import shutil
import subprocess

import httpx
from app.database import get_db
from app.models import Prompt as PromptModel
from app.core.config import settings

router = APIRouter()


def _claude_cli_available() -> bool:
    """Check if `claude` CLI is installed for OAuth fallback."""
    return shutil.which("claude") is not None


def _call_claude_oauth(prompt: str, timeout: int = 180) -> str:
    """Call `claude -p` via OAuth (Max subscription) — used when ANTHROPIC_API_KEY is unset.
    Strips the API key from the env so claude uses OAuth instead of API billing."""
    result = subprocess.run(
        ["env", "-u", "ANTHROPIC_API_KEY", "claude", "-p", "--output-format", "text"],
        input=prompt,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"claude -p failed (code {result.returncode}): {result.stderr[:500]}"
        )
    return result.stdout


def _call_claude(prompt: str, model_id: str, max_tokens: int) -> str:
    """Call Claude via Anthropic API if key configured, else fall back to `claude -p` OAuth.
    Returns raw text response."""
    api_key = settings.ANTHROPIC_API_KEY
    if api_key:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model_id,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
    if _claude_cli_available():
        print(f"[copy_generation] No ANTHROPIC_API_KEY — using OAuth via `claude -p`")
        return _call_claude_oauth(prompt)
    raise HTTPException(
        status_code=500,
        detail="No Claude access: set ANTHROPIC_API_KEY or install `claude` CLI for OAuth",
    )


def _language_instruction(language: Optional[str]) -> str:
    """Return a prompt fragment forcing output language. Empty string for English/default."""
    if not language or language.strip().lower() in ("", "english", "en"):
        return ""
    return (
        f"\n\n=== OUTPUT LANGUAGE ===\n"
        f"Write ALL copy (headline, body, cta) in {language}. "
        f"Use natural native {language} phrasing — NOT translated English. "
        f"Idioms, slang, and cultural references should be authentic to {language} speakers. "
        f"Banned-word lists in this prompt still apply conceptually but may not have direct {language} equivalents — use the spirit, not the literal English words.\n"
    )

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

CLAUDE_MODELS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-5-20250929",
}

def _extract_text_from_bytes(content: bytes, filename: str) -> str:
    """Extract text from file content based on extension."""
    lower = filename.lower()
    if lower.endswith('.txt') or lower.endswith('.md') or lower.endswith('.csv'):
        return content.decode('utf-8', errors='replace')
    elif lower.endswith('.pdf'):
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            return "".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return content.decode('utf-8', errors='replace')
    elif lower.endswith('.docx'):
        try:
            import io
            from docx import Document
            doc = Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception:
            return content.decode('utf-8', errors='replace')
    else:
        return content.decode('utf-8', errors='replace')


async def _get_research_text(doc) -> str:
    """Extract all text from a research doc including its attached files."""
    parts = []
    if doc.template and doc.template.strip() != '(files only)':
        parts.append(doc.template)
    if doc.notes and doc.notes.strip():
        parts.append(doc.notes)
    if doc.files:
        async with httpx.AsyncClient(timeout=30) as client:
            for f in doc.files:
                try:
                    resp = await client.get(f['url'])
                    resp.raise_for_status()
                    text = _extract_text_from_bytes(resp.content, f['name'])
                    if text.strip():
                        parts.append(text)
                except Exception as e:
                    print(f"[copy_generation] Failed to fetch file {f.get('name')}: {e}")
    return "\n\n".join(parts)


def _parse_json_response(response_text: str) -> dict:
    """Extract and parse JSON from AI response text."""
    text = response_text.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    if not text.startswith("{") and not text.startswith("["):
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            text = text[start:end]
    return json.loads(text.strip())

class CopyGenerationRequest(BaseModel):
    brand: Dict[str, Any]
    product: Dict[str, Any]
    profile: Dict[str, Any]
    template: Optional[Dict[str, Any]] = None
    variationCount: int = 3
    campaignDetails: Dict[str, str]
    customPrompt: Optional[str] = None
    model: Optional[str] = "sonnet"  # "sonnet", "haiku", "gemini", "group_voice", or "akemi_before_after"
    language: Optional[str] = "English"  # e.g. "English", "German", "Spanish", "French"
    research_doc_id: Optional[str] = None
    referenceImageUrls: Optional[List[str]] = None

class CampaignDetailsRequest(BaseModel):
    brand: Dict[str, Any]
    product: Dict[str, Any]
    profile: Dict[str, Any]
    research_doc_id: Optional[str] = None
    referenceImageUrls: Optional[List[str]] = None

class FieldRegenerationRequest(BaseModel):
    field: str
    currentValue: str
    brand: Dict[str, Any]
    product: Dict[str, Any]
    profile: Dict[str, Any]
    template: Optional[Dict[str, Any]] = None
    campaignDetails: Dict[str, str]
    model: Optional[str] = "sonnet"
    language: Optional[str] = "English"

def _build_group_voice_prompt(request, research_context: str, ref_image_context: str) -> str:
    """Build the FB Group Voice prompt — copy that sounds like a real person posting
    in a private Facebook support group, but functions as DR affiliate copy."""
    count = request.variationCount
    product_name = request.product.get('name', 'the product')
    product_desc = request.product.get('description', '')
    demographics = request.profile.get('demographics', 'General audience')
    pain_points = request.profile.get('pain_points', 'Not specified')
    goals = request.profile.get('goals', 'Not specified')
    offer = request.campaignDetails.get('offer', '')
    messaging = request.campaignDetails.get('messaging', '')

    return f"""You are writing Facebook ad copy that sounds like a REAL PERSON aged 55-75 posting in a private Facebook support group. The reader should NEVER feel like they're reading an ad. They should feel like they're reading a neighbor's post.

PRODUCT: {product_name}
{f"Description: {product_desc}" if product_desc else ""}

TARGET AUDIENCE:
- Demographics: {demographics}
- Pain Points: {pain_points}
- Goals: {goals}

CAMPAIGN DETAILS:
- Offer: {offer}
- Key Messaging: {messaging}
{research_context}{ref_image_context}

Generate {count} distinct variations. Return ONLY valid JSON in this exact format:
{{
  "variations": [
    {{
      "headline": "Editorial/article title style headline (under 40 chars)",
      "body": "Primary text — 1-3 sentences, phone-typing energy, sounds like a real group member",
      "cta": "Short descriptive line (under 20 chars)"
    }}
  ]
}}

=== VOICE RULES ===

Every piece of body copy must sound like a real person typing on their phone in a private support group.

HOW TO WRITE THE BODY:
- 1-3 sentences max. Short and dashed off. Phone-typing energy.
- Fragments and run-ons are fine. Imperfect grammar is fine. Lowercase is fine.
- No emojis. No hashtags. No exclamation marks unless raw emotion.
- No ellipses (...). Use periods or dashes instead.
- Each variation must sound like a different real person — rotate age, gender, tone, specific details.

BANNED WORDS (NEVER use these in any output):
transform, transformation, journey, game changer, incredible, unbelievable, amazing, check this out, you won't believe, click below, link in bio, learn more, discover, unlock, secret, revolutionary, breakthrough, I stumbled upon, I came across, honestly, genuinely, straightforward, life-changing, mind-blowing, must-have, don't miss, act now, limited time, hurry, finally a solution, say goodbye to, struggling with, suffer no more, natural solution, proven formula

USE THESE WORDS INSTEAD (real group member language):
burning, on fire, pins and needles, brain fog, zombie, mush, tried everything, nothing works, gave up, my neighbor, my sister in law, my wife/husband, doctor told me to live with it, 3 AM, can't sleep, burning at night, walked to the mailbox, played with grandkids, slept through the night

=== CONVERSION TECHNIQUE: DR AFFILIATE HIDDEN INSIDE GROUP VOICE ===

The copy must SOUND like a group member but FUNCTION like direct response affiliate copy.

CURIOSITY GAPS (never reveal the product name or what it is):
- BAD: "This EMS foot wrap stopped my burning" (reveals product)
- GOOD: "my neighbor showed me this thing for his feet and the burning actually stopped" (creates gap)

SPECIFICITY (use exact numbers, not vague claims):
- BAD: "spent a lot on treatments"
- GOOD: "$34,000 on treatments over 9 years"

OPEN LOOPS (make them need to click):
- BAD: "I found a device that helps"
- GOOD: "I found out why my medication stopped working. and what actually fixes it"

AGITATE BEFORE SOLVING:
- Reference late-night pain, years of suffering, money wasted, medications that failed
- Then hint at relief without fully explaining how

IMPLIED SOCIAL PROOF (peer framing):
- Always attribute discovery to a peer: neighbor, sister in law, friend at church, someone in this group
- Never "I found a product." Always "someone like me showed me something."

EMOTIONAL TRIGGERS (pick 1-2 per variation):
- RAGE: doctor dismissal, Big Pharma lies, money wasted on scams
- GRIEF: lost activities, can't play with grandkids, "I used to be active"
- FEAR: progression, getting worse, becoming a burden
- HOPE: first night sleeping through, walking again, getting off medication
- SPEED: worked in days not months, felt it the first night

PRICE ANCHORING (when mentioning cost):
- Contrast against what they're currently spending
- Never lead with price. Lead with result, then price as surprise.

URGENCY WITHOUT SCARCITY (no fake countdowns):
- Time-based: "you're 67. how many more years of this"
- Progression-based: "it doesn't get better on its own"
- Regret-based: "I wish someone showed me this 8 years ago"

=== HEADLINE STYLE ===

Headlines go UNDER the link preview — write them in editorial/article title style, NOT group voice:
- "Why Thousands Are Switching From [Medication] To This"
- "The $39 Device Neurologists Are Recommending"
- "[Doctor title]: The Fastest Way To End [Condition] Pain"
- NOT: "Buy Now" / "Shop Today" / "Limited Time Offer"

=== CTA STYLE ===

Short descriptive line under the headline:
- "See why 21,500 people made the switch"
- "The solution your doctor was never taught"
- NOT: "Free shipping" / "Order now" / "Click here"

=== FACEBOOK COMPLIANCE ===

- Never say "cure" or "cures"
- Never say "you have [condition]" or "your [condition]" (personal attribute targeting)
- Never make definitive health claims from advertiser voice
- Frame everything as personal experience: "this ended my burning" not "this will end your burning"
- "The fastest way to end [condition] pain for good" = ok (information framing)
- "This cures [condition] fast" = not ok (direct health claim)
- No before/after guarantees
- Avoid "you" statements about health conditions

=== QUALITY CHECK (validate every output) ===

Before outputting any copy, check:
1. Does this sound like a real person typed it on their phone? If it sounds "written" — rewrite messier.
2. Is there a curiosity gap? If the reader knows everything without clicking — add mystery.
3. Is there at least one specific number? ($amount, years, age, time)
4. Are any banned words present? If yes — replace with group member language.
5. Would a 62-year-old retired person talk like this? If no — simplify.
6. Is the body 1-3 sentences? If longer — cut.
7. Does it create an emotional response in the first 5 words? If no — rewrite the opening.

=== EXAMPLE OUTPUTS (this is the quality bar) ===

Body examples that PASS:
- "my neighbor kept bugging me about this thing for his feet. finally tried it just to shut him up. its been 2 weeks and I haven't taken a gabapentin"
- "$34,000 on treatments over 9 years. this was $39. guess which one works"
- "the burning stopped. I don't know how else to say it. 6 years and the burning just stopped"
- "my wife found this. I told her I was done trying things. she ordered it anyway. I owe her an apology"
- "been in this group 3 years. tried everything everyone recommended. this is the first thing I've come back to actually say worked"

Body examples that FAIL:
- "Discover the revolutionary breakthrough that's transforming treatment!" (every banned word, marketer voice)
- "This amazing device uses EMS technology to stimulate blood flow effectively." (product description voice)
- "I stumbled upon this game-changing device and honestly it's been a life-changing journey." (every AI tell word)

Rotate through these angles across the {count} variations:
1. Personal discovery (I found / someone showed me)
2. Spouse or family member voice (my husband / my mom)
3. Skeptic converted (didn't believe it / tried it to prove it wrong)
4. Medication comparison (medication did X, this did Y)
5. Speed/result (first night / one week / the pain stopped)

{"Ground copy in REAL product details from the research doc. Do NOT make things up." if research_context else ""}

Return ONLY valid JSON, no markdown formatting or code blocks."""


def _build_akemi_prompt(request, research_context: str, ref_image_context: str) -> str:
    """Build the Akemi Before & Afters prompt — testimonial-style weight loss ads."""
    return f"""You are a direct response copywriter specializing in Facebook ads for health supplements targeting women 45-65 (and occasionally men 50-65). You write first-person testimonial-style ads that feel like a real person sharing their story on Facebook — NOT like an ad.

Write a Facebook ad primary text for a weight loss detox tea. The product is NEVER named in the ad — the link goes in the comments.

STRICT FORMAT — follow this EXACTLY:

OPENING LINE: Start with "[NUMBER] lbs DOWN since [RECENT MONTH]" — the number must be between 50-120 lbs. Then immediately state age and the SHAME MOMENT — a specific, vivid, humiliating experience that triggered the transformation. This moment should be so specific and emotionally raw that the reader feels it in their gut. Examples: being told by a doctor she's too fat for surgery, not being able to get off the floor with grandkids, needing a seatbelt extender on a plane, catching a spouse looking at her with pity, being afraid to climb her own stairs.

PARAGRAPH 2: "It's [CURRENT DATE/MONTH] now" — contrast the shame moment with a specific victory that mirrors it. If she couldn't get off the floor before, she can now. If she needed an extender, she doesn't anymore. Make this victory SPECIFIC and emotional, not generic.

PARAGRAPH 3: Brief backstory — how the weight piled on (menopause, desk job, medication, stress). List 3-4 specific things she tried that failed (WW, Noom, keto, calorie counting, a specific expensive product). Include the number of failed attempts. Convey exhaustion and near-surrender.

PARAGRAPH 4: THE AUTHORITY FIGURE — someone she trusts (NOT a random internet ad) explains the MECHANISM. This person must be a specific role: sister-in-law who's a nurse, daughter studying biochemistry, neighbor who's a retired nutritionist, friend who's a nurse practitioner, acupuncturist, pharmacist, college roommate in functional medicine, brother-in-law in sports medicine. The authority figure explains: "Your body's detox system is clogged from decades of processed food, environmental toxins, and hormonal disruption after menopause. The fat is LOCKED IN because your body is storing toxins. You can't diet your way out of a toxin problem. You have to clear the filter first."

PARAGRAPH 5: The authority figure introduces a "morning tea ritual" based on what Japanese women in Okinawa have been drinking for centuries — the same women who live longer than anyone on earth with near-zero obesity. She was skeptical. She tried it anyway because she had nothing left to lose.

PARAGRAPH 6: RESULTS PROGRESSION — exactly three beats:
- "Week 1:" — immediate tangible result (bloating gone, rings fit, ankle swelling down, puffiness in face reduced)
- "Month 1:" — significant weight loss number (18-29 lbs range) + energy return or visible change
- "Today:" — full weight loss number + emotional payoff that mirrors the opening shame moment

FINAL LINE: "The link is in the comments." Add urgency or emotional hook: "Read it before another doctor writes you off" or "If you've tried everything and you're about to give up — read it first" or "Read it before they tell you it's too late."

RULES:
- Weight loss number must be between 50-120 lbs
- Age must be between 45-65 for women, 50-65 for men
- NEVER name the product
- ABSOLUTELY NO ELLIPSES ANYWHERE. Never use "..." in the ad. Not once. Not ever. No three dots in a row. Use periods, dashes, or line breaks instead. Ellipses are banned. If you catch yourself writing "..." replace it with a period or a dash immediately.
- NEVER sound like an ad or use marketing language
- Write at a 6th-8th grade reading level
- Short paragraphs. Short sentences. One-line paragraphs for emphasis.
- The shame moment must be SPECIFIC — a single scene with sensory details, not a general complaint
- The authority figure must have a specific relationship and credential — not "someone online" or "an article I read"
- The mechanism explanation must include: clogged detox system, processed food/toxins, menopause/hormonal disruption, fat storing toxins, "clear the filter"
- The Japanese/Okinawan reference must be included
- The results must escalate: small tangible → significant weight → emotional transformation
- The victory at the end must MIRROR the shame at the beginning
- Tone: raw, honest, emotional, vulnerable — like a real Facebook post from a real woman sharing the most personal thing she's ever shared publicly

PRODUCT CONTEXT:
Product: {request.product.get('name', 'Weight loss detox tea')}
{f"Description: {request.product.get('description')}" if request.product.get('description') else ''}

TARGET:
- Demographics: {request.profile.get('demographics', 'Women 45-65')}
- Pain Points: {request.profile.get('pain_points', 'Weight gain, failed diets, health concerns')}
{research_context}{ref_image_context}

Generate 1 complete ad now. Make the shame moment something surprising and emotionally raw.

Also generate a short, punchy headline (under 40 chars) that would work as the Facebook ad headline below the image/video. The headline should be editorial/article-style — NOT salesy.

Return ONLY valid JSON in this exact format:
{{{{
  "variations": [
    {{{{
      "headline": "Short editorial headline (under 40 chars)",
      "body": "The full primary text ad copy",
      "cta": "The link is in the comments"
    }}}}
  ]
}}}}

Return ONLY valid JSON, no markdown formatting or code blocks."""


@router.post("/generate")
async def generate_copy(request: CopyGenerationRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Generate ad copy variations using Claude (Haiku/Sonnet/Group Voice/Akemi) or Gemini"""

    use_claude = request.model in ("haiku", "sonnet", "group_voice", "akemi_before_after")

    if use_claude:
        # Claude path supports OAuth fallback via `claude -p` when API key is unset.
        if not settings.ANTHROPIC_API_KEY and not _claude_cli_available():
            raise HTTPException(
                status_code=500,
                detail="No Claude access: set ANTHROPIC_API_KEY or install `claude` CLI for OAuth",
            )
    elif not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")

    try:
        # Fetch research doc context if provided
        research_context = ""
        if request.research_doc_id:
            doc = db.query(PromptModel).filter(PromptModel.id == request.research_doc_id).first()
            if doc:
                text = await _get_research_text(doc)
                if text.strip():
                    research_context = f"\n\nPRODUCT RESEARCH (use this to write accurate, specific copy):\n{text[:12000]}"

        # Reference image context
        ref_image_context = ""
        if request.referenceImageUrls:
            ref_image_context = f"\n\nREFERENCE IMAGES PROVIDED: {len(request.referenceImageUrls)} product/reference photo(s) were uploaded. Write copy that is grounded in the REAL physical product shown. Describe the product accurately based on the product description — the images show what the customer will receive."

        # Build brand context from voice + structured style guide
        brand_voice = request.brand.get('voice', 'Professional and friendly')
        sg = request.brand.get('style_guide') or {}
        brand_context_parts = [f"BRAND VOICE: {brand_voice}"]
        if sg:
            sg_lines = []
            if sg.get('tone'):
                sg_lines.append(f"TONE OF VOICE: {sg['tone']}")
            if sg.get('keywords'):
                kw = sg['keywords'] if isinstance(sg['keywords'], list) else [sg['keywords']]
                sg_lines.append(f"KEYWORDS TO USE (weave these naturally into copy): {', '.join(kw)}")
            if sg.get('banned_words'):
                bw = sg['banned_words'] if isinstance(sg['banned_words'], list) else [sg['banned_words']]
                sg_lines.append(f"BANNED WORDS (NEVER use these): {', '.join(bw)}")
            if sg.get('pain_points'):
                pp = sg['pain_points'] if isinstance(sg['pain_points'], list) else [sg['pain_points']]
                sg_lines.append("AUDIENCE PAIN POINTS (reference these):\n- " + "\n- ".join(pp))
            if sg.get('proof_points'):
                pr = sg['proof_points'] if isinstance(sg['proof_points'], list) else [sg['proof_points']]
                sg_lines.append("PROOF & AUTHORITY SIGNALS (cite these for credibility):\n- " + "\n- ".join(pr))
            if sg.get('cta_style'):
                sg_lines.append(f"CTA STYLE: {sg['cta_style']}")
            if sg.get('example_copy'):
                sg_lines.append(f"EXAMPLE WINNING COPY (match this style and energy):\n{sg['example_copy']}")
            if sg.get('notes'):
                sg_lines.append(f"ADDITIONAL STYLE NOTES:\n{sg['notes']}")
            if sg_lines:
                brand_context_parts.append("BRAND STYLE RULES:\n" + "\n".join(sg_lines))
        brand_context = "\n\n".join(brand_context_parts)

        # Build the prompt — use specialized prompt if selected, otherwise default DR prompt
        if request.model == "group_voice":
            prompt = _build_group_voice_prompt(request, research_context, ref_image_context)
        elif request.model == "akemi_before_after":
            prompt = _build_akemi_prompt(request, research_context, ref_image_context)
        else:
            count = request.variationCount
            prompt = f"""You are an elite direct-response copywriter who specializes in Facebook ads that CONVERT on cold traffic. You've studied Gary Halbert, Eugene Schwartz, David Ogilvy. You write for affiliate marketers who need to be profitable from DAY ONE.

{brand_context}

PRODUCT: {request.product.get('name')}
{f"Description: {request.product.get('description')}" if request.product.get('description') else ''}

TARGET AUDIENCE:
- Demographics: {request.profile.get('demographics', 'General audience')}
- Pain Points: {request.profile.get('pain_points', 'Not specified')}
- Goals: {request.profile.get('goals', 'Not specified')}

CAMPAIGN DETAILS:
- Offer: {request.campaignDetails.get('offer')}
- Key Messaging: {request.campaignDetails.get('messaging')}
{research_context}{ref_image_context}

Generate {count} distinct variations. Return ONLY valid JSON in this exact format:
{{
  "variations": [
    {{
      "headline": "Short, punchy headline (under 40 chars)",
      "body": "Primary text — the main copy above the image/video. MUST be 8-15 lines minimum.",
      "cta": "Action CTA (under 20 chars)"
    }}
  ]
}}

THE 7 LAWS OF DIRECT RESPONSE HEADLINES (apply to every headline):
1. OPEN LOOP — cognitive tension the reader must click to resolve
2. PAIN AMPLIFICATION — name the wound before offering the bandage
3. MECHANISM FRAMING — promise a result they've never heard said THIS way
4. SPECIFICITY — unusual numbers, exact timeframes, concrete details
5. SIMPLICITY — understood at a glance, short words
6. CREDIBILITY — authority, data, real results
7. TIME COMPRESSION — shorter timeframe = stronger desire

HEADLINE FORMULAS — use a DIFFERENT one for each variation:
- "The [detail] your doctor won't mention" (open loop)
- "Still [doing thing] but [problem]? Here's why" (pain mirror)
- "The [unusual method] behind [specific result]" (mechanism)
- "[Condition] gone in [X] days?" (time-compressed)
- "Top Doctor: [instruction]" (authority)
- "Stop [common action] immediately" (fear/contrarian)
- "Too much [problem]? [Action] every [time]" (call-out)
- "[Industry] hates this [$ amount] fix" (forbidden insider)

DIRECT RESPONSE RULES:
- Open with an EMOTIONALLY CHARGED pattern interrupt — fear, pain, frustration, or a bold controversial claim. The first 1-2 lines decide EVERYTHING.
- Name the wound FIRST — call out the pain HARD. Don't be gentle. Make them FEEL the problem.
- AGITATE the pain — twist the knife. Describe what happens if they do nothing. Make the status quo unbearable.
- Then reveal the mechanism/solution — framed as a discovery, something they haven't tried yet
- Use PAS (Problem-Agitate-Solve), AIDA, or Before-After-Bridge — one per variation
- Stack benefits AND handle objections: "Without surgery", "Without prescriptions", "Without changing your diet"
- Weave in specific claims from the product info — specificity = believability
- End EVERY body with an urgent CTA: "Tap the link", "Get yours before", "See why X people"
- Each variation takes a COMPLETELY different angle and emotional trigger
- BODY COPY MUST BE LONG — 8-15 lines minimum. This is a mini sales letter. Short copy does NOT convert on cold traffic. Build the full emotional arc: hook → pain → agitate → mechanism → benefits → proof → objection handling → CTA. A 3-line body is a FAILURE.

TONE — THE SWEET SPOT:
- NOT robotic corporate copy. NOT casual chatty young person copy. The sweet spot is: EMOTIONALLY HARD-HITTING direct response that still sounds like a real human wrote it.
- Think: the intensity and persuasion power of a Gary Halbert sales letter, but in plain spoken language a 55-year-old would use
- NEVER use ellipses (...)
- NEVER use AI cliché words: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash", "harness", "dive into", "it's time to", "say goodbye to"
- One idea per line. Short punchy sentences. Line breaks between thoughts. But LOTS of lines.
- Vary sentence length — mix 3-word punches with 10-word lines
- Use contractions (don't, won't, can't, you're, it's)
- TARGET AUDIENCE IS 55+ BOOMERS. NO young slang ("kinda", "lowkey", "no cap", "vibe"). Plain, mature language.
- EMOTIONAL WEIGHT WORDS: "suffering", "struggling", "desperate", "finally", "relief", "breakthrough", "nothing worked", "doctors couldn't help", "I was ready to give up", "changed everything"
- Start some sentences with "And" or "But". Use fragments occasionally.

BODY COPY FORMAT:
- Use emojis strategically: ✅ for benefits, ❌ for objection-busting, 👉 for CTAs, ⚠️ for hooks
- One short sentence or bullet per line — NOT paragraph blocks
- "Without X" / "Without Y" / "Without Z" objection-handling pattern
- Specific claims: "by week 3", "15 minutes a day", "in just 7 days"
- Risk-reversal: money-back guarantee, free shipping, "try it risk-free"
- Doctor/clinical authority signals: "doctor-recommended", "clinically studied", "board-certified"

FACEBOOK COMPLIANCE:
- "may help" instead of "will cure/fix/eliminate"
- "supports" instead of "treats"
- "many people report" instead of "you will experience"
- Don't call out personal attributes: "stubborn belly fat" not "your belly fat"
- No income claims, no before/after promises with specific outcomes
- Imply transformation through story, don't promise directly
{"- Ground copy in REAL product details from the research doc — specific claims, ingredients, benefits. Do NOT make things up." if research_context else ""}

EXAMPLE OF GOOD OUTPUT (study this LENGTH and emotional intensity):
headline: "Podiatrist's 10-Second Foot Fix"
body: "⚠️ If you're over 50 and your feet ache the moment you step out of bed

This is important.

Millions of Americans wake up every morning dreading that first step. The burning. The tingling. The sharp pain that shoots through your feet before you even make it to the bathroom.

You've tried the insoles. You've tried the stretches. You've tried the expensive orthotics your doctor recommended.

Nothing worked. And honestly? It's getting worse.

Here's what most people don't know:

A board-certified podiatrist recently found that most foot pain comes from one thing almost nobody addresses. It's not your shoes. It's not your age. And it's not your weight.

It's something much simpler — and it takes about 10 seconds a day to fix.

✅ No doctor visits needed
✅ No prescriptions or surgery
✅ Works even if you've tried everything else
✅ Over 2 million Americans have already tried this

And right now, you can see exactly how it works — free.

👉 Tap the link below before this page comes down"
cta: "See How It Works"

Return ONLY valid JSON, no markdown formatting or code blocks."""

        # Use custom prompt if provided
        if request.customPrompt:
            prompt = request.customPrompt

        # Append language instruction last so it overrides any English-flavored
        # content/examples earlier in the prompt.
        prompt = prompt + _language_instruction(request.language)

        if use_claude:
            # group_voice and akemi_before_after both use sonnet under the hood
            model_id = CLAUDE_MODELS.get(request.model) or CLAUDE_MODELS["sonnet"]
            max_tok = 4000 if request.model in ("group_voice", "akemi_before_after") else 2000
            print(f"[copy_generation] Using Claude {request.model} ({model_id}) lang={request.language}")
            raw_text = _call_claude(prompt, model_id, max_tok)
            result = _parse_json_response(raw_text)
        else:
            print(f"[copy_generation] Using Gemini lang={request.language}")
            model = genai.GenerativeModel('gemini-flash-latest')
            response = model.generate_content(prompt)
            result = _parse_json_response(response.text)

        return result

    except json.JSONDecodeError as e:
        print(f"[copy_generation] JSON Parse Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response as JSON")
    except Exception as e:
        print(f"[copy_generation] Error: {e}")
        raise HTTPException(status_code=500, detail="Copy generation failed")

@router.post("/regenerate-field")
async def regenerate_field(request: FieldRegenerationRequest, current_user: User = Depends(get_current_active_user)):
    """Regenerate a specific field (headline, body, or cta)"""

    use_claude = request.model in ("haiku", "sonnet", "group_voice", "akemi_before_after")

    if use_claude:
        if not settings.ANTHROPIC_API_KEY and not _claude_cli_available():
            raise HTTPException(
                status_code=500,
                detail="No Claude access: set ANTHROPIC_API_KEY or install `claude` CLI for OAuth",
            )
    elif not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")

    try:
        if request.model == "akemi_before_after":
            # Akemi Before & Afters field regeneration
            field_rules = {
                "headline": "Generate a new editorial/article-style headline (under 40 chars) for a weight loss testimonial-style Facebook ad. NOT salesy. Example: 'She Lost 87 lbs After Age 52'",
                "body": "Generate a new full testimonial-style Facebook ad primary text. First-person voice, 45-65 year old woman (or 50-65 man). Start with '[NUMBER] lbs DOWN since [MONTH]' and a vivid shame moment. Include: backstory of failed diets, authority figure explaining the mechanism (clogged detox system, toxins, menopause), morning tea ritual from Okinawa, results progression (Week 1, Month 1, Today), end with 'The link is in the comments.' NO ELLIPSES. Raw, honest, emotional tone. Different shame moment than the current version.",
                "cta": "Generate a short emotional hook line (under 30 chars). Example: 'Read it before giving up'"
            }
            prompt = f"""{field_rules.get(request.field, 'Generate new copy')}.

PRODUCT: {request.product.get('name')}
TARGET AUDIENCE: {request.profile.get('demographics', 'Women 45-65')}
CAMPAIGN: {request.campaignDetails.get('offer')}

Current {request.field}: {request.currentValue}

Generate a DIFFERENT variation. Return ONLY the new text, nothing else."""
        elif request.model == "group_voice":
            # Group voice field regeneration
            field_rules = {
                "headline": "Generate a new headline in editorial/article title style (under 40 chars). Example: 'Why Thousands Are Switching From Gabapentin To This'",
                "body": "Generate new body copy that sounds like a real person aged 55-75 posting in a private Facebook support group. 1-3 sentences max. Phone-typing energy. No emojis, no hashtags, no exclamation marks. Imperfect grammar ok. Must include a curiosity gap and at least one specific number. NEVER use these words: transform, journey, game changer, incredible, discover, unlock, secret, revolutionary, breakthrough.",
                "cta": "Generate a short descriptive line (under 20 chars). Example: 'See why 21,500 switched'"
            }
            prompt = f"""{field_rules.get(request.field, 'Generate new copy')}.

PRODUCT: {request.product.get('name')}
TARGET AUDIENCE: {request.profile.get('demographics', 'General audience')}
CAMPAIGN: {request.campaignDetails.get('offer')}

Current {request.field}: {request.currentValue}

Generate a DIFFERENT variation. Return ONLY the new text, nothing else."""
        else:
            field_prompts = {
                "headline": "Generate a new headline (under 40 characters)",
                "body": "Generate new body copy (under 125 characters for bullets, or up to 200 for storytelling)",
                "cta": "Generate a new call-to-action (under 20 characters)"
            }

            prompt = f"""You are an expert ad copywriter. {field_prompts.get(request.field, 'Generate new copy')}.

BRAND VOICE: {request.brand.get('voice', 'Professional and friendly')}
PRODUCT: {request.product.get('name')}
TARGET AUDIENCE: {request.profile.get('demographics', 'General audience')}
CAMPAIGN: {request.campaignDetails.get('offer')}

Current {request.field}: {request.currentValue}

Generate a DIFFERENT, fresh variation that:
1. Matches the brand voice
2. Is compelling and conversion-focused
3. Follows the character limits

Return ONLY the new {request.field} text, nothing else."""

        # Append language instruction last so it overrides English-flavored examples.
        prompt = prompt + _language_instruction(request.language)

        if use_claude:
            model_id = CLAUDE_MODELS.get(request.model) or CLAUDE_MODELS["sonnet"]
            # Akemi body regen needs more tokens for full testimonial copy
            max_tok = 3000 if (request.model == "akemi_before_after" and request.field == "body") else 200
            print(f"[copy_generation] Regen field={request.field} model={request.model} lang={request.language}")
            raw_text = _call_claude(prompt, model_id, max_tok)
            new_value = raw_text.strip().strip('"').strip("'")
        else:
            model = genai.GenerativeModel('gemini-flash-latest')
            response = model.generate_content(prompt)
            new_value = response.text.strip().strip('"').strip("'")

        return {"newValue": new_value}

    except Exception as e:
        print(f"[copy_generation] Field regen error: {e}")
        raise HTTPException(status_code=500, detail="Field regeneration failed")


@router.post("/generate-campaign-details")
async def generate_campaign_details(request: CampaignDetailsRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """AI-generate campaign detail fields (offer, urgency, messaging, angle) using Gemini Flash."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")

    try:
        # Fetch research doc context if provided
        research_context = ""
        if request.research_doc_id:
            doc = db.query(PromptModel).filter(PromptModel.id == request.research_doc_id).first()
            if doc:
                text = await _get_research_text(doc)
                if text.strip():
                    research_context = f"\n\nPRODUCT RESEARCH DOCUMENT (use real claims, ingredients, pricing from here):\n{text[:8000]}"

        # Describe reference images if provided
        image_context = ""
        if request.referenceImageUrls:
            image_context = f"\n\nREFERENCE IMAGES: {len(request.referenceImageUrls)} product/reference images were provided. The product is a physical product that should be visually described in the Visual Angle field."

        brand = request.brand
        product = request.product
        profile = request.profile

        prompt = f"""You are an elite direct-response affiliate marketer who writes Facebook ads for health/supplement/physical products targeting 55+ audiences.

BRAND: {brand.get('name', 'Unknown')}
BRAND VOICE: {brand.get('voice', 'Professional and friendly')}

PRODUCT: {product.get('name', 'Unknown')}
DESCRIPTION: {product.get('description', 'Not provided')}

TARGET AUDIENCE:
- Demographics: {profile.get('demographics', 'General audience')}
- Pain Points: {profile.get('pain_points', 'Not specified')}
- Goals: {profile.get('goals', 'Not specified')}
{research_context}{image_context}

Generate campaign details for a Facebook ad campaign. Return ONLY valid JSON:
{{
  "offer": "A compelling offer/promotion (e.g., '30-day risk-free trial', 'Buy 2 Get 1 Free + Free Shipping', '60% off today only'). Include a money-back guarantee or risk reversal if appropriate.",
  "urgency": "Time-sensitive urgency angle (e.g., 'Limited stock — manufacturing delays mean we can only fulfill current inventory', 'Price goes up Monday', 'Only 127 units left'). Make it feel real, not fake.",
  "messaging": "5-8 bullet points of key messaging angles separated by periods. Include: the mechanism/how it works, why it's different from what they've tried, specific proof points/stats, objection handling (without surgery/without pills/without side effects), authority signals (doctor-recommended, clinically studied), price comparison vs alternatives. Pull REAL claims from the research doc if available.",
  "angle": "Detailed visual direction for the ad image. Describe the scene, subject, lighting, mood, camera angle. Target 55+ audience — authentic, relatable, NOT stock photo perfect. Example: 'Senior woman (65-70) sitting on porch at sunset, compression socks visible, genuine smile of relief, warm golden hour lighting, shallow depth of field'"
}}

RULES:
- Pull SPECIFIC details from the product description and research doc — do NOT make up ingredients, stats, or claims
- Offer should include a risk-reversal element (guarantee, free trial, etc.)
- Messaging should be long and detailed — these are selling points the copywriter will use
- Visual angle should be specific enough to generate an AI image from
- Use plain language a 55-year-old would understand
- Return ONLY valid JSON, no markdown"""

        model = genai.GenerativeModel('gemini-2.0-flash')
        response = model.generate_content(prompt)
        result = _parse_json_response(response.text)

        return result

    except json.JSONDecodeError as e:
        print(f"[copy_generation] Campaign details JSON parse error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        print(f"[copy_generation] Campaign details error: {e}")
        raise HTTPException(status_code=500, detail="Campaign details generation failed")
