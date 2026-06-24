# LiveIntent Spy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone tool that subscribes to publisher newsletters, parses LiveIntent ad slots out of rendered emails, classifies advertisers by vertical, and surfaces top advertisers via Telegram daily digest + Next.js dashboard.

**Architecture:** Three deployable units — `scraper-worker` and `enrichment-worker` on a single Hetzner box (Python + Playwright + Tesseract + co-located Postgres), `api` (FastAPI on Railway), `web` (Next.js on Vercel). Shared SQLAlchemy models in a `shared` package. Single admin bearer token, Telegram-first UX. Spec: `docs/superpowers/specs/2026-04-27-liveintent-spy-design.md`.

**Tech Stack:**
- Python 3.12, Playwright (Chromium), imapclient, mail-parser, BeautifulSoup, SQLAlchemy 2.x, Alembic, FastAPI, uvicorn, click, pytest, respx (HTTP mocking), pytesseract
- Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui
- Postgres 16 (Hetzner local), systemd, Docker (local dev only), Tailscale (private link)
- `claude -p` OAuth (with `ANTHROPIC_API_KEY` fallback)

---

## File Structure

New repo at `/home/roly/liveintent-spy/`:

```
liveintent-spy/
├── packages/
│   ├── shared/
│   │   ├── liveintent_shared/
│   │   │   ├── __init__.py
│   │   │   ├── config.py          # env loader (pydantic-settings)
│   │   │   ├── db.py              # SQLAlchemy engine/session factories
│   │   │   ├── models.py          # 6 ORM models
│   │   │   ├── enums.py           # Vertical, VerticalSource enums
│   │   │   └── logging.py         # structured logging setup
│   │   ├── alembic/
│   │   │   ├── env.py
│   │   │   └── versions/0001_init.py
│   │   ├── alembic.ini
│   │   └── pyproject.toml
│   │
│   ├── scraper/
│   │   ├── liveintent_scraper/
│   │   │   ├── __init__.py
│   │   │   ├── main.py            # entrypoint, run-loop
│   │   │   ├── imap_poll.py       # IMAP fetch + per-email dispatch
│   │   │   ├── render.py          # Playwright render of email HTML
│   │   │   ├── parse.py           # DOM → list[AdSlot]
│   │   │   ├── selectors.py       # LiveIntent slot CSS selectors (versioned)
│   │   │   ├── screenshot.py      # element screenshot + hash
│   │   │   ├── resolve.py         # click-tracker → final URL + advertiser upsert
│   │   │   └── persist.py         # insert email/creative/impression rows
│   │   ├── tests/
│   │   │   ├── fixtures/          # .eml files
│   │   │   ├── test_parse.py
│   │   │   ├── test_resolve.py
│   │   │   ├── test_screenshot.py
│   │   │   └── test_persist.py
│   │   └── pyproject.toml
│   │
│   ├── enrichment/
│   │   ├── liveintent_enrichment/
│   │   │   ├── __init__.py
│   │   │   ├── main.py            # entrypoint, run-loop
│   │   │   ├── classify.py        # claude-p call w/ API-key fallback
│   │   │   ├── ocr.py             # tesseract on screenshots
│   │   │   └── jobs.py            # work-queue scan over advertisers/creatives
│   │   ├── tests/
│   │   │   ├── test_classify.py
│   │   │   └── test_ocr.py
│   │   └── pyproject.toml
│   │
│   └── api/
│       ├── liveintent_api/
│       │   ├── __init__.py
│       │   ├── main.py            # FastAPI app
│       │   ├── auth.py            # admin bearer dependency
│       │   ├── routes/
│       │   │   ├── advertisers.py
│       │   │   ├── publishers.py
│       │   │   ├── creatives.py
│       │   │   ├── digest.py
│       │   │   ├── admin.py
│       │   │   └── telegram.py
│       │   ├── digest_compute.py  # ranking queries
│       │   ├── digest_format.py   # Telegram message construction
│       │   └── telegram_client.py
│       ├── tests/
│       │   ├── test_advertisers.py
│       │   ├── test_digest_compute.py
│       │   ├── test_digest_format.py
│       │   └── test_telegram_routes.py
│       └── pyproject.toml
│
├── apps/
│   └── web/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx              # top advertisers
│       │   ├── advertisers/[domain]/page.tsx
│       │   ├── publishers/[domain]/page.tsx
│       │   └── api/health/route.ts
│       ├── lib/api.ts                # fetch wrapper w/ admin token
│       ├── components/               # shadcn-installed
│       ├── package.json
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── tsconfig.json
│
├── cli/
│   ├── liveintent_cli/
│   │   ├── __init__.py
│   │   ├── main.py                # click group
│   │   ├── publishers.py
│   │   ├── advertisers.py
│   │   └── export.py
│   └── pyproject.toml
│
├── infra/
│   ├── systemd/
│   │   ├── scraper-worker.service
│   │   └── enrichment-worker.service
│   ├── deploy.sh                  # Hetzner provisioning
│   ├── backup.sh                  # nightly pg_dump → B2
│   └── README.md
│
├── docker-compose.yml             # local dev: postgres only
├── pyproject.toml                 # workspace root (uv workspace)
├── uv.lock
├── .env.example
├── .gitignore
└── README.md
```

**Why this layout:**
- One Python workspace (uv) so all packages share a venv and `liveintent_shared` is editable across them.
- `shared` is the only package without external IO — pure models + config — so it's the natural test-double seam.
- `scraper`'s files are split by stage of the pipeline (Flow B/C from spec). Each file <200 lines, one responsibility.
- `web` is its own pnpm package, no Python coupling.
- Alembic migrations live with `shared` (they own the schema).

---

## Phase 0: Repo Bootstrap

### Task 0.1: Create repo + workspace skeleton

**Files:**
- Create: `/home/roly/liveintent-spy/` (new dir)
- Create: `pyproject.toml`, `.gitignore`, `README.md`, `.env.example`

- [ ] **Step 1: Create directories**

```bash
mkdir -p /home/roly/liveintent-spy/{packages/{shared,scraper,enrichment,api}/tests,packages/shared/{liveintent_shared,alembic/versions},apps/web,cli/liveintent_cli,infra/systemd}
cd /home/roly/liveintent-spy
git init -b main
```

- [ ] **Step 2: Write workspace pyproject**

Create `pyproject.toml`:

```toml
[project]
name = "liveintent-spy"
version = "0.1.0"
requires-python = ">=3.12"

[tool.uv.workspace]
members = ["packages/*", "cli"]

[tool.uv.sources]
liveintent-shared = { workspace = true }
liveintent-scraper = { workspace = true }
liveintent-enrichment = { workspace = true }
liveintent-api = { workspace = true }
liveintent-cli = { workspace = true }

[tool.pytest.ini_options]
testpaths = ["packages/*/tests"]
asyncio_mode = "auto"
```

- [ ] **Step 3: Write .gitignore**

Create `.gitignore`:

```
__pycache__/
*.pyc
.venv/
.env
.env.*
!.env.example
*.db
*.sqlite
node_modules/
.next/
.turbo/
dist/
build/
.pytest_cache/
.ruff_cache/
.coverage
htmlcov/
data/
screenshots/
emails_raw/
```

- [ ] **Step 4: Write .env.example**

Create `.env.example`:

```
DATABASE_URL=postgresql+psycopg://liveintent:liveintent@localhost:5432/liveintent
IMAP_HOST=imap.improvmx.com
IMAP_USER=catchall@yourdomain.com
IMAP_PASS=changeme
ADMIN_TOKEN=changeme-long-random-string
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ANTHROPIC_API_KEY=
CLAUDE_OAUTH_REFRESH_TOKEN=
DATA_DIR=./data
SCRAPER_POLL_INTERVAL_SECONDS=300
ENRICHMENT_POLL_INTERVAL_SECONDS=120
LOG_LEVEL=INFO
```

- [ ] **Step 5: Write minimal README**

Create `README.md`:

```markdown
# liveintent-spy

LiveIntent ad spy tool. See `docs/superpowers/specs/2026-04-27-liveintent-spy-design.md` in the parent project for design.

## Quick start

```
cp .env.example .env       # edit values
docker compose up -d       # local Postgres
uv sync
uv run alembic -c packages/shared/alembic.ini upgrade head
uv run python -m liveintent_scraper.main
```
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: bootstrap workspace skeleton"
```

### Task 0.2: Add docker-compose for local Postgres

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write docker-compose**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: liveintent
      POSTGRES_PASSWORD: liveintent
      POSTGRES_DB: liveintent
    ports:
      - "5432:5432"
    volumes:
      - liveintent_pg:/var/lib/postgresql/data

volumes:
  liveintent_pg:
```

- [ ] **Step 2: Verify it boots**

```bash
docker compose up -d
docker compose exec postgres psql -U liveintent -c "SELECT 1;"
docker compose down
```

Expected: prints `?column? \n--- \n  1` then container stops.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add local postgres compose file"
```

---

## Phase 1: Shared Package — Models + Migrations

### Task 1.1: Shared package pyproject + enums

**Files:**
- Create: `packages/shared/pyproject.toml`
- Create: `packages/shared/liveintent_shared/__init__.py`
- Create: `packages/shared/liveintent_shared/enums.py`

- [ ] **Step 1: Write pyproject**

Create `packages/shared/pyproject.toml`:

```toml
[project]
name = "liveintent-shared"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "sqlalchemy>=2.0",
  "psycopg[binary]>=3.2",
  "alembic>=1.13",
  "pydantic-settings>=2.6",
  "structlog>=24.4",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["liveintent_shared"]
```

- [ ] **Step 2: Write enums**

Create `packages/shared/liveintent_shared/enums.py`:

```python
from enum import StrEnum

class Vertical(StrEnum):
    SUPPLEMENTS = "supplements"
    FINANCE = "finance"
    INSURANCE = "insurance"
    SWEEPS = "sweeps"
    AUTO = "auto"
    SOLAR = "solar"
    HEALTH = "health"
    CRYPTO = "crypto"
    OTHER = "other"
    UNCLASSIFIED = "unclassified"

class VerticalSource(StrEnum):
    AUTO = "auto"
    MANUAL = "manual"
```

- [ ] **Step 3: Init __init__.py**

Create `packages/shared/liveintent_shared/__init__.py`:

```python
__all__ = ["enums"]
```

- [ ] **Step 4: Sync and verify import**

```bash
uv sync
uv run python -c "from liveintent_shared.enums import Vertical; print(Vertical.SUPPLEMENTS)"
```

Expected: `supplements`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add package skeleton + vertical enums"
```

### Task 1.2: Config loader

**Files:**
- Create: `packages/shared/liveintent_shared/config.py`
- Create: `packages/shared/tests/__init__.py`
- Create: `packages/shared/tests/test_config.py`

- [ ] **Step 1: Write failing test**

Create `packages/shared/tests/test_config.py`:

```python
import os
from liveintent_shared.config import Settings

def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://x:y@host:5432/db")
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    monkeypatch.setenv("IMAP_HOST", "imap.example.com")
    monkeypatch.setenv("IMAP_USER", "u")
    monkeypatch.setenv("IMAP_PASS", "p")
    s = Settings()
    assert s.database_url == "postgresql+psycopg://x:y@host:5432/db"
    assert s.admin_token == "secret"
    assert s.scraper_poll_interval_seconds == 300  # default

def test_settings_data_dir_default():
    s = Settings(_env_file=None, database_url="x", admin_token="x", imap_host="x", imap_user="x", imap_pass="x")
    assert s.data_dir.endswith("data")
```

- [ ] **Step 2: Run, expect failure**

```bash
uv run pytest packages/shared/tests/test_config.py -v
```

Expected: ImportError or ModuleNotFoundError on `liveintent_shared.config`.

- [ ] **Step 3: Implement config**

Create `packages/shared/liveintent_shared/config.py`:

```python
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    admin_token: str
    imap_host: str
    imap_user: str
    imap_pass: str

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    anthropic_api_key: str = ""
    claude_oauth_refresh_token: str = ""

    data_dir: str = "./data"
    scraper_poll_interval_seconds: int = 300
    enrichment_poll_interval_seconds: int = 120
    log_level: str = "INFO"

def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest packages/shared/tests/test_config.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add settings loader"
```

### Task 1.3: SQLAlchemy models

**Files:**
- Create: `packages/shared/liveintent_shared/models.py`
- Create: `packages/shared/liveintent_shared/db.py`
- Create: `packages/shared/tests/test_models.py`

- [ ] **Step 1: Write failing test**

Create `packages/shared/tests/test_models.py`:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from liveintent_shared.models import Base, Publisher, Advertiser, Creative, Impression, EmailRaw, DigestRun
from liveintent_shared.enums import Vertical, VerticalSource

@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s

def test_publisher_creation(db):
    p = Publisher(domain="morningbrew.com", name="Morning Brew", seed_email_address="mb@x.com")
    db.add(p); db.flush()
    assert p.id is not None
    assert p.active is True

def test_advertiser_defaults(db):
    a = Advertiser(domain="newchapter.com")
    db.add(a); db.flush()
    assert a.vertical == Vertical.UNCLASSIFIED
    assert a.vertical_source == VerticalSource.AUTO

def test_creative_unique_hash(db):
    a = Advertiser(domain="x.com"); db.add(a); db.flush()
    c1 = Creative(advertiser_id=a.id, creative_hash="abc123", screenshot_path="/x", click_tracker_url="http://x")
    db.add(c1); db.flush()
    c2 = Creative(advertiser_id=a.id, creative_hash="abc123", screenshot_path="/y", click_tracker_url="http://y")
    db.add(c2)
    with pytest.raises(Exception):
        db.flush()

def test_impression_relations(db):
    p = Publisher(domain="p.com", seed_email_address="p@x.com"); db.add(p)
    a = Advertiser(domain="a.com"); db.add(a); db.flush()
    e = EmailRaw(publisher_id=p.id, imap_uid=1, subject="s", from_addr="x", raw_html_path="/x"); db.add(e)
    c = Creative(advertiser_id=a.id, creative_hash="h", screenshot_path="/s", click_tracker_url="http://t"); db.add(c); db.flush()
    i = Impression(creative_id=c.id, publisher_id=p.id, email_id=e.id); db.add(i); db.flush()
    assert i.id is not None
```

- [ ] **Step 2: Run, expect failure**

