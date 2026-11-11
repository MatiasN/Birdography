# Birdography

Self-hosted birding photography catalog with species information and map-based navigation. Built to complement tools like eBird and Merlin Bird ID: you own your photos, explore your sightings on a map, track the species you're still missing, and discover what's likely around you.

## Features

- **Photo catalog**: upload JPEG, PNG, TIFF, HEIC, WebP or RAW photos (NEF, CR2, CR3, ARW, DNG, RAF, ORF, RW2, PEF), with date, camera settings and GPS read automatically from EXIF. File types are detected from content; RAW and HEIC photos get a browser-viewable preview, and every photo a thumbnail. Previews and thumbnails carry no GPS or other metadata. Upload limits are 40 MB, 70 MB for RAW, both configurable. Deleted items stay in a trash for 30 days.
- **Where and when**: the time zone of each photo comes from the camera, or from the time zone at its position when the camera records none; photos without GPS can be placed on a map by hand, and that spot sets the time zone too.
- **Map**: browse every spot you've photographed and filter species by location.
- **Multi-language species**: English, Portuguese and scientific names.
- **Gap tracking**: see which species you still need to photograph in a region.
- **Close to me**: search a place or share your location to see species likely to be there.
- **Responsive**: works on a phone in the field and on a desktop.
- **Self-hosted**: runs locally or on your own server with Docker.

## Stack

| Layer    | Tech                          |
|----------|-------------------------------|
| Backend  | Python, FastAPI               |
| Database | PostgreSQL + PostGIS          |
| Frontend | React, Vite, Tailwind CSS     |
| Maps     | Leaflet                       |
| Images   | ExifTool, Pillow, pillow-heif |
| Deploy   | Docker Compose                |

## Quick start

> Early development: you can log in, upload photos and see them on a map.

```bash
git clone https://github.com/MatiasN/Birdography.git
cd Birdography
cp .env.example .env    # set POSTGRES_PASSWORD and SECRET_KEY, see below
docker compose -f docker-compose.yml up -d --build
docker compose exec backend python -m app.cli create-user you@example.com
```

Generate `POSTGRES_PASSWORD` and `SECRET_KEY` with `python -c "import secrets; print(secrets.token_urlsafe(32))"`; the backend does not start with the placeholders.

Open http://localhost:3000, or `http://<this machine's address>:3000` from another device, and log in. Only the web UI is published; the API is behind it at `/api/` and the database is not reachable from outside. Set `BIND_ADDRESS=127.0.0.1` to keep the UI to this machine. To serve it over HTTPS, put a reverse proxy in front and set `SECURE_COOKIES=true` and `TRUSTED_PROXIES`, see [Settings](CONTRIBUTING.md#settings).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for running locally, migrations and tests.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- Time zones from positions: [tzfpy](https://github.com/ringsaturn/tzfpy) (MIT), whose zone boundaries come from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder), built from [OpenStreetMap](https://www.openstreetmap.org/copyright) data © OpenStreetMap contributors, licensed under the [ODbL](https://opendatacommons.org/licenses/odbl/).
- RAW test fixtures: camera samples from [raw.pixls.us](https://raw.pixls.us/), dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Contributors are listed on each sample's page; the files used are in [backend/tests/fixtures/raw](backend/tests/fixtures/raw/README.md).

## License

[MIT](LICENSE)
