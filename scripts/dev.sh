#!/usr/bin/env bash
# Disposable local Birdography with a known login and photos on the map. See CONTRIBUTING.md → Dev stack.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEV_DIR="$ROOT/.dev"
CONFIG="$DEV_DIR/config.env"
MARKER=.birdography-dev # in the data folder: proof that `reset` may empty it

usage() {
    cat <<'EOF'
Usage: scripts/dev.sh COMMAND [options]

Commands
  up                 start (building images), create the dev user, seed photos if it has none, print info
  seed               add photos to the dev user (one-off: flags are not saved)
  reset              delete the dev database and photos, then `up` again
  down [--volumes]   stop; --volumes also deletes the dev database (photos stay until `reset`)
  info               URLs, login and settings in use
  logs [SERVICE]     follow the logs
  anything else      passed to docker compose for the dev project, e.g. `scripts/dev.sh ps`

Options of up and reset (saved to .dev/config.env, so later runs keep them)
  --docker | --vite        whole stack in Docker (default), or the frontend with Vite hot reload
  --data-dir DIR           photo files (default .dev/photos)
  --http-port PORT         web UI, docker mode (default 3001)
  --api-port PORT          API and /docs (default 8001)
  --db-port PORT           PostgreSQL (default 5433)
  --vite-port PORT         Vite, vite mode (default 5174)
  --auto-ports             move any port that is taken to the next free one instead of stopping
  --user EMAIL             dev login (default dev@birdography.local)
  --password PASSWORD      at least 10 characters (default birdography-dev)
  --photos N               photos to seed into an empty account (default 300)
  --region NAME|BOX        portugal (default), iberia, europe, world, or lat1,lon1,lat2,lon2
  --hotspots N             spots photos gather around (default 15)
  --same-spot-pct N        % of photos exactly on a hotspot, which never split on the map (default 5)

Options of seed: --photos, --region, --hotspots, --same-spot-pct, and --replace to delete the dev user's
photos first. Everything else (bind address, project name, spread, years, image size, random seed, backend
settings) is set in .dev/config.env, which the first run creates.
EOF
}

die() {
    echo "dev: $*" >&2
    exit 1
}

# --- configuration -----------------------------------------------------------------------------------------------

# One dev stack per checkout: two worktrees sharing a project would recreate each other's containers with their
# own secrets. The main checkout (a folder called Birdography) gets plain birdography-dev.
default_project() {
    local name
    name=$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-' | sed -E 's/-+$//')
    if [ "$name" = birdography ]; then echo birdography-dev; else echo "birdography-dev-$name"; fi
}

