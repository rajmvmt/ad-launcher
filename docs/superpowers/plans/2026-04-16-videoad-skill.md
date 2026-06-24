# `/videoad` Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI skill at `~/.claude/skills/videoad/` that analyzes a competitor video, reverse-engineers the concept for one of the user's offer briefs in `~/.claude/offers/`, generates a script, and produces a real video via Fal.ai — all from one terminal command.

**Architecture:** Pure CLI. Skill orchestrates 10 Python modules under `~/.claude/skills/videoad/lib/`. Uses `fal_client` for generation, Gemini 2.0 Flash for video teardown, `claude -p` (OAuth) for script work. Zero MVMT backend changes. Artifacts land on local disk; costs tracked in an append-only jsonl per offer.

**Tech Stack:** Python 3.11+, `fal-client`, `google-generativeai`, `python-frontmatter`, `httpx`, `rich`, `pytest`. Shell-outs: `yt-dlp`, `ffmpeg`, `ffprobe`, `claude -p`.

**Spec:** `docs/superpowers/specs/2026-04-16-videoad-skill-design.md`

---

## File Structure

Everything under `~/.claude/skills/videoad/` unless noted. Skill dir is NOT a git repo — progress is tracked via checkboxes in this plan (committed to `iscale-facebook-ad-builder/docs/superpowers/plans/`).

```
~/.claude/skills/videoad/
  SKILL.md                    # user-facing command doc with triggers
  cli.py                      # argparse entrypoint
  requirements.txt            # pinned Python deps
  pytest.ini                  # pytest config
  venv/                       # local virtualenv (do not distribute)
  lib/
    __init__.py
    model_catalog.py          # Fal model list + routing + cost lookup
    offer_loader.py           # ~/.claude/offers/<slug>.md parser + validator
    cost_tracker.py           # jsonl append + stats aggregation
    run_dir.py                # create/resume run dir, detect completed stages
    input_fetcher.py          # URL/file → local .mp4 (yt-dlp, httpx, FB AL)
    teardown.py               # Gemini 2.0 Flash analysis of competitor video
    concept.py                # Claude concept translation (competitor → user offer)
    script.py                 # Claude scene-by-scene script + model suggestion
    fal_runner.py             # fal_client.subscribe() wrapper + download
  prompts/
    teardown.md               # Gemini prompt template
    concept.md                # Claude concept prompt template
    script.md                 # Claude script prompt template
  tests/
    __init__.py
    conftest.py               # shared fixtures
    test_model_catalog.py
    test_offer_loader.py
    test_cost_tracker.py
    test_run_dir.py
    test_input_fetcher.py
    test_teardown.py
    test_concept.py
    test_script.py
    test_fal_runner.py
    test_cli.py
    fixtures/
      sample_offer.md         # minimal valid offer for tests
      sample_offer_invalid.md # missing required sections
      sample_input.mp4        # 2s test video (generated via ffmpeg)
      sample_teardown.md
      sample_concept.md
      sample_script.json
```

### Commit cadence

Every task ends by updating checkboxes in **this plan file** and committing + pushing to `iscale-facebook-ad-builder` (per `feedback_always_push.md`). The skill dir itself is untracked; there's nothing to commit there.

---

## Task 1: Scaffold skill directory, venv, dependencies

**Files:**
- Create: `~/.claude/skills/videoad/requirements.txt`
- Create: `~/.claude/skills/videoad/pytest.ini`
- Create: `~/.claude/skills/videoad/lib/__init__.py` (empty)
- Create: `~/.claude/skills/videoad/tests/__init__.py` (empty)
- Create: `~/.claude/skills/videoad/tests/conftest.py`
- Create: `~/.claude/skills/videoad/prompts/.gitkeep` (empty)

- [x] **Step 1: Create directory tree and venv**

```bash
mkdir -p ~/.claude/skills/videoad/{lib,tests/fixtures,prompts}
cd ~/.claude/skills/videoad
python3 -m venv venv
source venv/bin/activate
python --version  # expect 3.11+
```

Expected: no errors, Python 3.11+ reported.

- [x] **Step 2: Write `requirements.txt`**

```txt
fal-client==0.13.0
google-generativeai>=0.8.0
python-frontmatter>=1.1.0
httpx>=0.27.0
rich>=13.7.0
pytest>=8.0.0
pytest-mock>=3.12.0
```

- [x] **Step 3: Install deps**

Run:
```bash
cd ~/.claude/skills/videoad
source venv/bin/activate
pip install -r requirements.txt
```

Expected: all packages install, no conflicts.

- [x] **Step 4: Write `pytest.ini`**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short
```

- [x] **Step 5: Write `tests/conftest.py`**

```python
"""Shared pytest fixtures for videoad skill tests."""
from pathlib import Path
import pytest


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir():
    return FIXTURES


@pytest.fixture
def tmp_offers_dir(tmp_path, monkeypatch):
    offers = tmp_path / "offers"
    offers.mkdir()
    monkeypatch.setenv("VIDEOAD_OFFERS_DIR", str(offers))
    return offers


@pytest.fixture
def tmp_videos_dir(tmp_path, monkeypatch):
    videos = tmp_path / "videos"
    videos.mkdir()
    monkeypatch.setenv("VIDEOAD_VIDEOS_DIR", str(videos))
    return videos
```

- [x] **Step 6: Create fixture files**

Write `tests/fixtures/sample_offer.md`:

```markdown
---
slug: test-offer
name: Test Product
price: $19.99
target: Test demographic
language: en
---

# Test Product

## Primary angle
A test angle for unit-testing the offer loader.

## USPs (3)
1. First USP
2. Second USP
3. Third USP

## Proven hooks (5-8)
- Hook one
- Hook two
- Hook three
- Hook four
- Hook five

## Mechanism (the "because")
The mechanism explanation.

## Banned claims
- No cure claims
```

Write `tests/fixtures/sample_offer_invalid.md`:

```markdown
---
slug: broken
name: Broken Offer
target: someone
---

# Broken Offer

## Primary angle
Only one section — missing USPs, hooks, mechanism, banned claims.
```

Generate `tests/fixtures/sample_input.mp4` via ffmpeg:

```bash
ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=30 \
       -f lavfi -i sine=frequency=1000:duration=2 \
       -c:v libx264 -c:a aac -shortest \
       ~/.claude/skills/videoad/tests/fixtures/sample_input.mp4
```

Expected: 2-second test video created (~100KB).

- [x] **Step 7: Sanity-check pytest runs**

Run:
```bash
cd ~/.claude/skills/videoad
source venv/bin/activate
pytest
```

Expected: `no tests ran in ...s` (no tests yet, but pytest discovers the dir correctly).

- [x] **Step 8: Update this plan — mark Task 1 checkboxes complete, commit and push**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "$(cat <<'EOF'
feat(videoad): task 1 — scaffold skill dir, venv, deps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 2: `model_catalog.py` — Fal model list, routing, cost lookup

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_model_catalog.py`
- Create: `~/.claude/skills/videoad/lib/model_catalog.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_model_catalog.py`

```python
from lib.model_catalog import (
    CATALOG,
    estimate_cost,
    route,
    list_models,
    get_model,
)


def test_catalog_has_required_models():
    required = {
        "fal-ai/kling-video/v2.1-master/text-to-video",
        "fal-ai/kling-video/v2.1/image-to-video",
        "fal-ai/minimax/hailuo-02/standard",
        "fal-ai/veo/3.1",
    }
    assert required.issubset({m["id"] for m in CATALOG})


def test_every_entry_has_required_fields():
    for m in CATALOG:
        assert {"id", "category", "input_type", "default_duration_s",
                "est_cost_usd", "notes"}.issubset(m.keys())


def test_get_model_returns_entry():
    m = get_model("fal-ai/minimax/hailuo-02/standard")
    assert m["id"] == "fal-ai/minimax/hailuo-02/standard"
    assert m["est_cost_usd"] < 1.0


def test_get_model_unknown_returns_none():
    assert get_model("fake/model/v1") is None


def test_estimate_cost_known_model():
    cost = estimate_cost("fal-ai/minimax/hailuo-02/standard", duration_s=6)
    assert 0.2 < cost < 0.5


def test_estimate_cost_unknown_model_returns_none():
    assert estimate_cost("fake/model/v1", duration_s=5) is None


def test_route_talking_head_to_kling_master():
    hint = {"content_type": "talking_head", "has_image": False}
    assert route(hint) == "fal-ai/kling-video/v2.1-master/text-to-video"


def test_route_product_with_image_to_kling_i2v():
    hint = {"content_type": "product", "has_image": True}
    assert route(hint) == "fal-ai/kling-video/v2.1/image-to-video"


def test_route_fast_flag_to_minimax():
    hint = {"content_type": "any", "fast": True}
    assert route(hint) == "fal-ai/minimax/hailuo-02/standard"


def test_route_premium_flag_to_veo():
    hint = {"content_type": "any", "premium": True}
    assert route(hint) == "fal-ai/veo/3.1"


def test_list_models_returns_rows():
    rows = list_models()
    assert len(rows) >= 5
    assert all("id" in r for r in rows)
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd ~/.claude/skills/videoad
source venv/bin/activate
pytest tests/test_model_catalog.py -v
```

Expected: ImportError — `lib.model_catalog` doesn't exist yet.

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/model_catalog.py`

```python
"""Curated Fal.ai video-model catalog and routing rules.

Cost estimates are indicative; Fal bills based on actual GPU time. Refresh
periodically against https://fal.ai/pricing.
"""
from __future__ import annotations
from typing import Optional

CATALOG = [
    {
        "id": "fal-ai/kling-video/v2.1-master/text-to-video",
        "category": "ugc_human",
        "input_type": "text",
        "default_duration_s": 5,
        "est_cost_usd": 1.40,
        "notes": "Best human realism; talking-head UGC default",
    },
    {
        "id": "fal-ai/kling-video/v2.1/image-to-video",
        "category": "product_i2v",
        "input_type": "image+text",
        "default_duration_s": 5,
        "est_cost_usd": 0.95,
        "notes": "Animate a product still",
    },
    {
        "id": "fal-ai/kling-video/v2.1-master/image-to-video",
        "category": "product_i2v_premium",
        "input_type": "image+text",
        "default_duration_s": 5,
        "est_cost_usd": 2.00,
        "notes": "Higher-fidelity I2V",
    },
    {
        "id": "fal-ai/minimax/hailuo-02/standard",
        "category": "fast",
        "input_type": "text",
        "default_duration_s": 6,
        "est_cost_usd": 0.28,
        "notes": "Cheap iteration workhorse",
    },
    {
        "id": "fal-ai/minimax/hailuo-02/pro",
        "category": "balanced",
        "input_type": "text",
        "default_duration_s": 6,
        "est_cost_usd": 0.48,
        "notes": "Better than standard for ~2x cost",
    },
    {
        "id": "fal-ai/veo/3.1",
        "category": "premium_audio",
        "input_type": "text",
        "default_duration_s": 8,
        "est_cost_usd": 6.00,
        "notes": "Native audio track; highest quality",
    },
    {
        "id": "fal-ai/runway-gen4",
        "category": "cinematic",
        "input_type": "text_or_image",
        "default_duration_s": 5,
        "est_cost_usd": 2.25,
        "notes": "Strong B-roll",
    },
    {
        "id": "fal-ai/luma-dream-machine",
        "category": "creative_i2v",
        "input_type": "text_or_image",
        "default_duration_s": 5,
        "est_cost_usd": 1.00,
        "notes": "Artsy, good I2V",
    },
    {
        "id": "fal-ai/bytedance/seedance-pro",
        "category": "new_cinematic",
        "input_type": "text_or_image",
        "default_duration_s": 5,
        "est_cost_usd": 0.80,
        "notes": "Competitive newcomer",
    },
]


def list_models() -> list[dict]:
    """Return the full catalog (copy so callers can't mutate)."""
    return [dict(m) for m in CATALOG]


def get_model(model_id: str) -> Optional[dict]:
    """Return catalog entry by id, or None if unknown."""
    return next((dict(m) for m in CATALOG if m["id"] == model_id), None)


def estimate_cost(model_id: str, duration_s: int) -> Optional[float]:
    """Proportional cost estimate for a given duration. Returns None for unknown models."""
    m = get_model(model_id)
    if m is None:
        return None
    return round(m["est_cost_usd"] * (duration_s / m["default_duration_s"]), 2)


def route(hint: dict) -> str:
    """
    Select a default model from a hint dict.

    Hint keys (any optional):
      - fast: bool        → force minimax/standard
      - premium: bool     → force veo/3.1
      - content_type: str → "talking_head" | "product" | anything else
      - has_image: bool   → whether a source image is available
    """
    if hint.get("fast"):
        return "fal-ai/minimax/hailuo-02/standard"
    if hint.get("premium"):
        return "fal-ai/veo/3.1"
    ct = hint.get("content_type")
    if ct == "talking_head":
        return "fal-ai/kling-video/v2.1-master/text-to-video"
    if ct == "product" and hint.get("has_image"):
        return "fal-ai/kling-video/v2.1/image-to-video"
    # Default fallback: cheap iteration
    return "fal-ai/minimax/hailuo-02/standard"
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd ~/.claude/skills/videoad
source venv/bin/activate
pytest tests/test_model_catalog.py -v
```

Expected: 11 passed.

- [x] **Step 5: Check checkboxes, commit plan update**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "$(cat <<'EOF'
feat(videoad): task 2 — model catalog + routing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 3: `offer_loader.py` — parse + validate offer briefs

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_offer_loader.py`
- Create: `~/.claude/skills/videoad/lib/offer_loader.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_offer_loader.py`

