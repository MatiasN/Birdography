"""camera brand and model, for the Catalogue's camera filter

Revision ID: 0013
Revises: 0012

Existing photos get both from the EXIF tags already stored in `photos.exif`, by the same rules as
`app.exif.camera()`, and `camera` is rebuilt from them ("NIKON CORPORATION NIKON Z 8" becomes "Nikon Z 8").
Plain SQL, so `alembic upgrade --sql` still works. tests/test_migrations.py checks it agrees with the Python.
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

# Frozen copy of app.exif.BRANDS as of this revision; later additions there don't change this migration.
BRANDS = {
    "APPLE": "Apple",
    "CANON": "Canon",
    "DJI": "DJI",
    "FUJIFILM": "Fujifilm",
    "GOOGLE": "Google",
    "HASSELBLAD": "Hasselblad",
    "HUAWEI": "Huawei",
    "LEICA": "Leica",
    "NIKON": "Nikon",
    "OLYMPUS": "Olympus",
    "OM": "OM System",
    "ONEPLUS": "OnePlus",
    "PANASONIC": "Panasonic",
    "PENTAX": "Pentax",
    "RICOH": "Ricoh",
    "SAMSUNG": "Samsung",
    "SIGMA": "Sigma",
    "SONY": "Sony",
    "XIAOMI": "Xiaomi",
}
# Python's str.strip() whitespace, near enough: what ExifTool leaves around a tag value.
WS = r"E' \t\n\r\f\v'"


def backfill_sql() -> str:
    brands = ", ".join(f"('{word}', '{name}')" for word, name in BRANDS.items())
    return f"""
WITH raw AS (
    SELECT id,
           nullif(btrim(exif->>'IFD0:Make', {WS}), '') AS make,
           nullif(btrim(exif->>'IFD0:Model', {WS}), '') AS model
    FROM photos
    -- Only photos whose tags name a camera, so nothing else loses its current value.
    WHERE exif->>'IFD0:Make' IS NOT NULL OR exif->>'IFD0:Model' IS NOT NULL
), words AS (
    SELECT id, make, model,
           upper(split_part(make, ' ', 1)) AS make_word,
           upper(split_part(model, ' ', 1)) AS model_word
    FROM raw
), brands(word, name) AS (VALUES {brands}),
parts AS (
    SELECT w.id,
           CASE WHEN mb.name IS NOT NULL THEN mb.name ELSE coalesce(kb.name, w.make) END AS brand,
           CASE WHEN mb.name IS NOT NULL OR w.model_word = w.make_word
                THEN nullif(btrim(substr(w.model, length(w.model_word) + 1), {WS}), '')
                ELSE w.model END AS model
    FROM words w
    LEFT JOIN brands mb ON mb.word = w.model_word
    LEFT JOIN brands kb ON kb.word = w.make_word
)
UPDATE photos SET camera_make = parts.brand,
                  camera_model = parts.model,
                  camera = nullif(concat_ws(' ', parts.brand, parts.model), '')
FROM parts
WHERE photos.id = parts.id
"""


def upgrade():
    op.add_column("photos", sa.Column("camera_make", sa.String(100)))
    op.add_column("photos", sa.Column("camera_model", sa.String(200)))
    op.execute(backfill_sql())


def downgrade():
    # `camera` keeps the tidied name; reread-metadata isn't needed to go back.
    op.drop_column("photos", "camera_model")
    op.drop_column("photos", "camera_make")
