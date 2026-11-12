# Plan 0006: dependency upgrades from the November 2026 Dependabot PRs

Status: all six steps applied (2026-11-12, see §9); three repository settings to flip for auto-merge · Roadmap: maintenance · Date: 2026-11-12

Dependabot opened 12 PRs on 2026-11-11 (#5-#16). We apply them ourselves in six steps, one PR each: first everything
that is safe as is, then each difficult one on its own with what it needs besides the version bump. Dependabot
closes its PRs by itself once `main` has the version; #9 is closed by hand (step 4).

## 1. What the Dependabot PRs tell us

- Backend and frontend jobs pass on all 12.
- `deploy` fails on 10 of them, but only at shellcheck: they were opened on `de1bee8`, before the SC2015 fix
  (`a691a90`). Their image builds, startup, backup and restore steps **never ran**. Only #5 and #16 were opened on
  the fix and passed `deploy`. So for the Docker changes (#7, #9, #10) the PR checks prove nothing; our own PRs get
  a real `deploy` run.
- Nothing updates the PostGIS image of CI's `services:` block, or the Node version in `ci.yml` and CONTRIBUTING:
  Dependabot only updates the Dockerfiles and compose file. Steps 2, 4 and 5 change those by hand.

Each step is checked the same way, besides CI:

```bash
cd backend && uv run pytest --cov && uv run alembic check
cd frontend && npm run lint && npm test && npm run build
scripts/dev.sh reset              # fresh stack with 300 photos, built from the changed images
```

then a look at the app: map with groups, a group's panel, a photo's details, an upload of a RAW fixture.

## 2. Step 1: the safe batch

| PR | Change | Why it is safe |
|---|---|---|
| #16 | `uvicorn[standard]>=0.54.0` | only raises the minimum; `uv.lock` was on 0.54.0 already; `deploy` green |
| #15 | psycopg 3.3.6 → 3.3.8 | patch |
| #14 | fastapi 0.162.2, sqlalchemy 2.1.8, geoalchemy2 0.21.0, python-multipart 0.0.33, ruff 0.17.4 | patches and one 0.x minor (geoalchemy2); the full suite passes at 100% coverage, `alembic check` too |
| #12 | vite 8.3.7, @vitejs/plugin-react 6.3.0, tailwindcss and @tailwindcss/vite 4.3.5 | minor and patch; lint, tests and build pass |
| #8 | actions/checkout 5 → 7 | the jobs that use it passed |
| #6 | actions/setup-node 5 → 7 | passed; we set `cache: npm` explicitly, so the caching default changes don't matter |
| #11 | astral-sh/setup-uv 6 → 7 | passed; we only use `python-version` |
| #10 | nginx-unprivileged 1.29 → 1.31-alpine | same mainline series; the `deploy` job tests nginx (templates, `real-ip.sh`, only the UI published), and it gets a real run in this PR |

How:

1. Backend: set the five floors and the psycopg and uvicorn floors in `pyproject.toml` as in the PRs, then
   `uv lock --upgrade-package fastapi --upgrade-package sqlalchemy --upgrade-package geoalchemy2
   --upgrade-package python-multipart --upgrade-package ruff --upgrade-package psycopg --upgrade-package psycopg-binary`.
   `uv run ruff format --check .` in case the new ruff formats anything differently.
2. Frontend: `npm install -D vite@^8.3.7 @vitejs/plugin-react@^6.3.0 tailwindcss@^4.3.5 @tailwindcss/vite@^4.3.5`.
   `git diff package-lock.json` should only show those and their own dependencies.
3. `ci.yml`: `checkout@v7`, `setup-node@v7`, `setup-uv@v7`. Skim the three release notes for removed inputs.
4. `frontend/Dockerfile`: `nginxinc/nginx-unprivileged:1.31-alpine`.

If one of them fails, take it out and give it its own step rather than holding back the others.

## 3. Step 2: Python 3.15 (#5)

The image builds and `deploy` passes on 3.15, but CI runs the tests on 3.14 (`setup-uv` with
`python-version: "3.14"`). Merged as is, production would run an interpreter the tests never used. HEIC
(pillow-heif), timezones (tzfpy) and passwords (argon2) have compiled parts and only the tests cover them.

Recommendation: one version everywhere.

1. Run the suite on 3.15 first, without changing anything: `uv run --python 3.15 pytest --cov`. uv has 3.15.2
   on this machine already.
2. `backend/Dockerfile`: `python:3.15-slim`. `ci.yml`: `python-version: "3.15"`.
3. `pyproject.toml`: `requires-python = ">=3.15"` and ruff `target-version = "py315"` (ruff 0.17 supports it;
   checked). Then `uv lock` and `uv run ruff check .`, which may propose new syntax.
4. CONTRIBUTING → Requirements: "Python 3.15 is installed by uv if missing".

Risk: low. If a dependency has no 3.15 wheel, `uv sync` fails at once in CI and in the image build. Fallback: stay
on 3.14 and add a Dependabot ignore for the python image until it has one.

## 4. Step 3: supercluster 9 (#13)

A major version of the library behind the map groups (`frontend/src/clusters.ts`). Its release notes (9.0.0,
9.1.0):

- 9.0.0: much less memory, about 23% faster, coordinate precision 64× finer, MultiPoint support. Breaking:
  `maxZoom` is capped at 30. We use 19, so it doesn't affect us.
- 9.1.0: ships its own TypeScript types, so `@types/supercluster` must go. Types are named exports now, not a
  `Supercluster.` namespace; we only use `Supercluster<Leaf>`, which still works. New `getTileRaw`, which we don't use.

The PR's lockfile also changes unrelated packages (tailwind's wasm bundle), because npm resolved everything again.

How:

1. `npm install supercluster@^9.1.0 && npm uninstall @types/supercluster`, starting from the lockfile on `main`,
   so the diff only has supercluster, kdbush and `@types/geojson`.
2. `npm run build` (the type check) and `npm test`, including the test that checks no two markers overlap at any
   zoom over random photo clouds. The finer precision can move group positions slightly. The test
   checks rules rather than positions, so it should pass as is; if a snapshot-like expectation fails, check
   the new value rather than accepting it blindly.
3. Look at it on the dev stack, where the data now exists to exercise it:
   `scripts/dev.sh reset --photos 2000 --hotspots 40`. Zoom in and out, open a group that never splits (the
   same-spot ones), and with `--region world` pan across the antimeridian.

Risk: low to medium. It is the map's core, but its behaviour is well tested.

## 5. Step 4: Node 26 LTS instead of 25 (#9)

Close #9. Node 25 is an odd-numbered release with no long-term support. It reaches end of life in mid-2027,
sooner than the 24 we have. Node 26 is the current LTS (`node:26-alpine` exists). Builds are all that use it in
the image, but the Node version should be the same in the image, CI and the docs.

1. `frontend/Dockerfile`: `node:26-alpine`. `ci.yml`: `node-version: 26`. CONTRIBUTING → Requirements:
   Node.js 26.
2. Check the `engines` of the toolchain (`npm ls` shows warnings): vite 8, vitest 5, TypeScript 7, oxlint,
   tsgolint.
3. `npm ci && npm run build && npm test` on Node 26 locally, then CI.
4. Step 6 stops this coming back.

Risk: low. Only the build stage uses Node, and the frontend job tests the same version.

## 6. Step 5: PostGIS 18 / PostgreSQL 18 (#7), last

**Do not merge #7.** Checked on 2026-11-12 with `postgis/postgis:18-3.7`:

- With our mount, `db-data:/var/lib/postgresql/data`, it **exits at startup, even on an empty volume**. The
  PostgreSQL 18+ images want one mount at `/var/lib/postgresql` and keep the data in a versioned subfolder
  (`18/docker`). So #7 breaks every install, new ones too. Its `deploy` never got far enough to show it.
- With an existing 17 volume mounted at the new path, it also exits, and names `pg_upgrade`. That is good news:
  an install that pulls the new version without migrating fails loudly instead of starting with an empty database.
- A major PostgreSQL version can't read the previous one's data files, so existing installs have to migrate.
  `pg_upgrade` needs the old and new binaries *and* PostGIS for both, which the community upgrade images
  (`tianon/postgres-upgrade`, `pgautoupgrade`) don't have. Our own backup and restore is a dump, and a newer
  `pg_restore` reads older dumps, so that is the way. A photo catalog's database is small, so a dump is quick.

How:

1. `docker-compose.yml`: `postgis/postgis:18-3.7`, mount `db-data:/var/lib/postgresql`. Same volume name, so
   step 2 above protects anyone who doesn't migrate.
2. `ci.yml` `services.db.image`: `postgis/postgis:18-3.7`. This is where the backend tests and `alembic check`
   run, so they move with it.
3. Upgrade path for an existing install, in CONTRIBUTING → Backups ("Upgrading PostgreSQL") and in the release
   notes:
   ```bash
   scripts/backup.sh /safe/place                    # still on 17
   docker compose down
   docker volume rm <project>_db-data               # the backup is the copy; or keep the old data, see below
   git pull && docker compose up -d --build --wait  # 18, empty database, migrations run
   scripts/restore.sh /safe/place/birdography-*     # no --force needed: the new install has no accounts
   ```
   To keep the 17 data for a rollback instead of removing it, copy the volume before removing it
   (`docker run --rm -v <project>_db-data:/from -v birdography-pg17:/to alpine cp -a /from/. /to/`).
4. Rehearse it once on the dev stack before writing it down. On 17: `scripts/dev.sh reset`, then back it up with
   `COMPOSE="scripts/dev.sh" scripts/backup.sh` (`dev.sh` passes `exec`, `ps` and so on to compose; check that the
   scripts use nothing it intercepts, like `up` or `down`). Then switch to 18, `scripts/dev.sh down --volumes`,
   `up --photos 0`, restore, and `exec backend python -m app.cli verify-files`.
5. Optionally, a startup check: if the db container exits with the "unused mount/volume" message, `dev.sh up`
   could point to the upgrade section, as it already does for a password mismatch.
6. CI `deploy` keeps running backup → delete → restore on 18. A permanent CI test of the 17 → 18 path isn't worth
   it; the rehearsal in 4 is enough.

Also new in 18: data checksums are on by default for new clusters, which is welcome and needs nothing from us.

Risk: high for existing installs (their data); low for the code. Do it on its own, last, with the upgrade notes in
the same PR.

## 7. Step 6: Dependabot settings

- `ignore` major versions of `node` and `postgis/postgis`
  (`update-types: ["version-update:semver-major"]`). Both need coordinated changes (CI, docs, data migration) that
  a bot PR can't make. They become yearly manual steps like 4 and 5, while their patch and minor updates keep
  coming.
- A comment in `dependabot.yml` that the CI `services` image and `node-version` are not tracked and must follow the
  compose file and the Dockerfile.

## 8. Order and size

| Step | PR | Risk | Main check |
|---|---|---|---|
| 1 | safe batch (#6, #8, #10, #11, #12, #14, #15, #16) | low | CI including a real `deploy` run |
| 2 | Python 3.15 (#5) | low | suite on 3.15 locally, then CI |
| 3 | supercluster 9 (#13) | low-medium | overlap test, dev stack with 2000 photos |
| 4 | Node 26 LTS (closes #9) | low | frontend build and tests on 26 |
| 5 | PostGIS 18 (#7) | high (data) | upgrade rehearsed on the dev stack |
| 6 | Dependabot ignores | none | |

Steps 1-4 are independent and could be done in any order; 5 goes last so a problem there doesn't hold the others back.

## 9. Done so far

**2026-11-12, steps 1 and 2**, applied together on the plan 0005 branch, not merged yet.

- Backend versions are exactly the PRs': fastapi 0.162.2, geoalchemy2 0.21.0, psycopg 3.3.8, python-multipart
  0.0.33, ruff 0.17.4, sqlalchemy 2.1.8, uvicorn 0.54.0. `uv lock --upgrade-package` picked fastapi 0.162.5 and
  psycopg 3.3.9 first. Both were less than a day old, inside the 2-day cooldown we ask of Dependabot, so the lock
  is pinned to the PRs' versions. No other package moved.
- Frontend: `package.json` and `package-lock.json` taken as they are from #12 (`main` had no frontend dependency
  change since). A local `npm install` with npm 9 (Node 22) resolved more: rolldown 1.2.19 and a beta
  `@emnapi/core 2.0.0-beta.2`. Lesson: regenerate lockfiles with the project's Node (24), or take Dependabot's.
  #12 leaves the `tailwindcss` range at `^4.3.3` while locking 4.3.5; kept as is.
- CI: checkout v7, setup-node v7, setup-uv v7. Their breaking changes (node24 runtime, `server-url` removed,
  setup-node caching defaults) don't affect us. nginx-unprivileged 1.31-alpine (1.31.7).
- Python 3.15: Dockerfile, CI, `requires-python = ">=3.15"`, ruff `py315`, CONTRIBUTING. Every package with
  compiled code has a cp315 wheel **except PyYAML 6.0.3**, which `uvicorn[standard]` pulls in. It builds from
  source in the image as pure Python, without its C extension (`yaml.__with_libyaml__` is false). uvicorn only uses
  it for YAML log-config files, which we don't use, so nothing changes. Dependabot will offer the wheel once
  PyYAML publishes one.

Checks, all passing:

| Check | Result |
|---|---|
| Backend on 3.14 with the new packages (before switching Python) | 254 passed, 100% coverage, `alembic check` clean |
| Backend on 3.15.2 | 254 passed, 100% coverage, `alembic check` clean, ruff clean on `py315`; no new warnings |
| Frontend on Node 24 (container, CI's steps) | format, lint (0 warnings), 104 tests at 100%, build |
| `deploy` job rehearsed locally (production compose, own project and port) | only the UI published, backend uid 1000, `/api/health` through nginx 1.31.7, ARW upload with preview and thumbnail, backup → `down -v` → restore → restored original byte-identical |
| Dev stack on the new images | `reset` with 300 photos in 1 min, 288 on the map, `verify-files` 600 files intact |

Local ExifTool is 13.50; CI and the image use the pinned 13.63, which the rehearsal used.

**2026-11-12, step 3: supercluster 9.1.0.** Upgraded with the project's Node (24, in a container), so the lockfile
changes are exactly supercluster 8.0.1 → 9.1.0 and `@types/supercluster` removed; its dependencies (kdbush,
`@types/geojson`) were already in the tree. `clusters.ts` needed no change: the bundled types accept
`Supercluster<Leaf>`, and `tsc`, lint, the 104 tests at 100% and the build pass on Node 24.

Zoom behaviour checked against the dev stack reseeded with 1000 photos over 40 hotspots (954 located), through
`PhotoClusters` at every zoom 0-19 over the whole world:

- every photo is behind exactly one marker, and no two markers overlap, at every zoom;
- all 763 groups seen across the zooms split at the zoom they announce (`splitZoom`), zooming in;
- the 3 groups left at zoom 19 (20, 18 and 13 photos) are exactly the seeder's same-spot photos, with
  `splitZoom` null;
- zooming out gathers the hotspots: 1 marker up to zoom 4, 2 at 5, 9 at 6, 22 at 7, 34 at 8, 40 at 10 (the
  hotspots), 906 at 19.

The served bundle from the rebuilt frontend image contains supercluster 9.1's `getTileRaw`, so the image picked
the new version up. Not done: looking at the map in a browser.

**2026-11-12, map fix found while checking step 3.** "Zoom in" on a group could land on a level where the group
was still one marker, needing a second press. `splitZoom` trusted supercluster's expansion zoom (or one level
deeper for markers our overlap pass had joined), but supercluster splits a group into groups placed at their photos'
average, which can be less than a marker apart; the overlap pass then joins them back. Not reproduced on the
default dev data in 7,637 presses (every group, every zoom, views at 1280×800, 900×600 and 390×700, with
supercluster 8 and 9), but a search of random clouds found it in 3 of the first 370; the 4-photo case is now a
test.

Fix in `clusters.ts`: `PhotoClusters.splitZoom(group)` lays out each candidate level around the group with the same
rules as the map and returns the first where its photos are drawn as more than one marker (null if none). A deeper
supercluster result lies wholly inside one result of the level above, so one photo per result tells membership.
It is a method called when a group is opened, replacing the `splitZoom` field computed for every group on every
redraw: computed eagerly, the check took a redraw on 20,000 photos from about 1 ms to 72 ms. Now: redraws as
before, opening a group at most 1.5 ms on the dev data and 21 ms on 20,000 photos. Both new tests fail with the old
logic; 106 tests, 100% coverage.

**2026-11-12, step 4: Node 26 LTS.** `frontend/Dockerfile` build stage `node:26-alpine`, CI `node-version: 26`,
CONTRIBUTING. None of the 147 packages that declare `engines.node` excludes 26 (vitest's range, `^24 || >=26`,
skips 25 on purpose). Checked on Node 26.13.1: CI's frontend steps in `node:26-alpine` (format, lint, 106 tests
at 100%, build); the dev stack in vite mode on the local Node 26 (Vite 8.3.7 serving the app, the API through its
proxy); and in docker mode, the frontend image built from `node:26-alpine` serving a bundle with the fix and
supercluster 9. #9 (Node 25) can be closed.

**2026-11-12, step 5: PostGIS 18 / PostgreSQL 18.** `docker-compose.yml`: `postgis/postgis:18-3.7` (PostgreSQL
18.6, PostGIS 3.7.0), the same `db-data` volume mounted at `/var/lib/postgresql` (the 18 images keep the data in
`18/docker` under it). CI's test database too. Rehearsed on this checkout's own stopped `elm` install, a 17 volume
with 1 account, 2 photos and 6 files, as a user would do it, with a copy of the 17 volume kept (`elm_db-data-pg17`):

1. *Pull and `up` without migrating:* the `db` container stops with the image's own message naming `pg_upgrade`,
   `up --wait` fails, the 17 data is untouched. The loud failure is why the volume keeps its name; a new name would
   have started every existing install with an empty database.
2. *`backup.sh` on 17 → remove the volume → `up` on 18 → `restore.sh`:* **failed at first.** The 17 image's init
   script installed `postgis_tiger_geocoder`, `fuzzystrmatch` and `postgis_topology` into every database, so every
   17 dump names them, and PostGIS 3.7 no longer ships the geocoder (the 18 image's init script says so and skips
   it). `pg_restore` stopped at `CREATE EXTENSION postgis_tiger_geocoder`. The side-database design held: nothing
   was changed. Neither the CI round trip (17 → 17) nor the PR's checks could have found this.

   Fix in `restore.sh`: the dump's table of contents (`pg_restore -l`) is filtered before restoring. Extensions
   the server has (`pg_available_extension_versions`, which also names the schema each is tied to) are kept with
   their schemas; the others are left out with their schemas and config-table data, and named: "Skipping
   extension postgis_tiger_geocoder", "Skipping schema tiger / tiger_data". Everything in `public` is always
   restored. The schema of a kept extension has to stay in the list, since `CREATE EXTENSION postgis_topology WITH
   SCHEMA topology` fails when the schema does not exist (checked). Generic on purpose: a future extension the
   app adds is kept, and an image that drops another one is handled the same way.
3. *With the fix:* the 17 backup restored into 18 in 13 s. Checked: same users, photos, files and schema revision;
   photo rows identical; login works; photo 1's original byte-identical; `GET /photos` identical; a new RAW upload
   works; extensions now `postgis 3.7.0`, `postgis_topology`, `fuzzystrmatch`, `unaccent`, schemas `public` and
   `topology`. Then an 18 → 18 round trip (`backup.sh` on 18, `restore.sh --force`).
4. The dev stack: `up` on its old 17 volume now explains itself and points to `reset`; `reset` gives a fresh 18
   database (PostGIS 3.7 in `/health`). Backend suite and `alembic check` against an 18 container: 254 passed, 100%.
5. CI: a 29 KB db-only backup from a 17 stack (`scripts/fixtures/backup-pg17/`, one account, no photos) is
   restored with `--force` in the `deploy` job on every run, with the skip message, the account count and a login
   checked. `*.dump` is marked binary in `.gitattributes`.

Docs: CONTRIBUTING → Backups → Upgrading PostgreSQL has the steps, the rollback copy and what the skip messages
mean. Existing installs on this machine not touched: `birdography_db-data` (no container; a real install there
will hit case 1 and needs the steps), and the `oak` worktree's stacks, which still run 17 code.

**2026-11-12, step 6: Dependabot settings, plus auto-merge.** `dependabot.yml` ignores majors of `node` (docker)
and `postgis/postgis` (docker-compose), says what it cannot track, and groups minor and patch updates of
github-actions and docker too, so every ecosystem's small bumps arrive as one PR. New
`.github/workflows/dependabot-auto-merge.yml`: Dependabot's own configuration cannot merge anything, so a workflow
does the GitHub-documented thing: `dependabot/fetch-metadata` gives the update type and the compatibility score,
and for minor or patch with score ≥ `DEPENDABOT_AUTO_MERGE_MIN_SCORE` (variable, default 90) the bot approves and
runs `gh pr merge --auto --squash`. The merge itself is GitHub's, subject to the `main` ruleset, so CI stays the
gate. Nothing merges until three repository settings change (not done from here, they are admin actions):
"Allow auto-merge" (off today), "Allow GitHub Actions to create and approve pull requests" (off today), and the
`main` ruleset, which today requires a code-owner review (the bot cannot satisfy it) and lists only `backend` and
`frontend` as required checks (`deploy` should be added: it is where image bumps are tested, and the reason the
Dependabot PRs' failures went unseen). Considered and rejected: a ruleset bypass for the GitHub Actions app, which
would skip the required checks too and let the bot merge before CI finished.
