import ftplib
import io
import logging
import zipfile
from pathlib import PurePosixPath

import paramiko

logger = logging.getLogger(__name__)


class FTPDeployService:
    """Uploads safe page files to Namecheap shared hosting via FTP or SFTP."""

    def deploy(
        self,
        ftp_host: str,
        ftp_port: int,
        ftp_username: str,
        ftp_password: str,
        ftp_protocol: str,
        remote_base_path: str,
        domain_name: str,
        primary_domain: str,
        files: dict[str, bytes],
    ) -> dict:
        """Upload files to the remote host via FTP or SFTP.

        If domain_name matches primary_domain, files go to remote_base_path/.
        Otherwise, files go to remote_base_path/domain_name/.
        """
        if domain_name == primary_domain:
            remote_path = remote_base_path.rstrip("/")
        else:
            remote_path = f"{remote_base_path.rstrip('/')}/{domain_name}"

        logger.info(
            "Deploying %d files to %s:%d %s (path: %s)",
            len(files),
            ftp_host,
            ftp_port,
            ftp_protocol.upper(),
            remote_path,
        )

        if ftp_protocol.lower() == "sftp":
            self._deploy_sftp(
                ftp_host, ftp_port, ftp_username, ftp_password, remote_path, files
            )
        else:
            self._deploy_ftp(
                ftp_host, ftp_port, ftp_username, ftp_password, remote_path, files
            )

        return {
            "success": True,
            "files_uploaded": len(files),
            "remote_path": remote_path,
        }

    def test_connection(
        self,
        ftp_host: str,
        ftp_port: int,
        ftp_username: str,
        ftp_password: str,
        ftp_protocol: str,
    ) -> dict:
        """Test connectivity by listing the root directory."""
        if ftp_protocol.lower() == "sftp":
            return self._test_sftp(ftp_host, ftp_port, ftp_username, ftp_password)
        else:
            return self._test_ftp(ftp_host, ftp_port, ftp_username, ftp_password)

    def extract_files_from_zip(self, zip_bytes: bytes) -> dict[str, bytes]:
        """Extract a ZIP archive into a filename -> bytes mapping.

        If every entry shares a common top-level directory, that prefix is
        stripped so the files are flattened one level.
        """
        result: dict[str, bytes] = {}
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            if not names:
                return result

            # Detect common top-level folder
            parts_list = [PurePosixPath(n).parts for n in names]
            first_dir = parts_list[0][0] if len(parts_list[0]) > 1 else None
            has_common_root = (
                first_dir is not None
                and all(len(p) > 1 and p[0] == first_dir for p in parts_list)
            )

            for name in names:
                data = zf.read(name)
                if has_common_root:
                    # Strip the common top-level directory
                    stripped = str(PurePosixPath(*PurePosixPath(name).parts[1:]))
                else:
                    stripped = name
                result[stripped] = data

        return result

    # ------------------------------------------------------------------
    # FTP helpers
    # ------------------------------------------------------------------

    def _deploy_ftp(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        remote_path: str,
        files: dict[str, bytes],
    ) -> None:
        ftp = ftplib.FTP()
        try:
            ftp.connect(host, port, timeout=30)
            ftp.login(username, password)
            logger.info("FTP connected to %s:%d", host, port)

            self._ftp_mkdirs(ftp, remote_path)

            for filename, data in files.items():
                full_remote = f"{remote_path}/{filename}"
                # Ensure subdirectories exist
                parent = str(PurePosixPath(full_remote).parent)
                self._ftp_mkdirs(ftp, parent)

                ftp.storbinary(f"STOR {full_remote}", io.BytesIO(data))
                logger.info("FTP uploaded: %s", full_remote)
        except ftplib.all_errors as exc:
            raise ConnectionError(f"FTP error: {exc}") from exc
        finally:
            try:
                ftp.quit()
            except Exception:
                ftp.close()

    def _ftp_mkdirs(self, ftp: ftplib.FTP, path: str) -> None:
        """Recursively create directories on the FTP server."""
        parts = PurePosixPath(path).parts
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else part
            # Leading slash handling
            if current == "/":
                continue
            try:
                ftp.mkd(current)
            except ftplib.error_perm:
                # Directory likely already exists
                pass

    def _test_ftp(
        self, host: str, port: int, username: str, password: str
    ) -> dict:
        ftp = ftplib.FTP()
        try:
            ftp.connect(host, port, timeout=15)
            ftp.login(username, password)
            ftp.nlst()
            return {"success": True, "message": "Connected successfully"}
        except ftplib.all_errors as exc:
            return {"success": False, "message": f"FTP connection failed: {exc}"}
        finally:
            try:
                ftp.quit()
            except Exception:
                ftp.close()

    # ------------------------------------------------------------------
    # SFTP helpers
    # ------------------------------------------------------------------

    def _deploy_sftp(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        remote_path: str,
        files: dict[str, bytes],
    ) -> None:
        transport = None
        sftp = None
        try:
            transport = paramiko.Transport((host, port))
            transport.connect(username=username, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            logger.info("SFTP connected to %s:%d", host, port)

            self._sftp_mkdirs(sftp, remote_path)

            for filename, data in files.items():
                full_remote = f"{remote_path}/{filename}"
                parent = str(PurePosixPath(full_remote).parent)
                self._sftp_mkdirs(sftp, parent)

                with sftp.open(full_remote, "wb") as remote_file:
                    remote_file.write(data)
                logger.info("SFTP uploaded: %s", full_remote)
        except Exception as exc:
            raise ConnectionError(f"SFTP error: {exc}") from exc
        finally:
            if sftp:
                sftp.close()
            if transport:
                transport.close()

    def _sftp_mkdirs(self, sftp: paramiko.SFTPClient, path: str) -> None:
        """Recursively create directories on the SFTP server."""
        parts = PurePosixPath(path).parts
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else part
            if current == "/":
                continue
            try:
                sftp.mkdir(current)
            except IOError:
                # Directory likely already exists
                pass

    def _test_sftp(
        self, host: str, port: int, username: str, password: str
    ) -> dict:
        transport = None
        sftp = None
        try:
            transport = paramiko.Transport((host, port))
            transport.connect(username=username, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            sftp.listdir(".")
            return {"success": True, "message": "Connected successfully"}
        except Exception as exc:
            return {"success": False, "message": f"SFTP connection failed: {exc}"}
        finally:
            if sftp:
                sftp.close()
            if transport:
                transport.close()
