import argparse
from datetime import timedelta
from getpass import getpass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import derivatives, exif, exiftool, storage, trash
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
    commands.add_parser("backfill-files", help="fill hash and size for photos migrated from 0.1")
    derived = commands.add_parser("backfill-derivatives", help="generate missing previews and thumbnails")
    derived.add_argument("--photo", type=int, help="only this photo id")
    reread = commands.add_parser("reread-metadata", help="read EXIF again with ExifTool and update the catalog")
    reread.add_argument("--photo", type=int, help="only this photo id")
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
            counts["temp files"] = storage.sweep_temp()
            print(", ".join(f"{n} {name}" for name, n in counts.items()) + " purged")
        elif args.command == "backfill-files":
            backfill_files(db)
        elif args.command == "backfill-derivatives":
            backfill_derivatives(db, args.photo)
        else:  # reread-metadata; argparse rejects anything else
            reread_metadata(db, args.photo)


def backfill_derivatives(db: Session, photo_id: int | None = None) -> int:
    """Generate the previews and thumbnails photos are missing (older uploads, failed or lost background jobs)."""
    query = select(Photo).where(Photo.deleted_at.is_(None))
    if photo_id is not None:
        query = query.where(Photo.id == photo_id)
    updated = 0
    for photo in db.scalars(query):
        written = derivatives.build(photo)
        if written:
            db.commit()
            updated += 1
    print(f"{updated} photos updated")
    return updated


def reread_metadata(db: Session, photo_id: int | None = None) -> int:
    """Run ExifTool again on every original and rewrite the metadata columns; what the user set by hand is kept.

    For installs that stored metadata with the old exifread reader, and for photos uploaded while ExifTool was
    missing. Trashed photos are included so that restoring one brings current metadata back.
    """
    query = select(Photo)
    if photo_id is not None:
        query = query.where(Photo.id == photo_id)
    updated = 0
    for photo in db.scalars(query):
        original = photo.file("original")
        if original is None or not storage.path(original.path).exists():
            print(f"photo {photo.id}: original missing, skipped")
            continue
        try:
            meta = exif.read(storage.path(original.path))
        except exiftool.ExifToolError as err:
            print(f"photo {photo.id}: {err}, skipped")
            continue
        exif.apply(photo, meta, keep_manual=True)
        updated += 1
    db.commit()
    print(f"{updated} photos updated")
    return updated


def backfill_files(db: Session) -> None:
    """Complete rows created by migration 0006 with a placeholder hash and size."""
    pending = db.scalars(select(PhotoFile).where(PhotoFile.sha256.like("pending:%"))).all()
    hashed = 0
    for file in pending:
        if not storage.path(file.path).exists():
            print(f"photo {file.photo_id}: file {file.path} missing, skipped")
            continue
        file.size_bytes, file.sha256 = storage.digest(file.path)
        hashed += 1
    db.commit()
    print(f"{hashed} files hashed")


if __name__ == "__main__":  # pragma: no cover
    main()
