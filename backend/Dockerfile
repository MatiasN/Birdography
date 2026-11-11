FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /bin/uv

ENV UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"
# ExifTool: type detection, RAW previews and all metadata. Pinned in the script, same version as CI; it runs
# on the image's perl-base. The version shows in /health.
COPY scripts/install_exiftool.py /tmp/
RUN python3 -I /tmp/install_exiftool.py && rm /tmp/install_exiftool.py
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
