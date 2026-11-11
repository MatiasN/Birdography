import hashlib
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.config import settings

CHUNK = 1024 * 1024
MB = 1024 * 1024
# Uploads land here until their type is known; anything left behind is swept by `purge-trash`.
TEMP_DIR = ".tmp"
TEMP_MAX_AGE = 3600


@dataclass
class Saved:
    name: str
    size: int
    sha256: str


class TooLarge(Exception):
    def __init__(self, max_bytes: int):
        super().__init__(f"larger than {max_bytes} bytes")
        self.max_bytes = max_bytes


def path(name: str) -> Path:
    return Path(settings.upload_dir) / name


def temp_name() -> str:
    """A fresh name under the temp directory, for writers that need a path (ExifTool)."""
    return f"{TEMP_DIR}/{uuid.uuid4().hex}"


def save(file: BinaryIO, suffix: str, max_bytes: int | None = None) -> Saved:
    """Store the stream under a random final name, hashing it on the way."""
    return _write(file, f"{uuid.uuid4().hex}{suffix}", max_bytes)


def save_temp(file: BinaryIO, max_bytes: int | None = None) -> Saved:
    """Store the stream under a random extension-less temp name; `finalize` moves it into place."""
    return _write(file, temp_name(), max_bytes)


def finalize(temp: str, suffix: str) -> str:
    """Move a temp file to its final name, carrying the detected extension. Returns the new name."""
    name = f"{Path(temp).name}{suffix}"
    os.replace(path(temp), path(name))
    return name


def digest(name: str) -> tuple[int, str]:
    """Size and SHA-256 of a stored file."""
    digest = hashlib.sha256()
    size = 0
    with path(name).open("rb") as f:
        while chunk := f.read(CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return size, digest.hexdigest()


def remove(name: str) -> None:
    path(name).unlink(missing_ok=True)


def sweep_temp(max_age: float = TEMP_MAX_AGE, now: float | None = None) -> int:
    """Delete temp files older than `max_age` seconds (left by crashed uploads). Returns how many."""
    now = now if now is not None else time.time()
    count = 0
    for file in path(TEMP_DIR).glob("*"):
        if file.is_file() and now - file.stat().st_mtime > max_age:
            file.unlink(missing_ok=True)
            count += 1
    return count


def _write(file: BinaryIO, name: str, max_bytes: int | None) -> Saved:
    target = path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := file.read(CHUNK):
                size += len(chunk)
                if max_bytes is not None and size > max_bytes:
                    raise TooLarge(max_bytes)
                out.write(chunk)
                digest.update(chunk)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return Saved(name, size, digest.hexdigest())
