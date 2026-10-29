import io
import os

os.environ["POSTGRES_DB"] = os.environ.get("TEST_POSTGRES_DB", "birdography_test")

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import create_engine, make_url, text  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    admin_url = make_url(settings.database_url).set(database="postgres")
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": settings.postgres_db})
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{settings.postgres_db}"'))
    admin.dispose()
    command.upgrade(Config("alembic.ini"), "head")


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE photos, locations, species RESTART IDENTITY CASCADE"))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    return TestClient(app)


def make_jpeg(camera=None, taken_at=None, lat=None, lon=None) -> bytes:
    exif = Image.Exif()
    if camera:
        exif[0x0110] = camera
    if taken_at:
        exif.get_ifd(0x8769)[0x9003] = taken_at
    if lat is not None and lon is not None:
        gps = exif.get_ifd(0x8825)
        gps[1], gps[2] = ("N" if lat >= 0 else "S"), (abs(lat), 0.0, 0.0)
        gps[3], gps[4] = ("E" if lon >= 0 else "W"), (abs(lon), 0.0, 0.0)
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, "JPEG", exif=exif)
    return buf.getvalue()
