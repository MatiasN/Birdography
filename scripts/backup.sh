#!/bin/sh
# Back up a running Birdography install: the database and the photo files. See CONTRIBUTING.md → Backups.
set -eu

usage() {
    cat <<'EOF'
Usage: scripts/backup.sh [--db-only] [--keep N] [DEST]

Writes DEST/birdography-YYYYmmdd-HHMMSS/ (DEST defaults to ./backups) with:
  db.dump        the database (pg_dump custom format)
  photos.tar     every photo file, unless --db-only
  manifest.json  date, schema revision, counts and SHA-256 of both files

  --db-only   skip the photos, for libraries already backed up with restic, rsync or snapshots
  --keep N    afterwards, delete all but the newest N backups in DEST

The stack must be running. COMPOSE overrides the compose command (default: docker compose),
e.g. COMPOSE="docker compose -p birdography".
EOF
}

die() {
    echo "backup: $*" >&2
    exit 1
}

db_only=0
keep=0
dest=./backups
while [ $# -gt 0 ]; do
    case "$1" in
        --db-only) db_only=1 ;;
        --keep)
            [ $# -ge 2 ] || die "--keep needs a number"
            keep=$2
            shift
            ;;
        -h | --help) usage; exit 0 ;;
        -*) usage >&2; exit 2 ;;
        *) dest=$1 ;;
    esac
    shift
done
case "$keep" in '' | *[!0-9]*) die "--keep needs a number, got '$keep'" ;; esac

mkdir -p "$dest"
dest=$(cd "$dest" && pwd)
cd "$(dirname "$0")/.."  # the compose project, wherever this is called from
compose=${COMPOSE:-docker compose}

sha256() {
    if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# shellcheck disable=SC2016  # expanded inside the db container, from its own environment
sql() { $compose exec -T db sh -c 'psql -X -q -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$1"; }

sql "SELECT 1" >/dev/null 2>&1 || die "the database is not running; start the stack first (docker compose up -d)"
if [ "$db_only" = 0 ]; then
    $compose exec -T backend true 2>/dev/null || die "the backend is not running; start the stack first, or use --db-only"
fi

umask 077  # the dump holds password hashes
name="birdography-$(date -u +%Y%m%d-%H%M%S)"
work="$dest/.$name.partial"
mkdir "$work"
trap 'rm -rf -- "$work"' EXIT  # only a complete backup gets its final name

revision=$(sql "SELECT version_num FROM alembic_version")
photos=$(sql "SELECT count(*) FROM photos")
files=$(sql "SELECT count(*) FROM photo_files")

echo "Dumping the database (schema revision $revision, $photos photos)"
# shellcheck disable=SC2016
$compose exec -T db sh -c 'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' >"$work/db.dump"

# After the dump, so every file it refers to is in the archive; files uploaded meanwhile are harmless extras.
photos_sha=null
if [ "$db_only" = 0 ]; then
    echo "Archiving $files photo files"
    $compose exec -T backend tar -C /data/photos --exclude=./.tmp --exclude='./.pre-restore-*' -cf - . >"$work/photos.tar"
    photos_sha="\"$(sha256 "$work/photos.tar")\""
fi

cat >"$work/manifest.json" <<EOF
{
  "format": 1,
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "alembic_revision": "$revision",
  "photos": $photos,
  "photo_files": $files,
  "db_sha256": "$(sha256 "$work/db.dump")",
  "photos_sha256": $photos_sha
}
EOF

mv "$work" "$dest/$name"
trap - EXIT
echo "Backup written to $dest/$name ($(du -sh "$dest/$name" | cut -f1))"

if [ "$keep" -gt 0 ]; then
    # Names sort by date; only complete backups (no .partial) are considered.
    for dir in "$dest"/birdography-[0-9]*-[0-9]*; do
        [ -d "$dir" ] && printf '%s\n' "$dir"
    done | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r old; do
        rm -rf -- "$old"
        echo "Removed old backup $old"
    done
fi
