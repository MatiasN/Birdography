from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect

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


def test_downgrade_removes_everything_and_upgrade_builds_it_again():
    command.downgrade(cfg, "base")
    assert inspect(engine).get_table_names() == ["alembic_version"]
    command.upgrade(cfg, "head")
    assert set(inspect(engine).get_table_names()) >= set(Base.metadata.tables)
    test_models_match_migrations()
