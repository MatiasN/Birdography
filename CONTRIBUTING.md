# Contributing

## Requirements

- Docker with Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python 3.14 is installed by uv if missing)
- Node.js 24

## Project layout

```
backend/    FastAPI app, Alembic migrations, pytest suite
frontend/   React + Vite app
docker-compose.yml       db, backend, frontend
compose.override.yml     dev extras, loaded automatically (backend hot reload)
```

## Setup

```bash
cp .env.example .env
```

Set `POSTGRES_PASSWORD` and `SECRET_KEY` in `.env`. Generate a secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Running

### Everything in Docker

```bash
docker compose up -d --build
```

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:3000      |
| API      | http://localhost:8000/docs |

`compose.override.yml` is picked up automatically and reloads the backend on code changes. Use `docker compose -f docker-compose.yml up` to run without it.

### Frontend with hot reload

Run the database and backend in Docker, and the frontend with Vite:

```bash
docker compose up -d db backend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://localhost:8000` (override with `API_URL`).

### Backend outside Docker

```bash
docker compose up -d db
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

## First user

Registration is disabled by default. Create a user from the CLI:

```bash
docker compose exec backend python -m app.cli create-user you@example.com
# or, outside Docker
cd backend && uv run python -m app.cli create-user you@example.com
```

Set `ALLOW_REGISTRATION=true` to enable `POST /auth/register`.

## Migrations

Migrations run automatically when the backend container starts. To create one after changing `app/models.py`:

```bash
cd backend
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

Review the generated file before committing; autogenerate can get spatial (GiST) indexes wrong.

## Tests

Backend tests run against a real PostGIS database named `birdography_test`, created on first run:

```bash
docker compose up -d db
cd backend
uv run pytest
```

## Code style

```bash
cd backend && uv run ruff check --fix . && uv run ruff format .
cd frontend && npm run format
```

CI runs lint, format checks, backend tests and the frontend build on every push and pull request.
