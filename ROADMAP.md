# Roadmap

Where Birdography is heading. Each phase maps to a GitHub milestone, and each item should become an issue linked from here.

Plans can change. Ideas and feedback are welcome in [issues](https://github.com/MatiasN/Birdography/issues).

## Phase 1: Catalog & basic map

Photo handling, species data and a first look at the map.

- [x] Database schema (PostgreSQL + PostGIS), see [plan 0001](docs/plans/0001-phase1-database-schema.md):
  - photos with several files each (original, preview, later thumbnails) and camera settings as columns
  - several species per photo
  - species with English, Portuguese and scientific names, eBird code and taxonomic order
  - user override of the taken date, for misconfigured camera clocks
  - trash with 30-day retention for photos, locations, species and accounts; deleting a species or location unlinks its photos until restored
  - duplicate uploads rejected by content hash
  - naming convention for constraints and indexes, offline-capable Alembic, `alembic check` in CI
- [x] Photo upload API: JPEG, PNG, TIFF, HEIC, WebP and RAW (NEF, CR2, CR3, ARW, DNG, RAF, ORF, RW2, PEF); 40 MB limit, 70 MB for RAW; detection by content; RAW preview and thumbnails extracted with ExifTool, see [plan 0002](docs/plans/0002-phase1-photo-upload-api.md)
- [ ] Real RAW test fixtures: small, permissively licensed samples (NEF, CR3, ARW, DNG; e.g. CC0 files from raw.pixls.us) under `backend/tests/fixtures/raw/`, covering content detection of extension-less files, embedded preview extraction and the RAW upload limit
- [ ] EXIF extraction with ExifTool: GPS, local timestamp with offset, camera settings; offset derived from GPS position when the camera records none; RAW dimensions from `ImageWidth`/`ImageHeight`
- [ ] RAW+JPEG pairs uploaded as one photo (the camera JPEG becomes the preview)
- [ ] Photo catalog UI with filters by species, date and camera
- [ ] Map with photo markers

## Phase 2: Locations & species

Turn the catalog into a field guide.

- [ ] Group photos into location stops
- [ ] Stop detail: all species photographed at a stop
- [ ] Species page: photos and names in all three languages
- [ ] Location search
- [ ] "Close to me": species likely near your current position

## Phase 3: Gap tracking

Track what you still need to photograph.

- [ ] Regional checklists
- [ ] Missing species per location
- [ ] Life list and stats dashboard

## Phase 4: Integrations & polish

Make it fast and useful in the field.

- [ ] eBird CSV import/export; the import also fills `ebird_code` and `taxon_order` on species
- [ ] PWA: offline cache, install to home screen
- [ ] Full-text search across notes, tags, locations and names
- [ ] Compression and external storage (NAS, S3-compatible)
- [ ] Batch and resumable uploads: several files per request, chunked transfer for large RAW files
- [ ] Admin role: browse and restore everyone's trash, change upload limits from the UI instead of the environment
- [ ] Scheduled `purge-trash` inside Docker (compose sidecar or cron in the backend image) instead of a host cron job
