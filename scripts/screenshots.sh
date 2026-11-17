#!/bin/sh
# Screenshots of the real app for the README, into docs/screenshots/*.webp, taken from the dev stack
# (scripts/dev.sh up, with its seeded photos). Uses the official Playwright image, so no browser is installed on
# the host; the container shares the host network to reach the stack. Needs Docker and the dev stack running.
#
# The Upload screenshots show a RAW+JPEG pair that is held (never sent) and one small JPEG that is uploaded, so
# each run adds three photos to the dev account. `scripts/dev.sh seed --replace` puts the account back as it was.
set -eu

PLAYWRIGHT_VERSION=1.65.1
repo=$(cd "$(dirname "$0")/.." && pwd)
config="$repo/.dev/config.env"
[ -f "$config" ] || { echo "screenshots: no $config; run scripts/dev.sh up first" >&2; exit 1; }

setting() { sed -n "s/^$1=//p" "$config" | tail -n 1; }
port=$(setting DEV_HTTP_PORT)
email=$(setting DEV_USER_EMAIL)
password=$(setting DEV_USER_PASSWORD)
if [ -z "$port" ] || [ -z "$email" ] || [ -z "$password" ]; then
  echo "screenshots: DEV_HTTP_PORT, DEV_USER_EMAIL and DEV_USER_PASSWORD must be set in $config" >&2
  exit 1
fi

files=$(mktemp -d)
trap 'rm -rf "$files"' EXIT
# A real RAW (the NEF test sample) with a JPEG from another moment, which the Upload tab holds for a decision, and
# a JPEG that is new every run, so it uploads instead of being a duplicate. Made by the backend's Python (Pillow).
cp "$repo/backend/tests/fixtures/raw/nikon_z5_2.nef" "$files/DSC_0412.NEF"
jpeg() { # $1 file, $2 DateTimeOriginal, $3 description
  "$repo/scripts/dev.sh" exec -T backend python -c "
import io, sys
from PIL import Image
exif = Image.Exif()
exif[0x010F], exif[0x0110], exif[0x010E] = 'NIKON CORPORATION', 'NIKON Z5_2', sys.argv[2]
exif.get_ifd(0x8769)[0x9003] = sys.argv[1]
image = Image.linear_gradient('L').resize((1200, 800)).convert('RGB')
buf = io.BytesIO(); image.save(buf, 'JPEG', exif=exif, quality=85); sys.stdout.buffer.write(buf.getvalue())
" "$2" "$3" > "$1"
}
jpeg "$files/DSC_0412.JPG" "2025:04:27 17:57:09" "screenshot pair"
for n in 0413 0414 0415; do # one new file per Upload screenshot (light, dark, phone)
  jpeg "$files/DSC_$n.JPG" "2025:04:27 17:58:30" "screenshot $n $(date +%s)"
done

mkdir -p "$repo/docs/screenshots"
docker run --rm --init --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
  -e BASE="http://localhost:$port" -e EMAIL="$email" -e PASSWORD="$password" \
  -e OUT=/repo/docs/screenshots -e FILES=/files \
  -v "$repo:/repo" -v "$files:/files" \
  -w /repo/scripts \
  "mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble" \
  sh -c "npm install --silent --no-audit --no-fund --prefix /tmp/pw playwright@${PLAYWRIGHT_VERSION} >/dev/null \
         && node screenshots.mjs"
