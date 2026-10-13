"""Tests for the Aptoide distribution + download endpoints (iteration 13 review)."""
import os
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://dutyconnect-beta.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")


class TestAppVersion:
    def test_app_version_shape_and_values(self):
        r = requests.get(f"{BASE_URL}/api/public/app-version", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) == {"latest", "min_supported", "apk_available"}
        assert data["latest"] == "1.0.0"
        assert data["min_supported"] == "1.0.0"
        assert data["apk_available"] is False


class TestDownloadAndroid:
    def test_download_android_redirects_to_download_page_when_apk_empty(self):
        r = requests.get(f"{BASE_URL}/api/public/download/android", allow_redirects=False, timeout=15)
        assert r.status_code == 302, r.text
        loc = r.headers.get("location", "")
        # Redirect target is "/api/public/download" (relative) per code.
        assert loc.endswith("/api/public/download") or loc == "/api/public/download", loc


class TestDownloadPage:
    def test_download_page_renders_aptoide_and_direct_soon(self):
        r = requests.get(f"{BASE_URL}/api/public/download", timeout=15)
        assert r.status_code == 200, r.text
        html = r.text
        # Required marketing + CTA text
        assert "Download AfikShift on Aptoide" in html
        assert "Direct Android download coming soon" in html
        assert 'data-testid="download-aptoide"' in html
        assert 'data-testid="download-apk-soon"' in html
        # The direct APK link must NOT appear when apk_available is False
        assert 'data-testid="download-apk"' not in html
        # Pricing + plans
        assert "£3.99" in html
        assert "£19.99" in html
        # Independence disclaimer in footer
        assert "not affiliated with" in html
