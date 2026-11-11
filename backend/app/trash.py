"""Soft delete with a retention period, and the purge that empties the trash."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app import storage
from app.config import settings
from app.models import Location, Photo, Species, User

RESTORABLE = {"photo": Photo, "location": Location, "species": Species, "user": User}


def purge(db: Session, retention: timedelta | None = None, now: datetime | None = None) -> dict[str, int]:
    """Hard-delete rows that have been in the trash longer than the retention, and their files."""
    now = now or datetime.now(UTC)
    cutoff = now - (retention if retention is not None else timedelta(days=settings.trash_days))

    purged_users = select(User.id).where(User.deleted_at < cutoff)
    photos = db.scalars(select(Photo).where(or_(Photo.deleted_at < cutoff, Photo.owner_id.in_(purged_users)))).all()
    for photo in photos:
        for file in photo.files:
            storage.remove(file.path)
        db.delete(photo)
    db.flush()

    counts = {"photos": len(photos)}
    # A purged account takes its locations along; delete them explicitly so they are counted.
    locations = delete(Location).where(or_(Location.deleted_at < cutoff, Location.owner_id.in_(purged_users)))
    counts["locations"] = db.execute(locations).rowcount
    for name, model in (("species", Species), ("users", User)):
        counts[name] = db.execute(delete(model).where(model.deleted_at < cutoff)).rowcount
    db.commit()
    return counts
