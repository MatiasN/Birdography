import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.config import settings

CHUNK = 1024 * 1024


@dataclass
class Saved:
    name: str
    size: int
    sha256: str


def path(name: str) -> Path:
    return Path(settings.upload_dir) / name


def save(file: BinaryIO, suffix: str) -> Saved:
    """Store the stream under a random final name, hashing it on the way."""
    name = f"{uuid.uuid4().hex}{suffix}"
    target = path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    with target.open("wb") as out:
        while chunk := file.read(CHUNK):
            out.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    return Saved(name, size, digest.hexdigest())


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
