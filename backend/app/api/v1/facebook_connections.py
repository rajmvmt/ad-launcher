from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from app.database import get_db
from app.models import FacebookConnection, User
from app.core.deps import get_current_active_user, require_permission
from app.services.facebook_service import FacebookService

router = APIRouter()


def mask_token(token: str) -> str:
    """Show first 8 chars + ... for security."""
    if not token or len(token) < 12:
        return "***"
    return token[:8] + "..." + token[-4:]


def connection_to_dict(conn: FacebookConnection, include_token: bool = False) -> dict:
    return {
        "id": conn.id,
        "name": conn.name,
        "access_token": conn.access_token if include_token else mask_token(conn.access_token),
        "app_id": conn.app_id,
        "app_secret": mask_token(conn.app_secret) if conn.app_secret else None,
        "ad_account_id": conn.ad_account_id,
        "is_default": conn.is_default,
        "is_active": conn.is_active,
        "last_verified_at": conn.last_verified_at.isoformat() if conn.last_verified_at else None,
        "notes": conn.notes,
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
        "updated_at": conn.updated_at.isoformat() if conn.updated_at else None,
    }


@router.get("")
def list_connections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """List all Facebook connections (tokens masked)."""
    connections = db.query(FacebookConnection).filter(
        FacebookConnection.is_active == True
    ).order_by(FacebookConnection.created_at).all()
    return [connection_to_dict(c) for c in connections]


@router.get("/{connection_id}")
def get_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get a single connection (token masked)."""
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == connection_id,
        FacebookConnection.is_active == True
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return connection_to_dict(conn)


@router.post("")
def create_connection(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Create a new Facebook connection."""
    if not data.get("name") or not data.get("access_token"):
        raise HTTPException(status_code=400, detail="name and access_token are required")

    conn = FacebookConnection(
        name=data["name"],
        access_token=data["access_token"],
        app_id=data.get("app_id"),
        app_secret=data.get("app_secret"),
        ad_account_id=data.get("ad_account_id"),
        is_default=data.get("is_default", False),
        notes=data.get("notes"),
    )

    # If this is set as default, unset others
    if conn.is_default:
        db.query(FacebookConnection).filter(
            FacebookConnection.is_default == True
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
    current_user: User = Depends(get_current_active_user)
):
    """Update a connection. Omit access_token to keep existing."""
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == connection_id,
        FacebookConnection.is_active == True
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    if "name" in data:
        conn.name = data["name"]
    if "access_token" in data and data["access_token"]:
        conn.access_token = data["access_token"]
    if "app_id" in data:
        conn.app_id = data["app_id"]
    if "app_secret" in data and data["app_secret"]:
        conn.app_secret = data["app_secret"]
    if "ad_account_id" in data:
        conn.ad_account_id = data["ad_account_id"]
    if "notes" in data:
        conn.notes = data["notes"]
    if "is_default" in data:
        if data["is_default"]:
            db.query(FacebookConnection).filter(
                FacebookConnection.is_default == True,
                FacebookConnection.id != connection_id
            ).update({"is_default": False})
        conn.is_default = data["is_default"]

    db.commit()
    db.refresh(conn)
    return connection_to_dict(conn)


@router.delete("/{connection_id}")
def delete_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Soft-delete a connection."""
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == connection_id
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
    current_user: User = Depends(get_current_active_user)
):
    """Run diagnostics on a connection and update last_verified_at."""
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == connection_id,
        FacebookConnection.is_active == True
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    service = FacebookService(connection=conn)
    try:
        service.initialize()
    except Exception as e:
        return {"verified": False, "error": str(e)}

    try:
        diag = service.diagnose_permissions()
    except Exception as e:
        return {"verified": False, "error": f"Diagnostics failed: {str(e)}"}

    token_debug = diag.get("token_debug", {})
    token_valid = token_debug.get("is_valid", False)
    identity = diag.get("identity", {})
    pages = diag.get("pages", [])
    permissions = diag.get("permissions", [])

    # For system user tokens, debug_token often fails but the token still works.
    # If we got permissions back, the token is functional.
    if not token_valid and isinstance(permissions, list) and len(permissions) > 0:
        token_valid = True

    conn.last_verified_at = func.now()
    db.commit()

    result = {
        "verified": token_valid,
        "identity": identity,
        "pages": pages if isinstance(pages, list) else [],
        "scopes_count": len(permissions) if isinstance(permissions, list) else 0,
    }

    if not token_valid:
        # Build a meaningful error message
        if "error" in token_debug and "error" not in str(token_debug.get("error", "")):
            result["error"] = f"Token error: {token_debug['error']}"
        elif "error" in identity:
            result["error"] = f"Identity check failed: {identity['error']}"
        else:
            result["error"] = "Access token is invalid or expired. Please update your token in the connection settings."

    return result


@router.post("/{connection_id}/set-default")
def set_default_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Set a connection as the default (unsets all others)."""
    conn = db.query(FacebookConnection).filter(
        FacebookConnection.id == connection_id,
        FacebookConnection.is_active == True
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    db.query(FacebookConnection).filter(
        FacebookConnection.is_default == True
    ).update({"is_default": False})

    conn.is_default = True
    db.commit()
    return {"message": f"'{conn.name}' set as default connection"}