```bash
uv run pytest packages/shared/tests/test_models.py -v
```

Expected: ImportError on models module.

- [ ] **Step 3: Implement models**

Create `packages/shared/liveintent_shared/models.py`:

```python
from datetime import datetime
from sqlalchemy import (
    BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, Index, func
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from .enums import Vertical, VerticalSource

class Base(DeclarativeBase):
    pass

class Publisher(Base):
    __tablename__ = "publishers"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    domain: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    seed_email_address: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    subscribed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_email_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

class EmailRaw(Base):
    __tablename__ = "emails_raw"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    publisher_id: Mapped[int] = mapped_column(ForeignKey("publishers.id"), nullable=False)
    imap_uid: Mapped[int] = mapped_column(BigInteger, nullable=False)
    subject: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    from_addr: Mapped[str | None] = mapped_column(String(320))
    raw_html_path: Mapped[str] = mapped_column(Text, nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processing_error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        Index("ix_emails_publisher_received", "publisher_id", "received_at"),
        UniqueConstraint("publisher_id", "imap_uid", name="uq_emails_publisher_uid"),
    )

class Advertiser(Base):
    __tablename__ = "advertisers"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    domain: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    vertical: Mapped[str] = mapped_column(String(32), default=Vertical.UNCLASSIFIED.value, nullable=False)
    vertical_source: Mapped[str] = mapped_column(String(16), default=VerticalSource.AUTO.value, nullable=False)
    vertical_classified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text)

class Creative(Base):
    __tablename__ = "creatives"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    advertiser_id: Mapped[int] = mapped_column(ForeignKey("advertisers.id"), nullable=False)
    creative_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    headline: Mapped[str | None] = mapped_column(Text)
    screenshot_path: Mapped[str] = mapped_column(Text, nullable=False)
    click_tracker_url: Mapped[str] = mapped_column(Text, nullable=False)
    final_landing_url: Mapped[str | None] = mapped_column(Text)
    final_landing_url_resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Impression(Base):
    __tablename__ = "impressions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    creative_id: Mapped[int] = mapped_column(ForeignKey("creatives.id"), nullable=False)
    publisher_id: Mapped[int] = mapped_column(ForeignKey("publishers.id"), nullable=False)
    email_id: Mapped[int] = mapped_column(ForeignKey("emails_raw.id"), nullable=False)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("ix_impressions_creative_seen", "creative_id", "seen_at"),
        Index("ix_impressions_publisher_seen", "publisher_id", "seen_at"),
    )

class DigestRun(Base):
    __tablename__ = "digest_runs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    top_advertisers_json: Mapped[str] = mapped_column(Text, nullable=False)
    telegram_message_id: Mapped[str | None] = mapped_column(String(64))
```

- [ ] **Step 4: Implement db session helpers**

Create `packages/shared/liveintent_shared/db.py`:

```python
from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from .config import get_settings

_engine = None
_Session = None

def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    return _engine

def get_session_factory():
    global _Session
    if _Session is None:
        _Session = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _Session

@contextmanager
def session_scope():
    s: Session = get_session_factory()()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
```

- [ ] **Step 5: Run, expect pass**

```bash
uv run pytest packages/shared/tests/test_models.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add ORM models + session helpers"
```

### Task 1.4: Alembic init + first migration

**Files:**
- Create: `packages/shared/alembic.ini`
- Create: `packages/shared/alembic/env.py`
- Create: `packages/shared/alembic/script.py.mako`
- Create: `packages/shared/alembic/versions/0001_initial.py`

- [ ] **Step 1: Write alembic.ini**

Create `packages/shared/alembic.ini`:

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
version_path_separator = os

[loggers]
keys = root,sqlalchemy,alembic
[handlers]
keys = console
[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 2: Write env.py**

Create `packages/shared/alembic/env.py`:

```python
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from liveintent_shared.config import get_settings
from liveintent_shared.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata

def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

run_migrations_online()
```

- [ ] **Step 3: Write script.py.mako**

Create `packages/shared/alembic/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}

def upgrade():
    ${upgrades if upgrades else "pass"}

def downgrade():
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 4: Generate initial migration**

```bash
docker compose up -d
cd /home/roly/liveintent-spy
uv run alembic -c packages/shared/alembic.ini revision --autogenerate -m "initial"
```

This creates `packages/shared/alembic/versions/<hash>_initial.py`. Rename to `0001_initial.py` for ordering. Inspect it — it should have `op.create_table` calls for publishers, emails_raw, advertisers, creatives, impressions, digest_runs.

- [ ] **Step 5: Apply migration**

```bash
uv run alembic -c packages/shared/alembic.ini upgrade head
docker compose exec postgres psql -U liveintent -c "\dt"
```

Expected: all 6 tables + `alembic_version` listed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/alembic*
git commit -m "feat(shared): add alembic with initial migration"
```

---

## Phase 2: Scraper — IMAP + Render + Parse

### Task 2.1: Scraper package skeleton

**Files:**
- Create: `packages/scraper/pyproject.toml`
- Create: `packages/scraper/liveintent_scraper/__init__.py`

- [ ] **Step 1: Write pyproject**

Create `packages/scraper/pyproject.toml`:

```toml
[project]
name = "liveintent-scraper"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "liveintent-shared",
  "imapclient>=3.0",
  "mail-parser>=4.0",
  "playwright>=1.49",
  "beautifulsoup4>=4.12",
  "httpx>=0.28",
  "tldextract>=5.1",
  "structlog>=24.4",
]

[project.optional-dependencies]
test = ["pytest>=8.3", "pytest-asyncio>=0.24", "respx>=0.21"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["liveintent_scraper"]
```

- [ ] **Step 2: Init __init__.py**

Create `packages/scraper/liveintent_scraper/__init__.py`:

```python
__all__: list[str] = []
```

- [ ] **Step 3: Sync workspace**

```bash
uv sync --all-extras
uv run playwright install chromium
```

- [ ] **Step 4: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): add package skeleton"
```

### Task 2.2: Slot data model + selector config

**Files:**
- Create: `packages/scraper/liveintent_scraper/selectors.py`
- Create: `packages/scraper/tests/__init__.py`

- [ ] **Step 1: Write selectors module**

Create `packages/scraper/liveintent_scraper/selectors.py`:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class AdSlot:
    """One LiveIntent ad slot found in a rendered email."""
    slot_index: int           # 0-based position within the email
    click_tracker_url: str    # href of the wrapping <a>
    image_src: str | None     # src of the <img> if present
    selector_used: str        # which selector matched (for debug)

# CSS selectors for LiveIntent ad slots, ordered by specificity.
# Stored as a list so we can hot-reload from DB later (R1 mitigation).
LIVEINTENT_SELECTORS: list[str] = [
    'a[href*="li/r/"]',
    'a[href*="track.liveintent.com"]',
    'a[href*="liveintent.com/r/"]',
]
```

- [ ] **Step 2: Init tests dir**

Create `packages/scraper/tests/__init__.py` (empty file).

- [ ] **Step 3: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): add slot dataclass + selectors"
```

### Task 2.3: HTML parser — find LiveIntent slots (TDD)

**Files:**
- Create: `packages/scraper/tests/fixtures/sample_email_one_slot.html`
- Create: `packages/scraper/tests/fixtures/sample_email_no_slots.html`
- Create: `packages/scraper/tests/fixtures/sample_email_multi_slot.html`
- Create: `packages/scraper/liveintent_scraper/parse.py`
- Create: `packages/scraper/tests/test_parse.py`

- [ ] **Step 1: Create HTML fixtures**

Create `packages/scraper/tests/fixtures/sample_email_one_slot.html`:

```html
<html><body>
<p>Newsletter content here.</p>
<div class="li-ad-wrapper">
  <a href="https://track.liveintent.com/li/r/abc123?u=newchapter.com">
    <img src="https://cdn.liveintent.com/creative/img1.jpg" alt="ad">
  </a>
</div>
<p>More content.</p>
</body></html>
```

Create `packages/scraper/tests/fixtures/sample_email_no_slots.html`:

```html
<html><body>
<p>Pure content, no ads.</p>
<a href="https://example.com">regular link</a>
</body></html>
```

Create `packages/scraper/tests/fixtures/sample_email_multi_slot.html`:

```html
<html><body>
<a href="https://track.liveintent.com/li/r/aaa?u=advertiser1.com">
  <img src="https://cdn.liveintent.com/creative/a.jpg">
</a>
<p>middle content</p>
<a href="https://liveintent.com/r/bbb?u=advertiser2.com">
  <img src="https://cdn.liveintent.com/creative/b.jpg">
</a>
</body></html>
```

- [ ] **Step 2: Write failing tests**

Create `packages/scraper/tests/test_parse.py`:

```python
from pathlib import Path
from liveintent_scraper.parse import find_ad_slots

FIXTURES = Path(__file__).parent / "fixtures"

def _load(name: str) -> str:
    return (FIXTURES / name).read_text()

def test_one_slot():
    slots = find_ad_slots(_load("sample_email_one_slot.html"))
    assert len(slots) == 1
    assert slots[0].slot_index == 0
    assert "track.liveintent.com" in slots[0].click_tracker_url
    assert slots[0].image_src == "https://cdn.liveintent.com/creative/img1.jpg"

def test_no_slots():
    slots = find_ad_slots(_load("sample_email_no_slots.html"))
    assert slots == []

def test_multiple_slots_indexed_in_order():
    slots = find_ad_slots(_load("sample_email_multi_slot.html"))
    assert len(slots) == 2
    assert [s.slot_index for s in slots] == [0, 1]
    assert "advertiser1" in slots[0].click_tracker_url
    assert "advertiser2" in slots[1].click_tracker_url

def test_slot_records_selector_used():
    slots = find_ad_slots(_load("sample_email_one_slot.html"))
    assert slots[0].selector_used in (
        'a[href*="li/r/"]',
        'a[href*="track.liveintent.com"]',
        'a[href*="liveintent.com/r/"]',
    )
```

- [ ] **Step 3: Run, expect failure**

```bash
uv run pytest packages/scraper/tests/test_parse.py -v
```

Expected: ImportError on `liveintent_scraper.parse`.

- [ ] **Step 4: Implement parse.py**

Create `packages/scraper/liveintent_scraper/parse.py`:

```python
from bs4 import BeautifulSoup
from .selectors import AdSlot, LIVEINTENT_SELECTORS

def find_ad_slots(html: str) -> list[AdSlot]:
    soup = BeautifulSoup(html, "html.parser")
    slots: list[AdSlot] = []
    seen_anchors: set[int] = set()

    for selector in LIVEINTENT_SELECTORS:
        for a in soup.select(selector):
            anchor_id = id(a)
            if anchor_id in seen_anchors:
                continue
            seen_anchors.add(anchor_id)
            href = a.get("href")
            if not href:
                continue
            img = a.find("img")
            img_src = img.get("src") if img else None
            slots.append(AdSlot(
                slot_index=len(slots),
                click_tracker_url=str(href),
                image_src=str(img_src) if img_src else None,
                selector_used=selector,
            ))
    return slots
```

- [ ] **Step 5: Run, expect pass**

```bash
uv run pytest packages/scraper/tests/test_parse.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): parse LiveIntent ad slots from HTML"
```

### Task 2.4: Click-tracker URL resolver (TDD with respx)

**Files:**
- Create: `packages/scraper/liveintent_scraper/resolve.py`
- Create: `packages/scraper/tests/test_resolve.py`

- [ ] **Step 1: Write failing tests**

Create `packages/scraper/tests/test_resolve.py`:

```python
import pytest
import httpx
import respx
from liveintent_scraper.resolve import resolve_final_url, extract_advertiser_domain

@respx.mock
def test_follows_single_redirect():
    respx.get("https://track.liveintent.com/li/r/abc").mock(
        return_value=httpx.Response(302, headers={"location": "https://newchapter.com/landing?utm=x"})
    )
    respx.get("https://newchapter.com/landing").mock(return_value=httpx.Response(200))
    final = resolve_final_url("https://track.liveintent.com/li/r/abc")
    assert final == "https://newchapter.com/landing?utm=x"

@respx.mock
def test_follows_multi_hop_redirects():
    respx.get("https://track.liveintent.com/li/r/abc").mock(
        return_value=httpx.Response(302, headers={"location": "https://hop1.com/x"})
    )
    respx.get("https://hop1.com/x").mock(
        return_value=httpx.Response(302, headers={"location": "https://final.com/lp"})
    )
    respx.get("https://final.com/lp").mock(return_value=httpx.Response(200))
    final = resolve_final_url("https://track.liveintent.com/li/r/abc")
    assert final == "https://final.com/lp"

@respx.mock
def test_caps_at_max_redirects():
    for i in range(15):
        respx.get(f"https://hop{i}.com/").mock(
            return_value=httpx.Response(302, headers={"location": f"https://hop{i+1}.com/"})
        )
    final = resolve_final_url("https://hop0.com/", max_redirects=10)
    assert final is None  # exceeded budget

@respx.mock
def test_returns_none_on_timeout():
    respx.get("https://slow.com").mock(side_effect=httpx.TimeoutException("slow"))
    assert resolve_final_url("https://slow.com") is None

def test_advertiser_domain_extracts_etld_plus_one():
    assert extract_advertiser_domain("https://www.newchapter.com/products/x?u=y") == "newchapter.com"
    assert extract_advertiser_domain("https://shop.example.co.uk/p") == "example.co.uk"
    assert extract_advertiser_domain("invalid") is None
```

- [ ] **Step 2: Run, expect failure**

```bash
uv run pytest packages/scraper/tests/test_resolve.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement resolve.py**

Create `packages/scraper/liveintent_scraper/resolve.py`:

```python
import httpx
import tldextract
import structlog

log = structlog.get_logger(__name__)

def resolve_final_url(url: str, *, max_redirects: int = 10, timeout: float = 10.0) -> str | None:
    """Follow redirects from the click-tracker URL up to max_redirects.
    Returns the final URL on success, None on timeout/error/redirect-loop."""
    try:
        with httpx.Client(follow_redirects=False, timeout=timeout) as client:
            current = url
            for _ in range(max_redirects + 1):
                resp = client.get(current)
                if resp.status_code in (301, 302, 303, 307, 308):
                    loc = resp.headers.get("location")
                    if not loc:
                        return current
                    current = str(httpx.URL(current).join(loc))
                    continue
                return current
            log.warning("resolve.exceeded_redirect_budget", url=url)
            return None
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        log.warning("resolve.http_error", url=url, error=str(e))
        return None

def extract_advertiser_domain(url: str) -> str | None:
    """Return eTLD+1 (e.g. 'newchapter.com') or None for invalid input."""
    try:
        ext = tldextract.extract(url)
        if not ext.domain or not ext.suffix:
            return None
        return f"{ext.domain}.{ext.suffix}"
    except Exception:
        return None
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest packages/scraper/tests/test_resolve.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): redirect resolver + advertiser domain extraction"
```

