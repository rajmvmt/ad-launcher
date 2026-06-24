import logging
import os
import json
import asyncio
import shutil
import time
import glob
import base64
import tempfile
import subprocess
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Form
from typing import Optional
from sqlalchemy.orm import Session
from app.models import User, Brand, Prompt
from app.core.deps import get_current_active_user
from app.database import get_db
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

try:
    from google import genai
except ImportError:
    genai = None

try:
    import anthropic
except ImportError:
    anthropic = None


def _claude_cli_available() -> bool:
    """Check if `claude` CLI is installed for OAuth fallback."""
    return shutil.which("claude") is not None


def _claude_oauth_text(prompt: str, timeout: int = 180) -> str:
    """Text-only `claude -p` call using OAuth (Max plan, no API credits)."""
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


def _claude_oauth_with_image(prompt: str, image_data: bytes, media_type: str, timeout: int = 240) -> str:
    """Image + text `claude -p` call. Writes image to a temp file and inlines @path
    reference — claude CLI reads it via its file tools under OAuth."""
    ext = ".jpg"
    if "png" in media_type:
        ext = ".png"
    elif "webp" in media_type:
        ext = ".webp"
    elif "gif" in media_type:
        ext = ".gif"

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(image_data)
        img_path = f.name
    try:
        combined = f"Analyze the image at @{img_path}\n\n{prompt}"
        result = subprocess.run(
            ["env", "-u", "ANTHROPIC_API_KEY", "claude", "-p", "--output-format", "text"],
            input=combined,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"claude -p (image) failed (code {result.returncode}): {result.stderr[:500]}"
            )
        return result.stdout
    finally:
        try:
            os.unlink(img_path)
        except OSError:
            pass


def _language_instruction(language: Optional[str]) -> str:
    """Force output language. Empty string for English/default."""
    if not language or language.strip().lower() in ("", "english", "en"):
        return ""
    return (
        f"\n\n=== OUTPUT LANGUAGE ===\n"
        f"Write ALL output copy (bodies, headlines, video_summary, image_summary) in {language}. "
        f"Use natural native {language} phrasing — NOT translated English. "
        f"Idioms and cultural references should be authentic to {language} speakers. "
        f"The JSON keys themselves stay English; only the string VALUES are translated.\n"
    )


ANALYSIS_PROMPT = """You are an elite direct-response copywriter who specializes in Facebook ads that CONVERT. You've studied the greats — Gary Halbert, Eugene Schwartz, David Ogilvy — and you write scroll-stopping copy that drives clicks and sales.

CONTEXT: This video is being uploaded as a Facebook video ad creative. The "bodies" you write will be the PRIMARY TEXT shown above the video in the Facebook News Feed. The "headlines" will appear below the video as the clickable headline link. This ad needs to be profitable from DAY ONE — we cannot lose money up front. Write copy that maximizes CTR and drives immediate conversions on cold traffic.

Watch/analyze this video carefully — pay attention to both the visuals AND the audio/voiceover.

Based on the video content, generate high-converting Facebook ad copy using direct response and affiliate marketing principles. Return ONLY valid JSON with this exact structure:

{
  "bodies": [
    "Your ONE best primary text — the highest-converting angle for THIS video. One shot, your best swing."
  ],
  "headlines": [
    "Your ONE best headline — specific to the product/problem in the video (under 40 chars). One shot."
  ],
  "video_summary": "Brief 1-2 sentence summary of what the video shows and says"
}

CRITICAL OUTPUT RULE: Give us exactly ONE body and ONE headline — your single BEST one. Do NOT produce variations. Pick the angle most likely to convert on cold traffic and commit to it fully.

FACEBOOK AD COPY FORMAT:
- "bodies" = Primary Text (appears ABOVE the video in the feed — this is the main copy people read first)
- "headlines" = Headline (appears BELOW the video as the clickable link — short, punchy, must compel the click)
- Primary text should be LONG — 8-15 lines minimum. This is a mini sales letter, NOT a tweet. Hook → pain → agitate → mechanism → benefits → proof → CTA. Real winning FB ads are substantial — short copy doesn't convert on cold traffic.
- Headlines MUST be under 40 characters — Facebook truncates longer ones

THE 7 LAWS OF DIRECT RESPONSE HEADLINES (apply ALL of these):

LAW 1 — OPEN LOOP: Create cognitive tension the reader MUST click to resolve. An incomplete idea, a contradiction, a missing piece. The brain cannot leave an open loop unresolved.
LAW 2 — PAIN AMPLIFICATION: Name the wound before you offer the bandage. People click for RELIEF, not desire. Call out the struggle, name the enemy, show you see their private world.
LAW 3 — MECHANISM FRAMING: Promise a result they've never heard said THIS way before. "Lose weight" = weak. "Lose weight by activating a metabolic trigger most people have never heard of" = strong. Unique + Valuable + Believable.
LAW 4 — SPECIFICITY: Vague slides off the brain. Specific sinks in. Use unusual numbers (not round), exact timeframes, concrete details. Specificity is believability in disguise.
LAW 5 — SIMPLICITY: If the reader has to think, you lose. Short words, short phrases, linear structure. Must be understood at a glance.
LAW 6 — CREDIBILITY: Every big claim generates skepticism. Neutralize it with authority references, data, real-world results, or personal experience.
LAW 7 — TIME COMPRESSION: Shorter timeframe = stronger desire. "24 hours", "one week", "in minutes" — speed makes the promise feel attainable.

HEADLINE FORMULAS — pick the SINGLE strongest one for your headline. Adapt to the SPECIFIC product/problem in the video:
1. OPEN LOOP MYSTERY: "The [specific detail] your doctor won't mention" / "Why [authority] hate this [$ amount] trick"
2. PAIN MIRROR: "Still [doing thing] but [problem won't stop]? Here's why" / "The hidden [enemy] silently [consequence]"
3. MECHANISM REVEAL: "The [unusual ingredient/method] behind [specific result]" / "One [small change] that [measurable outcome]"
4. TIME-COMPRESSED PROMISE: "How to [result] in [short timeframe]" / "[Condition] gone in [X] days?"
5. AUTHORITY PROOF: "Top Doctor: [specific instruction]" / "[Number] [people] now rely on this [method]"
6. STORY/CONFESSION: "I [suffered X years] until I found [this]" / "My [authority] was wrong about [specific thing]"
7. FEAR/CONTRARIAN: "Stop [common action] immediately" / "This 'healthy' [thing] actually [bad consequence]"
8. FORBIDDEN INSIDER: "[Industry] hates this [$ amount] fix" / "The [banned/hidden] remedy that actually works"
9. TRANSFORMATION SNAPSHOT: "Man who [pain state] — now [result] every day!" / "From [bad state] to [good state] in [timeframe]"
10. CALL-OUT + QUESTION: "Do you [symptom]?" / "Too much [problem]? [Simple action] every [time]"

PROVEN WINNERS (real headlines that converted — study their structure, then adapt to YOUR product):
- "Too Much Belly Fat? Drink This Every Morning" (call-out + simple mechanism + time compression)
- "Top Doctor: This is the Fastest Way to End Neuropathy For Good" (authority + specificity + finality)
- "My Feet Were Burning & Tingling Until I Discovered This" (pain + mechanism + curiosity)
- "Man Who Limped With Neuropathy Pain — Now Runs 2 Miles Every Day!" (transformation snapshot)
- "Best Way to Heat Your Home In Under 60 Seconds" (simplicity + time compression + mechanism)
- "How to Stop Mosquito Bites For Good" (simplicity + definitive promise)
- "This $39 Device Is Taking USA By Storm!" (specificity + social proof + curiosity)
- "When Doctors Feel Rotten, This Is What They Do" (authority credibility + open loop)
- "Do You Make These Mistakes in [X]?" (fear of error + call-out)

CRITICAL HEADLINE RULES:
- Do NOT summarize the video — CONVERT its emotional core into a direct response headline structure
- Every headline MUST reference something specific from the video (product, ingredient, condition, body part, result)
- Generic headlines that could apply to any product are FAILURES — be specific
- Under 40 characters — Facebook truncates longer ones
- Pick the strongest single formula — commit to it, don't try to blend multiple
- Apply at least 2 of the 7 Laws in your headline

DIRECT RESPONSE COPYWRITING RULES — follow these strictly:
- Open with an EMOTIONALLY CHARGED pattern interrupt — fear, pain, frustration, or a bold controversial claim. The first 1-2 lines decide EVERYTHING.
- Name the wound FIRST — call out the pain, frustration, or fear HARD before presenting the solution. Don't be gentle about it. Make them FEEL the problem.
- AGITATE the pain — don't just mention it and move on. Twist the knife. Describe what happens if they do nothing. Paint the dark picture. Make the status quo unbearable.
- Then reveal the mechanism/solution — framed as a discovery, a secret, something they haven't tried yet
- Pick one framework and commit to it: PAS (Problem-Agitate-Solve), AIDA, or Before-After-Bridge
- Stack benefits AND handle objections — "Without surgery", "Without expensive prescriptions", "Without changing your diet"
- Weave in specific claims, numbers, or testimonials from the video — specificity = believability
- Create urgency: limited time, limited stock, exclusive access, "before it's gone"
- End EVERY body copy with an urgent, specific CTA (NOT "Learn more" — use "Tap the link to...", "Get yours before...", "See why X people...")
- Pick your SINGLE strongest angle and commit fully — best hook, best framework, strongest emotional trigger. Don't hedge.
- If there's spoken audio, incorporate key phrases, claims, or testimonials from it
- Write like a TOP AFFILIATE MARKETER who needs to be profitable from day one — emotional, urgent, benefit-obsessed, action-oriented
- BODY COPY MUST BE LONG — 8-15 lines minimum. This is a mini sales letter. Short copy does NOT convert on cold traffic. Build the full emotional arc: hook → pain → agitate → mechanism → benefits → proof → objection handling → CTA

TONE — THE SWEET SPOT (this is critical):
- NOT robotic corporate copy. NOT casual chatty young person copy. The sweet spot is: EMOTIONALLY HARD-HITTING direct response that still sounds like a real human wrote it.
- Think: the intensity and persuasion power of a Gary Halbert sales letter, but written in plain spoken language a 55-year-old would use
- Use contractions (don't, won't, can't, you're, it's) — nobody writes "do not" in a Facebook ad
- One idea per line. Short punchy sentences. Line breaks between thoughts. But LOTS of lines — build the emotional case.
- Vary sentence length — mix 3-word punches with 10-word lines
- TARGET AUDIENCE IS 55+ BOOMERS. NO young slang ("kinda", "lowkey", "no cap", "vibe"). Use plain, mature language.
- EMOTIONAL WEIGHT WORDS that hit hard for boomers: "suffering", "struggling", "desperate", "finally", "relief", "breakthrough", "nothing worked", "doctors couldn't help", "I was ready to give up", "changed everything"
- Start some sentences with "And" or "But". Use fragments occasionally. Real copy has rhythm.
- NEVER use ellipses (...)
- NEVER use AI cliché words: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash", "harness", "dive into", "it's time to", "say goodbye to"

BODY COPY FORMAT — match real winning FB ads:
- Use emojis strategically for scanability: ✅ for benefits, ❌ for objection-busting, 👉 for CTAs, ⚠️ for warnings/hooks
- One short sentence or bullet per line — NOT paragraph blocks
- "Without X" / "Without Y" / "Without Z" objection-handling pattern
- Specific claims: "by week 3", "15 minutes a day", "in just 7 days" (reference the video content)
- Risk-reversal: money-back guarantee, free shipping, "try it risk-free"
- Doctor/clinical authority signals: "doctor-recommended", "clinically studied", "board-certified"
- CTA with link mention at end: "👉 Tap the link to see how it works" or "Click below to learn more"
- REPEAT: bodies must be LONG. 8-15 lines MINIMUM. A 3-line body is a FAILURE.

FACEBOOK COMPLIANCE — stay in the safe zone:
- Use "may help" instead of "will cure/fix/eliminate"
- Use "supports" instead of "treats"
- Frame as "many people report" instead of "you will experience"
- Avoid calling out personal attributes: don't say "your belly fat" or "your wrinkles" — say "stubborn belly fat" or "fine lines"
- No income claims or "get rich" language
- No before/after promises with specific outcomes
- Imply the transformation through story, don't promise it directly

EXAMPLE OF GOOD PRIMARY TEXT OUTPUT (study this LENGTH and emotional intensity):
"⚠️ If you're over 50 and your feet ache the moment you step out of bed

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

- Return ONLY the JSON, no markdown formatting or code blocks"""

