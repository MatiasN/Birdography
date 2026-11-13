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
- [x] Real RAW test fixtures: CC0 samples from raw.pixls.us (NEF, CR3, ARW, DNG) under `backend/tests/fixtures/raw/`, shrunk to their metadata and embedded JPEGs; they cover content detection of extension-less files, embedded preview extraction and the RAW upload limit, see [plan 0003](docs/plans/0003-phase1-raw-fixtures-and-exif.md)
- [x] EXIF extraction with ExifTool: GPS, local timestamp with offset, camera settings; offset derived from the GPS position (or a spot chosen on the map) when the camera records none; RAW dimensions from the crop tags rather than the sensor size, see [plan 0003](docs/plans/0003-phase1-raw-fixtures-and-exif.md)
- [x] RAW+JPEG pairs uploaded as one photo (the camera JPEG becomes the preview)
- [x] Photo catalog UI with filters by species, date and camera
- [x] Map with photo markers: every located photo, no 200-photo limit; nearby markers join into one showing how many photos it holds, and clicking it lists them, see [plan 0004](docs/plans/0004-phase1-hardening-before-phase2.md) Part F

## Phase 1.5: UI overhaul

A modern look that suits both desktop and phone, and the navigation the next phases fill in. Tabs whose features
arrive later get a placeholder saying what is coming, so the layout is settled before Phase 2 builds on it.

- [ ] Page designs: mockups of every tab (Catalogue, Species, Upload, Map, Near me) and the photo detail, each in a wide-screen and a narrow-screen version, agreed before building them
- [ ] Design foundation: a modern visual style (type, colors, spacing, light and dark themes) and a small set of shared components (buttons, cards, inputs, sheets, empty states) used by every page
- [ ] Adaptive layout: the UI follows the screen it is on; wide screens get a desktop layout (sidebar or top navigation, multi-column pages, details beside the list), narrow screens a phone layout (bottom tab bar, single column, details as full-screen sheets, large touch targets); tabs **Catalogue**, **Species**, **Upload**, **Map** and **Near me**; a profile page opened from the account menu (in the sidebar or top bar on wide screens, behind an avatar on phones) holding account settings and logout, with room for the stats added in Phase 3
- [ ] Catalogue tab: the current photo grid and filters in the new style, with room for the grouping added in Phase 2
- [ ] Upload tab: uploading moves out of the catalogue into its own tab; drag and drop or the phone's photo picker, progress per file, and species picked while uploading (search in all three languages, applied to the batch or to one photo, new species added on the spot)
- [ ] Map tab: unchanged apart from the new style
- [ ] Empty states: a new account with no photos sees what each tab does and how to start, not a blank page
- [ ] Polished README: a header with logo and badges (CI, license, latest release), screenshots of the new UI on desktop and phone (light and dark), a short feature tour, and a cleaner quick start; screenshots taken from the dev stack so they show real-looking data

## Phase 2: Locations & species

Turn the catalog into a field guide.

- [ ] Built-in species list: the eBird taxonomy loaded with English, Portuguese and scientific names, eBird code and taxonomic order, so the upload picker and the Species and Near me tabs know every species, not only the ones already photographed
- [ ] Regions for every photo: continent, country and region (state, district) worked out from its position, using eBird region codes so they match the checklists of Phase 3
- [ ] Group photos into location stops
- [ ] Catalogue grouping: group by location (continent, country or region, then stop) or by species
- [ ] Stop detail: all species photographed at a stop
- [ ] Species page: photos and names in all three languages
- [ ] Location search
- [ ] Near me tab: species likely around your position or a searched place (recent eBird observations; eBird API key in `.env`, results cached), each marked as photographed or not yet

## Phase 3: Gap tracking

Track what you still need to photograph.

- [ ] Regional checklists: the species expected in a continent, country or region (eBird region species lists)
- [ ] Species tab: pick a region and see the species you photographed there and the ones still missing
- [ ] "Feeling lucky?" in Near me: one species you have not photographed that you are most likely to find nearby now, ranked by how often it is reported in recent checklists close to you and in this season, with the nearest spot where it was seen
- [ ] Life list in the Species tab: with no region picked ("everywhere"), the tab lists every species you have photographed
- [ ] Stats on the profile page: totals at the top (species, photos, locations), progress over time, breakdown by family, most-photographed locations; account settings stay below

## Phase 4: Integrations & polish

Make it fast and useful in the field.

- [ ] eBird CSV import/export; the import also fills `ebird_code` and `taxon_order` on species, and brings in your checklist history so locations and target species are filled in
- [ ] PWA: offline cache, install to home screen
- [ ] Full-text search across notes, tags, locations and names
- [ ] Compression and external storage (NAS, S3-compatible)
- [ ] Batch and resumable uploads: several files per request, chunked transfer for large RAW files
- [ ] Admin role: browse and restore everyone's trash, change upload limits from the UI instead of the environment
- [ ] Scheduled `purge-trash` inside Docker (compose sidecar or cron in the backend image) instead of a host cron job
- [ ] Prebuilt Docker images: built and pushed to a registry by CI (amd64 and arm64), `image:` in docker-compose.yml so installs can `docker compose pull` instead of building
