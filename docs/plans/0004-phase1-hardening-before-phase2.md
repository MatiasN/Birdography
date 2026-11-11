# Plan 0004: hardening before Phase 2

Status: done (2026-11-11); Docker images (§8e) moved to Phase 4 · Roadmap: cleanup between [Phase 1 and Phase 2](../../ROADMAP.md); Part F completes Phase 1 → Map with photo markers · Date: 2026-11-11

Cleanup requested before Phase 2 starts, in six parts:

- **A. CI fix:** the backend workflow fails at `alembic upgrade head`.
- **B. Security and deployment:** ports published on every interface, placeholder secrets accepted, no password change, no login throttling, backend container running as root, undocumented settings.
- **C. Data safety:** backup and restore.
- **D. Frontend tooling:** ESLint everywhere, unit tests with 100% coverage.
- **E. Frontend session expiration** (with the password change form from B).
- **F. Map aggregation:** clustered markers instead of the first 200 photos.
- **G. Repository automation:** Dependabot with a 48 h cooldown. ~~Docker images built in CI~~ (moved to Phase 4, decided 2026-11-11).

Items already on the roadmap stay there: scheduled `purge-trash` and the admin role (Phase 4), location stops (Phase 2; a stop is stored data, a map cluster is only a display).

The decisions in §9 were confirmed on 2026-11-11, some of them differently from the first draft; the plan below reflects the confirmed ones.

## 1. Current state