TRANSCRIPTION_PROMPT = """Watch this video carefully and transcribe ALL spoken audio — every word of the voiceover, narration, dialogue, or on-screen text that is read aloud.

Return ONLY valid JSON with this exact structure:

{
  "transcript": "The full word-for-word transcript of everything spoken in the video",
  "key_claims": ["List of specific claims, benefits, or testimonials mentioned"],
  "product_name": "The product or brand name if mentioned, otherwise null",
  "tone": "Brief description of the speaker's tone and style (e.g. excited, authoritative, casual)"
}

Rules:
- Transcribe verbatim — capture the exact words spoken, including filler words if they add authenticity
- If there are multiple speakers, note speaker changes with [Speaker 1], [Speaker 2] etc.
- If no audio/speech is detected, set transcript to "" and still fill in key_claims from any on-screen text
- Return ONLY the JSON, no markdown formatting or code blocks"""

IMAGE_ANALYSIS_PROMPT = """You are an elite direct-response copywriter who specializes in Facebook ads that CONVERT. You've studied the greats — Gary Halbert, Eugene Schwartz, David Ogilvy — and you write scroll-stopping copy that drives clicks and sales.

CONTEXT: This image is being uploaded as a Facebook image ad creative. The "bodies" you write will be the PRIMARY TEXT shown above the image in the Facebook News Feed. The "headlines" will appear below the image as the clickable headline link. This ad needs to be profitable from DAY ONE — we cannot lose money up front. Write copy that maximizes CTR and drives immediate conversions on cold traffic.

Analyze this image carefully — pay attention to the product, the setting, any text overlays, branding, and the overall mood/vibe.

Based on the image, generate high-converting Facebook ad copy using direct response and affiliate marketing principles. Return ONLY valid JSON with this exact structure:

{
  "bodies": [
    "Your ONE best primary text — the highest-converting angle for THIS image. One shot, your best swing."
  ],
  "headlines": [
    "Your ONE best headline — specific to the product/problem in the image (under 40 chars). One shot."
  ],
  "image_summary": "Brief 1-2 sentence summary of what the image shows"
}

CRITICAL OUTPUT RULE: Give us exactly ONE body and ONE headline — your single BEST one. Do NOT produce variations. Pick the angle most likely to convert on cold traffic and commit to it fully.

FACEBOOK AD COPY FORMAT:
- "bodies" = Primary Text (appears ABOVE the image in the feed — this is the main copy people read first)
- "headlines" = Headline (appears BELOW the image as the clickable link — short, punchy, must compel the click)
- Primary text should be LONG — 8-15 lines minimum. This is a mini sales letter, NOT a tweet. Hook → pain → agitate → mechanism → benefits → proof → CTA. Real winning FB ads are substantial — short copy doesn't convert on cold traffic.
- Headlines MUST be under 40 characters — Facebook truncates longer ones

THE 7 LAWS OF DIRECT RESPONSE HEADLINES (apply ALL of these):

LAW 1 — OPEN LOOP: Create cognitive tension the reader MUST click to resolve. An incomplete idea, a contradiction, a missing piece.
LAW 2 — PAIN AMPLIFICATION: Name the wound before you offer the bandage. People click for RELIEF. Call out the struggle.
LAW 3 — MECHANISM FRAMING: Promise a result they've never heard said THIS way before. Unique + Valuable + Believable.
LAW 4 — SPECIFICITY: Use unusual numbers (not round), exact timeframes, concrete details. Specificity is believability in disguise.
LAW 5 — SIMPLICITY: Short words, short phrases, linear structure. Must be understood at a glance.
LAW 6 — CREDIBILITY: Neutralize skepticism with authority references, data, real-world results, or personal experience.
LAW 7 — TIME COMPRESSION: Shorter timeframe = stronger desire. Speed makes the promise feel attainable.

HEADLINE FORMULAS — pick the SINGLE strongest one for your headline. Adapt to the SPECIFIC product/problem in the image:
1. OPEN LOOP MYSTERY: "The [specific detail] your doctor won't mention" / "Why [authority] hate this [$ amount] trick"
2. PAIN MIRROR: "Still [doing thing] but [problem won't stop]? Here's why" / "The hidden [enemy] silently [consequence]"
3. MECHANISM REVEAL: "The [unusual ingredient/method] behind [specific result]" / "One [small change] that [measurable outcome]"
4. TIME-COMPRESSED PROMISE: "How to [result] in [short timeframe]" / "[Condition] gone in [X] days?"
5. AUTHORITY PROOF: "Top Doctor: [specific instruction]" / "[Number] [people] now rely on this [method]"
6. STORY/CONFESSION: "I [suffered X years] until I found [this]" / "My [authority] was wrong about [specific thing]"
7. FEAR/CONTRARIAN: "Stop [common action] immediately" / "This 'healthy' [thing] actually [bad consequence]"
8. FORBIDDEN INSIDER: "[Industry] hates this [$ amount] fix" / "The [banned/hidden] remedy that actually works"
9. TRANSFORMATION SNAPSHOT: "Man who [pain state] — now [result] every day!" / "From [bad state] to [good state] in [timeframe]"
10. CALL-OUT + QUESTION: "Do you [symptom]?" / "Too much [problem]? [Simple action] every [time]"

PROVEN WINNERS (study their structure, adapt to YOUR product):
- "Too Much Belly Fat? Drink This Every Morning" (call-out + mechanism + time compression)
- "Top Doctor: This is the Fastest Way to End Neuropathy For Good" (authority + specificity + finality)
- "My Feet Were Burning & Tingling Until I Discovered This" (pain + mechanism + curiosity)
- "Man Who Limped With Neuropathy Pain — Now Runs 2 Miles Every Day!" (transformation snapshot)
- "Best Way to Heat Your Home In Under 60 Seconds" (simplicity + time compression + mechanism)
- "How to Stop Mosquito Bites For Good" (simplicity + definitive promise)
- "This $39 Device Is Taking USA By Storm!" (specificity + social proof + curiosity)
- "When Doctors Feel Rotten, This Is What They Do" (authority + open loop)

CRITICAL HEADLINE RULES:
- Do NOT describe the image — CONVERT its emotional core into a direct response headline
- Every headline MUST reference something specific from the image (product, ingredient, condition, body part, result)
- Generic headlines that could apply to any product are FAILURES
- Under 40 characters — Facebook truncates longer ones
- Pick the strongest single formula — commit to it, don't try to blend multiple
- Apply at least 2 of the 7 Laws in your headline

DIRECT RESPONSE COPYWRITING RULES — follow these strictly:
- Open with an EMOTIONALLY CHARGED pattern interrupt — fear, pain, frustration, or a bold controversial claim. The first 1-2 lines decide EVERYTHING.
- Name the wound FIRST — call out the pain, frustration, or fear HARD before presenting the solution. Don't be gentle about it. Make them FEEL the problem.
- AGITATE the pain — don't just mention it and move on. Twist the knife. Describe what happens if they do nothing. Paint the dark picture. Make the status quo unbearable.
- Then reveal the mechanism/solution — framed as a discovery, a secret, something they haven't tried yet
- Pick one framework and commit to it: PAS (Problem-Agitate-Solve), AIDA, or Before-After-Bridge
- Stack benefits AND handle objections — "Without surgery", "Without expensive prescriptions", "Without changing your diet"
- If there's text in the image, incorporate key phrases, claims, or offers from it
- Create urgency: limited time, limited stock, exclusive access, "before it's gone"
- End EVERY body copy with an urgent, specific CTA (NOT "Learn more" — use "Tap the link to...", "Get yours before...", "See why X people...")
- Pick your SINGLE strongest angle and commit fully — best hook, best framework, strongest emotional trigger. Don't hedge.
- Write like a TOP AFFILIATE MARKETER who needs to be profitable from day one — emotional, urgent, benefit-obsessed, action-oriented
- BODY COPY MUST BE LONG — 8-15 lines minimum. This is a mini sales letter. Short copy does NOT convert on cold traffic. Build the full emotional arc: hook → pain → agitate → mechanism → benefits → proof → objection handling → CTA

TONE — THE SWEET SPOT (this is critical):
- NOT robotic corporate copy. NOT casual chatty young person copy. The sweet spot is: EMOTIONALLY HARD-HITTING direct response that still sounds like a real human wrote it.
- Think: the intensity and persuasion power of a Gary Halbert sales letter, but written in plain spoken language a 55-year-old would use
- Use contractions (don't, won't, can't, you're, it's) — nobody writes "do not" in a Facebook ad
- One idea per line. Short punchy sentences. Line breaks between thoughts. But LOTS of lines — build the emotional case.
- Vary sentence length — mix 3-word punches with 10-word lines
- TARGET AUDIENCE IS 55+ BOOMERS. NO young slang ("kinda", "lowkey", "no cap", "vibe"). Use plain, mature language.
- EMOTIONAL WEIGHT WORDS that hit hard for boomers: "suffering", "struggling", "desperate", "finally", "relief", "breakthrough", "nothing worked", "doctors couldn't help", "I was ready to give up", "changed everything"
- Start some sentences with "And" or "But". Use fragments occasionally. Real copy has rhythm.
- NEVER use ellipses (...)
- NEVER use AI cliché words: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash", "harness", "dive into", "it's time to", "say goodbye to"

BODY COPY FORMAT — match real winning FB ads:
- Use emojis strategically for scanability: ✅ for benefits, ❌ for objection-busting, 👉 for CTAs, ⚠️ for warnings/hooks
- One short sentence or bullet per line — NOT paragraph blocks
- "Without X" / "Without Y" / "Without Z" objection-handling pattern
- Specific claims: "by week 3", "15 minutes a day", "in just 7 days" (reference the image content)
- Risk-reversal: money-back guarantee, free shipping, "try it risk-free"
- Doctor/clinical authority signals: "doctor-recommended", "clinically studied", "board-certified"
- CTA with link mention at end: "👉 Tap the link to see how it works" or "Click below to learn more"
- REPEAT: bodies must be LONG. 8-15 lines MINIMUM. A 3-line body is a FAILURE.

FACEBOOK COMPLIANCE — stay in the safe zone:
- Use "may help" instead of "will cure/fix/eliminate"
- Use "supports" instead of "treats"
- Frame as "many people report" instead of "you will experience"
- Avoid calling out personal attributes: don't say "your belly fat" or "your wrinkles" — say "stubborn belly fat" or "fine lines"
- No income claims or "get rich" language
- No before/after promises with specific outcomes
- Imply the transformation through story, don't promise it directly

EXAMPLE OF GOOD PRIMARY TEXT OUTPUT (study this LENGTH and emotional intensity):
"⚠️ If you're over 50 and your feet ache the moment you step out of bed

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

- Return ONLY the JSON, no markdown formatting or code blocks"""


