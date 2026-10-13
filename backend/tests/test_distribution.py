"""Direct APK distribution: stable download link, version endpoint, download page."""
import requests
from conftest import API


def test_app_version_shape():
    v = requests.get(f"{API}/public/app-version").json()
    assert set(v) == {"latest", "min_supported", "apk_available"}


def test_stable_android_link_redirects():
    r = requests.get(f"{API}/public/download/android", allow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://") or loc.endswith("/api/public/download"), "only HTTPS APK or the download page"


def test_download_page_independent_and_both_options():
    html = requests.get(f"{API}/public/download").text
    assert "Download AfikShift on Aptoide" in html
    assert "download-apk" in html, "direct download button or 'coming soon' note"
    assert "not affiliated with" in html and "Independent Shift &amp; Earnings Tracker" in html