- `.github/workflows/ci.yml` sets `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` and `SECRET_KEY`, but not `POSTGRES_DB`, which `Settings` requires. `pytest` passes only because `tests/conftest.py` sets `POSTGRES_DB` itself. The next step, `alembic upgrade head`, then imports `app.config` without it and fails (the traceback in the request). `alembic check` would fail the same way.
- `docker-compose.yml` publishes `5432` (db), `8000` (backend) and `3000` (frontend) on `0.0.0.0`. The API and the database are reachable from the network without going through nginx.
- `Settings` accepts any `SECRET_KEY` and `POSTGRES_PASSWORD`, including `.env.example`'s `change-me…` values and CI's 9-character `ci-secret`.
- Auth (`app/auth.py`): login, logout, me, delete-me, register. No password change. No limit on login attempts. Sessions are stateless HS256 JWTs (`sub`, `exp`, `SESSION_DAYS`), so nothing can revoke them early. Passwords have no minimum length.
- `backend/Dockerfile` has no `USER`, so uvicorn, ExifTool and the migrations run as root and the files they write under `./data/photos` belong to root.
- Settings the docs don't cover: `SESSION_DAYS`, `SECURE_COOKIES`, `POSTGRES_HOST`, `POSTGRES_PORT` and `UPLOAD_DIR` in CONTRIBUTING. `.env.example` lacks `ALLOW_REGISTRATION`, `TRASH_DAYS`, `BACKGROUND_DERIVATIVES_MB`, `SESSION_DAYS` and `SECURE_COOKIES`. The README quick start mentions none.
- There is no backup tooling. All state lives in the `db-data` volume and the `UPLOAD_DIR` bind mount.
- Frontend: Prettier only, no linter, no tests. `npm run build` runs `tsc --noEmit` with **TypeScript 7.0.2**, which has no JavaScript API (`require("typescript").createSourceFile` is `undefined`). typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`.
- A 401 only redirects to `/login` from `Layout`'s first `/auth/me` call. After that, an expired session shows up as error messages inside the pages.
- `MapPage` fetches `/photos?limit=200` (the API caps `limit` at 200) and draws one `CircleMarker` per photo, so it never shows more than the 200 most recent.
- `.github/` has `CODEOWNERS` and `ci.yml` and nothing else. Images are built only locally by compose.

---

# Part A: CI fix

## 2. Workflow env

Add `POSTGRES_DB: birdography` to the backend job's `env`. In the same change, replace `SECRET_KEY: ci-secret` with a 32+ character value, otherwise Part B's validation (§3.2) breaks CI again. `pytest` keeps using `birdography_test` through conftest, and the two alembic steps use `birdography`, which the service container creates.

This lands first and on its own, so later PRs get a green CI.

---

# Part B: security and deployment

## 3. Design

### 3.1 Ports

- **db:** not published in `docker-compose.yml`. `compose.override.yml` (dev) publishes it on `127.0.0.1:${POSTGRES_PORT:-5432}` for the "backend outside Docker" and test workflows.
- **backend:** not published in `docker-compose.yml`, since nginx is its only client. `compose.override.yml` publishes `127.0.0.1:8000` for `/docs` and Vite's proxy.
- **frontend:** `${BIND_ADDRESS:-0.0.0.0}:${HTTP_PORT:-3000}:8080`. It stays reachable from other devices on the network by default (D2); `BIND_ADDRESS=127.0.0.1` keeps it to the machine. It is now the only published port.

### 3.2 Rejecting placeholder secrets

A `model_validator` in `Settings` stops startup (the backend, the CLI and alembic) with a message naming the variable when:

- `SECRET_KEY` is shorter than 32 characters or contains `change-me`
- `POSTGRES_PASSWORD` is empty or contains `change-me`

`.env.example` keeps the `change-me` values on purpose: copying it without editing has to fail. The README quick start and CONTRIBUTING show how to generate both values.

### 3.3 Password change and session revocation

- New column `users.session_version integer NOT NULL DEFAULT 0` (migration `0012_session_version`). Tokens carry it as `ver`, and `get_current_user` rejects tokens whose `ver` differs; tokens without `ver` (issued before the upgrade) count as 0, so upgrading logs nobody out. Changing the password bumps the version, which logs out every other session. That is the only revocation stateless JWTs allow without a session table. An integer replaced the first draft's `password_changed_at` timestamp because `iat` has one-second resolution, so a timestamp comparison either accepts old tokens from the same second or rejects the new one.
- `POST /auth/password` takes `{current_password, new_password}`: 204 on success, 400 if the current password is wrong (it counts as a failed attempt in §3.4), 422 if the new password is too short. The caller's own session gets a fresh cookie and stays logged in; bearer clients log in again.
- Passwords need at least 10 characters for register, `create-user` and the password change, and at most 1024 everywhere including login, so a request can't make hashing arbitrarily slow. Existing passwords are not checked.
- `python -m app.cli set-password EMAIL` resets a forgotten password, since there is no email flow.

### 3.4 Login throttling

In-memory sliding window in `app/throttle.py`, with an injectable clock for tests:

- 5 failures per email in 15 minutes, and 20 failures per client IP in 15 minutes. Past either limit, login returns `429` with `Retry-After`. The password is not checked while blocked, so a correct guess can't be detected.
- A successful login clears the email's counter.
- It also applies to the current-password check in `/auth/password`.

The client IP comes from the request, so the proxy setup has to be right:

- nginx sets `X-Forwarded-For $remote_addr` (overwritten, not appended), so clients can't fake it.
- uvicorn runs with `--proxy-headers --forwarded-allow-ips='*'`. That is safe only because §3.1 stops publishing the backend.
- Users with their own reverse proxy in front of nginx set `TRUSTED_PROXIES`. A startup script in the frontend image (`real-ip.sh`) turns it into `set_real_ip_from` lines, so `$remote_addr` becomes the real client. Without it, all requests share the proxy's bucket and 20 failures block logins for everyone.

The counters live in process memory: they reset when the backend restarts and assume one worker, which is what the image runs today. The design notes this so adding `--workers` later forces a revisit.

### 3.5 Backend as non-root

- The Dockerfile creates `app` (uid/gid 1000) and switches to `USER app`. `/opt/venv` and `/app` stay owned by root and read-only for the app.
- The photo directory's ownership is fixed automatically, with no manual `chown`. The backend image's entrypoint (`fix-permissions.sh`) starts as root, hands `UPLOAD_DIR` to `PUID:PGID` (default 1000:1000), then `exec setpriv`s to that user, so the server never runs as root. It changes only entries owned by someone else (later starts touch nothing), uses `chown -h` so symlinks never redirect it, and refuses `PUID`/`PGID` 0 or non-numeric. Without a command it only fixes the directory (`restore.sh` uses that); started unprivileged (`--user`) it skips the fix.
- `docker compose exec` bypasses the entrypoint and runs as root, so `app.cli` drops to `PUID:PGID` itself when it starts as root inside the image; otherwise `backfill-derivatives` would write root-owned files.
- A first version used a one-shot compose service (`permissions`) instead, which left an exited container in `docker compose ps -a`; the entrypoint replaced it.
- The backend still fails at startup with a clear message if `UPLOAD_DIR` isn't writable (for `docker run` without compose), instead of failing on the first upload.
- The backend gets a compose healthcheck on `/health`, and the frontend waits for it to be healthy.
- The frontend switches to `nginxinc/nginx-unprivileged` (D7), which runs as `nginx` (uid 101) and listens on 8080.

### 3.6 Settings documentation

- One table in CONTRIBUTING → Settings covering every `Settings` field, the compose-only variables (`BIND_ADDRESS`, `HTTP_PORT`, `TRUSTED_PROXIES`, `CLIENT_MAX_BODY_SIZE`) and the Vite `API_URL`.
- `.env.example` lists all of them, the optional ones commented out.
- A test parses `Settings.model_fields` and fails if a field is missing from CONTRIBUTING or `.env.example`, so the docs can't drift again.

## 4. Tests (backend, 100% gate stays)

- **Validator:** short key, `change-me` key, `change-me` password, valid values.
- **Password change:** success with a new cookie, the old token rejected afterwards, wrong current password, too-short new password, unauthenticated request.
- **Token check:** a token with an old `ver` gets 401, a malformed `ver` or `sub` gets 401, a token without `ver` works until the version is bumped.
- **Startup:** an unwritable `UPLOAD_DIR` stops the lifespan with the `chown` hint. `fix-permissions` is covered by the `deploy` CI job (§6).
- **Throttle:** per email, per IP, `Retry-After`, a success resets the counter, the window slides (fake clock), blocked attempts don't check the password.
- **CLI:** `set-password`, plus the minimum length in `create-user`.
- **Migration:** 0012 upgrades and downgrades, and `alembic check` passes.
- **Docs guard:** the test from §3.6.

---

# Part C: backup and restore

## 5. Design

There are two pieces of state, the `db-data` volume and the `UPLOAD_DIR` files. Photo files are written once under random names and never changed, which keeps backups simple: an extra file is harmless, a missing file is not.

`scripts/backup.sh [DEST]` (POSIX sh, runs on the host through `docker compose`) writes `birdography-YYYYmmdd-HHMMSS/` containing:

- `db.dump`: `pg_dump -Fc --no-owner --no-acl`, run inside the `db` container, so the client always matches the server version.
- `photos.tar`: `UPLOAD_DIR` without `.tmp/`. It is taken **after** the dump, so every file the dump references is in it. Files added in between are just extras.
- `manifest.json`: date, alembic revision, photo/file counts and the sha256 of both archives.

Options:

- `--db-only`, for large libraries whose photos are already backed up with restic, rsync or NAS snapshots. Since the files never change, incremental tools work well on them, and the docs recommend that setup above a few tens of GB.
- `--keep N` deletes older backups in `DEST`.

`scripts/restore.sh [--force] BACKUP_DIR`:

1. Checks the manifest hashes, and refuses a backup whose schema revision the image's migrations don't know (`alembic show`), meaning it comes from a newer version.
2. Refuses to replace an install that has accounts unless `--force` is passed.
3. Restores into a side database `<db>_restore` (`--exit-on-error --single-transaction`). Only when that succeeds does it stop `backend`, drop the live database and rename the side one. A broken dump changes nothing.
4. Moves the current photo files to `.pre-restore-<date>/` inside the photo directory (never deleted; dot directories are ignored by `verify-files` and backups), unpacks the archive as root and runs `fix-permissions`.
5. Starts `backend`, whose own `alembic upgrade head` brings an older backup up to the current schema, waits for `/health`, restarts the frontend (nginx resolves the backend once, at its start) and runs `verify-files`.

The scripts use only `exec`, `run --rm --no-deps`, `stop`, `start` and `restart`, never `up`. That way they don't re-apply compose files: a production stack started with `-f docker-compose.yml` doesn't pick up the dev override because of a restore. `COMPOSE` overrides the command (project name, files).

`python -m app.cli verify-files [--checksums]` reports `photo_files` rows whose file is missing or has the wrong size (or hash) and exits 1 for them. Files no row references are listed but don't fail it. It checks a restore and is useful on its own too.

Scheduling the backup (cron, systemd timer) is up to the user and documented in the README. The in-Docker scheduler stays with the Phase 4 `purge-trash` item.

## 6. Tests

- `verify-files` gets backend unit tests (100% gate).
- A new CI job `deploy`:
  1. shellcheck on every shell script.
  2. `docker compose -f docker-compose.yml up --build --wait` with generated secrets and a photo directory owned by the runner (uid 1001), which `permissions` must hand over.
  3. Only the UI is published, and the backend runs as uid 1000.
  4. Create a user and upload a fixture through nginx.
  5. `backup.sh`, then `docker compose down -v` and delete the photos.
  6. `restore.sh` (which runs `verify-files`), then log in and compare the downloaded original with the fixture byte for byte.

---

# Part D: frontend tooling

## 7. Design

**Linting: oxlint instead of ESLint (D1).** typescript-eslint can't load TypeScript 7 (§1). [oxlint](https://oxc.rs/docs/guide/usage/linter) can: its type-aware rules run through `oxlint-tsgolint`, which is built on typescript-go, the TS 7 compiler (its release numbers follow TS 7, currently 7.0.2006). So TypeScript stays at 7 and nothing needs TS 6.

- `.oxlintrc.json` turns on the `typescript`, `react`, `react-hooks`, `jsx-a11y` and `import` plugins plus the type-aware rules (`no-floating-promises`, `no-misused-promises` and others). It covers every file in `src/` and the config files.
- `npm run lint` runs `oxlint --type-aware --deny-warnings`, and CI runs it. Existing findings are fixed in the same PR. Formatting stays with Prettier.
- Fallback, only if §10.1 fails: ESLint with typescript-eslint, with TS 6.0 installed next to TS 7 and loaded only by ESLint.

**Unit tests.** Vitest with jsdom, `@testing-library/react`, `@testing-library/user-event` and `@vitest/coverage-v8`. The `test` script runs `vitest run --coverage`. Thresholds are 100% for lines, branches, functions and statements over `src/**`, matching the backend gate.

- `main.tsx` is excluded (it only mounts the router). The router config moves to `routes.tsx`, which is tested.
- `fetch` is mocked at the `api()` boundary.
- react-leaflet does **not** render usefully in jsdom (no layout, no SVG geometry, no canvas), so component tests replace it with `src/test/leaflet.tsx`. Markers become elements carrying their position, and `clickMap()` fires the click handler. The clustering logic (§8b) is a pure module, so it's tested without a map.
- CI order: format check, lint, test, build.

---

# Part E: session expiration and account page

## 8a. Design

**Sliding session window (D4).** A session lasts as long as it is used:

- `SESSION_DAYS` (default 30) becomes the idle limit: a session ends after that many days without a request.
- A new `SESSION_MAX_DAYS` (default 90) caps the total, counted from the login (an `auth_time` claim that renewal copies over). After it the user logs in again even if active, so a stolen cookie doesn't stay valid forever.
- `get_current_user` re-issues the cookie with a fresh `exp` (now + `SESSION_DAYS`, capped at `auth_time` + `SESSION_MAX_DAYS`) once the token is more than a day old. At most one `Set-Cookie` per day per session, not one per request.
- Bearer tokens are not renewed (the client never sees the new value). They expire at their original `exp`.
- Renewal keeps `ver`, so a password change still ends every session (§3.3).

**Frontend:**

- Login and `GET /auth/me` return `expires_at`, which moves forward as the session is renewed.
- In `api()`, any 401 except from `/auth/login` and `/auth/password` emits a `session-expired` event. `Layout` listens for it and navigates to `/login?expired=1&next=<path>`, where Login shows "Your session expired, log in again" and returns to `next` afterwards. `next` only accepts same-site paths starting with `/`, not `//`.
- `Layout` also sets a timer for `expires_at`, re-armed whenever a response brings a later one, and does the same redirect when it fires, so an idle tab doesn't sit on stale data.
- Changing the password elsewhere ends this session at the next request, because of §3.3.
- A new `/account` page (linked from the header email) holds the password change form: current password, new password and repeat, with the 400/422/429 messages shown.

None of this needs server-side session state.

---

# Part F: map aggregation

## 8b. Design

Clustering like a store locator: nearby markers merge into one bubble showing a count. Clicking the bubble zooms in until it splits.

**Backend.** `GET /photos/points` returns `[{id, lat, lon}]` for every located, non-trashed photo of the user. It has no limit and accepts the same filters as `GET /photos` (species, camera, dates). It selects only those three columns, about 40 bytes per photo in JSON, so 50 000 photos come to about 2 MB before gzip. nginx turns on `gzip` for `application/json`.

**Frontend.** [supercluster](https://github.com/mapbox/supercluster) (ISC, about 8 kB, no Leaflet coupling) builds the index once per fetch. On `moveend` the page renders `getClusters(bbox, zoom)`:

- Clusters are `Marker`s with a `divIcon` showing the count, in three sizes by magnitude. Clicking one calls `flyTo` to `getClusterExpansionZoom`.
- Single photos keep today's circle and thumbnail popup.
- Photos at exactly the same spot never split, even at max zoom. At max zoom a cluster click therefore opens a popup with a scrollable grid of their thumbnails (`getLeaves`) instead of zooming.
- On the first load the map fits the bounds of all points, falling back to `DEFAULT_CENTER` when there are none.

Server-side clustering (PostGIS `ST_SnapToGrid` per zoom and bbox) was considered and rejected for now. It means a request on every pan and gives worse transitions. It only pays off past a few hundred thousand photos, and §11 keeps it as the upgrade path.

## 8c. Tests

- **Backend:** `/photos/points` returns only the owner's, located, non-trashed photos, applies the filters, and returns 401 without a session.
- **Frontend:** the cluster module (counts, expansion zoom, the same-spot case) and `MapPage` with a mocked API (cluster click zooms, same-spot popup, empty state).

---

# Part G: repository automation

## 8d. Dependabot

Confirmed (D5): the 48 h wait is for version updates; security updates stay immediate.

`.github/dependabot.yml` covers `uv` (`/backend`), `npm` (`/frontend`), `docker` (`/backend`, `/frontend`), `docker-compose` (`/`) and `github-actions` (`/`). Each runs weekly with `cooldown: default-days: 2`, so an update is only proposed once it has been public for 48 hours. That limits the damage from a hijacked release that gets yanked within hours. Minor and patch updates are grouped per ecosystem, one PR each.

Security updates are not configured in this file. They are switched on in the repository settings (Dependabot alerts and security updates), and the plan includes that step (`gh api -X PUT repos/MatiasN/Birdography/automated-security-fixes`). GitHub documents that `cooldown` does not delay security updates, which is what D5 asks for.

## 8e. Docker images

New workflow `.github/workflows/images.yml`:

- **Pull requests:** build both images for `linux/amd64` without pushing, so Dockerfile breakage shows up before merge.
- **`main` and `v*` tags:** build for `linux/amd64` and `linux/arm64` (Raspberry Pi and NAS installs), push to `ghcr.io/matiasn/birdography-backend` and `-frontend` tagged `sha-<short>`, `main` / `latest` or the version, with build-cache through GitHub Actions cache and provenance attestation.
- `docker-compose.yml` gets `image: ghcr.io/matiasn/birdography-…:${BIRDOGRAPHY_VERSION:-latest}` next to the existing `build:`. Users can then run `docker compose pull` instead of building, and `--build` keeps working for development.
- The README quick start shows both ways.

The backend image installs ExifTool from a pinned tarball. §10.4 checks that it and pillow-heif work on arm64.

---

## 9. Decisions (confirmed 2026-11-11)

| # | Question | Decision |
|---|----------|----------|
| D1 | Linting with TypeScript 7 | oxlint with type-aware rules (oxlint-tsgolint, built on TS 7). ESLint plus TS 6 only if oxlint falls short (§10.1). |
| D2 | Frontend bind address default | `0.0.0.0`, reachable from other devices on the network. `127.0.0.1` is opt-in. The database and backend are not published. |
| D3 | Throttle storage | In memory: resets on restart, assumes one worker. |
| D4 | Session model | Sliding window: `SESSION_DAYS` idle limit, `SESSION_MAX_DAYS` absolute cap (§8a). |
| D5 | Dependabot 48 h | Cooldown of 2 days on version updates. Security updates stay immediate. |
| D6 | Photos in backups | Full `photos.tar` by default, `--db-only` plus restic/rsync documented for big libraries. |
| D7 | Frontend nginx as non-root | Yes, done with Part B (`nginx-unprivileged`, port 8080). |
| D8 | Account page in Part E | Yes. |

## 10. Pre-implementation checks

1. ~~**oxlint with TS 7**~~ (passed, 2026-11-11: a deliberate floating promise is reported by `typescript(no-floating-promises)` with TypeScript 7.0.2 and oxlint-tsgolint 7.0.2006): `oxlint --type-aware` runs against this `tsconfig.json` with TypeScript 7.0.2 installed, and the type-aware rules report findings (try a deliberate floating promise).
2. ~~**Restore round trip**~~ (done with Part C, it works): `pg_restore` of a `--no-owner` dump into a database recreated in the `postgis/postgis:17-3.5` container restores the PostGIS extension and geography columns without errors.
3. **Dependabot schema:** the ecosystems `uv` and `docker-compose` and the `cooldown` key are accepted (GitHub validates `dependabot.yml` on push, so open the PR and check the Insights → Dependency graph → Dependabot tab).
4. **arm64 image:** the backend image builds under QEMU, `exiftool -ver` runs, and pillow-heif has an arm64 wheel for CPython 3.14.
5. ~~Bind mount ownership~~ (done with Part B): Docker creates a missing host directory as root, which uid 1000 can't write. The backend now stops at startup with the `chown` command, and the README quick start runs `mkdir -p data/photos` first.

## 11. Implementation order

One PR per step. Each one passes CI on its own.

1. **A:** CI env fix. *Done.*
2. **B:** settings validation and docs, ports, non-root images, password change plus migration 0012, throttling, `set-password`. *Done, see §13.*
3. **C:** backup and restore scripts, `verify-files`, the `deploy` CI job. *Done, see §14.*
4. **D:** oxlint, Vitest, tests for the existing frontend up to 100%. *Done, see §15.*
5. **E:** sliding sessions, `expires_at`, session expiration handling, account page. *Done, see §16.*
6. **F:** `/photos/points`, clustered map. This ticks Phase 1 → Map with photo markers. *Done, see §17.*
7. **G:** `dependabot.yml` and enabling security updates. *Done, see §18.* The image workflow and `image:` in compose moved to the Phase 4 roadmap item.


## 12. Out of scope

- Revoking a single session on logout (needs a session table); password change revokes all sessions (§3.3).
- Account lockout as a nuisance: anyone can block one account's logins for 15 minutes with 5 wrong passwords. That is the price of the per-email limit, which is what stops a distributed guesser.
- Server-side map clustering (§8b), until point payloads get too big.
- Scheduled backups and `purge-trash` inside Docker (Phase 4).
- TLS termination. The docs point to a reverse proxy and `SECURE_COOKIES=true`.
- Security headers (CSP and others) in nginx. Worth a small follow-up.

## 13. Implementation notes (Parts A and B)

- **CI:** reproduced locally. With the old env and no `.env`, `alembic upgrade head` raises the same `postgres_db Field required`. With `POSTGRES_DB` and the 32+ character key, it migrates and `alembic check` passes.
- **Backend:** 208 tests pass, coverage 100%. New files are `app/throttle.py`, `tests/test_throttle.py` and `tests/test_config.py`. `test_config.py` holds the validator tests, the check that an unedited `.env.example` doesn't start, and the settings documentation guard.
- **Containers:** checked with `docker compose -f docker-compose.yml` in a throwaway project.
  - backend runs as `uid=1000(app)`, frontend as `uid=101(nginx)`
  - only the UI port is published
  - `/api/health` works through nginx
  - an ARW upload is stored as uid 1000
  - a password change keeps the caller's session
  - the 6th login is answered 429 with `Retry-After: 900`
  - a forged `X-Forwarded-For` reaches the backend replaced by the real peer address
  - `TRUSTED_PROXIES` renders valid nginx config and rejects anything that isn't an address or CIDR
  - a root-owned photo directory stops startup with the `chown` hint
  - the `.env.example` placeholders stop startup with the message from §3.2

## 14. Implementation notes (Part C, and the permissions follow-up)

- **Permissions** (first checked with the one-shot service, then again with the entrypoint): checked with a photo directory created by root, containing root-owned files, a root-owned `.tmp/` and a symlink to `/etc/passwd`.
  - The first start changed 5 entries to 1000:1000; the symlink itself changed, its target didn't.
  - A second start changed 0.
  - `PUID=1234 PGID=1234` runs the backend as 1234 and hands it the files.
  - `PUID=0`, `PUID=abc` and running the script as non-root exit 1 with a message.
- **Round trip** on a throwaway stack: account, a RAW and a CR3 photo (6 files), a location (PostGIS geography). Backup, then `down -v` and delete the photos, then `up` and restore.
  - Login works, both photos come back with all files, and the location is intact.
  - The downloaded ARW is byte-identical to the fixture.
  - `verify-files` reports 6 checked, 0 missing, 0 damaged, 0 unreferenced.
- **Refusals:** each checked once.
  - An install with accounts and no `--force` is refused.
  - A damaged `photos.tar` is refused.
  - A backup at an unknown revision (`0099`) is refused.
  - A truncated `db.dump` with a matching checksum fails at `pg_restore`, leaves the backend running and the data untouched, and removes the side database.
  - `--force` over a live install moved 6 files to `.pre-restore-*`.
  - `--db-only` writes `photos_sha256: null`, and its restore leaves the photo files alone.
  - `--keep 2` removed the oldest of three.
- **CI:** the `deploy` job was run locally by extracting its steps from `ci.yml` into a scratch copy of the repo (port 3999 instead of 3000), and it passed end to end. shellcheck finds nothing in the four scripts.
- **Dev stack note:** the local `oak` database had been migrated by another checkout's different "0012" (`users.password_changed_at`, the first draft of §3.3), so login returned 500. It was repaired in place, since the column was empty in every row. Two branches that number different migrations the same can do this to any shared dev database.
- The dev override's API port is now `API_PORT` (default 8000), so two checkouts can run side by side.

## 15. Implementation notes (Part D)

- **Lint:** oxlint 1.93 with `oxlint-tsgolint` 7.0.2006 and TypeScript 7.0.2. The first run on the existing code found 17 errors and 12 warnings, all fixed in code. No rule was disabled except allowing side-effect imports of CSS and jest-dom.
  - **Promises:** unhandled ones from `navigate()`, `load()` and `api().then()`, and async functions passed to `onClick`/`onSubmit`/`onChange`, now use `void`.
  - **Accessibility:** photo tiles were clickable `<figure>`s and are now `<button>`s. The detail overlay used click handlers on `<div>`s and is now a native `<dialog>` with a full-screen backdrop `<button>`. Checked in Chromium with Playwright: Tab reaches the tiles, Enter opens the dialog, Escape closes it, and both render as before.
  - **Hooks:** a missing effect dependency in `Photos` (`load`, now `useCallback`).
  - **Type safety:** `!` assertions replaced by a `position()` type guard, and `(e as Error)` by `instanceof`.
  - **API helpers:** `api<T>()` now always parses JSON, and the new `send()` handles 204 responses, so `undefined as T` is gone.
- **Behaviour changes:**
  - `ApiError` messages read FastAPI's 422 `detail` lists (`{msg}` items joined by `;`) instead of showing `[object Object]`. Part E's password form needs this.
  - The upload button shows the server's limits ("Up to 40 MB per photo, 70 MB for RAW"). It's useful to users, and it gives tests a visible signal that the limits loaded. Without it, the size-limit test raced the `/health` request and failed once under coverage.
- **Tests:** 50 Vitest tests over 7 files, 100% lines, branches, functions and statements. Run 5 times in a row under coverage with no failures and no `act()` warnings. One dead branch was found (`split(".").pop() ?? ""` can never fall back) and removed. `tsc` type-checks the tests too.
- **CI:** the frontend job runs format check, lint, test, build.
- **Local note:** `frontend/node_modules` was owned by root (created 2026-11-09), so npm couldn't install. It was handed back to uid 1000 with a root container, without deleting anything. The local Node is v22 while the project targets 24, so the work was done with `node:24` in Docker.
- **Permissions follow-up (Part B):** the one-shot `permissions` service became the backend image's entrypoint, so `ps -a` shows no exited container. The CLI drops to `PUID:PGID` when started as root through `docker compose exec`. Re-checked with the root-owned directory, a custom `PUID`, `PUID=0` and the backup/restore round trip.

## 16. Implementation notes (Part E)

- **Backend (sliding sessions, D4):** tokens carry `iat` and `auth_time`. `get_current_user` re-issues the cookie once the token is a day old, with `exp = min(now + SESSION_DAYS, auth_time + SESSION_MAX_DAYS)` (new setting, default 90); at the cap nothing is sent. Bearer tokens and pre-upgrade tokens (no `auth_time`) keep their original expiry. A renewed cookie keeps `ver`, so a password change still ends every session. Hand-made tokens with timestamps beyond the calendar clamp instead of crashing. `POST /auth/login` and `GET /auth/me` return `expires_at` (whole seconds, so both agree). 221 backend tests, 100%.
- **Frontend:** `api()` fires a `session-expired` window event on any 401 outside `/auth/login` and `/auth/password`. `Layout` listens and goes to `/login?expired=1&next=<path>`; it also re-checks `/auth/me` when `expires_at` arrives (timer capped at setTimeout's 2^31-1 ms), staying put if the session was renewed meanwhile. `Login` shows "Your session expired, log in again." and returns to `next`, accepting only same-site paths (`/x`, not `//host` or URLs). The header email links to the new `/account` page with the password form (client-side repeat check; 400/422/429 messages shown; the session continues via the fresh cookie). 70 frontend tests, 100% everywhere.
- **Checked in Chromium (Playwright) against the compose stack:** log in on two browsers, change the password on one — it stays logged in, the other is sent to the login page with the notice on its next click, and logging back in with the new password returns it to the page it was on (`next=/map`).
- The upload limits hint moved from beside the button to helper text below it (review feedback).

## 17. Implementation notes (Part F)

- **Request (2026-11-11):** every marker has a size; markers that overlap or are too close become one showing how many it joins; clicking it shows all its photos. Done with the current map library (Leaflet + react-leaflet) and supercluster, no plugin.
- **Backend:** `GET /photos/points` → `[{id, lat, lon}]`, owner's located non-trashed photos, newest first, no limit, same filters as the list (shared `PhotoFilters` dependency). Registered before `/{photo_id}`. nginx gzips JSON. 225 backend tests, 100%.
- **Clustering (`src/clusters.ts`):** `MARKER_PX` 40, `JOIN_PX` 60, `MAX_ZOOM` 19. supercluster with `extent: 256` so its radius is in Leaflet screen pixels (its default 512 halves it); `maxZoom` = the map's, so same-spot photos stay one group at the deepest zoom.
  - First browser run showed groups overlapping by up to 10 px: supercluster puts a group at the average of its photos, which drifts. A larger radius didn't remove it (30 px gap at one zoom with radius 60). Fix: a final pass over what is drawn, biggest first, joins anything with centres closer than `MARKER_PX` into the larger marker (keeping its position). Such a joined marker zooms one level in (distance doubles, so they part); at `MAX_ZOOM` it has no zoom button. A property test over 5 seeded random clouds × zooms 0–19 checks no overlap and every photo exactly once; with the pass disabled it fails (27.9 px at seed 4, zoom 14).
  - `extent()` uses a loop: `Math.min(...array)` overflows the stack around 100k+ points.
  - Known limit: markers straddling the antimeridian are not joined across it.
- **UI:** single photos are round thumbnails, drawn as a CSS background because Leaflet's CSS forces `width: auto` on marker images (they came out oval). Groups show the count (`1.2k` style). Clicking (or Enter/Space: Leaflet makes markers focusable but doesn't click them on Enter) a group opens `GroupPanel`: thumbnails newest first, 60 at a time, "Zoom in", "Close", Escape. A thumbnail or a single marker opens `PhotoDetail`; Escape closes the photo first, then the panel. Changing a photo's position there reloads the points without reframing. The first load frames all photos (`fitBounds`, max zoom 12); none shows "No photos with a position yet."
- **Checked in Chromium** against the compose stack with 70 photos (40 at one hide, 12 around it, Lisbon, Madrid, Sydney): world view `4` + `66`; following "Zoom in" down to the hide splits groups at every step and ends at the 40-photo same-spot group (no zoom button, 40 thumbnails); stepping out level by level, the closest marker centres were 44.6 px for 40 px markers; Enter on a focused group opens its panel.
- 104 frontend tests, 100% lines/branches/functions/statements; lint clean. `tsconfig` lib moved to ES2023 for `toSorted`.

## 18. Implementation notes (Part G)

- `.github/dependabot.yml`: weekly version updates for uv (`/backend`), npm (`/frontend`), docker (both Dockerfiles, via `directories`), docker-compose and github-actions, each with `cooldown: default-days: 2` (D5). Minor and patch bumps are grouped into one PR per ecosystem (uv, npm); majors and the single-dependency ecosystems come individually. Cooldown does not delay security updates, which is what D5 asked for.
- The file only configures *version* updates. Security updates are a repository setting; after merging, enable them once with: `gh api -X PUT repos/<owner>/Birdography/automated-security-fixes` (or Settings → Advanced Security → Dependabot security updates). §10.3's schema check (uv, docker-compose, `directories`, `cooldown`) happens on the first push: the Dependabot tab shows a parse error if any key is rejected; all four are documented in GitHub's docs as of 2026.
- Part G's second half (images built in CI, `image:` in compose) moved to Phase 4 of the roadmap as "Prebuilt Docker images" (user decision, 2026-11-11). The `deploy` CI job already builds both images on every PR, so Dockerfile breakage is still caught before merge.
