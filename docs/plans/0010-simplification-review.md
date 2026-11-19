# Plan 0010: Simplification before Phase 2 continues

Status: frontend in progress · Date: 2026-11-19

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

## 3. Backend: code only for migrating earlier versions

Listed after the frontend is done (§4), for a decision before anything is removed.

## 4. Findings and notes

To be filled in as the work goes.
