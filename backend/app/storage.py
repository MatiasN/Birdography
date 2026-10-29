import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from app.config import settings


def save(file: BinaryIO, suffix: str) -> str:
    name = f"{uuid.uuid4().hex}{suffix}"
    path = Path(settings.upload_dir) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as out:
        shutil.copyfileobj(file, out)
    return name