### Task 2.5: Playwright render + element screenshot

**Files:**
- Create: `packages/scraper/liveintent_scraper/render.py`
- Create: `packages/scraper/liveintent_scraper/screenshot.py`
- Create: `packages/scraper/tests/test_screenshot.py`

- [ ] **Step 1: Write render.py**

Create `packages/scraper/liveintent_scraper/render.py`:

```python
from contextlib import asynccontextmanager
from playwright.async_api import async_playwright, Browser, Page

@asynccontextmanager
async def browser_context():
    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(headless=True)
        try:
            yield browser
        finally:
            await browser.close()

async def render_email_html(browser: Browser, html: str) -> Page:
    """Render email HTML in a fresh page, wait for network idle so LiveIntent
    pixel/ad-call resolves. Returns the Page (caller is responsible for closing)."""
    page = await browser.new_page()
    await page.set_content(html, wait_until="networkidle", timeout=30_000)
    return page
```

- [ ] **Step 2: Write screenshot.py**

Create `packages/scraper/liveintent_scraper/screenshot.py`:

```python
import hashlib
from pathlib import Path
from playwright.async_api import Page

async def screenshot_slot(page: Page, slot_index: int, *, out_dir: Path) -> tuple[Path, str]:
    """Screenshot the Nth LiveIntent slot in the page. Returns (path, sha256_hash).
    Raises ValueError if the slot can't be located."""
    locators = page.locator(
        'a[href*="li/r/"], a[href*="track.liveintent.com"], a[href*="liveintent.com/r/"]'
    )
    count = await locators.count()
    if slot_index >= count:
        raise ValueError(f"slot_index {slot_index} out of range (found {count})")
    out_dir.mkdir(parents=True, exist_ok=True)
    bytes_ = await locators.nth(slot_index).screenshot(type="png")
    digest = hashlib.sha256(bytes_).hexdigest()
    out_path = out_dir / f"{digest}.png"
    if not out_path.exists():
        out_path.write_bytes(bytes_)
    return out_path, digest
```

- [ ] **Step 3: Write test (uses real Chromium)**

Create `packages/scraper/tests/test_screenshot.py`:

```python
import pytest
from pathlib import Path
from liveintent_scraper.render import browser_context, render_email_html
from liveintent_scraper.screenshot import screenshot_slot

FIXTURES = Path(__file__).parent / "fixtures"

@pytest.mark.asyncio
async def test_screenshot_dedupes_by_hash(tmp_path):
    html = (FIXTURES / "sample_email_one_slot.html").read_text()
    async with browser_context() as browser:
        page = await render_email_html(browser, html)
        try:
            path1, hash1 = await screenshot_slot(page, 0, out_dir=tmp_path)
            path2, hash2 = await screenshot_slot(page, 0, out_dir=tmp_path)
            assert hash1 == hash2
            assert path1 == path2
            assert path1.exists()
        finally:
            await page.close()

@pytest.mark.asyncio
async def test_screenshot_out_of_range(tmp_path):
    html = (FIXTURES / "sample_email_one_slot.html").read_text()
    async with browser_context() as browser:
        page = await render_email_html(browser, html)
        try:
            with pytest.raises(ValueError):
                await screenshot_slot(page, 5, out_dir=tmp_path)
        finally:
            await page.close()
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest packages/scraper/tests/test_screenshot.py -v
```

Expected: 2 passed. (May take 5–10s on first run for browser warmup.)

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): playwright render + element screenshot with hash dedupe"
```

### Task 2.6: Persist captures to DB

**Files:**
- Create: `packages/scraper/liveintent_scraper/persist.py`
- Create: `packages/scraper/tests/test_persist.py`
- Create: `packages/scraper/tests/conftest.py`

- [ ] **Step 1: Write conftest with in-memory DB fixture**

Create `packages/scraper/tests/conftest.py`:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from liveintent_shared.models import Base

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
```

- [ ] **Step 2: Write failing tests**

Create `packages/scraper/tests/test_persist.py`:

```python
from datetime import datetime, timezone
from liveintent_shared.models import Publisher, Advertiser, Creative, Impression, EmailRaw
from liveintent_scraper.persist import (
    upsert_advertiser, upsert_creative, record_impression, record_email
)

def test_record_email_creates_row(db_session):
    p = Publisher(domain="x.com", seed_email_address="x@x.com")
    db_session.add(p); db_session.flush()
    e = record_email(db_session, publisher_id=p.id, imap_uid=42, subject="s", from_addr="f", raw_html_path="/x.html")
    assert e.id is not None
    assert e.imap_uid == 42

def test_upsert_advertiser_creates_then_updates(db_session):
    a1 = upsert_advertiser(db_session, "newchapter.com")
    db_session.flush()
    a2 = upsert_advertiser(db_session, "newchapter.com")
    db_session.flush()
    assert a1.id == a2.id

def test_upsert_creative_dedupes_by_hash(db_session):
    a = upsert_advertiser(db_session, "x.com"); db_session.flush()
    c1 = upsert_creative(db_session, advertiser_id=a.id, creative_hash="abc", screenshot_path="/p1", click_tracker_url="http://t1")
    db_session.flush()
    c2 = upsert_creative(db_session, advertiser_id=a.id, creative_hash="abc", screenshot_path="/p2", click_tracker_url="http://t2")
    db_session.flush()
    assert c1.id == c2.id
    # First insert wins on path/url
    assert c2.screenshot_path == "/p1"

def test_record_impression(db_session):
    p = Publisher(domain="p.com", seed_email_address="p@x.com"); db_session.add(p)
    a = upsert_advertiser(db_session, "a.com"); db_session.flush()
    e = record_email(db_session, publisher_id=p.id, imap_uid=1, subject="s", from_addr="f", raw_html_path="/x")
    c = upsert_creative(db_session, advertiser_id=a.id, creative_hash="h", screenshot_path="/s", click_tracker_url="http://t")
    db_session.flush()
    imp = record_impression(db_session, creative_id=c.id, publisher_id=p.id, email_id=e.id)
    db_session.flush()
    assert imp.id is not None
```

- [ ] **Step 3: Run, expect failure**

```bash
uv run pytest packages/scraper/tests/test_persist.py -v
```

Expected: ImportError on `liveintent_scraper.persist`.

- [ ] **Step 4: Implement persist.py**

Create `packages/scraper/liveintent_scraper/persist.py`:

```python
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from liveintent_shared.models import Advertiser, Creative, EmailRaw, Impression

def record_email(session: Session, *, publisher_id: int, imap_uid: int, subject: str | None,
                 from_addr: str | None, raw_html_path: str) -> EmailRaw:
    e = EmailRaw(
        publisher_id=publisher_id, imap_uid=imap_uid, subject=subject,
        from_addr=from_addr, raw_html_path=raw_html_path,
    )
    session.add(e)
    return e

def upsert_advertiser(session: Session, domain: str) -> Advertiser:
    existing = session.scalar(select(Advertiser).where(Advertiser.domain == domain))
    if existing:
        existing.last_seen_at = datetime.now(timezone.utc)
        return existing
    a = Advertiser(domain=domain)
    session.add(a)
    return a

def upsert_creative(session: Session, *, advertiser_id: int, creative_hash: str,
                    screenshot_path: str, click_tracker_url: str) -> Creative:
    existing = session.scalar(select(Creative).where(Creative.creative_hash == creative_hash))
    if existing:
        existing.last_seen_at = datetime.now(timezone.utc)
        return existing
    c = Creative(
        advertiser_id=advertiser_id, creative_hash=creative_hash,
        screenshot_path=screenshot_path, click_tracker_url=click_tracker_url,
    )
    session.add(c)
    return c

def record_impression(session: Session, *, creative_id: int, publisher_id: int, email_id: int) -> Impression:
    i = Impression(creative_id=creative_id, publisher_id=publisher_id, email_id=email_id)
    session.add(i)
    return i
```

- [ ] **Step 5: Run, expect pass**

```bash
uv run pytest packages/scraper/tests/test_persist.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): persistence helpers for emails/advertisers/creatives/impressions"
```

### Task 2.7: IMAP poller

**Files:**
- Create: `packages/scraper/liveintent_scraper/imap_poll.py`
- Create: `packages/scraper/tests/test_imap_poll.py`
- Create: `packages/scraper/tests/fixtures/test.eml`

- [ ] **Step 1: Create .eml fixture**

Create `packages/scraper/tests/fixtures/test.eml` (a minimal RFC822 email):

```
From: news@morningbrew.com
To: r.alvarez@yourdomain.com
Subject: Test newsletter
Date: Mon, 27 Apr 2026 09:00:00 +0000
Content-Type: text/html

<html><body>Hello <a href="https://track.liveintent.com/li/r/x?u=newchapter.com"><img src="https://cdn.liveintent.com/c.jpg"></a></body></html>
```

- [ ] **Step 2: Write failing test**

Create `packages/scraper/tests/test_imap_poll.py`:

```python
from pathlib import Path
from liveintent_scraper.imap_poll import parse_email_bytes, route_email_to_publisher

FIXTURES = Path(__file__).parent / "fixtures"

def test_parse_email_extracts_html_and_to():
    raw = (FIXTURES / "test.eml").read_bytes()
    parsed = parse_email_bytes(raw)
    assert parsed.to_addr == "r.alvarez@yourdomain.com"
    assert parsed.from_addr == "news@morningbrew.com"
    assert parsed.subject == "Test newsletter"
    assert "track.liveintent.com" in parsed.html_body

def test_route_email_to_publisher_known(db_session):
    from liveintent_shared.models import Publisher
    p = Publisher(domain="morningbrew.com", seed_email_address="r.alvarez@yourdomain.com")
    db_session.add(p); db_session.flush()
    matched = route_email_to_publisher(db_session, "r.alvarez@yourdomain.com")
    assert matched is not None
    assert matched.id == p.id

def test_route_email_to_publisher_unknown(db_session):
    matched = route_email_to_publisher(db_session, "stranger@somewhere.com")
    assert matched is None
```

- [ ] **Step 3: Run, expect failure**

```bash
uv run pytest packages/scraper/tests/test_imap_poll.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement imap_poll.py**

Create `packages/scraper/liveintent_scraper/imap_poll.py`:

```python
import gzip
from dataclasses import dataclass
from pathlib import Path
from email import message_from_bytes
from email.message import Message
from sqlalchemy import select
from sqlalchemy.orm import Session
from imapclient import IMAPClient
import structlog
from liveintent_shared.models import Publisher
from liveintent_shared.config import get_settings

log = structlog.get_logger(__name__)

@dataclass
class ParsedEmail:
    to_addr: str
    from_addr: str
    subject: str
    html_body: str

def _extract_html(msg: Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True) or b""
                return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        return ""
    if msg.get_content_type() == "text/html":
        payload = msg.get_payload(decode=True) or b""
        return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
    return ""

def parse_email_bytes(raw: bytes) -> ParsedEmail:
    msg = message_from_bytes(raw)
    return ParsedEmail(
        to_addr=(msg.get("To") or "").strip(),
        from_addr=(msg.get("From") or "").strip(),
        subject=(msg.get("Subject") or "").strip(),
        html_body=_extract_html(msg),
    )

def route_email_to_publisher(session: Session, to_addr: str) -> Publisher | None:
    return session.scalar(select(Publisher).where(Publisher.seed_email_address == to_addr))

def save_raw_html(html: str, *, data_dir: Path, imap_uid: int) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    out = data_dir / f"{imap_uid}.html.gz"
    out.write_bytes(gzip.compress(html.encode("utf-8")))
    return out

def fetch_new_uids(client: IMAPClient, since_uid: int) -> list[int]:
    """Returns sorted list of UIDs strictly greater than since_uid."""
    client.select_folder("INBOX", readonly=False)
    uids = client.search(["UID", f"{since_uid + 1}:*"])
    return sorted(u for u in uids if u > since_uid)

def fetch_message(client: IMAPClient, uid: int) -> bytes:
    data = client.fetch([uid], ["RFC822"])
    return data[uid][b"RFC822"]
```

- [ ] **Step 5: Run, expect pass**

```bash
uv run pytest packages/scraper/tests/test_imap_poll.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/
git commit -m "feat(scraper): IMAP fetch + email parsing + publisher routing"
```

### Task 2.8: Wire it all together — scraper main loop

**Files:**
- Create: `packages/scraper/liveintent_scraper/main.py`
- Create: `packages/scraper/tests/test_pipeline.py` (smoke test)

- [ ] **Step 1: Implement main.py**

Create `packages/scraper/liveintent_scraper/main.py`:

```python
import asyncio
import sys
import time
from pathlib import Path
from imapclient import IMAPClient
import structlog
from liveintent_shared.config import get_settings
from liveintent_shared.db import session_scope
from liveintent_shared.logging import configure_logging
from .imap_poll import fetch_new_uids, fetch_message, parse_email_bytes, route_email_to_publisher, save_raw_html
from .render import browser_context, render_email_html
from .parse import find_ad_slots
from .screenshot import screenshot_slot
from .resolve import resolve_final_url, extract_advertiser_domain
from .persist import record_email, upsert_advertiser, upsert_creative, record_impression

log = structlog.get_logger(__name__)
LAST_UID_FILE = Path("./data/last_uid.txt")

def _load_last_uid() -> int:
    if LAST_UID_FILE.exists():
        return int(LAST_UID_FILE.read_text().strip() or "0")
    return 0

def _save_last_uid(uid: int) -> None:
    LAST_UID_FILE.parent.mkdir(parents=True, exist_ok=True)
    LAST_UID_FILE.write_text(str(uid))

