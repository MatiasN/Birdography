"""naming convention for constraints and indexes

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

INDEXES = [
    ("idx_locations_point", "ix_locations_point"),
    ("idx_photos_point", "ix_photos_point"),
]

CONSTRAINTS = [
    ("species", "species_pkey", "pk_species"),
    ("species", "species_scientific_name_key", "uq_species_scientific_name"),
    ("locations", "locations_pkey", "pk_locations"),
    ("locations", "locations_owner_id_fkey", "fk_locations_owner_id_users"),
    ("photos", "photos_pkey", "pk_photos"),
    ("photos", "photos_file_path_key", "uq_photos_file_path"),
    ("photos", "photos_species_id_fkey", "fk_photos_species_id_species"),
    ("photos", "photos_location_id_fkey", "fk_photos_location_id_locations"),
    ("photos", "photos_owner_id_fkey", "fk_photos_owner_id_users"),
    ("users", "users_pkey", "pk_users"),
    ("users", "users_email_key", "uq_users_email"),
]


# Databases created before this revision have PostgreSQL's default constraint names. Databases
# created from scratch since then already get the convention names in 0002-0004, because Alembic
# applies the naming convention of `target_metadata` to `op.create_table`. Rename only what exists.
RENAME_CONSTRAINT = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{old}' AND conrelid = '{table}'::regclass) THEN
        ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
    END IF;
END $$
"""


def upgrade():
    for old, new in INDEXES:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")
    for table, old, new in CONSTRAINTS:
        op.execute(RENAME_CONSTRAINT.format(table=table, old=old, new=new))


def downgrade():
    for old, new in INDEXES:
        op.execute(f"ALTER INDEX IF EXISTS {new} RENAME TO {old}")
    for table, old, new in CONSTRAINTS:
        op.execute(RENAME_CONSTRAINT.format(table=table, old=new, new=old))
