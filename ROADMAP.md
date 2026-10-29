# Roadmap

Where Birdography is heading. Each phase maps to a GitHub milestone, and each item should become an issue linked from here.

Plans can change. Ideas and feedback are welcome in [issues](https://github.com/MatiasN/Birdography/issues).

## Phase 1: Catalog & basic map

Photo handling, species data and a first look at the map.

- [ ] Database schema (PostgreSQL + PostGIS): photos, locations, species with English, Portuguese and scientific names
- [ ] Photo upload API (JPEG and RAW)
- [ ] EXIF extraction: GPS, timestamp, camera settings
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

- [ ] eBird CSV import/export
- [ ] PWA: offline cache, install to home screen
- [ ] Full-text search across notes, tags, locations and names
- [ ] Thumbnails, compression and external storage (NAS, S3-compatible)
