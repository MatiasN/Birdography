from datetime import datetime

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine
from app.models import Base
from app.schema import compare_options

cfg = Config("alembic.ini")


def test_models_match_migrations():
    """Same comparison as `alembic check`: the models must describe exactly what the migrations build."""
    with engine.connect() as conn:
        context = MigrationContext.configure(conn, opts=compare_options(conn))
        diff = compare_metadata(context, Base.metadata)
    assert diff == []


def test_extension_tables_are_looked_up_once():
    with engine.connect() as conn:
        include = compare_options(conn)["include_object"]
        assert include(None, "spatial_ref_sys", "table", True, None) is False
        assert include(None, "spatial_ref_sys", "table", True, None) is False  # cached
        assert include(None, "photos", "table", True, None) is True
        assert include(None, "ix_photos_point", "index", True, None) is True


def test_round_trip_migrates_existing_data():
    command.downgrade(cfg, "0004")
    with engine.begin() as conn:
        user_id = conn.scalar(text("INSERT INTO users (email, password_hash) VALUES ('m@x.org', 'h') RETURNING id"))
        species_id = conn.scalar(text("INSERT INTO species (scientific_name) VALUES ('Ardea cinerea') RETURNING id"))
        photo_id = conn.scalar(
            text(
                "INSERT INTO photos (owner_id, file_path, taken_at, species_id) "
                "VALUES (:owner, 'abc.nef', '2026-05-14 07:32:10+00', :species) RETURNING id"
            ),
            {"owner": user_id, "species": species_id},
        )

    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        file = conn.execute(text("SELECT photo_id, kind, path, format, is_raw, size_bytes, sha256 FROM photo_files"))
        assert file.one() == (photo_id, "original", "abc.nef", "nef", True, 0, f"pending:{photo_id}")
        assert conn.execute(text("SELECT photo_id, species_id, position FROM photo_species")).all() == [
            (photo_id, species_id, 0)
        ]
        assert conn.scalar(text("SELECT taken_at_local FROM photos")) == datetime(2026, 5, 14, 7, 32, 10)
        assert conn.scalar(text("SELECT taken_at_manual FROM photos")) is False

    command.downgrade(cfg, "0004")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT file_path, species_id FROM photos")).one() == ("abc.nef", species_id)

    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


FILE_ROW = (
    "INSERT INTO photo_files (photo_id, kind, path, mime_type, format, is_raw, size_bytes, sha256) "
    "VALUES (:photo, :kind, :path, 'image/jpeg', 'jpeg', false, 1, :hash)"
)


def test_original_hash_unique_round_trip():
    """0010: the hash stays unique among originals, while derived files may repeat it; its downgrade restores
    the global constraint by dropping the colliding derived rows."""
    command.downgrade(cfg, "0009")
    with engine.begin() as conn:
        user_id = conn.scalar(text("INSERT INTO users (email, password_hash) VALUES ('m@x.org', 'h') RETURNING id"))
        photo_a = conn.scalar(text("INSERT INTO photos (owner_id) VALUES (:o) RETURNING id"), {"o": user_id})
        photo_b = conn.scalar(text("INSERT INTO photos (owner_id) VALUES (:o) RETURNING id"), {"o": user_id})
        conn.execute(text(FILE_ROW), {"photo": photo_a, "kind": "original", "path": "a.jpg", "hash": "aa"})
        with pytest.raises(IntegrityError):
            with conn.begin_nested():
                conn.execute(text(FILE_ROW), {"photo": photo_a, "kind": "preview", "path": "a_p.jpg", "hash": "aa"})

    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        conn.execute(text(FILE_ROW), {"photo": photo_a, "kind": "preview", "path": "a_p.jpg", "hash": "same"})
        conn.execute(text(FILE_ROW), {"photo": photo_b, "kind": "preview", "path": "b_p.jpg", "hash": "same"})
        conn.execute(text(FILE_ROW), {"photo": photo_b, "kind": "original", "path": "b.jpg", "hash": "same"})
        # A derived file may even repeat an original's hash; only originals are checked against each other.
        conn.execute(text(FILE_ROW), {"photo": photo_a, "kind": "thumbnail", "path": "a_t.jpg", "hash": "aa"})
        # The same hash as an existing original, on a *new* original: rejected.
        with pytest.raises(IntegrityError):
            with conn.begin_nested():
                photo_c = conn.scalar(text("INSERT INTO photos (owner_id) VALUES (:o) RETURNING id"), {"o": user_id})
                conn.execute(text(FILE_ROW), {"photo": photo_c, "kind": "original", "path": "c.jpg", "hash": "aa"})

    command.downgrade(cfg, "0009")
    with engine.connect() as conn:
        # Every derived row collided with an original; the originals are untouched.
        rows = conn.execute(text("SELECT kind, path FROM photo_files ORDER BY id")).all()
        assert rows == [("original", "a.jpg"), ("original", "b.jpg")]
        constraints = conn.scalars(text("SELECT conname FROM pg_constraint WHERE conrelid = 'photo_files'::regclass"))
        assert "uq_photo_files_sha256" in set(constraints)

    command.upgrade(cfg, "head")
    test_models_match_migrations()


# Constraint names of databases created before the naming convention (PostgreSQL defaults).
LEGACY_NAMES = {
    "species_pkey",
    "species_scientific_name_key",
    "locations_pkey",
    "locations_owner_id_fkey",
    "photos_pkey",
    "photos_file_path_key",
    "photos_species_id_fkey",
    "photos_location_id_fkey",
    "photos_owner_id_fkey",
    "users_pkey",
    "users_email_key",
}


def _constraint_names() -> set[str]:
    with engine.connect() as conn:
        return set(conn.scalars(text("SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace")))


def test_naming_convention_migration_round_trip():
    """Existing installs have PostgreSQL's default names: 0005 renames them, and its downgrade restores them."""
    command.downgrade(cfg, "0004")
    assert LEGACY_NAMES <= _constraint_names()

    command.upgrade(cfg, "head")
    assert not LEGACY_NAMES & _constraint_names()
    test_models_match_migrations()
