from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import text

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

    command.downgrade(cfg, "0004")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT file_path, species_id FROM photos")).one() == ("abc.nef", species_id)

    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


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
