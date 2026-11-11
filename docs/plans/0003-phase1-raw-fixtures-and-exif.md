# Plan 0003: Phase 1 real RAW fixtures and EXIF extraction with ExifTool

Status: done (2026-11-11) · Roadmap items: [Phase 1 → Real RAW test fixtures, EXIF extraction with ExifTool](../../ROADMAP.md) · Date: 2026-11-11

> - Real RAW test fixtures: small, permissively licensed samples (NEF, CR3,
>   ARW, DNG; e.g. CC0 files from raw.pixls.us) under
>   `backend/tests/fixtures/raw/`, covering content detection of
>   extension-less files, embedded preview extraction and the RAW upload limit.
> - EXIF extraction with ExifTool: GPS, local timestamp with offset, camera
>   settings; offset derived from GPS position when the camera records none;
>   RAW dimensions from `ImageWidth`/`ImageHeight`.

Two roadmap items in one plan because the second is tested against the first.
Part A (fixtures) lands first; Part B (EXIF) builds on its files. Both reuse
the ExifTool wrapper from [plan 0002](0002-phase1-photo-upload-api.md) §2.4.

The checks in §7 were run while drafting (ExifTool 13.50, 2026-11-11). They
changed the plan: one detection bug, one fixture that wasn't what it claimed,
and a different rule for RAW dimensions than the roadmap wording suggests.

## 1. Current state

- RAW is exercised only through `FAKE_CR3` (`tests/test_upload.py`), a 24-byte
  `ftypcrx` header with nothing behind it, and through monkeypatched
  `exiftool.extract_preview` in `tests/test_derivatives.py`. The real preview
  path (ExifTool on an actual RAW) has never run in the suite.
- Plan 0002 §7.2 left open: "a real NEF *without* extension is reported as
  `NEF`". Now answered (§7.1): it depends on the camera.
- `app/exif.py` reads metadata with `exifread`. On the fixtures in §2 it
  reads nothing from the CR3 (0 tags, "File format not recognized"); the
  NEF, ARW, DNG and GPS JPEG read fine. `photos.exif` stores exifread's key
  style (`"EXIF DateTimeOriginal"`).
- `exif.parse(photo.exif)` is called by `PATCH /photos/{id}` (revert to the
  EXIF date) and by `cli.backfill_files` (camera settings for pre-0008 rows).
- RAW originals have `width/height = NULL` (plan 0002 §2.5).
- No offset is derived when the camera records none; `taken_at` is then the
  local time read as UTC.

---

# Part A: real RAW fixtures

## 2. Fixture set

Smallest CC0 samples from raw.pixls.us that embed a usable JPEG preview, all
verified against the published sha256 and run through `filetypes.detect` and
`exiftool.extract_preview` (§7.1). They are committed in shrunk form (§4); the
sizes below are the originals'.

| Key | Camera | Bytes | Detected | Preview | Taken (local) | Offset | GPS | Why |
|-----|--------|------:|----------|---------|---------------|--------|-----|-----|
| `nef` | Nikon Z5_2 | 6 174 720 | `nrw` ✗ → must be `nef` | 3984×2656 | 2025-04-27 17:57:05 | +02:00 | – | modern Nikon; exposes the NRW bug (§3) |
| `cr3` | Canon EOS R6 Mark III | 7 065 300 | `cr3` | 4320×2880 | 2026-01-22 15:41:52 | −08:00 | – | ISO-BMFF; exifread can't read it |
| `arw` | Sony ILCE-7S | 6 160 384 | `arw` | 1616×1080 | 2017-07-13 16:58:28 | – | – | TIFF family via ExifTool; no offset |
| `dng` | Canon EOS 5D Mark III, Adobe DNG Converter | 2 484 836 | `dng` | 3960×2640 (`JpgFromRaw`) | 2017-01-05 13:53:29 | – | – | the most common DNG source in practice |
| `jpeg_gps` (Part B) | Samsung SM-G973U | 1 318 208 | `jpeg` | n/a | 2020-04-02 18:19:31 | – | 37.3017, −78.3953 | listed as DNG on raw.pixls.us but really a JPEG; the only CC0 sample with GPS, used by Part B |

