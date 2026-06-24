# MVMT Printer — Setup Guide

This is a snapshot of MVMT Printer (a FB ad management tool) for collaborative use on the **RS Agency** Business Manager. Shipped on 2026-05-20.

## What's inside

- Full source (React 19 + Vite frontend, Python FastAPI backend)
- `.env` — pre-populated with all working API keys (Gemini, Fal, KIE, R2, FB RS Agency)
- `seed.sql` — Postgres dump (RS Agency data only; Clikim Global stripped)
- `backend/uploads/` — persona images and ad creative assets (videos stripped to keep zip small)

## What's stripped

- Clikim Global FB connection + all dependent data (~80 rows across 8 tables)
- Active session tokens (refresh_tokens table — buddy will log in fresh)
- All video files in `backend/uploads/` (mp4/mov/webm/avi)
- `.git`, `node_modules`, `venv`, build artifacts

---

## Prerequisites

- **Python 3.11+** (`python3 --version`)
- **Node.js 20+** + npm (`node --version`)
- **Postgres 17** running locally
- **ffmpeg** (for video upload/thumbnail features — `sudo apt install ffmpeg` or `brew install ffmpeg`)

---

## Install steps

### 1. Postgres setup

The shipped `.env` expects:
```
postgresql://roly:localdev@localhost:5432/mvmt_printer
```

Either create that exact user + DB, OR edit `DATABASE_URL` in `.env` to match your local Postgres.

To match the shipped config:
```bash
sudo -u postgres psql <<EOF
CREATE USER roly WITH PASSWORD 'localdev' SUPERUSER;
CREATE DATABASE mvmt_printer OWNER roly;
EOF
```

Then load the seed:
```bash
PGPASSWORD=localdev psql -U roly -h localhost -d mvmt_printer < seed.sql
```

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Run the backend (defaults to port 8000):
```bash
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev    # vite dev server on port 5173
```

Open http://localhost:5173

---

## Login

Existing users in seed:
- `raj@digitalmvmt.com` — Raj's account (use the password you already know, or reset via DB)
- `admin@example.com` — default admin (password is the `ADMIN_PASSWORD` value in `.env`)

To reset any password, generate a bcrypt hash:
```bash
cd backend && source venv/bin/activate
python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('your-new-password'))"
```
Then update:
```sql
UPDATE users SET hashed_password = '<paste-hash>' WHERE email = 'raj@digitalmvmt.com';
```

---

## FB Business Manager

- The shipped FB access token belongs to **RS Agency BM**
- App ID + Secret are in `.env` — you should be added as a developer on the FB App for the token to keep working past its current expiry
- Long-lived tokens expire every 60 days; regenerate via Graph API Explorer

---

## Shared services — heads up

These are all on Roly's accounts; your usage hits his bills:
- **Gemini, Fal.ai, KIE** — AI generation APIs (image, video, copy)
- **Cloudflare R2** — blob storage for uploaded media
- Coordinate before doing big batch generation runs

---

## What if something breaks

- Check backend logs: terminal where uvicorn is running
- Frontend errors: browser devtools console
- DB issues: `PGPASSWORD=localdev psql -U roly -d mvmt_printer` and check tables
- Most "FB API failed" errors = token expired; regenerate from Graph API Explorer and update `FACEBOOK_ACCESS_TOKEN` + `VITE_FACEBOOK_ACCESS_TOKEN` in `.env`

---

## Hosting (future)

App is currently local-only (Railway was cancelled 2026-05-06). If we host shared, we'll need to:
1. Move Postgres to a managed instance (Neon, Railway, RDS)
2. Move `.env` to the host's secret store (don't ship in git)
3. Set up auth properly (current admin password is in plain `.env`)
