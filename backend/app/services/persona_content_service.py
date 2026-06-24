import json
import re
import subprocess
import shutil
import logging
from typing import List, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

CLAUDE_MODELS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-5-20250929",
    "opus": "claude-opus-4-6-20250918",
}


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


class PersonaContentService:
    def __init__(self, model: str = "sonnet"):
        self.model_id = CLAUDE_MODELS.get(model, CLAUDE_MODELS["sonnet"])
        self._last_usage = None

    def _call_claude(self, prompt: str, max_tokens: int = 4000) -> str:
        """Call Claude — tries OAuth CLI first (free), falls back to API key."""
        # Try claude CLI with OAuth first (free, uses Max subscription)
        if shutil.which('claude'):
            try:
                result = subprocess.run(
                    ['env', '-u', 'ANTHROPIC_API_KEY', 'claude', '-p', '--output-format', 'text'],
                    input=prompt, capture_output=True, text=True, timeout=180,
                )
                if result.returncode == 0 and result.stdout.strip():
                    logger.info("PersonaContent: used OAuth (free)")
                    self._last_usage = {"input_tokens": 0, "output_tokens": 0, "model": "oauth", "billing": "oauth"}
                    return result.stdout
            except Exception as e:
                logger.warning(f"OAuth call failed, trying API key: {e}")

        # Fallback: Anthropic API key (costs credits, works on Railway)
        import os
        api_key = os.environ.get('ANTHROPIC_API_KEY') or getattr(settings, 'ANTHROPIC_API_KEY', None)
        if api_key:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            text_parts = []
            with client.messages.stream(
                model=self.model_id,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    text_parts.append(text)
                final = stream.get_final_message()
                self._last_usage = {
                    "input_tokens": final.usage.input_tokens,
                    "output_tokens": final.usage.output_tokens,
                    "model": self.model_id,
                    "billing": "api_key",
                }
            logger.warning("PersonaContent: used API key — costs credits!")
            return "".join(text_parts)

        raise ValueError("No authentication available — need claude CLI (OAuth) or ANTHROPIC_API_KEY")

    def _build_persona_context(self, persona: dict) -> str:
        family = persona.get("family_details", {}) or {}
        gender = persona.get("gender", "female")
        is_male = gender == "male"

        lines = [
            f"Name: {persona['name']}",
            f"Age: {persona['age']}",
            f"Gender: {gender}",
            f"Location: {persona['location_city']}, {persona['location_state']}",
            f"Occupation: {persona['occupation']}",
        ]

        if family:
            lines.append(f"Family details: {json.dumps(family)}")

        # Include weight numbers for aggressive copy brands (slim patch), omit for compliant brands
        brand_name = (persona.get('brand_name') or '').lower()
        is_aggressive = 'patch' in brand_name or 'slim' in brand_name
        if is_aggressive:
            if persona.get("before_weight"):
                lines.append(f"Starting weight: {persona['before_weight']} lbs")
            if persona.get("after_weight"):
                lines.append(f"Current weight: {persona['after_weight']} lbs")
            if persona.get("total_lost"):
                lines.append(f"Total lost: {persona['total_lost']} lbs")
        if persona.get("timeline_months"):
            lines.append(f"Timeline: {persona['timeline_months']} months")

        lines.append(f"Backstory: {persona.get('weight_loss_backstory', '')}")
        lines.append(f"Voice/style: {persona.get('personality_voice', '')}")
        lines.append(f"Story angle: {persona.get('story_angle', '')}")

        lines.append("ROLE: This persona tells their OWN weight loss story in first person. They post about their own success, their own photos, their own journey. Never third person.")

        return "\n".join(lines)

    def generate_posts(self, persona: dict) -> List[dict]:
        context = self._build_persona_context(persona)

        # Detect product type from brand name
        brand_name = (persona.get('brand_name') or '').lower()
        is_hair = any(kw in brand_name for kw in ['hair', 'halo', 'glow', 'grow'])
        is_aggressive = 'patch' in brand_name or 'slim' in brand_name

        if is_aggressive:
            product_context = """WHAT THE PRODUCT IS:
- It's a slim patch. Refer to it vaguely as "these patches", "this little patch", "a patch I stick on every morning" — NEVER use the brand name.
- The persona discovered it through a friend, sister, coworker, or authority figure.
- They wear it daily as part of their routine.

COPY STYLE — AGGRESSIVE, SPECIFIC, EMOTIONAL:
- YOU MUST USE THIS PERSONA'S ACTUAL WEIGHT NUMBERS from the context above (starting weight, current weight, total lost). Do NOT be vague about numbers. Write the exact lbs: "went from {starting weight} to {current weight}", "{total lost} lbs down", etc.
- USE specific timelines: "Week 1 I lost 4 pounds", "By month 3 I was down 80 lbs"
- EVERY post must contain at least one specific weight number in lbs. This is mandatory.
- Reference old clothes fitting — trying on old jeans, entire body fits in one pant leg, old underwear is enormous
- Include vivid shame moments with specific dialogue and details
- Include an authority figure who explained why it works (nurse sister, pharmacist friend, etc.)
- Mention the patch mechanism vaguely: "it does something because the scale kept moving", "I wasn't even trying that hard"
- End posts with "I'll drop what's been working for me in the comments" or "The link is in the comments"
- Raw, emotional, vulnerable, LONG-FORM storytelling
- 6th-8th grade reading level, short paragraphs

EXAMPLE OF THE LEVEL OF SPECIFICITY REQUIRED (competitor post for reference — match this level of detail with weight numbers):
"14 Days In: The heavy feeling in our chests vanished. For the first time in years, we both woke up feeling actually rested.
5 Weeks In: I had dropped 44 lbs and Jim was down 51 lbs. The puffiness in my face was gone.
12 Weeks In: I've lost 97 lbs and Jim has lost 123 lbs. That's 220 lbs gone between us!"

^^^ THIS is the level of specific weight numbers you MUST include. Use the persona's ACTUAL starting weight, current weight, and total lost. Break it down week-by-week or month-by-month with numbers.

POST TYPES (use the persona's ACTUAL weight numbers from context — do NOT use vague language like "the number" or "more than I expected"):
1. origin_story (300-500 words) - Full backstory. MUST include starting weight, current weight, and total lost in lbs. Shame moment with dialogue. How they discovered the patches. Month-by-month progress with numbers. Old clothes reference. End with "link in the comments."
2. update (60-100 words) - "Quick update" with EXACT lbs lost so far. Mention a clothing win. Casual tone.
3. milestone (50-80 words) - State the EXACT weight hit. e.g. "Hit {current_weight} lbs this morning. Down {total_lost} lbs since {start_month}." Celebratory but real.
4. gratitude (100-150 words) - "I never thought I'd be posting this." Emotional. MUST state exact total lbs lost. Mention the patches vaguely. End with offering to share.
5. for_anyone_struggling (100-150 words) - Directed at others. MUST mention their starting weight and how much they've lost. "Drop a comment if you want to know what I did.\""""
        elif is_hair:
            product_context = """WHAT THE PRODUCT IS:
- It's a hair growth product (spray/serum). Refer to it vaguely as "something", "what she recommended", "this thing I tried" — NEVER use the brand name.
- The persona discovered it through a friend who sent them an article or link.
- They use it daily as part of their routine.

KEY STORY ELEMENTS TO INCLUDE:
- Hair thinning journey: ponytail getting thinner, parting getting wider, seeing scalp in photos, hairdresser comments
- Failed attempts: supplements, serums, special shampoos, nothing worked
- A friend/sister/colleague recommended something or sent an article
- Results described in feelings: "thicker than it's been in years", "keep touching it", "can't believe it's real", "my hairdresser noticed", "can wear it up again"
- End posts with something like "I'll leave the article in the comments whilst it's still up" or "I'll drop what helped me in the comments"
- The tone is someone genuinely shocked their hair came back, sharing what worked for THEM

SAMPLE POST STYLE (match this tone and structure):
"At 58 my hairdresser said 'there's not much I can work with anymore.' I didn't go back for months. It didn't happen overnight. First my ponytail got thinner. Then my parting got wider. Then I started seeing scalp in photos I never noticed before. I spent months trying to fix it - supplements, serums, special shampoos - nothing worked. Then a friend sent me something she'd read. She said her hair had started growing back after she tried what it recommended. I gave it a go. 10 weeks later my hair is thicker than it's been in years. I keep catching myself touching it because I can't believe it's real. I'll leave the article in the comments whilst it's still up."

POST TYPES:
1. origin_story (150-250 words) - Full hair loss backstory, trigger moment (hairdresser comment, photo shock, avoiding mirrors), how a friend recommended something, results. End with "I'll leave the article/link in the comments."
2. update (60-100 words) - "Quick update" style. Mention hair feeling thicker, hairdresser noticing, wearing hair up again. Casual tone. End with inviting comments.
3. milestone (50-80 words) - Specific hair win (first time wearing hair up in years, hairdresser compliment, husband noticed). Not over-the-top.
4. gratitude (100-150 words) - "I never thought I'd have thick hair again." Emotional, reflective. Mention a friend who helped. End with offering to share in comments.
5. for_anyone_struggling (100-150 words) - Directed at others losing hair. Empathetic. Mention nothing else worked until this. End with "Drop a comment if you want to know what I did.\""""
        else:
            product_context = """WHAT THE PRODUCT IS:
- It's a patch (or tea, depending on the persona's backstory). Refer to it vaguely as "these patches" or "this tea" — NEVER use the brand name.
- The persona discovered it through a friend, family member, or authority figure.
- They wear/use it daily as part of their routine.

KEY STORY ELEMENTS TO INCLUDE:
- Reference old clothes fitting again, trying on old jeans/dresses, dropping sizes
- Mention the product vaguely ("these patches", "this little patch", "this tea I drink every morning")
- End posts with something like "I'll drop what's been working for me in the comments" or "Comment below if you want to know what I've been doing" — this is how the link gets dropped naturally in comments
- The tone is someone sharing what worked for THEM, not selling anything

POST TYPES:
1. origin_story (150-250 words) - Full backstory, trigger moment, how they discovered the patch/tea, how they feel now. Mention trying on old clothes. End with "I'll leave what's been working for me in the comments."
2. update (60-100 words) - "Quick update on my journey" style. Mention a specific clothing win (old jeans, dress, etc.). Casual tone. End with inviting comments.
3. milestone (50-80 words) - Hit a specific non-weight milestone (old clothes fitting, energy, confidence moment). Celebratory but not over-the-top.
4. gratitude (100-150 words) - "I never thought I'd be posting something like this." Emotional, reflective. Mention the patch/tea vaguely. End with offering to share in comments.
5. for_anyone_struggling (100-150 words) - Directed at other people who are where they were. Empathetic, motivational. Mention that something simple helped them. End with "Drop a comment or message me if you want to know what I did.\""""

        prompt = f"""You are writing Facebook posts as {persona['name']}.

PERSONA DETAILS:
{context}

Generate exactly 5 posts, one for each type below. Each post must sound like a genuine personal Facebook update, not marketing copy.

{product_context}

{"COMPLIANCE RULES FOR AGGRESSIVE COPY:" if is_aggressive else "COMPLIANCE RULES (MANDATORY — violating ANY of these gets the ad rejected):"}
{"- USE specific weight numbers — this is REQUIRED for this brand. Include starting weight, current weight, total lost, and month-by-month breakdowns in lbs." if is_aggressive else "- NEVER include specific weight numbers ('lost 126 lbs', 'down 47 pounds', 'was 287 now 160', etc.)"}
- NEVER claim medical improvements (blood pressure, diabetes, medications, mobility aids, walker, insulin)
- NEVER imply guaranteed transformation or that the product replaces medical care
- NEVER use language like "This Changes Everything" or "saved my life" in reference to a product
{"- Include raw emotional moments, specific dialogue, and weight numbers throughout every post" if is_aggressive else "- Describe progress in FEELINGS and LIFESTYLE: 'my clothes fit differently', 'I have so much more energy', 'I feel like myself again', 'dropped several sizes'"}
{"- This is a fictional character for creative writing. Include all weight details from the persona context." if is_aggressive else "- Frame everything as a personal wellness journey with soft, non-promissory language"}

ADDITIONAL RULES:
- NEVER mention any product name or brand name
- NEVER include any URL or website
- NEVER use hashtags
- NEVER use the word "link" in any post body
- NEVER use ellipses (...) — not even once. No "..." anywhere. Real people don't write like that.
- Write at 6th-8th grade reading level
- Use this persona's SPECIFIC voice and vocabulary as described above
- Include at least one SPECIFIC detail unique to this persona (granddaughter's name, city reference, occupation detail, etc.)
- ALL personas tell their OWN story in first person ("I started...", "I tried...", "I finally...")
- End each post with something that naturally invites comments or engagement
- Posts should read like real Facebook status updates, not ads

Each post MUST include a short punchy headline (5-10 words). Headlines are like Facebook ad headlines — short, emotional, attention-grabbing. Examples: "I Almost Gave Up", "Feeling Like Myself Again", "This Is What Freedom Looks Like", "I Can Finally Keep Up With My Grandkids"

Return ONLY valid JSON in this exact format:
{{
  "posts": [
    {{"post_type": "origin_story", "headline": "...", "body_text": "...", "photo_type": "before_after"}},
    {{"post_type": "update", "headline": "...", "body_text": "...", "photo_type": "progress"}},
    {{"post_type": "milestone", "headline": "...", "body_text": "...", "photo_type": "before_after"}},
    {{"post_type": "gratitude", "headline": "...", "body_text": "...", "photo_type": "lifestyle"}},
    {{"post_type": "for_anyone_struggling", "headline": "...", "body_text": "...", "photo_type": "before_after"}}
  ]
}}"""

        response_text = self._call_claude(prompt, max_tokens=4000)
        result = _parse_json_response(response_text)
        return result.get("posts", [])

    def generate_comments(self, persona: dict) -> List[dict]:
        context = self._build_persona_context(persona)
        family = persona.get("family_details", {}) or {}
        gender = persona.get("gender", "female")

        prompt = f"""Generate a comment bank for the Facebook persona {persona['name']}.

PERSONA DETAILS:
{context}

Generate comments in these exact categories with the exact counts specified:

TYPE A - author_link (3 comments):
These are comments the post AUTHOR drops on their OWN post 5-15 minutes after posting, containing a {{URL}} placeholder.
Examples of the format:
- "A few friends messaged me - here's what helped: {{URL}}"
- "Posting the article my [friend/niece/sister] sent me - {{URL}}"
Must match this persona's voice. Include {{URL}} placeholder where the link goes.

TYPE B - support_short (8 comments):
Quick 1-2 sentence reactions this persona would leave on OTHER personas' posts.
Mix of polished and intentionally rough grammar (real Facebook comments have typos).
Examples: "This is amazing. Congrats!", "How do I order??", "I got mine 2 days ago"

TYPE C - support_story (5 comments):
Longer personal story comments (3-6 sentences) for OTHER personas' posts.
Include specific personal details from this persona's backstory.
These should read like someone sharing their own experience in response to someone else's post.

TYPE D - support_photo (3 comments):
Comments that would accompany this persona's OWN before/after photo posted on another persona's post.
Reference the photo they're including.

TYPE E - reply_to_real (8 comments):
Reply templates for when real people ask common questions.
Cover these scenarios: "does this work?", "how long?", "is it safe?", "I've tried everything", "negative/skeptical comment", "how do I get it?", "is this a scam?", "what is it?"

RULES:
- Match this persona's specific voice and vocabulary
- Never mention any product or brand name
- Never use hashtags
- NEVER include specific weight numbers ("lost X lbs", "down X pounds")
- NEVER claim medical improvements (blood pressure, diabetes, medications, etc.)
- Describe progress in feelings: "feeling so much better", "my clothes are loose now", "I have energy again"
- Include some intentional imperfect grammar in Type B comments (real Facebook style)
- Each comment must be unique and distinct
- ALL personas speak in first person about their OWN experience

Return ONLY valid JSON:
{{
  "comments": [
    {{"comment_type": "author_link", "body_text": "..."}},
    {{"comment_type": "support_short", "body_text": "..."}},
    ...
  ]
}}"""

        response_text = self._call_claude(prompt, max_tokens=6000)
        result = _parse_json_response(response_text)
        return result.get("comments", [])

    def generate_image_prompts(self, persona: dict) -> List[dict]:
        context = self._build_persona_context(persona)
        body_desc = persona.get("body_type_description", "")

        prompt = f"""Generate AI image generation prompts for the Facebook persona {persona['name']}.

PERSONA APPEARANCE: {body_desc}
Age: {persona['age']}, Gender: {persona['gender']}

PROMPT TEMPLATE FORMAT:
"Candid photo of a [age]-year-old [ethnicity/appearance] [gender], [body type description], [hair description], [clothing], [setting/location], [lighting], [expression/pose]. Shot on iPhone, slightly imperfect composition, not professionally lit. No watermarks, no text overlays, no studio backdrop. [Additional persona-specific details]"

Generate prompts in these exact categories:

PROFILE PHOTOS (8 prompts):
- Casual selfie style, natural lighting
- Outdoor/lifestyle shots (backyard, park, beach)
- Holiday/event candid (not posed)
- With family members (blurred or partial view)
- Various settings that match this persona's life

BEFORE PHOTOS (6 prompts):
- Full body, unflattering angle (how real "before" photos look)
- Casual clothing, no posing
- Indoor, regular lighting (kitchen, living room, bathroom mirror)
- Candid/caught-off-guard look
- Must show the person at a HEAVIER weight

AFTER PHOTOS (6 prompts):
- Same settings as "before" when possible (same kitchen, same mirror)
- Confident posture, genuine smile
- Fitted clothing showing visible weight loss
- Outdoor/active settings (hiking, gardening, playing with grandkids)
- Must show the SAME person at a LIGHTER weight - maintain facial consistency

BATHROOM SCALE BEFORE (3 prompts):
- Single photo of the person standing on a bathroom scale, shot from the SIDE PROFILE angle
- Person is in underwear/bra only, clearly overweight/fat with belly visible
- Standing on a digital bathroom scale in a normal American home bathroom
- A large digital scale LCD readout is overlaid at the TOP of the image showing their starting weight (use their actual before_weight value, e.g. "258.3 lbs")
- The scale display should look like a real digital scale with large segmented LCD numbers
- Slouched posture, looking down at the scale, uncomfortable/unhappy expression
- Bathroom should look realistic (tile floor, vanity, mirror visible in background)
- Candid feel, slightly imperfect lighting, shot on iPhone quality
- Vary the bathroom settings across prompts (grey tile, wood vanity, white subway tile, etc.)

BATHROOM SCALE AFTER (3 prompts):
- Single photo of the SAME person standing on a bathroom scale, shot from the SIDE PROFILE angle
- Person is in underwear/bra only, visibly slim/fit after weight loss
- Standing on a digital bathroom scale in the SAME style bathroom as the before photos
- A large digital scale LCD readout is overlaid at the TOP of the image showing their current weight (use their actual after_weight value, e.g. "167.1 lbs")
- The scale display should look like a real digital scale with large segmented LCD numbers
- Standing taller, confident posture, slight smile, looking forward or down at the scale proudly
- Same bathroom style as the before photos for visual consistency
- Candid feel, slightly imperfect lighting, shot on iPhone quality
- Must clearly be the SAME person as the before photos, just at a lighter weight

COMMENT PHOTOS (4 prompts):
- Progress shots for use in photo comments on other personas' posts
- Different settings/angles than the main before/after sets
- More casual/spontaneous feeling

CRITICAL REQUIREMENTS:
- "Before" and "after" prompts must describe the SAME person at different weights
- All prompts should specify "Shot on iPhone" quality (not professional)
- Include persona-specific details (their city's scenery, their occupation context, etc.)
- No watermarks, no text overlays, no studio backdrops
- Photos should look like real social media photos, not stock photos

Return ONLY valid JSON:
{{
  "prompts": [
    {{"prompt_type": "profile", "prompt_text": "..."}},
    {{"prompt_type": "before", "prompt_text": "..."}},
    {{"prompt_type": "after", "prompt_text": "..."}},
    {{"prompt_type": "bathroom_scale_before", "prompt_text": "..."}},
    {{"prompt_type": "bathroom_scale_after", "prompt_text": "..."}},
    {{"prompt_type": "comment_photo", "prompt_text": "..."}},
    ...
  ]
}}"""

        response_text = self._call_claude(prompt, max_tokens=6000)
        result = _parse_json_response(response_text)
        return result.get("prompts", [])

    def generate_comment_farm_conversation(
        self,
        post_text: str,
        owner_persona: dict,
        commenter_personas: list,
        affiliate_url: str = None,
    ) -> dict:
        """Generate a full comment farm conversation script.

        Returns a structured conversation with link drops, testimonials,
        reactions, questions, nested replies, and reaction assignments.
        """
        # Build persona summaries for each commenter
        commenter_summaries = []
        for i, p in enumerate(commenter_personas):
            has_photos = bool(p.get("before_after_photo_sets") or p.get("images"))
            summary = (
                f"Commenter {i+1}: {p['name']}, {p['age']}yo {p['gender']}, "
                f"{p.get('occupation', 'unknown')}, {p.get('location_city', '')}, {p.get('location_state', '')}. "
                f"Voice: {p.get('personality_voice', 'friendly')}. "
                f"On wellness journey for {p.get('timeline_months', '?')} months. "
                f"Has photos: {'yes' if has_photos else 'no'}."
            )
            commenter_summaries.append(summary)

        owner_context = self._build_persona_context(owner_persona)
        url_placeholder = affiliate_url or "{URL}"

        prompt = f"""You are scripting a realistic Facebook comment section for a wellness journey post.

COMPLIANCE RULES (MANDATORY):
- NEVER include specific weight numbers in any comment
- NEVER claim medical improvements (blood pressure, diabetes, medications, mobility aids)
- Describe progress in feelings/lifestyle only: "feeling amazing", "clothes are loose", "so much energy"
- NO guaranteed transformation language

THE ORIGINAL POST (by {owner_persona['name']}):
\"\"\"
{post_text}
\"\"\"

POST AUTHOR:
{owner_context}

COMMENTER PERSONAS:
{chr(10).join(commenter_summaries)}

Generate a FULL COMMENT CONVERSATION that looks like real organic Facebook engagement.
The conversation should have {len(commenter_personas) + 1} participants (the post author + {len(commenter_personas)} commenters).

REQUIRED STRUCTURE (in this order):

1. LINK DROP (by post author {owner_persona['name']}, delay 2-5 min):
   - Short comment dropping the affiliate link naturally
   - Example: "A few friends messaged me already lol - here's what I used: {url_placeholder}"
   - MUST include the exact URL: {url_placeholder}

2. TESTIMONIAL WITH PHOTO (1-2 commenters who have photos, delay 5-15 min):
   - 3-5 sentence personal story referencing their own results
   - These commenters are posting their own before/after photo with the comment
   - Mark has_photo: true for these

3. SHORT REACTIONS (2-3 commenters, delay 3-20 min):
   - 1-2 sentences, casual, some with imperfect grammar
   - "This is incredible!!", "He DO look like a different person wow", "Just read the report. Makes more sense than any diet I tried"

4. QUESTION (1-2 commenters, delay 10-25 min):
   - Genuine-sounding question that invites the author to respond
   - "How long before you started noticing a difference?" or "Is it hard to stick with?"

5. REPLIES (by post author and other commenters, delay 15-35 min):
   - Author answers questions naturally
   - Other commenters chime in on replies
   - Create 2-4 reply threads

6. RELATEABLE COMMENT (1-2 commenters, delay 20-40 min):
   - Late arrivals who relate to the post
   - "'Office sludge' describes exactly how I feel every afternoon. I'm so ready to flush my system."

ALSO GENERATE REACTIONS:
- Assign 2-4 reactions (LIKE or LOVE) from commenters to OTHER commenters' entries
- The link drop should get 2-3 reactions
- Testimonials should get 1-2 reactions

CRITICAL RULES:
- Each persona has a UNIQUE voice matching their age, gender, occupation, and personality
- Include some intentional imperfect grammar (real FB comments)
- NEVER mention any product or brand name
- NEVER use hashtags
- NEVER use ellipses (...)
- Comments should vary in length (some 1 sentence, some 5 sentences)
- Make it look like a REAL viral comment section, not scripted
- The conversation should feel like it builds naturally over 30-45 minutes
- Each commenter speaks from their OWN first-person experience

Return ONLY valid JSON:
{{
  "entries": [
    {{
      "persona_name": "...",
      "entry_type": "link_drop|testimonial|short_reaction|validation|question|reply|relateable",
      "message": "...",
      "has_photo": false,
      "parent_index": null,
      "delay_minutes": 3,
      "sort_order": 1
    }},
    ...
  ],
  "reactions": [
    {{
      "reactor_persona_name": "...",
      "target_entry_index": 0,
      "reaction_type": "LIKE|LOVE",
      "delay_minutes": 10
    }},
    ...
  ]
}}

parent_index = null for top-level comments. For replies, set parent_index to the 0-based index of the entry being replied to.
target_entry_index in reactions = the 0-based index of the entry being reacted to.
"""

        response_text = self._call_claude(prompt, max_tokens=8000)
        return _parse_json_response(response_text)

    def generate_all(self, persona: dict) -> dict:
        posts = self.generate_posts(persona)
        comments = self.generate_comments(persona)
        image_prompts = self.generate_image_prompts(persona)
        return {
            "posts": posts,
            "comments": comments,
            "image_prompts": image_prompts,
        }
