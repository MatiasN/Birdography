# Plan 0001: Phase 1 database schema

Status: in progress · Roadmap item: [Phase 1 → Database schema](../../ROADMAP.md) · Date: 2026-11-09

Closes the first roadmap item and prepares the schema that the next two items
(photo upload API, EXIF extraction) build on. All decisions below were taken in
the planning rounds; §6 records the decisions for the next items that shaped
this schema.

## 1. What existed before this plan

Migrations `0001`–`0004` gave us:

- `users` (email, password hash)
- `species` (`scientific_name` unique, `name_en`, `name_pt`, `family`)
- `locations` (per user, PostGIS `Geography(POINT)` with GiST index)
- `photos` (owner, single `file_path`, `taken_at`, `camera`, `lens`, raw `exif` JSONB,
  point, optional `species_id` and `location_id`)

Gaps found during investigation:

| Gap | Why it matters |
|-----|----------------|
| One file per photo | RAW+JPEG pairs can't be stored together; browsers can't render RAW, so uploaded RAW photos show as broken images in the grid and on the map. |
| No file metadata (name, size, hash, format, dimensions) | Only available at upload time; needed for duplicate detection and the UI. |
| Camera settings only inside `exif` JSONB as text | Filtering/sorting by ISO, shutter, aperture or focal length is impossible. |
| One species per photo | Photos with several birds can't be catalogued correctly; changing later means a data migration. |
| No `ON DELETE` rules | Deleting a species or location referenced by photos fails with an FK error. |
| `taken_at` without offset is stored as UTC | Cameras usually record local time without an offset; we silently mislabel it. No way to correct a misconfigured camera clock. |
| No naming convention; `idx_` vs `ix_` prefixes; unnamed unique constraints | Future drops and `alembic` autogenerate diffs are fragile. |
| Alembic `env.py` connects eagerly | `alembic upgrade head --sql` (offline mode) fails; CI can't run `alembic check`. |
| `exifread` 3.5.1 can't read CR3, RAF (and likely ORF, RW2) | Those uploads succeed with no date, camera or GPS. NEF (TIFF-based) works. |
| No upload size limit; orphan file left on disk if the DB insert fails | Abuse and disk leaks. |
| Species search is accent-sensitive | "garca" does not find "Garça-real". (It is already case-insensitive via `ILIKE`.) |

## 2. Target schema

Changes relative to the previous models. All tables keep integer primary keys.

### 2.1 `photo_files` (new)

One row per stored file of a photo: the original, a browser-viewable preview
(the JPEG embedded in RAW files, extracted by ExifTool) and a thumbnail.

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `photo_id` | FK `photos.id` ON DELETE CASCADE | indexed |
| `kind` | `String(10)` + CHECK `original`, `preview`, `thumbnail` | unique with `photo_id` → `uq_photo_files_photo_id_kind` |
| `path` | `String(500)`, unique | relative to the storage root (moves here from `photos.file_path`) |
| `original_filename` | `String(255)` nullable | as uploaded, only for `original` |
| `mime_type` | `String(100)` | |
| `format` | `String(10)` | `jpeg`, `nef`, `cr3`, … |
| `is_raw` | bool | |
| `size_bytes` | bigint | |
| `sha256` | `String(64)`, **unique across all users** | a photo can be owned by one account only; re-uploading the same bytes is rejected with 409 |
| `width`, `height` | int nullable | |
| `created_at` | timestamptz, default now | |

Data migration: every existing `photos.file_path` becomes an `original`
`photo_files` row with placeholder hash and size (`pending:<id>`, `0`).
`python -m app.cli backfill-files` computes the real values from the files on
disk, since the migration must not depend on the files being present.
`photos.file_path` is dropped.

### 2.2 `photos` (changed)

Add:

| Column | Type | Notes |
|--------|------|-------|
| `taken_at_local` | timestamp **without** time zone, nullable | what the camera recorded, or what the user set |
| `taken_offset_minutes` | smallint nullable | from `OffsetTimeOriginal` when present, or from the user's value |
| `taken_at_manual` | bool, default false | true when the user overrode the camera date; `PATCH … taken_at_local: null` re-derives from EXIF and clears it |
| `iso` | int nullable | |
| `shutter_seconds` | `Numeric(10, 6)` nullable | `1/500` stored as `0.002`; the UI renders it as a fraction |
| `aperture` | `Numeric(4, 1)` nullable | f-number |
| `focal_length_mm` | `Numeric(6, 1)` nullable | |
| `deleted_at` | timestamptz nullable, indexed | soft delete, see §2.6 |

