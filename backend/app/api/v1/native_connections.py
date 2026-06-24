from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from app.database import get_db
from app.models import NativeAdConnection, User
from app.core.deps import get_current_active_user

router = APIRouter()

VALID_PLATFORMS = ("taboola", "outbrain", "newsbreak")


def mask_token(token: str) -> str:
    if not token or len(token) < 12:
        return "***"
    return token[:8] + "..." + token[-4:]


def connection_to_dict(conn: NativeAdConnection) -> dict:
    return {
        "id": conn.id,
        "platform": conn.platform,
        "name": conn.name,
        "client_id": conn.client_id,
        "client_secret": mask_token(conn.client_secret) if conn.client_secret else None,
        "api_token": mask_token(conn.api_token) if conn.api_token else None,
        "account_id": conn.account_id,
        "is_default": conn.is_default,
        "is_active": conn.is_active,
        "last_verified": conn.last_verified.isoformat() if conn.last_verified else None,
        "notes": conn.notes,
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
        "updated_at": conn.updated_at.isoformat() if conn.updated_at else None,
    }


@router.get("")
def list_connections(
    platform: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(NativeAdConnection).filter(NativeAdConnection.is_active == True)
    if platform:
        query = query.filter(NativeAdConnection.platform == platform)
    connections = query.order_by(NativeAdConnection.created_at).all()
    return [connection_to_dict(c) for c in connections]


@router.get("/{connection_id}")
def get_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    conn = db.query(NativeAdConnection).filter(
        NativeAdConnection.id == connection_id,
        NativeAdConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return connection_to_dict(conn)


@router.post("")
def create_connection(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    platform = data.get("platform", "").lower()
    if platform not in VALID_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"platform must be one of: {', '.join(VALID_PLATFORMS)}")
    if not data.get("name"):
        raise HTTPException(status_code=400, detail="name is required")

    conn = NativeAdConnection(
        platform=platform,
        name=data["name"],
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        api_token=data.get("api_token"),
        account_id=data.get("account_id"),
        is_default=data.get("is_default", False),
        notes=data.get("notes"),
    )

    if conn.is_default:
        db.query(NativeAdConnection).filter(
            NativeAdConnection.platform == platform,
            NativeAdConnection.is_default == True,
        ).update({"is_default": False})

    db.add(conn)
    db.commit()
    db.refresh(conn)
    return connection_to_dict(conn)


@router.put("/{connection_id}")
def update_connection(
    connection_id: str,
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    conn = db.query(NativeAdConnection).filter(
        NativeAdConnection.id == connection_id,
        NativeAdConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    if "name" in data:
        conn.name = data["name"]
    if "client_id" in data:
        conn.client_id = data["client_id"]
    if "client_secret" in data and data["client_secret"]:
        conn.client_secret = data["client_secret"]
    if "api_token" in data and data["api_token"]:
        conn.api_token = data["api_token"]
    if "account_id" in data:
        conn.account_id = data["account_id"]
    if "notes" in data:
        conn.notes = data["notes"]
    if "is_default" in data:
        if data["is_default"]:
            db.query(NativeAdConnection).filter(
                NativeAdConnection.platform == conn.platform,
                NativeAdConnection.is_default == True,
                NativeAdConnection.id != connection_id,
            ).update({"is_default": False})
        conn.is_default = data["is_default"]

    db.commit()
    db.refresh(conn)
    return connection_to_dict(conn)


@router.delete("/{connection_id}")
def delete_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    conn = db.query(NativeAdConnection).filter(
        NativeAdConnection.id == connection_id,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    conn.is_active = False
    conn.is_default = False
    db.commit()
    return {"message": "Connection deleted"}


@router.post("/{connection_id}/verify")
def verify_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    conn = db.query(NativeAdConnection).filter(
        NativeAdConnection.id == connection_id,
        NativeAdConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Platform-specific verification
    if conn.platform == "taboola":
        from app.services.taboola_service import TaboolaService
        svc = TaboolaService(conn)
        try:
            svc.authenticate()
            conn.last_verified = func.now()
            db.commit()
            return {"verified": True, "platform": "taboola", "account_id": conn.account_id}
        except Exception as e:
            return {"verified": False, "error": str(e)}

    elif conn.platform == "outbrain":
        from app.services.outbrain_service import OutbrainService
        svc = OutbrainService(conn)
        try:
            svc.authenticate()
            conn.last_verified = func.now()
            db.commit()
            return {"verified": True, "platform": "outbrain", "account_id": conn.account_id}
        except Exception as e:
            return {"verified": False, "error": str(e)}

    elif conn.platform == "newsbreak":
        from app.services.newsbreak_service import NewsBreakService
        svc = NewsBreakService(conn)
        try:
            svc.authenticate()
            conn.last_verified = func.now()
            db.commit()
            return {"verified": True, "platform": "newsbreak", "account_id": conn.account_id}
        except Exception as e:
            return {"verified": False, "error": str(e)}

    return {"verified": False, "error": f"Unknown platform: {conn.platform}"}


@router.post("/{connection_id}/set-default")
def set_default_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    conn = db.query(NativeAdConnection).filter(
        NativeAdConnection.id == connection_id,
        NativeAdConnection.is_active == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    db.query(NativeAdConnection).filter(
        NativeAdConnection.platform == conn.platform,
        NativeAdConnection.is_default == True,
    ).update({"is_default": False})

    conn.is_default = True
    db.commit()
    return {"message": f"'{conn.name}' set as default {conn.platform} connection"}