async def process_email(browser, raw: bytes, *, uid: int, data_dir: Path) -> None:
    parsed = parse_email_bytes(raw)
    with session_scope() as session:
        publisher = route_email_to_publisher(session, parsed.to_addr)
        if not publisher:
            log.info("scraper.unknown_recipient", to=parsed.to_addr, uid=uid)
            return
        html_path = save_raw_html(parsed.html_body, data_dir=data_dir / "emails_raw", imap_uid=uid)
        email_row = record_email(
            session, publisher_id=publisher.id, imap_uid=uid,
            subject=parsed.subject, from_addr=parsed.from_addr, raw_html_path=str(html_path),
        )
        session.flush()
        slots = find_ad_slots(parsed.html_body)
        if not slots:
            email_row.processed_at = _now()
            return
        try:
            page = await render_email_html(browser, parsed.html_body)
        except Exception as e:
            email_row.processing_error = f"render: {e}"
            email_row.processed_at = _now()
            return
        try:
            for slot in slots:
                try:
                    shot_path, digest = await screenshot_slot(
                        page, slot.slot_index, out_dir=data_dir / "screenshots"
                    )
                except Exception as e:
                    log.warning("scraper.screenshot_failed", uid=uid, slot=slot.slot_index, error=str(e))
                    continue
                final_url = resolve_final_url(slot.click_tracker_url)
                advertiser_domain = extract_advertiser_domain(final_url) if final_url else None
                if not advertiser_domain:
                    log.info("scraper.unresolved_advertiser", url=slot.click_tracker_url)
                    continue
                advertiser = upsert_advertiser(session, advertiser_domain)
                session.flush()
                creative = upsert_creative(
                    session, advertiser_id=advertiser.id, creative_hash=digest,
                    screenshot_path=str(shot_path), click_tracker_url=slot.click_tracker_url,
                )
                if final_url and not creative.final_landing_url:
                    creative.final_landing_url = final_url
                    creative.final_landing_url_resolved_at = _now()
                session.flush()
                record_impression(session, creative_id=creative.id, publisher_id=publisher.id, email_id=email_row.id)
            email_row.processed_at = _now()
        finally:
            await page.close()

def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)

async def run_once(data_dir: Path) -> None:
    settings = get_settings()
    last_uid = _load_last_uid()
    with IMAPClient(settings.imap_host, ssl=True) as client:
        client.login(settings.imap_user, settings.imap_pass)
        uids = fetch_new_uids(client, last_uid)
        if not uids:
            log.info("scraper.no_new_emails")
            return
        async with browser_context() as browser:
            for uid in uids:
                raw = fetch_message(client, uid)
                try:
                    await process_email(browser, raw, uid=uid, data_dir=data_dir)
                except Exception as e:
                    log.exception("scraper.process_failed", uid=uid, error=str(e))
                _save_last_uid(uid)

async def run_forever() -> None:
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    while True:
        try:
            await run_once(data_dir)
        except Exception as e:
            log.exception("scraper.loop_iteration_failed", error=str(e))
        await asyncio.sleep(settings.scraper_poll_interval_seconds)

def main() -> None:
    configure_logging()
    asyncio.run(run_forever())

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Add logging.py to shared**

Create `packages/shared/liveintent_shared/logging.py`:

```python
import logging
import structlog
from .config import get_settings

def configure_logging() -> None:
    level = get_settings().log_level
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
    )
```

- [ ] **Step 3: Smoke test the pipeline (no IMAP, but full process_email path)**

Create `packages/scraper/tests/test_pipeline.py`:

```python
import pytest
from pathlib import Path
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from liveintent_shared.models import Base, Publisher, Impression, Advertiser
from liveintent_scraper.main import process_email
from liveintent_scraper.render import browser_context

FIXTURES = Path(__file__).parent / "fixtures"

@pytest.mark.asyncio
async def test_pipeline_records_impression(monkeypatch, tmp_path):
    # Use shared in-process DB, monkeypatch session_scope
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    p = Publisher(domain="morningbrew.com", seed_email_address="r.alvarez@yourdomain.com")
    with Session(engine) as s:
        s.add(p); s.commit(); pub_id = p.id

    from contextlib import contextmanager
    @contextmanager
    def fake_session_scope():
        s = Session(engine)
        try:
            yield s; s.commit()
        finally:
            s.close()
    monkeypatch.setattr("liveintent_scraper.main.session_scope", fake_session_scope)

    # Stub the URL resolver so we don't hit network
    monkeypatch.setattr("liveintent_scraper.main.resolve_final_url", lambda u: "https://newchapter.com/lp")

    raw = (FIXTURES / "test.eml").read_bytes()
    async with browser_context() as browser:
        await process_email(browser, raw, uid=42, data_dir=tmp_path)

    with Session(engine) as s:
        imps = s.scalars(select(Impression)).all()
        ads = s.scalars(select(Advertiser)).all()
        assert len(imps) == 1
        assert len(ads) == 1
        assert ads[0].domain == "newchapter.com"
```

- [ ] **Step 4: Run smoke test**

```bash
uv run pytest packages/scraper/tests/test_pipeline.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/ packages/scraper/
git commit -m "feat(scraper): main pipeline loop wiring all stages"
```

---

## Phase 3: Enrichment Worker

### Task 3.1: Vertical classifier (Claude OAuth + API key fallback)

**Files:**
- Create: `packages/enrichment/pyproject.toml`
- Create: `packages/enrichment/liveintent_enrichment/__init__.py`
- Create: `packages/enrichment/liveintent_enrichment/classify.py`
- Create: `packages/enrichment/tests/__init__.py`
- Create: `packages/enrichment/tests/test_classify.py`

- [ ] **Step 1: Write pyproject**

Create `packages/enrichment/pyproject.toml`:

```toml
[project]
name = "liveintent-enrichment"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "liveintent-shared",
  "anthropic>=0.40",
  "httpx>=0.28",
  "beautifulsoup4>=4.12",
  "pytesseract>=0.3.13",
  "pillow>=11.0",
  "structlog>=24.4",
]

[project.optional-dependencies]
test = ["pytest>=8.3", "pytest-asyncio>=0.24", "respx>=0.21"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["liveintent_enrichment"]
```

- [ ] **Step 2: Init __init__.py + tests dir**

Create `packages/enrichment/liveintent_enrichment/__init__.py` (empty list `__all__`).
Create `packages/enrichment/tests/__init__.py` (empty).

- [ ] **Step 3: Write failing classifier test**

Create `packages/enrichment/tests/test_classify.py`:

```python
import pytest
from liveintent_enrichment.classify import classify_landing_page_text, VALID_VERTICALS

def test_classify_returns_one_of_valid_verticals(monkeypatch):
    monkeypatch.setattr(
        "liveintent_enrichment.classify._call_claude",
        lambda prompt: "supplements"
    )
    result = classify_landing_page_text("Buy our amazing fish oil capsules")
    assert result == "supplements"

def test_classify_falls_back_to_other_on_invalid_response(monkeypatch):
    monkeypatch.setattr(
        "liveintent_enrichment.classify._call_claude",
        lambda prompt: "completely unknown category"
    )
    result = classify_landing_page_text("text")
    assert result == "other"

def test_classify_returns_unclassified_on_error(monkeypatch):
    def boom(prompt): raise RuntimeError("api down")
    monkeypatch.setattr("liveintent_enrichment.classify._call_claude", boom)
    result = classify_landing_page_text("text")
    assert result == "unclassified"

def test_valid_verticals_match_enum():
    from liveintent_shared.enums import Vertical
    expected = {v.value for v in Vertical if v.value not in ("unclassified",)}
    assert expected == set(VALID_VERTICALS)
```

- [ ] **Step 4: Run, expect failure**

```bash
uv run pytest packages/enrichment/tests/test_classify.py -v
```

Expected: ImportError.

- [ ] **Step 5: Implement classify.py**

Create `packages/enrichment/liveintent_enrichment/classify.py`:

```python
import os
import subprocess
import structlog
from anthropic import Anthropic
from liveintent_shared.config import get_settings

log = structlog.get_logger(__name__)

VALID_VERTICALS = ["supplements", "finance", "insurance", "sweeps", "auto", "solar", "health", "crypto", "other"]

PROMPT_TEMPLATE = """Classify this advertiser into exactly one of these verticals: {options}.

Respond with ONLY one word — the vertical name. No punctuation, no explanation.

Advertiser landing page text:
---
{text}
---"""

def _call_claude_api(prompt: str) -> str:
    """Direct Anthropic API call (fallback path)."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    client = Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=20,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip().lower()

def _call_claude_oauth(prompt: str) -> str:
    """Try `claude -p` OAuth path. Raises if claude CLI not found or fails."""
    proc = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True, text=True, timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude -p failed: {proc.stderr}")
    return proc.stdout.strip().lower()

def _call_claude(prompt: str) -> str:
    """Try OAuth first, fall back to API key."""
    try:
        return _call_claude_oauth(prompt)
    except Exception as oauth_err:
        log.info("classify.oauth_failed_falling_back", error=str(oauth_err))
        return _call_claude_api(prompt)

def classify_landing_page_text(text: str) -> str:
    """Returns one of VALID_VERTICALS, 'other', or 'unclassified' on hard error."""
    truncated = text[:4000]  # cap input
    prompt = PROMPT_TEMPLATE.format(options=", ".join(VALID_VERTICALS), text=truncated)
    try:
        raw = _call_claude(prompt)
    except Exception as e:
        log.warning("classify.failed", error=str(e))
        return "unclassified"
    word = raw.split()[0].strip(".,!?").lower() if raw else ""
    if word in VALID_VERTICALS:
        return word
    log.info("classify.invalid_response_to_other", got=raw)
    return "other"
```

- [ ] **Step 6: Run, expect pass**

```bash
uv run pytest packages/enrichment/tests/test_classify.py -v
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/enrichment/
git commit -m "feat(enrichment): vertical classifier with OAuth + API key fallback"
```

### Task 3.2: Tesseract OCR helper

**Files:**
- Create: `packages/enrichment/liveintent_enrichment/ocr.py`
- Create: `packages/enrichment/tests/test_ocr.py`
- Create: `packages/enrichment/tests/fixtures/sample_creative.png`

- [ ] **Step 1: Generate a sample PNG fixture with known text**

```bash
mkdir -p packages/enrichment/tests/fixtures
cd packages/enrichment/tests/fixtures
uv run python -c "
from PIL import Image, ImageDraw, ImageFont
img = Image.new('RGB', (400, 100), 'white')
d = ImageDraw.Draw(img)
d.text((10, 30), 'BUY FISH OIL NOW', fill='black')
img.save('sample_creative.png')
"
```

- [ ] **Step 2: Verify tesseract is installed**

```bash
which tesseract || sudo apt install -y tesseract-ocr
```

- [ ] **Step 3: Write failing test**

Create `packages/enrichment/tests/test_ocr.py`:

```python
from pathlib import Path
from liveintent_enrichment.ocr import extract_text

FIX = Path(__file__).parent / "fixtures"

def test_extract_text_from_simple_image():
    text = extract_text(FIX / "sample_creative.png")
    assert text is not None
    assert "fish" in text.lower() or "oil" in text.lower()

def test_extract_text_returns_none_for_missing_file(tmp_path):
    assert extract_text(tmp_path / "nonexistent.png") is None
```

- [ ] **Step 4: Run, expect failure**

```bash
uv run pytest packages/enrichment/tests/test_ocr.py -v
```

Expected: ImportError.

- [ ] **Step 5: Implement ocr.py**

Create `packages/enrichment/liveintent_enrichment/ocr.py`:

```python
from pathlib import Path
import pytesseract
from PIL import Image
import structlog

log = structlog.get_logger(__name__)

def extract_text(image_path: Path | str) -> str | None:
    p = Path(image_path)
    if not p.exists():
        return None
    try:
        with Image.open(p) as img:
            text = pytesseract.image_to_string(img)
        return text.strip() or None
    except Exception as e:
        log.warning("ocr.failed", path=str(p), error=str(e))
        return None
```

- [ ] **Step 6: Run, expect pass**

```bash
uv run pytest packages/enrichment/tests/test_ocr.py -v
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/enrichment/
git commit -m "feat(enrichment): tesseract OCR for creative headlines"
```

### Task 3.3: Enrichment job loop

**Files:**
- Create: `packages/enrichment/liveintent_enrichment/jobs.py`
- Create: `packages/enrichment/liveintent_enrichment/main.py`
- Create: `packages/enrichment/tests/test_jobs.py`

- [ ] **Step 1: Write failing test**

Create `packages/enrichment/tests/test_jobs.py`:

```python
import pytest
from datetime import datetime, timezone
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from liveintent_shared.models import Base, Advertiser, Creative
from liveintent_shared.enums import Vertical, VerticalSource
from liveintent_enrichment.jobs import (
    classify_pending_advertisers, ocr_pending_creatives
)

@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s

def test_classify_pending_advertisers_skips_manual(db, monkeypatch):
    a_auto = Advertiser(domain="a.com")
    a_manual = Advertiser(
        domain="b.com", vertical=Vertical.FINANCE.value,
        vertical_source=VerticalSource.MANUAL.value, vertical_classified_at=datetime.now(timezone.utc),
    )
    db.add_all([a_auto, a_manual]); db.commit()
    monkeypatch.setattr("liveintent_enrichment.jobs.fetch_landing_text", lambda d: "supps text")
    monkeypatch.setattr("liveintent_enrichment.jobs.classify_landing_page_text", lambda t: "supplements")
    n = classify_pending_advertisers(db, limit=10)
    assert n == 1
    db.refresh(a_auto); db.refresh(a_manual)
    assert a_auto.vertical == "supplements"
    assert a_manual.vertical == "finance"  # untouched

def test_ocr_pending_creatives(db, monkeypatch, tmp_path):
    img = tmp_path / "x.png"; img.write_bytes(b"fake")
    a = Advertiser(domain="a.com"); db.add(a); db.commit()
    c = Creative(advertiser_id=a.id, creative_hash="h", screenshot_path=str(img), click_tracker_url="http://t")
    db.add(c); db.commit()
    monkeypatch.setattr("liveintent_enrichment.jobs.extract_text", lambda p: "BUY NOW")
    n = ocr_pending_creatives(db, limit=10)
    assert n == 1
    db.refresh(c)
    assert c.headline == "BUY NOW"

def test_ocr_skips_already_done(db, monkeypatch):
    a = Advertiser(domain="a.com"); db.add(a); db.commit()
    c = Creative(advertiser_id=a.id, creative_hash="h", screenshot_path="/x", click_tracker_url="http://t", headline="cached")
    db.add(c); db.commit()
    called = []
    monkeypatch.setattr("liveintent_enrichment.jobs.extract_text", lambda p: called.append(p) or "new")
    n = ocr_pending_creatives(db, limit=10)
    assert n == 0
    assert called == []
```

