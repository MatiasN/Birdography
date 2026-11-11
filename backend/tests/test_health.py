import pytest


def test_health_reports_postgis(anon):
    body = anon.get("/health").json()
    assert body["status"] == "ok"
    assert body["postgis"]
    assert "exiftool" in body  # version string, or null when the binary is missing


def test_startup_warns_when_exiftool_is_missing(monkeypatch, tmp_path, caplog):
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    monkeypatch.setattr(settings, "exiftool_path", str(tmp_path / "no-exiftool"))
    with TestClient(app) as started:  # the context manager runs the lifespan
        assert started.get("/health").json()["exiftool"] is None
    assert "ExifTool not found" in caplog.text


@pytest.mark.exiftool
def test_startup_is_quiet_when_exiftool_is_present(caplog):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as started:
        assert started.get("/health").json()["exiftool"]
    assert "ExifTool not found" not in caplog.text


def test_health_reports_upload_limits(anon, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_upload_mb", 12)
    monkeypatch.setattr(settings, "max_raw_upload_mb", 34)
    assert anon.get("/health").json()["limits"] == {"upload_mb": 12, "raw_upload_mb": 34}


def test_startup_fails_when_uploads_are_not_writable(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    blocker = tmp_path / "not-a-directory"
    blocker.write_text("")
    monkeypatch.setattr(settings, "upload_dir", str(blocker))
    with pytest.raises(RuntimeError, match=r"UPLOAD_DIR .*not-a-directory is not writable by uid \d+.*sudo chown -R"):
        with TestClient(app):
            pass
