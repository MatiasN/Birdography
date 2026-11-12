#!/bin/sh
# Restore a backup made by scripts/backup.sh into a running Birdography install. See CONTRIBUTING.md → Backups.
set -eu

usage() {
    cat <<'EOF'
Usage: scripts/restore.sh [--force] BACKUP_DIR

Replaces the database with the backup's and puts its photo files in place, then restarts the backend, which
migrates an older backup to the current schema, and checks the files (verify-files). A backup from an older
PostgreSQL (the 17 image used before November 2026) restores too: extensions its image installed that this one
no longer has (the tiger geocoder) are skipped, with a note; the app only needs postgis.

The stack must be running (on a new machine: docker compose up -d first). Without --force, an install that
already has accounts is left alone. With it, the current database is replaced and the current photo files are
moved to .pre-restore-<date>/ inside the photo directory; delete that once you have checked the result.

COMPOSE overrides the compose command (default: docker compose), e.g. COMPOSE="docker compose -p birdography".
EOF
}

die() {
    echo "restore: $*" >&2
    exit 1
}

force=0
src=
while [ $# -gt 0 ]; do
    case "$1" in
        --force) force=1 ;;
        -h | --help) usage; exit 0 ;;
        -*) usage >&2; exit 2 ;;
        *) [ -z "$src" ] || die "only one backup directory, please"; src=$1 ;;
    esac
    shift
done
[ -n "$src" ] || { usage >&2; exit 2; }
[ -d "$src" ] || die "$src is not a directory"
src=$(cd "$src" && pwd)
cd "$(dirname "$0")/.."
compose=${COMPOSE:-docker compose}

