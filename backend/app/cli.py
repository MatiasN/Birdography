import argparse
from getpass import getpass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import storage
from app.auth import create_user
from app.db import engine
from app.models import PhotoFile


def main():
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("create-user", help="create an account").add_argument("email")
    commands.add_parser("backfill-files", help="fill hash and size for photos migrated from 0.1")
    args = parser.parse_args()

    with Session(engine) as db:
        if args.command == "create-user":
            password = getpass("Password: ")
            if password != getpass("Repeat password: "):
                raise SystemExit("Passwords do not match")
            user = create_user(db, args.email, password)
            print(f"Created user {user.id}: {user.email}")
        else:  # backfill-files; argparse rejects anything else
            backfill_files(db)


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
