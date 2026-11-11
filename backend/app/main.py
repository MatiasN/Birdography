import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app import auth, exiftool, locations, photos, species
from app.config import settings
from app.db import DB

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if exiftool.version() is None:
        msg = "ExifTool not found (EXIFTOOL_PATH=%r); uploads get no metadata, RAW no preview"
        log.warning(msg, settings.exiftool_path)
    yield


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
