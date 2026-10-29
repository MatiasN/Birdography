from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)


def get_db():
    with Session(engine) as session:
        yield session


DB = Annotated[Session, Depends(get_db)]
