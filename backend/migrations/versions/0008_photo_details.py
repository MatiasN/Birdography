"""camera settings, local timestamps, trash and delete rules

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

# (constraint name, table, referred table, column, ondelete after upgrade)
FOREIGN_KEYS = [
    ("fk_photos_location_id_locations", "photos", "locations", "location_id", "SET NULL"),
    ("fk_photos_owner_id_users", "photos", "users", "owner_id", "CASCADE"),
    ("fk_locations_owner_id_users", "locations", "users", "owner_id", "CASCADE"),
]


def upgrade():
    op.add_column("photos", sa.Column("taken_at_local", sa.DateTime(timezone=False)))
    op.add_column("photos", sa.Column("taken_offset_minutes", sa.SmallInteger))
    op.add_column("photos", sa.Column("taken_at_manual", sa.Boolean, nullable=False, server_default="false"))
    op.add_column("photos", sa.Column("iso", sa.Integer))
    op.add_column("photos", sa.Column("shutter_seconds", sa.Numeric(10, 6)))
    op.add_column("photos", sa.Column("aperture", sa.Numeric(4, 1)))
    op.add_column("photos", sa.Column("focal_length_mm", sa.Numeric(6, 1)))
    # taken_at was stored as the camera's local time read as UTC, so the UTC wall clock is the local time.
    op.execute("UPDATE photos SET taken_at_local = taken_at AT TIME ZONE 'UTC'")

    for table in ("photos", "locations", "species", "users"):
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.create_index("ix_photos_deleted_at", "photos", ["deleted_at"])

    for name, table, referred, column, ondelete in FOREIGN_KEYS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, referred, [column], ["id"], ondelete=ondelete)


def downgrade():
    for name, table, referred, column, _ in FOREIGN_KEYS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, referred, [column], ["id"])

    op.drop_index("ix_photos_deleted_at", table_name="photos")
    for table in ("photos", "locations", "species", "users"):
        op.drop_column(table, "deleted_at")

    for column in (
        "focal_length_mm",
        "aperture",
        "shutter_seconds",
        "iso",
        "taken_at_manual",
        "taken_offset_minutes",
        "taken_at_local",
    ):
        op.drop_column("photos", column)
