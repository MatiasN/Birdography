# Plan 0005: local development script with seeded data

Status: done (2026-11-12) · Roadmap: tooling, not a roadmap item · Date: 2026-11-12

One command that starts a disposable local Birdography with a known login and photos already on the map, on ports
of your choice, without touching a real install on the same machine. How to use it: [CONTRIBUTING → Dev
stack](../../CONTRIBUTING.md#dev-stack).

```bash
scripts/dev.sh up                         # start, create the dev user, seed 300 photos the first time
scripts/dev.sh up --photos 2000 --http-port 3005
scripts/dev.sh up --vite                  # frontend with hot reload instead of the nginx build
scripts/dev.sh reset                      # throw everything away and seed again
```

The decisions in §8 were confirmed on 2026-11-12; the plan below reflects them.

## 1. Starting point

- `docker compose up` (with `compose.override.yml`) gave backend hot reload and published the UI, API and database
  on `HTTP_PORT`, `API_PORT` and `POSTGRES_PORT`.
- It read the one `.env` (`env_file: .env` hard-coded for `db` and `backend`), the `db-data` volume and
  `./data/photos`, so a dev stack was the same install as a real one on the machine.
- The first user had to be created by hand, with an interactive password prompt.
- Nothing created photos except uploads, and each RAW fixture can be uploaded once (duplicates are rejected by
  hash), so the map started empty and the clustering (plan 0004 Part F) couldn't be tried without a photo library.

## 2. Isolation from a real install

| | Real install | Dev stack |
|---|---|---|
| Compose project | directory name | `DEV_PROJECT`: `birdography-dev` in a folder named Birdography, `birdography-dev-<folder>` elsewhere |
| Settings | `.env` | `.dev/config.env`, generated |
| Database volume | `<project>_db-data` | `<DEV_PROJECT>_db-data`, separate because of the project name |
| Photos | `./data/photos` | `.dev/photos` |
| Published on | `BIND_ADDRESS` (default `0.0.0.0`) | `127.0.0.1`, since the password is public |

Everything generated lives under `.dev/`, which `.gitignore` excludes, so settings, secrets and photos stay on the
machine. (`./data/` was not an option: Docker creates it as root when a real install starts first.)

The project name is unique per checkout because two worktrees sharing one project recreate each other's
containers with their own secrets, and the backend then can't log in to the database. That happened while this
was being built, with another worktree running its own dev stack.

`docker-compose.yml` gets one change, `env_file: ${ENV_FILE:-.env}`; unset, nothing changes for production or CI.
The new `compose.dev.yml`, loaded by the script only, mounts `backend/devtools` into the backend and sets
`BIRDOGRAPHY_DEV=1`.

## 3. The script: `scripts/dev.sh`

Bash (it needs `printf -v`, `/dev/tcp` and arrays), checked by shellcheck in the `deploy` job like the other
scripts. Commands: `up`, `seed`, `reset`, `down [--volumes]`, `info`, `logs`, and anything else passed through to
`docker compose` for the dev project.

**Configuration.** Flag > `.dev/config.env` > built-in default. The config file is created on first run with every
setting, commented, plus random `POSTGRES_PASSWORD` and `SECRET_KEY` kept from then on. It is read line by line,
never sourced, so a value can't run as code. Flags of `up` and `reset` are saved to it, but only once the checks
pass, so a run that stops on a taken port changes nothing. Flags of `seed` apply to that run only. The file is also
the backend's env file, so any backend setting can be added to it.

**Ports.** `up` checks every port it will publish (`ss`, or `/dev/tcp` where there is no `ss`) and stops naming
the port, the setting and the flag. Ports the dev stack holds itself count as free, so `up` can be repeated.
`--auto-ports` moves each taken port to the next free one and saves it.

**Modes.** `docker`: everything in Compose, backend hot reload. `vite`: db and backend in Compose, the frontend
container stopped, then `npm run dev --strictPort` in the foreground with `API_URL` set to the dev API, after
`npm ci` when `node_modules` is missing or older than `package-lock.json`.

**Safety.** The data folder gets a `.birdography-dev` marker. `up` refuses a non-empty folder without it and
`reset` empties only a folder with it. If the backend can't start because the database was created with another
password, `up` says so and suggests putting it back or `reset`.

## 4. Seeding: `backend/devtools/seed.py`

Run inside the backend container by the script (`python -m devtools.seed`). It sits next to `app/`, so the
production image (which copies `app` only) doesn't have it. It refuses to run without `BIRDOGRAPHY_DEV=1`, takes
the password from `DEV_USER_PASSWORD` so it doesn't show in the process list, drops to `PUID:PGID` like the CLI,
and only creates or (with `--replace`) deletes photos of the dev account.

**Through the real upload path.** The body of `POST /photos` moved into `photos.ingest(db, user, stream,
filename)`, raising `photos.Rejected(status, detail)`, which the endpoint turns into the HTTP error. The seeder
calls it, so type detection, ExifTool, time zones and thumbnails behave as for a real upload. Measured: about
0.2 s and 60 KB per photo (300 photos in a minute from scratch, images built).

**Account.** Created if missing, taken out of the trash if trashed, and its password reset to the configured one
if it differs, so the login printed by `info` always works.

**Photos.** Pillow draws a gradient in the hotspot's colours with the photo number and spot, and writes EXIF:
GPS, `DateTimeOriginal`, `OffsetTimeOriginal` for about half (the rest get theirs from the position), make, model,
lens, ISO, exposure, aperture and focal length. Cameras are the RAW fixtures' bodies.

**Where.** `SEED_HOTSPOTS` centres at random in the region, with Zipf-like weights (a few busy spots, many quiet
ones). Photos land around their hotspot with a normal spread of `SEED_SPREAD_KM`. `SEED_SAME_SPOT_PCT` sit exactly
on one of the 3 busiest hotspots: spread over every hotspot, 5% of 40 photos never stacked up, and the point is
groups that never split. `SEED_NO_GPS_PCT` have no GPS. Latitudes stay within ±85°.

**Reproducible.** Hotspots depend on the seed only, and photo *n* on the seed and *n*, so it is always the same
image at the same place. A new seed run continues the numbering, and numbers that already exist (hashes are unique
across accounts) are skipped.

## 5. Settings

Flags, per the decisions in §8; everything is also in `.dev/config.env`.

| Setting | Flag | Default |
|---|---|---|
| `DEV_MODE` | `--docker` / `--vite` | `docker` |
| `DEV_DATA_DIR` | `--data-dir` | `.dev/photos` |
| `DEV_HTTP_PORT` | `--http-port` | 3001 |
| `DEV_API_PORT` | `--api-port` | 8001 |
| `DEV_DB_PORT` | `--db-port` | 5433 |
| `DEV_VITE_PORT` | `--vite-port` | 5174 |
| | `--auto-ports` | off |
| `DEV_USER_EMAIL` | `--user` | `dev@birdography.local` |
| `DEV_USER_PASSWORD` | `--password` | `birdography-dev` |
| `SEED_PHOTOS` | `--photos` | 300 |
| `SEED_REGION` | `--region` | `portugal` (also `iberia`, `europe`, `world`, `lat1,lon1,lat2,lon2`) |
| `SEED_HOTSPOTS` | `--hotspots` | 15 |
| `SEED_SAME_SPOT_PCT` | `--same-spot-pct` | 5 |

Config file only: `DEV_BIND_ADDRESS` (127.0.0.1), `DEV_PROJECT`, `SEED_SPREAD_KM` (1.5), `SEED_NO_GPS_PCT` (5),
`SEED_YEARS` (3), `SEED_IMAGE_PX` (1600), `SEED_RANDOM` (42), and any backend setting.

## 6. Tests and CI

- `backend/tests/test_devseed.py` covers region parsing, hotspot placement and determinism, the shares of no-GPS
  and same-spot photos, wrapping at the antimeridian, EXIF read back by ExifTool, uniqueness of files, the
  `BIRDOGRAPHY_DEV` guard, option validation, seeding through `ingest`, `--if-empty`, `--count`, `--replace` leaving
  other accounts alone, skipping numbers uploaded by another account, and restoring the account. `devtools` is in
  the coverage source, so the 100% gate applies.
- `deploy` job: after the backup and restore steps, `scripts/dev.sh up --photos 20` from the clean checkout, a login
  with the dev account, at least 15 points on the map, then `down --volumes`.

## 7. Docs

CONTRIBUTING → Running → Dev stack: commands, options, settings file, what the photos are, isolation. Also the
project layout and `ENV_FILE` in Settings. README → Development points to it.

## 8. Decisions

Confirmed 2026-11-12:

1. Ports, mode, data folder, login, photo count, region, hotspots and same-spot share are flags; everything else is
   in the config file only.
2. Everything the script generates is ignored by git (`.dev/`).
3. Seed through the real upload path, with the `photos.ingest` refactor.
4. Seeder outside `app/`, not in the production image, behind the `BIRDOGRAPHY_DEV` guard.
5. Dev ports one above a real install's.
6. Photos only for now. Next, with Phase 2: `SEED_SPECIES` (1-3 species per photo from a small bundled list) and
   `SEED_EXTRA_USERS` (a second account with its own photos, to check nobody sees another user's data).
