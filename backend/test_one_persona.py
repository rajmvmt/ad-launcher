import asyncio, os, json

# Read token from credentials
with open(os.path.expanduser('~/.claude/.credentials.json')) as f:
    token = json.load(f)['claudeAiOauth']['accessToken']
os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = token

from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    prompt = """Write 5 Facebook posts as Vanessa, 52yo female from Memphis, TN. Dental hygienist. Lost 98 lbs (241 to 143) over 7 months using slim patches.

Style: aggressive, specific weight numbers, shame moments with dialogue, old clothes references, "link in the comments" ending. 6th grade reading level. No brand names, no URLs, no hashtags, no ellipses.

Return ONLY JSON: {"posts": [{"post_type": "origin_story", "headline": "...", "body_text": "300-500 words", "photo_type": "before_after"}, {"post_type": "update", "headline": "...", "body_text": "60-100 words", "photo_type": "progress"}, {"post_type": "milestone", "headline": "...", "body_text": "50-80 words", "photo_type": "before_after"}, {"post_type": "gratitude", "headline": "...", "body_text": "100-150 words", "photo_type": "lifestyle"}, {"post_type": "for_anyone_struggling", "headline": "...", "body_text": "100-150 words", "photo_type": "before_after"}]}"""

    print("Generating...", flush=True)
    async for msg in query(prompt=prompt, options=ClaudeAgentOptions(allowed_tools=[], max_turns=1)):
        if hasattr(msg, 'result'):
            print('OK:', msg.result[:200])
        elif hasattr(msg, 'error'):
            print('ERROR:', msg.error)

asyncio.run(main())