HAIKU_SYSTEM_PROMPT = """You are an elite direct-response copywriter for Facebook ads, specializing in affiliate marketing that needs to be profitable on the frontend FAST. You write for cold traffic — people who have never heard of this product — and your only job is to stop their scroll, hook them, and get the click.

IMPORTANT CONTEXT: You are writing Facebook ad copy — "bodies" are the Primary Text that appears ABOVE the video/image in the News Feed, and "headlines" appear BELOW as the clickable link. This ad must be profitable from DAY ONE. We cannot afford to lose money up front.

Your copy philosophy:
- You write like the best affiliate marketers: Frank Kern, Ryan Deiss, Ezra Firestone, Gary Halbert
- Every ad must pass the "would I stop scrolling for this?" test
- You optimize for CTR first, then conversion — because without the click, nothing else matters
- You treat Facebook ad copy like a mini sales letter: hook → pain → agitate → mechanism → proof → CTA
- Body copy MUST be LONG — 8-15 lines minimum. Short 3-line copy is a FAILURE. Build the full emotional arc. Real affiliate ads that convert on cold traffic are substantial mini sales letters, not tweets.

THE 7 LAWS you must apply to every headline:
1. OPEN LOOP — create tension the reader must click to resolve
2. PAIN AMPLIFICATION — name the wound before offering the bandage
3. MECHANISM FRAMING — promise results in a way they've never heard before
4. SPECIFICITY — unusual numbers, exact timeframes, concrete details
5. SIMPLICITY — understood at a glance, short words, linear structure
6. CREDIBILITY — authority, data, real results to neutralize skepticism
7. TIME COMPRESSION — shorter timeframe = stronger desire

Your direct-response rules:
1. HOOK (first line): EMOTIONALLY CHARGED pattern interrupt. Fear, pain, frustration, or a bold controversial claim. This line alone decides if they read or scroll.
2. PAIN: Name the wound HARD. Don't be gentle. Make them FEEL the problem deeply.
3. AGITATE: Twist the knife. Describe what happens if they do nothing. Make the status quo unbearable.
4. MECHANISM: Reveal the solution — framed as a discovery, something they haven't tried yet.
5. PROOF: Weave in specific claims, numbers, or testimonials from the video. Specificity = believability.
6. OBJECTIONS: Handle them — "Without surgery", "Without prescriptions", "Without changing your diet"
7. CTA: Every body MUST end with an urgent, specific call to action. "Learn more" is BANNED. Use "Tap the link to...", "Get yours before...", "See why X people..."
8. LENGTH: Bodies MUST be 8-15 lines minimum. Build the full emotional arc. A 3-line body is a FAILURE.
9. TONE: NOT casual chatty. NOT robotic corporate. The sweet spot is: emotionally hard-hitting DR copy that still sounds like a real human. Think Gary Halbert's persuasion intensity in plain spoken 55+ boomer language. Use emotional weight words: "suffering", "struggling", "desperate", "finally", "relief", "nothing worked", "changed everything".
10. HEADLINES — THIS IS CRITICAL. Pick the SINGLE strongest formula from this list for your one headline:
   - OPEN LOOP: "The [detail] your doctor won't mention" / "Why [authority] hate this [$ amount] trick"
   - PAIN MIRROR: "Still [doing thing] but [problem]? Here's why"
   - MECHANISM REVEAL: "The [unusual method] behind [specific result]"
   - TIME-COMPRESSED: "[Condition] gone in [X] days?" / "How to [result] in [timeframe]"
   - AUTHORITY: "Top Doctor: [instruction]" / "[Number] people now rely on this"
   - STORY: "I [suffered X] until I found [this]" / "My [authority] was wrong about [thing]"
   - FEAR: "Stop [common action] immediately" / "This 'healthy' [thing] actually [bad result]"
   - FORBIDDEN: "[Industry] hates this [$ amount] fix"
   - TRANSFORMATION: "Man who [pain] — now [result] every day!"
   - CALL-OUT: "Too much [problem]? [Action] every [time]" / "Do you [symptom]?"
   PROVEN WINNERS: "Too Much Belly Fat? Drink This Every Morning" / "Top Doctor: Fastest Way to End Neuropathy For Good" / "My Feet Were Burning & Tingling Until I Discovered This" / "Man Who Limped With Neuropathy Pain — Now Runs 2 Miles Every Day!" / "Best Way to Heat Your Home In Under 60 Seconds" / "How to Stop Mosquito Bites For Good" / "This $39 Device Is Taking USA By Storm!"
   Do NOT summarize — CONVERT the video's emotional core into a headline structure. The headline MUST reference the SPECIFIC product, ingredient, condition, or result. Generic = FAILURE. Under 40 chars. Pick your strongest single formula.
7. Commit to your SINGLE strongest angle — best hook, best framework, strongest emotional trigger. Don't hedge across multiple takes.

SOUND HUMAN — MANDATORY:
- NEVER use ellipses (...)
- NEVER use AI cliché words: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash", "harness", "dive into", "it's time to", "say goodbye to"
- One idea per line. Short punchy sentences. Line breaks between thoughts. But LOTS of lines — build the case.
- Vary sentence length — mix 3-word punches with 10-word lines
- Use contractions (don't, won't, can't, you're, it's)
- TARGET AUDIENCE IS 55+ BOOMERS. NO young slang ("kinda", "lowkey", "no cap", "vibe"). Plain, mature language.
- Start some sentences with "And" or "But". Use fragments occasionally.

BODY COPY FORMAT — match real winning FB ads:
- Use emojis strategically: ✅ for benefits, ❌ for objection-busting, 👉 for CTAs, ⚠️ for warnings
- One short sentence or bullet per line — NOT paragraph blocks
- "Without X" / "Without Y" / "Without Z" objection-handling pattern
- Specific claims from the video: "by week 3", "15 minutes a day", "in just 7 days"
- Risk-reversal: money-back guarantee, free shipping, "try it risk-free"
- Doctor/clinical authority signals: "doctor-recommended", "clinically studied", "board-certified"
- CTA with link mention: "👉 Tap the link to see how it works"
- REPEAT: bodies must be LONG. 8-15 lines MINIMUM. A 3-line body is a FAILURE.

FACEBOOK COMPLIANCE — stay in the safe zone:
- Use "may help" instead of "will cure/fix/eliminate"
- Use "supports" instead of "treats"
- Frame as "many people report" instead of "you will experience"
- Avoid calling out personal attributes: don't say "your belly fat" — say "stubborn belly fat"
- No income claims, no before/after promises with specific outcomes
- Imply the transformation through story, don't promise it directly

You are writing ads that need to generate a positive ROI from day one. Every word must earn its place. Write LONG, emotionally powerful copy — not short throwaway lines."""


