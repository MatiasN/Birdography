import io
import itertools
import os
import shutil
from pathlib import Path

os.environ["POSTGRES_DB"] = os.environ.get("TEST_POSTGRES_DB", "birdography_test")
os.environ.setdefault("SECRET_KEY", "test-secret")

import pillow_heif  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from PIL.TiffImagePlugin import IFDRational  # noqa: E402
from sqlalchemy import create_engine, make_url, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.auth import create_user  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

TABLES = "photo_species, photo_files, photos, locations, species, users"

pillow_heif.register_heif_opener()


def pytest_collection_modifyitems(items):
    """Skip tests marked `exiftool` when the binary is missing; CI installs it, so nothing is skipped there."""
    if shutil.which(settings.exiftool_path):
        return
    skip = pytest.mark.skip(reason=f"ExifTool not found at {settings.exiftool_path!r}")
    for item in items:
        if "exiftool" in item.keywords:
            item.add_marker(skip)


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
    # Migration tests move the schema around; leave it at head even if one of them failed midway.
    command.upgrade(Config("alembic.ini"), "head")
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))


@pytest.fixture
def anon():
    return TestClient(app)


def login(email: str, password: str = "secret") -> TestClient:
    with Session(engine) as db:
        create_user(db, email, password)
    client = TestClient(app)
    client.post("/auth/login", json={"email": email, "password": password}).raise_for_status()
    return client


@pytest.fixture
def client():
    return login("me@example.com")


_counter = itertools.count()


def stored() -> list[str]:
    """Names of every file in the upload directory, relative to it."""
    root = Path(settings.upload_dir)
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def make_jpeg(camera=None, taken_at=None, offset=None, lat=None, lon=None, settings=None, unique=True) -> bytes:
    """A tiny JPEG with the given EXIF. Unique by default, since identical uploads are rejected."""
    exif = Image.Exif()
    if unique:
        exif[0x010E] = f"test image {next(_counter)}"  # ImageDescription
    if camera:
        exif[0x0110] = camera
    ifd = exif.get_ifd(0x8769)
    if taken_at:
        ifd[0x9003] = taken_at
    if offset:
        ifd[0x9011] = offset
    if settings:  # rationals, as cameras write them: exposure "1/500", f-number "28/5"
        ifd[0x8827] = settings["iso"]
        ifd[0x829A] = IFDRational(*settings["exposure"])
        ifd[0x829D] = IFDRational(*settings["fnumber"])
        ifd[0x920A] = IFDRational(*settings["focal_length"])
    if lat is not None and lon is not None:
        gps = exif.get_ifd(0x8825)
        gps[1], gps[2] = ("N" if lat >= 0 else "S"), (abs(lat), 0.0, 0.0)
        gps[3], gps[4] = ("E" if lon >= 0 else "W"), (abs(lon), 0.0, 0.0)
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, "JPEG", exif=exif)
    return buf.getvalue()
