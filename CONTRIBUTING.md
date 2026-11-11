# Contributing

## Requirements

- Docker with Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python 3.14 is installed by uv if missing)
- Node.js 24
- [ExifTool](https://exiftool.org/) when running the backend or its tests outside Docker. CI and the Docker image install the version pinned in `backend/scripts/install_exiftool.py` (currently 13.63); to get the same one locally, run `sudo python3 backend/scripts/install_exiftool.py`, or use `--prefix ~/.local` for a user install. Distribution packages (`apt install libimage-exiftool-perl`, `brew install exiftool`) work too but may be older. To upgrade the pin, change `VERSION` and `SHA256` in that script, using the values from https://exiftool.org/checksums.txt. It reads all photo metadata and extracts RAW previews; without it uploads still succeed but get neither (`reread-metadata` repairs them later). Tests that need it are skipped when it is missing; `GET /health` reports the version in use.

## Project layout

```
backend/    FastAPI app, Alembic migrations, pytest suite
frontend/   React + Vite app
docs/plans/ Design plans for roadmap items
scripts/    backup.sh and restore.sh, run on the Docker host
docker-compose.yml       db, backend, frontend
compose.override.yml     dev extras, loaded automatically (backend hot reload)
```

## Setup

```bash
cp .env.example .env
```

Set `POSTGRES_PASSWORD` and `SECRET_KEY` in `.env`. Generate each with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

The backend, the CLI and alembic refuse to start while either still contains `change-me` (the `.env.example` placeholders) or `SECRET_KEY` is shorter than 32 characters.

## Running

### Everything in Docker

```bash
docker compose up -d --build
```

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:3000      |
| API      | http://localhost:8000/docs |
| Database | localhost:`POSTGRES_PORT`  |

`compose.override.yml` is picked up automatically: it reloads the backend on code changes and publishes the API and the database, on `127.0.0.1` only. Use `docker compose -f docker-compose.yml up` to run as in production, where only the frontend is published (on `BIND_ADDRESS:HTTP_PORT`) and the API is reached through it at `/api/`.

The backend runs as `PUID:PGID` (default 1000:1000) and the frontend's nginx as the unprivileged `nginx` user. The backend image's entrypoint (`backend/fix-permissions.sh`) starts as root only to hand the photo directory (`UPLOAD_DIR`, default `./data/photos`) to `PUID:PGID`, then runs the server as that user. A directory Docker just created as root, files written by an older image that ran as root, or a library copied from elsewhere all just work. Only entries owned by someone else are changed, so on later starts it changes nothing, and symlinks are changed themselves, never their targets. `docker compose exec backend …` bypasses the entrypoint and runs as root, but `python -m app.cli` switches to `PUID:PGID` before doing anything, so its files belong to the backend too; for anything else use `exec -u 1000 backend …`. Set `PUID`/`PGID` to your own `id -u`/`id -g` to keep the files owned by your host user. Started without compose (`docker run`), the backend still stops at startup with the `chown` command to run if the directory isn't writable.

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

In `.env` or the environment. A test (`tests/test_config.py`) fails when a backend setting is missing from this table or from `.env.example`.

**Required**

| Setting | |
|---------|---|
| `POSTGRES_DB`, `POSTGRES_USER` | database name and role, also used by the `db` container to create them |
| `POSTGRES_PASSWORD` | database password; rejected while it contains `change-me` |
| `SECRET_KEY` | signs session tokens; at least 32 characters, rejected while it contains `change-me`. Changing it logs everyone out |

**Backend**

| Setting | Default | |
|---------|---------|---|
| `POSTGRES_HOST` | `localhost` | database host when the backend runs outside Docker (always `db` inside) |
| `POSTGRES_PORT` | 5432 | database port outside Docker; the dev override also publishes the database there |
| `UPLOAD_DIR` | `data/photos` | photo storage. In Docker, the host directory mounted at `/data/photos` (default `./data/photos`), owned by `PUID:PGID` automatically |
| `SESSION_DAYS` | 30 | a session ends after this many days without a visit (browser sessions renew daily while in use) |
| `SESSION_MAX_DAYS` | 90 | hard cap: a session never outlives this, counted from the login |
| `SECURE_COOKIES` | `false` | send the session cookie only over HTTPS; set `true` when serving through an HTTPS proxy |
| `ALLOW_REGISTRATION` | `false` | enable `POST /auth/register` |
| `MAX_UPLOAD_MB` | 40 | limit for JPEG, PNG, TIFF, HEIC, WebP |
| `MAX_RAW_UPLOAD_MB` | 70 | limit for RAW files |
| `BACKGROUND_DERIVATIVES_MB` | 20 | above this size, previews and thumbnails are generated after the upload response |
| `EXIFTOOL_PATH` | `exiftool` | ExifTool binary, looked up on `PATH` |
| `TRASH_DAYS` | 30 | trash retention |

**Docker Compose and the frontend container**

| Setting | Default | |
|---------|---------|---|
| `BIND_ADDRESS` | `0.0.0.0` | interface the web UI is published on: every interface, so other devices on the network can reach it; `127.0.0.1` for this machine only |
| `HTTP_PORT` | 3000 | port the web UI is published on |
| `PUID`, `PGID` | 1000 | user and group the backend runs as and the photo files belong to; not 0 |
| `API_PORT` | 8000 | port the API is published on, on `127.0.0.1`, by the development override only |
| `TRUSTED_PROXIES` | empty | addresses or CIDRs of a reverse proxy in front of the frontend (space or comma separated), whose `X-Forwarded-For` is then trusted |
| `CLIENT_MAX_BODY_SIZE` | `75m` | nginx request limit; keep it above `MAX_RAW_UPLOAD_MB` |
| `API_URL` | `http://localhost:8000` | where `npm run dev` proxies `/api` (Vite only) |

`GET /health` reports the upload limits and the ExifTool version in use (`null` if it is missing).

## Backups

All state is in two places: the database (`db-data` volume) and the photo files (`UPLOAD_DIR`). Both scripts run on the Docker host, from anywhere, against the running stack:

```bash
scripts/backup.sh [--db-only] [--keep N] [DEST]   # DEST defaults to ./backups
scripts/restore.sh [--force] DEST/birdography-YYYYmmdd-HHMMSS
```

A backup is a directory with `db.dump` (`pg_dump`, run inside the db container so versions always match), `photos.tar` and `manifest.json` (date, schema revision, counts, SHA-256 of both files). It is readable by its owner only, since the dump holds password hashes. The photos are archived after the dump, so every file the dump refers to is in the archive. Avoid running `purge-trash` during a backup, since it deletes files.

`--db-only` skips the photos. Photo files are written once under random names and never changed, so incremental tools (restic, borg, rsync, NAS snapshots) back them up well; above a few tens of GB, prefer `--db-only` plus one of those on `UPLOAD_DIR`. `--keep N` then deletes all but the newest N backups in `DEST`. Schedule it with cron or a systemd timer, for example nightly:

```cron
30 3 * * * cd /srv/birdography && scripts/backup.sh --keep 14 /mnt/backups/birdography
```

`restore.sh`:

1. Checks the manifest checksums and refuses a backup from a newer version (a schema revision these migrations don't know).
2. Refuses to replace an install that has accounts, unless `--force` is given.
3. Restores into a side database and only swaps it in once `pg_restore` succeeded, so a failed restore changes nothing.
4. Moves the current photo files to `.pre-restore-<date>/` inside the photo directory (never deletes them) and unpacks the archive.
5. Restarts the backend, which migrates an older backup to the current schema, and runs `verify-files`.

On a new machine, start the stack first (`docker compose up -d`), then restore. Delete `.pre-restore-*` once you have checked the result.

Both scripts call `docker compose`; set `COMPOSE` for anything else, for example `COMPOSE="docker compose -p birdography" scripts/backup.sh`.

`python -m app.cli verify-files [--checksums]` compares the catalog with the photo directory: files missing or with the wrong size (or hash, with `--checksums`, which reads everything) fail it, and files no row refers to are listed. Run it after restoring photos from your own file backup.

## Map

`GET /photos/points` returns every located photo of the user as `{id, lat, lon}`, newest first, with the same filters as `GET /photos` (`species_id`, `camera`, `taken_from`, `taken_to`) and no limit: about 40 bytes a photo, gzipped by nginx. The frontend clusters them in the browser with [supercluster](https://github.com/mapbox/supercluster) (`src/clusters.ts`):

- Every marker is `MARKER_PX` (40 px) wide: a round thumbnail for one photo, a count for a group.
- Markers whose centres are closer than `JOIN_PX` (1.5 markers) join into one. supercluster places groups at the average position of their photos, which can drift onto a neighbour, so a last pass joins anything still overlapping into the larger marker. No two drawn markers overlap at any zoom; a test checks this over random photo clouds at every zoom level.
- Clicking a group (or Enter/Space on a focused one) opens a panel with all its photos, newest first, 60 at a time; a photo opens its details. "Zoom in" flies to the level where the group splits. Photos at the same spot never split, so their panel has no zoom button.

## Uploads

`POST /photos` takes one file per request. The type is detected from the content, never the file name: unsupported content gets 415, files over the limit 413, a file already uploaded by anyone 409. ExifTool tells the TIFF-based RAW formats (NEF, ARW, DNG, PEF…) apart from plain TIFF; it trusts the extension for those, so detection runs on an extension-less temp file under `UPLOAD_DIR/.tmp`.

Each photo stores up to three files: the `original`, a JPEG `preview` for formats browsers cannot show (RAW, HEIC, TIFF) and a 400 px `thumbnail`. Derived files keep only the orientation, no GPS or other metadata. If a preview or thumbnail cannot be made the upload still succeeds and the file endpoint falls back to the original. Regenerate missing ones with:

```bash
python -m app.cli backfill-derivatives [--photo ID]
```

Design and decisions: [plan 0002](docs/plans/0002-phase1-photo-upload-api.md).

## Accounts

Registration is disabled by default. Create a user from the CLI:

```bash
docker compose exec backend python -m app.cli create-user you@example.com
# or, outside Docker
cd backend && uv run python -m app.cli create-user you@example.com
```

Set `ALLOW_REGISTRATION=true` to enable `POST /auth/register`. New passwords need at least 10 characters (existing ones keep working).

Sessions are signed tokens, sent as an HTTP-only cookie or, from `POST /auth/login`'s `access_token`, as a bearer token. Browser sessions slide: the cookie is re-issued with a fresh `SESSION_DAYS` expiry about once a day while it is used, up to `SESSION_MAX_DAYS` after the login, so an active user stays logged in and an idle or stolen cookie still dies. Bearer tokens keep their original expiry. `POST /auth/login` and `GET /auth/me` return `expires_at`; the frontend uses it to return to the login page when the session ends. `POST /auth/password` (`current_password`, `new_password`) changes the password and ends every other session of the account; the calling browser gets a new cookie, bearer clients log in again. There is no email flow, so a forgotten password is reset from the CLI, which also ends all sessions:

```bash
python -m app.cli set-password you@example.com
```

Failed logins are throttled: after 5 failures for one email, or 20 from one client address, within 15 minutes, `POST /auth/login` answers 429 with `Retry-After` without checking the password. Wrong current passwords in `POST /auth/password` count too. The counters live in the backend's memory, so a restart clears them; they assume the single uvicorn worker the image runs.

The client address is the one nginx forwards. Behind another reverse proxy, set `TRUSTED_PROXIES` to its address, otherwise every request counts as coming from the proxy and 20 failures block logins for everyone.

## Trash

Deleting a photo, location, species or account through the API moves it to the trash instead of removing it. Trashed rows are hidden and recoverable for `TRASH_DAYS` (default 30). Photos linked to a trashed location or species show up as unlinked until it is restored or purged.

```bash
python -m app.cli restore-user you@example.com   # account, with its photos and locations
python -m app.cli restore photo 42                # or: location, species
python -m app.cli purge-trash [--days N]          # permanently delete expired rows, their files and stale upload temp files
```

Run `purge-trash` periodically (cron on the host, for example). Nothing schedules it for you yet.

After upgrading an install that predates `photo_files` (migration 0006), run `python -m app.cli backfill-files` once to compute file hashes and sizes for existing photos.

## Metadata

Date, camera settings and GPS are read from every upload with ExifTool and the full tag set is kept in `photos.exif`. To read them again, for example after upgrading from a version that used `exifread` (different tag names, nothing from CR3), for photos uploaded while ExifTool was missing, or after an ExifTool upgrade:

```bash
python -m app.cli reread-metadata [--photo ID]
```

It rewrites the metadata columns from the stored originals, and the width and height of RAW originals, keeps dates and positions the user set by hand and skips photos whose original is missing.

RAW width and height are the visible image, as the camera's own JPEG would be, not the sensor size with its margins: they come from `DefaultCropSize` (DNG, newer ARW), Nikon's `CropArea`, the EXIF image size, and only then ExifTool's `ImageSize`. Other formats get their dimensions from Pillow.

### Time zone of the taken date

`taken_offset_minutes` is the camera's `OffsetTimeOriginal` when it records one (bodies from about 2019 on). Otherwise it is the offset of the time zone at the photo's position on that date, looked up with tzfpy and `zoneinfo`; without a position it stays null and `taken_at` reads the local time as UTC. The position is the camera's GPS, or a spot the user chose on the map (`PATCH /photos/{id}` with `lat` and `lon`, both or neither; nulls go back to the camera's GPS; `point_manual` in the response tells which). A date set by the user is never touched by a position change; reverting it (`taken_at_local: null`) derives the offset again from the current position.

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
uv run pytest --cov      # with coverage; CI requires 100% (lines and branches)
```

Tests marked `exiftool` are skipped when ExifTool is not installed, so coverage falls short locally without it. CI installs it and runs everything.

RAW handling is tested against real camera files (NEF, CR3, ARW, DNG) in `backend/tests/fixtures/raw/`, shrunk to under 2.1 MB each by dropping their sensor data. [Its README](backend/tests/fixtures/raw/README.md) lists the sources and explains how to regenerate the files or add a camera.

Frontend unit tests use [Vitest](https://vitest.dev/) with jsdom and Testing Library, next to the code they test (`*.test.ts(x)`):

```bash
cd frontend
npm test                 # once, with coverage; CI requires 100% (lines, branches, functions, statements)
npm run test:watch       # rerun on changes
```

`src/main.tsx` is the only file excluded from coverage, since it just mounts the router; the routes themselves are tested in `src/routes.test.tsx`. Helpers live in `src/test/`:

- `mockApi(routes)` replaces `fetch` with canned replies keyed by `"METHOD /path"` and returns the calls made. A request to an unknown route fails the test.
- `deferred()` gives a reply that arrives when the test says so, to check loading states.
- `makePhoto()` builds a `Photo` with sensible defaults.
- `src/test/leaflet.tsx` stands in for `react-leaflet` (`vi.mock("react-leaflet", () => import("./test/leaflet"))`), because Leaflet needs layout, SVG and canvas APIs that jsdom lacks. Markers render as elements carrying their position, and `clickMap(lat, lon)` triggers a map click.

## Code style

```bash
cd backend && uv run ruff check --fix . && uv run ruff format .
cd frontend && npm run lint && npm run format
```

The frontend is linted with [oxlint](https://oxc.rs/docs/guide/usage/linter) (`.oxlintrc.json`) rather than ESLint: its type-aware rules run on `oxlint-tsgolint`, which is built on the TypeScript 7 compiler, while typescript-eslint does not support TypeScript 7. `npm run lint` fails on warnings too. Besides correctness rules it checks promises (`no-floating-promises`, `no-misused-promises`: use `void` for fire-and-forget calls and wrap async handlers as `onClick={() => void save()}`), hooks dependencies, and accessibility (clickable elements must be buttons or links).

CI runs lint, format checks, backend and frontend tests with their coverage gates, `alembic check` and the frontend build on every push and pull request. A `deploy` job also runs shellcheck on the scripts, starts the production stack, checks that only the UI is published and that the backend runs unprivileged, then backs up, deletes everything, restores and compares the restored photo with the original.