```python
from pathlib import Path
import pytest
from lib.offer_loader import load_offer, list_offers, OfferValidationError


def test_load_valid_offer(fixtures_dir, monkeypatch, tmp_path):
    target = tmp_path / "offers"
    target.mkdir()
    (target / "test-offer.md").write_text((fixtures_dir / "sample_offer.md").read_text())
    monkeypatch.setenv("VIDEOAD_OFFERS_DIR", str(target))

    offer = load_offer("test-offer")
    assert offer["slug"] == "test-offer"
    assert offer["name"] == "Test Product"
    assert offer["price"] == "$19.99"
    assert "Primary angle" in offer["sections"]
    assert "USPs (3)" in offer["sections"]
    assert "Proven hooks (5-8)" in offer["sections"]


def test_missing_offer_raises(tmp_offers_dir):
    with pytest.raises(FileNotFoundError) as exc:
        load_offer("does-not-exist")
    assert "does-not-exist" in str(exc.value)


def test_offer_missing_required_sections_raises(fixtures_dir, monkeypatch, tmp_path):
    target = tmp_path / "offers"
    target.mkdir()
    (target / "broken.md").write_text((fixtures_dir / "sample_offer_invalid.md").read_text())
    monkeypatch.setenv("VIDEOAD_OFFERS_DIR", str(target))

    with pytest.raises(OfferValidationError) as exc:
        load_offer("broken")
    msg = str(exc.value)
    assert "USPs" in msg or "Mechanism" in msg


def test_list_offers(fixtures_dir, monkeypatch, tmp_path):
    target = tmp_path / "offers"
    target.mkdir()
    (target / "one.md").write_text((fixtures_dir / "sample_offer.md").read_text())
    (target / "two.md").write_text((fixtures_dir / "sample_offer.md").read_text())
    monkeypatch.setenv("VIDEOAD_OFFERS_DIR", str(target))
    slugs = list_offers()
    assert set(slugs) == {"one", "two"}


def test_offer_frontmatter_missing_required_raises(tmp_path, monkeypatch):
    target = tmp_path / "offers"
    target.mkdir()
    (target / "noname.md").write_text("---\nslug: noname\n---\n# No Name\n")
    monkeypatch.setenv("VIDEOAD_OFFERS_DIR", str(target))
    with pytest.raises(OfferValidationError) as exc:
        load_offer("noname")
    assert "name" in str(exc.value).lower() or "target" in str(exc.value).lower()
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_offer_loader.py -v
```

Expected: ImportError.

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/offer_loader.py`

```python
"""Load + validate offer briefs from ~/.claude/offers/<slug>.md."""
from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Any
import frontmatter


REQUIRED_FRONTMATTER = ["slug", "name", "target"]
REQUIRED_SECTIONS = [
    "Primary angle",
    "USPs (3)",
    "Proven hooks (5-8)",
    "Mechanism",  # matches "Mechanism (the "because")" or variants
    "Banned claims",
]


class OfferValidationError(ValueError):
    """Raised when an offer file is missing required frontmatter or sections."""


def _offers_dir() -> Path:
    override = os.environ.get("VIDEOAD_OFFERS_DIR")
    if override:
        return Path(override)
    return Path.home() / ".claude" / "offers"


def _split_sections(body: str) -> dict[str, str]:
    """Return {heading_text: section_body} for every `## ` heading."""
    sections: dict[str, str] = {}
    current_heading: str | None = None
    current_lines: list[str] = []
    for line in body.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if current_heading is not None:
                sections[current_heading] = "\n".join(current_lines).strip()
            current_heading = m.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_heading is not None:
        sections[current_heading] = "\n".join(current_lines).strip()
    return sections


def list_offers() -> list[str]:
    d = _offers_dir()
    if not d.exists():
        return []
    return sorted(p.stem for p in d.glob("*.md"))


def load_offer(slug: str) -> dict[str, Any]:
    """Load and validate ~/.claude/offers/<slug>.md. Returns dict with frontmatter + sections."""
    path = _offers_dir() / f"{slug}.md"
    if not path.exists():
        available = ", ".join(list_offers()) or "(none)"
        raise FileNotFoundError(
            f"Offer '{slug}' not found at {path}. Available: {available}"
        )

    post = frontmatter.load(path)
    meta = dict(post.metadata)
    missing_fm = [k for k in REQUIRED_FRONTMATTER if k not in meta]
    if missing_fm:
        raise OfferValidationError(
            f"{path}: missing frontmatter fields: {', '.join(missing_fm)}"
        )

    sections = _split_sections(post.content)

    missing_sections = []
    for req in REQUIRED_SECTIONS:
        if not any(req.lower() in h.lower() for h in sections):
            missing_sections.append(req)
    if missing_sections:
        raise OfferValidationError(
            f"{path}: missing required sections: {', '.join(missing_sections)}"
        )

    return {
        "path": str(path),
        "slug": meta["slug"],
        "name": meta["name"],
        "target": meta["target"],
        "price": meta.get("price"),
        "language": meta.get("language", "en"),
        "landing_url": meta.get("landing_url"),
        "product_shots": meta.get("product_shots", []),
        "sections": sections,
        "raw": post.content,
    }
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_offer_loader.py -v
```

Expected: 5 passed.

- [x] **Step 5: Smoke-check against a real offer**

```bash
cd ~/.claude/skills/videoad
source venv/bin/activate
python -c "from lib.offer_loader import load_offer; o = load_offer('akemi-slim-patch'); print(o['name'], '|', list(o['sections'].keys())[:3])"
```

Expected: `Akemi Slim Patch | ['Primary angle', 'USPs (3)', 'Proven hooks (5-8)']`

- [x] **Step 6: Check checkboxes, commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 3 — offer loader + validator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: `cost_tracker.py` — jsonl append + stats

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_cost_tracker.py`
- Create: `~/.claude/skills/videoad/lib/cost_tracker.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_cost_tracker.py`

```python
from lib.cost_tracker import append_run, stats


def test_append_creates_and_appends(tmp_offers_dir):
    append_run("my-offer", {
        "run_id": "abc",
        "model": "fal-ai/minimax/hailuo-02/standard",
        "cost_usd": 0.28,
        "duration_s": 6,
        "status": "completed",
        "competitor_source": "https://x",
        "output_path": "/tmp/out.mp4",
    })
    append_run("my-offer", {
        "run_id": "def",
        "model": "fal-ai/kling-video/v2.1-master/text-to-video",
        "cost_usd": 1.40,
        "duration_s": 5,
        "status": "completed",
        "competitor_source": "https://y",
        "output_path": "/tmp/out2.mp4",
    })
    log = tmp_offers_dir / "my-offer.jsonl"
    assert log.exists()
    assert len(log.read_text().strip().splitlines()) == 2


def test_stats_summary(tmp_offers_dir):
    for i, cost in enumerate([0.28, 1.40, 0.48]):
        append_run("my-offer", {
            "run_id": f"r{i}", "model": "m", "cost_usd": cost,
            "duration_s": 5, "status": "completed",
            "competitor_source": "x", "output_path": "/tmp/x",
        })
    s = stats("my-offer")
    assert s["runs"] == 3
    assert s["successful"] == 3
    assert abs(s["total_usd"] - 2.16) < 0.01
    assert abs(s["avg_usd"] - 0.72) < 0.01


def test_stats_filters_failed(tmp_offers_dir):
    append_run("my-offer", {
        "run_id": "a", "model": "m", "cost_usd": 0.0,
        "duration_s": 0, "status": "failed",
        "competitor_source": "x", "output_path": None,
    })
    append_run("my-offer", {
        "run_id": "b", "model": "m", "cost_usd": 0.50,
        "duration_s": 5, "status": "completed",
        "competitor_source": "x", "output_path": "/tmp/x",
    })
    s = stats("my-offer")
    assert s["runs"] == 2
    assert s["successful"] == 1
    assert abs(s["total_usd"] - 0.50) < 0.01


def test_stats_empty_offer_returns_zeros(tmp_offers_dir):
    s = stats("unknown-offer")
    assert s == {"runs": 0, "successful": 0, "total_usd": 0.0, "avg_usd": 0.0, "last_runs": []}


def test_stats_returns_last_runs(tmp_offers_dir):
    for i in range(15):
        append_run("my-offer", {
            "run_id": f"r{i}", "model": "m", "cost_usd": 0.10,
            "duration_s": 5, "status": "completed",
            "competitor_source": "x", "output_path": "/tmp/x",
        })
    s = stats("my-offer")
    assert len(s["last_runs"]) == 10
    assert s["last_runs"][-1]["run_id"] == "r14"
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cost_tracker.py -v
```

Expected: ImportError.

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/cost_tracker.py`

```python
"""Append-only jsonl per offer: ~/.claude/offers/<slug>.jsonl"""
from __future__ import annotations
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _offers_dir() -> Path:
    override = os.environ.get("VIDEOAD_OFFERS_DIR")
    if override:
        return Path(override)
    return Path.home() / ".claude" / "offers"


def _log_path(slug: str) -> Path:
    return _offers_dir() / f"{slug}.jsonl"


def append_run(slug: str, run: dict[str, Any]) -> None:
    """Append one run entry. Auto-adds `ts` if missing."""
    entry = dict(run)
    entry.setdefault("ts", datetime.now(timezone.utc).isoformat())
    entry["offer"] = slug
    _log_path(slug).parent.mkdir(parents=True, exist_ok=True)
    with _log_path(slug).open("a") as f:
        f.write(json.dumps(entry) + "\n")


def _load_runs(slug: str) -> list[dict]:
    path = _log_path(slug)
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def stats(slug: str) -> dict[str, Any]:
    """Summary: runs, successful, total_usd, avg_usd, last_runs (up to 10)."""
    runs = _load_runs(slug)
    if not runs:
        return {"runs": 0, "successful": 0, "total_usd": 0.0, "avg_usd": 0.0, "last_runs": []}
    successful = [r for r in runs if r.get("status") == "completed"]
    total = sum(float(r.get("cost_usd") or 0) for r in successful)
    avg = total / len(successful) if successful else 0.0
    return {
        "runs": len(runs),
        "successful": len(successful),
        "total_usd": round(total, 2),
        "avg_usd": round(avg, 2),
        "last_runs": runs[-10:],
    }
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cost_tracker.py -v
```

Expected: 5 passed.

- [x] **Step 5: Commit plan update**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 4 — cost tracker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: `run_dir.py` — run directory lifecycle

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_run_dir.py`
- Create: `~/.claude/skills/videoad/lib/run_dir.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_run_dir.py`

```python
from pathlib import Path
import pytest
from lib.run_dir import create_run_dir, find_run_dir, completed_stages, STAGES


def test_create_run_dir_creates_subdirs(tmp_videos_dir):
    rd = create_run_dir("akemi-slim-patch")
    assert rd.exists()
    assert (rd / "00-input").exists()
    assert (rd / "04-generation").exists()
    assert str(tmp_videos_dir) in str(rd)
    assert "akemi-slim-patch" in str(rd)


def test_run_id_is_unique(tmp_videos_dir):
    a = create_run_dir("x")
    b = create_run_dir("x")
    assert a != b


def test_find_run_dir_by_partial_id(tmp_videos_dir):
    rd = create_run_dir("x")
    run_id = rd.name.split("-")[-1]
    found = find_run_dir("x", run_id)
    assert found == rd


def test_find_run_dir_missing_returns_none(tmp_videos_dir):
    assert find_run_dir("x", "zzzz") is None


def test_completed_stages_detects_fetched_input(tmp_videos_dir):
    rd = create_run_dir("x")
    (rd / "00-input" / "source.mp4").write_bytes(b"fake")
    (rd / "00-input" / "metadata.json").write_text("{}")
    assert "input" in completed_stages(rd)


def test_completed_stages_detects_teardown(tmp_videos_dir):
    rd = create_run_dir("x")
    (rd / "01-teardown.md").write_text("teardown")
    assert "teardown" in completed_stages(rd)


def test_completed_stages_order_matches_stages_const(tmp_videos_dir):
    rd = create_run_dir("x")
    (rd / "00-input" / "source.mp4").write_bytes(b"fake")
    (rd / "00-input" / "metadata.json").write_text("{}")
    (rd / "01-teardown.md").write_text("teardown")
    (rd / "02-concept.md").write_text("concept")
    (rd / "03-script.json").write_text("{}")
    done = completed_stages(rd)
    assert done == ["input", "teardown", "concept", "script"]
    assert STAGES == ["input", "teardown", "concept", "script", "generation"]
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_run_dir.py -v
```

Expected: ImportError.

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/run_dir.py`

```python
"""Per-run artifact directories under ~/videos/<offer-slug>/."""
from __future__ import annotations
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Optional


STAGES = ["input", "teardown", "concept", "script", "generation"]


def _videos_dir() -> Path:
    override = os.environ.get("VIDEOAD_VIDEOS_DIR")
    if override:
        return Path(override)
    return Path.home() / "videos"


def _gen_run_id() -> str:
    return secrets.token_hex(3)  # 6 hex chars


