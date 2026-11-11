"""Install a pinned ExifTool release, verified by sha256. Used by CI and the Docker image.

    python3 scripts/install_exiftool.py [--prefix /usr/local]

Distribution packages lag behind (Ubuntu 24.04 ships 12.76, Debian trixie 13.25) and ExifTool learns new
cameras and maker tags every release; `exif.raw_dimensions` relies on Nikon's `CropArea`, for example. The
release is unpacked to `<prefix>/lib/exiftool` and linked as `<prefix>/bin/exiftool`. Needs only Perl and
the standard library. To upgrade, change VERSION and SHA256 (published at https://exiftool.org/checksums.txt).
"""

import argparse
import hashlib
import io
import shutil
import tarfile
import urllib.request
from pathlib import Path

VERSION = "13.63"
SHA256 = "c6438851b971886f2eb35426ea5bc8960f34ae4eddeca3198a57af5b0ad49cbd"
# exiftool.org only serves the latest release; SourceForge keeps every one, so a pinned URL stays valid.
URL = f"https://sourceforge.net/projects/exiftool/files/Image-ExifTool-{VERSION}.tar.gz/download"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", type=Path, default=Path("/usr/local"))
    prefix = parser.parse_args().prefix

    with urllib.request.urlopen(URL, timeout=120) as response:
        data = response.read()
    if (digest := hashlib.sha256(data).hexdigest()) != SHA256:
        raise SystemExit(f"ExifTool {VERSION}: sha256 {digest} does not match the published {SHA256}")

    target = prefix / "lib" / "exiftool"
    shutil.rmtree(target, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(target.parent, filter="data")
    (target.parent / f"Image-ExifTool-{VERSION}").rename(target)

    link = prefix / "bin" / "exiftool"
    link.parent.mkdir(parents=True, exist_ok=True)
    link.unlink(missing_ok=True)
    link.symlink_to(target / "exiftool")
    print(f"ExifTool {VERSION} installed in {target}, linked from {link}")


if __name__ == "__main__":
    main()