- [ ] **Step 2: Run, expect failure**

```bash
uv run pytest packages/enrichment/tests/test_jobs.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement jobs.py**

Create `packages/enrichment/liveintent_enrichment/jobs.py`:

```python
from datetime import datetime, timezone
from pathlib import Path
import httpx
import structlog
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session
from liveintent_shared.models import Advertiser, Creative
from liveintent_shared.enums import Vertical, VerticalSource
from .classify import classify_landing_page_text
from .ocr import extract_text

log = structlog.get_logger(__name__)

def fetch_landing_text(domain: str, *, timeout: float = 10.0) -> str | None:
    url = f"https://{domain}/"
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, headers={"User-Agent": "Mozilla/5.0 LiveIntentSpyBot/0.1"}) as c:
            r = c.get(url)
            if r.status_code >= 400:
                return None
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script", "style"]):
            tag.decompose()
        return " ".join(soup.get_text(separator=" ", strip=True).split())
    except Exception as e:
        log.warning("enrich.fetch_failed", domain=domain, error=str(e))
        return None

def classify_pending_advertisers(session: Session, *, limit: int = 50) -> int:
    """Classify advertisers where vertical_classified_at IS NULL.
    Never overwrites manual classifications. Returns count processed."""
    pending = session.scalars(
        select(Advertiser)
        .where(Advertiser.vertical_classified_at.is_(None))
        .where(Advertiser.vertical_source == VerticalSource.AUTO.value)
        .limit(limit)
    ).all()
    n = 0
    for a in pending:
        text = fetch_landing_text(a.domain)
        if text is None:
            log.info("enrich.classify_no_text", domain=a.domain)
            continue
        a.vertical = classify_landing_page_text(text)
        a.vertical_classified_at = datetime.now(timezone.utc)
        session.flush()
        n += 1
    return n

def ocr_pending_creatives(session: Session, *, limit: int = 50) -> int:
    """OCR creatives whose headline is NULL. Returns count processed."""
    pending = session.scalars(
        select(Creative).where(Creative.headline.is_(None)).limit(limit)
    ).all()
    n = 0
    for c in pending:
        text = extract_text(Path(c.screenshot_path))
        if text:
            c.headline = text
            session.flush()
            n += 1
    return n
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest packages/enrichment/tests/test_jobs.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Implement main.py**

Create `packages/enrichment/liveintent_enrichment/main.py`:

```python
import asyncio
import structlog
from liveintent_shared.config import get_settings
from liveintent_shared.db import session_scope
from liveintent_shared.logging import configure_logging
from .jobs import classify_pending_advertisers, ocr_pending_creatives

log = structlog.get_logger(__name__)

async def run_forever():
    settings = get_settings()
    while True:
        try:
            with session_scope() as s:
                n_class = classify_pending_advertisers(s, limit=20)
                n_ocr = ocr_pending_creatives(s, limit=50)
            if n_class or n_ocr:
                log.info("enrichment.iteration", classified=n_class, ocred=n_ocr)
        except Exception as e:
            log.exception("enrichment.iteration_failed", error=str(e))
        await asyncio.sleep(settings.enrichment_poll_interval_seconds)

def main():
    configure_logging()
    asyncio.run(run_forever())

if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Commit**

```bash
git add packages/enrichment/
git commit -m "feat(enrichment): job loop for vertical classification + OCR"
```

### Task 3.4: Retry unresolved creatives

**Files:**
- Modify: `packages/enrichment/liveintent_enrichment/jobs.py`
- Modify: `packages/enrichment/liveintent_enrichment/main.py`
- Modify: `packages/enrichment/tests/test_jobs.py`

- [ ] **Step 1: Add retry function to jobs.py**

Append to `packages/enrichment/liveintent_enrichment/jobs.py`:

```python
from datetime import timedelta
from liveintent_shared.models import Creative
# (resolve helpers live in scraper, but we want to avoid a hard dep — import lazily)

def retry_unresolved_creatives(session: Session, *, limit: int = 50, max_age_days: int = 7) -> int:
    """Retry click-tracker resolution for creatives where final_landing_url is null
    and the creative is younger than max_age_days. Returns count successfully resolved."""
    from liveintent_scraper.resolve import resolve_final_url, extract_advertiser_domain
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    pending = session.scalars(
        select(Creative)
        .where(Creative.final_landing_url.is_(None))
        .where(Creative.first_seen_at >= cutoff)
        .limit(limit)
    ).all()
    n = 0
    for c in pending:
        final = resolve_final_url(c.click_tracker_url)
        if not final:
            continue
        domain = extract_advertiser_domain(final)
        if not domain:
            continue
        c.final_landing_url = final
        c.final_landing_url_resolved_at = datetime.now(timezone.utc)
        # advertiser_id was set at first capture; we don't change it on retry
        n += 1
    return n
```

- [ ] **Step 2: Add test**

Append to `packages/enrichment/tests/test_jobs.py`:

```python
def test_retry_unresolved_creatives(db, monkeypatch):
    a = Advertiser(domain="a.com"); db.add(a); db.commit()
    c1 = Creative(advertiser_id=a.id, creative_hash="h1", screenshot_path="/x", click_tracker_url="http://t1")
    c2 = Creative(advertiser_id=a.id, creative_hash="h2", screenshot_path="/x", click_tracker_url="http://t2", final_landing_url="https://done.com/x", final_landing_url_resolved_at=datetime.now(timezone.utc))
    db.add_all([c1, c2]); db.commit()
    monkeypatch.setattr("liveintent_scraper.resolve.resolve_final_url", lambda u: "https://newchapter.com/lp")
    monkeypatch.setattr("liveintent_scraper.resolve.extract_advertiser_domain", lambda u: "newchapter.com")
    from liveintent_enrichment.jobs import retry_unresolved_creatives
    n = retry_unresolved_creatives(db, limit=10)
    assert n == 1
    db.refresh(c1); db.refresh(c2)
    assert c1.final_landing_url == "https://newchapter.com/lp"
    assert c2.final_landing_url == "https://done.com/x"  # untouched
```

Note: this test requires `liveintent-scraper` as a dev dep of `liveintent-enrichment` for the monkeypatch path to be importable. Add it now:

Edit `packages/enrichment/pyproject.toml` to add to `[project.optional-dependencies] test`:

```toml
test = ["pytest>=8.3", "pytest-asyncio>=0.24", "respx>=0.21", "liveintent-scraper"]
```

- [ ] **Step 3: Run, expect pass**

```bash
uv sync --all-extras
uv run pytest packages/enrichment/tests/test_jobs.py -v
```

Expected: 4 passed.

- [ ] **Step 4: Wire into main loop**

Edit `packages/enrichment/liveintent_enrichment/main.py` — inside `run_forever`'s `with session_scope()` block, add:

```python
n_retry = retry_unresolved_creatives(s, limit=50)
```

And import it: `from .jobs import classify_pending_advertisers, ocr_pending_creatives, retry_unresolved_creatives`. Update the log line to include `retried=n_retry`.

- [ ] **Step 5: Commit**

```bash
git add packages/enrichment/
git commit -m "feat(enrichment): retry job for unresolved creative landing URLs"
```

---

## Phase 4: API + Digest

### Task 4.1: API package skeleton + admin auth

**Files:**
- Create: `packages/api/pyproject.toml`
- Create: `packages/api/liveintent_api/__init__.py`
- Create: `packages/api/liveintent_api/auth.py`
- Create: `packages/api/liveintent_api/main.py`
- Create: `packages/api/tests/__init__.py`
- Create: `packages/api/tests/test_auth.py`

- [ ] **Step 1: Write pyproject**

Create `packages/api/pyproject.toml`:

```toml
[project]
name = "liveintent-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "liveintent-shared",
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "httpx>=0.28",
  "structlog>=24.4",
]

[project.optional-dependencies]
test = ["pytest>=8.3", "pytest-asyncio>=0.24", "respx>=0.21"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["liveintent_api"]
```

- [ ] **Step 2: Implement auth.py**

Create `packages/api/liveintent_api/auth.py`:

```python
from fastapi import Header, HTTPException
from liveintent_shared.config import get_settings

def require_admin(authorization: str = Header(..., alias="Authorization")) -> None:
    expected = f"Bearer {get_settings().admin_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid admin token")
```

- [ ] **Step 3: Implement main.py (skeleton)**

Create `packages/api/liveintent_api/main.py`:

```python
from fastapi import FastAPI
from liveintent_shared.logging import configure_logging

configure_logging()
app = FastAPI(title="LiveIntent Spy API")

@app.get("/health")
def health():
    return {"ok": True}
```

- [ ] **Step 4: Write auth test**

Create `packages/api/tests/test_auth.py`:

```python
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from liveintent_api.auth import require_admin

@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("ADMIN_TOKEN", "secret123")
    monkeypatch.setenv("IMAP_HOST", "x"); monkeypatch.setenv("IMAP_USER", "x"); monkeypatch.setenv("IMAP_PASS", "x")
    a = FastAPI()
    @a.get("/private", dependencies=[Depends(require_admin)])
    def private(): return {"ok": True}
    return a

def test_admin_endpoint_requires_bearer(app):
    c = TestClient(app)
    assert c.get("/private").status_code == 422  # missing header
    assert c.get("/private", headers={"Authorization": "wrong"}).status_code == 401
    assert c.get("/private", headers={"Authorization": "Bearer secret123"}).status_code == 200
```

- [ ] **Step 5: Run test**

```bash
uv run pytest packages/api/tests/test_auth.py -v
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/api/
git commit -m "feat(api): bootstrap FastAPI app with admin bearer auth"
```

### Task 4.2: Digest computation (top advertisers query, TDD)

**Files:**
- Create: `packages/api/liveintent_api/digest_compute.py`
- Create: `packages/api/tests/test_digest_compute.py`
- Create: `packages/api/tests/conftest.py`

- [ ] **Step 1: Write conftest**

Create `packages/api/tests/conftest.py`:

```python
import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from liveintent_shared.models import Base, Publisher, Advertiser, Creative, Impression, EmailRaw
from liveintent_shared.enums import Vertical

@pytest.fixture
def db_with_impressions():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    s = Session(engine)
    p = Publisher(domain="p.com", seed_email_address="p@x.com")
    s.add(p); s.flush()
    e = EmailRaw(publisher_id=p.id, imap_uid=1, raw_html_path="/x")
    s.add(e); s.flush()
    advs = []
    # 3 supplements advertisers, varying impression counts
    for i, (dom, vert, count) in enumerate([
        ("a1.com", Vertical.SUPPLEMENTS.value, 10),
        ("a2.com", Vertical.SUPPLEMENTS.value, 5),
        ("a3.com", Vertical.FINANCE.value, 8),
        ("a4.com", Vertical.UNCLASSIFIED.value, 1),
    ]):
        a = Advertiser(domain=dom, vertical=vert)
        s.add(a); s.flush()
        c = Creative(advertiser_id=a.id, creative_hash=f"h{i}", screenshot_path="/s", click_tracker_url="http://t")
        s.add(c); s.flush()
        for _ in range(count):
            s.add(Impression(creative_id=c.id, publisher_id=p.id, email_id=e.id))
        advs.append(a)
    s.commit()
    yield s
    s.close()
```

- [ ] **Step 2: Write failing tests**

Create `packages/api/tests/test_digest_compute.py`:

```python
from datetime import datetime, timedelta, timezone
from liveintent_api.digest_compute import top_advertisers_by_vertical

def test_top_advertisers_grouped_and_ranked(db_with_impressions):
    now = datetime.now(timezone.utc)
    result = top_advertisers_by_vertical(
        db_with_impressions, window_start=now - timedelta(days=2), window_end=now, top_n=10
    )
    # Result is dict[vertical -> list[(domain, count)]]
    assert "supplements" in result
    supps = result["supplements"]
    assert [d for d, _ in supps] == ["a1.com", "a2.com"]  # ordered by count desc
    assert supps[0][1] == 10
    assert supps[1][1] == 5
    assert result["finance"] == [("a3.com", 8)]

def test_top_advertisers_excludes_unclassified(db_with_impressions):
    now = datetime.now(timezone.utc)
    result = top_advertisers_by_vertical(
        db_with_impressions, window_start=now - timedelta(days=2), window_end=now, top_n=10
    )
    assert "unclassified" not in result

def test_top_n_limits_per_vertical(db_with_impressions):
    now = datetime.now(timezone.utc)
    result = top_advertisers_by_vertical(
        db_with_impressions, window_start=now - timedelta(days=2), window_end=now, top_n=1
    )
    assert len(result["supplements"]) == 1
    assert result["supplements"][0][0] == "a1.com"
```

- [ ] **Step 3: Run, expect failure**

```bash
uv run pytest packages/api/tests/test_digest_compute.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement digest_compute.py**

Create `packages/api/liveintent_api/digest_compute.py`:

```python
from datetime import datetime
from collections import defaultdict
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from liveintent_shared.models import Advertiser, Creative, Impression
from liveintent_shared.enums import Vertical

def top_advertisers_by_vertical(
    session: Session, *, window_start: datetime, window_end: datetime, top_n: int = 10,
) -> dict[str, list[tuple[str, int]]]:
    """Returns {vertical -> [(domain, impression_count), ...]} sorted desc, capped at top_n.
    Excludes 'unclassified' advertisers."""
    stmt = (
        select(Advertiser.vertical, Advertiser.domain, func.count(Impression.id).label("c"))
        .join(Creative, Creative.advertiser_id == Advertiser.id)
        .join(Impression, Impression.creative_id == Creative.id)
        .where(Impression.seen_at >= window_start)
        .where(Impression.seen_at < window_end)
        .where(Advertiser.vertical != Vertical.UNCLASSIFIED.value)
        .group_by(Advertiser.id, Advertiser.vertical, Advertiser.domain)
    )
    rows = session.execute(stmt).all()
    by_vert: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for vert, domain, count in rows:
        by_vert[vert].append((domain, int(count)))
    return {v: sorted(items, key=lambda x: x[1], reverse=True)[:top_n] for v, items in by_vert.items()}
```

