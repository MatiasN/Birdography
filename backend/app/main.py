from fastapi import FastAPI
from sqlalchemy import text

from app import locations, photos, species
from app.db import DB

app = FastAPI(title="Birdography")
app.include_router(photos.router)
app.include_router(species.router)
app.include_router(locations.router)


@app.get("/health")
def health(db: DB):
    postgis = db.scalar(text("SELECT postgis_version()"))
    return {"status": "ok", "postgis": postgis}