SAFE_VIDEO_PROMPT = """You are a Facebook ad copywriter who writes clean, policy-compliant copy that STILL converts. You don't write boring corporate copy — you write warm, human, conversational copy that just happens to be 100% compliant.

Watch/analyze this video carefully — pay attention to both the visuals AND the audio/voiceover.

Based on the video content, generate Facebook ad copy that is safe, compliant, AND engaging. Return ONLY valid JSON with this exact structure:

{
  "bodies": [
    "Your ONE best primary text — warm, human, compliant, and the highest-CTR angle for THIS video. One shot."
  ],
  "headlines": [
    "Your ONE best headline (under 40 chars) — clear benefit OR curiosity, whichever wins for this product."
  ],
  "video_summary": "Brief 1-2 sentence summary of what the video shows and says"
}

CRITICAL OUTPUT RULE: Give us exactly ONE body and ONE headline — your single BEST one. No variations. Commit to your strongest angle.

FACEBOOK AD COPY FORMAT:
- "bodies" = Primary Text (appears ABOVE the video — main copy people read first)
- "headlines" = Headline (appears BELOW the video as clickable link — short, must compel)
- Headlines MUST be under 40 characters

COMPLIANCE RULES — non-negotiable:
- DO NOT make health claims, income claims, or before/after promises
- DO NOT use: "shocking", "secret", "miracle", "guaranteed", "limited time", "act now"
- DO NOT create false urgency or scarcity
- DO NOT call out personal attributes: say "stubborn belly fat" not "your belly fat"
- Use "may help" instead of "will cure/fix". Use "supports" instead of "treats"
- Frame as "many people report" instead of "you will experience"
- No before/after promises with specific outcomes
- Write copy that passes Facebook's automated review with zero issues

STILL SOUND HUMAN — compliance doesn't mean robotic:
- NEVER use ellipses (...)
- NEVER use AI cliché words: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash"
- Use contractions (don't, won't, can't, you're, it's)
- Short sentences. One idea per line. Line breaks between thoughts.
- Vary sentence length — mix short punches with slightly longer lines
- TARGET AUDIENCE IS 55+ BOOMERS. NO young slang. Use warm, mature, straightforward language.
- Good tone words: "honestly", "here's the thing", "look", "I was skeptical too", "my doctor told me"
- Write like one 55-year-old recommending something to another — not a brand, not a young marketer

BODY COPY FORMAT:
- Use a few emojis for scanability: ✅ for benefits, 👉 for CTAs — but don't overdo it
- One short sentence per line — NOT paragraph blocks
- Focus on genuine benefits, not hype
- Doctor/authority signals where relevant — boomers trust doctors
- End with a simple CTA: "Learn More", "See Details", "Find Out More", "Shop Now"
- Pick the SINGLE strongest angle for this product: benefit-focused OR curiosity OR social proof — commit to one, don't blend
- If there's spoken audio, reference actual content without exaggeration

EXAMPLE OF GOOD SAFE PRIMARY TEXT:
"I'll be honest — I didn't think this would work.

But after trying everything else for my feet, a friend told me about this.

It's a simple method developed by a board-certified podiatrist.

✅ Takes less than a minute
✅ No prescription needed
✅ Over 1 million people have tried it

👉 Learn More"

- Return ONLY the JSON, no markdown formatting or code blocks"""


