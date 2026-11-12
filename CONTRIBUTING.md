# Contributing

## Requirements

- Docker with Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python 3.15 is installed by uv if missing)
- Node.js 26 (the current LTS; CI and the Docker image use it too)
- [ExifTool](https://exiftool.org/) when running the backend or its tests outside Docker. CI and the Docker image install the version pinned in `backend/scripts/install_exiftool.py` (currently 13.63); to get the same one locally, run `sudo python3 backend/scripts/install_exiftool.py`, or use `--prefix ~/.local` for a user install. Distribution packages (`apt install libimage-exiftool-perl`, `brew install exiftool`) work too but may be older. To upgrade the pin, change `VERSION` and `SHA256` in that script, using the values from https://exiftool.org/checksums.txt. It reads all photo metadata and extracts RAW previews; without it uploads still succeed but get neither (`reread-metadata` repairs them later). Tests that need it are skipped when it is missing; `GET /health` reports the version in use.

## Project layout

```
backend/    FastAPI app, Alembic migrations, pytest suite; devtools/ has the dev stack's seeder
frontend/   React + Vite app
docs/plans/ Design plans for roadmap items
scripts/    backup.sh and restore.sh, run on the Docker host; dev.sh, the dev stack
docker-compose.yml       db, backend, frontend
compose.override.yml     dev extras, loaded automatically (backend hot reload)
compose.dev.yml          dev stack extras, loaded by scripts/dev.sh only (the seeder)
.dev/                    the dev stack's settings and photos, created by scripts/dev.sh; not in git
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

### Dev stack

The quickest way to a working app: one command starts everything in Docker with a known login and photos
already on the map, apart from any real install on the same machine.

```bash
scripts/dev.sh up
```

Open http://localhost:3001 and log in as `dev@birdography.local` / `birdography-dev`. The first run builds the
images and generates about 300 photos (a minute or so); later runs start in seconds and keep your data. Needs
Docker with Compose and bash; Node.js only for `--vite`. No `.env` needed: the script generates its own secrets.

| Command | |
|---------|---|
| `scripts/dev.sh up [options]` | start (building images), create the dev user, seed photos if it has none, print URLs and login |
| `scripts/dev.sh info` | URLs, login, number of photos, where the settings are |
| `scripts/dev.sh seed [options] [--replace]` | add photos; `--replace` deletes the dev user's photos first |
| `scripts/dev.sh reset [options]` | delete the dev database and photos and start over (`up` with a fresh database) |
| `scripts/dev.sh down [--volumes]` | stop; `--volumes` also deletes the dev database |
| `scripts/dev.sh logs [service]` | follow the logs |
| `scripts/dev.sh <anything else>` | passed to `docker compose` for the dev stack, e.g. `scripts/dev.sh exec backend python -m app.cli verify-files` |

Options of `up` and `reset`. They are saved to `.dev/config.env`, so later commands keep them without repeating:

| Option | Default | |
|--------|---------|---|
| `--docker` / `--vite` | `--docker` | everything in Docker, or the frontend with Vite hot reload (see below) |
| `--data-dir DIR` | `.dev/photos` | photo files; must be empty or created by the script |
| `--http-port PORT` | 3001 | web UI (docker mode) |
| `--api-port PORT` | 8001 | API, `/docs` at `http://localhost:PORT/docs` |
| `--db-port PORT` | 5433 | PostgreSQL, for psql or a database client |
| `--vite-port PORT` | 5174 | Vite (vite mode) |
| `--auto-ports` | | move each port that is taken to the next free one, instead of stopping |
| `--user EMAIL` | `dev@birdography.local` | dev login |
| `--password PASSWORD` | `birdography-dev` | at least 10 characters |
| `--photos N` | 300 | photos to seed into an empty account; 0 for none |
| `--region NAME` | `portugal` | where hotspots are: `portugal`, `iberia`, `europe`, `world`, or a box `lat1,lon1,lat2,lon2` |
| `--hotspots N` | 15 | spots photos gather around, a few busy and many quiet |
| `--same-spot-pct N` | 5 | % of photos exactly on one of the 3 busiest hotspots, which never split on the map |

`seed` takes `--photos`, `--region`, `--hotspots` and `--same-spot-pct` for that run only, without saving them.
`up` seeds only an account without photos, so `up --photos 2000` on a seeded stack changes nothing: use
`seed --photos 2000` to add, or `reset --photos 2000` to start over.

Ports default to one above a real install's (3000, 8000, 5432, 5173), so both run side by side. Before starting,
`up` checks every port it will publish and stops on a taken one, naming the option to change; ports the dev
stack holds itself count as free.

**Vite mode.** `scripts/dev.sh up --vite` starts the database and the backend in Docker, then runs `npm run dev`
in the foreground on `--vite-port`, proxying `/api` to the dev backend; it runs `npm ci` first when needed. Ctrl-C
stops Vite only; the containers keep running until `scripts/dev.sh down`. The backend reloads on code changes in
both modes. `--docker` switches back.

**Settings file.** `.dev/config.env` is created on the first run with every setting and a comment on each. The
ones without an option are only set there:

| Setting | Default | |
|---------|---------|---|
| `DEV_BIND_ADDRESS` | `127.0.0.1` | `0.0.0.0` to try the app from a phone on your network. The dev password is public, so only on a network you trust |
| `DEV_PROJECT` | `birdography-dev` in a folder named Birdography, `birdography-dev-<folder>` in any other | Compose project; containers and the database volume are named after it. Unique per checkout, so worktrees don't share a stack |
| `SEED_SPREAD_KM` | 1.5 | how far photos land from their hotspot (standard deviation) |
| `SEED_NO_GPS_PCT` | 5 | photos without GPS, to place on the map by hand |
| `SEED_YEARS` | 3 | photos are dated over this many past years |
| `SEED_IMAGE_PX` | 1600 | long side of the generated JPEGs; larger is slower and takes more disk |
| `SEED_RANDOM` | 42 | random seed: the same value gives the same photos |
| `POSTGRES_PASSWORD`, `SECRET_KEY` | random | generated once. The database takes its password only when it is created: if you change it, `up` says so, and `reset` starts over with the new one |

The file is also the backend's env file, so any backend setting from [Settings](#settings) can be added there
(`ALLOW_REGISTRATION=true`, `MAX_UPLOAD_MB=5`…) and applies on the next `up`. One `KEY=value` per line, without
quotes or spaces. Delete the file to go back to the defaults; delete `.dev/` entirely, after `scripts/dev.sh down
--volumes`, to remove every trace.

**The photos.** Each one is a JPEG generated on the spot: a gradient in its hotspot's colours with the photo's
number and spot on it, and EXIF with GPS, date, camera, lens and exposure. Cameras are the bodies of the RAW test
fixtures, so the camera filter has choices. About half record their UTC offset; the others get it from their
position, as photos from older cameras do. They go through the same code as an upload (`photos.ingest`), so
metadata, time zones and thumbnails are what a real upload would give. Photo number *n* is always the same image at
the same place for a given `SEED_RANDOM`, which helps reproduce a bug. Expect about 0.2 s and 60 KB per photo.

**Isolation and safety.** The dev stack has its own Compose project, database volume, settings file and photo
folder, and publishes only on `127.0.0.1` by default, so it never touches a real install's `.env`, `db-data` or
`./data/photos`. `reset` empties only a folder with the script's `.birdography-dev` marker in it, and `up` refuses a
non-empty folder without one, so `--data-dir` can't be pointed at a real photo library by mistake. The seeder
(`backend/devtools/seed.py`) is not in the production image and refuses to run without `BIRDOGRAPHY_DEV=1`, which
only `compose.dev.yml` sets.

Everything the script creates is under `.dev/`, which git ignores: settings, secrets and photos stay on your
machine.

The rest of this section is the manual way, with the real `.env`.

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
| `ENV_FILE` | `.env` | file the `db` and `backend` containers read their settings from; `scripts/dev.sh` points it at `.dev/config.env` |

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

### Upgrading PostgreSQL

The database image moved from `postgis/postgis:17-3.5` to `postgis/postgis:18-3.7` in November 2026. A PostgreSQL
major version cannot read the previous one's data files, and the 18 images also keep their data in a versioned
subdirectory of the mount (`/var/lib/postgresql/18/docker`, where 17 used `/var/lib/postgresql/data`). An install
that pulls this change and runs `docker compose up` **does not lose anything**: the `db` container stops with a
message about `pg_upgrade` and `docker compose up --wait` fails, with the 17 data untouched in the `db-data`
volume. To move it over, take a backup on the old version and restore it on the new one:

```bash
git fetch                                            # but don't switch yet: the stack must still be on 17
scripts/backup.sh /safe/place                        # on 17, with the stack running
docker compose down
docker volume rm <project>_db-data                   # the backup is the copy; <project> is the folder name, see `docker volume ls`
git pull                                             # now 18
docker compose up -d --build --wait                  # empty 18 database, migrations run
scripts/restore.sh /safe/place/birdography-<date>    # no --force needed: the new install has no accounts yet
```

To keep the 17 data for a rollback instead of removing it, copy the volume first:
`docker run --rm -v <project>_db-data:/from:ro -v birdography-pg17:/to alpine cp -a /from/. /to/`. Delete
`birdography-pg17` once the restored install has been checked.

`restore.sh` prints `Skipping extension postgis_tiger_geocoder` (and `fuzzystrmatch`, and the `tiger` and
`tiger_data` schemas) when restoring a 17 backup: the 17 image installed those into every database and PostGIS 3.7
no longer ships the geocoder. The app uses `postgis` only, so nothing of yours is left behind. The photos restore
as always, and the result was checked byte for byte on a 17 install upgraded this way (plan 0006). CI restores a
17 backup (`scripts/fixtures/backup-pg17/`) on every run, so this path stays tested.

The dev stack (`scripts/dev.sh`) holds disposable data: `scripts/dev.sh reset` gives it a fresh 18 database.

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

CI runs lint, format checks, backend and frontend tests with their coverage gates, `alembic check` and the frontend build on every push and pull request. A `deploy` job also runs shellcheck on the scripts, starts the production stack, checks that only the UI is published and that the backend runs unprivileged, then backs up, deletes everything, restores and compares the restored photo with the original; it also restores a backup from the PostGIS 17 image and starts the dev stack.

## Dependabot

Dependabot opens weekly update PRs (`.github/dependabot.yml`): one grouped PR per ecosystem for minor and patch bumps, majors on their own, each held until the release is 2 days old. Security fixes are not delayed (they come from the repository's Dependabot security updates setting). Majors of `node` and `postgis/postgis` are ignored on purpose: a Node major moves the Dockerfile, CI and this file together, to an LTS line only; a PostgreSQL major needs the data migration in [Upgrading PostgreSQL](#upgrading-postgresql). Dependabot does not track the PostGIS image of CI's `services` block or the Node version in CI, so those follow the compose file and the Dockerfile by hand.

Minor and patch PRs merge on their own: `.github/workflows/dependabot-auto-merge.yml` approves a Dependabot PR whose update type is minor or patch and whose compatibility score is at least `DEPENDABOT_AUTO_MERGE_MIN_SCORE` (a repository variable, 90 if unset; the score is Dependabot's share of other repositories where the same update kept CI green, and a dependency without data counts as 0), then turns on GitHub's auto-merge. GitHub squash-merges when the `main` ruleset is satisfied: required checks green on the current head, branch up to date, review present. The workflow needs three repository settings: "Allow auto-merge" (General), "Allow GitHub Actions to create and approve pull requests" (Actions → General), and a `main` ruleset whose review rule the bot's approval satisfies (not "Require review from Code Owners") and whose required checks include `deploy`. Every Dependabot PR gets a line in the workflow's summary saying whether it was queued or left for review; majors and low or unknown scores are left.
