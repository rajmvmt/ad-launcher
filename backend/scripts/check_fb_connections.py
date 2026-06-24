"""Diagnose Facebook connections — print granted scopes and ad-account access.

Usage:
    cd backend && python scripts/check_fb_connections.py
    cd backend && python scripts/check_fb_connections.py <connection_id>
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from app.database import SessionLocal
from app.models import FacebookConnection

GRAPH = "https://graph.facebook.com/v24.0"
REQUIRED_SCOPES = {"ads_management", "ads_read", "business_management", "pages_show_list"}


def check(conn: FacebookConnection) -> None:
    print(f"\n=== {conn.name} ({conn.id}) ===")
    print(f"active: {conn.is_active}  default: {conn.is_default}")
    token = conn.access_token

    r = requests.get(
        f"{GRAPH}/debug_token",
        params={"input_token": token, "access_token": token},
        timeout=15,
    )
    if r.status_code != 200:
        print(f"  debug_token failed: {r.status_code} {r.text[:300]}")
        return
    data = r.json().get("data", {})
    scopes = set(data.get("scopes", []))
    print(f"  fb user: {data.get('user_id')}  app: {data.get('app_id')}")
    print(f"  expires: {data.get('expires_at')}  valid: {data.get('is_valid')}")
    print(f"  scopes granted: {sorted(scopes) or 'NONE'}")
    missing = REQUIRED_SCOPES - scopes
    if missing:
        print(f"  >>> MISSING SCOPES: {sorted(missing)}")
    else:
        print("  scopes OK")

    if conn.ad_account_id:
        acct = conn.ad_account_id
        if not acct.startswith("act_"):
            acct = f"act_{acct}"
        r = requests.get(
            f"{GRAPH}/{acct}",
            params={"fields": "id,name,account_status,business", "access_token": token},
            timeout=15,
        )
        if r.status_code == 200:
            print(f"  ad account {acct}: {r.json()}")
        else:
            print(f"  ad account {acct} ERROR: {r.status_code} {r.text[:300]}")

    r = requests.get(
        f"{GRAPH}/me/adaccounts",
        params={"fields": "id,name,account_status", "access_token": token, "limit": 50},
        timeout=15,
    )
    if r.status_code == 200:
        accts = r.json().get("data", [])
        print(f"  visible ad accounts: {len(accts)}")
        for a in accts[:10]:
            print(f"    - {a.get('id')} {a.get('name')} status={a.get('account_status')}")
    else:
        print(f"  /me/adaccounts ERROR: {r.status_code} {r.text[:300]}")


def main() -> None:
    db = SessionLocal()
    try:
        q = db.query(FacebookConnection)
        if len(sys.argv) > 1:
            q = q.filter(FacebookConnection.id == sys.argv[1])
        conns = q.all()
        if not conns:
            print("no connections found")
            return
        for c in conns:
            check(c)
    finally:
        db.close()


if __name__ == "__main__":
    main()