About 23 MB in total as downloaded, 5.8 MB once shrunk (§4). **No
original under 1 MB embeds a preview** (plan 0002 §4 hoped for one). The smallest files are scanners or pre-2005 bodies, and those embed no
JPEG preview: the Nikon D1H's only embedded image is a 160×120 uncompressed
TIFF thumbnail.

Rejected during the checks: Canon 5D Mark III DNG at 1.47 MB (no extractable
preview), Sony ILCE-7M5 ARW (works, but 11 MB), Nikon D40 NEF (works and
detects correctly, but redundant with the Z5_2).

## 3. Detection fix: Nikon Z NEF reported as NRW

ExifTool 13.50 reports the Z5_2 file as `NRW`, **with or without a `.nef`
extension**. The D40 NEF is reported as `NEF`. Newer Z bodies store a JPEG in
IFD0 (`Compression = JPEG (old-style)`), which looks like what ExifTool's
NEF/NRW heuristic keys on. Today such an upload is stored as
`format=nrw`, `image/x-nikon-nrw`, `<uuid>.nrw`: still RAW, so the limit and
preview are right, but the label is wrong.

Fix in `filetypes._tiff_family`: `exiftool.file_type` also returns `Model`;
an `NRW` answer is kept only when the model contains `COOLPIX` (NRW is the
Coolpix-only format), and is otherwise mapped to `nef`. The test asserts our
result (`nef`), not ExifTool's, because other versions may answer
differently.

## 4. Storage: shrunk files committed to the repository (decided)

The app reads headers, metadata and embedded JPEGs; it never decodes sensor
data, which is most of each file. The fixtures are therefore committed with
the sensor data removed, by `backend/tests/fixtures/raw/shrink.py`:

| File | Original | Shrunk | How |
|------|---------:|-------:|-----|
| `nikon_z5_2.nef` | 6 174 720 | 2 166 784 | cut at the CFA strip (`SubIFD1`) |
| `canon_eos_r6_mark_iii.cr3` | 7 065 300 | 1 919 053 | camera JPEG kept, CTMD moved behind it, `co64` and `mdat` size patched |
| `sony_ilce_7s.arw` | 6 160 384 | 881 152 | cut at the CFA strip (`SubIFD`) |
| `canon_eos_5d_mark_iii_adobe.dng` | 2 484 836 | 828 884 | cut at the first LinearRaw tile |

- **TIFF-based files** are cut where the first strip or tile of a CFA or
  LinearRaw IFD starts. The script refuses if any embedded JPEG or other
  strip extends past that point.
- **CR3**: a plain cut after the camera JPEG (first sample of `mdat`) loses
  the CTMD track, which comes last. That is 135 tags (white balance, AF,
  bracketing, temperature), and ExifTool then warns "Truncated 'mdat'". So the
  121 KB CTMD sample is moved directly behind the JPEG, its `co64` entry and
  the 64-bit `mdat` size are rewritten, and the two sensor tracks are left
  pointing past the end of the file. Canon writes `stsz` as a per-sample table
  for the image tracks and as a fixed size for CTMD; both forms are handled.
- **Verification, built into the script**: before writing, ExifTool must read
  the same tags from the shrunk file as from the original, ignoring only file
  size, `MediaDataSize` and the bitrate derived from it, and must report no
  new warnings. This passes for all four files. The output is deterministic
  and byte-identical to cuts made by hand while drafting.
- The script downloads the originals itself and checks the published
  sha256. It uses only the standard library and ExifTool, so it runs without
  the backend's environment. Nothing in the tests calls it.
- `.gitattributes` marks the four extensions `binary`. The Docker image
  copies only `app/` and `migrations/`, so it doesn't grow.
- Credits: a Credits section in the root README names raw.pixls.us and CC0.
  The fixture README lists each file's source.

## 5. Tests (Part A)

New `tests/test_raw_samples.py`, marked `exiftool`. The fixtures are
committed, so there is no extra marker. Expected values per file live in
`RAW_SAMPLES` in `conftest.py`, for Part B to extend:

