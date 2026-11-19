from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)


def get_db():
    with Session(engine) as session:
        yield session


DB = Annotated[Session, Depends(get_db)]


def visible(db: Session, model, row_id: int, owner=None):
    """The row with this id, or None when it doesn't exist, is in the trash or (with `owner`) is someone else's."""
    row = db.get(model, row_id)
    if row is None or row.deleted_at is not None or (owner is not None and row.owner_id != owner.id):
        return None
    return row


def visible_or_404(db: Session, model, row_id: int, detail: str, owner=None):
    """`visible`, answering 404 with `detail` instead of None."""
    row = visible(db, model, row_id, owner)
    if row is None:
        raise HTTPException(404, detail)
    return row