random_hex() {
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

write_default_config() {
    mkdir -p "$DEV_DIR"
    cat >"$CONFIG" <<EOF
# scripts/dev.sh settings. Created on first run; not in git (.dev/ is ignored). Flags of \`up\` and \`reset\`
# are saved here. One KEY=value per line, no quotes or spaces. This is also the backend's env file, so any
# backend setting from CONTRIBUTING.md → Settings can be added (ALLOW_REGISTRATION, MAX_UPLOAD_MB...).

# Stack
DEV_MODE=docker
DEV_DATA_DIR=.dev/photos
DEV_HTTP_PORT=3001
DEV_API_PORT=8001
DEV_DB_PORT=5433
DEV_VITE_PORT=5174
# 0.0.0.0 to reach the dev stack from a phone on the network. The password below is not secret, so only on a
# network you trust.
DEV_BIND_ADDRESS=127.0.0.1
# Compose project: containers, network and database volume are named after it. Unique per checkout.
DEV_PROJECT=$(default_project)

# Dev login
DEV_USER_EMAIL=dev@birdography.local
DEV_USER_PASSWORD=birdography-dev

# Seed photos
SEED_PHOTOS=300
SEED_REGION=portugal
SEED_HOTSPOTS=15
SEED_SAME_SPOT_PCT=5
# How far photos land from their hotspot (standard deviation, km)
SEED_SPREAD_KM=1.5
# Photos without GPS, to place by hand on the map
SEED_NO_GPS_PCT=5
# Photos are dated over the last SEED_YEARS years
SEED_YEARS=3
# Long side of the generated JPEGs, in pixels
SEED_IMAGE_PX=1600
# Same value, same photos
SEED_RANDOM=42

# Backend. Generated once and kept: the database takes its password only when its volume is created, and a new
# SECRET_KEY logs everyone out.
POSTGRES_DB=birdography
POSTGRES_USER=birdography
POSTGRES_PASSWORD=$(random_hex)
SECRET_KEY=$(random_hex)
EOF
    echo "Created $CONFIG"
}

load_config() {
    [ -f "$CONFIG" ] || write_default_config
    local key value
    # Read, not sourced: values are data, never code.
    while IFS='=' read -r key value || [ -n "$key" ]; do
        case "$key" in
            '' | \#*) continue ;;
            DEV_* | SEED_*) printf -v "$key" '%s' "$value" ;;
        esac
    done <"$CONFIG"
    # Keys added in later versions of this script, for config files created before them.
    : "${DEV_MODE:=docker}" "${DEV_DATA_DIR:=.dev/photos}" "${DEV_HTTP_PORT:=3001}" "${DEV_API_PORT:=8001}"
    : "${DEV_DB_PORT:=5433}" "${DEV_VITE_PORT:=5174}" "${DEV_BIND_ADDRESS:=127.0.0.1}" "${DEV_PROJECT:=$(default_project)}"
    : "${DEV_USER_EMAIL:=dev@birdography.local}" "${DEV_USER_PASSWORD:=birdography-dev}"
    : "${SEED_PHOTOS:=300}" "${SEED_REGION:=portugal}" "${SEED_HOTSPOTS:=15}" "${SEED_SAME_SPOT_PCT:=5}"
    : "${SEED_SPREAD_KM:=1.5}" "${SEED_NO_GPS_PCT:=5}" "${SEED_YEARS:=3}" "${SEED_IMAGE_PX:=1600}" "${SEED_RANDOM:=42}"
}

