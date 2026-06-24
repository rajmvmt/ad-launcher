"""Hosting Accounts — manage FTP/SFTP credentials for safe page deployment."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from app.database import get_db
from app.models import HostingAccount, Domain, User
from app.core.deps import get_current_active_user
from app.core.encryption import encrypt_value, decrypt_value
from app.services.ftp_deploy_service import FTPDeployService
from app.services.cpanel_service import add_addon_domain as cpanel_add_addon, list_addon_domains as cpanel_list_addons

logger = logging.getLogger(__name__)
router = APIRouter()


class HostingAccountCreate(BaseModel):
    name: str
    ftp_host: str
    ftp_port: int = 21
    ftp_username: str
    ftp_password: str
    ftp_protocol: str = "ftp"
    primary_domain: Optional[str] = None
    base_path: str = "public_html"
    cpanel_host: Optional[str] = None
    cpanel_username: Optional[str] = None
    cpanel_api_token: Optional[str] = None


class HostingAccountUpdate(BaseModel):
    name: Optional[str] = None
    ftp_host: Optional[str] = None
    ftp_port: Optional[int] = None
    ftp_username: Optional[str] = None
    ftp_password: Optional[str] = None  # "********" or empty = keep existing
    ftp_protocol: Optional[str] = None
    primary_domain: Optional[str] = None
    base_path: Optional[str] = None
    cpanel_host: Optional[str] = None
    cpanel_username: Optional[str] = None
    cpanel_api_token: Optional[str] = None


class AddAddonDomainRequest(BaseModel):
    domain_name: str


def _serialize(account: HostingAccount) -> dict:
    return {
        "id": account.id,
        "name": account.name,
        "ftp_host": account.ftp_host,
        "ftp_port": account.ftp_port,
        "ftp_username": account.ftp_username,
        "ftp_password": "********",
        "ftp_protocol": account.ftp_protocol,
        "primary_domain": account.primary_domain,
        "base_path": account.base_path,
        "cpanel_host": account.cpanel_host,
        "cpanel_username": account.cpanel_username,
        "cpanel_configured": bool(account.cpanel_host and account.cpanel_username and account.cpanel_api_token),
        "domain_count": len(account.domains) if account.domains else 0,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


@router.get("/")
def list_hosting_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    accounts = db.query(HostingAccount).order_by(HostingAccount.created_at.desc()).all()
    return [_serialize(a) for a in accounts]


@router.get("/{account_id}")
def get_hosting_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    account = db.query(HostingAccount).filter(HostingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Hosting account not found")
    result = _serialize(account)
    result["domains"] = [{"id": d.id, "name": d.name} for d in account.domains]
    return result


@router.post("/")
def create_hosting_account(
    data: HostingAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    account = HostingAccount(
        name=data.name,
        ftp_host=data.ftp_host,
        ftp_port=data.ftp_port,
        ftp_username=data.ftp_username,
        ftp_password_encrypted=encrypt_value(data.ftp_password),
        ftp_protocol=data.ftp_protocol,
        primary_domain=data.primary_domain,
        base_path=data.base_path,
        cpanel_host=data.cpanel_host,
        cpanel_username=data.cpanel_username,
        cpanel_api_token=encrypt_value(data.cpanel_api_token) if data.cpanel_api_token else None,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _serialize(account)


@router.put("/{account_id}")
def update_hosting_account(
    account_id: str,
    data: HostingAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    account = db.query(HostingAccount).filter(HostingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Hosting account not found")

    for field in ("name", "ftp_host", "ftp_port", "ftp_username", "ftp_protocol", "primary_domain", "base_path", "cpanel_host", "cpanel_username"):
        value = getattr(data, field, None)
        if value is not None:
            setattr(account, field, value)

    # Only update password if a real value is provided
    if data.ftp_password and data.ftp_password != "********":
        account.ftp_password_encrypted = encrypt_value(data.ftp_password)

    # Only update cPanel token if a real value is provided
    if data.cpanel_api_token and data.cpanel_api_token != "********":
        account.cpanel_api_token = encrypt_value(data.cpanel_api_token)

    db.commit()
    db.refresh(account)
    return _serialize(account)


@router.delete("/{account_id}")
def delete_hosting_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    account = db.query(HostingAccount).filter(HostingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Hosting account not found")
    db.delete(account)
    db.commit()
    return {"message": "Hosting account deleted"}


@router.post("/{account_id}/test")
def test_hosting_connection(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    account = db.query(HostingAccount).filter(HostingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Hosting account not found")

    password = decrypt_value(account.ftp_password_encrypted)
    service = FTPDeployService()
    result = service.test_connection(
        ftp_host=account.ftp_host,
        ftp_port=account.ftp_port,
        ftp_username=account.ftp_username,
        ftp_password=password,
        ftp_protocol=account.ftp_protocol,
    )
    return result


@router.post("/{account_id}/add-addon-domain")
def add_addon_domain(
    account_id: str,
    data: AddAddonDomainRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Add an addon domain to the hosting account via cPanel API."""
    account = db.query(HostingAccount).filter(HostingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Hosting account not found")
    if not account.cpanel_host or not account.cpanel_username or not account.cpanel_api_token:
        raise HTTPException(status_code=400, detail="cPanel not configured for this hosting account")

    token = decrypt_value(account.cpanel_api_token)
    result = cpanel_add_addon(
        cpanel_host=account.cpanel_host,
        cpanel_username=account.cpanel_username,
        cpanel_token=token,
        domain_name=data.domain_name,
        base_path=account.base_path,
    )
    return result


@router.get("/{account_id}/list-addon-domains")
def list_addon_domains(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all addon domains on this hosting account via cPanel API."""
    account = db.query(HostingAccount).filter(HostingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Hosting account not found")
    if not account.cpanel_host or not account.cpanel_username or not account.cpanel_api_token:
        raise HTTPException(status_code=400, detail="cPanel not configured")

    token = decrypt_value(account.cpanel_api_token)
    return cpanel_list_addons(
        cpanel_host=account.cpanel_host,
        cpanel_username=account.cpanel_username,
        cpanel_token=token,
    )