- `detect()` on every sample copied to an extension-less path returns the
  expected format, `is_raw` and MIME. Copies with a misleading extension
  (`nef` saved as `.cr2`, `arw` as `.nef`) are still detected by content
  through the upload flow, which always detects on the extension-less temp
  file. The Z5_2 comes out as `nef` (§3).
- `exiftool.extract_preview` on each RAW: a JPEG with the dimensions in §2,
  `Orientation` present, and no `Make`/`Model`/GPS left.
- Upload through the API under an extension-less filename: 201; files
  `original` + `preview` + `thumbnail`; stored name ends with the canonical
  extension; thumbnail long edge ≤ 400 px.
- RAW upload limit with real files: with `MAX_UPLOAD_MB=1` and
  `MAX_RAW_UPLOAD_MB=2`, the CR3's own camera JPEG (1.2 MiB) → 413, the CR3
  (1.83 MiB) → 201, the NEF (2.07 MiB) → 413 mid-stream, with nothing left in
  `UPLOAD_DIR` (including `.tmp`).
- ExifTool still reads model and `DateTimeOriginal` from every shrunk file,
  with at most a `[Minor]` warning (the DNG has one in the original too).
- Background path with a real RAW (`BACKGROUND_DERIVATIVES_MB=0`); response
  has only `original`; the photo has three files afterwards.
- `backfill-derivatives` on a real RAW whose preview was deleted.

`FAKE_CR3` stays for what the real files don't cover: "RAW without an
embedded preview" and the size-limit tests that must run without the samples.
`test_derivatives.py`'s monkeypatched tests stay as unit tests.

Plan 0002 §7.2 gets a closing note pointing here.

---

# Part B: EXIF extraction with ExifTool

## 6. Design

### 6.1 Reading (`app/exif.py`)

`read(path)` becomes `parse(exiftool.metadata(path))`. `exiftool.metadata`
already returns `-j -n -G1` tags (`ExifIFD:DateTimeOriginal`,
`Composite:GPSLatitude`), numeric values unconverted. `parse(tags)` derives
everything from that dict alone, so `PATCH` revert and the CLI can rerun it
from `photos.exif` without the file.

| Field | Tags, first present wins |
|-------|--------------------------|
| `taken_at_local` | `ExifIFD:DateTimeOriginal`, then `ExifIFD:CreateDate` |
| `taken_offset_minutes` | `ExifIFD:OffsetTimeOriginal`, else derived from GPS (§6.2), else null |
| `camera` | `IFD0:Make` + `IFD0:Model` (existing `_camera` dedup) |
| `lens` | `ExifIFD:LensModel`, then any `*:LensModel` (maker notes) |
| `iso` | `ExifIFD:ISO` |
| `shutter_seconds` / `aperture` / `focal_length_mm` | `ExifIFD:ExposureTime` / `FNumber` / `FocalLength` (already floats with `-n`; same `Decimal` quantising) |
| `lat` / `lon` | `Composite:GPSLatitude` / `Composite:GPSLongitude`: already signed, and they cover EXIF, XMP and QuickTime GPS alike (verified on `jpeg_gps`) |
| `width` / `height` (RAW only) | §6.3 |

What goes into `photos.exif`: all tags except the `System:` and `ExifTool:`
groups. `System:` holds the temp file's name, directory, permissions and
timestamps. Measured sizes are 4–36 KB of JSON per photo; CR3 is the largest
(`Track*` groups) and still fine for JSONB.

Failure: `ExifToolError` (missing binary, timeout) is logged with the file
name and yields an empty result. The photo is still stored, as with garbage
EXIF today, and `reread-metadata` (§6.4) repairs it later. There is no
exifread fallback (§6.6 item 3).

### 6.2 Offset from GPS position

When `OffsetTimeOriginal` is absent but GPS and a local time are present:
`tzfpy.get_tz(lon, lat)` gives an IANA zone; then
`ZoneInfo(zone).utcoffset(local_time)` gives the offset, so DST is handled
by the date. For an ambiguous wall time at a DST fall-back, take `fold=0`
(the first occurrence). Offshore points come back as `Etc/GMT±N`, which is
fine.

