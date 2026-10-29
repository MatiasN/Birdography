import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from app.config import settings


def path(name: str) -> Path:
    return Path(settings.upload_dir) / name


def save(file: BinaryIO, suffix: str) -> str:
    name = f"{uuid.uuid4().hex}{suffix}"
    target = path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as out:
        shutil.copyfileobj(file, out)
    return name