sha256() {
    if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
field() { sed -n "s/^ *\"$1\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}$/\1/p" "$src/manifest.json"; }

# shellcheck disable=SC2016  # expanded inside the db container, from its own environment
sql() { $compose exec -T db sh -c 'psql -X -q -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${2:-$POSTGRES_DB}" -c "$1"' sh "$@"; }

# 1. The backup is complete and intact.
if [ ! -f "$src/manifest.json" ] || [ ! -f "$src/db.dump" ]; then
    die "$src has no manifest.json or db.dump; not a backup?"
fi
[ "$(field format)" = 1 ] || die "unknown backup format in $src/manifest.json"
revision=$(field alembic_revision)
[ "$(sha256 "$src/db.dump")" = "$(field db_sha256)" ] || die "db.dump does not match its checksum; the backup is damaged"
photos_sha=$(field photos_sha256)
if [ "$photos_sha" = null ]; then
    has_photos=0
else
    [ -f "$src/photos.tar" ] || die "the manifest lists photos.tar but it is missing"
    [ "$(sha256 "$src/photos.tar")" = "$photos_sha" ] || die "photos.tar does not match its checksum; the backup is damaged"
    has_photos=1
fi
echo "Backup $(basename "$src"): $(field photos) photos, schema revision $revision, checksums OK"

# 2. This version can run it: a backup from a newer version has a revision these migrations don't know.
sql "SELECT 1" >/dev/null 2>&1 || die "the database is not running; start the stack first (docker compose up -d)"
$compose run --rm --no-deps -T --entrypoint alembic backend show "$revision" >/dev/null 2>&1 ||
    die "the backup is at schema revision $revision, which this version does not know; upgrade Birdography first"

# 3. Don't overwrite an install in use by accident.
if [ "$(sql "SELECT to_regclass('public.users') IS NOT NULL")" = t ]; then
    accounts=$(sql "SELECT count(*) FROM users")
    if [ "$accounts" -gt 0 ] && [ "$force" = 0 ]; then
        die "this install has $accounts account(s); run again with --force to replace it"
    fi
fi

# 4. Restore into a side database first, so a failure leaves the current one untouched.
#
# The dump lists every extension of the source database, not only postgis, which is all the app needs: the
# PostGIS 17 image installed postgis_tiger_geocoder (with fuzzystrmatch) and postgis_topology into every database,
# and PostGIS 3.7 dropped the geocoder, so a dump from 17 names an extension the 18 image cannot create. The
# dump's table of contents is therefore filtered first: extensions this server has are restored, each with the
# schema it is tied to (pg_available_extension_versions says which); the others are skipped together with their
# schemas and config-table data, and named. Everything in public, where the app's tables are, is always restored.
echo "Restoring the database"
# shellcheck disable=SC2016
$compose exec -T -e PGOPTIONS="-c client_min_messages=warning" db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_restore" &&
    createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore"'
# shellcheck disable=SC2016
if ! $compose exec -T db sh -c '
        set -eu
        trap "rm -f /tmp/restore.dump /tmp/restore.toc /tmp/restore.ext /tmp/restore.awk /tmp/restore.list" EXIT
        cat >/tmp/restore.dump
        pg_restore -l /tmp/restore.dump >/tmp/restore.toc
        psql -X -q -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -F " " \
            -c "SELECT DISTINCT name, coalesce(schema, chr(45)) FROM pg_available_extension_versions" >/tmp/restore.ext
        cat >/tmp/restore.awk <<"AWK"
# First file: extensions this server has, with the schema each is tied to (- for none). Second: the TOC, whose
# lines read "<id>; <catalog> <oid> <TYPE> <schema or -> <name> <owner>"; a line starting with ; is left out.
NR == FNR { available[$1] = $2; next }
{ line[++n] = $0 }
$4 == "EXTENSION" && $5 == "-" {
    if ($6 in available) { if (available[$6] != "-") schema_ok[available[$6]] = 1 } else dropped_ext[$6] = 1
}
$4 == "TABLE" && $5 != "DATA" { schema_ok[$5] = 1 }
END {
    schema_ok["public"] = 1
    for (i = 1; i <= n; i++) {
        split(line[i], f, " ")
        skip = 0
        if (f[4] == "EXTENSION" && f[5] == "-" && (f[6] in dropped_ext)) skip = 1
        else if (f[4] == "COMMENT" && f[6] == "EXTENSION" && (f[7] in dropped_ext)) skip = 1
        else if (f[4] == "SCHEMA" && f[5] == "-" && !(f[6] in schema_ok)) { skip = 1; dropped_schema[f[6]] = 1 }
        else if (f[4] == "COMMENT" && f[6] == "SCHEMA" && !(f[7] in schema_ok)) skip = 1
        else if (f[4] == "TABLE" && f[5] == "DATA" && !(f[6] in schema_ok)) skip = 1
        print (skip ? ";" : "") line[i]
    }
    for (e in dropped_ext) print "Skipping extension " e ": this PostGIS image does not have it (the app does not use it)" > "/dev/stderr"
    for (s in dropped_schema) print "Skipping schema " s " and its data: it belonged to a skipped extension" > "/dev/stderr"
}
AWK
        awk -f /tmp/restore.awk /tmp/restore.ext /tmp/restore.toc >/tmp/restore.list
        pg_restore --exit-on-error --single-transaction --no-owner --no-acl -L /tmp/restore.list \
            -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" /tmp/restore.dump' <"$src/db.dump"; then
    # shellcheck disable=SC2016
    $compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "${POSTGRES_DB}_restore"' || true
    die "pg_restore failed; nothing was changed"
fi

# 5. Swap it in, with the backend stopped.
$compose stop backend
# shellcheck disable=SC2016
$compose exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
    -c "ALTER DATABASE \"${POSTGRES_DB}_restore\" RENAME TO \"$POSTGRES_DB\""'

# 6. Photo files: whatever is there is moved aside (never deleted), then the archive is unpacked and handed to the
# backend's user. As root, so it works whatever the current ownership.
if [ "$has_photos" = 1 ]; then
    echo "Restoring the photo files"
    # shellcheck disable=SC2016
    $compose run --rm --no-deps -T --user 0:0 -e STAMP="$(date -u +%Y%m%d-%H%M%S)" --entrypoint sh backend -c '
        set -eu
        cd /data/photos
        if [ -n "$(ls -A | grep -v "^\.pre-restore-")" ]; then
            mkdir ".pre-restore-$STAMP"
            find . -mindepth 1 -maxdepth 1 ! -name ".pre-restore-*" -exec mv -t ".pre-restore-$STAMP" {} +
            echo "Current photo files moved to .pre-restore-$STAMP/ in the photo directory"
        fi
        tar -xf - --no-same-owner
        fix-permissions' <"$src/photos.tar"
else
    echo "Database-only backup: put the photo files back from your own file backup before using the app"
fi

# 7. Start the backend (migrating an older backup) and check the result.
$compose start backend
echo "Waiting for the backend"
tries=0
until $compose exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" \
    >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || die "the backend did not come up; see: $compose logs backend"
    sleep 2
done
$compose restart frontend >/dev/null  # nginx resolves the backend once, at its start

if $compose exec -T backend python -m app.cli verify-files; then
    echo "Restore complete"
else
    echo "Restore complete, but some files are missing or damaged (listed above)" >&2
    exit 1
fi