SAFE_IMAGE_PROMPT = """You are a Facebook ad copywriter who writes clean, policy-compliant copy that STILL converts. You don't write boring corporate copy — you write warm, human, conversational copy that just happens to be 100% compliant.

Analyze this image carefully — pay attention to the product, the setting, any text overlays, branding, and the overall mood.

Based on the image, generate Facebook ad copy that is safe, compliant, AND engaging. Return ONLY valid JSON with this exact structure:

{
  "bodies": [
    "Your ONE best primary text — warm, human, compliant, and the highest-CTR angle for THIS image. One shot."
  ],
  "headlines": [
    "Your ONE best headline (under 40 chars) — clear benefit OR curiosity, whichever wins for this product."
  ],
  "image_summary": "Brief 1-2 sentence summary of what the image shows"
}

CRITICAL OUTPUT RULE: Give us exactly ONE body and ONE headline — your single BEST one. No variations. Commit to your strongest angle.

FACEBOOK AD COPY FORMAT:
- "bodies" = Primary Text (appears ABOVE the image — main copy people read first)
- "headlines" = Headline (appears BELOW the image as clickable link — short, must compel)
- Headlines MUST be under 40 characters

COMPLIANCE RULES — non-negotiable:
- DO NOT make health claims, income claims, or before/after promises
- DO NOT use: "shocking", "secret", "miracle", "guaranteed", "limited time", "act now"
- DO NOT create false urgency or scarcity
- DO NOT call out personal attributes: say "stubborn belly fat" not "your belly fat"
- Use "may help" instead of "will cure/fix". Use "supports" instead of "treats"
- Frame as "many people report" instead of "you will experience"
- No before/after promises with specific outcomes
- Write copy that passes Facebook's automated review with zero issues

STILL SOUND HUMAN — compliance doesn't mean robotic:
- NEVER use ellipses (...)
- NEVER use AI cliché words: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash"
- Use contractions (don't, won't, can't, you're, it's)
- Short sentences. One idea per line. Line breaks between thoughts.
- Vary sentence length — mix short punches with slightly longer lines
- TARGET AUDIENCE IS 55+ BOOMERS. NO young slang. Use warm, mature, straightforward language.
- Good tone words: "honestly", "here's the thing", "look", "I was skeptical too", "my doctor told me"
- Write like one 55-year-old recommending something to another — not a brand, not a young marketer

BODY COPY FORMAT:
- Use a few emojis for scanability: ✅ for benefits, 👉 for CTAs — but don't overdo it
- One short sentence per line — NOT paragraph blocks
- Focus on genuine benefits, not hype
- Doctor/authority signals where relevant — boomers trust doctors
- End with a simple CTA: "Learn More", "See Details", "Find Out More", "Shop Now"
- Pick the SINGLE strongest angle for this product: benefit-focused OR curiosity OR social proof — commit to one, don't blend
- If there's text in the image, reference actual content without exaggeration

EXAMPLE OF GOOD SAFE PRIMARY TEXT:
"I'll be honest — I didn't think this would work.

But after trying everything else for my feet, a friend told me about this.

It's a simple method developed by a board-certified podiatrist.

✅ Takes less than a minute
✅ No prescription needed
✅ Over 1 million people have tried it

👉 Learn More"

- Return ONLY the JSON, no markdown formatting or code blocks"""


GROUP_VOICE_IMAGE_PROMPT = """You are writing Facebook ad copy that sounds like a REAL PERSON aged 55-75 posting in a private Facebook support group. The reader should NEVER feel like they're reading an ad. They should feel like they're reading a neighbor's post.

Analyze this image carefully — pay attention to the product, the setting, any text overlays, branding, and the overall mood.

Based on the image, generate Facebook ad copy in "group voice" style. Return ONLY valid JSON with this exact structure:

{
  "bodies": [
    "Your ONE best primary text — sounds like a real group member, 1-3 sentences, phone-typing energy. The single most scroll-stopping testimony for THIS image."
  ],
  "headlines": [
    "Your ONE best headline — editorial/article title style (under 40 chars). Strongest curiosity gap for this product."
  ],
  "image_summary": "Brief 1-2 sentence summary of what the image shows"
}

CRITICAL OUTPUT RULE: Give us exactly ONE body and ONE headline — your single BEST one. No variations. Pick the persona/angle most likely to convert and commit fully.

=== VOICE RULES ===

Every piece of body copy must sound like a real person typing on their phone in a private support group.

HOW TO WRITE THE BODY:
- 1-3 sentences max. Short and dashed off. Phone-typing energy.
- Fragments and run-ons are fine. Imperfect grammar is fine. Lowercase is fine.
- No emojis. No hashtags. No exclamation marks unless raw emotion.
- No ellipses (...). Use periods or dashes instead.
- Pick ONE specific real person — commit to their age, gender, tone, and details. Don't blend personas.

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

EMOTIONAL TRIGGERS (pick 1-2 for your one body):
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
- Reference something specific from the IMAGE (product, condition, body part)

=== FACEBOOK COMPLIANCE ===

- Never say "cure" or "cures"
- Never say "you have [condition]" or "your [condition]" (personal attribute targeting)
- Frame everything as personal experience: "this ended my burning" not "this will end your burning"
- No before/after guarantees
- Avoid "you" statements about health conditions

=== QUALITY CHECK ===

Before outputting any copy, check:
1. Does this sound like a real person typed it on their phone? If it sounds "written" — rewrite messier.
2. Is there a curiosity gap? If the reader knows everything without clicking — add mystery.
3. Is there at least one specific number? ($amount, years, age, time)
4. Are any banned words present? If yes — replace with group member language.
5. Is the body 1-3 sentences? If longer — cut.

=== EXAMPLE OUTPUTS (this is the quality bar — study these closely) ===

EXAMPLE 1 — Angry veteran, money wasted, neighbor discovery:
"No one satisfies what it's like to have your feet on fire at 3am and your doctor just says "learn to live with it." 9 years of gabapentin brain fog and $34,000 on treatments that did nothing. My neighbor handed me a $39 thing and said just try it. The burning stopped in a week. I'm furious nobody told me sooner"

EXAMPLE 2 — Skeptic spouse, medication escape, circulation revelation:
"my wife found this thing for neuropathy and I told her I was done trying stuff. 11 years. every pill every supplement every scam clinic. she ordered it anyway. I haven't taken gabapentin in 3 weeks and I slept through the night 4 times this week. first time since 2020. I owe her an apology and I owe this group the truth — the problem was never my nerves. it was circulation. no pill fixes that"

EXAMPLE 3 — Long-time lurker, price contrast, quiet conviction:
"$34,000 over 9 years on neuropathy treatments. gabapentin turned my brain to mush. Lyrica put 40 pounds on me. doctor told me nerve damage is permanent. then I find out my nerves aren't dead they're starving for blood flow and a $39 foot wrap does what none of it could. been in this group 3 years and this is the first time I've come back to say something actually worked. do with that what you will"

WHAT MAKES THESE WORK:
- They read like someone sat down and typed out their frustration on their phone
- Run-on sentences, fragments, lowercase — messy and REAL
- Specific numbers everywhere ($34,000, 9 years, $39, 3 weeks, 4 times this week, since 2020)
- Emotional weight builds across sentences — anger, exhaustion, then relief
- Product is NEVER named — just "this thing", "a $39 thing", "a $39 foot wrap"
- Discovery attributed to real people (neighbor, wife) not marketing
- Each one hits a different emotional core: rage, skepticism, quiet proof
- They make you NEED to know what the product is without ever saying click here

YOUR COPY MUST MATCH THIS ENERGY. If it sounds like marketing — rewrite it. If it sounds polished — make it messier. If it could appear in a Facebook ad without raising suspicion — you failed. It should look like someone's raw testimony.

Pick the SINGLE strongest angle for this image — don't write all three, choose the one that will hit hardest:
- Personal discovery / someone showed me (angry, specific, peer attribution)
- Spouse or family member voice (skeptic converted, owes someone an apology)
- Long-time group member finally posting (quiet conviction, price contrast, "do with that what you will" energy)
Commit to one. Don't hedge across multiple angles.

- Return ONLY the JSON, no markdown formatting or code blocks"""