Check from §7: `jpeg_gps` (Virginia, 2020-04-02) → `America/New_York` → −04:00
(EDT) → `taken_offset_minutes = -240`, and `taken_at` = 22:19:31 UTC.

Not using GPS date/time stamps (`GPSDateStamp`/`GPSTimeStamp`, UTC) to compute
the offset as `local − UTC`: that only works if the camera clock is right,
and a wrong camera clock is exactly the case the manual override exists for.
The zone of the position doesn't depend on the clock.

The source of the offset isn't stored. "From the camera" vs "from the
position" is derivable from `photos.exif` (is `ExifIFD:OffsetTimeOriginal`
there?), and a manual date is already flagged by `taken_at_manual`.

**Position chosen by the user (added 2026-11-11).** Many photos have no GPS at
all, so the user can place a photo on a map: `PATCH /photos/{id}` with `lat`
and `lon` (both or neither; nulls revert to the camera's GPS). That position
is stored in `photos.point` with a new `point_manual` flag (migration
`0011`), which `reread-metadata` respects like `taken_at_manual`, and the
offset is derived from it when the camera recorded none. Precedence, in
order: a date set by the user (untouched by position changes), the camera's
`OffsetTimeOriginal`, the time zone at the user's position, the time zone at
the camera's GPS, nothing. Frontend: clicking a photo in the grid opens a
detail view with a map; a click on the map proposes a spot, "Use this spot"
saves it, "Remove my position" reverts to the camera's. Photos without a
position are marked in the grid.

### 6.3 RAW dimensions

The roadmap says `ImageWidth/ImageHeight`, but on real files those include
sensor margins or describe IFD0's thumbnail. Measured values:

| Sample | `IFD0:ImageWidth` | `DefaultCropSize` | `ExifImageWidth` | `Composite:ImageSize` | Preview |
|--------|---|---|---|---|---|
| ARW ILCE-7M5 | – | 4608×3072 | 4608 | 4640×3088 | 4608×3072 |
| CR3 R6 III | – | – | 4320 | 4320×2880 | 4320×2880 |
| NEF D40 | **160** (thumbnail) | – | – | 3040×2014 | 3008×2000 |
| NEF Z5_2 | 4000 | – | – | 4000×2672 | 3984×2656 |
| ARW ILCE-7S (fixture) | – | – | 2768×1848 | 2816×1872 | 1616×1080 |
| DNG 5D III (fixture) | 256 (thumbnail) | 3960×2640 | – | 3960×2640 | 3960×2640 |

Rule, as implemented in `exif.raw_dimensions` (step 7):
1. `*:DefaultCropSize`, the DNG spec's visible area (also written by newer
   ARW), times `DefaultScale` from the same IFD when present (non-square
   pixels).
2. `Nikon:CropArea` (left, top, width, height). Added after measuring the
   Z5_2 fixture: it has neither of the other crop tags, and the fallback
   would give the 4000×2672 sensor size instead of 3984×2656.
3. `ExifIFD:ExifImageWidth/Height`.
4. `Composite:ImageSize`.

Zero, incomplete or non-numeric values fall through to the next rule. Same
convention as the Pillow dimensions for other formats: stored orientation,
not rotated. Set on the `original` `photo_files` row at upload. Non-RAW
keeps Pillow. Without ExifTool at upload they stay null, and
`reread-metadata` fills them for RAW originals.

### 6.4 Existing rows: `reread-metadata`

`photos.exif` switches key style, so rows stored with exifread keys don't
parse under the new rules. `python -m app.cli reread-metadata [--photo ID]`:

- reruns ExifTool on each original and rewrites `exif`, the camera columns,
  `point`, and RAW `width/height`;
- leaves `taken_at*` alone when `taken_at_manual` is true;
- is idempotent, and reports skipped rows (original missing, ExifTool error).

It replaces the camera-settings half of `backfill_files` (that half reads
exifread keys from pre-0008 rows). The hashing half stays. It is documented in
README as an upgrade step after deploying this change.

### 6.5 Dependencies