- [ ] **Step 5: Run, expect pass**

```bash
uv run pytest packages/api/tests/test_digest_compute.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/api/
git commit -m "feat(api): top-advertisers-by-vertical query"
```

### Task 4.3: API routes — advertisers, publishers, creatives

**Files:**
- Create: `packages/api/liveintent_api/routes/__init__.py`
- Create: `packages/api/liveintent_api/routes/advertisers.py`
- Create: `packages/api/liveintent_api/routes/publishers.py`
- Create: `packages/api/liveintent_api/routes/creatives.py`
- Modify: `packages/api/liveintent_api/main.py`
- Create: `packages/api/tests/test_routes.py`

- [ ] **Step 1: Init routes package**

Create `packages/api/liveintent_api/routes/__init__.py` (empty file).

- [ ] **Step 2: Implement advertisers route**

Create `packages/api/liveintent_api/routes/advertisers.py`:

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func
from liveintent_shared.db import session_scope
from liveintent_shared.models import Advertiser, Creative, Impression
from ..auth import require_admin

router = APIRouter(prefix="/advertisers", tags=["advertisers"], dependencies=[Depends(require_admin)])

@router.get("")
def list_advertisers(days: int = Query(7, ge=1, le=90), vertical: str | None = None, limit: int = Query(50, le=500)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with session_scope() as s:
        stmt = (
            select(Advertiser.domain, Advertiser.vertical, func.count(Impression.id).label("c"))
            .join(Creative, Creative.advertiser_id == Advertiser.id)
            .join(Impression, Impression.creative_id == Creative.id)
            .where(Impression.seen_at >= since)
            .group_by(Advertiser.id, Advertiser.domain, Advertiser.vertical)
            .order_by(func.count(Impression.id).desc())
            .limit(limit)
        )
        if vertical:
            stmt = stmt.where(Advertiser.vertical == vertical)
        rows = s.execute(stmt).all()
        return [{"domain": d, "vertical": v, "impressions": int(c)} for d, v, c in rows]

@router.get("/{domain}")
def advertiser_detail(domain: str):
    with session_scope() as s:
        a = s.scalar(select(Advertiser).where(Advertiser.domain == domain))
        if not a:
            raise HTTPException(404, "not found")
        creatives = s.scalars(select(Creative).where(Creative.advertiser_id == a.id).order_by(Creative.last_seen_at.desc())).all()
        return {
            "domain": a.domain,
            "vertical": a.vertical,
            "vertical_source": a.vertical_source,
            "first_seen_at": a.first_seen_at.isoformat(),
            "last_seen_at": a.last_seen_at.isoformat(),
            "creatives": [
                {"id": c.id, "headline": c.headline, "screenshot_path": c.screenshot_path,
                 "final_landing_url": c.final_landing_url, "last_seen_at": c.last_seen_at.isoformat()}
                for c in creatives
            ],
        }
```

- [ ] **Step 3: Implement publishers route**

Create `packages/api/liveintent_api/routes/publishers.py`:

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func
from liveintent_shared.db import session_scope
from liveintent_shared.models import Publisher, Advertiser, Creative, Impression
from ..auth import require_admin

router = APIRouter(prefix="/publishers", tags=["publishers"], dependencies=[Depends(require_admin)])

@router.get("")
def list_publishers():
    with session_scope() as s:
        rows = s.scalars(select(Publisher).order_by(Publisher.domain)).all()
        return [{"domain": p.domain, "name": p.name, "active": p.active,
                 "last_email_received_at": p.last_email_received_at.isoformat() if p.last_email_received_at else None}
                for p in rows]

@router.get("/{domain}")
def publisher_detail(domain: str, days: int = Query(7, ge=1, le=90)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with session_scope() as s:
        p = s.scalar(select(Publisher).where(Publisher.domain == domain))
        if not p:
            raise HTTPException(404, "not found")
        rows = s.execute(
            select(Advertiser.domain, func.count(Impression.id).label("c"))
            .join(Creative, Creative.advertiser_id == Advertiser.id)
            .join(Impression, Impression.creative_id == Creative.id)
            .where(Impression.publisher_id == p.id)
            .where(Impression.seen_at >= since)
            .group_by(Advertiser.id, Advertiser.domain)
            .order_by(func.count(Impression.id).desc())
            .limit(50)
        ).all()
        return {
            "domain": p.domain, "name": p.name, "active": p.active,
            "top_advertisers": [{"domain": d, "impressions": int(c)} for d, c in rows],
        }
```

- [ ] **Step 4: Implement creatives route**

Create `packages/api/liveintent_api/routes/creatives.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy import select
from liveintent_shared.db import session_scope
from liveintent_shared.models import Creative
from ..auth import require_admin

router = APIRouter(prefix="/creatives", tags=["creatives"], dependencies=[Depends(require_admin)])

@router.get("/{creative_id}/screenshot")
def creative_screenshot(creative_id: int):
    with session_scope() as s:
        c = s.scalar(select(Creative).where(Creative.id == creative_id))
        if not c or not Path(c.screenshot_path).exists():
            raise HTTPException(404)
        return FileResponse(c.screenshot_path, media_type="image/png")
```

- [ ] **Step 5: Wire routes into main.py**

Edit `packages/api/liveintent_api/main.py`:

```python
from fastapi import FastAPI
from liveintent_shared.logging import configure_logging
from .routes import advertisers, publishers, creatives

configure_logging()
app = FastAPI(title="LiveIntent Spy API")
app.include_router(advertisers.router)
app.include_router(publishers.router)
app.include_router(creatives.router)

@app.get("/health")
def health():
    return {"ok": True}
```

- [ ] **Step 6: Smoke test the routes**

Create `packages/api/tests/test_routes.py`:

```python
import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from liveintent_shared.models import Base, Publisher, Advertiser, Creative, Impression, EmailRaw

@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setenv("ADMIN_TOKEN", "tok")
    monkeypatch.setenv("IMAP_HOST", "x"); monkeypatch.setenv("IMAP_USER", "x"); monkeypatch.setenv("IMAP_PASS", "x")
    # Reset cached engine/session
    import liveintent_shared.db as db
    db._engine = None; db._Session = None
    engine = db.get_engine()
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        p = Publisher(domain="p.com", seed_email_address="p@x.com"); s.add(p); s.flush()
        a = Advertiser(domain="a.com", vertical="supplements"); s.add(a); s.flush()
        e = EmailRaw(publisher_id=p.id, imap_uid=1, raw_html_path="/x"); s.add(e); s.flush()
        c = Creative(advertiser_id=a.id, creative_hash="h", screenshot_path="/x", click_tracker_url="http://t"); s.add(c); s.flush()
        s.add(Impression(creative_id=c.id, publisher_id=p.id, email_id=e.id))
        s.commit()
    from liveintent_api.main import app
    return TestClient(app)

H = {"Authorization": "Bearer tok"}

def test_list_advertisers(client):
    r = client.get("/advertisers", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert any(row["domain"] == "a.com" for row in body)

def test_advertiser_detail(client):
    r = client.get("/advertisers/a.com", headers=H)
    assert r.status_code == 200
    assert r.json()["vertical"] == "supplements"

def test_advertiser_detail_404(client):
    r = client.get("/advertisers/nonexistent.com", headers=H)
    assert r.status_code == 404

def test_list_publishers(client):
    r = client.get("/publishers", headers=H)
    assert r.status_code == 200
    assert any(p["domain"] == "p.com" for p in r.json())

def test_publisher_detail(client):
    r = client.get("/publishers/p.com", headers=H)
    assert r.status_code == 200
    assert r.json()["top_advertisers"][0]["domain"] == "a.com"
```

- [ ] **Step 7: Run, expect pass**

```bash
uv run pytest packages/api/tests/test_routes.py -v
```

Expected: 5 passed.

- [ ] **Step 8: Commit**

```bash
git add packages/api/
git commit -m "feat(api): routes for advertisers, publishers, creatives"
```

### Task 4.4: Admin override-vertical route

**Files:**
- Create: `packages/api/liveintent_api/routes/admin.py`
- Modify: `packages/api/liveintent_api/main.py`
- Modify: `packages/api/tests/test_routes.py`

- [ ] **Step 1: Implement admin route**

Create `packages/api/liveintent_api/routes/admin.py`:

```python
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from liveintent_shared.db import session_scope
from liveintent_shared.models import Advertiser
from liveintent_shared.enums import Vertical, VerticalSource
from ..auth import require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

class OverrideVerticalIn(BaseModel):
    vertical: str

@router.post("/advertisers/{domain}/vertical")
def override_vertical(domain: str, body: OverrideVerticalIn):
    if body.vertical not in [v.value for v in Vertical]:
        raise HTTPException(400, "invalid vertical")
    with session_scope() as s:
        a = s.scalar(select(Advertiser).where(Advertiser.domain == domain))
        if not a:
            raise HTTPException(404)
        a.vertical = body.vertical
        a.vertical_source = VerticalSource.MANUAL.value
        a.vertical_classified_at = datetime.now(timezone.utc)
    return {"ok": True, "domain": domain, "vertical": body.vertical}
```

- [ ] **Step 2: Wire into main.py**

Edit `packages/api/liveintent_api/main.py` — add `from .routes import admin` and `app.include_router(admin.router)`.

- [ ] **Step 3: Add test for override + sticky behavior**

Append to `packages/api/tests/test_routes.py`:

```python
def test_admin_override_vertical_sticks(client):
    r = client.post("/admin/advertisers/a.com/vertical", headers=H, json={"vertical": "finance"})
    assert r.status_code == 200
    detail = client.get("/advertisers/a.com", headers=H).json()
    assert detail["vertical"] == "finance"
    assert detail["vertical_source"] == "manual"

def test_admin_override_invalid_vertical(client):
    r = client.post("/admin/advertisers/a.com/vertical", headers=H, json={"vertical": "bogus"})
    assert r.status_code == 400
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest packages/api/tests/test_routes.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/
git commit -m "feat(api): admin override-vertical endpoint with sticky source"
```

### Task 4.5: Telegram client + digest formatter

**Files:**
- Create: `packages/api/liveintent_api/telegram_client.py`
- Create: `packages/api/liveintent_api/digest_format.py`
- Create: `packages/api/tests/test_digest_format.py`

- [ ] **Step 1: Implement telegram_client.py**

Create `packages/api/liveintent_api/telegram_client.py`:

```python
import httpx
from liveintent_shared.config import get_settings

class TelegramClient:
    def __init__(self, token: str | None = None, chat_id: str | None = None):
        s = get_settings()
        self.token = token or s.telegram_bot_token
        self.chat_id = chat_id or s.telegram_chat_id
        self.base = f"https://api.telegram.org/bot{self.token}"

    def send_message(self, text: str) -> str | None:
        if not self.token or not self.chat_id:
            return None
        r = httpx.post(f"{self.base}/sendMessage", data={
            "chat_id": self.chat_id, "text": text, "parse_mode": "Markdown"
        }, timeout=10.0)
        r.raise_for_status()
        return str(r.json()["result"]["message_id"])
```

- [ ] **Step 2: Write failing format test**

Create `packages/api/tests/test_digest_format.py`:

```python
from liveintent_api.digest_format import format_digest_message

def test_format_digest_groups_by_vertical():
    data = {
        "supplements": [("a1.com", 10), ("a2.com", 5)],
        "finance": [("a3.com", 8)],
    }
    msg = format_digest_message(data, window_label="last 24h")
    assert "supplements" in msg.lower()
    assert "finance" in msg.lower()
    assert "a1.com" in msg
    assert "10" in msg
    assert "last 24h" in msg

def test_format_digest_empty():
    msg = format_digest_message({}, window_label="last 24h")
    assert "no impressions" in msg.lower() or "no activity" in msg.lower()
```

- [ ] **Step 3: Run, expect failure**

```bash
uv run pytest packages/api/tests/test_digest_format.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement digest_format.py**

Create `packages/api/liveintent_api/digest_format.py`:

```python
def format_digest_message(top_by_vertical: dict[str, list[tuple[str, int]]], *, window_label: str) -> str:
    if not top_by_vertical:
        return f"*LiveIntent Spy — {window_label}*\n\nNo activity in this window."
    parts = [f"*LiveIntent Spy — {window_label}*", ""]
    for vert in sorted(top_by_vertical.keys()):
        parts.append(f"_{vert}_")
        for domain, count in top_by_vertical[vert]:
            parts.append(f"  • `{domain}` — {count} impressions")
        parts.append("")
    return "\n".join(parts).rstrip()
```

- [ ] **Step 5: Run, expect pass**

```bash
uv run pytest packages/api/tests/test_digest_format.py -v
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/api/
git commit -m "feat(api): telegram client + digest message formatter"
```

### Task 4.6: Digest run endpoint

**Files:**
- Create: `packages/api/liveintent_api/routes/digest.py`
- Modify: `packages/api/liveintent_api/main.py`
- Append: `packages/api/tests/test_routes.py`

- [ ] **Step 1: Implement digest route**

Create `packages/api/liveintent_api/routes/digest.py`:

```python
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from liveintent_shared.db import session_scope
from liveintent_shared.models import DigestRun
from ..auth import require_admin
from ..digest_compute import top_advertisers_by_vertical
from ..digest_format import format_digest_message
from ..telegram_client import TelegramClient

router = APIRouter(prefix="/digest", tags=["digest"], dependencies=[Depends(require_admin)])

@router.post("/run")
def run_digest(window_hours: int = 24):
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=window_hours)
    with session_scope() as s:
        data = top_advertisers_by_vertical(s, window_start=start, window_end=end, top_n=10)
        msg = format_digest_message(data, window_label=f"last {window_hours}h")
        message_id: str | None = None
        try:
            message_id = TelegramClient().send_message(msg)
        except Exception as e:
            # Don't fail the digest if Telegram is down — record it anyway
            pass
        s.add(DigestRun(
            window_start=start, window_end=end,
            top_advertisers_json=json.dumps({k: v for k, v in data.items()}),
            telegram_message_id=message_id,
        ))
    return {"ok": True, "telegram_message_id": message_id, "verticals": list(data.keys())}