# Use KEY=value from now on and write it to the config file by the next save_pending, so a run that stops on a
# check (a taken port) changes nothing.
PENDING=()
remember() {
    case "$2" in *[[:space:]\"\'\\]*) die "$1: spaces, quotes and backslashes are not supported ($2)" ;; esac
    printf -v "$1" '%s' "$2"
    PENDING+=("$1" "$2")
}

save_pending() {
    local i
    for ((i = 0; i < ${#PENDING[@]}; i += 2)); do save_config "${PENDING[i]}" "${PENDING[i + 1]}"; done
    PENDING=()
}

# Set KEY=value in the config file, replacing the line if there is one.
save_config() {
    local key=$1 value=$2 tmp
    tmp=$(mktemp "$DEV_DIR/config.XXXXXX")
    awk -v key="$key" -v value="$value" '
        index($0, key "=") == 1 { print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$CONFIG" >"$tmp"
    mv "$tmp" "$CONFIG"
}

# --- compose -----------------------------------------------------------------------------------------------------

data_dir() {
    case "$DEV_DATA_DIR" in
        /*) echo "$DEV_DATA_DIR" ;;
        *) echo "$ROOT/$DEV_DATA_DIR" ;;
    esac
}

compose_env() {
    # What the compose files interpolate. Unset first what a real install's shell might export, so it can't leak
    # into the dev stack; it can still be set in the config file.
    unset TRUSTED_PROXIES CLIENT_MAX_BODY_SIZE
    export ENV_FILE="$CONFIG"
    export HTTP_PORT="$DEV_HTTP_PORT" API_PORT="$DEV_API_PORT" POSTGRES_PORT="$DEV_DB_PORT"
    export BIND_ADDRESS="$DEV_BIND_ADDRESS" UPLOAD_DIR
    UPLOAD_DIR=$(data_dir)
    # The backend writes the photo files as PUID:PGID: make that you, so you can delete them. Root is not allowed.
    export PUID PGID
    PUID=$(id -u)
    PGID=$(id -g)
    if [ "$PUID" = 0 ]; then PUID=1000 PGID=1000; fi
}

compose() {
    docker compose -p "$DEV_PROJECT" --project-directory "$ROOT" --env-file "$CONFIG" \
        -f "$ROOT/docker-compose.yml" -f "$ROOT/compose.override.yml" -f "$ROOT/compose.dev.yml" "$@"
}

backend_running() {
    [ -n "$(compose ps --status running -q backend 2>/dev/null)" ]
}

# --- ports -------------------------------------------------------------------------------------------------------

OWN_PORTS=
own_ports() {
    # Ports the dev stack itself publishes count as free, so `up` can be repeated.
    if [ -z "$OWN_PORTS" ]; then
        OWN_PORTS=" $(docker ps --filter "label=com.docker.compose.project=$DEV_PROJECT" --format '{{.Ports}}' |
            grep -oE ':[0-9]+->' | grep -oE '[0-9]+' | tr '\n' ' ') "
    fi
    echo "$OWN_PORTS"
}

port_busy() {
    local port=$1
    case "$(own_ports)" in *" $port "*) return 1 ;; esac
    if command -v ss >/dev/null 2>&1; then
        [ -n "$(ss -Hltn "sport = :$port" 2>/dev/null)" ]
    else
        (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null
    fi
}

check_ports() {
    local auto=$1 keys key port taken problems=0
    if [ "$DEV_MODE" = vite ]; then keys="DEV_API_PORT DEV_DB_PORT DEV_VITE_PORT"; else keys="DEV_HTTP_PORT DEV_API_PORT DEV_DB_PORT"; fi
    taken=" "
    for key in $keys; do
        port=${!key}
        if [ "$auto" = 1 ]; then
            while port_busy "$port" || [[ "$taken" == *" $port "* ]]; do
                port=$((port + 1))
                [ "$port" -le 65535 ] || die "no free port above ${!key} for $key"
            done
            if [ "$port" != "${!key}" ]; then
                echo "Port ${!key} ($key) is in use; using $port"
                remember "$key" "$port"
            fi
        elif port_busy "$port" || [[ "$taken" == *" $port "* ]]; then
            echo "dev: port $port ($key) is in use. Pick another with --$(flag_of "$key"), or use --auto-ports." >&2
            problems=1
        fi
        taken="$taken$port "
    done
    [ "$problems" = 0 ] || exit 1
}

flag_of() {
    case "$1" in
        DEV_HTTP_PORT) echo http-port ;;
        DEV_API_PORT) echo api-port ;;
        DEV_DB_PORT) echo db-port ;;
        DEV_VITE_PORT) echo vite-port ;;
    esac
}

valid_port() {
    if ! [[ "$2" =~ ^[0-9]+$ ]] || [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then
        die "$1 needs a port number (1-65535), not '$2'"
    fi
}

# --- data folder -------------------------------------------------------------------------------------------------

prepare_data_dir() {
    local dir
    dir=$(data_dir)
    mkdir -p "$dir"
    if [ ! -e "$dir/$MARKER" ]; then
        # Never let the dev stack (and later `reset`) loose on a folder that holds something else, like real photos.
        [ -z "$(ls -A "$dir")" ] || die "$dir is not empty and was not created by scripts/dev.sh; pick another --data-dir"
        echo "Photo files of the dev stack (scripts/dev.sh). \`scripts/dev.sh reset\` empties this folder." >"$dir/$MARKER"
    fi
}

wipe_data_dir() {
    local dir
    dir=$(data_dir)
    [ -d "$dir" ] || return 0
    [ -e "$dir/$MARKER" ] || die "$dir was not created by scripts/dev.sh; not deleting it"
    find "$dir" -mindepth 1 -maxdepth 1 ! -name "$MARKER" -exec rm -rf {} + ||
        die "could not empty $dir; files owned by another user? Try: sudo rm -rf '$dir'"
}

# --- commands ----------------------------------------------------------------------------------------------------

SEED_FLAGS=()
seed_flag() {
    # Flags shared by `up`/`reset` (saved) and `seed` (one-off). Returns 1 if $1 is not one of them.
    case "$1" in
        --photos | --region | --hotspots | --same-spot-pct) need_value "$1" $# ;;
        *) return 1 ;;
    esac
    case "$1" in
        --photos) [[ "$2" =~ ^[0-9]+$ ]] || die "--photos needs a number"; SEED_FLAGS+=(SEED_PHOTOS "$2") ;;
        --region) SEED_FLAGS+=(SEED_REGION "$2") ;;
        --hotspots) [[ "$2" =~ ^[0-9]+$ ]] || die "--hotspots needs a number"; SEED_FLAGS+=(SEED_HOTSPOTS "$2") ;;
        --same-spot-pct) [[ "$2" =~ ^[0-9.]+$ ]] || die "--same-spot-pct needs a number"; SEED_FLAGS+=(SEED_SAME_SPOT_PCT "$2") ;;
        *) return 1 ;;
    esac
}

need_value() {
    [ "$2" -ge 2 ] || die "$1 needs a value"
}

run_seed() {
    # run_seed [seeder options...]: the dev user and photos, with the settings currently loaded
    compose exec -T -e DEV_USER_PASSWORD="$DEV_USER_PASSWORD" backend python -m devtools.seed \
        --email "$DEV_USER_EMAIL" --photos "$SEED_PHOTOS" --region "$SEED_REGION" --hotspots "$SEED_HOTSPOTS" \
        --same-spot-pct "$SEED_SAME_SPOT_PCT" --spread-km "$SEED_SPREAD_KM" --no-gps-pct "$SEED_NO_GPS_PCT" \
        --years "$SEED_YEARS" --image-px "$SEED_IMAGE_PX" --seed "$SEED_RANDOM" "$@"
}

cmd_up() {
    local auto=0 i
    while [ $# -gt 0 ]; do
        case "$1" in
            --docker) remember DEV_MODE docker ;;
            --vite) remember DEV_MODE vite ;;
            --auto-ports) auto=1 ;;
            --data-dir) need_value "$1" $#; remember DEV_DATA_DIR "$2"; shift ;;
            --http-port) need_value "$1" $#; valid_port "$1" "$2"; remember DEV_HTTP_PORT "$2"; shift ;;
            --api-port) need_value "$1" $#; valid_port "$1" "$2"; remember DEV_API_PORT "$2"; shift ;;
            --db-port) need_value "$1" $#; valid_port "$1" "$2"; remember DEV_DB_PORT "$2"; shift ;;
            --vite-port) need_value "$1" $#; valid_port "$1" "$2"; remember DEV_VITE_PORT "$2"; shift ;;
            --user) need_value "$1" $#; remember DEV_USER_EMAIL "$2"; shift ;;
            --password)
                need_value "$1" $#
                [ "${#2}" -ge 10 ] || die "--password needs at least 10 characters"
                remember DEV_USER_PASSWORD "$2"
                shift
                ;;
            -h | --help) usage; exit 0 ;;
            *)
                seed_flag "$@" || die "unknown option $1 (see scripts/dev.sh --help)"
                shift
                ;;
        esac
        shift
    done
    for ((i = 0; i < ${#SEED_FLAGS[@]}; i += 2)); do remember "${SEED_FLAGS[i]}" "${SEED_FLAGS[i + 1]}"; done
    case "$DEV_MODE" in docker | vite) ;; *) die "DEV_MODE must be docker or vite, not '$DEV_MODE'" ;; esac

    compose_env
    check_ports "$auto"
    compose_env # ports may have moved
    prepare_data_dir
    save_pending
    local services=()
    if [ "$DEV_MODE" = vite ]; then
        compose stop frontend >/dev/null 2>&1 || true # left over from docker mode
        services=(db backend)
    fi
    if ! compose up -d --build --wait "${services[@]+"${services[@]}"}"; then
        local logs # captured first: with pipefail, `grep -q` closing the pipe early would count as a failure
        logs=$(compose logs backend 2>/dev/null || true)
        local dblogs
        dblogs=$(compose logs db 2>/dev/null || true)
        if [[ "$dblogs" == *"unused mount/volume"* || "$dblogs" == *"pg_upgrade"* ]]; then
            die "the dev database volume is from an older PostgreSQL; the dev data is disposable, so start over with" \
                "scripts/dev.sh reset. (A real install is upgraded as in CONTRIBUTING.md → Upgrading PostgreSQL.)"
        fi
        if [[ "$logs" == *"password authentication failed"* ]]; then
            die "the dev database was created with another POSTGRES_PASSWORD than the one in $CONFIG." \
                "Put the old one back, or start over with scripts/dev.sh reset."
        fi
        die "the stack did not start; see scripts/dev.sh logs"
    fi
    run_seed --if-empty
    cmd_info
    if [ "$DEV_MODE" = vite ]; then run_vite; fi
}

run_vite() {
    cd "$ROOT/frontend"
    if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
        npm ci
    fi
    echo "Starting Vite; Ctrl-C stops it, the containers keep running (scripts/dev.sh down stops them)."
    API_URL="http://localhost:$DEV_API_PORT" exec npm run dev -- --host "$DEV_BIND_ADDRESS" --port "$DEV_VITE_PORT" --strictPort
}

cmd_seed() {
    local extra=() i
    while [ $# -gt 0 ]; do
        case "$1" in
            --replace) extra+=(--replace) ;;
            -h | --help) usage; exit 0 ;;
            *)
                seed_flag "$@" || die "unknown option $1 (see scripts/dev.sh --help)"
                shift
                ;;
        esac
        shift
    done
    # One-off: override the loaded values for this run without saving them.
    for ((i = 0; i < ${#SEED_FLAGS[@]}; i += 2)); do printf -v "${SEED_FLAGS[i]}" '%s' "${SEED_FLAGS[i + 1]}"; done
    compose_env
    backend_running || die "the dev stack is not running; start it with scripts/dev.sh up"
    run_seed "${extra[@]+"${extra[@]}"}"
}

cmd_reset() {
    compose_env
    echo "Deleting the dev database ($DEV_PROJECT) and the photos in $(data_dir)"
    compose down --volumes --remove-orphans
    wipe_data_dir
    cmd_up "$@"
}

cmd_down() {
    compose_env
    case "${1:-}" in
        '') compose down ;;
        --volumes | -v) compose down --volumes ;;
        *) usage >&2; exit 2 ;;
    esac
}

cmd_info() {
    compose_env
    local count="not running"
    if backend_running; then
        count=$(compose exec -T -e DEV_USER_PASSWORD="$DEV_USER_PASSWORD" backend python -m devtools.seed \
            --email "$DEV_USER_EMAIL" --count 2>/dev/null | tail -n 1) || count="unknown"
    fi
    local host=localhost
    [ "$DEV_BIND_ADDRESS" = 127.0.0.1 ] || host="$DEV_BIND_ADDRESS"
    echo
    echo "Birdography dev stack ($DEV_PROJECT, $DEV_MODE mode)"
    if [ "$DEV_MODE" = vite ]; then
        echo "  Web UI    http://$host:$DEV_VITE_PORT  (Vite, hot reload)"
    else
        echo "  Web UI    http://$host:$DEV_HTTP_PORT"
    fi
    echo "  API docs  http://localhost:$DEV_API_PORT/docs"
    echo "  Database  localhost:$DEV_DB_PORT  (user birdography, password in .dev/config.env)"
    echo "  Login     $DEV_USER_EMAIL / $DEV_USER_PASSWORD"
    echo "  Photos    $count, files in $(data_dir)"
    echo "  Settings  $CONFIG"
    if [ "$DEV_BIND_ADDRESS" != 127.0.0.1 ]; then
        echo "  Warning   published on $DEV_BIND_ADDRESS: anyone on the network can log in with the dev password"
    fi
}

# --- main --------------------------------------------------------------------------------------------------------

[ $# -gt 0 ] || { usage; exit 2; }
command=$1
shift
case "$command" in
    -h | --help | help) usage; exit 0 ;;
esac
docker compose version >/dev/null 2>&1 || die "needs Docker with the compose plugin"
load_config

case "$command" in
    up) cmd_up "$@" ;;
    seed) cmd_seed "$@" ;;
    reset) cmd_reset "$@" ;;
    down) cmd_down "$@" ;;
    info) cmd_info ;;
    logs) compose_env; compose logs -f "$@" ;;
    *) compose_env; compose "$command" "$@" ;;
esac