def _get_brand_context(brand_id: str, db: Session) -> str:
    """Fetch brand voice, style guide, and research docs to inject into AI prompts."""
    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not brand:
        return ""
    parts = []
    if brand.voice:
        parts.append(f"BRAND VOICE & STYLE GUIDE:\n{brand.voice}")

    # Structured style guide fields
    sg = brand.style_guide or {}
    if sg:
        sg_parts = []
        if sg.get('tone'):
            sg_parts.append(f"TONE OF VOICE: {sg['tone']}")
        if sg.get('keywords'):
            kw = sg['keywords'] if isinstance(sg['keywords'], list) else [sg['keywords']]
            sg_parts.append(f"KEYWORDS TO USE (weave these naturally into copy): {', '.join(kw)}")
        if sg.get('banned_words'):
            bw = sg['banned_words'] if isinstance(sg['banned_words'], list) else [sg['banned_words']]
            sg_parts.append(f"BANNED WORDS (NEVER use these): {', '.join(bw)}")
        if sg.get('pain_points'):
            pp = sg['pain_points'] if isinstance(sg['pain_points'], list) else [sg['pain_points']]
            sg_parts.append(f"AUDIENCE PAIN POINTS (reference these):\n- " + "\n- ".join(pp))
        if sg.get('proof_points'):
            pr = sg['proof_points'] if isinstance(sg['proof_points'], list) else [sg['proof_points']]
            sg_parts.append(f"PROOF & AUTHORITY SIGNALS (cite these for credibility):\n- " + "\n- ".join(pr))
        if sg.get('cta_style'):
            sg_parts.append(f"CTA STYLE: {sg['cta_style']}")
        if sg.get('example_copy'):
            sg_parts.append(f"EXAMPLE WINNING COPY (match this style and energy):\n{sg['example_copy']}")
        if sg.get('notes'):
            sg_parts.append(f"ADDITIONAL STYLE NOTES:\n{sg['notes']}")
        if sg_parts:
            parts.append("BRAND STYLE RULES:\n" + "\n".join(sg_parts))

    # Fetch research docs for this brand
    docs = db.query(Prompt).filter(Prompt.brand_id == brand_id, Prompt.type == 'research').all()
    if docs:
        research_text = "\n".join([d.template[:3000] for d in docs[:3]])
        parts.append(f"PRODUCT RESEARCH (use real product details — specific claims, ingredients, benefits):\n{research_text}")
    return "\n\n".join(parts)


def _parse_ai_response(raw_text: str) -> dict:
    """Parse JSON from AI response, handling markdown code fences and extra text."""
    json_text = raw_text.strip()

    # Strip markdown code fences (```json ... ``` or ``` ... ```)
    if "```" in json_text:
        import re
        match = re.search(r"```(?:json)?\s*\n?(.*?)```", json_text, re.DOTALL)
        if match:
            json_text = match.group(1).strip()

    # If still not valid JSON, try to find the JSON object in the text
    if not json_text.startswith("{"):
        start = json_text.find("{")
        end = json_text.rfind("}") + 1
        if start != -1 and end > start:
            json_text = json_text[start:end]

    result = json.loads(json_text)
    if "bodies" not in result or "headlines" not in result:
        raise ValueError("Response missing required fields")
    return result


def _extract_frames(video_path: str, num_frames: int = 10) -> list[str]:
    """Extract frames from a video using ffmpeg, return list of temp file paths."""
    tmp_dir = tempfile.mkdtemp(prefix="claude_frames_")

    # Get video duration
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    try:
        duration = float(subprocess.check_output(probe_cmd, stderr=subprocess.DEVNULL).decode().strip())
    except (subprocess.CalledProcessError, ValueError):
        duration = 30.0  # fallback

    # Calculate interval between frames
    interval = max(duration / (num_frames + 1), 0.5)

    # Extract frames at regular intervals
    output_pattern = os.path.join(tmp_dir, "frame_%03d.jpg")
    ffmpeg_cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps=1/{interval:.2f}",
        "-frames:v", str(num_frames),
        "-q:v", "2",
        output_pattern,
        "-y", "-loglevel", "error",
    ]
    subprocess.run(ffmpeg_cmd, check=True, timeout=60)

    frame_paths = sorted(glob.glob(os.path.join(tmp_dir, "frame_*.jpg")))
    print(f"[video_analysis] Extracted {len(frame_paths)} frames from video ({duration:.1f}s)")
    return frame_paths


async def _transcribe_with_gemini(tmp_path: str, filename: str, content_length: int) -> dict:
    """Use Gemini to transcribe the video audio and extract key claims."""
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")
    if genai is None:
        raise HTTPException(status_code=500, detail="google-genai package is not installed")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    gemini_file = None

    try:
        print(f"[video_analysis:transcribe] Uploading {filename} ({content_length} bytes) for transcription...")
        gemini_file = client.files.upload(file=tmp_path)

        max_wait, poll_interval, elapsed = 120, 3, 0
        while gemini_file.state.name == "PROCESSING" and elapsed < max_wait:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            gemini_file = client.files.get(name=gemini_file.name)

        if gemini_file.state.name == "FAILED":
            raise HTTPException(status_code=500, detail="Gemini failed to process the video for transcription")
        if gemini_file.state.name != "ACTIVE":
            raise HTTPException(status_code=500, detail=f"Video processing timed out after {max_wait}s")

        print(f"[video_analysis:transcribe] File ready, transcribing with gemini-2.0-flash...")
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[gemini_file, TRANSCRIPTION_PROMPT],
        )

        if hasattr(response, "usage_metadata") and response.usage_metadata:
            um = response.usage_metadata
            print(f"[video_analysis:transcribe] Tokens — prompt: {um.prompt_token_count}, response: {um.candidates_token_count}")

        raw_text = response.text.strip()
        print(f"[video_analysis:transcribe] Transcript response: {raw_text[:300]}")
        result = _parse_ai_response_flexible(raw_text)
        return result

    finally:
        if gemini_file:
            try:
                client.files.delete(name=gemini_file.name)
            except Exception as e:
                print(f"[video_analysis:transcribe] Failed to clean up Gemini file: {e}")


def _parse_ai_response_flexible(raw_text: str) -> dict:
    """Parse JSON from AI response, handling markdown code fences. No required fields."""
    import re
    json_text = raw_text.strip()

    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", json_text, re.DOTALL)
    if fence_match:
        json_text = fence_match.group(1).strip()

    if not json_text.startswith("{") and not json_text.startswith("["):
        start = json_text.find("{")
        end = json_text.rfind("}") + 1
        if start != -1 and end > start:
            json_text = json_text[start:end]

    return json.loads(json_text)


