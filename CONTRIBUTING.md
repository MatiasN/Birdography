# Contributing

## Requirements

- Docker with Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python 3.14 is installed by uv if missing)
- Node.js 24
- [ExifTool](https://exiftool.org/) when running the backend or its tests outside Docker (`apt install libimage-exiftool-perl`, `brew install exiftool`). It tells the TIFF-based RAW formats apart and extracts RAW previews; without it those uploads are stored as TIFF without a preview. Tests that need it are skipped when it is missing; `GET /health` reports the version in use.

## Project layout

```
backend/    FastAPI app, Alembic migrations, pytest suite
frontend/   React + Vite app
docs/plans/ Design plans for roadmap items
docker-compose.yml       db, backend, frontend
compose.override.yml     dev extras, loaded automatically (backend hot reload)
```

## Setup

```bash
cp .env.example .env
```

Set `POSTGRES_PASSWORD` and `SECRET_KEY` in `.env`. Generate a secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Running

### Everything in Docker

```bash
docker compose up -d --build
```

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:3000      |
| API      | http://localhost:8000/docs |

`compose.override.yml` is picked up automatically and reloads the backend on code changes. Use `docker compose -f docker-compose.yml up` to run without it.

### Frontend with hot reload

Run the database and backend in Docker, and the frontend with Vite:

```bash
docker compose up -d db backend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://localhost:8000` (override with `API_URL`).

### Backend outside Docker

```bash
docker compose up -d db
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

## Settings

Optional, in `.env` or the environment:

| Setting | Default | |
|---------|---------|---|
| `MAX_UPLOAD_MB` | 40 | limit for JPEG, PNG, TIFF, HEIC, WebP |
| `MAX_RAW_UPLOAD_MB` | 70 | limit for RAW files |
| `BACKGROUND_DERIVATIVES_MB` | 20 | above this size, previews and thumbnails are generated after the upload response |
| `CLIENT_MAX_BODY_SIZE` | `75m` | nginx request limit (frontend container); keep it above `MAX_RAW_UPLOAD_MB` |
| `EXIFTOOL_PATH` | `exiftool` | ExifTool binary, looked up on `PATH` |
| `TRASH_DAYS` | 30 | trash retention |

`GET /health` reports the upload limits and the ExifTool version in use (`null` if it is missing).

## Uploads

`POST /photos` takes one file per request. The type is detected from the content, never the file name: unsupported content gets 415, files over the limit 413, a file already uploaded by anyone 409. ExifTool tells the TIFF-based RAW formats (NEF, ARW, DNG, PEF…) apart from plain TIFF; it trusts the extension for those, so detection runs on an extension-less temp file under `UPLOAD_DIR/.tmp`.

Each photo stores up to three files: the `original`, a JPEG `preview` for formats browsers cannot show (RAW, HEIC, TIFF) and a 400 px `thumbnail`. Derived files keep only the orientation, no GPS or other metadata. If a preview or thumbnail cannot be made the upload still succeeds and the file endpoint falls back to the original. Regenerate missing ones with:

```bash
python -m app.cli backfill-derivatives [--photo ID]
```

Design and decisions: [plan 0002](docs/plans/0002-phase1-photo-upload-api.md).

## First user

Registration is disabled by default. Create a user from the CLI:

```bash
docker compose exec backend python -m app.cli create-user you@example.com
# or, outside Docker
cd backend && uv run python -m app.cli create-user you@example.com
```

Set `ALLOW_REGISTRATION=true` to enable `POST /auth/register`.

## Trash

Deleting a photo, location, species or account through the API moves it to the trash instead of removing it. Trashed rows are hidden and recoverable for `TRASH_DAYS` (default 30). Photos linked to a trashed location or species show up as unlinked until it is restored or purged.

```bash
python -m app.cli restore-user you@example.com   # account, with its photos and locations
python -m app.cli restore photo 42                # or: location, species
python -m app.cli purge-trash [--days N]          # permanently delete expired rows, their files and stale upload temp files
```

Run `purge-trash` periodically (cron on the host, for example). Nothing schedules it for you yet.

After upgrading an install that predates `photo_files` (migration 0006), run `python -m app.cli backfill-files` once to compute file hashes and sizes for existing photos.

## Migrations

Migrations run automatically when the backend container starts. To create one after changing `app/models.py`:

```bash
cd backend
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

Review the generated file before committing. Spatial (GiST) indexes are declared explicitly in `__table_args__` with `spatial_index=False` on the column, so autogenerate should not propose any; if it does, the model is missing the index.

Constraint and index names follow the convention set on `Base.metadata` (`pk_`, `fk_<table>_<column>_<referred>`, `uq_<table>_<column>`, `ck_<table>_<name>`, `ix_<table>_<column>`). Migrations name every constraint explicitly so `alembic check` can match them.

```bash
uv run alembic check                     # models and migrations in sync (also runs in CI)
uv run alembic upgrade head --sql        # print the SQL instead of running it
```

## Tests

Backend tests and `alembic check` read the database credentials from `.env` (see Setup), so create it first. Tests run against a real PostGIS database named `birdography_test`, created on first run:

```bash
docker compose up -d db
cd backend
uv run pytest
```

Tests marked `exiftool` are skipped when ExifTool is not installed. CI installs it and runs everything.

## Code style

```bash
cd backend && uv run ruff check --fix . && uv run ruff format .
cd frontend && npm run format
```

CI runs lint, format checks, backend tests, `alembic check` and the frontend build on every push and pull request.
