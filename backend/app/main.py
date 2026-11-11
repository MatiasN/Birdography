import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app import auth, exiftool, locations, photos, species
from app.config import settings
from app.db import DB

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    check_upload_dir()
    if exiftool.version() is None:
        msg = "ExifTool not found (EXIFTOOL_PATH=%r); uploads get no metadata, RAW no preview"
        log.warning(msg, settings.exiftool_path)
    yield


def check_upload_dir() -> None:
    """Fail at startup, not on the first upload, when the photo directory can't be written (owned by root after
    an upgrade from an image that ran as root)."""
    root = Path(settings.upload_dir)
    try:
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=root):
            pass
    except OSError as err:
        uid, gid = os.getuid(), os.getgid()
        raise RuntimeError(
            f"UPLOAD_DIR {root} is not writable by uid {uid} ({err.strerror}); on the host, run "
            f"`sudo chown -R {uid}:{gid}` on the directory mounted there"
        ) from None


app = FastAPI(title="Birdography", lifespan=lifespan)
app.include_router(auth.router)
for module in (photos, species, locations):
    app.include_router(module.router, dependencies=[Depends(auth.get_current_user)])


@app.get("/health")
def health(db: DB):
    postgis = db.scalar(text("SELECT postgis_version()"))
    return {
        "status": "ok",
        "postgis": postgis,
        "exiftool": exiftool.version(),
        "limits": {"upload_mb": settings.max_upload_mb, "raw_upload_mb": settings.max_raw_upload_mb},
    }