async def _analyze_with_gemini(tmp_path: str, filename: str, content_length: int, prompt_override: str = None) -> dict:
    """Analyze video with Gemini 2.0 Flash (supports video+audio natively)."""
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")
    if genai is None:
        raise HTTPException(status_code=500, detail="google-genai package is not installed")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    gemini_file = None

    try:
        print(f"[video_analysis:gemini] Uploading {filename} ({content_length} bytes) to Gemini File API...")
        gemini_file = client.files.upload(file=tmp_path)
        print(f"[video_analysis:gemini] File uploaded: {gemini_file.name}, state={gemini_file.state}")

        # Poll until processing is complete
        max_wait, poll_interval, elapsed = 120, 3, 0
        while gemini_file.state.name == "PROCESSING" and elapsed < max_wait:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            gemini_file = client.files.get(name=gemini_file.name)
            print(f"[video_analysis:gemini] Polling... state={gemini_file.state} ({elapsed}s)")

        if gemini_file.state.name == "FAILED":
            raise HTTPException(status_code=500, detail="Gemini failed to process the video")
        if gemini_file.state.name != "ACTIVE":
            raise HTTPException(
                status_code=500,
                detail=f"Video processing timed out after {max_wait}s (state: {gemini_file.state.name})",
            )

        print(f"[video_analysis:gemini] File ready, sending to gemini-2.0-flash...")
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[gemini_file, prompt_override or ANALYSIS_PROMPT],
        )

        if hasattr(response, "usage_metadata") and response.usage_metadata:
            um = response.usage_metadata
            print(f"[video_analysis:gemini] Tokens — prompt: {um.prompt_token_count}, response: {um.candidates_token_count}, total: {um.total_token_count}")

        raw_text = response.text.strip()
        print(f"[video_analysis:gemini] Raw response: {raw_text[:500]}")
        return _parse_ai_response(raw_text)

    finally:
        if gemini_file:
            try:
                client.files.delete(name=gemini_file.name)
                print(f"[video_analysis:gemini] Cleaned up Gemini file: {gemini_file.name}")
            except Exception as e:
                print(f"[video_analysis:gemini] Failed to clean up Gemini file: {e}")


def _call_claude_oauth(prompt: str, timeout: int = 120) -> str:
    """Call Claude via OAuth (free) first, fall back to API key."""
    # Try claude CLI with OAuth first (free, local only)
    if shutil.which('claude'):
        try:
            result = subprocess.run(
                ['env', '-u', 'ANTHROPIC_API_KEY', 'claude', '-p', '--output-format', 'text'],
                input=prompt, capture_output=True, text=True, timeout=timeout,
            )
            if result.returncode == 0 and result.stdout.strip():
                print("[video_analysis] Used OAuth (free)")
                return result.stdout.strip()
        except Exception as e:
            print(f"[video_analysis] OAuth call failed: {e}")

    # Fallback: Anthropic API key
    if settings.ANTHROPIC_API_KEY and anthropic:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        print("[video_analysis] Used Anthropic API key fallback")
        return response.content[0].text.strip()

    raise HTTPException(status_code=500, detail="No Claude access — claude CLI not found and ANTHROPIC_API_KEY not set")


async def _analyze_with_claude(tmp_path: str, filename: str, transcript_data: dict = None, brand_context: str = "") -> dict:
    """Two-step: Gemini describes video frames (vision), then Claude writes ad copy (text).

    Step 1: Gemini Flash analyzes key frames and produces a detailed scene description.
    Step 2: Claude (via OAuth / claude -p) writes DR ad copy from the description.
    """
    frame_paths = []
    try:
        # ── Step 1: Gemini describes the frames ──
        frame_paths = _extract_frames(tmp_path, num_frames=10)
        if not frame_paths:
            raise HTTPException(status_code=500, detail="Failed to extract frames from video")

        if genai is None or not settings.GEMINI_API_KEY:
            raise HTTPException(status_code=500, detail="Gemini not available for frame analysis")

        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        # Upload frames to Gemini
        gemini_parts = []
        for i, fp in enumerate(frame_paths):
            with open(fp, "rb") as f:
                img_bytes = f.read()
            gemini_parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": base64.standard_b64encode(img_bytes).decode("utf-8"),
                }
            })
            gemini_parts.append(f"Frame {i + 1} of {len(frame_paths)}")

        describe_prompt = (
            "You are analyzing key frames from a video ad. Describe in detail:\n"
            "1. What product or service is being advertised\n"
            "2. The visual style, colors, and mood\n"
            "3. Any text overlays, claims, or benefits shown\n"
            "4. The target demographic (age, gender, interests)\n"
            "5. The emotional hook or pain point being addressed\n"
            "6. Any before/after, testimonials, or social proof shown\n"
            "Be extremely detailed — this description will be used to write ad copy."
        )
        gemini_parts.append(describe_prompt)

        print(f"[video_analysis:claude] Step 1 — Gemini describing {len(frame_paths)} frames...")
        gemini_response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=gemini_parts,
        )
        frame_description = gemini_response.text.strip()
        print(f"[video_analysis:claude] Gemini description: {frame_description[:300]}...")

        # ── Step 2: Claude writes copy from description ──
        transcript_context = ""
        if transcript_data:
            transcript = transcript_data.get("transcript", "")
            key_claims = transcript_data.get("key_claims", [])
            product_name = transcript_data.get("product_name", "")
            tone = transcript_data.get("tone", "")

            transcript_context = "\n\n--- VIDEO AUDIO TRANSCRIPT ---\n"
            if transcript:
                transcript_context += f"SPOKEN WORDS: {transcript}\n"
            if key_claims:
                transcript_context += f"KEY CLAIMS & BENEFITS: {', '.join(key_claims)}\n"
            if product_name:
                transcript_context += f"PRODUCT/BRAND: {product_name}\n"
            if tone:
                transcript_context += f"SPEAKER TONE: {tone}\n"
            transcript_context += "--- END TRANSCRIPT ---\n"

        copy_prompt = ANALYSIS_PROMPT.replace(
            "Watch/analyze this video carefully",
            "Based on the video analysis below, write high-converting ad copy"
        )
        copy_prompt += f"\n\n--- VIDEO FRAME ANALYSIS ---\n{frame_description}\n--- END ANALYSIS ---\n"
        if transcript_context:
            copy_prompt += transcript_context
        if brand_context:
            copy_prompt += brand_context

        mode_label = "transcribe+claude" if transcript_data else "claude"
        print(f"[video_analysis:{mode_label}] Step 2 — Claude writing copy via OAuth...")

        raw_text = _call_claude_oauth(copy_prompt, timeout=120)
        print(f"[video_analysis:{mode_label}] Raw response: {raw_text[:500]}")
        return _parse_ai_response(raw_text)

    finally:
        if frame_paths:
            tmp_dir = os.path.dirname(frame_paths[0])
            shutil.rmtree(tmp_dir, ignore_errors=True)


