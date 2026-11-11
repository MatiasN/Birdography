#!/bin/sh
# The image's entrypoint. Started as root, it makes the photo directory owned by PUID:PGID (default 1000:1000),
# then runs the command as that user, so nobody has to chown it by hand and the backend never runs as root. The
# host directory may have been created by Docker (owned by root), written by an image that ran as root, or copied
# from another machine. Without a command it only fixes the directory (restore.sh uses that).
set -eu

uid="${PUID:-1000}"
gid="${PGID:-1000}"
dir="${UPLOAD_DIR:-/data/photos}"

if [ "$(id -u)" != 0 ]; then
    # Started unprivileged (`docker run --user`, rootless setups): nothing to fix. The backend checks at startup
    # that the directory is writable and says what to do if it isn't.
    [ $# -gt 0 ] || { echo "fix-permissions: must run as root" >&2; exit 1; }
    exec "$@"
fi

case "$uid:$gid" in
    *[!0-9:]* | :* | *:) echo "fix-permissions: PUID and PGID must be numeric" >&2; exit 1 ;;
    0:* | *:0) echo "fix-permissions: PUID and PGID must not be 0" >&2; exit 1 ;;
esac

mkdir -p "$dir"
# Only what someone else owns, so later starts change nothing; -h changes symlinks themselves, never their targets.
changed=$(find "$dir" \( ! -user "$uid" -o ! -group "$gid" \) -print -exec chown -h "$uid:$gid" {} + | wc -l)
[ "$changed" = 0 ] || echo "fix-permissions: $dir handed to $uid:$gid ($changed entries changed)"

[ $# -gt 0 ] || exit 0
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"
