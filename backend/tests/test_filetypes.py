import pytest

from app import exiftool, filetypes
from app.config import settings
from tests.conftest import make_image, make_jpeg

TIFF_LE = b"II*\x00\x08\x00\x00\x00"


def detect(tmp_path, data: bytes):
    file = tmp_path / "upload"
    file.write_bytes(data)
    return filetypes.detect(file)


@pytest.mark.parametrize(
    ("head", "fmt"),
    [
        (b"\xff\xd8\xff\xe1" + b"\0" * 12, "jpeg"),
        (b"\x89PNG\r\n\x1a\n" + b"\0" * 8, "png"),
        (b"RIFF\x24\x00\x00\x00WEBPVP8 ", "webp"),
        (b"\x00\x00\x00\x18ftypheic" + b"\0" * 8, "heic"),
        (b"\x00\x00\x00\x18ftypmif1" + b"\0" * 8, "heif"),
        (b"\x00\x00\x00\x18ftypcrx " + b"\0" * 8, "cr3"),
        (b"FUJIFILMCCD-RAW 0201", "raf"),
        (b"IIRO\x08\x00\x00\x00" + b"\0" * 8, "orf"),
        (b"MMOR\x00\x08\x00\x00" + b"\0" * 8, "orf"),
        (b"IIU\x00\x18\x00\x00\x00" + b"\0" * 8, "rw2"),
        (TIFF_LE + b"CR\x02\x00" + b"\0" * 4, "cr2"),
    ],
)
def test_magic_bytes(tmp_path, head, fmt):
    assert detect(tmp_path, head) == filetypes.TYPES[fmt]


@pytest.mark.parametrize(
    "data",
    [b"", b"GIF89a" + b"\0" * 10, b"\x00\x00\x00\x18ftypisom" + b"\0" * 8, b"<html>"],
)
def test_unsupported_content(tmp_path, data):
    assert detect(tmp_path, data) is None


def test_tiff_family_is_told_apart_by_exiftool(tmp_path, monkeypatch):
    calls = []

    def fake_file_type(path):
        calls.append(path)
        return {"file_type": "NEF", "extension": "nef", "mime_type": "image/x-nikon-nef"}

    monkeypatch.setattr(exiftool, "file_type", fake_file_type)
    assert detect(tmp_path, make_image("TIFF")) == filetypes.TYPES["nef"]
    assert calls == [tmp_path / "upload"]


def test_unknown_tiff_based_raw_is_unsupported(tmp_path, monkeypatch):
    monkeypatch.setattr(exiftool, "file_type", lambda path: {"file_type": "ERF", "extension": None, "mime_type": None})
    assert detect(tmp_path, make_image("TIFF")) is None


def test_without_exiftool_tiff_family_degrades_to_tiff(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(settings, "exiftool_path", str(tmp_path / "missing-exiftool"))
    assert detect(tmp_path, make_image("TIFF")) == filetypes.TYPES["tiff"]
    assert "treating upload as TIFF" in caplog.text


@pytest.mark.exiftool
def test_real_tiff_is_tiff(tmp_path):
    assert detect(tmp_path, make_image("TIFF")) == filetypes.TYPES["tiff"]
    assert detect(tmp_path, make_jpeg()) == filetypes.TYPES["jpeg"]


def test_extensions_and_viewability():
    assert filetypes.TYPES["jpeg"].ext == ".jpg"
    assert filetypes.TYPES["tiff"].ext == ".tif"
    assert filetypes.TYPES["nef"].ext == ".nef"
    assert [t.format for t in filetypes.TYPES.values() if t.browser_viewable] == ["jpeg", "png", "webp"]
    tiff_based_raw = set(filetypes.TIFF_FAMILY.values()) - {"tiff"}
    assert all(filetypes.TYPES[fmt].is_raw for fmt in tiff_based_raw)
