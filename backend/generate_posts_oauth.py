#!/usr/bin/env python3
"""
Generate persona posts using Claude Code CLI with OAuth (Max subscription).
Run in a REGULAR terminal, NOT inside Claude Code.

Uses `claude -p` to send prompts through Claude Code CLI directly,
bypassing the Agent SDK subprocess issues.
"""
import os
import sys
import json
import re
import subprocess
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import Persona, PersonaPost, Brand


def parse_json(text):
    text = text.strip()
    m = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    start = text.find('{')
    end = text.rfind('}') + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    return None


def generate_for_persona(pd):
    prompt = f"""Write 5 Facebook posts as {pd['name']}, {pd['age']}yo {pd['gender']} from {pd['location_city']}, {pd['location_state']}. {pd['occupation']}. Lost {pd.get('total_lost', 100)} lbs ({pd.get('before_weight', 250)} to {pd.get('after_weight', 130)}) over {pd.get('timeline_months', 6)} months using slim patches.

Style: aggressive, specific weight numbers, shame moments with dialogue, old clothes references, "link in the comments" ending. 6th grade reading level. No brand names, no URLs, no hashtags, no ellipses.

Return ONLY JSON: {{"posts": [{{"post_type": "origin_story", "headline": "5-10 word headline", "body_text": "300-500 words", "photo_type": "before_after"}}, {{"post_type": "update", "headline": "...", "body_text": "60-100 words", "photo_type": "progress"}}, {{"post_type": "milestone", "headline": "...", "body_text": "50-80 words", "photo_type": "before_after"}}, {{"post_type": "gratitude", "headline": "...", "body_text": "100-150 words", "photo_type": "lifestyle"}}, {{"post_type": "for_anyone_struggling", "headline": "...", "body_text": "100-150 words", "photo_type": "before_after"}}]}}"""

    # Use env -u to unset ANTHROPIC_API_KEY so claude uses OAuth
    result = subprocess.run(
        ['env', '-u', 'ANTHROPIC_API_KEY', 'claude', '-p', '--output-format', 'text'],
        input=prompt,
        capture_output=True, text=True, timeout=120,
    )

    print(f"    RETURNCODE: {result.returncode}", flush=True)
    print(f"    STDOUT: {result.stdout[:500]}", flush=True)
    if result.stderr:
        print(f"    STDERR: {result.stderr[:200]}", flush=True)

    if result.returncode != 0:
        return None

    return parse_json(result.stdout)


def main():
    brand_filter = sys.argv[1] if len(sys.argv) > 1 else '%slim patch%'

    db = SessionLocal()
    brand = db.query(Brand).filter(Brand.name.ilike(brand_filter)).first()
    if not brand:
        print(f"Brand not found: {brand_filter}")
        sys.exit(1)

    personas = db.query(Persona).filter(Persona.brand_id == brand.id).all()

    persona_list = []
    for p in personas:
        post_count = db.query(PersonaPost).filter(PersonaPost.persona_id == p.id).count()
        if post_count == 0:
            persona_list.append({
                "id": p.id, "name": p.name, "age": p.age, "gender": p.gender,
                "location_city": p.location_city, "location_state": p.location_state,
                "occupation": p.occupation,
                "before_weight": p.before_weight, "after_weight": p.after_weight,
                "total_lost": p.total_lost, "timeline_months": p.timeline_months,
            })
    db.close()

    print(f"Brand: {brand.name}")
    print(f"Personas needing posts: {len(persona_list)}")

    if not persona_list:
        print("All personas already have posts!")
        return

    success = 0
    failed = 0
    for i, pd in enumerate(persona_list):
        try:
            result = generate_for_persona(pd)
            if result and 'posts' in result:
                db = SessionLocal()
                for post_data in result['posts']:
                    db.add(PersonaPost(
                        persona_id=pd["id"],
                        post_type=post_data.get("post_type", "origin_story"),
                        headline=post_data.get("headline", ""),
                        body_text=post_data.get("body_text", ""),
                        photo_type=post_data.get("photo_type"),
                    ))
                db.commit()
                db.close()
                success += 1
                print(f"  [{i + 1}/{len(persona_list)}] {pd['name']} - {len(result['posts'])} posts")
            else:
                failed += 1
                print(f"  [{i + 1}/{len(persona_list)}] {pd['name']} - FAILED: no valid JSON")
        except Exception as e:
            failed += 1
            print(f"  [{i + 1}/{len(persona_list)}] {pd['name']} - FAILED: {e}")

        time.sleep(15)

    print(f"\nDone: {success} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