@router.get("/today")
def get_today():
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=24)
    with session_scope() as s:
        return top_advertisers_by_vertical(s, window_start=start, window_end=end, top_n=10)
```

- [ ] **Step 2: Wire into main.py**

Edit `main.py` to include `from .routes import digest` and `app.include_router(digest.router)`.

- [ ] **Step 3: Add test**

Append to `packages/api/tests/test_routes.py`:

```python
def test_digest_today(client):
    r = client.get("/digest/today", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert "supplements" in body  # from fixture

def test_digest_run_returns_ok(client, monkeypatch):
    monkeypatch.setattr("liveintent_api.routes.digest.TelegramClient",
                        lambda: type("T", (), {"send_message": lambda self, m: "fake-msg-id"})())
    r = client.post("/digest/run?window_hours=24", headers=H)
    assert r.status_code == 200
    assert r.json()["ok"] is True
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest packages/api/tests/test_routes.py -v
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/
git commit -m "feat(api): digest run + today endpoints, persists DigestRun"
```

### Task 4.7: Telegram webhook + on-demand commands

**Files:**
- Create: `packages/api/liveintent_api/routes/telegram.py`
- Modify: `packages/api/liveintent_api/main.py`

- [ ] **Step 1: Implement telegram route**

Create `packages/api/liveintent_api/routes/telegram.py`:

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select, func
from liveintent_shared.db import session_scope
from liveintent_shared.models import Advertiser, Creative, Impression
from ..digest_compute import top_advertisers_by_vertical
from ..digest_format import format_digest_message
from ..telegram_client import TelegramClient

router = APIRouter(prefix="/telegram", tags=["telegram"])

class TgUpdate(BaseModel):
    update_id: int
    message: dict | None = None

def _handle_command(text: str) -> str:
    parts = text.strip().split()
    cmd = parts[0].lower() if parts else ""
    if cmd == "/topadvertisers":
        days = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
        end = datetime.now(timezone.utc); start = end - timedelta(days=days)
        with session_scope() as s:
            data = top_advertisers_by_vertical(s, window_start=start, window_end=end, top_n=10)
        return format_digest_message(data, window_label=f"last {days}d")
    if cmd == "/advertiser" and len(parts) >= 2:
        domain = parts[1]
        end = datetime.now(timezone.utc); start = end - timedelta(days=7)
        with session_scope() as s:
            row = s.execute(
                select(func.count(Impression.id))
                .join(Creative, Creative.id == Impression.creative_id)
                .join(Advertiser, Advertiser.id == Creative.advertiser_id)
                .where(Advertiser.domain == domain)
                .where(Impression.seen_at >= start)
            ).scalar() or 0
            a = s.scalar(select(Advertiser).where(Advertiser.domain == domain))
            if not a:
                return f"`{domain}` not seen yet."
            return f"*{domain}*\nVertical: {a.vertical}\nImpressions (7d): {row}"
    if cmd == "/vertical" and len(parts) >= 2:
        vert = parts[1].lower()
        end = datetime.now(timezone.utc); start = end - timedelta(days=1)
        with session_scope() as s:
            data = top_advertisers_by_vertical(s, window_start=start, window_end=end, top_n=10)
        if vert not in data:
            return f"No `{vert}` advertisers in last 24h."
        return format_digest_message({vert: data[vert]}, window_label=f"last 24h — {vert}")
    return "Commands: /topadvertisers [days], /advertiser <domain>, /vertical <name>"

@router.post("/webhook")
def webhook(update: TgUpdate):
    if not update.message:
        return {"ok": True}
    chat_id = str(update.message.get("chat", {}).get("id", ""))
    text = update.message.get("text", "")
    if not chat_id or not text:
        return {"ok": True}
    reply = _handle_command(text)
    TelegramClient(chat_id=chat_id).send_message(reply)
    return {"ok": True}
```

- [ ] **Step 2: Wire into main.py**

Edit main to include `from .routes import telegram` and `app.include_router(telegram.router)`.

- [ ] **Step 3: Smoke test webhook handler**

Append to `packages/api/tests/test_routes.py`:

```python
def test_telegram_webhook_topadvertisers(client, monkeypatch):
    sent = []
    class FakeTg:
        def __init__(self, *a, **kw): pass
        def send_message(self, msg): sent.append(msg); return "id1"
    monkeypatch.setattr("liveintent_api.routes.telegram.TelegramClient", FakeTg)
    r = client.post("/telegram/webhook", json={
        "update_id": 1,
        "message": {"chat": {"id": 999}, "text": "/topadvertisers 1"},
    })
    assert r.status_code == 200
    assert sent and "supplements" in sent[0].lower()

def test_telegram_webhook_unknown_command(client, monkeypatch):
    sent = []
    class FakeTg:
        def __init__(self, *a, **kw): pass
        def send_message(self, msg): sent.append(msg); return "id"
    monkeypatch.setattr("liveintent_api.routes.telegram.TelegramClient", FakeTg)
    r = client.post("/telegram/webhook", json={
        "update_id": 1, "message": {"chat": {"id": 999}, "text": "hello"}
    })
    assert r.status_code == 200
    assert "/topadvertisers" in sent[0]
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest packages/api/tests/test_routes.py -v
```

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/
git commit -m "feat(api): telegram webhook with /topadvertisers, /advertiser, /vertical commands"
```

---

## Phase 5: Admin CLI

### Task 5.1: CLI skeleton + add-publisher

**Files:**
- Create: `cli/pyproject.toml`
- Create: `cli/liveintent_cli/__init__.py`
- Create: `cli/liveintent_cli/main.py`
- Create: `cli/liveintent_cli/publishers.py`

- [ ] **Step 1: Write pyproject**

Create `cli/pyproject.toml`:

```toml
[project]
name = "liveintent-cli"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["liveintent-shared", "click>=8.1"]

[project.scripts]
liveintent-spy = "liveintent_cli.main:cli"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["liveintent_cli"]
```

- [ ] **Step 2: Init __init__.py**

Create `cli/liveintent_cli/__init__.py` (empty).

- [ ] **Step 3: Implement publishers subcommand**

Create `cli/liveintent_cli/publishers.py`:

```python
import click
from sqlalchemy import select
from liveintent_shared.db import session_scope
from liveintent_shared.models import Publisher

@click.command("add-publisher")
@click.argument("domain")
@click.option("--email", required=True, help="Catch-all alias subscribed to this publisher")
@click.option("--name", default=None)
def add_publisher(domain: str, email: str, name: str | None):
    """Register a publisher and its seed email alias."""
    with session_scope() as s:
        existing = s.scalar(select(Publisher).where(Publisher.domain == domain))
        if existing:
            click.echo(f"Publisher {domain} already exists (id={existing.id})")
            return
        p = Publisher(domain=domain, name=name, seed_email_address=email)
        s.add(p); s.flush()
        click.echo(f"Created publisher {domain} (id={p.id}). Subscribe {email} to the newsletter and confirm double-opt-in.")

@click.command("list-publishers")
def list_publishers():
    with session_scope() as s:
        rows = s.scalars(select(Publisher).order_by(Publisher.domain)).all()
        for p in rows:
            click.echo(f"{p.domain:30s}  {p.seed_email_address:40s}  active={p.active}")
```

- [ ] **Step 4: Implement main.py**

Create `cli/liveintent_cli/main.py`:

```python
import click
from .publishers import add_publisher, list_publishers

@click.group()
def cli():
    """LiveIntent Spy admin CLI."""
    pass

cli.add_command(add_publisher)
cli.add_command(list_publishers)

if __name__ == "__main__":
    cli()
```

- [ ] **Step 5: Sync and smoke test**

```bash
uv sync
uv run liveintent-spy --help
uv run liveintent-spy add-publisher morningbrew.com --email r.alvarez@yourdomain.com --name "Morning Brew"
uv run liveintent-spy list-publishers
```

Expected: --help shows commands; add-publisher prints "Created..."; list-publishers prints the row.

- [ ] **Step 6: Commit**

```bash
git add cli/
git commit -m "feat(cli): add-publisher + list-publishers commands"
```

### Task 5.2: CLI — override-vertical + export

**Files:**
- Create: `cli/liveintent_cli/advertisers.py`
- Create: `cli/liveintent_cli/export.py`
- Modify: `cli/liveintent_cli/main.py`

- [ ] **Step 1: Implement advertisers commands**

Create `cli/liveintent_cli/advertisers.py`:

```python
import click
from datetime import datetime, timezone
from sqlalchemy import select
from liveintent_shared.db import session_scope
from liveintent_shared.models import Advertiser
from liveintent_shared.enums import Vertical, VerticalSource

@click.command("override-vertical")
@click.argument("domain")
@click.argument("vertical")
def override_vertical(domain: str, vertical: str):
    """Set advertiser vertical manually (sticky)."""
    valid = [v.value for v in Vertical]
    if vertical not in valid:
        click.echo(f"Invalid vertical. Choose: {', '.join(valid)}", err=True)
        raise click.Abort()
    with session_scope() as s:
        a = s.scalar(select(Advertiser).where(Advertiser.domain == domain))
        if not a:
            click.echo(f"Advertiser {domain} not found", err=True)
            raise click.Abort()
        a.vertical = vertical
        a.vertical_source = VerticalSource.MANUAL.value
        a.vertical_classified_at = datetime.now(timezone.utc)
    click.echo(f"Set {domain} → {vertical} (manual)")
```

- [ ] **Step 2: Implement export**

Create `cli/liveintent_cli/export.py`:

```python
import json
import sys
import click
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from liveintent_shared.db import session_scope
from liveintent_shared.models import Advertiser, Creative, Impression

@click.command("export")
@click.option("--days", default=30, type=int)
@click.option("--out", default="-", help="Output file or '-' for stdout")
def export(days: int, out: str):
    """Export advertiser/creative/impression data as JSON."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    with session_scope() as s:
        advs = s.scalars(select(Advertiser).where(Advertiser.last_seen_at >= since)).all()
        result = []
        for a in advs:
            creatives = s.scalars(select(Creative).where(Creative.advertiser_id == a.id)).all()
            result.append({
                "domain": a.domain, "vertical": a.vertical, "vertical_source": a.vertical_source,
                "first_seen_at": a.first_seen_at.isoformat(),
                "creatives": [
                    {"hash": c.creative_hash, "headline": c.headline,
                     "final_landing_url": c.final_landing_url}
                    for c in creatives
                ],
            })
    payload = json.dumps(result, indent=2)
    if out == "-":
        sys.stdout.write(payload)
    else:
        from pathlib import Path
        Path(out).write_text(payload)
        click.echo(f"Wrote {len(result)} advertisers to {out}")
```

- [ ] **Step 3: Wire into main.py**

Edit `cli/liveintent_cli/main.py`:

```python
import click
from .publishers import add_publisher, list_publishers
from .advertisers import override_vertical
from .export import export

@click.group()
def cli():
    """LiveIntent Spy admin CLI."""
    pass

for c in (add_publisher, list_publishers, override_vertical, export):
    cli.add_command(c)

if __name__ == "__main__":
    cli()
```

- [ ] **Step 4: Smoke test**

```bash
uv sync
uv run liveintent-spy --help
uv run liveintent-spy export --days 30 --out /tmp/dump.json
```

Expected: produces a JSON file (possibly empty array) at /tmp/dump.json.

- [ ] **Step 5: Commit**

```bash
git add cli/
git commit -m "feat(cli): override-vertical + export commands"
```

---

## Phase 6: Web Dashboard

### Task 6.1: Next.js scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/page.tsx` (placeholder)
- Create: `apps/web/lib/api.ts`

- [ ] **Step 1: Scaffold with create-next-app**

```bash
cd /home/roly/liveintent-spy/apps
pnpm dlx create-next-app@latest web --ts --tailwind --app --no-src-dir --import-alias "@/*" --skip-install
cd web && pnpm install
```

- [ ] **Step 2: Add API client**

Create `apps/web/lib/api.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN!; // server-only

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Add env example**

Create `apps/web/.env.local.example`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
ADMIN_TOKEN=changeme
```

- [ ] **Step 4: Verify it builds**

```bash
cd apps/web && pnpm build
```

Expected: build succeeds (placeholder page).

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "chore(web): scaffold Next.js app + API client"
```

### Task 6.2: Top advertisers page

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Implement page**

Replace `apps/web/app/page.tsx`:

```tsx
import { api } from "@/lib/api";
import Link from "next/link";

type Advertiser = { domain: string; vertical: string; impressions: number };

export default async function Home() {
  const data = await api<Advertiser[]>("/advertisers?days=7&limit=100");
  const byVertical: Record<string, Advertiser[]> = {};
  for (const a of data) {
    if (a.vertical === "unclassified") continue;
    (byVertical[a.vertical] ??= []).push(a);
  }

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Top Advertisers — Last 7 Days</h1>
      {Object.keys(byVertical).sort().map((vert) => (
        <section key={vert} className="mb-8">
          <h2 className="text-lg font-medium mb-2 capitalize">{vert}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr><th>Domain</th><th>Impressions</th></tr>
            </thead>
            <tbody>
              {byVertical[vert].slice(0, 20).map((a) => (
                <tr key={a.domain} className="border-t">
                  <td className="py-1">
                    <Link className="underline" href={`/advertisers/${a.domain}`}>{a.domain}</Link>
                  </td>
                  <td>{a.impressions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {Object.keys(byVertical).length === 0 && (
        <p className="text-gray-500">No impressions yet. Subscribe a publisher and wait for the next cycle.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): top-advertisers landing page"
```

### Task 6.3: Advertiser detail page

**Files:**
- Create: `apps/web/app/advertisers/[domain]/page.tsx`

- [ ] **Step 1: Implement page**

Create `apps/web/app/advertisers/[domain]/page.tsx`:

```tsx
import { api } from "@/lib/api";
import { notFound } from "next/navigation";

type Creative = {
  id: number;
  headline: string | null;
  screenshot_path: string;
  final_landing_url: string | null;
  last_seen_at: string;
};

type AdvertiserDetail = {
  domain: string;
  vertical: string;
  vertical_source: string;
  first_seen_at: string;
  last_seen_at: string;
  creatives: Creative[];
};

export default async function AdvertiserPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  let data: AdvertiserDetail;
  try {
    data = await api<AdvertiserDetail>(`/advertisers/${encodeURIComponent(domain)}`);
  } catch {
    notFound();
  }

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">{data.domain}</h1>
      <p className="text-gray-500 mb-6">
        Vertical: <span className="capitalize">{data.vertical}</span> ({data.vertical_source})
        {" · "}First seen: {new Date(data.first_seen_at).toLocaleDateString()}
      </p>
      <h2 className="text-lg font-medium mb-3">Creatives ({data.creatives.length})</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.creatives.map((c) => (
          <div key={c.id} className="border rounded p-3">
            <img
              src={`${process.env.NEXT_PUBLIC_API_URL}/creatives/${c.id}/screenshot`}
              alt="creative"
              className="max-w-full"
            />
            {c.headline && <p className="text-sm mt-2">{c.headline}</p>}
            {c.final_landing_url && (
              <a href={c.final_landing_url} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-blue-600 underline mt-1 block break-all">
                {c.final_landing_url}
              </a>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Last seen {new Date(c.last_seen_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
```

Note: the screenshot URL hits the API directly with admin token — for v1 we'll proxy this server-side instead since we don't want to expose the token in the browser.

- [ ] **Step 2: Add image proxy route**

Create `apps/web/app/api/creatives/[id]/screenshot/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/creatives/${id}/screenshot`, {
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  });
  if (!r.ok) return new NextResponse(null, { status: 404 });
  return new NextResponse(r.body, {
    headers: { "Content-Type": r.headers.get("Content-Type") || "image/png" },
  });
}
```

- [ ] **Step 3: Update advertiser page to use proxy**

In `apps/web/app/advertisers/[domain]/page.tsx`, change the `<img src=...>` line to:

```tsx
<img src={`/api/creatives/${c.id}/screenshot`} alt="creative" className="max-w-full" />
```

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): advertiser detail page + screenshot proxy"
```

### Task 6.4: Publisher detail page

**Files:**
- Create: `apps/web/app/publishers/[domain]/page.tsx`

- [ ] **Step 1: Implement page**

Create `apps/web/app/publishers/[domain]/page.tsx`:

```tsx
import { api } from "@/lib/api";
import Link from "next/link";
import { notFound } from "next/navigation";

type Pub = {
  domain: string; name: string | null; active: boolean;
  top_advertisers: { domain: string; impressions: number }[];
};

export default async function PublisherPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  let data: Pub;
  try {
    data = await api<Pub>(`/publishers/${encodeURIComponent(domain)}?days=7`);
  } catch {
    notFound();
  }
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">{data.name || data.domain}</h1>
      <p className="text-gray-500 mb-6">{data.domain} · {data.active ? "active" : "inactive"}</p>
      <h2 className="text-lg font-medium mb-3">Top Advertisers (7d)</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500"><tr><th>Domain</th><th>Impressions</th></tr></thead>
        <tbody>
          {data.top_advertisers.map((a) => (
            <tr key={a.domain} className="border-t">
              <td className="py-1"><Link className="underline" href={`/advertisers/${a.domain}`}>{a.domain}</Link></td>
              <td>{a.impressions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
pnpm build
git add apps/web/
git commit -m "feat(web): publisher detail page"
```

---

## Phase 7: Infra & Deploy

### Task 7.1: systemd service files

**Files:**
- Create: `infra/systemd/scraper-worker.service`
- Create: `infra/systemd/enrichment-worker.service`

- [ ] **Step 1: Write scraper service**

Create `infra/systemd/scraper-worker.service`:

```ini
[Unit]
Description=LiveIntent Spy — Scraper Worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=liveintent
WorkingDirectory=/opt/liveintent-spy
EnvironmentFile=/opt/liveintent-spy/.env
ExecStart=/opt/liveintent-spy/.venv/bin/python -m liveintent_scraper.main
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Write enrichment service**

Create `infra/systemd/enrichment-worker.service`:

```ini
[Unit]
Description=LiveIntent Spy — Enrichment Worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=liveintent
WorkingDirectory=/opt/liveintent-spy
EnvironmentFile=/opt/liveintent-spy/.env
ExecStart=/opt/liveintent-spy/.venv/bin/python -m liveintent_enrichment.main
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Commit**

```bash
git add infra/systemd/
git commit -m "feat(infra): systemd unit files for scraper + enrichment workers"
```

### Task 7.2: Hetzner provisioning script

**Files:**
- Create: `infra/deploy.sh`
- Create: `infra/README.md`

- [ ] **Step 1: Write deploy.sh**

Create `infra/deploy.sh`:

```bash
#!/usr/bin/env bash
# Run on a fresh Hetzner Ubuntu 24.04 box, as root.
set -euo pipefail

apt-get update
apt-get install -y postgresql-16 tesseract-ocr git curl python3.12 python3.12-venv

# Postgres
sudo -u postgres psql <<EOF
CREATE USER liveintent WITH PASSWORD 'CHANGEME';
CREATE DATABASE liveintent OWNER liveintent;
EOF

# App user
useradd -m -s /bin/bash liveintent || true

# Code
sudo -u liveintent bash <<'EOF'
cd /home/liveintent
git clone https://github.com/<your-github>/liveintent-spy.git || (cd liveintent-spy && git pull)
cd liveintent-spy
curl -LsSf https://astral.sh/uv/install.sh | sh
~/.local/bin/uv sync
~/.local/bin/uv run playwright install --with-deps chromium
EOF

# Symlink to /opt for systemd
ln -sfn /home/liveintent/liveintent-spy /opt/liveintent-spy

# Write .env (operator must edit)
[ -f /opt/liveintent-spy/.env ] || cp /opt/liveintent-spy/.env.example /opt/liveintent-spy/.env
chown liveintent:liveintent /opt/liveintent-spy/.env
chmod 600 /opt/liveintent-spy/.env

# Migrations
sudo -u liveintent bash -c "cd /opt/liveintent-spy && ~/.local/bin/uv run alembic -c packages/shared/alembic.ini upgrade head"

# systemd
cp /opt/liveintent-spy/infra/systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable scraper-worker.service enrichment-worker.service
systemctl restart scraper-worker.service enrichment-worker.service

echo "Done. Edit /opt/liveintent-spy/.env, then 'systemctl restart scraper-worker enrichment-worker'."
```

- [ ] **Step 2: Make executable and write README**

```bash
chmod +x infra/deploy.sh
```

Create `infra/README.md`:

```markdown
# Infra

## First deploy

1. Provision a Hetzner CX22 (Ubuntu 24.04).
2. Copy `deploy.sh` to the box, run as root.
3. Edit `/opt/liveintent-spy/.env` with real values (DATABASE_URL points to the local Postgres; replace `CHANGEME`).
4. `systemctl restart scraper-worker enrichment-worker`.
5. Verify: `journalctl -u scraper-worker -f`.

## Backups

Cron entry (`crontab -e` as root):

```
0 3 * * * /opt/liveintent-spy/infra/backup.sh
```

## Updates

```
cd /opt/liveintent-spy
sudo -u liveintent git pull
sudo -u liveintent ~/.local/bin/uv sync
sudo -u liveintent ~/.local/bin/uv run alembic -c packages/shared/alembic.ini upgrade head
systemctl restart scraper-worker enrichment-worker
```
```

- [ ] **Step 3: Commit**

```bash
git add infra/
git commit -m "feat(infra): hetzner provisioning script + README"
```

### Task 7.3: Backup script (pg_dump → B2)

**Files:**
- Create: `infra/backup.sh`

- [ ] **Step 1: Write backup script**

Create `infra/backup.sh`:

```bash
#!/usr/bin/env bash
# Nightly Postgres dump + upload to Backblaze B2.
# Requires: B2_KEY_ID, B2_APP_KEY, B2_BUCKET in /opt/liveintent-spy/.env
set -euo pipefail

source /opt/liveintent-spy/.env

DATE=$(date +%Y%m%d)
DUMP=/tmp/liveintent-${DATE}.sql.gz

sudo -u postgres pg_dump -d liveintent | gzip > "$DUMP"

# Upload via b2 CLI (install once: pip install b2)
b2 authorize-account "$B2_KEY_ID" "$B2_APP_KEY" >/dev/null
b2 upload-file "$B2_BUCKET" "$DUMP" "backups/$(basename "$DUMP")"

# Keep last 7 days locally
find /tmp -name 'liveintent-*.sql.gz' -mtime +7 -delete

echo "Backup uploaded: backups/$(basename "$DUMP")"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x infra/backup.sh
```

- [ ] **Step 3: Add B2 vars to .env.example**

Append to `.env.example`:

```
B2_KEY_ID=
B2_APP_KEY=
B2_BUCKET=liveintent-spy-backups
```

- [ ] **Step 4: Commit**

```bash
git add infra/backup.sh .env.example
git commit -m "feat(infra): nightly pg_dump → B2 backup script"
```

### Task 7.4: Railway config for API

**Files:**
- Create: `packages/api/railway.json`
- Create: `packages/api/Dockerfile`

- [ ] **Step 1: Write Dockerfile**

Create `packages/api/Dockerfile`:

```dockerfile
FROM python:3.12-slim

RUN pip install uv

WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY packages/shared /app/packages/shared
COPY packages/api /app/packages/api
RUN uv sync --frozen --no-dev

ENV PORT=8000
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "liveintent_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

(Build context must be the repo root, not the package dir.)

- [ ] **Step 2: Write railway.json**

Create `packages/api/railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "packages/api/Dockerfile"
  },
  "deploy": {
    "startCommand": "uv run uvicorn liveintent_api.main:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/Dockerfile packages/api/railway.json
git commit -m "feat(infra): Railway Dockerfile + config for API"
```

### Task 7.5: Vercel config for web

**Files:**
- Create: `apps/web/vercel.ts`

- [ ] **Step 1: Install @vercel/config**

```bash
cd apps/web && pnpm add -D @vercel/config
```

- [ ] **Step 2: Write vercel.ts**

Create `apps/web/vercel.ts`:

```typescript
import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm build",
  installCommand: "pnpm install",
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat(infra): vercel.ts for web app"
```

### Task 7.6: README for the whole repo

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write full README**

Replace `README.md`:

```markdown
# liveintent-spy

LiveIntent ad spy tool — subscribes to publisher newsletters, parses LiveIntent ad slots out of rendered emails, classifies advertisers by vertical, and surfaces top advertisers via Telegram digest + Next.js dashboard.

Design spec: `docs/superpowers/specs/2026-04-27-liveintent-spy-design.md` (in parent project).

## Local development

```bash
cp .env.example .env  # edit values
docker compose up -d  # local Postgres
uv sync
uv run playwright install chromium
uv run alembic -c packages/shared/alembic.ini upgrade head
uv run pytest

# Run a worker locally
uv run python -m liveintent_scraper.main
uv run python -m liveintent_enrichment.main

# Run API
uv run uvicorn liveintent_api.main:app --reload

# Run web
cd apps/web && pnpm dev

# Use the CLI
uv run liveintent-spy add-publisher morningbrew.com --email r.alvarez@yourdomain.com
```

## Deploy

- Scraper + enrichment workers + Postgres → Hetzner via `infra/deploy.sh`
- API → Railway (`packages/api/railway.json`)
- Web → Vercel (`apps/web/vercel.ts`)
- Backups → Backblaze B2 nightly via `infra/backup.sh`

See `infra/README.md` for first-deploy details.

## Onboarding a publisher

1. `uv run liveintent-spy add-publisher <domain> --email <alias>@<your-catchall> --name "<Display Name>"`
2. Visit publisher's signup form, enter the alias, complete double-opt-in.
3. Wait for next scraper cycle (~5 min). Check `/health` and `journalctl -u scraper-worker`.

## Daily digest

Cron on Railway hits `POST /digest/run` at 9am UTC. Output sent to Telegram chat configured via `TELEGRAM_CHAT_ID`.

On-demand commands (Telegram):
- `/topadvertisers [days]`
- `/advertiser <domain>`
- `/vertical <name>`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: full README"
```

### Task 7.7: Railway daily digest cron

**Files:**
- Create: `infra/railway-cron.md` (operator notes — cron is configured in Railway UI)

- [ ] **Step 1: Document the cron config**

Create `infra/railway-cron.md`:

```markdown
# Railway Cron Configuration

Configure in Railway dashboard for the API service:

- **Cron Schedule:** `0 9 * * *` (9am UTC daily)
- **Command:** `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $INTERNAL_API_URL/digest/run`

Where:
- `ADMIN_TOKEN` is the env var on the API service
- `INTERNAL_API_URL` is the internal Railway URL (e.g. `http://localhost:8000`) since cron runs in the same service

Alternatively, deploy a separate "cron" service that just runs the curl on schedule and points at the public API URL.
```

- [ ] **Step 2: Commit**

```bash
git add infra/railway-cron.md
git commit -m "docs(infra): railway cron setup notes"
```

---

## Phase 8: Final Verification

### Task 8.1: Run all tests + cleanup

- [ ] **Step 1: Run full suite**

```bash
cd /home/roly/liveintent-spy
docker compose up -d
uv run pytest -v
```

Expected: all tests pass across all packages.

- [ ] **Step 2: Run mypy / ruff (if configured)**

```bash
uv run python -m py_compile $(find packages cli -name '*.py')
```

Expected: no syntax errors.

- [ ] **Step 3: Confirm migrations apply cleanly from scratch**

```bash
docker compose down -v && docker compose up -d
sleep 3
uv run alembic -c packages/shared/alembic.ini upgrade head
docker compose exec postgres psql -U liveintent -c "\dt"
```

Expected: 6 tables + alembic_version.

- [ ] **Step 4: Final commit**

```bash
git add -A
git status  # should be clean
git log --oneline | head -30  # sanity check commit history
```

### Task 8.2: Tag and push to remote

- [ ] **Step 1: Create remote**

```bash
gh repo create liveintent-spy --private --source=. --remote=origin --push
```

- [ ] **Step 2: Tag v0.1.0**

```bash
git tag v0.1.0
git push --tags
```

---

## Out-of-scope items left for v2

(These are noted in the spec; do not attempt in this plan.)

- Publisher web-archive scrape (hybrid mode, Flow B alternative)
- Residential proxy integration for resolve step
- Reclassification job for `vertical_source=auto` rows older than 90 days
- Spend estimates beyond raw frequency
- Cross-platform attribution
- Multi-user auth, public sharing
- Historical backfill
