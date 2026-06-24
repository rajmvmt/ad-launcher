import asyncio, os, json

# Read token directly from Claude Code credentials
with open(os.path.expanduser('~/.claude/.credentials.json')) as f:
    token = json.load(f)['claudeAiOauth']['accessToken']
print(f"Token: {token[:20]}...{token[-10:]}")
os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = token

from claude_agent_sdk import query, ClaudeAgentOptions
async def main():
    async for msg in query(prompt='Say hi', options=ClaudeAgentOptions(allowed_tools=[], max_turns=1)):
        if hasattr(msg, 'result'): print('OK:', msg.result[:50])
        elif hasattr(msg, 'error'): print('ERROR:', msg.error)
        else: print('MSG:', type(msg).__name__)
asyncio.run(main())
