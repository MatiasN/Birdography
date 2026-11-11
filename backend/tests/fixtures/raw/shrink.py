"""Rebuild the RAW test fixtures in this directory from their raw.pixls.us originals.

    cd backend && python tests/fixtures/raw/shrink.py

Each original is downloaded, checked against its published sha256 and cut down to what the app reads: the
headers, every metadata block and every embedded JPEG. Only the sensor data is dropped, which is most of the
file and is never decoded here.

- TIFF-based (NEF, ARW, DNG): sensor data sits after everything else, so the file is cut where the first CFA
  or LinearRaw strip/tile begins. Refuses if any embedded image or other strip extends past that point.
- CR3 (ISO-BMFF): the camera JPEG is the first sample of `mdat`, the sensor tracks follow and the CTMD
  metadata track comes last. The JPEG is kept, the CTMD sample is moved right behind it, its chunk offset and
  the `mdat` size are patched. The sensor tracks are left pointing past the end of the file.

Afterwards ExifTool must report the same tags as for the original (apart from sizes derived from `mdat`) and
no new warnings; otherwise nothing is written. Needs ExifTool on PATH; standard library only, so it runs
without the backend's environment.
"""

import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
BASE = "https://raw.pixls.us/getfile.php"

# file name -> (download URL, sha256 of the original as published by raw.pixls.us)
SOURCES = {
    "nikon_z5_2.nef": (
        f"{BASE}/7737/nice/Nikon%20-%20Z5_2%20-%208bit%20compressed%20(3:2).NEF",
        "196971ea960cfa6f5c0a19cebe515ac118e079c57ceeef850ab3a4995dc7d20f",
    ),
    "canon_eos_r6_mark_iii.cr3": (
        f"{BASE}/8964/nice/Canon%20-%20EOS%20R6%20Mark%20III%20-%20CRAW%20(3:2).CR3",
        "7e1a5d84297a52853b0bbe5a5c03a5d4f5b93e00b7020271523240f9cabfe50e",
    ),
    "sony_ilce_7s.arw": (
        f"{BASE}/1582/nice/Sony%20-%20ILCE-7S%20-%2014bit%2014bit%20compressed%20(3:2).ARW",
        "a35ebb2fbec929daa5beb20d1ce5c15a8aac7b1a7a231455387f3df8a7442e07",
    ),
    "canon_eos_5d_mark_iii_adobe.dng": (
        f"{BASE}/1033/nice/Adobe%20DNG%20Converter%20-%20Canon%20EOS%205D%20Mark%20III%20-%20"
        "Lossy%20JPEG%20compression,%20rgb%20(3:2).DNG",
        "b22f1e36331f679abb8b13e433b9bbde3988723adf10fee7aa0dda6381016a98",
    ),
}

SENSOR_PHOTOMETRIC = {32803, 34892}  # CFA, LinearRaw
EMBEDDED = (
    ("JpgFromRawStart", "JpgFromRawLength"),
    ("PreviewImageStart", "PreviewImageLength"),
    ("OtherImageStart", "OtherImageLength"),
    ("ThumbnailOffset", "ThumbnailLength"),
)
# Tags whose value legitimately changes when `mdat` shrinks, or that describe the file rather than its content.
IGNORED = (
    "SourceFile",
    "System:",
    "ExifTool:Warning",
    "File:FileSize",
    "QuickTime:MediaDataSize",
    "Composite:AvgBitrate",
)


def exiftool(*args: str) -> dict:
    out = subprocess.run(["exiftool", "-j", "-n", "-G1", "-a", *args], capture_output=True, check=True).stdout
    return json.loads(out)[0]


def numbers(value) -> list[int]:
    return [int(v) for v in str(value).split()] if value not in (None, "") else []


def shrink_tiff(path: Path) -> bytes:
    tags = exiftool(
        "-m",
        "-b",
        "-PhotometricInterpretation",
        "-StripOffsets",
        "-StripByteCounts",
        "-TileOffsets",
        "-TileByteCounts",
        *(f"-{t}" for pair in EMBEDDED for t in pair),
        "--",
        str(path),
    )
    ifds = {k.split(":")[0] for k in tags if k.endswith(":PhotometricInterpretation")}
    sensor, other = [], []
    for ifd in ifds:
        offsets = numbers(tags.get(f"{ifd}:StripOffsets")) + numbers(tags.get(f"{ifd}:TileOffsets"))
        counts = numbers(tags.get(f"{ifd}:StripByteCounts")) + numbers(tags.get(f"{ifd}:TileByteCounts"))
        ranges = [(o, o + c) for o, c in zip(offsets, counts, strict=True) if c]
        (sensor if tags[f"{ifd}:PhotometricInterpretation"] in SENSOR_PHOTOMETRIC else other).extend(ranges)
    for key, value in tags.items():
        for start, length in EMBEDDED:
            if key.endswith(f":{start}"):
                other.append((value, value + tags.get(key.replace(start, length), 0)))
    if not sensor:
        sys.exit(f"{path.name}: no sensor data found")
    cut = min(start for start, _ in sensor)
    if beyond := [r for r in other if r[1] > cut]:
        sys.exit(f"{path.name}: data after the sensor start at {cut}: {beyond}")
    return path.read_bytes()[:cut]


