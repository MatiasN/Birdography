# Plan 0002: Phase 1 photo upload API

Status: done (2026-11-10; real RAW test fixtures added by [plan 0003](0003-phase1-raw-fixtures-and-exif.md)) · Roadmap item: [Phase 1 → Photo upload API](../../ROADMAP.md) · Date: 2026-11-10

> JPEG, PNG, TIFF, HEIC, WebP and RAW (NEF, CR2, CR3, ARW, DNG, RAF, ORF, RW2,
> PEF); 40 MB limit, 70 MB for RAW; detection by content; RAW preview and
> thumbnails extracted with ExifTool.

Builds on the schema from [plan 0001](0001-phase1-database-schema.md) (§2.1
`photo_files`, §6 decisions). The next roadmap item (EXIF extraction with
ExifTool) is kept separate: this plan introduces ExifTool for **type detection
and preview extraction only**; `app/exif.py` keeps reading metadata with
`exifread` until that item replaces it. Both items share the ExifTool wrapper
built here.

Decisions taken in the planning round are in §6; the pre-implementation checks
they require are in §7.

## 1. Current state

`POST /photos` (`backend/app/photos.py`) already:

- accepts one multipart `file`, streams it to disk while hashing
  (`storage.save`), rejects duplicate SHA-256 with 409 (pre-check + unique
  constraint), deletes the file if the commit fails;
- records an `original` `photo_files` row with format, MIME, `is_raw`, size,
  hash and Pillow dimensions for non-RAW files;
- `GET /photos/{id}/file?kind=` falls back thumbnail → preview → original.

Gaps:

| Gap | Effect |
|-----|--------|
| Type chosen from the **extension** (`FORMATS` dict) | A renamed file (`.jpg` that is really a PNG, or a text file named `.nef`) is accepted with the wrong format/MIME. |
| No size limit | Unbounded disk use; nginx allows 200 MB. |
| No `preview` for RAW | Grid and map fall back to the RAW original, which browsers can't render. |
| No `thumbnail` | The grid downloads full-size JPEGs. |
| HEIC not openable by Pillow | No dimensions, no thumbnail; browsers other than Safari can't display it. |
| ExifTool not installed | Neither in the Docker image nor in CI. |

## 2. Design

### 2.1 Request flow

One file per request (§6). Clients upload several photos with parallel
requests.

```
POST /photos (multipart "file")
 1. stream to temp file under UPLOAD_DIR/.tmp, hashing and counting bytes
    └─ abort with 413 as soon as size > MAX_RAW_UPLOAD_MB (absolute cap)
 2. detect type by content                        → 415 if unsupported
 3. apply per-type limit (MAX_UPLOAD_MB / MAX_RAW_UPLOAD_MB) → 413
 4. duplicate hash?                               → 409
 5. move temp file to final name <uuid>.<ext>   (ext from detected type)
 6. read metadata (exif.read, unchanged), insert photo + original file, commit
 7. derive files (preview, thumbnail), see §2.5
      size ≤ BACKGROUND_DERIVATIVES_MB → inline, before the response
      otherwise                        → FastAPI BackgroundTasks, after the 201
 8. on any failure before the commit: remove every file written, re-raise
```

Derived-file failures (corrupt RAW with no embedded preview, Pillow can't
decode) are **not** fatal: the photo keeps whatever files succeeded and the
file endpoint's fallback keeps working. They're logged with the photo id.
`python -m app.cli backfill-derivatives` (§2.6) retries them.

### 2.2 Type detection (`app/filetypes.py`, new)

Replaces the extension-keyed `FORMATS` with a content-based `detect(path) ->
FileType(format, mime, is_raw, ext)`:

