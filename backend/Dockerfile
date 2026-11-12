FROM python:3.15-slim
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

# Runs unprivileged as PUID:PGID; code and the venv stay root-owned and read-only to it. The entrypoint starts as
# root only to hand the photo mount to that user, then drops to it. `docker compose exec` bypasses it and runs as
# root: the CLI drops to PUID:PGID itself (app/cli.py).
COPY --chmod=755 fix-permissions.sh /usr/local/bin/fix-permissions
RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin app \
    && mkdir -p /data/photos && chown app:app /data/photos
ENV PUID=1000 PGID=1000 PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["fix-permissions"]

# nginx (frontend container) is the only client and sets X-Forwarded-For; trusting any sender is safe only because
# the backend port is not published (docker-compose.yml).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'"]