def boxes(data: bytes, start: int, end: int):
    """(type, offset, header size, total size) of each ISO-BMFF box between start and end."""
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack_from(">I4s", data, pos)
        header = 8
        if size == 1:
            size, header = struct.unpack_from(">Q", data, pos + 8)[0], 16
        elif size == 0:
            size = end - pos
        yield kind, pos, header, size
        pos += size


def children(data: bytes, parent: tuple):
    _, pos, header, size = parent
    return boxes(data, pos + header, pos + size)


def child(data: bytes, parent: tuple, kind: bytes) -> tuple:
    return next(b for b in children(data, parent) if b[0] == kind)


def shrink_cr3(path: Path) -> bytes:
    data = bytearray(path.read_bytes())
    top = {b[0]: b for b in boxes(data, 0, len(data))}
    mdat = top[b"mdat"]
    tracks = []  # (sample format, co64 entry position, chunk offset, sample size)
    for trak in (b for b in children(data, top[b"moov"]) if b[0] == b"trak"):
        stbl = child(data, child(data, child(data, trak, b"mdia"), b"minf"), b"stbl")
        stsd, stsz, co64 = (child(data, stbl, k) for k in (b"stsd", b"stsz", b"co64"))
        fmt = bytes(data[stsd[1] + stsd[2] + 12 : stsd[1] + stsd[2] + 16])
        # stsz: a fixed sample size, or 0 followed by one size per sample (Canon uses both).
        fixed, count = struct.unpack_from(">II", data, stsz[1] + stsz[2] + 4)
        size = fixed or struct.unpack_from(">I", data, stsz[1] + stsz[2] + 12)[0]
        entry = co64[1] + co64[2] + 8
        if count != 1 or struct.unpack_from(">I", data, co64[1] + co64[2] + 4)[0] != 1:
            sys.exit(f"{path.name}: expected one sample per track")
        tracks.append((fmt, entry, struct.unpack_from(">Q", data, entry)[0], size))

    jpeg_fmt, _, jpeg_at, jpeg_size = tracks[0]
    if jpeg_at != mdat[1] + mdat[2] or data[jpeg_at : jpeg_at + 2] != b"\xff\xd8":
        sys.exit(f"{path.name}: the first track is not a JPEG at the start of mdat")
    out = data[: jpeg_at + jpeg_size]
    for fmt, entry, offset, size in tracks[1:]:
        if fmt == b"CTMD":
            struct.pack_into(">Q", out, entry, len(out))
            out += data[offset : offset + size]
    if mdat[2] != 16:
        sys.exit(f"{path.name}: expected a 64-bit mdat header")
    struct.pack_into(">Q", out, mdat[1] + 8, len(out) - mdat[1])
    return bytes(out)


def comparable(path: Path) -> dict:
    return {k: v for k, v in exiftool("--", str(path)).items() if not k.startswith(IGNORED)}


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for name, (url, sha256) in SOURCES.items():
            original = Path(tmp) / name
            with urllib.request.urlopen(url, timeout=120) as response:
                original.write_bytes(response.read())
            if hashlib.sha256(original.read_bytes()).hexdigest() != sha256:
                sys.exit(f"{name}: sha256 mismatch, the download is not the published file")

            small = Path(tmp) / f"small-{name}"
            small.write_bytes(shrink_cr3(original) if name.endswith(".cr3") else shrink_tiff(original))
            before, after = comparable(original), comparable(small)
            if before != after:
                changed = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
                sys.exit(f"{name}: ExifTool reads different tags after shrinking: {changed[:20]}")
            if (warning := exiftool("--", str(small)).get("ExifTool:Warning")) != exiftool("--", str(original)).get(
                "ExifTool:Warning"
            ):
                sys.exit(f"{name}: new ExifTool warning after shrinking: {warning}")

            (HERE / name).write_bytes(small.read_bytes())
            digest = hashlib.sha256(small.read_bytes()).hexdigest()
            print(f"{name}: {original.stat().st_size} -> {small.stat().st_size} bytes, sha256 {digest}")


if __name__ == "__main__":
    main()
