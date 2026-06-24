"""
Domain Service — Namecheap domain registration + Cloudflare DNS management.
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class DomainService:
    """Handles domain registration (Namecheap) and DNS setup (Cloudflare)."""

    def __init__(self):
        self._nc_api = None
        self._cf_client = None

    # ── Namecheap ──────────────────────────────────────────

    def _get_namecheap(self):
        if self._nc_api is None:
            from namecheap import Api
            self._nc_api = Api(
                ApiUser=os.environ.get("NAMECHEAP_API_USER", ""),
                ApiKey=os.environ.get("NAMECHEAP_API_KEY", ""),
                UserName=os.environ.get("NAMECHEAP_API_USER", ""),
                ClientIP=os.environ.get("NAMECHEAP_CLIENT_IP", "127.0.0.1"),
                sandbox=os.environ.get("NAMECHEAP_SANDBOX", "true").lower() == "true",
                debug=False,
            )
        return self._nc_api

    def check_availability(self, domain_name: str) -> dict:
        """Check if a domain is available for registration.
        Returns: { domain, available: bool, premium: bool }
        """
        nc = self._get_namecheap()
        result = nc.domains_check([domain_name])
        available = result.get(domain_name, False)
        return {
            "domain": domain_name,
            "available": available,
        }

    def register_domain(
        self,
        domain_name: str,
        first_name: str = "Domain",
        last_name: str = "Admin",
        address: str = "123 Main St",
        city: str = "Miami",
        state: str = "FL",
        postal_code: str = "33101",
        country: str = "US",
        phone: str = "+1.5551234567",
        email: str = "roly@digitalmvmt.com",
        years: int = 1,
    ) -> dict:
        """Register a domain on Namecheap.
        Returns: { domain, success: bool, order_id, message }
        """
        nc = self._get_namecheap()
        try:
            result = nc.domains_create(
                DomainName=domain_name,
                FirstName=first_name,
                LastName=last_name,
                Address1=address,
                City=city,
                StateProvince=state,
                PostalCode=postal_code,
                Country=country,
                Phone=phone,
                EmailAddress=email,
                years=years,
            )
            logger.info(f"Domain registered: {domain_name}, result: {result}")
            return {
                "domain": domain_name,
                "success": True,
                "result": result,
            }
        except Exception as e:
            logger.error(f"Domain registration failed for {domain_name}: {e}")
            return {
                "domain": domain_name,
                "success": False,
                "message": str(e),
            }

    def set_nameservers(self, domain_name: str, nameservers: list[str]) -> dict:
        """Set custom nameservers on Namecheap (e.g. Cloudflare NS)."""
        nc = self._get_namecheap()
        try:
            ns_str = ",".join(nameservers)
            nc.domains_dns_setCustom(domain_name, {"Nameservers": ns_str})
            logger.info(f"Nameservers set for {domain_name}: {ns_str}")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to set NS for {domain_name}: {e}")
            return {"success": False, "message": str(e)}

    # ── Cloudflare ─────────────────────────────────────────

    def _get_cloudflare(self):
        if self._cf_client is None:
            from cloudflare import Cloudflare
            token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
            self._cf_client = Cloudflare(api_token=token)
        return self._cf_client

    def add_zone(self, domain_name: str) -> dict:
        """Add a domain as a zone in Cloudflare.
        Returns: { zone_id, nameservers, status }
        """
        cf = self._get_cloudflare()
        try:
            # Get account ID first
            accounts = cf.accounts.list()
            account_id = accounts.result[0].id if accounts.result else None
            if not account_id:
                return {"success": False, "message": "No Cloudflare account found"}

            zone = cf.zones.create(
                name=domain_name,
                account={"id": account_id},
                type="full",
            )
            nameservers = zone.name_servers or []
            logger.info(f"CF zone created for {domain_name}: {zone.id}, NS: {nameservers}")
            return {
                "success": True,
                "zone_id": zone.id,
                "nameservers": nameservers,
                "status": zone.status,
            }
        except Exception as e:
            error_msg = str(e)
            # Zone might already exist
            if "already exists" in error_msg.lower():
                return self._get_existing_zone(domain_name)
            logger.error(f"Failed to create CF zone for {domain_name}: {e}")
            return {"success": False, "message": error_msg}

    def _get_existing_zone(self, domain_name: str) -> dict:
        """Look up an existing zone by name."""
        cf = self._get_cloudflare()
        try:
            zones = cf.zones.list(name=domain_name)
            if zones.result:
                z = zones.result[0]
                return {
                    "success": True,
                    "zone_id": z.id,
                    "nameservers": z.name_servers or [],
                    "status": z.status,
                }
            return {"success": False, "message": "Zone not found"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def create_dns_record(
        self,
        zone_id: str,
        record_type: str,
        name: str,
        content: str,
        proxied: bool = True,
        ttl: int = 1,
    ) -> dict:
        """Create a DNS record in Cloudflare.
        Returns: { success, cf_record_id }
        """
        cf = self._get_cloudflare()
        # TXT, MX, SRV records cannot be proxied through Cloudflare
        if record_type.upper() in ("TXT", "MX", "SRV", "NS"):
            proxied = False
        try:
            record = cf.dns.records.create(
                zone_id=zone_id,
                type=record_type,
                name=name,
                content=content,
                proxied=proxied,
                ttl=ttl,
            )
            logger.info(f"DNS record created: {record_type} {name} -> {content} (id: {record.id})")
            return {"success": True, "cf_record_id": record.id}
        except Exception as e:
            logger.error(f"Failed to create DNS record: {e}")
            return {"success": False, "message": str(e)}

    def delete_dns_record(self, zone_id: str, cf_record_id: str) -> dict:
        """Delete a DNS record from Cloudflare."""
        cf = self._get_cloudflare()
        try:
            cf.dns.records.delete(cf_record_id, zone_id=zone_id)
            logger.info(f"DNS record deleted: {cf_record_id}")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to delete DNS record {cf_record_id}: {e}")
            return {"success": False, "message": str(e)}

    def list_zone_records(self, zone_id: str) -> list[dict]:
        """List all DNS records for a zone."""
        cf = self._get_cloudflare()
        try:
            records = cf.dns.records.list(zone_id=zone_id)
            return [
                {
                    "id": r.id,
                    "type": r.type,
                    "name": r.name,
                    "content": r.content,
                    "proxied": r.proxied,
                    "ttl": r.ttl,
                }
                for r in records.result
            ]
        except Exception as e:
            logger.error(f"Failed to list DNS records for zone {zone_id}: {e}")
            return []

    # ── Auto-Setup Orchestrator ────────────────────────────

    def full_setup(self, domain_name: str) -> dict:
        """Full domain setup: CF zone → set NS on Namecheap.
        Call AFTER registration. Returns step-by-step results.
        """
        steps = {}

        # Step 1: Add zone to Cloudflare
        zone_result = self.add_zone(domain_name)
        steps["cloudflare_zone"] = zone_result
        logger.info(f"[full_setup] CF zone result for {domain_name}: {zone_result}")
        if not zone_result.get("success"):
            logger.error(f"[full_setup] CF zone FAILED for {domain_name}: {zone_result}")
            return {"success": False, "steps": steps, "failed_at": "cloudflare_zone"}

        zone_id = zone_result["zone_id"]
        nameservers = zone_result["nameservers"]

        # Step 2: Set Namecheap nameservers to Cloudflare
        ns_result = self.set_nameservers(domain_name, nameservers)
        steps["set_nameservers"] = ns_result
        logger.info(f"[full_setup] NS result for {domain_name}: {ns_result}")
        if not ns_result.get("success"):
            logger.error(f"[full_setup] NS FAILED for {domain_name}: {ns_result}")
            return {"success": False, "steps": steps, "failed_at": "set_nameservers"}

        return {
            "success": True,
            "steps": steps,
            "zone_id": zone_id,
            "nameservers": nameservers,
        }