1. **Magic bytes** for common formats, cheap and dependency-free:
   JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`, HEIF/HEIC
   `....ftypheic|heix|mif1|msf1`, CR3 `....ftypcrx `, RAF `FUJIFILMCCD-RAW`,
   ORF `IIRO`/`IIRS`, RW2 `IIU\0`.
2. **TIFF-based containers** (`II*\0` / `MM\0*`) — TIFF, DNG, NEF, NRW, CR2,
   ARW, PEF all share this header. Disambiguate with ExifTool's `FileType`
   (`exiftool -j -FileType -FileTypeExtension -MIMEType`), which inspects
   maker tags. CR2 can also be recognised by `CR` at offset 8.

   ExifTool may lean on the extension for some of these (§7.2 verifies).
   Guard: run it on a **copy or hard link without extension**
   (the temp file from step 1 has none), so its answer can only come from the
   content. If it still answers `TIFF` for a file whose maker tags say Nikon
   or Sony, treat the result as plain TIFF: a mis-detected RAW degrades to a
   TIFF preview and the 40 MB limit, never to a crash.
3. Anything else → 415 `Unsupported file type`.

The client filename's extension is **ignored** for the decision; it's kept in
`original_filename` only. If extension and content disagree we trust content
(no rejection), so a mis-named file still works.

The `FileType` table (format, MIME, is_raw, canonical ext) moves from
`photos.py` into this module; `photos.py` imports it.

### 2.3 Size limits

Set by the administrator through the environment, like every other setting
(`.env`, read by `app/config.py`), with the roadmap values as defaults:

| Setting | Default | |
|---------|---------|---|
| `MAX_UPLOAD_MB` | 40 | JPEG, PNG, TIFF, HEIC, WebP |
| `MAX_RAW_UPLOAD_MB` | 70 | RAW formats |
| `BACKGROUND_DERIVATIVES_MB` | 20 | above this size, previews and thumbnails are generated after the response (§2.5) |

`GET /health` (already public) reports `limits: {upload_mb, raw_upload_mb}`
so the frontend can refuse an oversized file before sending it and show the
configured value in its error message. A per-deployment settings table edited
from an admin UI is a follow-up to the admin role (plan 0001 §7); the env
settings are what it would override.

`storage.save` gains `max_bytes`; it raises `TooLarge` mid-stream once the
running count exceeds `MAX_RAW_UPLOAD_MB` (the type isn't known yet), deleting
the partial file. After detection, the photo router checks the real size
against the per-type limit. Both map to **413** with a message naming the
limit. `frontend/nginx.conf`: `client_max_body_size` becomes
`MAX_RAW_UPLOAD_MB + 5` MB (multipart overhead) instead of `200m`; since
nginx reads no `.env`, `docker-compose.yml` passes it to the frontend image
through an `envsubst` template (`nginx.conf.template`, supported by the
official image out of the box).

Upload to a temp path first (`UPLOAD_DIR/.tmp/<uuid>`) and `os.replace` into
place after detection, so the stored name carries the real extension and a
crash never leaves a half-written file under a final name. `purge-trash` also
sweeps `.tmp` files older than one hour.

### 2.4 ExifTool wrapper (`app/exiftool.py`, new)

Thin subprocess wrapper, shared with the next roadmap item:

- `version() -> str` — `exiftool -ver`, cached for the process lifetime;
  reported by `GET /health` as `exiftool: "13.10"` (or `null` when the binary
  is missing, which also logs a warning at startup).
- `file_type(path) -> dict` — `exiftool -j -n -FileType -FileTypeExtension -MIMEType`
- `extract_preview(path, dest) -> bool` — reads `JpgFromRaw`, `PreviewImage`,
  `OtherImage` and, as a last resort, `ThumbnailImage` in one `-j -b` call;
  picks the largest; writes it to `dest`. Then strips all metadata from the
  preview and copies only the orientation back from the RAW
  (`exiftool -all= -tagsfromfile <raw> -Orientation -overwrite_original <dest>`),
  so the preview is upright and carries no GPS (§6).
- `metadata(path) -> dict` — `-j -n -G1`, unused until the EXIF item.

Implementation notes: always pass the path after `--` and use argument lists
(no shell); timeout of 20 s per call; raise `ExifToolError` on non-zero exit
or timeout. Spawning per call is fine at personal-catalog volume; a persistent
`-stay_open` process is a later optimisation if needed. A setting
`EXIFTOOL_PATH` (default `exiftool`) allows non-PATH installs.

Versions: CI (Ubuntu 24.04) ships 12.76, the Debian trixie base of
`python:3.14-slim` ships 13.x. Both read every listed format, so nothing is
pinned; the version shows in `/health` and in the CI log (`exiftool -ver`
step) so a regression can be traced to a version change.

### 2.5 Derived files (`app/derivatives.py`, new)

- `make_preview(original, ftype) -> Saved | None`
  - RAW: `exiftool.extract_preview`.
  - HEIC/HEIF: decode with Pillow via `pillow-heif` and save as JPEG (quality
    90). Fallback if no wheel is available (§7.1): `heif-convert` from
    `libheif-examples`, called like ExifTool through a subprocess.
  - TIFF: browsers can't show TIFF either → JPEG preview (quality 90, max
    long edge 4096 px).
  - JPEG, PNG, WebP: none (the original is browser-viewable).
- `make_thumbnail(source) -> Saved | None` — Pillow, `ImageOps.exif_transpose`,
  `thumbnail((400, 400))`, JPEG quality 80, RGB conversion for PNG/WebP with
  alpha (flatten on white).
- **No metadata on derived files.** Pillow writes none unless asked, so
  previews and thumbnails are saved without `exif=`; the ExifTool preview is
  stripped in §2.4. Served previews and thumbnails therefore never carry GPS,
  serial numbers or the original timestamp. The original keeps everything.
- Both return the `storage.Saved` (name, size, sha256) plus width/height so the
  router can create `PhotoFile(kind="preview"|"thumbnail", is_raw=False,
  mime_type="image/jpeg", format="jpeg", original_filename=None)`.
- Set `Image.MAX_IMAGE_PIXELS` explicitly (e.g. 200 MP) so decompression bombs
  fail rather than exhaust memory; that failure is a derivative failure, not a
  rejected upload.

**Inline or background.** Files up to `BACKGROUND_DERIVATIVES_MB` are
processed before the response, so a normal JPEG upload returns with its
thumbnail in `files`. Larger files (in practice every RAW) return 201 right
after the commit with only the `original` entry; a `BackgroundTasks` job
generates preview and thumbnail in its own DB session and adds the
`photo_files` rows. The file endpoint's fallback already serves the original
in the meantime. The frontend re-fetches the photo once when the response
lacks a thumbnail (§2.7). A photo deleted while its job runs is handled by the
job checking `deleted_at` before writing; a job that dies with the process is
covered by `backfill-derivatives`.

**Hash uniqueness caveat:** `photo_files.sha256` is unique across all files.
Derived JPEGs are deterministic, so two uploads that are byte-different but
share an identical embedded preview would collide. Fix: scope the uniqueness
to originals with a partial unique index (`UNIQUE (sha256) WHERE kind =
'original'`) in migration `0010_original_hash_unique`, replacing
`uq_photo_files_sha256`. Duplicate detection only ever cares about originals.

Dimensions for RAW originals: the extracted preview is often smaller than the
sensor image, so its size can't be used. Leave `width/height` null for RAW
until the EXIF item fills them from `ImageWidth/ImageHeight` via ExifTool.

### 2.6 Backfill command

`python -m app.cli backfill-derivatives [--photo ID]`: for every photo without
a `preview` (when its type needs one) or `thumbnail`, generate the missing
files. Covers photos uploaded before this item, earlier derivative failures
and background jobs lost to a restart. Idempotent.

### 2.7 API surface

No breaking changes to `PhotoOut`; `files` now contains up to three entries,
and may contain only `original` right after a background upload.

| Status | When |
|--------|------|
| 201 | stored; body is `PhotoOut` |
| 400 | missing `file` field / empty file |
| 409 | duplicate original hash (unchanged) |
| 413 | over the per-type limit |
| 415 | content isn't a supported type (was 400 — update the test) |

`GET /health` adds `exiftool` (version string or null) and `limits`.

Frontend (`frontend/src/api.ts`, `pages/Photos.tsx`): request `thumbnail` in
the grid and map popups, `preview` in the detail view; check the size against
`/health` limits before uploading and show the 413/415 messages from the API
instead of a generic error; set the file input `accept` to the supported
extensions (convenience only, server stays authoritative); when an upload
response has no `thumbnail`, re-fetch that photo after a short delay (one
retry, then give up and keep the fallback).

## 3. Dependencies and packaging

- **ExifTool** in `backend/Dockerfile`: `apt-get install -y --no-install-recommends
  libimage-exiftool-perl` (13.x on trixie). No version pin (§2.4).
- **pillow-heif** in `pyproject.toml` (`uv add pillow-heif`), registered once
  with `pillow_heif.register_heif_opener()` at import of `derivatives.py`.
  Conditional on §7.1: if no wheel exists for CPython 3.14 on both
  `python:3.14-slim` (Debian, glibc, amd64 and arm64) and `ubuntu-latest`,
  choose between building it in the image (`libheif-dev`, `build-essential`
  in a builder stage, slow) and shelling out to `heif-convert`
  (`libheif-examples`, no Python dependency). The shell-out is the preferred
  fallback: it keeps the image small and matches how ExifTool is used.
- **CI** (`.github/workflows/ci.yml`): `sudo apt-get install -y
  libimage-exiftool-perl` (12.76 on Ubuntu 24.04) plus `libheif-examples` if
  the fallback is chosen, before `uv sync`; a step printing `exiftool -ver`.
- `.env.example`, README and CONTRIBUTING: ExifTool is required for local
  development outside Docker; document `MAX_UPLOAD_MB`, `MAX_RAW_UPLOAD_MB`,
  `BACKGROUND_DERIVATIVES_MB`, `EXIFTOOL_PATH` and `backfill-derivatives`.

## 4. Tests

Fixtures: small generated files are preferred over committed binaries.

- Generated with Pillow in `conftest.py`: JPEG (exists), PNG, WebP, TIFF,
  HEIC (via pillow-heif or `heif-convert`), a JPEG in CMYK mode.
- RAW: commit a few **tiny** real samples under `backend/tests/fixtures/raw/`
  (NEF, CR3, ARW, DNG; ideally < 1 MB each, permissively licensed, e.g. from
  raw.pixls.us — CC0). Tests needing ExifTool are marked
  `@pytest.mark.exiftool` and skipped when it isn't on PATH, so contributors
  without it can still run the suite; CI installs it so nothing is skipped
  there.
- Background jobs run synchronously under `TestClient`, so assertions on
  `files` after a large upload work without polling; one test sets
  `BACKGROUND_DERIVATIVES_MB` to 0 to force the background path.

Cases (`tests/test_upload.py`, new, plus adjustments in `test_photos.py`):

- each supported format is detected by content with the right `format`, MIME
  and `is_raw`, regardless of the uploaded filename
- a PNG named `.jpg` is stored as PNG; a text file named `.nef` → 415; a
  plain TIFF named `.nef` is stored as `tiff`, not `nef` (§7.2)
- stored name carries the detected extension
- limits read from settings: with `MAX_UPLOAD_MB=1`, a 1.5 MB JPEG → 413 while a
  1.5 MB RAW is accepted; over `MAX_RAW_UPLOAD_MB` → 413 and **no file left**
  in `UPLOAD_DIR` (including `.tmp`); `/health` reports the configured limits
- RAW upload produces `original` + `preview` + `thumbnail`; preview is a JPEG
  with correct orientation; thumbnail long edge ≤ 400 px
- JPEG upload produces `original` + `thumbnail` only; HEIC and TIFF produce a
  preview
- served preview and thumbnail of a RAW/JPEG with GPS contain **no** GPS or
  other EXIF tags (read back with exifread); the original still does
- background path: response has only `original`, the photo has all three
  files afterwards; deleting the photo before the job runs leaves no new rows
- corrupt RAW without embedded preview: 201, only `original`, file endpoint
  falls back to original
- DB failure after the original was written removes it; a derivative failure
  keeps the original
- two different originals with identical derived bytes both succeed (partial
  unique index)
- `backfill-derivatives` fills missing files and is idempotent
- migration `0010` round-trips (existing `test_migrations.py` pattern)
- `/health` includes the ExifTool version when installed

## 5. Implementation order

0. ✔ Pre-implementation checks (§7); results recorded in this file.
1. ✔ `filetypes.py` + content detection, router switched to it, 415 status.
   Tests.
2. ✔ Size limits enforced in `storage.save_temp`, temp-then-move, nginx
   template rendered from `CLIENT_MAX_BODY_SIZE`. Tests. (Settings and
   `/health` limits were done with step 3.)
3. ✔ Dockerfile/CI ExifTool, `exiftool.py` wrapper (`version`, `file_type`,
   `extract_preview`, `metadata`), `/health` with version and limits,
   `pillow-heif` dependency, settings `EXIFTOOL_PATH`, `MAX_UPLOAD_MB`,
   `MAX_RAW_UPLOAD_MB`. TIFF-family disambiguation itself lands with step 1,
   on top of `exiftool.file_type`.
4. ✔ Migration `0010_original_hash_unique` + model change; the duplicate
   pre-check in `POST /photos` only looks at originals.
5. ✔ `derivatives.py`: thumbnail for all, preview for RAW/HEIC/TIFF, metadata
   stripping, cleanup on failure, inline/background switch
   (`BACKGROUND_DERIVATIVES_MB`). `pillow-heif` per §7.1. Tests use generated
   images and a minimal CR3 header; **real RAW fixtures are still to be
   added** (see §4), so the RAW preview path is only covered at the ExifTool
   wrapper level.
6. ✔ `backfill-derivatives` CLI; `purge-trash` also sweeps stale temp files.
7. ✔ Frontend: size pre-check against `/health` limits, API error messages
   shown per file, `accept` from one extension list, re-fetch after a
   background upload. The grid already requested thumbnails.
8. ✔ Docs (README, CONTRIBUTING, `.env.example`), roadmap item ticked.

Each step is a separately reviewable commit/PR.

## 6. Decisions

Taken on 2026-11-10 after the first draft.

- **One file per request.** No batch upload and no RAW+JPEG pairing in this
  item; the client sends parallel requests. Pairing a RAW with its camera
  JPEG into one photo is a follow-up.
- **Background derivatives for large files.** Previews and thumbnails are
  generated inline up to `BACKGROUND_DERIVATIVES_MB` and in a background task
  above it (§2.5), so a RAW upload doesn't wait on extraction.
- **Strip GPS from served previews and thumbnails.** Derived files carry no
  metadata at all except orientation (§2.4, §2.5); the original is untouched.
  This holds now, while everything is private per user, and is what later
  sharing features rely on.
- **Upload limits are configurable by the administrator** through environment
  settings with the roadmap values as defaults, exposed by `/health` (§2.3).
- **No ExifTool version pin.** 12.76 in CI and 13.x in the image both cover
  the format list; the version is printed in `/health` and the CI log (§2.4).
  *Superseded on 2026-11-11 by [plan 0003](0003-phase1-raw-fixtures-and-exif.md)
  §7.3: CI and the image both install a pinned 13.63.*

## 7. Pre-implementation checks

To do before step 1, results noted here.

### 7.1 `pillow-heif` wheels for CPython 3.14

Check on PyPI that `pillow-heif` publishes `cp314` wheels (or `abi3` wheels
covering 3.14) for `manylinux` x86_64 and aarch64, then confirm on the actual
targets:

```sh
docker run --rm python:3.14-slim sh -c 'pip download --only-binary=:all: --no-deps pillow-heif -d /tmp/w && ls /tmp/w'
# and in a CI job on ubuntu-latest with setup-uv python 3.14:
uv pip install --only-binary=:all: pillow-heif
```

Outcome → §3: wheel on both → `uv add pillow-heif`. Otherwise prefer the
`heif-convert` shell-out; build from source only if `heif-convert` output
quality or availability is unacceptable.

Result (2026-11-10): **wheels exist.** `pillow-heif` 1.8.1 publishes
`cp314` wheels for `manylinux_2_28` x86_64 and aarch64 (plus musl and
free-threaded variants), bundling libheif 1.23.6. glibc 2.28 is covered by
`python:3.14-slim` (Debian trixie, 2.41) and `ubuntu-latest` (24.04, 2.39).
Installed with `uv pip install --only-binary=:all:` on CPython 3.14 and
round-tripped a generated HEIC to JPEG. Decision: `uv add pillow-heif`; no
`heif-convert` fallback needed. The Docker check on the image itself is still
worth a run when Docker is available, but the wheel tags leave no doubt.

### 7.2 ExifTool and the extension of TIFF-based RAW

Confirm that ExifTool identifies TIFF-family RAW from content and not from the
file name:

```sh
cp sample.tif renamed.nef && exiftool -FileType -FileTypeExtension -MIMEType renamed.nef
cp sample.nef noext      && exiftool -FileType -FileTypeExtension -MIMEType noext
```

Expected: the renamed TIFF reports `TIFF`, the extension-less NEF reports
`NEF`. If the renamed TIFF reports `NEF`, detection must always run on the
extension-less temp file (as §2.2 already prescribes) and the test "plain
TIFF named `.nef` is stored as `tiff`" becomes mandatory rather than
defensive.

Result (2026-11-10, ExifTool 13.50): **ExifTool trusts the extension.** A
Pillow-generated TIFF renamed `.nef` is reported as `NEF` /
`image/x-nikon-nef`; the same bytes without extension are reported as `TIFF`,
even with `Make = NIKON CORPORATION` (so the Make tag alone doesn't trigger a
false RAW positive). A JPEG renamed `.cr2` is correctly reported as `JPEG`:
the extension only matters inside the TIFF family. Consequences, now in
force: detection always runs on the extension-less temp file, and the test
"plain TIFF named `.nef` is stored as `tiff`" is mandatory.
`tests/test_exiftool.py` pins the observed behaviour so a future ExifTool
version that changes it is noticed. Not yet verified: that a real NEF
*without* extension is reported as `NEF`; this needs a RAW sample and is
covered by the fixture work in step 5.

Closed by [plan 0003](0003-phase1-raw-fixtures-and-exif.md) §3 (2026-11-11):
a real Nikon D40 NEF without extension is reported as `NEF`. A Nikon Z5_2 NEF
is reported as `NRW` with or without extension, so detection now maps `NRW`
to `nef` unless the model is a Coolpix.

## 8. Out of scope

All tracked in [ROADMAP.md](../../ROADMAP.md):

- Real RAW test fixtures (Phase 1).
- Switching `exif.read` to ExifTool, GPS-derived offsets, RAW dimensions
  (Phase 1, EXIF extraction item).
- RAW+JPEG pairing (Phase 1); batch and resumable uploads (Phase 4).
- Admin UI for the upload limits (Phase 4, admin role).
- Compression and external storage (Phase 4).
