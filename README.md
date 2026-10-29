# Birdography

Self-hosted birding photography catalog with species information and map-based navigation. Built to complement tools like eBird and Merlin Bird ID: you own your photos, explore your sightings on a map, track the species you're still missing, and discover what's likely around you.

## Features

- **Photo catalog**: upload photos, with date, camera settings and GPS read automatically from EXIF.
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
| Deploy   | Docker Compose                |

## Quick start

> Early development: you can log in, upload photos and see them on a map.

```bash
git clone https://github.com/MatiasN/Birdography.git
cd Birdography
cp .env.example .env    # set POSTGRES_PASSWORD and SECRET_KEY
docker compose -f docker-compose.yml up -d --build
docker compose exec backend python -m app.cli create-user you@example.com
```

Open http://localhost:3000 and log in.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for running locally, migrations and tests.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
