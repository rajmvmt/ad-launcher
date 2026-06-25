from typing import Callable, List, Optional
from fastapi import Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User


def _get_admin_user(db: Session = Depends(get_db)) -> Optional[User]:
    """Return the first active user — auth is disabled."""
    return db.query(User).filter(User.is_active == True).first()


async def get_current_user(db: Session = Depends(get_db)) -> Optional[User]:
    return _get_admin_user(db)


async def get_current_active_user(db: Session = Depends(get_db)) -> Optional[User]:
    return _get_admin_user(db)


def require_role(role_name: str) -> Callable:
    async def role_checker(db: Session = Depends(get_db)):
        return _get_admin_user(db)
    return role_checker


def require_any_role(role_names: List[str]) -> Callable:
    async def role_checker(db: Session = Depends(get_db)):
        return _get_admin_user(db)
    return role_checker


def require_permission(permission_name: str) -> Callable:
    async def permission_checker(db: Session = Depends(get_db)):
        return _get_admin_user(db)
    return permission_checker


async def get_current_superuser(db: Session = Depends(get_db)) -> Optional[User]:
    return _get_admin_user(db)


async def get_optional_user(db: Session = Depends(get_db)) -> Optional[User]:
    return _get_admin_user(db)