def create_run_dir(offer_slug: str) -> Path:
    """Create a new run directory and all expected subfolders."""
    ts = datetime.now().strftime("%Y-%m-%d-%H%M")
    run_id = _gen_run_id()
    rd = _videos_dir() / offer_slug / f"{ts}-{run_id}"
    (rd / "00-input").mkdir(parents=True, exist_ok=True)
    (rd / "04-generation").mkdir(parents=True, exist_ok=True)
    return rd


def find_run_dir(offer_slug: str, partial_id: str) -> Optional[Path]:
    """Find a run dir by partial run_id match. Returns newest match or None."""
    base = _videos_dir() / offer_slug
    if not base.exists():
        return None
    matches = sorted(
        [p for p in base.iterdir() if p.is_dir() and p.name.endswith(f"-{partial_id}")],
        reverse=True,
    )
    return matches[0] if matches else None


def completed_stages(run_dir: Path) -> list[str]:
    """Return the list of completed stages in pipeline order."""
    done: list[str] = []
    if (run_dir / "00-input" / "source.mp4").exists() and (run_dir / "00-input" / "metadata.json").exists():
        done.append("input")
    if (run_dir / "01-teardown.md").exists():
        done.append("teardown")
    if (run_dir / "02-concept.md").exists():
        done.append("concept")
    if (run_dir / "03-script.json").exists():
        done.append("script")
    if (run_dir / "04-generation" / "out.mp4").exists():
        done.append("generation")
    return done
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_run_dir.py -v
```

Expected: 7 passed.

- [x] **Step 5: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 5 — run dir lifecycle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: `input_fetcher.py` — URL/file → local .mp4

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_input_fetcher.py`
- Create: `~/.claude/skills/videoad/lib/input_fetcher.py`

External tool requirement: `yt-dlp` and `ffprobe` must be on `$PATH`. Tests mock the shell calls.

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_input_fetcher.py`

```python
import json
import shutil
from pathlib import Path
import pytest
from lib.input_fetcher import fetch, detect_handler, InputFetchError


def test_detect_handler_local_file(tmp_path):
    f = tmp_path / "a.mp4"
    f.write_bytes(b"x")
    assert detect_handler(str(f)) == "local"


def test_detect_handler_youtube():
    assert detect_handler("https://www.youtube.com/watch?v=abc") == "yt-dlp"
    assert detect_handler("https://youtu.be/abc") == "yt-dlp"


def test_detect_handler_tiktok():
    assert detect_handler("https://www.tiktok.com/@x/video/123") == "yt-dlp"


def test_detect_handler_twitter():
    assert detect_handler("https://twitter.com/x/status/1") == "yt-dlp"
    assert detect_handler("https://x.com/u/status/1") == "yt-dlp"


def test_detect_handler_fb_ad_library():
    url = "https://www.facebook.com/ads/library/?id=12345"
    assert detect_handler(url) == "fb-ad-library"


def test_detect_handler_direct_mp4():
    assert detect_handler("https://cdn.example.com/clip.mp4") == "direct"


def test_fetch_local_file_copies_to_run_dir(tmp_path, fixtures_dir):
    run_input = tmp_path / "00-input"
    run_input.mkdir()
    src = fixtures_dir / "sample_input.mp4"
    result = fetch(str(src), run_input)
    dest = run_input / "source.mp4"
    assert dest.exists()
    meta = json.loads((run_input / "metadata.json").read_text())
    assert meta["source"] == str(src)
    assert meta["handler"] == "local"
    assert meta["duration_s"] >= 1


def test_fetch_unknown_handler_raises(tmp_path):
    run_input = tmp_path / "00-input"
    run_input.mkdir()
    with pytest.raises(InputFetchError):
        fetch("not a url or path", run_input)


def test_fetch_yt_dlp_calls_subprocess(tmp_path, mocker, fixtures_dir):
    run_input = tmp_path / "00-input"
    run_input.mkdir()
    # Pre-place a file where yt-dlp would write
    (run_input / "source.mp4").write_bytes((fixtures_dir / "sample_input.mp4").read_bytes())
    mocker.patch("lib.input_fetcher.subprocess.run", return_value=mocker.Mock(returncode=0, stdout="", stderr=""))
    meta = fetch("https://www.youtube.com/watch?v=abc", run_input)
    assert meta["handler"] == "yt-dlp"
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_input_fetcher.py -v
```

Expected: ImportError.

- [x] **Step 3: Verify `yt-dlp` and `ffprobe` installed**

```bash
command -v yt-dlp || echo "INSTALL: pip install yt-dlp"
command -v ffprobe || echo "INSTALL: sudo apt install ffmpeg"
```

Expected: both print paths. If not, install before continuing.

- [x] **Step 4: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/input_fetcher.py`

```python
"""Normalize any input (URL or local path) to <run_dir>/00-input/source.mp4."""
from __future__ import annotations
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
import httpx


class InputFetchError(RuntimeError):
    pass


YT_DLP_HOSTS = (
    "youtube.com", "youtu.be", "tiktok.com",
    "twitter.com", "x.com", "instagram.com",
    "vimeo.com", "reddit.com",
)


def detect_handler(source: str) -> str:
    """Decide which handler to use for a given source string."""
    if Path(source).expanduser().exists():
        return "local"
    if not source.startswith(("http://", "https://")):
        raise InputFetchError(f"Not a URL or existing file: {source}")
    low = source.lower()
    if "facebook.com/ads/library" in low:
        return "fb-ad-library"
    for host in YT_DLP_HOSTS:
        if host in low:
            return "yt-dlp"
    if low.split("?")[0].endswith((".mp4", ".mov", ".webm", ".m4v")):
        return "direct"
    # Fallback: try yt-dlp
    return "yt-dlp"


def _probe_duration(path: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except (subprocess.CalledProcessError, ValueError):
        return 0.0


def _fetch_local(source: str, out_dir: Path) -> dict[str, Any]:
    src = Path(source).expanduser().resolve()
    dest = out_dir / "source.mp4"
    shutil.copy2(src, dest)
    return {"handler": "local", "source": str(src)}


def _fetch_yt_dlp(source: str, out_dir: Path) -> dict[str, Any]:
    dest = out_dir / "source.mp4"
    cmd = [
        "yt-dlp", "-f", "mp4/best",
        "-o", str(dest), source,
        "--no-playlist", "--quiet",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not dest.exists():
        raise InputFetchError(f"yt-dlp failed: {res.stderr.strip()[:300]}")
    return {"handler": "yt-dlp", "source": source}


def _fetch_direct(source: str, out_dir: Path) -> dict[str, Any]:
    dest = out_dir / "source.mp4"
    with httpx.stream("GET", source, follow_redirects=True, timeout=60) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return {"handler": "direct", "source": source}


def _fetch_fb_ad_library(source: str, out_dir: Path) -> dict[str, Any]:
    """Try yt-dlp first (supports FB), fall back to error with guidance."""
    try:
        return _fetch_yt_dlp(source, out_dir) | {"handler": "fb-ad-library"}
    except InputFetchError as e:
        raise InputFetchError(
            f"FB Ad Library fetch failed: {e}. Try downloading manually "
            f"and pass the local file path."
        )


def fetch(source: str, out_dir: Path) -> dict[str, Any]:
    """Fetch `source` into `out_dir/source.mp4`. Writes metadata.json. Returns metadata dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    handler = detect_handler(source)
    handlers = {
        "local": _fetch_local,
        "yt-dlp": _fetch_yt_dlp,
        "direct": _fetch_direct,
        "fb-ad-library": _fetch_fb_ad_library,
    }
    meta = handlers[handler](source, out_dir)
    dest = out_dir / "source.mp4"
    meta["duration_s"] = _probe_duration(dest)
    meta["size_bytes"] = dest.stat().st_size
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2))
    return meta
```

- [x] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_input_fetcher.py -v
```

Expected: 9 passed.

- [x] **Step 6: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 6 — input fetcher (yt-dlp, direct, local, fb-al)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 6a: Shared DR principles prompt partial

> **Rationale (user mandate, `feedback_videoad_script_quality.md`):** Scripts must convert on Day 1 using classic affiliate / direct-response principles (Halbert, Schwartz, Ogilvy) — never brand-building. Waste of Fal credit on a weak script is the #1 risk. Ground every LLM stage in the same DR playbook the user already validated in `backend/app/api/v1/video_analysis.py`.

**Files:**
- Create: `~/.claude/skills/videoad/prompts/_dr_principles.md`

- [x] **Step 1: Write the partial**

File: `~/.claude/skills/videoad/prompts/_dr_principles.md`

```markdown
# DR Principles (shared prompt partial)

You are an elite direct-response / affiliate-marketing copywriter in the lineage of Gary Halbert, Eugene Schwartz, and David Ogilvy. The ad being produced must be profitable on Day 1, on cold traffic. Brand-building, awareness, "premium feel" are failures — conversion is the only metric that matters.

## The 7 Laws of Direct Response (apply ≥2 in every hook and CTA)

- **LAW 1 — OPEN LOOP:** Create cognitive tension the reader MUST resolve. An incomplete idea, a contradiction, a missing piece.
- **LAW 2 — PAIN AMPLIFICATION:** Name the wound before you offer the bandage. People click for RELIEF, not desire.
- **LAW 3 — MECHANISM FRAMING:** Promise a result they've never heard said THIS way before. Unique + Valuable + Believable.
- **LAW 4 — SPECIFICITY:** Vague slides off the brain. Unusual numbers, exact timeframes, concrete details.
- **LAW 5 — SIMPLICITY:** If the reader has to think, you lose. Short words, linear structure.
- **LAW 6 — CREDIBILITY:** Neutralize skepticism with authority references, data, real-world results.
- **LAW 7 — TIME COMPRESSION:** Shorter timeframe = stronger desire. "24 hours", "one week", "in minutes".

## 10 Headline / Hook Formulas (use a DIFFERENT one per variant)

1. OPEN LOOP MYSTERY — "The [detail] your doctor won't mention" / "Why [authority] hate this [$X] trick"
2. PAIN MIRROR — "Still [doing thing] but [problem won't stop]? Here's why"
3. MECHANISM REVEAL — "The [unusual ingredient/method] behind [specific result]"
4. TIME-COMPRESSED PROMISE — "How to [result] in [short timeframe]"
5. AUTHORITY PROOF — "Top Doctor: [instruction]" / "[Number] [people] now rely on this"
6. STORY/CONFESSION — "I [suffered X years] until I found [this]"
7. FEAR/CONTRARIAN — "Stop [common action] immediately" / "This 'healthy' [thing] actually [bad consequence]"
8. FORBIDDEN INSIDER — "[Industry] hates this [$X] fix"
9. TRANSFORMATION SNAPSHOT — "Man who [pain state] — now [result] every day!"
10. CALL-OUT + QUESTION — "Do you [symptom]?" / "Too much [problem]? [Simple action] every [time]"

## Proven winners (study the structure, adapt to the offer)

- "Too Much Belly Fat? Drink This Every Morning" (call-out + mechanism + time compression)
- "Top Doctor: This is the Fastest Way to End Neuropathy For Good" (authority + specificity + finality)
- "My Feet Were Burning & Tingling Until I Discovered This" (pain + mechanism + curiosity)
- "Man Who Limped With Neuropathy Pain — Now Runs 2 Miles Every Day!" (transformation snapshot)
- "Best Way to Heat Your Home In Under 60 Seconds" (simplicity + time compression)
- "This $39 Device Is Taking USA By Storm!" (specificity + social proof + curiosity)
- "When Doctors Feel Rotten, This Is What They Do" (authority + open loop)

## DR copywriting rules (every script must follow)

- Open with an EMOTIONALLY CHARGED pattern interrupt in the first 1.5 seconds — fear, pain, frustration, bold controversial claim
- Name the wound FIRST, HARD, before any solution
- AGITATE the pain — twist the knife, describe the status quo getting worse
- Reveal mechanism/solution as a DISCOVERY or SECRET, never "our product"
- One framework per variant: PAS (Problem-Agitate-Solve), AIDA, or Before-After-Bridge
- Stack benefits AND handle objections ("Without surgery", "Without prescription", "Without changing your diet")
- Specific claims, numbers, testimonial fragments — specificity = believability
- Urgency lever in CTA: limited time / limited stock / "before it's gone"
- CTA is NEVER "Learn more" — use "Tap the link to see how it works", "Get yours before…"
- Write like a TOP AFFILIATE MARKETER who needs to be profitable from day one

## Tone (the sweet spot)