- Add `tzfpy` (Rust, abi3 wheels for manylinux x86_64 **and** aarch64, 3 MB,
  no dependencies; MIT, boundary data ODbL, credited in the README) and
  `tzdata` (so `zoneinfo` works even if the slim image lacks
  `/usr/share/zoneinfo`).
- Rejected: `timezonefinder`. It has no aarch64 wheel, and it pulls numpy,
  cffi and 33 MB of data.
- Remove `exifread` from runtime dependencies. `tests/test_upload.py` uses it
  to check that derived files carry no GPS; switch those checks to
  `exiftool.metadata`.

### 6.6 Decisions to take

Taken on 2026-11-11.

1. **Fixture storage**: shrunk real files committed to the repository (§4).
   Dropped: downloading on demand with a CI cache, and committing the full
   23 MB.
2. **Existing rows**: a one-time `reread-metadata` run after deploying, with
   no legacy parsing of exifread keys.
3. **No exifread fallback** when ExifTool is missing at runtime: the photo is
   stored with empty metadata, and `reread-metadata` is the repair tool for
   that case too (§6.4).
4. **Time zones from GPS**: `tzfpy` (§6.5). Its boundary data comes from
   timezone-boundary-builder, built from OpenStreetMap and licensed under
   ODbL. Step 6 adds that attribution to the README's Credits section.
5. **NRW rule**: `NRW` maps to `nef` unless the model is a Coolpix (§3).

## 7. Checks run while drafting (2026-11-11, ExifTool 13.50)

### 7.1 Fixtures and detection

Pulled the raw.pixls.us index (`json/getrepository.php?set=all`): 2 020
samples, 1 874 CC0. The smallest candidates per format were checked first
through their Exiv2 dumps, then downloaded (sha256 matched the index) and run
through `filetypes.detect` on extension-less copies and through
`exiftool.extract_preview`. Results are in §2 and §3. Plan 0002 §7.2's open
point is answered: a real D40 NEF without extension → `NEF`; a real Z5_2 NEF
→ `NRW`.

### 7.2 Metadata

- `Composite:GPSLatitude/Longitude` are signed with `-n -G1`.
- `ExifIFD:OffsetTimeOriginal` is present on the 2024+ bodies (Z5_2, R5 II,
  R6 III, A7 V) and absent on the A7S, D40 and both DNGs.
- No RAW sample has GPS. GPS tests on RAW write tags into a copy in
  `tmp_path` with ExifTool (`-GPSLatitude=… -GPSLatitudeRef=…`). The real
  GPS sample is the `jpeg_gps` JPEG.
- Python's `zoneinfo` gives −04:00 for New York on 2020-04-02 18:19:31.

### 7.3 ExifTool versions (checked 2026-11-11)

The concern was that CI's older ExifTool might not know what the fixtures
need, Nikon's `CropArea` (§6.3) in particular. The four fixtures, copied
without extension, were read in containers with the three versions in play:
12.76 (Ubuntu 24.04, CI so far), 13.25 (Debian trixie, the Docker image so
far) and 13.63 (latest). All three report **identical** values for every
tag the app reads: file type (all three call the Z5_2 `NRW`, which §3
corrects), model, `CropArea`, `DefaultCropSize`, EXIF image size, offset,
lens, ISO and date. Embedded previews were byte-identical too. So the risk
didn't materialise for these files.

Even so, CI and the image now install the same pinned release, 13.63,
from `backend/scripts/install_exiftool.py`. It downloads from SourceForge,
which keeps every release (exiftool.org serves only the latest), and checks
the published sha256. That removes the version skew between tests and
production, and gives newer cameras the newest maker-note support. ExifTool
runs on the slim image's `perl-base`; no extra packages are needed. This
supersedes plan 0002's "no version pin" decision. Verified by building the
image (13.63 on `PATH`, tzfpy importable) and by replaying the CI backend job
in `ubuntu:24.04` with Python 3.14: install step, `uv sync --frozen`, ruff,
`pytest --cov` (176 passed, none skipped, 100%), `alembic upgrade head` and
`alembic check`.

