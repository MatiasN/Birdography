"""Shared settings for comparing the models with the database (`alembic check`, autogenerate, tests)."""

from sqlalchemy import Connection, text

from app.models import Base

# Tables created by extensions (PostGIS, and in the postgis/postgis image also the Tiger geocoder and
# topology). They are visible through the search_path, so reflection would see them as ours.
EXTENSION_TABLES = text(
    """
    SELECT c.relname FROM pg_class c
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    """
)


def compare_options(connection: Connection) -> dict:
    """Options for `context.configure` / `MigrationContext.configure` against a live database.

    The extension lookup is deferred to the first comparison. Querying here, before Alembic opens its
    transaction, would leave one open; Alembic then skips its own commit and the migrations roll back.
    """
    extension_tables: set[str] | None = None

    def include_object(obj, name, type_, reflected, compare_to):
        nonlocal extension_tables
        if type_ == "table" and reflected and compare_to is None:
            if extension_tables is None:
                extension_tables = set(connection.scalars(EXTENSION_TABLES))
            return name not in extension_tables
        return True

    return {"target_metadata": Base.metadata, "compare_type": True, "include_object": include_object}
