"""Tests for file upload functionality including video support."""
import pytest
from io import BytesIO
from unittest.mock import patch, MagicMock

# Valid magic byte headers for each file type
JPEG_HEADER = b'\xff\xd8\xff\xe0' + b'\x00' * 20
PNG_HEADER = b'\x89PNG\r\n\x1a\n' + b'\x00' * 20
GIF_HEADER = b'GIF89a' + b'\x00' * 20
WEBP_HEADER = b'RIFF' + b'\x00' * 4 + b'WEBP' + b'\x00' * 16
MP4_HEADER = b'\x00\x00\x00\x1c' + b'ftypisom' + b'\x00' * 16
MOV_HEADER = b'\x00\x00\x00\x14' + b'ftypqt  ' + b'\x00' * 16
AVI_HEADER = b'RIFF' + b'\x00' * 4 + b'AVI ' + b'\x00' * 16
WEBM_HEADER = b'\x1a\x45\xdf\xa3' + b'\x00' * 20


class TestFileUploads:
    """Tests for /api/v1/uploads endpoint."""

    def test_upload_image_success(self, client, auth_headers):
        """Test successful image upload."""
        files = {"file": ("test.jpg", BytesIO(JPEG_HEADER), "image/jpeg")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False

            response = client.post(
                "/api/v1/uploads/",
                files=files,
                headers=auth_headers
            )

        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert data["media_type"] == "image"
        assert data["url"].endswith(".jpg")

    def test_upload_video_mp4_success(self, client, auth_headers):
        """Test successful MP4 video upload."""
        files = {"file": ("test.mp4", BytesIO(MP4_HEADER), "video/mp4")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False

            response = client.post(
                "/api/v1/uploads/",
                files=files,
                headers=auth_headers
            )

        assert response.status_code == 200
        data = response.json()
        assert data["media_type"] == "video"
        assert data["url"].endswith(".mp4")

    def test_upload_video_mov_success(self, client, auth_headers):
        """Test successful MOV video upload."""
        files = {"file": ("test.mov", BytesIO(MOV_HEADER), "video/quicktime")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False

            response = client.post(
                "/api/v1/uploads/",
                files=files,
                headers=auth_headers
            )

        assert response.status_code == 200
        data = response.json()
        assert data["media_type"] == "video"

    def test_upload_invalid_extension(self, client, auth_headers):
        """Test upload with invalid file extension."""
        file_content = b"some content"
        files = {"file": ("test.exe", BytesIO(file_content), "application/octet-stream")}

        response = client.post(
            "/api/v1/uploads/",
            files=files,
            headers=auth_headers
        )

        assert response.status_code == 400
        assert "Invalid file type" in response.json()["detail"]

    def test_upload_image_too_large(self, client, auth_headers):
        """Test image upload exceeding size limit."""
        # Create content larger than 10MB with valid JPEG header
        large_content = JPEG_HEADER + b"x" * (11 * 1024 * 1024)
        files = {"file": ("large.jpg", BytesIO(large_content), "image/jpeg")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False

            response = client.post(
                "/api/v1/uploads/",
                files=files,
                headers=auth_headers
            )

        assert response.status_code == 400
        assert "too large" in response.json()["detail"].lower()

    def test_upload_video_size_limit_different_from_image(self, client, auth_headers):
        """Test that video has different size limit than image."""
        # Create content larger than 10MB but less than 500MB
        # This should fail for images but pass for videos
        content_15mb_jpeg = JPEG_HEADER + b"x" * (15 * 1024 * 1024)
        content_15mb_mp4 = MP4_HEADER + b"x" * (15 * 1024 * 1024)

        # Test as image - should fail
        image_files = {"file": ("large.jpg", BytesIO(content_15mb_jpeg), "image/jpeg")}
        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False
            response = client.post(
                "/api/v1/uploads/",
                files=image_files,
                headers=auth_headers
            )
        assert response.status_code == 400

        # Test as video - should succeed
        video_files = {"file": ("large.mp4", BytesIO(content_15mb_mp4), "video/mp4")}
        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False
            response = client.post(
                "/api/v1/uploads/",
                files=video_files,
                headers=auth_headers
            )
        assert response.status_code == 200

    def test_upload_to_r2_when_enabled(self, client, auth_headers):
        """Test upload goes to R2 when configured."""
        files = {"file": ("test.png", BytesIO(PNG_HEADER), "image/png")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = True
            mock_settings.R2_PUBLIC_URL = "https://r2.example.com"

            with patch('app.api.v1.uploads.upload_to_r2') as mock_r2:
                mock_r2.return_value = "https://r2.example.com/uuid.png"

                response = client.post(
                    "/api/v1/uploads/",
                    files=files,
                    headers=auth_headers
                )

        assert response.status_code == 200
        assert "r2.example.com" in response.json()["url"]

    def test_upload_video_webm(self, client, auth_headers):
        """Test WebM video upload."""
        files = {"file": ("test.webm", BytesIO(WEBM_HEADER), "video/webm")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False

            response = client.post(
                "/api/v1/uploads/",
                files=files,
                headers=auth_headers
            )

        assert response.status_code == 200
        assert response.json()["media_type"] == "video"

    def test_upload_all_image_types(self, client, auth_headers):
        """Test all supported image types."""
        image_types = [
            ("test.jpg", "image/jpeg", JPEG_HEADER),
            ("test.jpeg", "image/jpeg", JPEG_HEADER),
            ("test.png", "image/png", PNG_HEADER),
            ("test.gif", "image/gif", GIF_HEADER),
            ("test.webp", "image/webp", WEBP_HEADER),
        ]

        for filename, content_type, header in image_types:
            files = {"file": (filename, BytesIO(header), content_type)}

            with patch('app.api.v1.uploads.settings') as mock_settings:
                mock_settings.r2_enabled = False

                response = client.post(
                    "/api/v1/uploads/",
                    files=files,
                    headers=auth_headers
                )

            assert response.status_code == 200, f"Failed for {filename}"
            assert response.json()["media_type"] == "image"

    def test_upload_all_video_types(self, client, auth_headers):
        """Test all supported video types."""
        video_types = [
            ("test.mp4", "video/mp4", MP4_HEADER),
            ("test.mov", "video/quicktime", MOV_HEADER),
            ("test.avi", "video/x-msvideo", AVI_HEADER),
            ("test.webm", "video/webm", WEBM_HEADER),
        ]

        for filename, content_type, header in video_types:
            files = {"file": (filename, BytesIO(header), content_type)}

            with patch('app.api.v1.uploads.settings') as mock_settings:
                mock_settings.r2_enabled = False

                response = client.post(
                    "/api/v1/uploads/",
                    files=files,
                    headers=auth_headers
                )

            assert response.status_code == 200, f"Failed for {filename}"
            assert response.json()["media_type"] == "video"

    def test_upload_magic_byte_mismatch(self, client, auth_headers):
        """Test that files with wrong magic bytes are rejected."""
        # PNG header but .jpg extension
        files = {"file": ("test.jpg", BytesIO(PNG_HEADER), "image/jpeg")}

        with patch('app.api.v1.uploads.settings') as mock_settings:
            mock_settings.r2_enabled = False

            response = client.post(
                "/api/v1/uploads/",
                files=files,
                headers=auth_headers
            )

        assert response.status_code == 400
        assert "does not match" in response.json()["detail"].lower()
