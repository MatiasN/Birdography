import argparse
from datetime import timedelta
from getpass import getpass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import exif, storage, trash
from app.auth import create_user, restore_user
from app.config import settings
from app.db import engine
from app.models import Photo, PhotoFile


def main():
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("create-user", help="create an account").add_argument("email")
    commands.add_parser("restore-user", help="take an account out of the trash").add_argument("email")
    restore = commands.add_parser("restore", help="take a photo, location or species out of the trash")
    restore.add_argument("kind", choices=["photo", "location", "species"])
    restore.add_argument("id", type=int)
    purge = commands.add_parser("purge-trash", help="permanently delete what has been in the trash long enough")
    purge.add_argument("--days", type=int, default=settings.trash_days, help="retention in days (default TRASH_DAYS)")
    commands.add_parser("backfill-files", help="fill hash, size and camera settings for photos migrated from 0.1")
    args = parser.parse_args()

    with Session(engine) as db:
        if args.command == "create-user":
            password = getpass("Password: ")
            if password != getpass("Repeat password: "):
                raise SystemExit("Passwords do not match")
            user = create_user(db, args.email, password)
            print(f"Created user {user.id}: {user.email}")
        elif args.command == "restore-user":
            try:
                user = restore_user(db, args.email)
            except LookupError as err:
                raise SystemExit(str(err)) from None
            print(f"Restored user {user.id}: {user.email}")
        elif args.command == "restore":
            row = db.get(trash.RESTORABLE[args.kind], args.id)
            if not row:
                raise SystemExit(f"No {args.kind} with id {args.id}")
            row.deleted_at = None
            db.commit()
            print(f"Restored {args.kind} {args.id}")
        elif args.command == "purge-trash":
            counts = trash.purge(db, retention=timedelta(days=args.days))
            print(", ".join(f"{n} {name}" for name, n in counts.items()) + " purged")
        else:  # backfill-files; argparse rejects anything else
            backfill_files(db)


def backfill_files(db: Session) -> None:
    """Complete rows created by migration 0006 with a placeholder hash and size, and the camera-setting
    columns added by migration 0008, which are read from the stored EXIF."""
    pending = db.scalars(select(PhotoFile).where(PhotoFile.sha256.like("pending:%"))).all()
    hashed = 0
    for file in pending:
        if not storage.path(file.path).exists():
            print(f"photo {file.photo_id}: file {file.path} missing, skipped")
            continue
        file.size_bytes, file.sha256 = storage.digest(file.path)
        hashed += 1

    filled = 0
    for photo in db.scalars(select(Photo).where(Photo.exif.is_not(None))):
        meta = exif.parse(photo.exif)
        missing = [f for f in exif.CAMERA_FIELDS if getattr(photo, f) is None and meta[f] is not None]
        for field in missing:
            setattr(photo, field, meta[field])
        filled += bool(missing)
    db.commit()
    print(f"{hashed} files hashed")
    print(f"{filled} photos given camera settings")


if __name__ == "__main__":  # pragma: no cover
    main()
