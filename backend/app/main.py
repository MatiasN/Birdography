from fastapi import Depends, FastAPI
from sqlalchemy import text

from app import auth, locations, photos, species
from app.db import DB

app = FastAPI(title="Birdography")
app.include_router(auth.router)
for module in (photos, species, locations):
    app.include_router(module.router, dependencies=[Depends(auth.get_current_user)])


@app.get("/health")
def health(db: DB):
    postgis = db.scalar(text("SELECT postgis_version()"))
    return {"status": "ok", "postgis": postgis}
