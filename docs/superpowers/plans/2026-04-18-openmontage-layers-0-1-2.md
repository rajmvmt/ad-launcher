# OpenMontage Layers 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install OpenMontage as a fork, add a `facebook-ad` pipeline with offer-brief context, and expose it as a `/openmontage` Claude Code skill — producing multi-scene FB ads end-to-end from the terminal.

**Architecture:** Fork `calesthio/OpenMontage` verbatim. Add four files (one pipeline YAML, six stage director markdown files, two Python tools). Move offer briefs to a dedicated git repo with a symlink-back so `/videoad` keeps working. The `/openmontage` skill is a thin bootstrap that ensures the fork + offers are ready and hands orchestration to the current Claude Code session — OpenMontage expects the LLM to be the orchestrator.

**Tech Stack:** Python 3.10+, Node 18+, FFmpeg, Piper TTS, Remotion (React-based composer), boto3 (R2), Fal/Gemini/ElevenLabs APIs, Anthropic OAuth (via `claude -p`) or API key.

**Working roots for this plan:**
- OpenMontage fork: `/home/roly/openmontage/` (new clone)
- Offer briefs repo: `/home/roly/offer-briefs/` (new clone)
- Claude Code skill: `/home/roly/.claude/skills/openmontage/`
- Spec reference: `/home/roly/iscale-facebook-ad-builder/docs/superpowers/specs/2026-04-18-openmontage-integration-design.md`

