"""cPanel API integration — addon domain management."""
import json
import logging
import ssl
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)


def add_addon_domain(
    cpanel_host: str,
    cpanel_username: str,
    cpanel_token: str,
    domain_name: str,
    base_path: str = "public_html",
) -> dict:
    """Add an addon domain via cPanel API 2."""
    domain_name = domain_name.strip().lower()
    subdomain = domain_name.rsplit(".", 1)[0].replace(".", "-")

    params = urllib.parse.urlencode({
        "cpanel_jsonapi_apiversion": "2",
        "cpanel_jsonapi_module": "AddonDomain",
        "cpanel_jsonapi_func": "addaddondomain",
        "newdomain": domain_name,
        "dir": f"/{base_path}/{domain_name}",
        "subdomain": subdomain,
    })

    url = f"https://{cpanel_host}:2083/json-api/cpanel?{params}"
    headers = {"Authorization": f"cpanel {cpanel_username}:{cpanel_token}"}

    try:
        req = urllib.request.Request(url, headers=headers)
        ctx = ssl.create_default_context()
        resp = urllib.request.urlopen(req, timeout=90, context=ctx)
        result = json.loads(resp.read())

        cpanel_data = result.get("cpanelresult", {}).get("data", [{}])
        if isinstance(cpanel_data, list) and len(cpanel_data) > 0:
            entry = cpanel_data[0]
            if entry.get("result") == 1:
                logger.info("Addon domain %s added to %s", domain_name, cpanel_host)
                return {
                    "success": True,
                    "message": f"Addon domain {domain_name} added successfully",
                    "domain": domain_name,
                    "document_root": f"/{base_path}/{domain_name}",
                }
            else:
                reason = entry.get("reason", "Unknown error")
                return {"success": False, "message": reason}

        errors = result.get("cpanelresult", {}).get("error", "")
        if errors:
            return {"success": False, "message": errors}

        return {"success": False, "message": "Unexpected cPanel response"}

    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error("cPanel API error %d: %s", e.code, body[:500])
        return {"success": False, "message": f"cPanel API error {e.code}: {body[:200]}"}
    except Exception as e:
        logger.exception("cPanel addon domain failed for %s", domain_name)
        return {"success": False, "message": str(e)}


def list_addon_domains(
    cpanel_host: str,
    cpanel_username: str,
    cpanel_token: str,
) -> dict:
    """List addon domains via cPanel API 2."""
    params = urllib.parse.urlencode({
        "cpanel_jsonapi_apiversion": "2",
        "cpanel_jsonapi_module": "AddonDomain",
        "cpanel_jsonapi_func": "listaddondomains",
    })

    url = f"https://{cpanel_host}:2083/json-api/cpanel?{params}"
    headers = {"Authorization": f"cpanel {cpanel_username}:{cpanel_token}"}

    try:
        req = urllib.request.Request(url, headers=headers)
        ctx = ssl.create_default_context()
        resp = urllib.request.urlopen(req, timeout=90, context=ctx)
        result = json.loads(resp.read())

        domains_data = result.get("cpanelresult", {}).get("data", [])
        return {
            "success": True,
            "domains": [
                {"domain": d.get("domain", ""), "dir": d.get("dir", ""), "subdomain": d.get("subdomain", "")}
                for d in domains_data
            ],
        }
    except Exception as e:
        logger.exception("cPanel list domains failed")
        return {"success": False, "message": str(e), "domains": []}