Keep `taken_at` (timestamptz) as the best-effort instant: local time + offset
when the offset is known; otherwise local time treated as UTC, as before.
Catalog filters and display use `taken_at_local`; `taken_at` is for sorting.

Remove: `file_path` (→ `photo_files`), `species_id` (→ `photo_species`).

Foreign keys: `location_id` → `ON DELETE SET NULL`; `owner_id` → `ON DELETE CASCADE`
(also on `locations.owner_id`).

### 2.3 `photo_species` (new link table)

| Column | Type | Notes |
|--------|------|-------|
| `photo_id` | FK `photos.id` ON DELETE CASCADE | composite PK |
| `species_id` | FK `species.id` ON DELETE CASCADE | composite PK, indexed |
| `position` | smallint, default 0 | ordering; the first entry is the "main" species shown in the grid |

Data migration: copy every non-null `photos.species_id` into the link table,
then drop the column.

### 2.4 `species` (changed)

| Column | Type | Notes |
|--------|------|-------|
| `ebird_code` | `String(16)` nullable, unique | eBird/Clements species code, e.g. `gryher1` |
| `taxon_order` | `Numeric(10, 2)` nullable, indexed | eBird taxonomy sort key |
| `order_name` | `String(100)` nullable | taxonomic order, e.g. `Pelecaniformes`; sits next to `family` |
| `deleted_at` | timestamptz nullable | soft delete |

Search is case- and accent-insensitive: the `unaccent` extension is enabled
and names are matched with `unaccent(lower(col)) ILIKE unaccent(lower(:q))`.
Expression indexes can be added once the catalog grows.

### 2.5 `locations` and `users` (changed)

Both gain `deleted_at` timestamptz nullable.

### 2.6 Deletion rules (trash with 30-day retention)

Deleting anything through the API is a soft delete; rows stay recoverable for
30 days (`TRASH_DAYS` setting), then a purge removes them for good.

- `DELETE /photos/{id}`, `/locations/{id}`, `/species/{id}` and `/auth/me`
  (own account) set `deleted_at`. Normal queries exclude soft-deleted rows.
  A deleted account cannot log in; its photos and locations go with it and
  come back when the account is restored.
- Photos linked to a soft-deleted location or species are **not** modified;
  the API simply presents them as unlinked (`location_id: null`, species
  omitted from `species_ids`) while the parent is in the trash. Restoring the
  parent restores the links.
- Recovery (CLI for now, admin UI later):
  `python -m app.cli restore-user <email>` and
  `python -m app.cli restore <photo|location|species> <id>`.
- `python -m app.cli purge-trash [--days N]` hard-deletes rows with `deleted_at`
  older than the retention, plus the photos and locations of purged users.
  Hard deletes rely on the FK rules above: photo → files and species links
  cascade; location → photos `SET NULL`; user → photos and locations cascade.
  Purging a photo also removes its files from storage.
- Schedule the purge from the host (cron or a compose sidecar); not part of
  this item.
- An admin role that can browse everyone's trash is a follow-up; the
  soft-delete columns are what make it possible.

### 2.7 Naming convention

Set on `Base.metadata`:

```python
MetaData(naming_convention={
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
})
```

Migration `0005` renames what already exists so the database matches the models:

| Old name | New name |
|----------|----------|
| `idx_locations_point`, `idx_photos_point` | `ix_locations_point`, `ix_photos_point` |
| `species_scientific_name_key` | `uq_species_scientific_name` |
| `users_email_key` | `uq_users_email` |
| `photos_file_path_key` | `uq_photos_file_path` (dropped with the column in `0006`) |
| `<table>_pkey` | `pk_<table>` |
| `<table>_<col>_fkey` | `fk_<table>_<col>_<referred table>` |

Spatial indexes are declared explicitly in `__table_args__` with
`spatial_index=False` on the column, so the models describe the whole schema
and autogenerate has nothing to invent.

## 3. Migrations

Small, individually reversible revisions, each with a `downgrade()`:

