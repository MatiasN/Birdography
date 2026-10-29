import argparse
from getpass import getpass

from sqlalchemy.orm import Session

from app.auth import create_user
from app.db import engine


def main():
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("create-user").add_argument("email")
    args = parser.parse_args()

    if args.command == "create-user":
        password = getpass("Password: ")
        if password != getpass("Repeat password: "):
            raise SystemExit("Passwords do not match")
        with Session(engine) as db:
            user = create_user(db, args.email, password)
        print(f"Created user {user.id}: {user.email}")


if __name__ == "__main__":
    main()