@router.post("/analyze")
async def analyze_video(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    provider: str = Query("gemini", pattern="^(gemini|claude|transcribe_haiku|safe)$"),
    brand_id: Optional[str] = Query(None),
    language: str = Query("English"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Analyze a video with AI to generate ad copy suggestions.

    provider: "gemini" (default) — uses Gemini 2.0 Flash with native video+audio
              "claude" — extracts key frames and sends to Claude Sonnet
              "transcribe_haiku" — Gemini transcribes audio, then Sonnet writes copy from frames + transcript
              "safe" — Gemini Flash with policy-compliant, low-risk copy
    brand_id: optional — if provided, injects brand voice + research docs into the prompt
    """
    if file:
        content_type = file.content_type or ""
        if not content_type.startswith("video/"):
            raise HTTPException(status_code=400, detail="File must be a video")

    if not file and not url:
        raise HTTPException(status_code=400, detail="Either file or url is required")

    # Build brand context if brand_id provided
    brand_context_str = ""
    if brand_id:
        brand_context_str = _get_brand_context(brand_id, db)
        if brand_context_str:
            print(f"[video_analysis] Brand context loaded for {brand_id} ({len(brand_context_str)} chars)")

    tmp_path = None
    try:
        if file:
            suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
            content = await file.read()
        else:
            # Download from URL server-side
            print(f"[video_analysis] Downloading video from URL: {url[:100]}...")
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                resp = await client.get(url)
                resp.raise_for_status()
            content = resp.content
            resp_ct = resp.headers.get("content-type", "")
            ext = os.path.splitext(url.split("?")[0])[1] or ".mp4"
            suffix = ext
            print(f"[video_analysis] Downloaded {len(content)} bytes, content-type: {resp_ct}, suffix: {suffix}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            tmp.write(content)

        filename = (file.filename if file else None) or (os.path.basename(url.split("?")[0]) if url else "video.mp4")

        # Append brand context + language instruction to prompts
        brand_suffix = ""
        if brand_context_str:
            brand_suffix = f"\n\n--- BRAND-SPECIFIC CONTEXT (match this brand's voice and reference real product details) ---\n{brand_context_str}"
        brand_suffix = brand_suffix + _language_instruction(language)

        if provider == "safe":
            # Safe/compliant copy using Gemini Flash with toned-down prompt
            result = await _analyze_with_gemini(tmp_path, filename, len(content), prompt_override=SAFE_VIDEO_PROMPT + brand_suffix)
        elif provider == "transcribe_haiku":
            # Step 1: Gemini transcribes the audio
            print("[video_analysis:transcribe_sonnet] Step 1 — Gemini transcribing audio...")
            transcript_data = await _transcribe_with_gemini(tmp_path, filename, len(content))
            print(f"[video_analysis:transcribe_sonnet] Transcript: {transcript_data.get('transcript', '')[:200]}...")
            # Step 2: Sonnet generates copy from frames + transcript
            print("[video_analysis:transcribe_sonnet] Step 2 — Sonnet generating copy with frames + transcript...")
            result = await _analyze_with_claude(tmp_path, filename, transcript_data=transcript_data, brand_context=brand_suffix)
        elif provider == "claude":
            result = await _analyze_with_claude(tmp_path, filename, brand_context=brand_suffix)
        else:
            result = await _analyze_with_gemini(tmp_path, filename, len(content), prompt_override=(ANALYSIS_PROMPT + brand_suffix) if brand_suffix else None)

        bodies = result.get("bodies", [])[:1]
        headlines = result.get("headlines", [])[:1]
        print(f"[video_analysis] Final result — {len(bodies)} bodies, {len(headlines)} headlines")
        return {
            "bodies": bodies,
            "headlines": headlines,
            "video_summary": result.get("video_summary", ""),
            "provider": provider,
        }

    except json.JSONDecodeError as e:
        print(f"[video_analysis] JSON parse error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response as JSON")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Video analysis error")
        raise HTTPException(status_code=500, detail="Video analysis failed")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/analyze-image")
async def analyze_image(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    provider: str = Query("sonnet", pattern="^(sonnet|haiku|gemini|safe|group_voice)$"),
    brand_id: Optional[str] = Query(None),
    language: str = Query("English"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Analyze an image with AI to generate ad copy suggestions.

    provider: "sonnet" (default) — uses Claude Sonnet with vision
              "haiku" — uses Claude Haiku with vision (legacy, still works)
              "gemini" — uses Gemini 2.0 Flash with vision
              "safe" — Gemini Flash with policy-compliant, low-risk copy
    brand_id: optional — if provided, injects brand voice + research docs into the prompt
    """
    if not file and not url:
        raise HTTPException(status_code=400, detail="Either file or url is required")

    # Build brand context if brand_id provided
    brand_suffix = ""
    if brand_id:
        brand_context_str = _get_brand_context(brand_id, db)
        if brand_context_str:
            brand_suffix = f"\n\n--- BRAND-SPECIFIC CONTEXT (match this brand's voice and reference real product details) ---\n{brand_context_str}"
            print(f"[image_analysis] Brand context loaded for {brand_id} ({len(brand_context_str)} chars)")

    try:
        if file:
            content_type = file.content_type or ""
            if not content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="File must be an image")
            image_data = await file.read()
            media_type = content_type
        else:
            # Download from URL server-side (avoids CORS)
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                resp = await client.get(url)
                resp.raise_for_status()
            image_data = resp.content
            media_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]

        image_b64 = base64.b64encode(image_data).decode("utf-8")

        # Map content types
        if media_type == "image/jpg":
            media_type = "image/jpeg"

        lang_suffix = _language_instruction(language)

        if provider in ("gemini", "safe"):
            if not genai:
                raise HTTPException(status_code=500, detail="google-genai not installed")
            api_key = getattr(settings, "GEMINI_API_KEY", None) or os.environ.get("GEMINI_API_KEY")
            if not api_key:
                raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

            prompt = (SAFE_IMAGE_PROMPT if provider == "safe" else IMAGE_ANALYSIS_PROMPT) + brand_suffix + lang_suffix
            client = genai.Client(api_key=api_key)
            image_part = genai.types.Part.from_bytes(data=image_data, mime_type=media_type)
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[image_part, prompt],
            )
            result = _parse_ai_response(response.text)
        elif provider == "group_voice":
            # Group voice uses Claude Sonnet with the group voice prompt.
            # Falls back to `claude -p` OAuth (Max plan) when API key absent.
            claude_api_key = getattr(settings, "ANTHROPIC_API_KEY", None) or os.environ.get("ANTHROPIC_API_KEY")
            full_prompt = GROUP_VOICE_IMAGE_PROMPT + brand_suffix + lang_suffix

            if claude_api_key and anthropic:
                client = anthropic.Anthropic(api_key=claude_api_key)
                response = client.messages.create(
                    model="claude-sonnet-4-5-20250929",
                    max_tokens=4000,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                            {"type": "text", "text": full_prompt},
                        ],
                    }],
                )
                raw_text = response.content[0].text
            elif _claude_cli_available():
                print(f"[image_analysis] group_voice via OAuth (`claude -p`) lang={language}")
                raw_text = _claude_oauth_with_image(full_prompt, image_data, media_type)
            else:
                raise HTTPException(
                    status_code=500,
                    detail="No Claude access: set ANTHROPIC_API_KEY or install `claude` CLI for OAuth",
                )
            result = _parse_ai_response(raw_text)
        else:
            # Claude Sonnet (or Haiku legacy). Falls back to `claude -p` OAuth.
            claude_api_key = getattr(settings, "ANTHROPIC_API_KEY", None) or os.environ.get("ANTHROPIC_API_KEY")
            full_prompt = HAIKU_SYSTEM_PROMPT + "\n\n" + IMAGE_ANALYSIS_PROMPT + brand_suffix + lang_suffix

            if claude_api_key and anthropic:
                client = anthropic.Anthropic(api_key=claude_api_key)
                response = client.messages.create(
                    model="claude-sonnet-4-5-20250929",
                    max_tokens=2000,
                    system=HAIKU_SYSTEM_PROMPT,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                            {"type": "text", "text": IMAGE_ANALYSIS_PROMPT + brand_suffix + lang_suffix},
                        ],
                    }],
                )
                raw_text = response.content[0].text
            elif _claude_cli_available():
                print(f"[image_analysis] {provider} via OAuth (`claude -p`) lang={language}")
                raw_text = _claude_oauth_with_image(full_prompt, image_data, media_type)
            else:
                raise HTTPException(
                    status_code=500,
                    detail="No Claude access: set ANTHROPIC_API_KEY or install `claude` CLI for OAuth",
                )
            result = _parse_ai_response(raw_text)

        return {
            "bodies": result.get("bodies", [])[:1],
            "headlines": result.get("headlines", [])[:1],
            "image_summary": result.get("image_summary", ""),
            "provider": provider,
        }

    except json.JSONDecodeError as e:
        print(f"[image_analysis] JSON parse error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response as JSON")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Image analysis error")
        raise HTTPException(status_code=500, detail="Image analysis failed")
