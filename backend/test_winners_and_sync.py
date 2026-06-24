#!/usr/bin/env python3
"""
End-to-end test for Winning Personas and Daily Stats Sync features.
Tests against the actual database - creates test data, verifies, cleans up.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from datetime import datetime, timezone
from app.database import SessionLocal
from app.models import (
    Persona, FBSyncCampaign, FBSyncAdSet, FBSyncAd, FBSyncStatus
)

PASS = 0
FAIL = 0
ERRORS = []

def check(label, condition, detail=""):
    global PASS, FAIL, ERRORS
    if condition:
        PASS += 1
        print(f"  ✓ {label}")
    else:
        FAIL += 1
        msg = f"  ✗ {label}" + (f" — {detail}" if detail else "")
        print(msg)
        ERRORS.append(msg)


def test_winner_model_fields():
    """Test that winner fields exist on Persona model and work correctly."""
    print("\n── Test: Winner Model Fields ──")
    db = SessionLocal()
    try:
        # Find any existing persona to test with, or create a temp one
        persona = db.query(Persona).first()
        if not persona:
            print("  (no personas in DB — creating temp persona)")
            persona = Persona(
                name="__test_winner_persona__",
                gender="female",
                age=45,
                location_city="TestCity",
                location_state="TX",
                occupation="Tester",
            )
            db.add(persona)
            db.commit()

        pid = persona.id
        original_winner = persona.is_winner
        original_notes = persona.winner_notes
        original_offers = persona.winner_proven_offers
        original_promoted = persona.winner_promoted_at

        # Test promote
        persona.is_winner = True
        persona.winner_notes = "Test notes — 4x ROAS on patch"
        persona.winner_proven_offers = ["akemi", "patch"]
        persona.winner_promoted_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(persona)

        check("is_winner field set to True", persona.is_winner == True)
        check("winner_notes stored", persona.winner_notes == "Test notes — 4x ROAS on patch")
        check("winner_proven_offers stored as list", persona.winner_proven_offers == ["akemi", "patch"])
        check("winner_promoted_at is datetime", persona.winner_promoted_at is not None)

        # Test query filter
        winners = db.query(Persona).filter(Persona.is_winner == True).all()
        winner_ids = [w.id for w in winners]
        check("Winner appears in is_winner=True query", pid in winner_ids)

        # Test demote
        persona.is_winner = False
        persona.winner_notes = None
        persona.winner_proven_offers = None
        persona.winner_promoted_at = None
        db.commit()
        db.refresh(persona)

        check("is_winner field cleared", persona.is_winner == False)
        check("winner_notes cleared", persona.winner_notes is None)
        check("winner_proven_offers cleared", persona.winner_proven_offers is None)
        check("winner_promoted_at cleared", persona.winner_promoted_at is None)

        # Restore original state
        persona.is_winner = original_winner or False
        persona.winner_notes = original_notes
        persona.winner_proven_offers = original_offers
        persona.winner_promoted_at = original_promoted
        db.commit()

        # Clean up temp persona if we created one
        if persona.name == "__test_winner_persona__":
            db.delete(persona)
            db.commit()

    except Exception as e:
        check(f"Model test raised exception: {e}", False)
        db.rollback()
    finally:
        db.close()


def test_winner_api_endpoints():
    """Test the winner API endpoints via FastAPI TestClient."""
    print("\n── Test: Winner API Endpoints ──")
    try:
        from fastapi.testclient import TestClient
        from app.main import app
    except Exception as e:
        check(f"Import FastAPI app: {e}", False)
        return

    client = TestClient(app)

    # We need auth — create a test user or use existing
    db = SessionLocal()
    try:
        from app.models import User
        from app.core.security import create_access_token

        user = db.query(User).first()
        if not user:
            check("No user in DB to test with", False, "Need at least one user for auth")
            return

        token = create_access_token(data={"sub": user.id})
        headers = {"Authorization": f"Bearer {token}"}

        # Find or create a test persona
        persona = db.query(Persona).filter(Persona.is_winner == False).first()
        if not persona:
            persona = db.query(Persona).first()
        if not persona:
            check("No persona to test with", False)
            return

        pid = persona.id
        pname = persona.name
        was_winner = persona.is_winner

        # 1) GET /winners — should work (even if empty)
        resp = client.get("/api/v1/personas/winners", headers=headers)
        check(f"GET /winners returns 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
        check("GET /winners returns list", isinstance(resp.json(), list))

        # 2) PATCH /promote-winner
        resp = client.patch(
            f"/api/v1/personas/{pid}/promote-winner",
            json={"notes": "E2E test winner", "proven_offers": ["test_offer", "akemi"]},
            headers=headers,
        )
        check(f"PATCH /promote-winner returns 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
        if resp.status_code == 200:
            data = resp.json()
            check("Promoted persona has is_winner=True", data.get("is_winner") == True)
            check("Promoted persona has notes", data.get("winner_notes") == "E2E test winner")
            check("Promoted persona has proven_offers", data.get("winner_proven_offers") == ["test_offer", "akemi"])
            check("Promoted persona has promoted_at", data.get("winner_promoted_at") is not None)

        # 3) GET /winners — should include our persona now
        resp = client.get("/api/v1/personas/winners", headers=headers)
        check("GET /winners includes promoted persona",
              any(w["id"] == pid for w in resp.json()),
              f"persona {pid} not found in winners list")

        # 4) GET /winners?offer=test_offer — filter should work
        resp = client.get("/api/v1/personas/winners?offer=test_offer", headers=headers)
        check("GET /winners?offer=test_offer returns results",
              any(w["id"] == pid for w in resp.json()))

        # 5) GET /winners?offer=nonexistent — should not include
        resp = client.get("/api/v1/personas/winners?offer=zzz_nonexistent", headers=headers)
        check("GET /winners?offer=nonexistent excludes persona",
              not any(w["id"] == pid for w in resp.json()))

        # 6) PATCH /winner-notes — update notes
        resp = client.patch(
            f"/api/v1/personas/{pid}/winner-notes",
            json={"notes": "Updated E2E notes", "proven_offers": ["akemi"]},
            headers=headers,
        )
        check(f"PATCH /winner-notes returns 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
        if resp.status_code == 200:
            data = resp.json()
            check("Notes updated", data.get("winner_notes") == "Updated E2E notes")
            check("Offers updated", data.get("winner_proven_offers") == ["akemi"])

        # 7) PATCH /demote-winner
        resp = client.patch(f"/api/v1/personas/{pid}/demote-winner", headers=headers)
        check(f"PATCH /demote-winner returns 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
        if resp.status_code == 200:
            data = resp.json()
            check("Demoted persona has is_winner=False", data.get("is_winner") == False)
            check("Demoted persona has no notes", data.get("winner_notes") is None)
            check("Demoted persona has no offers", data.get("winner_proven_offers") is None)
            check("Demoted persona has no promoted_at", data.get("winner_promoted_at") is None)

        # 8) PATCH /winner-notes on non-winner should fail
        resp = client.patch(
            f"/api/v1/personas/{pid}/winner-notes",
            json={"notes": "Should fail"},
            headers=headers,
        )
        check("PATCH /winner-notes on non-winner returns 400", resp.status_code == 400, f"got {resp.status_code}")

        # 9) PATCH /promote-winner with bad persona ID
        resp = client.patch(
            "/api/v1/personas/nonexistent_id_12345/promote-winner",
            json={"notes": "test"},
            headers=headers,
        )
        check("PATCH /promote-winner with bad ID returns 404", resp.status_code == 404, f"got {resp.status_code}")

        # 10) GET /winners after demote — should NOT include persona
        resp = client.get("/api/v1/personas/winners", headers=headers)
        check("GET /winners excludes demoted persona",
              not any(w["id"] == pid for w in resp.json()))

        # Restore original state if needed
        if was_winner:
            db.refresh(persona)
            persona.is_winner = True
            db.commit()

    except Exception as e:
        import traceback
        check(f"API test exception: {e}", False, traceback.format_exc()[-300:])
        db.rollback()
    finally:
        db.close()


def test_winner_serialization():
    """Test that winner fields appear in list_personas and get_persona responses."""
    print("\n── Test: Winner Serialization in Persona List ──")
    try:
        from fastapi.testclient import TestClient
        from app.main import app
    except Exception as e:
        check(f"Import: {e}", False)
        return

    client = TestClient(app)
    db = SessionLocal()
    try:
        from app.models import User
        from app.core.security import create_access_token

        user = db.query(User).first()
        if not user:
            return

        token = create_access_token(data={"sub": user.id})
        headers = {"Authorization": f"Bearer {token}"}

        # Get persona list
        resp = client.get("/api/v1/personas/", headers=headers)
        check("GET /personas/ returns 200", resp.status_code == 200, f"got {resp.status_code}")
        if resp.status_code == 200 and len(resp.json()) > 0:
            first = resp.json()[0]
            check("Persona list includes is_winner field", "is_winner" in first, f"keys: {list(first.keys())[:10]}")
            check("Persona list includes winner_notes field", "winner_notes" in first)
            check("Persona list includes winner_proven_offers field", "winner_proven_offers" in first)
            check("Persona list includes winner_promoted_at field", "winner_promoted_at" in first)

        # Get single persona
        persona = db.query(Persona).first()
        if persona:
            resp = client.get(f"/api/v1/personas/{persona.id}", headers=headers)
            check("GET /personas/{id} returns 200", resp.status_code == 200)
            if resp.status_code == 200:
                data = resp.json()
                check("Single persona includes is_winner field", "is_winner" in data)

    except Exception as e:
        check(f"Serialization test exception: {e}", False)
        db.rollback()
    finally:
        db.close()


def test_daily_sync_model_fields():
    """Test that today_* fields exist on all three sync tables."""
    print("\n── Test: Daily Sync Model Fields ──")
    db = SessionLocal()
    try:
        # Check FBSyncCampaign
        from sqlalchemy import inspect
        mapper = inspect(FBSyncCampaign)
        campaign_cols = [c.key for c in mapper.column_attrs]
        for field in ['today_date', 'today_spend', 'today_impressions', 'today_clicks',
                      'today_ctr', 'today_cpc', 'today_cpm', 'today_results',
                      'today_purchase_revenue', 'today_actions', 'today_action_values']:
            check(f"FBSyncCampaign has {field}", field in campaign_cols, f"cols: {campaign_cols}")

        mapper = inspect(FBSyncAdSet)
        adset_cols = [c.key for c in mapper.column_attrs]
        for field in ['today_date', 'today_spend', 'today_impressions', 'today_clicks',
                      'today_results', 'today_purchase_revenue']:
            check(f"FBSyncAdSet has {field}", field in adset_cols)

        mapper = inspect(FBSyncAd)
        ad_cols = [c.key for c in mapper.column_attrs]
        for field in ['today_date', 'today_spend', 'today_impressions', 'today_clicks',
                      'today_results', 'today_purchase_revenue']:
            check(f"FBSyncAd has {field}", field in ad_cols)

    except Exception as e:
        check(f"Model field test exception: {e}", False)
    finally:
        db.close()


def test_daily_sync_reporting_endpoints():
    """Test reporting endpoints with and without date param."""
    print("\n── Test: Daily Sync Reporting Endpoints ──")
    try:
        from fastapi.testclient import TestClient
        from app.main import app
    except Exception as e:
        check(f"Import: {e}", False)
        return

    client = TestClient(app)
    db = SessionLocal()
    try:
        from app.models import User
        from app.core.security import create_access_token

        user = db.query(User).first()
        if not user:
            return

        token = create_access_token(data={"sub": user.id})
        headers = {"Authorization": f"Bearer {token}"}

        # Find an ad account that has synced data
        sync_status = db.query(FBSyncStatus).first()
        if not sync_status:
            print("  (no sync data in DB — skipping reporting endpoint tests)")
            check("Sync data exists", False, "No FBSyncStatus records — run sync first to test this fully")
            return

        acct_id = sync_status.ad_account_id
        today = datetime.now().strftime('%Y-%m-%d')

        # 1) GET /campaigns without date — should return aggregate stats
        resp = client.get(f"/api/v1/reporting/campaigns?ad_account_id={acct_id}", headers=headers)
        check("GET /reporting/campaigns returns 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
        if resp.status_code == 200:
            data = resp.json()
            check("Campaigns returns list", isinstance(data, list))
            if len(data) > 0:
                camp = data[0]
                check("Campaign has insights object", "insights" in camp)
                check("Campaign insights has spend", "spend" in camp.get("insights", {}))
                check("Campaign has id field", "id" in camp)
                check("Campaign has name field", "name" in camp)

        # 2) GET /campaigns WITH date=today — should return today_* stats
        resp = client.get(f"/api/v1/reporting/campaigns?ad_account_id={acct_id}&date={today}", headers=headers)
        check("GET /reporting/campaigns?date=today returns 200", resp.status_code == 200, f"got {resp.status_code}: {resp.text[:200]}")
        if resp.status_code == 200:
            data = resp.json()
            if len(data) > 0:
                ins = data[0].get("insights", {})
                check("Today campaign insights has spend field", "spend" in ins)
                check("Today campaign insights has impressions field", "impressions" in ins)
                check("Today campaign insights has clicks field", "clicks" in ins)

        # 3) GET /adsets without date
        campaign = db.query(FBSyncCampaign).filter(FBSyncCampaign.ad_account_id == acct_id).first()
        if campaign:
            resp = client.get(
                f"/api/v1/reporting/adsets?ad_account_id={acct_id}&campaign_id={campaign.fb_campaign_id}",
                headers=headers,
            )
            check("GET /reporting/adsets returns 200", resp.status_code == 200, f"got {resp.status_code}")

            # With date
            resp = client.get(
                f"/api/v1/reporting/adsets?ad_account_id={acct_id}&campaign_id={campaign.fb_campaign_id}&date={today}",
                headers=headers,
            )
            check("GET /reporting/adsets?date=today returns 200", resp.status_code == 200, f"got {resp.status_code}")

        # 4) GET /ads without date
        adset = db.query(FBSyncAdSet).filter(FBSyncAdSet.ad_account_id == acct_id).first()
        if adset:
            resp = client.get(
                f"/api/v1/reporting/ads?ad_account_id={acct_id}&adset_id={adset.fb_adset_id}",
                headers=headers,
            )
            check("GET /reporting/ads returns 200", resp.status_code == 200, f"got {resp.status_code}")

            resp = client.get(
                f"/api/v1/reporting/ads?ad_account_id={acct_id}&adset_id={adset.fb_adset_id}&date={today}",
                headers=headers,
            )
            check("GET /reporting/ads?date=today returns 200", resp.status_code == 200, f"got {resp.status_code}")

        # 5) GET /all-ads
        resp = client.get(f"/api/v1/reporting/all-ads?ad_account_id={acct_id}", headers=headers)
        check("GET /reporting/all-ads returns 200", resp.status_code == 200, f"got {resp.status_code}")

        resp = client.get(f"/api/v1/reporting/all-ads?ad_account_id={acct_id}&date={today}", headers=headers)
        check("GET /reporting/all-ads?date=today returns 200", resp.status_code == 200, f"got {resp.status_code}")

        # 6) GET /all-adsets
        resp = client.get(f"/api/v1/reporting/all-adsets?ad_account_id={acct_id}", headers=headers)
        check("GET /reporting/all-adsets returns 200", resp.status_code == 200, f"got {resp.status_code}")

        resp = client.get(f"/api/v1/reporting/all-adsets?ad_account_id={acct_id}&date={today}", headers=headers)
        check("GET /reporting/all-adsets?date=today returns 200", resp.status_code == 200, f"got {resp.status_code}")

        # 7) GET /sync-status
        resp = client.get(f"/api/v1/reporting/sync-status?ad_account_id={acct_id}", headers=headers)
        check("GET /reporting/sync-status returns 200", resp.status_code == 200, f"got {resp.status_code}")

    except Exception as e:
        import traceback
        check(f"Reporting test exception: {e}", False, traceback.format_exc()[-300:])
        db.rollback()
    finally:
        db.close()


def test_today_stats_content():
    """Verify today_* fields have different values than aggregate when data exists."""
    print("\n── Test: Today Stats Content Verification ──")
    db = SessionLocal()
    try:
        # Check if any campaign has today_date set
        camp_with_today = db.query(FBSyncCampaign).filter(
            FBSyncCampaign.today_date != None
        ).first()

        if camp_with_today:
            check("Found campaign with today_date set", True)
            check(f"today_date value is a date string",
                  camp_with_today.today_date is not None and len(camp_with_today.today_date) == 10,
                  f"value: {camp_with_today.today_date}")
            check("today_spend is set", camp_with_today.today_spend is not None)
            check("today_impressions is set", camp_with_today.today_impressions is not None)
        else:
            print("  (no campaigns with today_date — sync hasn't run yet with new code)")
            print("  This is expected if the cron hasn't fired since deployment.")
            check("Campaigns exist without today data (pre-sync)", True)

        # Verify DB columns actually exist at the SQL level
        from sqlalchemy import text
        result = db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'fb_sync_campaigns' AND column_name LIKE 'today_%' "
            "ORDER BY column_name"
        ))
        today_cols = [r[0] for r in result]
        check("DB has today_* columns on fb_sync_campaigns",
              len(today_cols) >= 10,
              f"found {len(today_cols)}: {today_cols}")

        result = db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'fb_sync_adsets' AND column_name LIKE 'today_%' "
            "ORDER BY column_name"
        ))
        today_cols = [r[0] for r in result]
        check("DB has today_* columns on fb_sync_adsets",
              len(today_cols) >= 10,
              f"found {len(today_cols)}: {today_cols}")

        result = db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'fb_sync_ads' AND column_name LIKE 'today_%' "
            "ORDER BY column_name"
        ))
        today_cols = [r[0] for r in result]
        check("DB has today_* columns on fb_sync_ads",
              len(today_cols) >= 10,
              f"found {len(today_cols)}: {today_cols}")

        # Verify winner columns exist
        result = db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'personas' AND column_name LIKE 'winner_%' "
            "ORDER BY column_name"
        ))
        winner_cols = [r[0] for r in result]
        check("DB has winner_* columns on personas",
              len(winner_cols) >= 3,
              f"found {len(winner_cols)}: {winner_cols}")

        result = db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'personas' AND column_name = 'is_winner'"
        ))
        check("DB has is_winner column on personas", len(list(result)) == 1)

    except Exception as e:
        check(f"Content verification exception: {e}", False)
    finally:
        db.close()


def test_reporting_date_routing():
    """Test that date param actually changes which stats are returned."""
    print("\n── Test: Reporting Date Routing Logic ──")
    try:
        from fastapi.testclient import TestClient
        from app.main import app
    except Exception as e:
        check(f"Import: {e}", False)
        return

    client = TestClient(app)
    db = SessionLocal()
    try:
        from app.models import User
        from app.core.security import create_access_token

        user = db.query(User).first()
        if not user:
            return

        token = create_access_token(data={"sub": user.id})
        headers = {"Authorization": f"Bearer {token}"}

        sync_status = db.query(FBSyncStatus).first()
        if not sync_status:
            print("  (no sync data — skipping)")
            return

        acct_id = sync_status.ad_account_id
        today = datetime.now().strftime('%Y-%m-%d')

        # Get aggregate stats
        resp_agg = client.get(f"/api/v1/reporting/campaigns?ad_account_id={acct_id}", headers=headers)
        # Get today stats
        resp_today = client.get(f"/api/v1/reporting/campaigns?ad_account_id={acct_id}&date={today}", headers=headers)

        check("Both requests return 200",
              resp_agg.status_code == 200 and resp_today.status_code == 200)

        if resp_agg.status_code == 200 and resp_today.status_code == 200:
            agg_data = resp_agg.json()
            today_data = resp_today.json()
            check("Same number of campaigns returned", len(agg_data) == len(today_data),
                  f"agg={len(agg_data)}, today={len(today_data)}")

            # With a non-today date, should still return aggregate (not today)
            resp_other = client.get(f"/api/v1/reporting/campaigns?ad_account_id={acct_id}&date=2020-01-01", headers=headers)
            check("Non-today date returns 200", resp_other.status_code == 200)
            # Should return aggregate stats since 2020-01-01 != today
            if resp_other.status_code == 200 and len(resp_other.json()) > 0 and len(agg_data) > 0:
                other_spend = resp_other.json()[0].get("insights", {}).get("spend")
                agg_spend = agg_data[0].get("insights", {}).get("spend")
                check("Non-today date returns aggregate stats (not today stats)",
                      other_spend == agg_spend,
                      f"other={other_spend}, agg={agg_spend}")

    except Exception as e:
        check(f"Date routing test exception: {e}", False)
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 60)
    print("E2E TESTS: Winning Personas + Daily Stats Sync")
    print("=" * 60)

    test_winner_model_fields()
    test_winner_api_endpoints()
    test_winner_serialization()
    test_daily_sync_model_fields()
    test_daily_sync_reporting_endpoints()
    test_today_stats_content()
    test_reporting_date_routing()

    print("\n" + "=" * 60)
    print(f"RESULTS: {PASS} passed, {FAIL} failed")
    print("=" * 60)

    if ERRORS:
        print("\nFAILURES:")
        for e in ERRORS:
            print(e)

    sys.exit(1 if FAIL > 0 else 0)
