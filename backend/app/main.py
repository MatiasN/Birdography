from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

app = FastAPI(title="Birdography")


@app.get("/health")
def health(db: Session = Depends(get_db)):
    postgis = db.scalar(text("SELECT postgis_version()"))
    return {"status": "ok", "postgis": postgis}
