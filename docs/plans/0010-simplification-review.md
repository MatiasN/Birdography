# Plan 0010: Simplification before Phase 2 continues

Status: frontend done (`c90044e`); backend §2 and §3 pending · Date: 2026-11-19

A review of the whole codebase (after plan 0009) for repeated code, dead code and needless complexity. The rules:
behaviour stays the same (exceptions are marked), and what the roadmap needs later stays. Nothing has been
deployed or used anywhere yet, so code that exists only to migrate or repair data from earlier versions counts
as dead (§3).

## 1. Frontend (applied first)

| # | Change | Kind |
|---|---|---|
| F1 | `errorText(problem, fallback)` in `api.ts`, used by every `catch` that turns an `ApiError` into a message | repeated |
| F2 | `<ErrorAlert message />`, rendering nothing without a message, replaces the 8 copies of the destructive alert | repeated |
| F3 | One `Segmented` control for `ThemePicker` and `NameLanguagePicker` (same classes, same Radix deselect guard) | repeated |
| F4 | One `Chip` for the Upload tab's and the filter bar's species pills | repeated |
| F5 | `<SpeciesNames species />` (name, other names below) for the photo detail, the picker and the profile example | repeated |
| F6 | `UploadsProvider`: one helper each for the preview URL and the size check | repeated |
| F7 | One `DATE_FORMAT` for `Profile` and `filters.ts` | repeated |
| F8 | One `OpenLink` in `Upload.tsx`, and the useless `<span>` around the done state | repeated |
| F9 | `hasFile` removed (only its test used it) | dead |
| F10 | `SidePanel` folded into `ResponsivePanel`; `closeOnEscape` (only a test set it) dropped | dead |
| F11 | `photoUrl` removed in favour of `fileUrl`; unused shadcn parts (`AlertDescription`, `Toggle`, unused button and badge variants) and their tests; stale `Layout.tsx` comment; exports nothing imports made local | dead |
| F12 | `UploadsProvider` fetches the upload limits itself, so `add`, `unpair` and `Row` no longer pass them around. **Changes behaviour slightly:** files queued before the limits arrive are checked when they do, instead of never | over-complicated |
| F13 | `Login` uses `errorText` like every other page. **Changes one message:** a network failure says "Could not log in" instead of the browser's "Failed to fetch" | inconsistent |
| F14 | `NameLanguagePicker` reads the user from `useLayout()`; `UploadBadge` is rendered only on the Upload tab | over-complicated |

Done when the frontend suite stays at 100% coverage, with lint, format and build passing.

## 2. Backend (from the review, not applied yet)

1. One helper to fetch a visible row or 404, instead of 8 copies (`photos`, `locations`, `species`, `cli`).
2. The merge checks live in `species.merge()`, so the endpoint and the CLI don't each repeat them.
3. `_store_companion` reuses `Derived` / `as_file` instead of repeating them.
4. One `try/except Rejected` in `ingest`, instead of removing the temp file before each of 4 rejections.
5. The seeder reuses `taxonomy.Entry` instead of `SampleSpecies`; it also calls `auth.restore_user` instead of redoing it.
6. Small dead parts:
   - `SPECIES_NAME_LANGUAGES` and `RESTORABLE["user"]`.
   - `exiftool.file_type`'s `extension` and `mime_type` fields.
   - In `storage.py`: `TooLarge.max_bytes`, the `max_bytes` argument of `save()`, and the duplicate `CHUNK`/`MB` constant.
7. The `taken_from` / `taken_to` photo filters (used only by a test).
8. `PhotoOut` drops `species_ids` (the same as `species`). **API change**, but the UI is the only client.
9. Small ones:
   - A one-argument `or_()`.
   - A redundant `and companion`, and the `companion[0]`/`[1]` tuple indexing.

## 3. Backend: code only for migrating earlier versions (listed 2026-11-19, decision pending)

Nothing has been deployed, so no database, backup or session token from an earlier version exists outside dev
stacks and CI.

| # | What | Where | Size |
|---|---|---|---|
| M1 | The 14 Alembic migrations squashed into one initial migration from the current models. This also drops the frozen `BRANDS` copy and camera data migration in 0013, the 0005 rename, the 0006 placeholder hashes and the data round-trip tests. **Every existing dev database needs `scripts/dev.sh reset`** (and the test DB a drop), since their revision ids disappear. | `migrations/versions/*`, `tests/test_migrations.py` (keep `test_models_match_migrations`) | ~700 lines |
| M2 | `backfill-files` (hash and size for photos from 0.1 / migration 0006), and `verify-files`' skip of `pending:` hashes | `cli.py`, `tests/test_cli.py` | ~45 lines |
| M3 | Restoring PostgreSQL 17 backups: the extension filter in `restore.sh`, the `backup-pg17` fixture, its CI step, and CONTRIBUTING's *Upgrading PostgreSQL* section. `dev.sh`'s "volume from an older PostgreSQL" message too | `scripts/restore.sh`, `scripts/fixtures/backup-pg17/`, `ci.yml`, `CONTRIBUTING.md`, `scripts/dev.sh` | ~120 lines + fixture |
| M4 | Session tokens without `ver` (issued before migration 0012) treated as version 0: require the claim | `auth.py:116` | 1 line |
| M5 | Comments and help texts naming upgrades that never happened: `reread-metadata`'s "old exifread reader" (the command stays, for photos uploaded without ExifTool and ExifTool upgrades), `check_upload_dir`'s "image that ran as root" | `cli.py`, `main.py` | wording |

Kept, as they serve installs from now on:
- `backfill-derivatives`, for lost background jobs.
- `reread-metadata`.
- `fix-permissions`, since Docker creates mount folders as root.
- `restore.sh`'s schema-revision check and migrate-on-restore, which future backups need.

## 4. Notes

- **Frontend (F1–F14), `c90044e`:**
  - 259 tests at 100%, with lint, format and build passing. The screenshot run passed end to end on the dev stack.
  - App code: +399 / −431 lines (net −32); the shared pieces cost some of what the duplicates saved.
  - F12 as applied: the queue fetches `/health` when the layout mounts, so the limits are known before any drop. There is no re-check of files queued earlier (simpler than planned, same effect in practice).
  - `SpeciesNames` truncates long names in the picker's options too.