- NOT corporate. NOT Gen-Z chatty. Emotionally HARD-HITTING but sounds like a real human wrote it — Halbert intensity, plain spoken language a 55-year-old would use.
- Contractions (don't, won't, can't). No "do not".
- One idea per line. Short punchy sentences. Line breaks between thoughts.
- Vary sentence length — mix 3-word punches with 10-word lines.
- No young slang ("kinda", "lowkey", "no cap", "vibe").
- EMOTIONAL WEIGHT WORDS that hit hard for 55+ demographic: "suffering", "struggling", "desperate", "finally", "relief", "breakthrough", "nothing worked", "doctors couldn't help", "I was ready to give up", "changed everything"
- Start some sentences with "And" or "But". Real copy has rhythm.
- NEVER use ellipses (...).
- BANNED AI clichés: "unlock", "revolutionize", "game-changer", "discover the power", "transform your", "journey", "elevate", "unleash", "harness", "dive into", "it's time to", "say goodbye to".

## Compliance guardrails (generic — offer-specific ones come from the offer brief)

- "may help" instead of "will cure/fix/eliminate"
- "supports" instead of "treats"
- "many people report" instead of "you will experience"
- No calling out personal attributes — say "stubborn belly fat" not "your belly fat"
- No income / get-rich claims
- Imply transformation through story; never promise specific outcomes
```

- [x] **Step 2: Commit plan update**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 6a — shared DR principles prompt partial

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 6b: `prompt_loader.py` — shared prompt loader with partial substitution

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_prompt_loader.py`
- Create: `~/.claude/skills/videoad/lib/prompt_loader.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_prompt_loader.py`

```python
import pytest
from lib.prompt_loader import load_prompt, PromptError


def test_load_plain_prompt(tmp_path, monkeypatch):
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    (prompts / "example.md").write_text("Hello world")
    monkeypatch.setattr("lib.prompt_loader.PROMPTS_DIR", prompts)
    assert load_prompt("example") == "Hello world"


def test_substitute_dr_principles(tmp_path, monkeypatch):
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    (prompts / "_dr_principles.md").write_text("DR CONTENT")
    (prompts / "example.md").write_text("Intro\n{{DR_PRINCIPLES}}\nOutro")
    monkeypatch.setattr("lib.prompt_loader.PROMPTS_DIR", prompts)
    assert load_prompt("example") == "Intro\nDR CONTENT\nOutro"


def test_substitute_named_vars(tmp_path, monkeypatch):
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    (prompts / "t.md").write_text("a={a} b={b}")
    monkeypatch.setattr("lib.prompt_loader.PROMPTS_DIR", prompts)
    assert load_prompt("t", vars={"a": "1", "b": "2"}) == "a=1 b=2"


def test_missing_prompt_raises(tmp_path, monkeypatch):
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    monkeypatch.setattr("lib.prompt_loader.PROMPTS_DIR", prompts)
    with pytest.raises(PromptError):
        load_prompt("nope")
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_prompt_loader.py -v
```

Expected: ImportError.

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/prompt_loader.py`

```python
"""Load prompt templates with optional {{DR_PRINCIPLES}} and {var} substitution."""
from __future__ import annotations
from pathlib import Path
from typing import Optional


PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class PromptError(FileNotFoundError):
    pass


def load_prompt(name: str, vars: Optional[dict] = None) -> str:
    """Read `<name>.md` from the prompts dir. Substitutes:
      - {{DR_PRINCIPLES}} with contents of _dr_principles.md
      - {key} with vars[key] for each key in `vars`
    """
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise PromptError(f"Prompt not found: {path}")
    body = path.read_text()

    if "{{DR_PRINCIPLES}}" in body:
        dr_path = PROMPTS_DIR / "_dr_principles.md"
        dr_body = dr_path.read_text() if dr_path.exists() else ""
        body = body.replace("{{DR_PRINCIPLES}}", dr_body)

    if vars:
        for k, v in vars.items():
            body = body.replace("{" + k + "}", v)
    return body
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_prompt_loader.py -v
```

Expected: 4 passed.

- [x] **Step 5: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 6b — prompt loader with partial substitution

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: `teardown.py` + prompt — Gemini video analysis

**Files:**
- Create: `~/.claude/skills/videoad/prompts/teardown.md`
- Create: `~/.claude/skills/videoad/tests/test_teardown.py`
- Create: `~/.claude/skills/videoad/lib/teardown.py`

Requires `GEMINI_API_KEY` env var. Test mocks Gemini.

- [x] **Step 1: Write the teardown prompt**

File: `~/.claude/skills/videoad/prompts/teardown.md`

```markdown
{{DR_PRINCIPLES}}

---

You are doing reverse-engineering on a competitor's Facebook/Instagram video ad. Analyze the video below through the DR lens above and produce a structured teardown an affiliate marketer can use to recreate its converting structure for a different offer.

Return ONLY valid markdown matching this exact outline. Fill every section with specific observations from the video — not generic advice. Name which of the 7 DR Laws and which of the 10 formulas the video uses, verbatim.

# Teardown

## Hook (0-3s)
- **Verbatim spoken words:** (exact transcript of the first 3 seconds)
- **Visual:** (what is on screen — describe the frame, facial expression, setting)
- **Why it works:** (the psychological trigger — pattern interrupt, pain mirror, open loop, etc.)

## Pacing beat map
| Time | What happens | Function |
|---|---|---|
| 0-3s | | hook |
| 3-8s | | pain agitation / problem framing |
| 8-15s | | mechanism / reason-why |
| 15-30s | | proof / social evidence |
| CTA | | close |

Adjust row count to match actual video structure.

## Visual style
- **Format:** UGC / produced / mixed
- **Aspect ratio:** 9:16 / 1:1 / 16:9
- **Lighting:** natural / studio / mixed
- **Setting:** kitchen / bathroom / office / outdoor / etc.
- **Color grade:** warm / cool / neutral / desaturated / pharma-clinical / etc.
- **On-screen text:** style, font feel, emoji usage, caption placement
- **Camera:** handheld / static / tripod / gimbal / phone / DSLR
- **Talent:** demographic — age range, gender, ethnicity, vibe

## Voiceover
- **Full transcript:** (every word)
- **Tone:** (conspiratorial / warm / medical-authoritative / etc.)
- **Pace:** (slow / measured / rapid)
- **Accent / demo:** (American Midwestern 50+ woman / etc.)

## Copy framework
- **Primary framework:** PAS | AIDA | Before-After-Bridge | Open-Loop | Pain-Mirror | Transformation-Snapshot | Authority-Proof | Fear-Contrarian
- **Headline formula(s) used:** (pick from the 10 formulas above)
- **Direct-Response Laws applied:** (list which of the 7 Laws show up, with the timestamp they appear at)

## CTA
- **Exact words:** (verbatim CTA)
- **Visual treatment:** (on-screen text, product image, button, hands-pointing, etc.)
- **Placement timing:** (at X seconds of a Y-second video)
- **Urgency lever:** (limited stock / limited time / exclusive access / none)

## Product/offer
- **Product name shown:** (if visible)
- **Price shown:** (if visible)
- **Claims made:** (list every health/results claim verbatim — we need these for compliance comparison)
- **Mechanism explained:** (what the video says makes it work)

## Replicability notes
- **Easy to recreate:** (what a new creator could copy cheaply)
- **Hard to recreate:** (what requires budget, specific talent, or proprietary assets)
- **Suggested Fal model category:** talking-head UGC / product I2V / cinematic / premium-with-audio
```

- [x] **Step 2: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_teardown.py`

```python
from pathlib import Path
import pytest
from lib.teardown import run_teardown, TeardownError


def test_run_teardown_missing_api_key_raises(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    with pytest.raises(TeardownError) as exc:
        run_teardown(video, tmp_path / "teardown.md")
    assert "GEMINI_API_KEY" in str(exc.value)


def test_run_teardown_writes_output(tmp_path, mocker, fixtures_dir, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key")
    video = fixtures_dir / "sample_input.mp4"
    out = tmp_path / "teardown.md"

    fake_response = mocker.Mock()
    fake_response.text = "# Teardown\n\n## Hook (0-3s)\n- Verbatim: hi\n"
    fake_model = mocker.Mock()
    fake_model.generate_content.return_value = fake_response
    fake_file = mocker.Mock()
    fake_file.state.name = "ACTIVE"
    mocker.patch("lib.teardown.genai.upload_file", return_value=fake_file)
    mocker.patch("lib.teardown.genai.get_file", return_value=fake_file)
    mocker.patch("lib.teardown.genai.GenerativeModel", return_value=fake_model)
    mocker.patch("lib.teardown.genai.configure")

    result = run_teardown(video, out)
    assert out.exists()
    assert "Teardown" in result
```

- [x] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_teardown.py -v
```

Expected: ImportError.

- [x] **Step 4: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/teardown.py`

```python
"""Stage 1 — Gemini 2.0 Flash video teardown (DR-grounded)."""
from __future__ import annotations
import os
import time
from pathlib import Path
import google.generativeai as genai
from lib.prompt_loader import load_prompt


class TeardownError(RuntimeError):
    pass


def run_teardown(video_path: Path, out_path: Path, model_name: str = "gemini-2.0-flash-exp") -> str:
    """Analyze `video_path` with Gemini and write markdown to `out_path`. Returns the markdown."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise TeardownError("GEMINI_API_KEY not set. Add it to ~/.claude/.env or shell env.")

    genai.configure(api_key=key)

    uploaded = genai.upload_file(str(video_path))
    deadline = time.time() + 120
    while uploaded.state.name == "PROCESSING" and time.time() < deadline:
        time.sleep(2)
        uploaded = genai.get_file(uploaded.name)
    if uploaded.state.name != "ACTIVE":
        raise TeardownError(f"Video upload state: {uploaded.state.name}")

    model = genai.GenerativeModel(model_name)
    prompt = load_prompt("teardown")  # auto-substitutes {{DR_PRINCIPLES}}
    response = model.generate_content([prompt, uploaded])
    markdown = response.text
    out_path.write_text(markdown)
    return markdown
```

- [x] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_teardown.py -v
```

Expected: 2 passed.

- [x] **Step 6: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 7 — gemini teardown + prompt

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 8: `concept.py` + prompt — Claude concept translation

**Files:**
- Create: `~/.claude/skills/videoad/prompts/concept.md`
- Create: `~/.claude/skills/videoad/tests/test_concept.py`
- Create: `~/.claude/skills/videoad/lib/concept.py`

Uses `claude -p` (OAuth) subprocess. Test mocks subprocess.

- [x] **Step 1: Write the concept prompt**

File: `~/.claude/skills/videoad/prompts/concept.md`

```markdown
{{DR_PRINCIPLES}}

---

You have two inputs:
1. A teardown of a competitor video ad for someone else's offer.
2. A brief for MY offer.

Your job: reverse-engineer the competitor's winning structure for MY offer so it CONVERTS ON DAY ONE on cold traffic. Do not copy claims wholesale — translate the *structure* (hook archetype, pacing, framework, CTA) while using only facts, mechanisms, and angles from MY offer brief. Respect MY banned-claims list absolutely. Every hook and CTA MUST apply ≥2 of the 7 DR Laws above. Every hook rewrite must use a DIFFERENT headline formula.

Return structured markdown matching this outline:

# Concept

## Angle translation
- **Competitor's core angle:** (one sentence from the teardown)
- **Translated for my offer:** (one sentence that lands the same emotional lever on my offer's specific mechanism)
- **What changes:** (bullet list — what we keep, what we swap)

## Hook rewrites (3 options)
For each:
- **Verbatim (spoken):** the first 3 seconds
- **Visual:** what's on screen
- **Law applied:** which of the 7 Direct-Response Laws this hook leans on

Each hook must:
- Pull from MY offer's "Proven hooks" list when one fits
- Use MY offer's mechanism, target, pain points
- Be distinct in angle from the other two

## Reason-why (mechanism swap)
- **Competitor's mechanism:** (from teardown)
- **MY mechanism:** (from offer brief — specific, with the "because")
- **Replacement script line:** (one-sentence version that can carry the full reason-why)

## Compliance audit
List every claim in the competitor teardown that violates MY banned-claims list, plus the rewritten safe version.

| Competitor claim | Banned? | Safe rewrite |
|---|---|---|
| "cures X" | Yes — no cure language | "supports the pathway for X" |

## Visual translation
- **Reusable as-is:** what visual elements from the teardown work for my offer (setting, talent demo, framing, aspect ratio)
- **Must substitute:** what needs to change (product visible on screen, specific ingredient callouts, demographic mismatch)
- **Asset needs:** what creative assets I need to gather or generate (product shot, UGC talent of type X, etc.)

## Suggested Fal model category
One of: `talking_head` / `product_i2v` / `cinematic` / `premium_audio` — with one line explaining why.

---

TEARDOWN:
{teardown}

---

MY OFFER BRIEF:
{offer_brief}
```

- [x] **Step 2: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_concept.py`

```python
from pathlib import Path
import pytest
from lib.concept import run_concept, ConceptError


def test_run_concept_writes_output(tmp_path, mocker):
    teardown = tmp_path / "teardown.md"
    teardown.write_text("# Teardown\n\n## Hook\nGeneric hook.\n")
    offer = {"slug": "test", "name": "Test", "raw": "# Test\n\n## Primary angle\nAngle.\n"}
    out = tmp_path / "concept.md"

    mocker.patch(
        "lib.concept.subprocess.run",
        return_value=mocker.Mock(
            returncode=0,
            stdout="# Concept\n\n## Angle translation\nTranslated.\n",
            stderr="",
        ),
    )
    result = run_concept(teardown, offer, out)
    assert out.exists()
    assert "Concept" in out.read_text()


def test_run_concept_claude_failure_raises(tmp_path, mocker):
    teardown = tmp_path / "teardown.md"
    teardown.write_text("# Teardown\n")
    offer = {"slug": "test", "name": "Test", "raw": "# Test\n"}
    out = tmp_path / "concept.md"

    mocker.patch(
        "lib.concept.subprocess.run",
        return_value=mocker.Mock(returncode=1, stdout="", stderr="claude: not logged in"),
    )
    with pytest.raises(ConceptError) as exc:
        run_concept(teardown, offer, out)
    assert "claude" in str(exc.value).lower()


def test_run_concept_empty_output_raises(tmp_path, mocker):
    teardown = tmp_path / "teardown.md"
    teardown.write_text("# Teardown\n")
    offer = {"slug": "test", "name": "Test", "raw": "# Test\n"}
    out = tmp_path / "concept.md"
    mocker.patch(
        "lib.concept.subprocess.run",
        return_value=mocker.Mock(returncode=0, stdout="   \n", stderr=""),
    )
    with pytest.raises(ConceptError) as exc:
        run_concept(teardown, offer, out)
    assert "empty" in str(exc.value).lower()
```

- [x] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_concept.py -v
```

Expected: ImportError.

- [x] **Step 4: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/concept.py`

```python
"""Stage 2 — translate competitor teardown into DR-grounded concept for MY offer."""
from __future__ import annotations
import subprocess
from pathlib import Path
from lib.prompt_loader import load_prompt


class ConceptError(RuntimeError):
    pass


def run_concept(teardown_path: Path, offer: dict, out_path: Path) -> str:
    """Send teardown + offer brief to `claude -p` and write concept markdown."""
    teardown = Path(teardown_path).read_text()
    prompt = load_prompt("concept", vars={"teardown": teardown, "offer_brief": offer["raw"]})

    result = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise ConceptError(f"claude -p failed: {result.stderr.strip()[:500]}")

    output = result.stdout.strip()
    if not output:
        raise ConceptError("claude -p returned empty output")

    out_path.write_text(output)
    return output
```

- [x] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_concept.py -v
```

Expected: 3 passed.

- [x] **Step 6: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 8 — concept translator via claude -p

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 9: `script.py` + prompt — script + approval gate

**Files:**
- Create: `~/.claude/skills/videoad/prompts/script.md`
- Create: `~/.claude/skills/videoad/tests/test_script.py`
- Create: `~/.claude/skills/videoad/lib/script.py`

- [x] **Step 1: Write the script prompt**

File: `~/.claude/skills/videoad/prompts/script.md`

```markdown
{{DR_PRINCIPLES}}

---

You are turning a DR-grounded concept document into an executable production script for an AI video-generation model (Fal.ai: Kling, Veo, Minimax, Runway, etc.). The output script MUST be capable of converting cold traffic on Day 1. Brand-building or awareness scripts are failures.

Return ONLY valid JSON. No prose, no markdown fences. Exact schema:

{
  "title": "string — short descriptive title",
  "duration_s": integer between 5 and 30,
  "aspect": "9:16" | "1:1" | "16:9",
  "content_type": "talking_head" | "product" | "cinematic" | "mixed",
  "needs_source_image": boolean,
  "suggested_model_category": "talking_head" | "product_i2v" | "fast" | "premium_audio" | "cinematic",
  "scenes": [
    {
      "t_start_s": number,
      "t_end_s": number,
      "visual": "string — what is on screen",
      "vo_or_dialogue": "string — spoken words (empty if no audio)",
      "on_screen_text": "string — captions/overlays"
    }
  ],
  "hook_line": "string — the exact spoken words for the first 1.5 seconds. This line decides everything.",
  "hook_formula": "one of: OPEN_LOOP_MYSTERY | PAIN_MIRROR | MECHANISM_REVEAL | TIME_COMPRESSED_PROMISE | AUTHORITY_PROOF | STORY_CONFESSION | FEAR_CONTRARIAN | FORBIDDEN_INSIDER | TRANSFORMATION_SNAPSHOT | CALLOUT_QUESTION",
  "laws_applied": ["string — list at least 2 of OPEN_LOOP | PAIN_AMPLIFICATION | MECHANISM_FRAMING | SPECIFICITY | SIMPLICITY | CREDIBILITY | TIME_COMPRESSION"],
  "framework": "PAS | AIDA | BAB | OPEN_LOOP | PAIN_MIRROR | TRANSFORMATION | AUTHORITY | FEAR_CONTRARIAN",
  "cta_line": "string — the exact spoken or on-screen CTA. Never 'Learn more'. Must include urgency + specificity.",
  "compliance_check": {
    "banned_claims_avoided": ["string — for each item in the offer's Banned claims list, confirm we avoided it"],
    "uses_safe_framing": "boolean — 'may help' / 'supports' / 'many people report' language used where required"
  },
  "self_scorecard": {
    "hook_strength_0_10": integer,
    "pain_named_in_first_3s": boolean,
    "mechanism_present": boolean,
    "specificity_score_0_10": integer,
    "cta_has_urgency": boolean,
    "day1_conversion_readiness_0_10": integer,
    "weaknesses": ["string — list any weak spots honestly. Be self-critical. An empty list is suspicious."]
  },
  "fal_prompt": "string — the exact text prompt to feed to a text-to-video Fal model. Be detailed, cinematic, specific. Must describe visuals + emotional tone + on-screen text / caption cues. Must NOT reference banned claims.",
  "alt_fal_prompts": ["string — variant prompt 1 with a different hook formula", "string — variant prompt 2"],
  "notes_for_buyer": "string — what the human should double-check before spending money"
}

Hard rules (violating any = rejection):
- Hook line must pattern-interrupt in ≤1.5s — pain/curiosity/bold claim, not brand intro
- Mechanism (the "because" from offer brief) must appear in the video, not just be implied
- CTA must include an urgency lever (limited time / limited stock / "before it's gone") AND a specific action verb (NOT "Learn more")
- `laws_applied` must have ≥2 entries — each with a visible instance in the script
- `compliance_check.banned_claims_avoided` must enumerate EVERY item from the offer's Banned claims list and confirm avoidance
- `fal_prompt` must not reference brand awareness, premium feel, journey, transformation-as-marketing-word
- Duration: 5-6s for talking_head/fast/product, 8s for premium_audio, 5-10s for cinematic
- Scenes cover full duration with no gaps

Be honest in `self_scorecard` — empty `weaknesses` list is a failure signal. If the hook or mechanism is weak, say so.

---

CONCEPT:
{concept}

---

OFFER BRIEF:
{offer_brief}
```

- [x] **Step 2: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_script.py`

```python
import json
from pathlib import Path
import pytest
from lib.script import (
    run_script, ScriptError, ScriptQualityError,
    validate_script, critique_script, MIN_DAY1_READINESS,
)


VALID_SCRIPT = {
    "title": "Akemi hook test",
    "duration_s": 6,
    "aspect": "9:16",
    "content_type": "talking_head",
    "needs_source_image": False,
    "suggested_model_category": "talking_head",
    "scenes": [
        {"t_start_s": 0, "t_end_s": 3, "visual": "woman in kitchen",
         "vo_or_dialogue": "Still waking up with burning feet?", "on_screen_text": "the truth"},
        {"t_start_s": 3, "t_end_s": 6, "visual": "patch applied to upper arm",
         "vo_or_dialogue": "Tap below before this page comes down", "on_screen_text": "$1/day"},
    ],
    "hook_line": "Still waking up with burning feet? The real reason nobody talks about.",
    "hook_formula": "OPEN_LOOP_MYSTERY",
    "laws_applied": ["OPEN_LOOP", "PAIN_AMPLIFICATION", "SPECIFICITY"],
    "framework": "PAS",
    "cta_line": "Tap the link to see how it works before this page comes down",
    "compliance_check": {
        "banned_claims_avoided": ["No cure claims used"],
        "uses_safe_framing": True,
    },
    "self_scorecard": {
        "hook_strength_0_10": 8,
        "pain_named_in_first_3s": True,
        "mechanism_present": True,
        "specificity_score_0_10": 7,
        "cta_has_urgency": True,
        "day1_conversion_readiness_0_10": 8,
        "weaknesses": ["Mechanism could be more specific"],
    },
    "fal_prompt": "Close-up of a 55yo woman in warm kitchen lighting, pained expression at 0-1.5s with caption 'Still waking up with burning feet?', transitions to her applying a beige patch to her upper arm by 4s, final shot is her calm with caption 'Tap the link before this page comes down', handheld phone UGC aesthetic, warm neutrals",
    "alt_fal_prompts": [
        "Alt with transformation snapshot: older woman limping then walking easily, caption 'From suffering every morning to this — 7 days'",
        "Alt with authority proof: doctor-in-white-coat B-roll, caption 'Top Doctor: This is the patch women over 50 are using'",
    ],
    "notes_for_buyer": "Verify warm neutral color grade; confirm patch visible on screen",
}


def test_validate_accepts_valid():
    validate_script(VALID_SCRIPT)


def test_validate_rejects_missing_field():
    bad = dict(VALID_SCRIPT)
    del bad["fal_prompt"]
    with pytest.raises(ScriptError) as exc:
        validate_script(bad)
    assert "fal_prompt" in str(exc.value)


def test_validate_rejects_bad_aspect():
    bad = dict(VALID_SCRIPT)
    bad["aspect"] = "4:3"
    with pytest.raises(ScriptError):
        validate_script(bad)


def test_validate_rejects_fewer_than_2_laws():
    bad = json.loads(json.dumps(VALID_SCRIPT))
    bad["laws_applied"] = ["OPEN_LOOP"]
    with pytest.raises(ScriptError) as exc:
        validate_script(bad)
    assert "laws_applied" in str(exc.value) or "≥2" in str(exc.value) or "2" in str(exc.value)


def test_critique_passes_strong_script():
    result = critique_script(VALID_SCRIPT, offer_banned_claims=[])
    assert result["passes"] is True
    assert result["score"] >= MIN_DAY1_READINESS


def test_critique_fails_weak_hook():
    weak = json.loads(json.dumps(VALID_SCRIPT))
    weak["self_scorecard"]["hook_strength_0_10"] = 3
    weak["self_scorecard"]["day1_conversion_readiness_0_10"] = 4
    result = critique_script(weak, offer_banned_claims=[])
    assert result["passes"] is False
    assert "hook" in " ".join(result["reasons"]).lower()


def test_critique_fails_missing_mechanism():
    weak = json.loads(json.dumps(VALID_SCRIPT))
    weak["self_scorecard"]["mechanism_present"] = False
    result = critique_script(weak, offer_banned_claims=[])
    assert result["passes"] is False
    assert any("mechanism" in r.lower() for r in result["reasons"])


def test_critique_fails_when_cta_lacks_urgency():
    weak = json.loads(json.dumps(VALID_SCRIPT))
    weak["self_scorecard"]["cta_has_urgency"] = False
    weak["cta_line"] = "Learn more on our site"
    result = critique_script(weak, offer_banned_claims=[])
    assert result["passes"] is False


def test_critique_flags_banned_claim_in_fal_prompt():
    weak = json.loads(json.dumps(VALID_SCRIPT))
    weak["fal_prompt"] = "A woman who cured her diabetes in 7 days"
    result = critique_script(weak, offer_banned_claims=["no cure language"])
    assert result["passes"] is False
    assert any("banned" in r.lower() or "cure" in r.lower() for r in result["reasons"])


def test_run_script_parses_json(tmp_path, mocker):
    concept = tmp_path / "concept.md"
    concept.write_text("# Concept\n")
    offer = {"raw": "# Test\n", "sections": {"Banned claims": "- no cure"}}
    out = tmp_path / "script.json"
    mocker.patch(
        "lib.script.subprocess.run",
        return_value=mocker.Mock(returncode=0, stdout=json.dumps(VALID_SCRIPT), stderr=""),
    )
    result = run_script(concept, offer, out)
    assert result["title"] == "Akemi hook test"
    assert result["self_scorecard"]["day1_conversion_readiness_0_10"] >= 7


def test_run_script_extracts_json_from_code_fence(tmp_path, mocker):
    concept = tmp_path / "concept.md"
    concept.write_text("# Concept\n")
    offer = {"raw": "# Test\n", "sections": {"Banned claims": "-x"}}
    out = tmp_path / "script.json"
    wrapped = f"```json\n{json.dumps(VALID_SCRIPT)}\n```"
    mocker.patch(
        "lib.script.subprocess.run",
        return_value=mocker.Mock(returncode=0, stdout=wrapped, stderr=""),
    )
    result = run_script(concept, offer, out)
    assert result["title"] == "Akemi hook test"


def test_run_script_invalid_json_raises(tmp_path, mocker):
    concept = tmp_path / "concept.md"
    concept.write_text("# Concept\n")
    offer = {"raw": "# Test\n", "sections": {"Banned claims": "-x"}}
    out = tmp_path / "script.json"
    mocker.patch(
        "lib.script.subprocess.run",
        return_value=mocker.Mock(returncode=0, stdout="not json at all", stderr=""),
    )
    with pytest.raises(ScriptError):
        run_script(concept, offer, out)


def test_run_script_retries_on_weak_critique_then_succeeds(tmp_path, mocker):
    concept = tmp_path / "concept.md"
    concept.write_text("# Concept\n")
    offer = {"raw": "# Test\n", "sections": {"Banned claims": "-x"}}
    out = tmp_path / "script.json"

    weak = json.loads(json.dumps(VALID_SCRIPT))
    weak["self_scorecard"]["hook_strength_0_10"] = 3
    weak["self_scorecard"]["day1_conversion_readiness_0_10"] = 4

    mocker.patch(
        "lib.script.subprocess.run",
        side_effect=[
            mocker.Mock(returncode=0, stdout=json.dumps(weak), stderr=""),
            mocker.Mock(returncode=0, stdout=json.dumps(VALID_SCRIPT), stderr=""),
        ],
    )
    result = run_script(concept, offer, out)
    assert result["self_scorecard"]["day1_conversion_readiness_0_10"] >= 7


def test_run_script_quality_error_after_max_retries(tmp_path, mocker):
    concept = tmp_path / "concept.md"
    concept.write_text("# Concept\n")
    offer = {"raw": "# Test\n", "sections": {"Banned claims": "-x"}}
    out = tmp_path / "script.json"

    weak = json.loads(json.dumps(VALID_SCRIPT))
    weak["self_scorecard"]["hook_strength_0_10"] = 2
    weak["self_scorecard"]["day1_conversion_readiness_0_10"] = 3
    weak["self_scorecard"]["mechanism_present"] = False

    # Always returns weak script
    mocker.patch(
        "lib.script.subprocess.run",
        return_value=mocker.Mock(returncode=0, stdout=json.dumps(weak), stderr=""),
    )
    with pytest.raises(ScriptQualityError) as exc:
        run_script(concept, offer, out, max_retries=2)
    assert "day1" in str(exc.value).lower() or "quality" in str(exc.value).lower()
```

- [x] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_script.py -v
```

Expected: ImportError.

- [x] **Step 4: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/script.py`

```python
"""Stage 3 — DR-grounded scene-by-scene script + critique + retry.

The critique gate is the core defense against wasted Fal credits. A script
that fails critique is regenerated with a stronger prompt. If it still fails
after `max_retries`, we refuse to spend money and raise ScriptQualityError.
"""
from __future__ import annotations
import json
import re
import subprocess
from pathlib import Path
from typing import Optional
from lib.prompt_loader import load_prompt


class ScriptError(RuntimeError):
    """Malformed script — missing fields, bad types, invalid enum values."""


class ScriptQualityError(RuntimeError):
    """Script parseable but fails DR critique after max retries."""


REQUIRED_FIELDS = {
    "title", "duration_s", "aspect", "content_type", "needs_source_image",
    "suggested_model_category", "scenes",
    "hook_line", "hook_formula", "laws_applied", "framework", "cta_line",
    "compliance_check", "self_scorecard",
    "fal_prompt", "alt_fal_prompts", "notes_for_buyer",
}
VALID_ASPECTS = {"9:16", "1:1", "16:9"}
VALID_CATEGORIES = {"talking_head", "product_i2v", "fast", "premium_audio", "cinematic"}
VALID_LAWS = {
    "OPEN_LOOP", "PAIN_AMPLIFICATION", "MECHANISM_FRAMING",
    "SPECIFICITY", "SIMPLICITY", "CREDIBILITY", "TIME_COMPRESSION",
}
BANNED_CTA_PHRASES = {"learn more", "click here", "check it out", "find out more"}
URGENCY_PHRASES = {
    "before", "limited", "today", "now", "hurry", "last chance",
    "only", "while supplies last", "this week", "act fast",
}

MIN_DAY1_READINESS = 7  # 0-10 scale


def _extract_json(raw: str) -> str:
    raw = raw.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)```$", raw, re.DOTALL)
    if m:
        return m.group(1).strip()
    return raw


def validate_script(data: dict) -> None:
    """Structural validation — shape/types only, not quality."""
    missing = REQUIRED_FIELDS - data.keys()
    if missing:
        raise ScriptError(f"Script missing fields: {sorted(missing)}")
    if data["aspect"] not in VALID_ASPECTS:
        raise ScriptError(f"aspect must be one of {VALID_ASPECTS}")
    if data["suggested_model_category"] not in VALID_CATEGORIES:
        raise ScriptError(f"suggested_model_category must be one of {VALID_CATEGORIES}")
    if not isinstance(data["scenes"], list) or not data["scenes"]:
        raise ScriptError("scenes must be non-empty list")
    if not isinstance(data.get("laws_applied"), list) or len(data["laws_applied"]) < 2:
        raise ScriptError("laws_applied must list ≥2 laws")
    unknown_laws = set(data["laws_applied"]) - VALID_LAWS
    if unknown_laws:
        raise ScriptError(f"Unknown laws: {unknown_laws}")
    sc = data.get("self_scorecard") or {}
    for k in ("hook_strength_0_10", "specificity_score_0_10", "day1_conversion_readiness_0_10"):
        if k not in sc:
            raise ScriptError(f"self_scorecard missing {k}")


def critique_script(data: dict, offer_banned_claims: list[str]) -> dict:
    """DR quality gate. Returns {passes: bool, score: int, reasons: [str]}."""
    reasons: list[str] = []
    sc = data.get("self_scorecard", {})

    readiness = int(sc.get("day1_conversion_readiness_0_10", 0))
    if readiness < MIN_DAY1_READINESS:
        reasons.append(f"day1_conversion_readiness is {readiness} (need ≥{MIN_DAY1_READINESS})")

    if int(sc.get("hook_strength_0_10", 0)) < 6:
        reasons.append("hook too weak — hook_strength < 6")

    if not sc.get("pain_named_in_first_3s"):
        reasons.append("pain is not named in the first 3 seconds")

    if not sc.get("mechanism_present"):
        reasons.append("mechanism (the 'because') is missing")

    if not sc.get("cta_has_urgency"):
        reasons.append("CTA lacks an urgency lever")

    # CTA lexical check
    cta = (data.get("cta_line") or "").lower()
    if any(b in cta for b in BANNED_CTA_PHRASES):
        reasons.append(f"CTA uses banned phrase: {cta!r}")
    if not any(u in cta for u in URGENCY_PHRASES):
        reasons.append("CTA has no urgency word (before/limited/today/...)")

    # Banned-claim scan in fal_prompt + scenes
    fal_prompt = (data.get("fal_prompt") or "").lower()
    all_dialogue = " ".join(
        (s.get("vo_or_dialogue") or "") + " " + (s.get("on_screen_text") or "")
        for s in data.get("scenes", [])
    ).lower()
    haystack = fal_prompt + " " + all_dialogue

    # Heuristic banned-word triggers (offer-specific banned claims)
    banned_triggers = {"cure", "guaranteed", "miracle", "treat ", "treats ", "reverses"}
    for token in banned_triggers:
        if token in haystack:
            reasons.append(f"Script contains banned trigger word: {token.strip()!r}")

    # Offer-specific phrase check — any exact phrase match
    for claim in offer_banned_claims:
        # crude substring of the first 5 words of each banned claim line
        head = " ".join(claim.lower().split()[:5])
        if head and head in haystack:
            reasons.append(f"Script uses banned phrase: {head!r}")

    if not data.get("alt_fal_prompts"):
        reasons.append("alt_fal_prompts missing — always provide ≥2 variants")

    return {
        "passes": not reasons,
        "score": readiness,
        "reasons": reasons,
    }


def _call_claude(prompt: str) -> dict:
    result = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise ScriptError(f"claude -p failed: {result.stderr.strip()[:500]}")
    body = _extract_json(result.stdout)
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise ScriptError(f"Could not parse JSON from claude output: {e}. Body: {body[:300]!r}")


def _build_retry_prompt(base_prompt: str, prev_data: dict, reasons: list[str]) -> str:
    """Augment the prompt with explicit criticism of the previous attempt."""
    return (
        base_prompt
        + "\n\n---\n\nYOUR PREVIOUS ATTEMPT FAILED DR CRITIQUE WITH THESE REASONS:\n"
        + "\n".join(f"- {r}" for r in reasons)
        + "\n\nThe previous script was:\n```json\n"
        + json.dumps(prev_data, indent=2)
        + "\n```\n\nFix every reason above. Be harder on yourself in self_scorecard. "
        + "If the hook still feels safe — it IS safe. Rewrite it to pattern-interrupt "
        + "harder. Make the mechanism explicit, not implied. Rework the CTA with a "
        + "concrete urgency lever. Output the new JSON only."
    )


def run_script(
    concept_path: Path,
    offer: dict,
    out_path: Path,
    *,
    max_retries: int = 2,
) -> dict:
    """Generate script → validate → critique → retry if weak → write JSON."""
    concept = Path(concept_path).read_text()
    base_prompt = load_prompt("script", vars={
        "concept": concept,
        "offer_brief": offer["raw"],
    })

    banned_claims = []
    sections = offer.get("sections") or {}
    for heading, content in sections.items():
        if "banned" in heading.lower():
            banned_claims = [
                line.strip().lstrip("-*").strip()
                for line in content.splitlines()
                if line.strip().startswith(("-", "*"))
            ]
            break

    attempts: list[dict] = []
    prompt = base_prompt

    for attempt in range(max_retries + 1):
        data = _call_claude(prompt)
        validate_script(data)
        crit = critique_script(data, banned_claims)
        data["_critique"] = crit
        attempts.append(data)

        if crit["passes"]:
            out_path.write_text(json.dumps(data, indent=2))
            return data

        if attempt == max_retries:
            break

        prompt = _build_retry_prompt(base_prompt, data, crit["reasons"])

    # All retries failed critique
    final = attempts[-1]
    out_path.write_text(json.dumps(final, indent=2))  # keep artifact for inspection
    raise ScriptQualityError(
        "Script failed DR critique after "
        f"{max_retries + 1} attempts. Day1 readiness: {final['_critique']['score']}/10. "
        f"Reasons: {final['_critique']['reasons']}. "
        f"Edit {out_path} by hand or strengthen the concept/offer brief, then --resume."
    )
```

- [x] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_script.py -v
```

Expected: 13 passed.

- [x] **Step 6: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 9 — script generator + validator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 10: `fal_runner.py` — Fal.ai generation + download

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_fal_runner.py`
- Create: `~/.claude/skills/videoad/lib/fal_runner.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_fal_runner.py`

```python
from pathlib import Path
import pytest
from lib.fal_runner import generate, FalRunnerError


def test_missing_fal_key_raises(tmp_path, monkeypatch):
    monkeypatch.delenv("FAL_KEY", raising=False)
    with pytest.raises(FalRunnerError) as exc:
        generate(
            model_id="fal-ai/minimax/hailuo-02/standard",
            prompt="test",
            out_dir=tmp_path,
        )
    assert "FAL_KEY" in str(exc.value)


def test_generate_writes_mp4(tmp_path, mocker, monkeypatch):
    monkeypatch.setenv("FAL_KEY", "fake")
    fake_response = {
        "video": {"url": "https://fal.media/files/abc.mp4"},
        "timings": {"inference": 12.5},
    }
    mocker.patch("lib.fal_runner.fal_client.subscribe", return_value=fake_response)

    class FakeStream:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def raise_for_status(self): pass
        def iter_bytes(self): yield b"fake mp4 bytes"

    mocker.patch("lib.fal_runner.httpx.stream", return_value=FakeStream())

    out_dir = tmp_path / "04-generation"
    out_dir.mkdir()
    result = generate(
        model_id="fal-ai/minimax/hailuo-02/standard",
        prompt="test",
        out_dir=out_dir,
    )
    assert (out_dir / "out.mp4").exists()
    assert result["fal_url"] == "https://fal.media/files/abc.mp4"
    assert result["status"] == "completed"
    assert (out_dir / "fal-job.json").exists()


def test_generate_image_to_video(tmp_path, mocker, monkeypatch, fixtures_dir):
    monkeypatch.setenv("FAL_KEY", "fake")
    fake_response = {"video": {"url": "https://fal.media/files/abc.mp4"}}
    sub = mocker.patch("lib.fal_runner.fal_client.subscribe", return_value=fake_response)

    class FakeStream:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def raise_for_status(self): pass
        def iter_bytes(self): yield b"x"
    mocker.patch("lib.fal_runner.httpx.stream", return_value=FakeStream())
    mocker.patch("lib.fal_runner.fal_client.upload_file", return_value="https://fal.media/img.jpg")

    out_dir = tmp_path / "04-generation"
    out_dir.mkdir()
    image = fixtures_dir / "sample_input.mp4"  # any file — mocked upload anyway
    generate(
        model_id="fal-ai/kling-video/v2.1/image-to-video",
        prompt="animate",
        out_dir=out_dir,
        image_path=image,
    )
    # Verify image_url ended up in arguments
    args = sub.call_args
    kwargs = args.kwargs.get("arguments") or args[0][1] if len(args[0]) > 1 else {}
    assert "image_url" in str(kwargs) or "image" in str(kwargs).lower()
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_fal_runner.py -v
```

Expected: ImportError.

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/lib/fal_runner.py`

```python
"""Stage 4 — fal_client.subscribe() wrapper + output download."""
from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Optional
import httpx
import fal_client


class FalRunnerError(RuntimeError):
    pass


def _build_arguments(prompt: str, duration_s: int, aspect: str, image_url: Optional[str]) -> dict:
    args: dict = {"prompt": prompt, "duration": str(duration_s), "aspect_ratio": aspect}
    if image_url:
        args["image_url"] = image_url
    return args


def generate(
    model_id: str,
    prompt: str,
    out_dir: Path,
    *,
    duration_s: int = 6,
    aspect: str = "9:16",
    image_path: Optional[Path] = None,
    on_log: Optional[callable] = None,
) -> dict:
    """Run a Fal video-generation job, download output.mp4, return metadata."""
    if not os.environ.get("FAL_KEY"):
        raise FalRunnerError("FAL_KEY not set. Add it to ~/.claude/.env or shell env.")

    image_url: Optional[str] = None
    if image_path:
        image_url = fal_client.upload_file(str(image_path))

    arguments = _build_arguments(prompt, duration_s, aspect, image_url)

    def _on_queue_update(update):
        if on_log:
            on_log(str(update))

    try:
        response = fal_client.subscribe(
            model_id,
            arguments=arguments,
            with_logs=True,
            on_queue_update=_on_queue_update,
        )
    except Exception as e:
        raise FalRunnerError(f"Fal generation failed: {e}") from e

    # Response shape: {"video": {"url": "..."}, "timings": {...}, ...}
    video = response.get("video") or {}
    fal_url = video.get("url")
    if not fal_url:
        raise FalRunnerError(f"No video.url in Fal response: {response}")

    dest = out_dir / "out.mp4"
    with httpx.stream("GET", fal_url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)

    (out_dir / "fal-job.json").write_text(json.dumps({
        "model_id": model_id,
        "arguments": arguments,
        "response": response,
    }, indent=2, default=str))

    return {
        "status": "completed",
        "fal_url": fal_url,
        "output_path": str(dest),
        "model_id": model_id,
    }
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_fal_runner.py -v
```

Expected: 3 passed.

- [x] **Step 5: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 10 — fal_client wrapper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 11: `cli.py` — argparse wiring for all subcommands

**Files:**
- Create: `~/.claude/skills/videoad/tests/test_cli.py`
- Create: `~/.claude/skills/videoad/cli.py`

- [x] **Step 1: Write the failing tests**

File: `~/.claude/skills/videoad/tests/test_cli.py`

```python
import json
import sys
from pathlib import Path
import pytest

# cli.py lives at skill root, not in lib/
SKILL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_ROOT))

from cli import build_parser, cmd_models, cmd_stats, cmd_run


def test_parser_models_subcommand():
    p = build_parser()
    args = p.parse_args(["models"])
    assert args.command == "models"


def test_parser_stats_subcommand():
    p = build_parser()
    args = p.parse_args(["stats", "--offer", "akemi"])
    assert args.command == "stats"
    assert args.offer == "akemi"


def test_parser_default_is_run_when_first_arg_is_input(tmp_path):
    # A path-like first arg should be treated as 'run <input>'
    p = build_parser()
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    args = p.parse_args(["run", str(f), "--offer", "akemi", "--yes"])
    assert args.command == "run"
    assert args.offer == "akemi"
    assert args.yes is True


def test_cmd_models_prints_table(capsys):
    cmd_models(type("A", (), {"refresh": False})())
    out = capsys.readouterr().out
    assert "kling-video" in out
    assert "minimax" in out


def test_cmd_stats_no_runs(tmp_offers_dir, capsys):
    (tmp_offers_dir / "empty-offer.md").write_text(
        "---\nslug: empty-offer\nname: x\ntarget: y\n---\n"
        "# X\n## Primary angle\na\n## USPs (3)\n1\n2\n3\n"
        "## Proven hooks (5-8)\n-a\n-b\n-c\n-d\n-e\n"
        "## Mechanism\nm\n## Banned claims\n-x\n"
    )
    cmd_stats(type("A", (), {"offer": "empty-offer"})())
    out = capsys.readouterr().out
    assert "0 runs" in out or "No runs" in out


def test_cmd_run_dry_run_skips_fal(tmp_offers_dir, tmp_videos_dir, fixtures_dir, mocker):
    # Put valid offer
    (tmp_offers_dir / "test-offer.md").write_text(
        (fixtures_dir / "sample_offer.md").read_text()
    )
    # Mock teardown + concept + script
    mocker.patch("cli.run_teardown", return_value="# Teardown")
    mocker.patch("cli.run_concept", return_value="# Concept")
    mocker.patch("cli.run_script", return_value={
        "title": "t", "duration_s": 6, "aspect": "9:16",
        "content_type": "talking_head", "needs_source_image": False,
        "suggested_model_category": "talking_head", "scenes": [],
        "fal_prompt": "p", "alt_fal_prompts": [], "notes_for_buyer": ""
    })
    fal_mock = mocker.patch("cli.fal_generate")
    # Feed a local file as input
    args = type("A", (), {
        "command": "run",
        "input": str(fixtures_dir / "sample_input.mp4"),
        "offer": "test-offer", "model": None, "aspect": None,
        "image": None, "fast": False, "premium": False,
        "dry_run": True, "resume": None, "yes": True,
    })()
    rc = cmd_run(args)
    assert rc == 0
    fal_mock.assert_not_called()
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cli.py -v
```

Expected: ImportError (no `cli.py` yet).

- [x] **Step 3: Write minimal implementation**

File: `~/.claude/skills/videoad/cli.py`

```python
"""/videoad CLI entrypoint."""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.prompt import Confirm

SKILL_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SKILL_ROOT))

from lib.model_catalog import list_models, get_model, estimate_cost, route
from lib.offer_loader import load_offer, list_offers, OfferValidationError
from lib.cost_tracker import append_run, stats
from lib.run_dir import create_run_dir, find_run_dir, completed_stages
from lib.input_fetcher import fetch as fetch_input, InputFetchError
from lib.teardown import run_teardown, TeardownError
from lib.concept import run_concept, ConceptError
from lib.script import run_script, ScriptError, ScriptQualityError
from lib.fal_runner import generate as fal_generate, FalRunnerError

console = Console()


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="videoad")
    sub = p.add_subparsers(dest="command", required=True)

    pr = sub.add_parser("run", help="Run the full pipeline")
    pr.add_argument("input", help="URL or local video path")
    pr.add_argument("--offer", help="Offer slug")
    pr.add_argument("--model", help="Fal model id override")
    pr.add_argument("--aspect", choices=["9:16", "1:1", "16:9"], default=None)
    pr.add_argument("--image", help="Source image for I2V")
    pr.add_argument("--fast", action="store_true")
    pr.add_argument("--premium", action="store_true")
    pr.add_argument("--dry-run", dest="dry_run", action="store_true")
    pr.add_argument("--resume", help="Run id to resume")
    pr.add_argument("--yes", action="store_true", help="Skip approval gate")

    pm = sub.add_parser("models", help="List Fal models")
    pm.add_argument("--refresh", action="store_true")

    ps = sub.add_parser("stats", help="Cost + run stats")
    ps.add_argument("--offer", required=True)

    pn = sub.add_parser("new-offer", help="Create a new offer file")
    pn.add_argument("slug")

    pe = sub.add_parser("edit-offer", help="Open offer file in editor")
    pe.add_argument("slug")

    prf = sub.add_parser("refresh-offer", help="Re-paste offer from Claude.ai project")
    prf.add_argument("slug")

    return p


def cmd_models(args) -> int:
    tbl = Table(title="Fal video models")
    tbl.add_column("ID"); tbl.add_column("Category"); tbl.add_column("Input")
    tbl.add_column("Dur(s)"); tbl.add_column("Est $"); tbl.add_column("Notes")
    for m in list_models():
        tbl.add_row(
            m["id"], m["category"], m["input_type"],
            str(m["default_duration_s"]), f"${m['est_cost_usd']:.2f}",
            m["notes"],
        )
    console.print(tbl)
    return 0


def cmd_stats(args) -> int:
    s = stats(args.offer)
    if s["runs"] == 0:
        console.print(f"No runs for [bold]{args.offer}[/bold] (0 runs)")
        return 0
    console.print(
        f"[bold]{args.offer}[/bold]: {s['runs']} runs, "
        f"{s['successful']} successful, "
        f"${s['total_usd']:.2f} total, "
        f"${s['avg_usd']:.2f} avg"
    )
    for r in s["last_runs"][-10:]:
        console.print(f"  {r.get('ts','?')} | {r.get('model','?')} | "
                      f"${r.get('cost_usd',0):.2f} | {r.get('status','?')}")
    return 0


_OFFER_TEMPLATE = """---
slug: {slug}
name: 
price: 
target: 
language: en
---

# 

## Primary angle

## USPs (3)
1. 
2. 
3. 

## Proven hooks (5-8)
- 

## Mechanism (the "because")

## Pain points (sensory specifics)

## Common objections + counters

## Banned claims

## Compliance notes

## Visual / tone notes

## Proven competitor refs
"""


def cmd_new_offer(args) -> int:
    offers_dir = Path(os.environ.get("VIDEOAD_OFFERS_DIR", str(Path.home() / ".claude" / "offers")))
    offers_dir.mkdir(parents=True, exist_ok=True)
    path = offers_dir / f"{args.slug}.md"
    if path.exists():
        console.print(f"[yellow]{path} already exists.[/yellow]")
        return 1
    path.write_text(_OFFER_TEMPLATE.format(slug=args.slug))
    editor = os.environ.get("EDITOR", "nano")
    subprocess.run([editor, str(path)])
    return 0


def cmd_edit_offer(args) -> int:
    offers_dir = Path(os.environ.get("VIDEOAD_OFFERS_DIR", str(Path.home() / ".claude" / "offers")))
    path = offers_dir / f"{args.slug}.md"
    if not path.exists():
        console.print(f"[red]{path} not found[/red]")
        return 1
    editor = os.environ.get("EDITOR", "nano")
    subprocess.run([editor, str(path)])
    return 0


_REFRESH_PROMPT = """Copy this into your Claude.ai project for offer '{slug}' and paste the output back:

-----8<----- PROMPT -----8<-----
Summarize this project as a video-ad offer brief in markdown. Keep all section headings exactly as in the template below. Use the same slug in frontmatter.

Template:
{template}
-----8<----- END -----8<-----

When ready, paste the output (including frontmatter). End with Ctrl-D:
"""


def cmd_refresh_offer(args) -> int:
    offers_dir = Path(os.environ.get("VIDEOAD_OFFERS_DIR", str(Path.home() / ".claude" / "offers")))
    offers_dir.mkdir(parents=True, exist_ok=True)
    path = offers_dir / f"{args.slug}.md"
    console.print(_REFRESH_PROMPT.format(slug=args.slug, template=_OFFER_TEMPLATE.format(slug=args.slug)))
    body = sys.stdin.read()
    if not body.strip():
        console.print("[red]No input received[/red]")
        return 1
    path.write_text(body)
    console.print(f"[green]Saved {path}[/green]")
    return 0


def _pick_model(args, script: dict) -> str:
    if args.model:
        return args.model
    hint = {
        "content_type": script.get("content_type"),
        "has_image": bool(args.image) or script.get("needs_source_image", False),
        "fast": args.fast,
        "premium": args.premium,
    }
    return route(hint)


def _print_scorecard(script: dict) -> None:
    sc = script.get("self_scorecard") or {}
    crit = script.get("_critique") or {}
    tbl = Table(title="DR Scorecard", show_header=False)
    tbl.add_column("metric", style="bold")
    tbl.add_column("value")
    tbl.add_row("Day-1 readiness", f"{sc.get('day1_conversion_readiness_0_10','?')}/10")
    tbl.add_row("Hook strength", f"{sc.get('hook_strength_0_10','?')}/10")
    tbl.add_row("Specificity", f"{sc.get('specificity_score_0_10','?')}/10")
    tbl.add_row("Pain in first 3s", "✓" if sc.get("pain_named_in_first_3s") else "✗")
    tbl.add_row("Mechanism present", "✓" if sc.get("mechanism_present") else "✗")
    tbl.add_row("CTA has urgency", "✓" if sc.get("cta_has_urgency") else "✗")
    tbl.add_row("Laws applied", ", ".join(script.get("laws_applied") or []) or "?")
    tbl.add_row("Framework", script.get("framework") or "?")
    tbl.add_row("Critique passes", "✓" if crit.get("passes") else "?")
    if sc.get("weaknesses"):
        tbl.add_row("LLM-flagged weaknesses", "; ".join(sc["weaknesses"]))
    console.print(tbl)


def cmd_run(args) -> int:
    # Load offer
    if not args.offer:
        avail = list_offers()
        console.print(f"[red]--offer required. Available: {', '.join(avail)}[/red]")
        return 2
    try:
        offer = load_offer(args.offer)
    except (FileNotFoundError, OfferValidationError) as e:
        console.print(f"[red]{e}[/red]")
        return 2

    # Create or resume run dir
    if args.resume:
        rd = find_run_dir(args.offer, args.resume)
        if rd is None:
            console.print(f"[red]No run found for --resume {args.resume}[/red]")
            return 2
    else:
        rd = create_run_dir(args.offer)
    console.print(f"[dim]Run dir: {rd}[/dim]")

    done = completed_stages(rd)
    console.print(f"[dim]Completed stages: {done or 'none'}[/dim]")

    # Stage 0: Input
    if "input" not in done:
        try:
            meta = fetch_input(args.input, rd / "00-input")
            console.print(f"[green]Input fetched ({meta.get('handler')}, {meta.get('duration_s', 0):.1f}s)[/green]")
        except InputFetchError as e:
            console.print(f"[red]{e}[/red]")
            return 3
    video = rd / "00-input" / "source.mp4"

    # Stage 1: Teardown
    if "teardown" not in done:
        try:
            run_teardown(video, rd / "01-teardown.md")
            console.print("[green]Teardown complete[/green]")
        except TeardownError as e:
            console.print(f"[red]{e}[/red]")
            return 4

    # Stage 2: Concept
    if "concept" not in done:
        try:
            run_concept(rd / "01-teardown.md", offer, rd / "02-concept.md")
            console.print("[green]Concept complete[/green]")
        except ConceptError as e:
            console.print(f"[red]{e}[/red]")
            return 5

    # Stage 3: Script (with DR critique + retry)
    if "script" not in done:
        try:
            run_script(rd / "02-concept.md", offer, rd / "03-script.json")
            console.print("[green]Script complete — passed DR critique[/green]")
        except ScriptQualityError as e:
            console.print(f"[red bold]Script failed DR critique after retries — refusing to spend Fal credits.[/red bold]")
            console.print(f"[red]{e}[/red]")
            console.print(f"[yellow]Edit {rd / '03-script.json'} by hand, then rerun with:[/yellow]")
            console.print(f"[yellow]  /videoad {args.input} --offer {args.offer} --resume {rd.name.split('-')[-1]}[/yellow]")
            return 6
        except ScriptError as e:
            console.print(f"[red]{e}[/red]")
            return 6

    script = json.loads((rd / "03-script.json").read_text())

    if args.dry_run:
        console.print("[yellow]--dry-run: stopping before Fal generation[/yellow]")
        _print_scorecard(script)
        console.print(f"[dim]Full script: {rd / '03-script.json'}[/dim]")
        return 0

    # Approval gate
    model_id = _pick_model(args, script)
    est = estimate_cost(model_id, script["duration_s"]) or 0.0
    aspect = args.aspect or script["aspect"]
    console.print("\n[bold]Proposed generation[/bold]")
    console.print(f"  Model:    {model_id}")
    console.print(f"  Aspect:   {aspect}")
    console.print(f"  Duration: {script['duration_s']}s")
    console.print(f"  Est cost: ${est:.2f}")
    console.print(f"  Hook:     {script.get('hook_line','?')}")
    console.print(f"  Formula:  {script.get('hook_formula','?')}")
    console.print(f"  CTA:      {script.get('cta_line','?')}")
    console.print(f"  Prompt:   {script['fal_prompt'][:200]}{'...' if len(script['fal_prompt'])>200 else ''}")
    _print_scorecard(script)

    if not args.yes and not Confirm.ask("Proceed?", default=True):
        append_run(args.offer, {
            "run_id": rd.name.split("-")[-1],
            "run_dir": str(rd),
            "model": model_id, "cost_usd": 0, "duration_s": script["duration_s"],
            "status": "aborted", "competitor_source": args.input,
            "output_path": None,
        })
        console.print("[yellow]Aborted[/yellow]")
        return 0

    # Stage 4: Fal generation
    image_path = Path(args.image).expanduser() if args.image else None
    try:
        fal_result = fal_generate(
            model_id=model_id, prompt=script["fal_prompt"],
            out_dir=rd / "04-generation", duration_s=script["duration_s"],
            aspect=aspect, image_path=image_path,
            on_log=lambda m: console.print(f"[dim]{m}[/dim]"),
        )
    except FalRunnerError as e:
        append_run(args.offer, {
            "run_id": rd.name.split("-")[-1], "run_dir": str(rd),
            "model": model_id, "cost_usd": 0, "duration_s": script["duration_s"],
            "status": "failed", "competitor_source": args.input, "output_path": None,
            "error": str(e),
        })
        console.print(f"[red]{e}[/red]")
        return 7

    append_run(args.offer, {
        "run_id": rd.name.split("-")[-1], "run_dir": str(rd),
        "model": model_id, "cost_usd": est, "duration_s": script["duration_s"],
        "status": "completed", "competitor_source": args.input,
        "output_path": fal_result["output_path"], "fal_url": fal_result["fal_url"],
        "aspect": aspect,
    })
    console.print(f"[bold green]Done: {fal_result['output_path']}[/bold green]")
    console.print(f"[dim]Fal URL: {fal_result['fal_url']}[/dim]")
    return 0


COMMANDS = {
    "run": cmd_run,
    "models": cmd_models,
    "stats": cmd_stats,
    "new-offer": cmd_new_offer,
    "edit-offer": cmd_edit_offer,
    "refresh-offer": cmd_refresh_offer,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cli.py -v
```

Expected: 6 passed.

- [x] **Step 5: Full test suite check**

```bash
pytest
```

Expected: all tests across all modules pass (~68 tests).

- [x] **Step 6: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 11 — cli argparse wiring

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 12: `SKILL.md` — user-facing skill definition

**Files:**
- Create: `~/.claude/skills/videoad/SKILL.md`

- [x] **Step 1: Write SKILL.md**

File: `~/.claude/skills/videoad/SKILL.md`

```markdown
---
name: videoad
description: Video ad creation via Fal.ai. Analyzes a competitor video, reverse-engineers the concept for one of the user's offer briefs in ~/.claude/offers/<slug>.md, generates a scene-by-scene script, and produces a real video via Fal.ai (Kling, Veo, Minimax, Runway, etc.). Triggers on "/videoad", "make a video ad", "rip this video ad", "turn this into an ad for <offer>", "videoad stats", "videoad models".
---

# `/videoad` — Fal.ai Video Ad Creator

Turns competitor video ads into new ads for your offers.

## Setup (one-time)

1. `pip install` deps — already done during install:
   ```
   ~/.claude/skills/videoad/venv/bin/pip install -r ~/.claude/skills/videoad/requirements.txt
   ```

2. Ensure `yt-dlp`, `ffmpeg`, `claude` CLI are on `$PATH`:
   ```
   command -v yt-dlp && command -v ffmpeg && command -v claude
   ```

3. Set env vars (persist in `~/.claude/.env` or shell profile):
   ```
   export FAL_KEY="..."
   export GEMINI_API_KEY="..."
   ```
   The `claude -p` calls use your existing OAuth session — no API key needed.

4. Create offer briefs at `~/.claude/offers/<slug>.md` (see `videoad new-offer <slug>` below).

## Running the skill

All commands invoke the Python CLI at `~/.claude/skills/videoad/cli.py`.

```bash
PY=~/.claude/skills/videoad/venv/bin/python
CLI=~/.claude/skills/videoad/cli.py

# Full run with confirmation gate
$PY $CLI run <url-or-file> --offer <slug>

# Auto-confirm (skip approval gate)
$PY $CLI run <url-or-file> --offer <slug> --yes

# Override model
$PY $CLI run <url-or-file> --offer <slug> --model fal-ai/veo/3.1

# Shortcuts
$PY $CLI run <url-or-file> --offer <slug> --fast        # minimax/hailuo-02/standard
$PY $CLI run <url-or-file> --offer <slug> --premium     # veo/3.1

# Image-to-video (pass a source image)
$PY $CLI run <url-or-file> --offer <slug> --image ~/products/patch.jpg \
  --model fal-ai/kling-video/v2.1/image-to-video

# Dry run (stages 0-3, no Fal charge)
$PY $CLI run <url-or-file> --offer <slug> --dry-run

# Resume a failed run
$PY $CLI run <url-or-file> --offer <slug> --resume <run-id>

# Stats
$PY $CLI stats --offer <slug>

# Model catalog
$PY $CLI models

# Offer management
$PY $CLI new-offer <slug>
$PY $CLI edit-offer <slug>
$PY $CLI refresh-offer <slug>
```

## Parsing user intent

When the user types `/videoad`, match their intent:

| User says | Invoke |
|---|---|
| "/videoad <url>" | `run <url>` with no offer → prompt user to pick, or infer from convo |
| "/videoad <url> --offer akemi" | `run <url> --offer akemi` |
| "/videoad make a video ad for akemi from <url>" | `run <url> --offer akemi` |
| "/videoad stats" or "/videoad stats for akemi" | `stats --offer <slug>` |
| "/videoad models" | `models` |
| "/videoad new offer akemi" | `new-offer akemi` |
| "/videoad what offers do I have?" | Read `~/.claude/offers/*.md` names, show list |

If user didn't pass `--offer`, check the current conversation context for an active offer; if none obvious, list available slugs and ask.

## Expected artifacts per run

```
~/videos/<offer-slug>/<YYYY-MM-DD-HHMM>-<run-id>/
  00-input/source.mp4         ← competitor video
  00-input/metadata.json
  01-teardown.md              ← Gemini analysis
  02-concept.md               ← Claude reverse-engineer for MY offer
  03-script.json              ← scene-by-scene script
  04-generation/out.mp4       ← final generated video
  04-generation/fal-job.json  ← Fal request/response
```

Plus one line appended to `~/.claude/offers/<slug>.jsonl` per run.

## Troubleshooting

- `FAL_KEY not set` — add to `~/.claude/.env`
- `GEMINI_API_KEY not set` — add to `~/.claude/.env`
- `claude -p failed: not logged in` — run `claude login`
- `yt-dlp failed` for FB Ad Library — download manually, run with local path
- Fal safety rejection — edit `03-script.json` manually, then `--resume <run-id>`
```

- [x] **Step 2: Verify skill is discoverable**

Restart Claude Code or reload skills. Confirm `/videoad` appears in skill list.

- [x] **Step 3: Commit**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 12 — SKILL.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 13: Live smoke test + first real generation

**Files:**
- None new (uses existing infrastructure).

- [ ] **Step 1: Dry-run against a real competitor URL**

Pick a real FB Ad Library URL for a competitor of `akemi-slim-patch` (e.g., a purisaki.com ad).

```bash
PY=~/.claude/skills/videoad/venv/bin/python
CLI=~/.claude/skills/videoad/cli.py
$PY $CLI run "<fb-ad-library-url>" --offer akemi-slim-patch --dry-run
```

Expected:
- Input fetched (or fallback to manual download if FB blocks yt-dlp)
- `01-teardown.md` populated with structured teardown
- `02-concept.md` populated with hook rewrites matching Akemi's angle
- `03-script.json` valid JSON with scenes, fal_prompt, suggested model
- Command exits 0 without calling Fal

If FB Ad Library fails: download the video via a browser, pass the local path as `<input>`.

- [ ] **Step 2: Inspect outputs**

```bash
RD=$(ls -td ~/videos/akemi-slim-patch/*/ | head -1)
echo "Run dir: $RD"
cat "$RD/01-teardown.md" | head -40
echo "---"
cat "$RD/02-concept.md" | head -40
echo "---"
jq '.title, .fal_prompt, .suggested_model_category' "$RD/03-script.json"
```

- [ ] **Step 3: Live run with cheapest model**

```bash
$PY $CLI run "<url-or-local-path>" --offer akemi-slim-patch --fast --yes
```

Expected:
- Proceeds past approval gate (due to --yes)
- Fal generation completes in ~60-120s
- `out.mp4` lands at `~/videos/akemi-slim-patch/.../04-generation/out.mp4`
- One line appended to `~/.claude/offers/akemi-slim-patch.jsonl` with `status:"completed"`

- [ ] **Step 4: Stats check**

```bash
$PY $CLI stats --offer akemi-slim-patch
```

Expected: `1 runs, 1 successful, ~$0.28 total`.

- [ ] **Step 5: Visual verification**

Open `out.mp4` and confirm it renders. Compare against `03-script.json` — does the video reflect the prompt? If obvious quality issues (black frames, garbled audio, wrong aspect), document in a follow-up plan; don't retrofit here.

- [ ] **Step 6: Mark plan complete**

```bash
cd /home/roly/iscale-facebook-ad-builder
git add docs/superpowers/plans/2026-04-16-videoad-skill.md
git commit -m "feat(videoad): task 13 — smoke + live test, skill v1 complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Critique threshold tuning

`MIN_DAY1_READINESS = 7` in `lib/script.py` is the bar. If it's too strict (scripts always fail critique) or too lenient (bad scripts pass), tune the constant in one place. Track what happens on the first 20 real runs:

```bash
jq -r 'select(._critique?) | [._critique.score, ._critique.passes, .hook_line] | @tsv' ~/videos/*/*/03-script.json
```

If >50% of scripts pass critique on first try → floor may be too low; consider raising to 8.
If <10% pass → floor too high or prompts are weak; lower to 6 and/or strengthen `prompts/script.md`.

---

## Known risks / follow-ups (not in v1)

- **Fal model ID drift** — IDs in `model_catalog.py` may go stale. `/videoad models --refresh` hook is stubbed but not wired; add a follow-up to hit Fal's public catalog endpoint when Fal publishes one.
- **FB Ad Library downloads** — yt-dlp support varies; if it breaks for a month, consider reusing the existing `backend/app/services/ad_library_scraper.py` logic by porting it into the skill (or shell-out to it).
- **Cost estimates are approximate** — Fal bills by GPU time. Live costs will vary ±30%.
- **No R2 upload** — generated videos stay on local disk. If the user wants cloud-synced history, add a post-generation R2 upload + update jsonl with public URL. Straightforward extension.
- **No variant batching** — one script per run. If the user wants 5 variants per concept, extend the script stage to emit `alt_scripts[]` and loop Fal calls with a `--variants N` flag.
- **No integration with `VideoAds.jsx`** — the wizard stubs at steps 4-5 stay untouched. A future plan could lift the pipeline into `/api/v1/fal-video/*` endpoints with R2 writes + `video_generations` table to serve both the CLI and the wizard.

---
