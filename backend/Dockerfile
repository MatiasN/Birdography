FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /bin/uv

ENV UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"
# ExifTool: type detection and RAW previews. Not pinned; the version shows in /health.
RUN apt-get update && apt-get install -y --no-install-recommends libimage-exiftool-perl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