**Assumptions:**
- User's GitHub handle will be collected in Task 1.
- Existing `.env` keys (`FAL_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) are in `~/.claude/.env` from `/videoad` setup. New keys collected during Task 3.
- Existing offer files at `~/.claude/offers/*.md` follow the YAML-frontmatter + markdown-sections format documented in the spec.

---

## Phase A — Fork and stand up OpenMontage (Layer 0)

Goal of Phase A: One fully successful run of a built-in OpenMontage pipeline (e.g. `explainer`) end-to-end on your machine. Validates the engine works before we add anything.

### Task A1: Fork OpenMontage on GitHub and clone locally

**Files:**
- Create: `/home/roly/openmontage/` (git clone of fork)

- [ ] **Step 1: Fork on GitHub**

Open https://github.com/calesthio/OpenMontage in a browser and click "Fork". Use your personal GitHub account. Fork name stays `OpenMontage`.

- [ ] **Step 2: Capture GitHub username**

Save your GitHub username for use in later tasks. Run:

```bash
gh api user --jq .login 2>/dev/null || echo "NOT LOGGED IN — run: gh auth login"
```

Expected: prints your username. If not logged in, run `gh auth login` first.

Record the value — we'll call it `$GH_USER` in subsequent steps. You can export it in your shell:

```bash
export GH_USER=<your-github-username>
```

- [ ] **Step 3: Clone the fork**

```bash
cd /home/roly
git clone https://github.com/$GH_USER/OpenMontage.git openmontage
cd openmontage
git remote add upstream https://github.com/calesthio/OpenMontage.git
git remote -v
```

Expected: `origin` points to your fork, `upstream` points to calesthio's.

- [ ] **Step 4: Commit the upstream remote config**

Nothing to commit — remotes are local git config. Proceed.

- [ ] **Step 5: Record the commit we forked from**

```bash
cd /home/roly/openmontage
git log -1 --format='%H %s' > /tmp/openmontage-base-commit.txt
cat /tmp/openmontage-base-commit.txt
```

Expected: one line with commit hash + message. We'll reference this when rebasing on upstream updates later.

---

### Task A2: Inventory OpenMontage's actual conventions

Before we add anything, we must see how upstream structures its tools, pipelines, and skills. This produces reference snippets later tasks will match.

**Files:**
- Read: `/home/roly/openmontage/README.md`
- Read: `/home/roly/openmontage/AGENT_GUIDE.md`
- Read: `/home/roly/openmontage/tools/tool_registry.py` (and any `BaseTool` definition)
- Read: at least one file in `/home/roly/openmontage/pipeline_defs/` (pick `explainer.yaml` if present)
- Read: at least one directory in `/home/roly/openmontage/skills/pipelines/` (pick same pipeline as above)

- [ ] **Step 1: Read README + AGENT_GUIDE**

```bash
cd /home/roly/openmontage
head -100 README.md
echo '---'
head -100 AGENT_GUIDE.md 2>/dev/null || echo "no AGENT_GUIDE.md"
```

Expected: README describes the agent-driven flow; AGENT_GUIDE (if present) documents the orchestrator contract.

- [ ] **Step 2: List pipelines and tools**

```bash
ls pipeline_defs/
ls tools/
ls skills/pipelines/
```

Expected: `pipeline_defs/` contains 11 YAML files, `tools/` contains ~52 Python files, `skills/pipelines/` contains one directory per pipeline.

- [ ] **Step 3: Read one pipeline YAML end to end**

```bash
cat pipeline_defs/explainer.yaml
```

Note the schema: field names (stages, tools, review_criteria, success_gates, etc.), nesting, value types. Save a mental template.

- [ ] **Step 4: Read one pipeline's stage director skills**

```bash
ls skills/pipelines/explainer/
cat skills/pipelines/explainer/*.md
```

Note: headings used, how tools are referenced, how offer/brief context is passed in, what "state" conventions look like.

- [ ] **Step 5: Read the tool registry and BaseTool**

```bash
cat tools/tool_registry.py
# If BaseTool is in a separate file, find it:
grep -rn "class BaseTool" tools/ lib/ 2>/dev/null | head -5
```

Find the `BaseTool` definition. Note: required methods, class attributes (e.g. `name`, `description`, `category`), how tools register themselves.

- [ ] **Step 6: Record findings in a local scratch file**

```bash
mkdir -p /home/roly/openmontage/.scratch
cat > /home/roly/openmontage/.scratch/conventions.md <<'EOF'
# OpenMontage Conventions (observed 2026-04-18)

## Pipeline YAML schema
(fill in from step 3 — exact top-level keys, e.g. `name`, `description`,
`stages[]`, `review_criteria`, `success_gates`)

## Stage director skill conventions
(fill in from step 4 — filename pattern, heading structure, tool
reference syntax)

## BaseTool contract
(fill in from step 5 — required methods, attributes, registration
mechanism)

## Tool registry import
(fill in — e.g. `from tools.tool_registry import registry`)
EOF
```

Fill in the four sections based on what you read. This file is referenced by every task in Phase B.

- [ ] **Step 7: Commit the scratch notes so Phase B has a reference**

Actually — we don't want to commit `.scratch/` in the fork. Add it to gitignore instead:

```bash
echo '.scratch/' >> .gitignore
git add .gitignore
git commit -m "chore: ignore local scratch notes"
```

---

### Task A3: Install system deps and Python venv

**Files:**
- Create: `/home/roly/openmontage/.env` (from `.env.example`)
- Create: `/home/roly/openmontage/.venv/` (Python venv)

- [ ] **Step 1: Check system deps**

```bash
command -v ffmpeg && ffmpeg -version | head -1
command -v node && node --version
command -v npm && npm --version
python3 --version
```

Expected:
- ffmpeg present
- Node.js ≥ 18
- Python ≥ 3.10

If any missing: `sudo apt install ffmpeg`; install Node via nvm (`nvm install 20`); Python 3.10+ is typically already present.

- [ ] **Step 2: Check for Piper TTS**

```bash
command -v piper && piper --help 2>&1 | head -3 || echo "piper not installed"
```

If missing, install via pip later (handled by `make setup`).

- [ ] **Step 3: Create Python venv**

```bash
cd /home/roly/openmontage
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
```

Expected: `.venv/` created, `pip` upgraded.

- [ ] **Step 4: Run `make setup`**

```bash
cd /home/roly/openmontage
source .venv/bin/activate
make setup
```

Expected: installs Python deps from `requirements.txt`, runs `npm install` in `remotion-composer/`, installs `piper-tts`, copies `.env.example` → `.env`.

If `make setup` fails, inspect the Makefile and run commands manually:

```bash
pip install -r requirements.txt
cd remotion-composer && npm install && cd ..
pip install piper-tts
cp -n .env.example .env
```

- [ ] **Step 5: Verify venv installed tools**

```bash
python -c "from tools.tool_registry import registry; print(len(registry.list_tools()))"
```

Expected: prints an integer (number of registered tools — should be ~52).

If the import path differs (e.g. `tools.registry`), update our `.scratch/conventions.md` to reflect the real path.

- [ ] **Step 6: Commit — no code changes, just setup**

Nothing to commit for A3 unless `.gitignore` was modified. Skip commit step.

---

### Task A4: Configure API keys

**Files:**
- Modify: `/home/roly/openmontage/.env`

- [ ] **Step 1: Read `.env.example` to see all required keys**

```bash
cat /home/roly/openmontage/.env.example
```

Note every `*_KEY` or `*_API_KEY` line. Required at minimum for our path: `FAL_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` (for premium VO; Piper is free fallback).

- [ ] **Step 2: Pull existing keys from `~/.claude/.env`**

```bash
grep -E '^(FAL_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|ELEVENLABS_API_KEY)=' ~/.claude/.env 2>/dev/null
```

Expected: lists any keys you already have. Copy the ones that are set.

- [ ] **Step 3: Write keys into fork's `.env`**

Open `/home/roly/openmontage/.env` in your editor and paste the values from step 2. For keys you don't yet have:

- `FAL_KEY`: https://fal.ai/dashboard/keys
- `GEMINI_API_KEY`: https://aistudio.google.com/app/apikey
- `ANTHROPIC_API_KEY`: https://console.anthropic.com (or leave blank if you'll use `claude -p` OAuth via current Claude Code session)
- `ELEVENLABS_API_KEY`: https://elevenlabs.io/app/settings/api-keys (optional — Piper works free)
- `SUNO_*` / music keys: optional for v1; OpenMontage supports free audio library

- [ ] **Step 4: Verify `.env` is not tracked**

```bash
cd /home/roly/openmontage
grep -n '^.env$' .gitignore || echo ".env NOT ignored — adding"
```

If `.env` is not in `.gitignore`, add it:

```bash
echo '.env' >> .gitignore
git add .gitignore
git commit -m "chore: ignore .env"
```

- [ ] **Step 5: Test one API key works**

```bash
cd /home/roly/openmontage
source .venv/bin/activate
python -c "
import os
from dotenv import load_dotenv
load_dotenv()
import fal_client
fal_client.api_key = os.getenv('FAL_KEY')
print('FAL_KEY loaded:', bool(fal_client.api_key))
"
```

Expected: `FAL_KEY loaded: True`. If False, the key isn't being read — fix `.env` formatting.

---

### Task A5: First run — execute a built-in pipeline end to end

**Files:** None created; this task runs the engine.

- [ ] **Step 1: Open a fresh Claude Code session inside the fork**

In a new terminal:

```bash
cd /home/roly/openmontage
claude
```

This starts a Claude Code session scoped to the fork directory.

- [ ] **Step 2: Give the agent an end-to-end prompt**

In the Claude Code session, paste:

```
You are operating inside a clone of the OpenMontage repo at /home/roly/openmontage.

Read AGENT_GUIDE.md, then read pipeline_defs/explainer.yaml and all stage
director skills under skills/pipelines/explainer/. Use the registered tools
from tools/tool_registry.py.

Goal: Produce a 30-second explainer video about "why 7% of detox tea drinkers
experience faster mornings." Aspect 9:16 (vertical). Use free/cheap providers
(Piper for VO, free music library, any Fal model under $1 per clip). Cost cap: $2.

Run through every stage, respect all quality gates, and produce a final .mp4
at ./output/test-run-01/final.mp4. Log decisions as you go.
```

- [ ] **Step 3: Watch the agent orchestrate**

The agent should:
- Read the pipeline manifest and stage director skills
- Call tools for concept → script → asset gen → compose → post-review
- Hit OpenMontage's quality gates (pre-compose validation, slideshow risk, post-render)
- Produce a real .mp4

Expected runtime: 5–20 minutes depending on provider speed and whether any gate fails and retries.

- [ ] **Step 4: Inspect the output**

```bash
ls /home/roly/openmontage/output/test-run-01/
ffprobe /home/roly/openmontage/output/test-run-01/final.mp4 2>&1 | grep -E 'Duration|Stream'
```

Expected: duration ~30s, at least one video stream and one audio stream.

- [ ] **Step 5: Play the video to check it's not a slideshow**

```bash
# From a desktop env:
xdg-open /home/roly/openmontage/output/test-run-01/final.mp4
# Or copy to a known location and play with your preferred player
```

Expected: actual moving video with VO and captions, not a static slideshow. If it's a slideshow, OpenMontage's slideshow-risk gate failed to catch it — file a note in `.scratch/conventions.md` for later tuning.

- [ ] **Step 6: Declare Layer 0 done**

If you have a real video: Layer 0 ships. Proceed to Phase B.

If the run failed mid-pipeline: review agent logs, check `.scratch/conventions.md` for misread conventions, tweak the prompt, and retry. Do not move to Phase B until at least one built-in pipeline produces a valid .mp4.

- [ ] **Step 7: Commit test output reference (not the file itself)**

```bash
cd /home/roly/openmontage
# Add output/ to gitignore so we don't commit rendered videos
echo 'output/' >> .gitignore
git add .gitignore
git commit -m "chore: ignore output/ render directory"
```

---

## Phase B — Offer briefs repo and symlink migration

Goal of Phase B: Offer briefs live in their own versioned git repo, and `/videoad` still works unchanged.

### Task B1: Create `offer-briefs` repo and migrate files

**Files:**
- Create: `/home/roly/offer-briefs/` (new git clone)
- Modify: `~/.claude/offers/` (replaced by symlink)

- [ ] **Step 1: Create the repo on GitHub**

```bash
gh repo create offer-briefs --private --description "Personal offer briefs for videoad + openmontage" --clone=false
```

Expected: repo created at `github.com/$GH_USER/offer-briefs`.

- [ ] **Step 2: Initialize local directory and push existing briefs**

```bash
cd /home/roly
mkdir -p offer-briefs
cd offer-briefs
git init
git remote add origin https://github.com/$GH_USER/offer-briefs.git
cp -r ~/.claude/offers/*.md .
ls -la
```

Expected: all current offer `.md` files copied. Sanity check against `ls ~/.claude/offers/`.

- [ ] **Step 3: Commit and push**

```bash
cd /home/roly/offer-briefs
git add .
git commit -m "initial: import offers from ~/.claude/offers/"
git branch -M main
git push -u origin main
```

Expected: pushed successfully.

- [ ] **Step 4: Back up the old directory before replacing with symlink**

```bash
mv ~/.claude/offers ~/.claude/offers.bak
ls ~/.claude/ | grep offers
```

Expected: `offers.bak` exists; `offers` does not.

- [ ] **Step 5: Create symlink**

```bash
ln -s /home/roly/offer-briefs ~/.claude/offers
ls -la ~/.claude/offers
```

Expected: symlink points to `/home/roly/offer-briefs`.

- [ ] **Step 6: Verify `/videoad` still reads offers**

```bash
ls ~/.claude/offers/
# Should list all your .md files via the symlink
cat ~/.claude/offers/akemi-detox-tea.md | head -5
```

Expected: offer content readable through the symlink.

- [ ] **Step 7: Remove the backup once confirmed**

Wait until you've actually run `/videoad` once and confirmed it works end-to-end. Then:

```bash
rm -rf ~/.claude/offers.bak
```

Leave this step as a separate manual verification — don't automate deletion.

---

## Phase C — Custom tools: offer_loader + r2_storage

Goal of Phase C: Two new tools added to the fork, registered in the tool registry, unit-tested.

### Task C1: Write `offer_loader` tool with tests

**Files:**
- Create: `/home/roly/openmontage/tools/offer_loader.py`
- Create: `/home/roly/openmontage/tests/tools/test_offer_loader.py`

**Note:** This task references OpenMontage's actual `BaseTool` class and tool-registration mechanism. If your `.scratch/conventions.md` from Task A2 documents these differently than shown below, adjust the imports and base class accordingly.

- [ ] **Step 1: Create tests directory if it doesn't exist**

```bash
cd /home/roly/openmontage
mkdir -p tests/tools
touch tests/__init__.py tests/tools/__init__.py
```

- [ ] **Step 2: Write the failing test**

Create `tests/tools/test_offer_loader.py`:

```python
import os
import tempfile
import pytest
from pathlib import Path

from tools.offer_loader import OfferLoader


@pytest.fixture
def offers_dir():
    with tempfile.TemporaryDirectory() as d:
        # Simulate one offer file matching the production format
        content = """---
slug: test-offer
name: Test Offer
price: $49
target: women 35-65 with energy issues
language: en
landing_url: https://example.com
---

## Primary angle
A calm, morning-focused promise.

## USPs
- Simple
- Fast
- Backed by research

## Proven hooks
- "The 3-second morning trick"
- "Why my 62-year-old aunt wakes up without coffee"

## Mechanism
Polyphenols bind to cortisol receptors.

## Banned claims
- "Cure"
- "Medical"
"""
        (Path(d) / "test-offer.md").write_text(content)
        yield d


def test_list_returns_all_slugs(offers_dir):
    loader = OfferLoader(offers_dir=offers_dir)
    slugs = loader.list()
    assert slugs == ["test-offer"]


def test_load_returns_structured_dict(offers_dir):
    loader = OfferLoader(offers_dir=offers_dir)
    offer = loader.load("test-offer")
    assert offer["slug"] == "test-offer"
    assert offer["name"] == "Test Offer"
    assert offer["price"] == "$49"
    assert offer["target"] == "women 35-65 with energy issues"
    assert offer["landing_url"] == "https://example.com"
    assert "Primary angle" in offer["sections"]
    assert "calm, morning-focused" in offer["sections"]["Primary angle"]
    assert "USPs" in offer["sections"]
    assert "Banned claims" in offer["sections"]


def test_load_missing_slug_raises(offers_dir):
    loader = OfferLoader(offers_dir=offers_dir)
    with pytest.raises(FileNotFoundError):
        loader.load("does-not-exist")


def test_load_reads_multiple_sections(offers_dir):
    loader = OfferLoader(offers_dir=offers_dir)
    offer = loader.load("test-offer")
    # At least four section headings should be present
    assert len(offer["sections"]) >= 4
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /home/roly/openmontage
source .venv/bin/activate
pip install pytest pyyaml
pytest tests/tools/test_offer_loader.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'tools.offer_loader'`.

- [ ] **Step 4: Write the implementation**

Create `tools/offer_loader.py`:

```python
"""
Offer brief loader for OpenMontage.

Reads markdown files from OFFER_BRIEFS_DIR (or an explicit path) and returns
a structured dict the agent can pass to script/concept stages.

File format (matches existing ~/.claude/offers/*.md):
  ---
  slug: akemi-detox-tea
  name: Akemi Detox Tea
  price: $49
  target: women 35-65 with fatigue
  language: en
  landing_url: https://...
  ---

  ## Primary angle
  ...

  ## USPs
  ...
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional

import yaml


class OfferLoader:
    """Load offer brief markdown files and expose them as structured data."""

    def __init__(self, offers_dir: Optional[str] = None) -> None:
        self.offers_dir = Path(offers_dir or os.environ["OFFER_BRIEFS_DIR"])
        if not self.offers_dir.is_dir():
            raise FileNotFoundError(
                f"OFFER_BRIEFS_DIR not found: {self.offers_dir}"
            )

    def list(self) -> list[str]:
        """Return all offer slugs (filenames without .md extension)."""
        return sorted(p.stem for p in self.offers_dir.glob("*.md"))

    def load(self, slug: str) -> dict:
        """Return a dict with all frontmatter fields plus `sections` dict."""
        path = self.offers_dir / f"{slug}.md"
        if not path.exists():
            raise FileNotFoundError(f"Offer not found: {slug} (looked in {path})")

        text = path.read_text()
        frontmatter, body = self._split_frontmatter(text)
        sections = self._parse_sections(body)

        return {
            **frontmatter,
            "slug": frontmatter.get("slug", slug),
            "sections": sections,
        }

    @staticmethod
    def _split_frontmatter(text: str) -> tuple[dict, str]:
        """Split YAML frontmatter block from markdown body."""
        if not text.startswith("---"):
            return {}, text
        parts = text.split("---", 2)
        if len(parts) < 3:
            return {}, text
        frontmatter = yaml.safe_load(parts[1]) or {}
        body = parts[2].lstrip("\n")
        return frontmatter, body

    @staticmethod
    def _parse_sections(body: str) -> dict[str, str]:
        """Split body at `## Heading` boundaries into a dict."""
        sections: dict[str, str] = {}
        current_heading: Optional[str] = None
        current_lines: list[str] = []

        for line in body.splitlines():
            match = re.match(r"^##\s+(.+)$", line)
            if match:
                if current_heading is not None:
                    sections[current_heading] = "\n".join(current_lines).strip()
                current_heading = match.group(1).strip()
                current_lines = []
            else:
                current_lines.append(line)

        if current_heading is not None:
            sections[current_heading] = "\n".join(current_lines).strip()

        return sections
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/roly/openmontage
pytest tests/tools/test_offer_loader.py -v
```

Expected: all 4 tests pass.

- [ ] **Step 6: Register the tool with OpenMontage's tool registry**

This step requires the exact registration pattern you captured in `.scratch/conventions.md`. Two common patterns:

**Pattern 1 — auto-discovery:** if `tools/tool_registry.py` imports all files in `tools/` and calls `registry.register()` on `BaseTool` subclasses, then `OfferLoader` needs to inherit from `BaseTool` and set class attributes. Update `tools/offer_loader.py`:

```python
from tools.base import BaseTool  # or wherever BaseTool lives — see .scratch/conventions.md

class OfferLoader(BaseTool):
    name = "offer_loader"
    description = "Load structured offer brief data by slug"
    category = "context"
    # ... rest of implementation unchanged
```

**Pattern 2 — explicit registration:** if tools are explicitly added in `tool_registry.py`, add a line:

```python
from tools.offer_loader import OfferLoader
registry.register(OfferLoader())
```

Apply whichever matches your fork's convention. If unsure, check what `tools/fal_video.py` or similar existing tool looks like and mirror it.

- [ ] **Step 7: Verify registration**

```bash
cd /home/roly/openmontage
source .venv/bin/activate
OFFER_BRIEFS_DIR=/home/roly/offer-briefs python -c "
from tools.tool_registry import registry
tool = registry.get('offer_loader')
print('Registered:', tool is not None)
print('List offers:', tool.list() if tool else [])
"
```

Expected: `Registered: True`, prints your offer slugs.

- [ ] **Step 8: Commit**

```bash
cd /home/roly/openmontage
git add tools/offer_loader.py tests/tools/test_offer_loader.py tests/__init__.py tests/tools/__init__.py
git commit -m "feat(tools): add offer_loader to expose offer briefs as tool context"
```

---

### Task C2: Write `r2_storage` tool with tests

**Files:**
- Create: `/home/roly/openmontage/tools/r2_storage.py`
- Create: `/home/roly/openmontage/tests/tools/test_r2_storage.py`

- [ ] **Step 1: Install boto3**

```bash
cd /home/roly/openmontage
source .venv/bin/activate
pip install boto3
# Pin it:
grep -q '^boto3' requirements.txt || echo 'boto3>=1.34' >> requirements.txt
```

- [ ] **Step 2: Write the failing test**

Create `tests/tools/test_r2_storage.py`:

```python
import os
from unittest.mock import MagicMock, patch

import pytest

from tools.r2_storage import R2Storage


@pytest.fixture
def mock_env(monkeypatch):
    monkeypatch.setenv("R2_BUCKET", "test-bucket")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://test.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_PUBLIC_URL", "https://pub.example.com")


def test_upload_returns_public_url(mock_env, tmp_path):
    local_file = tmp_path / "clip.mp4"
    local_file.write_bytes(b"fake-mp4-bytes")

    fake_client = MagicMock()
    with patch("tools.r2_storage.boto3.client", return_value=fake_client):
        storage = R2Storage()
        url = storage.upload(str(local_file), "openmontage/test-run/clip.mp4")

    fake_client.upload_file.assert_called_once_with(
        str(local_file),
        "test-bucket",
        "openmontage/test-run/clip.mp4",
    )
    assert url == "https://pub.example.com/openmontage/test-run/clip.mp4"


def test_upload_missing_env_raises(monkeypatch, tmp_path):
    for var in ("R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
                "R2_ENDPOINT_URL", "R2_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)

    with pytest.raises(RuntimeError, match="R2_BUCKET"):
        R2Storage()


def test_upload_missing_file_raises(mock_env):
    fake_client = MagicMock()
    with patch("tools.r2_storage.boto3.client", return_value=fake_client):
        storage = R2Storage()
        with pytest.raises(FileNotFoundError):
            storage.upload("/does/not/exist.mp4", "x/y.mp4")
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pytest tests/tools/test_r2_storage.py -v
```

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 4: Write the implementation**

Create `tools/r2_storage.py`:

```python
"""
Cloudflare R2 upload tool for OpenMontage artifacts.

Reuses the same R2 bucket used by MVMT Printer. Uploaded keys are
prefixed under `openmontage/<run-id>/` so artifacts are isolated.
"""
from __future__ import annotations

import os
from pathlib import Path

import boto3


REQUIRED_ENV = (
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ENDPOINT_URL",
    "R2_PUBLIC_URL",
)


class R2Storage:
    """Upload local files to Cloudflare R2 and return public URLs."""

    def __init__(self) -> None:
        missing = [v for v in REQUIRED_ENV if not os.environ.get(v)]
        if missing:
            raise RuntimeError(
                f"Missing required env vars for R2Storage: {', '.join(missing)}"
            )

        self.bucket = os.environ["R2_BUCKET"]
        self.public_url = os.environ["R2_PUBLIC_URL"].rstrip("/")
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    def upload(self, local_path: str, key: str) -> str:
        """Upload a local file to R2. Returns the public URL."""
        if not Path(local_path).exists():
            raise FileNotFoundError(f"Local file not found: {local_path}")
        self.client.upload_file(local_path, self.bucket, key)
        return f"{self.public_url}/{key}"
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/tools/test_r2_storage.py -v
```

Expected: all 3 tests pass.

- [ ] **Step 6: Register the tool**

Same registration pattern as OfferLoader (see Task C1 Step 6). Either inherit from `BaseTool` with `name = "r2_storage"` or add explicit registration in `tool_registry.py`.

- [ ] **Step 7: Add R2 vars to `.env.example` and `.env`**

Append to `.env.example`:

```
# Cloudflare R2 artifact storage
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT_URL=
R2_PUBLIC_URL=
OFFER_BRIEFS_DIR=/home/roly/offer-briefs
OPENMONTAGE_MAX_COST_USD=5
```

Fill in `.env` with the actual values. Pull R2 credentials from MVMT Printer's Railway env (same bucket).

- [ ] **Step 8: Verify registration**

```bash
source .venv/bin/activate
python -c "
from tools.tool_registry import registry
tool = registry.get('r2_storage')
print('Registered:', tool is not None)
"
```

Expected: `Registered: True`.

- [ ] **Step 9: Commit**

```bash
cd /home/roly/openmontage
git add tools/r2_storage.py tests/tools/test_r2_storage.py requirements.txt .env.example
git commit -m "feat(tools): add r2_storage for Cloudflare R2 artifact uploads"
```

---

## Phase D — `facebook-ad` pipeline (manifest + stage skills)

Goal of Phase D: A registered `facebook-ad` pipeline the agent can run, producing DR-grade short-form vertical ads using offer context.

### Task D1: Write `facebook-ad.yaml` pipeline manifest

**Files:**
- Create: `/home/roly/openmontage/pipeline_defs/facebook-ad.yaml`

**Reference:** `.scratch/conventions.md` — pipeline YAML schema from Task A2.

- [ ] **Step 1: Re-read an existing pipeline for shape**

```bash
cat /home/roly/openmontage/pipeline_defs/explainer.yaml
```

- [ ] **Step 2: Write `facebook-ad.yaml`**

Draft below. Adjust keys/nesting to match your fork's actual schema (learned in A2).

Create `/home/roly/openmontage/pipeline_defs/facebook-ad.yaml`:

```yaml
name: facebook-ad
description: >
  Short-form direct-response video ad for Facebook/Instagram feed or reels.
  Reference-driven (optional competitor video) or cold-brief. Always loads
  offer context via offer_loader. Output is 9:16 by default, 15-90 seconds,
  with burned-in captions, VO, and background music.

inputs:
  required:
    - offer_slug        # string, must exist in offer_loader.list()
    - duration_s        # int, 15-90
    - aspect            # 9:16 | 1:1 | 16:9
  optional:
    - reference_url     # YouTube/TikTok/FB URL of a competitor ad to teardown
    - platform          # facebook | instagram | tiktok (affects pacing defaults)

stages:
  - name: load_context
    skill: skills/pipelines/facebook-ad/load-context.md
    tools:
      - offer_loader
    produces: offer_context

  - name: teardown
    skill: skills/pipelines/facebook-ad/teardown.md
    condition: reference_url is not null
    tools:
      - gemini_video_analyzer
      - web_fetcher
    produces: teardown_notes
    optional: true

  - name: concept
    skill: skills/pipelines/facebook-ad/concept.md
    tools:
      - claude_writer
    inputs:
      - offer_context
      - teardown_notes
    produces: concept_variants   # 2-3 differentiated angles

  - name: approval_gate
    skill: skills/pipelines/facebook-ad/approval-gate.md
    gate: true
    # In headless (worker) mode, auto-approve if estimated cost is under cap.
    # In interactive (skill) mode, user confirms.

  - name: script
    skill: skills/pipelines/facebook-ad/script.md
    tools:
      - claude_writer
    inputs:
      - offer_context
      - concept_variants
    produces: scene_script

  - name: asset_gen
    skill: skills/pipelines/facebook-ad/asset-gen.md
    tools:
      - provider_selector    # scored 7-dim selection
      - fal_video
      - kling_video
      - veo_video
      - minimax_video
      - flux_image
      - piper_tts
      - elevenlabs_tts
    inputs:
      - scene_script
    produces: scene_assets    # list of clip paths + vo audio paths

  - name: pre_compose_validation
    gate: true
    # OpenMontage built-in: delivery promise + slideshow risk

  - name: compose
    skill: skills/pipelines/facebook-ad/compose.md
    tools:
      - remotion_composer
      - ffmpeg_mixer
      - whisperx_subtitler
      - music_selector
    inputs:
      - scene_assets
    produces: final_video

  - name: post_render_review
    gate: true
    # OpenMontage built-in: ffprobe + 4-frame extraction + audio level

  - name: upload
    skill: skills/pipelines/facebook-ad/upload.md
    tools:
      - r2_storage
    inputs:
      - final_video
    produces: artifact_urls

success_gates:
  - post_render_review passes
  - artifact_urls.final_video is https-accessible

style_defaults:
  captions:
    font_family: Inter-Bold
    size_pct: 7
    color: white
    stroke: black
    position: bottom_center
  music:
    volume_db: -18
  vo:
    voice_preference: energetic_female_mid_range
```

- [ ] **Step 3: Validate YAML parses**

```bash
python -c "import yaml; yaml.safe_load(open('/home/roly/openmontage/pipeline_defs/facebook-ad.yaml'))"
```

Expected: no output (success).

- [ ] **Step 4: Verify pipeline appears in registry**

Many OpenMontage forks auto-discover pipelines. Test with:

```bash
cd /home/roly/openmontage
source .venv/bin/activate
OFFER_BRIEFS_DIR=/home/roly/offer-briefs python -c "
import os
# Use whatever discovery mechanism your fork uses — check README/AGENT_GUIDE
from pathlib import Path
pipelines = [p.stem for p in Path('pipeline_defs').glob('*.yaml')]
print('Pipelines:', pipelines)
assert 'facebook-ad' in pipelines
print('OK')
"
```

Expected: `facebook-ad` in the list, `OK` printed.

- [ ] **Step 5: Commit**

```bash
git add pipeline_defs/facebook-ad.yaml
git commit -m "feat(pipeline): add facebook-ad pipeline manifest"
```

---

### Task D2: Write stage director skill — `load-context.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/load-context.md`

- [ ] **Step 1: Create pipeline skill directory**

```bash
mkdir -p /home/roly/openmontage/skills/pipelines/facebook-ad
```

- [ ] **Step 2: Write the skill**

Create `skills/pipelines/facebook-ad/load-context.md`:

```markdown
# Stage: load_context

Load the full offer brief via the `offer_loader` tool and store it as
`offer_context` state for downstream stages.

## Instructions

1. Confirm `offer_slug` is present in inputs. If missing, abort with a clear
   error listing all available slugs from `offer_loader.list()`.

2. Call `offer_loader.load(offer_slug)`. Capture the returned dict.

3. Store the full dict under state key `offer_context`. All downstream stages
   will reference this.

4. Log a one-line summary: "Loaded offer: {name} ({slug}) — {target}".

## Tool calls

- `offer_loader.list()` — only if the provided slug is missing, to build the error message
- `offer_loader.load(slug)` — always

## Output state

```json
{
  "offer_context": {
    "slug": "akemi-detox-tea",
    "name": "Akemi Detox Tea",
    "price": "$49",
    "target": "women 35-65 with fatigue",
    "language": "en",
    "landing_url": "https://...",
    "sections": {
      "Primary angle": "...",
      "USPs": "...",
      "Proven hooks": "...",
      "Mechanism": "...",
      "Banned claims": "..."
    }
  }
}
```

## Success criteria

- `offer_context.slug` matches input `offer_slug`
- `offer_context.sections` has at least 4 headings
- No banned-claims violation has been introduced yet (this is a load-only stage)
```

- [ ] **Step 3: Commit**

```bash
git add skills/pipelines/facebook-ad/load-context.md
git commit -m "feat(pipeline): add facebook-ad load-context stage skill"
```

---

### Task D3: Write stage director skill — `teardown.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/teardown.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/teardown.md`:

```markdown
# Stage: teardown (conditional)

Only run if `reference_url` is provided. Analyzes a competitor ad video to
extract the "what made this work" essence we'll reverse-engineer for our
offer — NOT copy.

## Instructions

1. Download the reference video to a local temp file using `web_fetcher`
   (handle YouTube, Instagram, Facebook Ad Library, TikTok as best supported
   by available tools).

2. Run `gemini_video_analyzer` on the local file with a prompt that extracts:
   - Hook mechanic (first 2 seconds): what's happening visually, what claim
     is made, what curiosity gap is opened
   - Pacing: average cut duration, number of distinct scenes
   - Voice: on-screen talent or VO? Tone? Speaking speed?
   - Music/sound: genre, energy, any sound effects or transitions
   - Text/captions: font style, size, position, color, are they burned-in
     or overlays?
   - CTA mechanic: how is the offer introduced, what's the urgency/scarcity?
   - Emotional arc: where does it open loop, where does it close?

3. Write output to state key `teardown_notes` as a structured dict.

4. Do NOT store the downloaded video as a permanent artifact — it's reference
   only and stays in temp. Delete after analysis.

## Tool calls

- `web_fetcher.download(url)` → local path
- `gemini_video_analyzer.analyze(local_path, prompt)` → structured notes
- Optionally `web_fetcher.get_metadata(url)` for ad library URLs

## Output state

```json
{
  "teardown_notes": {
    "hook_mechanic": "close-up of visible steam rising from cup with whispered 'she didn't know'",
    "pacing": {"avg_cut_s": 1.4, "scene_count": 18},
    "voice": {"type": "female VO", "tone": "conspiratorial", "wpm": 180},
    "music": {"genre": "tense-ambient", "energy": "medium-rising"},
    "captions": {"style": "white bold Inter, bottom 1/3, burned-in"},
    "cta_mechanic": "offer introduced at 0:22 via scarcity — 'only 50 left at this price'",
    "emotional_arc": "open-loop at 0:00, pain amplification at 0:06, reveal at 0:14, close at 0:25"
  }
}
```

## Success criteria

- `teardown_notes` has all 7 fields populated
- Temp video deleted after analysis
- No reference to any protected/branded content copied verbatim — notes
  describe mechanics only, not scripts
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/teardown.md
git commit -m "feat(pipeline): add facebook-ad teardown stage skill"
```

---

### Task D4: Write stage director skill — `concept.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/concept.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/concept.md`:

```markdown
# Stage: concept

Produce 2–3 differentiated concept variants for the offer. If `teardown_notes`
is present, each variant must deviate meaningfully from the reference — we
are reverse-engineering principles, not cloning.

## Instructions

1. Read `offer_context` (always present) and `teardown_notes` (if present).

2. Call `claude_writer` with a prompt that includes:
   - The full offer brief (all sections, especially Primary angle, Proven
     hooks, Mechanism, Banned claims)
   - The teardown notes if present
   - Constraint: produce 2–3 concepts. Each must have a distinct hook angle,
     distinct emotional arc, and distinct mechanism framing. No concept may
     use a banned claim.

3. For each concept, Claude must output:
   - `id`: short slug (e.g. "shower-reveal", "62-aunt", "green-bottle")
   - `hook_line`: first 8-12 words spoken/shown
   - `hook_formula`: one of OPEN_LOOP, PAIN_AMPLIFICATION, MECHANISM_FRAMING,
     SPECIFICITY, CREDIBILITY, TIME_COMPRESSION
   - `emotional_arc`: 4-6 beats
   - `mechanism_pitch`: how we explain why this offer works (≤ 30 words)
   - `cta_approach`: how we transition to the offer
   - `why_different`: 1 sentence stating how this deviates from the reference
     (if any) and from the other concepts

4. Store as `concept_variants` (list of dicts).

## Tool calls

- `claude_writer.generate(prompt, output_schema)` — passes offer + teardown
  as context, receives structured concepts

## Output state

```json
{
  "concept_variants": [
    {
      "id": "shower-reveal",
      "hook_line": "She thought it was just morning coffee — until the shower.",
      "hook_formula": "OPEN_LOOP",
      "emotional_arc": ["intrigue", "recognition", "mechanism", "relief", "action"],
      "mechanism_pitch": "Polyphenols bind to cortisol receptors before your first sip.",
      "cta_approach": "Scarcity via 'last batch of Q2 harvest'",
      "why_different": "Reference used a countdown-timer CTA; we use harvest scarcity instead."
    }
  ]
}
```

## Success criteria

- At least 2 concepts produced
- No concept uses a string listed in `offer_context.sections['Banned claims']`
- Each concept's `why_different` meaningfully differentiates from others
  AND from the reference if one exists
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/concept.md
git commit -m "feat(pipeline): add facebook-ad concept stage skill"
```

---

### Task D5: Write stage director skill — `approval-gate.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/approval-gate.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/approval-gate.md`:

```markdown
# Stage: approval_gate

Present the 2–3 concept variants and the estimated cost, then either pause
for human approval (interactive mode) or auto-approve if cost is under cap
(headless/worker mode).

## Instructions

1. Estimate cost by summing:
   - asset_gen cost (sum of per-provider estimates for chosen video/audio providers)
   - LLM cost (Claude orchestration, rough estimate $0.30-$1.50)
   - Round up, cap view at whole dollars.

2. Decide mode:
   - If env `OPENMONTAGE_INTERACTIVE=1` or running under a TTY: interactive.
   - Else (worker / CI): headless.

3. Interactive mode:
   - Print the 2–3 concepts in readable form.
   - Print the cost estimate and the env cap (`OPENMONTAGE_MAX_COST_USD`).
   - Ask: "Pick a concept (1/2/3) or 'q' to quit." Wait for input.
   - Store the chosen concept index in state as `approved_concept_index`.

4. Headless mode:
   - Pick the first concept (by default). Subclassing / future work can add
     smarter selection logic.
   - If estimated cost exceeds `OPENMONTAGE_MAX_COST_USD`, abort the run
     with a clear error. Do not proceed.
   - Store index and log the auto-approval.

## Output state

```json
{
  "estimated_cost_usd": 2.15,
  "approved_concept_index": 0
}
```

## Success criteria

- Either a human approved a concept, or cost was under cap and auto-approved
- `approved_concept_index` is a valid index into `concept_variants`
- If cost > cap, the run halts and no subsequent stages run
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/approval-gate.md
git commit -m "feat(pipeline): add facebook-ad approval-gate stage skill"
```

---

### Task D6: Write stage director skill — `script.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/script.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/script.md`:

```markdown
# Stage: script

Turn the approved concept into a scene-by-scene shot list with VO lines,
visual directions, captions, durations, and tool hints.

## Instructions

1. Read `offer_context`, `concept_variants[approved_concept_index]`,
   `teardown_notes` (optional), and inputs (`duration_s`, `aspect`).

2. Call `claude_writer` with a structured-output prompt to produce:

```yaml
title: string
duration_s: int
aspect: string
scenes:
  - id: "s1"
    duration_s: 2.5
    visual_description: "close-up, natural light, steam rising from a mug"
    camera: "static or slow-zoom"
    motion_needs: "subtle drift; motion-led"
    vo_line: "She thought it was just morning coffee."
    caption_line: "She thought it was just morning coffee."
    tool_hint: "fal_video:minimax"  # or kling, veo, etc.
  - id: "s2"
    ...
hook_line: string
hook_formula: string
cta_line: string
compliance_check:
  - "no 'cure' claim used"
  - "no medical advice"
  - "FTC disclaimer included on final scene"
self_scorecard:
  hook_strength_0_10: 9
  specificity_score_0_10: 8
  day1_conversion_readiness_0_10: 8
notes_for_buyer: string
```

3. Validate:
   - Sum of `scenes[].duration_s` equals input `duration_s` (±0.5s)
   - `self_scorecard.day1_conversion_readiness_0_10 >= 7`. If under 7, run
     one critique + rewrite pass. If still under 7 after one rewrite, store
     `scene_script.quality_gate_failed = true` and the final stage will halt.
   - No banned claim from `offer_context.sections['Banned claims']` appears
     verbatim in any vo_line or caption_line
   - Each scene has a non-empty `visual_description`
   - Every scene has a `tool_hint`

4. Store the full output under `scene_script`.

## Tool calls

- `claude_writer.generate(prompt, schema)` — possibly called twice if first
  pass fails quality gate

## Output state

See schema above.

## Success criteria

- All scene durations sum to target (±0.5s)
- Quality score ≥ 7/10 (OR explicit halt flag set)
- No banned claims
- At least one `motion_needs` indicates real motion (to avoid slideshow risk)
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/script.md
git commit -m "feat(pipeline): add facebook-ad script stage skill"
```

---

### Task D7: Write stage director skill — `asset-gen.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/asset-gen.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/asset-gen.md`:

```markdown
# Stage: asset_gen

For each scene in `scene_script.scenes`, generate a real video clip + VO audio.
Parallelize where provider APIs allow.

## Instructions

1. For each scene:
   a. Call `provider_selector.score(scene)` with signals derived from
      `visual_description`, `motion_needs`, `duration_s`, `aspect`, and
      `tool_hint`. Receive a ranked list of providers with confidence.
   b. Pick the top provider whose total run-cost + running-total stays under
      `OPENMONTAGE_MAX_COST_USD`. If no provider fits, halt with clear error.
   c. Generate the video clip using the chosen tool (e.g., `fal_video`,
      `kling_video`, `veo_video`, `minimax_video`).
   d. Generate VO audio. Default to `piper_tts` (free, local). If
      `ELEVENLABS_API_KEY` is set AND offer.target indicates premium
      audio is important, use `elevenlabs_tts`.

2. After each generation:
   - Validate the clip exists, has the right duration (±10%), correct aspect.
   - Run OpenMontage's slideshow-risk detector against the single clip (if
     available at this granularity). If clip fails, regenerate once with
     an enhanced motion prompt.

3. Store results as:

```json
{
  "scene_assets": [
    {
      "scene_id": "s1",
      "video_path": "/tmp/run-xxx/s1.mp4",
      "vo_path": "/tmp/run-xxx/s1.wav",
      "provider": "fal:minimax/hailuo-02/standard",
      "cost_usd": 0.12
    }
  ]
}
```

## Tool calls

- `provider_selector.score(scene)` — per scene
- One of: `fal_video`, `kling_video`, `veo_video`, `minimax_video` (from selector)
- `piper_tts.synthesize(text, voice)` or `elevenlabs_tts.synthesize(...)`
- `flux_image` or `dalle_image` — only if a scene explicitly needs a still
  image (title cards, logo flashes)

## Output state

See schema above (`scene_assets` as array).

## Success criteria

- Every scene in `scene_script.scenes` has a matching `scene_assets` entry
- Total cost so far < `OPENMONTAGE_MAX_COST_USD`
- Every video file exists and ffprobe reports valid streams
- Every VO file exists with non-zero duration
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/asset-gen.md
git commit -m "feat(pipeline): add facebook-ad asset-gen stage skill"
```

---

### Task D8: Write stage director skill — `compose.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/compose.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/compose.md`:

```markdown
# Stage: compose

Stitch scene clips into a single video with VO, music, captions, and title
cards using Remotion.

## Instructions

1. Prepare the Remotion project input:
   - Build a JSON manifest listing scenes in order, each with `video_path`,
     `vo_path`, `caption_line`, `duration_s`
   - Select a music track via `music_selector` using `concept.emotional_arc`
     and total duration (OpenMontage has a free library; pick energy match)
   - Apply `style_defaults` from `facebook-ad.yaml`

2. Call `remotion_composer.render(manifest, output_path, aspect)`:
   - Captions burned-in per `style_defaults.captions`
   - VO mixed in per-scene; music ducked under VO
   - Final encode: H.264, AAC audio, 30fps, target bitrate appropriate for
     platform (~6 Mbps for 9:16 social)

3. After render:
   - Run `whisperx_subtitler` on the final mp4 to generate a `.srt`.
     Compare against `scene_script.scenes[].caption_line` — if WhisperX
     transcription diverges significantly from scripted caption, log a
     warning but continue (VO may have drifted).

4. Store:

```json
{
  "final_video": {
    "path": "/tmp/run-xxx/final.mp4",
    "srt_path": "/tmp/run-xxx/final.srt",
    "duration_s": 30.2,
    "filesize_mb": 18.4
  }
}
```

## Tool calls

- `music_selector.pick(emotional_arc, duration_s)` → music track path
- `remotion_composer.render(manifest, output_path, aspect)` → final video
- `whisperx_subtitler.transcribe(mp4_path)` → .srt

## Output state

See schema above.

## Success criteria

- Final mp4 exists, ffprobe reports valid v+a streams
- Duration matches target ±2%
- No black frames in first or last 0.5s
- SRT file generated
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/compose.md
git commit -m "feat(pipeline): add facebook-ad compose stage skill"
```

---

### Task D9: Write stage director skill — `upload.md`

**Files:**
- Create: `/home/roly/openmontage/skills/pipelines/facebook-ad/upload.md`

- [ ] **Step 1: Write the skill**

Create `skills/pipelines/facebook-ad/upload.md`:

```markdown
# Stage: upload

Upload final artifacts to Cloudflare R2 and return public URLs.

## Instructions

1. Build the run-id (short UUID, 8 chars).

2. Upload via `r2_storage.upload`:
   - `openmontage/{run_id}/final.mp4`     ← final_video.path
   - `openmontage/{run_id}/final.srt`     ← final_video.srt_path
   - `openmontage/{run_id}/script.json`   ← scene_script
   - `openmontage/{run_id}/concept.json`  ← approved concept
   - `openmontage/{run_id}/cost_log.json` ← cumulative cost log

3. Capture returned public URLs in `artifact_urls` dict.

4. Also write a local mirror at `~/videos/{offer_slug}/{run_id}/` so you
   have an offline copy. Use shell cp, don't re-upload.

## Tool calls

- `r2_storage.upload(local_path, key)` — once per artifact

## Output state

```json
{
  "artifact_urls": {
    "final_video": "https://pub.example.com/openmontage/abc12345/final.mp4",
    "srt": "https://pub.example.com/openmontage/abc12345/final.srt",
    "script": "https://pub.example.com/openmontage/abc12345/script.json",
    "concept": "https://pub.example.com/openmontage/abc12345/concept.json",
    "cost_log": "https://pub.example.com/openmontage/abc12345/cost_log.json"
  },
  "run_id": "abc12345"
}
```

## Success criteria

- All 5 URLs returned
- `curl -I $final_video` returns HTTP 200
- Local mirror exists at `~/videos/{offer_slug}/{run_id}/final.mp4`
```

- [ ] **Step 2: Commit**

```bash
git add skills/pipelines/facebook-ad/upload.md
git commit -m "feat(pipeline): add facebook-ad upload stage skill"
```

---

### Task D10: End-to-end pipeline validation run

Goal: Run the full `facebook-ad` pipeline against a real offer and produce a real mp4.

- [ ] **Step 1: Ensure env is complete**

```bash
cd /home/roly/openmontage
source .venv/bin/activate
python -c "
from dotenv import load_dotenv
load_dotenv()
import os
required = [
  'FAL_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'OFFER_BRIEFS_DIR',
  'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT_URL', 'R2_PUBLIC_URL',
  'OPENMONTAGE_MAX_COST_USD',
]
missing = [k for k in required if not os.environ.get(k)]
print('Missing:' if missing else 'OK:', missing or 'all set')
"
```

Expected: `OK: all set`.

- [ ] **Step 2: Start a fresh Claude Code session in the fork**

```bash
cd /home/roly/openmontage
claude
```

- [ ] **Step 3: Paste the end-to-end prompt**

In the Claude Code session:

```
You are operating inside the OpenMontage repo at /home/roly/openmontage.

Read pipeline_defs/facebook-ad.yaml and all stage director skills under
skills/pipelines/facebook-ad/. Use the registered tools from
tools/tool_registry.py.

Inputs:
  offer_slug: akemi-detox-tea     # pick any real offer you have
  duration_s: 30
  aspect: "9:16"
  platform: facebook
  reference_url: null              # cold brief — no competitor video

Constraint: cost cap = $3 (env OPENMONTAGE_MAX_COST_USD=3). Prefer Piper
(free) for VO and cheaper Fal models (minimax/hailuo-02/standard) for
video unless a scene explicitly needs a premium model.

Run every stage in order. Interactive mode: pause at approval_gate and
show me the 2-3 concepts; I'll pick one.

Log progress and provider cost as you go. When done, print the final
artifact URLs.
```

- [ ] **Step 4: Watch and approve when prompted**

Agent will:
- Load offer context
- Generate 2-3 concepts
- Pause for your approval — pick one
- Proceed through script → assets → compose → review → upload
- Print final URLs

Expected runtime: 10-25 minutes.

- [ ] **Step 5: Download and inspect the final video**

```bash
# Replace URL with the actual artifact_urls.final_video from step 4
curl -L -o /tmp/openmontage-first-fb-ad.mp4 "<final_video_url>"
ffprobe /tmp/openmontage-first-fb-ad.mp4 2>&1 | grep -E 'Duration|Stream'
xdg-open /tmp/openmontage-first-fb-ad.mp4
```

Expected: duration ~30s, aspect 9:16, clear VO + music + captions + real motion (not slideshow).

- [ ] **Step 6: If output is acceptable, commit nothing but record the URL**

```bash
cd /home/roly/openmontage
echo "First successful facebook-ad run: <final_video_url> ($(date))" >> .scratch/runs.log
```

- [ ] **Step 7: If output is unacceptable, iterate**

Common issues:
- **Slideshow output**: strengthen `motion_needs` in script skill, review asset-gen's per-clip slideshow check
- **VO/caption drift**: tighten compose skill's captions to use scripted text, not WhisperX transcription
- **Cost overshoot**: check provider_selector weights, lower cost cap
- **Quality gate failures**: read the gate's error message; iterate the relevant stage skill

Go back through Tasks D5–D9 as needed. This task is complete when you have one acceptable mp4.

---

## Phase E — `/openmontage` Claude Code skill

Goal of Phase E: A `/openmontage` command that can be invoked from any Claude Code session and produces a FB ad end-to-end.

### Task E1: Write the skill directory

**Files:**
- Create: `/home/roly/.claude/skills/openmontage/SKILL.md`
- Create: `/home/roly/.claude/skills/openmontage/bin/bootstrap.sh`

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p /home/roly/.claude/skills/openmontage/bin
```

- [ ] **Step 2: Write `bootstrap.sh`**

Create `/home/roly/.claude/skills/openmontage/bin/bootstrap.sh`:

```bash
#!/usr/bin/env bash
# Idempotent bootstrap for /openmontage skill.
# Ensures fork + offer-briefs + venv are ready and env is populated.

set -euo pipefail

FORK_DIR="${OPENMONTAGE_FORK_DIR:-/home/roly/openmontage}"
OFFERS_DIR="${OFFER_BRIEFS_DIR:-/home/roly/offer-briefs}"

echo "[bootstrap] Fork: $FORK_DIR"
echo "[bootstrap] Offers: $OFFERS_DIR"

# 1. Fork must exist
if [[ ! -d "$FORK_DIR/.git" ]]; then
  echo "ERROR: OpenMontage fork not found at $FORK_DIR"
  echo "Run Phase A of the integration plan first."
  exit 1
fi

# 2. Pull latest from our fork (not upstream — deliberate)
(cd "$FORK_DIR" && git pull --ff-only origin main 2>/dev/null || echo "[bootstrap] (local changes present, skipping pull)")

# 3. Ensure offers repo exists and is up to date
if [[ ! -d "$OFFERS_DIR/.git" ]]; then
  echo "ERROR: offer-briefs repo not found at $OFFERS_DIR"
  exit 1
fi
(cd "$OFFERS_DIR" && git pull --ff-only origin main 2>/dev/null || echo "[bootstrap] (offers have local changes, skipping pull)")

# 4. Activate venv
if [[ ! -d "$FORK_DIR/.venv" ]]; then
  echo "ERROR: Python venv not found at $FORK_DIR/.venv"
  echo "Run: cd $FORK_DIR && python3 -m venv .venv && make setup"
  exit 1
fi

# 5. Verify required env vars from fork's .env
set -a
source "$FORK_DIR/.env"
set +a

MISSING=()
for v in FAL_KEY GEMINI_API_KEY OFFER_BRIEFS_DIR R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT_URL R2_PUBLIC_URL; do
  if [[ -z "${!v:-}" ]]; then
    MISSING+=("$v")
  fi
done

if (( ${#MISSING[@]} > 0 )); then
  echo "ERROR: missing env vars in $FORK_DIR/.env: ${MISSING[*]}"
  exit 1
fi

echo "[bootstrap] READY"
echo "[bootstrap] FORK_DIR=$FORK_DIR"
echo "[bootstrap] OFFERS_DIR=$OFFERS_DIR"
```

- [ ] **Step 3: Make bootstrap executable**

```bash
chmod +x /home/roly/.claude/skills/openmontage/bin/bootstrap.sh
```

- [ ] **Step 4: Test bootstrap**

```bash
/home/roly/.claude/skills/openmontage/bin/bootstrap.sh
```

Expected output ends with `[bootstrap] READY`.

- [ ] **Step 5: Write `SKILL.md`**

Create `/home/roly/.claude/skills/openmontage/SKILL.md`:

```markdown
---
name: openmontage
description: Full video ad production via OpenMontage — multi-scene, VO, music, captions. Triggers on "/openmontage", "make a full video ad for <offer>", "openmontage <url> --offer <slug>".
---

# /openmontage — Full Video Ad Production

Produces multi-scene Facebook ads (VO + music + captions + title cards)
using the OpenMontage engine at `$OPENMONTAGE_FORK_DIR` (default
`/home/roly/openmontage`).

No CLI wrapper. This skill hands orchestration to the current Claude Code
session — that's how OpenMontage is designed.

## Setup (one-time)

See /home/roly/iscale-facebook-ad-builder/docs/superpowers/plans/2026-04-18-openmontage-layers-0-1-2.md
Phases A–D. Bootstrap will fail fast if prerequisites are missing.

## Invocation

When the user types `/openmontage ...`, run:

```bash
/home/roly/.claude/skills/openmontage/bin/bootstrap.sh
```

If bootstrap exits non-zero, surface the error and stop.

Then parse the user's request:

| User says | Action |
|---|---|
| `/openmontage <url> --offer <slug>` | Pipeline with `reference_url=url, offer_slug=slug` |
| `/openmontage make a 45s fb ad for <slug>` | Pipeline with cold brief, `duration_s=45, offer_slug=slug` |
| `/openmontage <url>` with no offer | Infer offer from context or ask |
| `/openmontage what offers?` | `ls $OFFER_BRIEFS_DIR/*.md | xargs -n1 basename -s .md` |

## Running a pipeline

Once bootstrap succeeds:

1. `cd $OPENMONTAGE_FORK_DIR && source .venv/bin/activate`
2. Read `pipeline_defs/facebook-ad.yaml`
3. Read all markdown files under `skills/pipelines/facebook-ad/`
4. Load tool registry from `tools/tool_registry.py`
5. Follow each stage in order, calling tools as each stage skill instructs
6. Respect all OpenMontage built-in gates (pre-compose validation,
   slideshow risk, post-render review)
7. At `approval_gate`, show 2-3 concepts and pause for user choice
8. After `upload`, print the final R2 URLs and the local mirror path

## Expected artifacts per run

```
# R2 (public):
  https://$R2_PUBLIC_URL/openmontage/<run-id>/final.mp4
  https://$R2_PUBLIC_URL/openmontage/<run-id>/final.srt
  https://$R2_PUBLIC_URL/openmontage/<run-id>/script.json
  https://$R2_PUBLIC_URL/openmontage/<run-id>/concept.json
  https://$R2_PUBLIC_URL/openmontage/<run-id>/cost_log.json

# Local mirror:
  ~/videos/<offer-slug>/<run-id>/final.mp4
```

## Troubleshooting

- `bootstrap.sh` errors — follow its message literally; most are missing env vars
- Pipeline halts at quality gate — read the gate's message; iterate the
  relevant stage skill under `skills/pipelines/facebook-ad/`
- Cost cap hit — raise `OPENMONTAGE_MAX_COST_USD` in the fork's `.env` or
  pick a cheaper provider in the prompt
- Reference URL not supported — download manually, pass the local file path
- `claude` CLI not in session — the skill is designed for use inside a
  Claude Code session; the current session IS the orchestrator
```

- [ ] **Step 6: Verify the skill is discoverable**

Start a fresh Claude Code session in any directory and ask Claude to list skills. The `openmontage` skill should appear in the available skills list. If it doesn't, check that the frontmatter in `SKILL.md` is valid YAML.

- [ ] **Step 7: Commit**

The skill lives under `~/.claude/skills/` which may or may not be a git repo. If it is, commit; if not, skip.

```bash
cd /home/roly/.claude/skills
if git rev-parse --git-dir > /dev/null 2>&1; then
  git add openmontage/
  git commit -m "feat(skill): add /openmontage skill for full video ad production"
fi
```

---

### Task E2: End-to-end skill invocation validation

Goal: Invoke `/openmontage` from a fresh Claude Code session and produce a real FB ad mp4.

- [ ] **Step 1: Start a fresh Claude Code session in an unrelated directory**

```bash
cd ~
claude
```

- [ ] **Step 2: Invoke the skill**

In the Claude Code session, type:

```
/openmontage make a 30s fb ad for akemi-detox-tea
```

(Substitute a real offer slug from your `offer-briefs/` repo.)

- [ ] **Step 3: Observe behavior**

Expected:
1. Skill's `bootstrap.sh` runs and prints `[bootstrap] READY`.
2. Claude Code reads `facebook-ad.yaml` and stage skills.
3. Loads offer context via `offer_loader`.
4. Skips teardown (no reference URL).
5. Generates 2-3 concepts via `claude_writer`.
6. Pauses at approval_gate and lists concepts — you pick one.
7. Runs script → assets → compose → review → upload.
8. Prints final R2 URLs and local mirror path.

- [ ] **Step 4: Download, play, and compare vs. Phase D result**

```bash
curl -L -o /tmp/openmontage-via-skill.mp4 "<final_video_url>"
xdg-open /tmp/openmontage-via-skill.mp4
```

This should be indistinguishable quality-wise from the Phase D run; only the invocation surface differs.

- [ ] **Step 5: Log the run**

```bash
echo "First skill-driven facebook-ad run: <final_video_url> ($(date))" >> /home/roly/openmontage/.scratch/runs.log
```

- [ ] **Step 6: Update MEMORY.md**

Append to `/home/roly/.claude/projects/-home-roly/memory/MEMORY.md` under a new section:

```markdown
## OpenMontage
- Fork: /home/roly/openmontage (calesthio/OpenMontage fork, AGPL-3.0)
- Offers: /home/roly/offer-briefs (git repo; ~/.claude/offers symlinked here)
- Skill: /openmontage — see [openmontage-skill.md](openmontage-skill.md) for usage
- First successful run: <date + URL>
```

Then create `openmontage-skill.md` in that memory dir with one-paragraph context on the tool.

---

## Phase F — Final validation and handoff to Layer 3+

Goal of Phase F: Confirm everything works, document what's next.

### Task F1: Regression check on `/videoad`

The symlink in Task B1 should have kept `/videoad` working unchanged. Confirm.

- [ ] **Step 1: Run `/videoad stats` in a fresh Claude Code session**

```
/videoad stats
```

Expected: prints stats without errors, finds all offers.

- [ ] **Step 2: (Optional) Run a full `/videoad` dry-run**

```
/videoad run <a known URL> --offer <slug> --dry-run
```

Expected: completes stages 0-3 without charging Fal, produces the usual `00-input/`, `01-teardown.md`, `02-concept.md`, `03-script.json` artifacts using offers read through the symlink.

- [ ] **Step 3: Confirm no broken references**

If both `/videoad` and `/openmontage` work end-to-end against the same `offer-briefs/` directory, Phase F is done.

---

### Task F2: Document next-plan scope

This plan stops at Layers 0-2. Layers 3 (backend + worker) and 4 (frontend) need separate plans.

- [ ] **Step 1: Create a "next steps" note**

Create `/home/roly/iscale-facebook-ad-builder/docs/superpowers/plans/2026-04-18-openmontage-layers-0-1-2-FOLLOWUP.md`:

```markdown
# OpenMontage — Follow-up Plans Needed

Layers 0-2 complete. Remaining work:

## Next plan: Layer 3 — MVMT backend + worker service
- `render_jobs` Alembic migration
- `/api/v1/montage/*` router (render, status, list, refresh-offers, send-to-campaign)
- `openmontage-worker` Railway service (Dockerfile with Python + Node, worker.py with Agent SDK)
- Railway deploy + env var provisioning
- End-to-end curl test

## Next plan: Layer 4 — MVMT frontend
- `/montage` page with BriefForm, JobRow, PreviewPane, useRenderJobs hook
- Sidebar nav entry
- "Send to campaign" wiring into existing Create FB Campaigns flow

Both layers are blocked only on Layers 0-2 shipping cleanly.
```

- [ ] **Step 2: Commit follow-up note in the MVMT Printer repo**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-18-openmontage-layers-0-1-2-FOLLOWUP.md
git commit -m "docs: note Layers 3-4 need separate plans"
```

---

## Done

After Phase F, you have:
- A working OpenMontage fork producing full FB ads from cold briefs or reference videos
- A `/openmontage` Claude Code skill that invokes it
- Offers living in their own git repo, `/videoad` still working via symlink
- Two separate follow-up plans queued for MVMT backend + frontend

All artifacts: fork, offer-briefs repo, skill directory, spec at
`docs/superpowers/specs/2026-04-18-openmontage-integration-design.md`,
and this plan itself.