To upgrade: change `VERSION` and `SHA256` in the script, using the values
from https://exiftool.org/checksums.txt, then rerun the suite.
- `tzfpy` licence for the code. Its boundary data is ODbL
  (timezone-boundary-builder, from OpenStreetMap) and gets credited (§6.6
  item 4).
- `tzfpy` + `tzdata` install in `python:3.14-slim` on amd64 and arm64.

## 8. Tests (Part B)

`tests/test_exif.py` rewritten around ExifTool-style tag dicts, plus fixture
tests marked `exiftool` + `raw_samples`:

- `parse()` field mapping and precedence (synthetic dicts): `CreateDate`
  fallback, `LensModel` fallback, malformed values → None (keeps today's
  cases).
- Each RAW fixture: camera, lens, ISO, shutter, aperture, focal length,
  local time and offset match the values ExifTool prints (pinned per sample);
  RAW `width/height` follow §6.3.
- CR3: metadata present (regression for exifread reading nothing).
- `jpeg_gps`: point set; offset −240 derived from position; `taken_at` in UTC
  correct.
- Offset from the camera wins over GPS (Z5_2 copy with GPS written in,
  +02:00 kept).
- A DST-boundary case: synthetic tags, Lisbon, the ambiguous hour in
  October → `fold=0`.
- `photos.exif` contains no `System:`/`ExifTool:` keys and no temp-file
  name.
- ExifTool missing at upload: 201, metadata empty, warning logged.
- `PATCH taken_at_local: null` reverts using the new keys, including the
  GPS-derived offset.
- `reread-metadata`: fills legacy rows, respects `taken_at_manual`,
  idempotent, `--photo` limits scope.
- Existing upload tests built on `make_jpeg` keep passing unchanged (the
  JPEG tags map 1:1).

## 9. Implementation order

Each step is a separately reviewable commit.

**Part A**

1. ✔ `shrink.py`, the four shrunk fixtures, fixture README, `.gitattributes`,
   `RAW_SAMPLES` in `conftest.py`, README Credits, CONTRIBUTING note.
2. ✔ `file_type` returns `model`; NRW→NEF rule (§3); detection tests on all
   samples.
3. ✔ Preview, upload, limit, background and backfill tests on real files
   (§5). Plan 0002 §7.2 closed. The database-free tests pass locally (45);
   the full suite then passed against PostGIS (144 tests, 100% coverage) and
   the roadmap item is ticked.

**Part B**

4. ✔ Pre-checks in §7.3: ExifTool versions compared, and CI and the image
   now pin 13.63.
5. ✔ `exif.parse` on ExifTool tags, `read` via `exiftool.metadata`, tag
   filtering, failure handling. Tests. Also `exif.apply`, shared by the upload
   and `reread-metadata`. Zero apertures and focal lengths and Sony's `----`
   lens (manual lenses) read as unknown.
6. ✔ GPS-derived offset (`tzfpy`, `tzdata`, `app/timezones.py`), ODbL
   attribution in README Credits, user-chosen position with `point_manual`
   (migration `0011`) and the map picker in the frontend. Tests. The
   `jpeg_gps` sample was **not** added: it turned out to be a phone JPEG
   carrying DNG tags and a misreported file type, not a representative file.
   The derivation is tested with generated GPS JPEGs and by placing the real
   ARW (no camera offset) and NEF (camera offset kept) on the map.
7. ✔ RAW dimensions at upload and in `reread-metadata` (§6.3). Tests: the
   rule's precedence and fallbacks with synthetic tags, each fixture's size
   through `read` and through the upload API, reread filling nulled
   dimensions, and an upload without ExifTool.
8. ✔ `reread-metadata` (done with step 5, since the key change needs it),
   slimmed `backfill_files`, `exifread` removed from dependencies and tests.
9. ✔ Docs (CONTRIBUTING Metadata section), roadmap item ticked.

## 10. Out of scope

- RAW+JPEG pairs as one photo (next Phase 1 item; it will reuse these
  fixtures).
- Showing in the UI where the offset came from (the position's source is shown).
- A persistent `-stay_open` ExifTool process (plan 0002 §2.4).
