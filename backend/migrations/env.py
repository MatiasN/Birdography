from alembic import context
from geoalchemy2 import alembic_helpers

from app.config import settings
from app.models import Base


def run_migrations_offline():
    """Emit SQL to stdout without a database connection (`alembic upgrade head --sql`)."""
    context.configure(
        url=settings.database_url,
        target_metadata=Base.metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    from app.db import engine
    from app.schema import compare_options

    with engine.connect() as connection:
        context.configure(connection=connection, render_item=alembic_helpers.render_item, **compare_options(connection))
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