| Rev | Content |
|-----|---------|
| `0005_naming_convention` | renames from §2.7 |
| `0006_photo_files` | create `photo_files`, copy `file_path` into `original` rows, drop `photos.file_path` |
| `0007_photo_species` | create `photo_species`, copy `species_id`, drop `photos.species_id` |
| `0008_photo_details` | camera-setting columns, `taken_at_local` (backfilled from `taken_at`), `taken_offset_minutes`, `taken_at_manual`, `deleted_at` on photos/locations/species/users, `ON DELETE` rules |
| `0009_species_taxonomy` | `ebird_code`, `taxon_order`, `order_name`, `CREATE EXTENSION unaccent` |

## 4. Alembic and tooling

- `migrations/env.py` in the standard online/offline shape; the engine is only
  created in online mode. `compare_type=True` and the GeoAlchemy2
  `include_object`/`render_item` helpers are passed so PostGIS system tables
  are ignored and spatial types render correctly.
- CI runs `uv run alembic check` after the tests, so model/migration drift
  fails the build.
- Tests:
  - round trip `downgrade base` → `upgrade head`, with data inserted at `0004`
    to prove the `0006`/`0007` data migrations
  - `compare_metadata` against `Base.metadata` must be empty (same check as
    `alembic check`, runnable with pytest)
  - constraints and behaviour: duplicate hash rejected across users; several
    species per photo; manual date override; trash/unlink; purge removes rows
    and files older than the retention; deleted account cannot log in and is
    restorable
  - `TRUNCATE` in `tests/conftest.py` includes `photo_files` and `photo_species`
- CONTRIBUTING documents the naming convention, `alembic check`, and the
  `purge-trash`, `restore`, `restore-user` and `backfill-files` commands.

## 5. API changes that follow from the schema

- `PhotoOut`: `file_path` is gone; adds `files: [{kind, url, format, is_raw,
  width, height, size_bytes}]`, `species_ids: [int]`, `taken_at_local`,
  `taken_offset_minutes`, `taken_at_manual`, `iso`, `shutter_seconds`,
  `aperture`, `focal_length_mm`.
- `PATCH /photos/{id}`: `species_ids` replaces `species_id` (list order is
  persisted as `position`); `taken_at_local` sets the manual date (an
  offset-aware value also sets `taken_offset_minutes`); `null` reverts to EXIF.
- `GET /photos?species_id=` keeps working (joins the link table).
- `GET /photos/{id}/file?kind=original|preview|thumbnail` (default `preview`,
  falling back to `original` when no preview exists). The frontend requests
  the preview.
- `POST /photos` records the original in `photo_files` (hash, size, format,
  dimensions for formats Pillow can open) and answers 409 for a duplicate hash.
- `DELETE` endpoints for photos, locations, species and `/auth/me` soft-delete.
- `SpeciesIn/Out` gain `ebird_code`, `taxon_order`, `order_name`; search is
  accent-insensitive.

## 6. Decisions recorded for the next items (upload API, EXIF)

Not implemented in this item, but decided now because they shaped the schema.

- **Formats accepted**: JPEG, PNG, TIFF, HEIC/HEIF, WebP, and RAW: NEF/NRW
  (Nikon, primary use case), CR2, CR3, ARW, DNG, RAF, ORF, RW2, PEF. Detect by
  content (magic bytes), not only by extension.
- **Upload limits**: `MAX_UPLOAD_MB` = 40 for standard images, `MAX_RAW_UPLOAD_MB`
  = 70 for RAW. Enforce while streaming to disk and delete the partial file on
  overflow. Set `client_max_body_size 75m` in `frontend/nginx.conf`.
- **Metadata reader**: ExifTool (`exiftool -j -n -G1`), installed in the
  backend image. It reads every format above, detects the real file type and
  extracts the embedded JPEG preview from any RAW (`-b -JpgFromRaw` /
  `-PreviewImage`). The preview is stored as the `preview` file; a `thumbnail`
  (about 400 px, Pillow) is generated from the preview or the original so the
  grid and map stay light.
- **Timestamps**: `DateTimeOriginal` → `taken_at_local`; `OffsetTimeOriginal`
  → `taken_offset_minutes`; later, derive the offset from GPS
  (`timezonefinder`) when the camera gives none. A manual override from the
  user always wins (`taken_at_manual`).
- **EXIF JSON**: strip `\x00` from string values before storing in JSONB.
- **Failure cleanup**: if the DB insert fails after the file was written, delete
  the file.

## 7. Out of scope / follow-ups

- Admin role and trash browsing / restore UI.
- Scheduled execution of `purge-trash` inside Docker.
- Compression and external storage (Phase 4).
- eBird import populating `ebird_code` / `taxon_order` (Phase 4).
