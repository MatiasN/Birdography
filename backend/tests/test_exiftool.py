import re
import shutil

import pytest
from PIL import Image

from app import exiftool
from app.config import settings
from tests.conftest import make_jpeg

pytestmark = pytest.mark.exiftool


def write_tiff(path, make=None):
    exif = Image.Exif()
    if make:
        exif[0x010F] = make
    Image.new("RGB", (16, 16), (10, 120, 10)).save(path, "TIFF", exif=exif)


def test_version(anon):
    assert re.fullmatch(r"\d+\.\d+", exiftool.version())
    assert anon.get("/health").json()["exiftool"] == exiftool.version()


def test_file_type_by_content(tmp_path):
    jpeg = tmp_path / "upload"
    jpeg.write_bytes(make_jpeg())
    assert exiftool.file_type(jpeg) == {
        "file_type": "JPEG",
        "extension": "jpg",
        "mime_type": "image/jpeg",
        "model": None,
    }

    tiff = tmp_path / "upload2"
    write_tiff(tiff, make="NIKON CORPORATION")
    assert exiftool.file_type(tiff) == {
        "file_type": "TIFF",
        "extension": "tif",
        "mime_type": "image/tiff",
        "model": None,
    }


def test_file_type_trusts_extension_of_tiff_based_files(tmp_path):
    """Why detection runs on an extension-less temp file: a plain TIFF named .nef is reported as NEF."""
    renamed = tmp_path / "plain.nef"
    write_tiff(renamed)
    assert exiftool.file_type(renamed)["file_type"] == "NEF"


def test_extract_preview_without_embedded_image(tmp_path):
    src, dest = tmp_path / "plain.jpg", tmp_path / "preview.jpg"
    src.write_bytes(make_jpeg())
    assert exiftool.extract_preview(src, dest) is False
    assert not dest.exists()


def test_extract_preview_strips_metadata_but_keeps_orientation(tmp_path):
    """Pillow cannot write embedded previews, so ExifTool plants a ThumbnailImage (last in the fallback chain)."""
    src, dest, embedded = tmp_path / "raw.jpg", tmp_path / "preview.jpg", tmp_path / "embedded.jpg"
    src.write_bytes(make_jpeg(lat=38.5, lon=-9.25))
    embedded.write_bytes(make_jpeg(camera="Embedded"))
    exiftool._run(f"-ThumbnailImage<={embedded}", "-Orientation#=6", "-overwrite_original", "--", str(src))

    assert exiftool.extract_preview(src, dest) is True
    assert dest.read_bytes() == embedded.read_bytes() or dest.read_bytes()[:3] == b"\xff\xd8\xff"
    tags = exiftool.metadata(dest)
    assert tags["IFD0:Orientation"] == 6
    assert not any(k.startswith("GPS:") for k in tags)
    assert "IFD0:Make" not in tags and "IFD0:Model" not in tags


def test_metadata_groups_and_numeric_values(tmp_path):
    src = tmp_path / "meta.jpg"
    src.write_bytes(make_jpeg(camera="Canon EOS R5", taken_at="2026:05:14 07:32:10", lat=38.5, lon=-9.25))
    tags = exiftool.metadata(src)
    assert "SourceFile" not in tags
    assert tags["ExifIFD:DateTimeOriginal"] == "2026:05:14 07:32:10"
    assert tags["GPS:GPSLatitude"] == pytest.approx(38.5)
    assert tags["GPS:GPSLongitude"] == pytest.approx(9.25)  # unsigned with -n; the ref is a separate tag
    assert tags["GPS:GPSLongitudeRef"] == "W"


def test_failures_become_exiftool_errors(monkeypatch, tmp_path):
    with pytest.raises(exiftool.ExifToolError, match="File not found"):
        exiftool.file_type(tmp_path / "does-not-exist")

    monkeypatch.setattr(exiftool, "TIMEOUT", 1e-6)
    with pytest.raises(exiftool.ExifToolError, match="timed out"):
        exiftool.metadata(tmp_path / "irrelevant")


def test_missing_binary(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "exiftool_path", str(tmp_path / "nope"))
    assert exiftool.version() is None
    with pytest.raises(exiftool.ExifToolError, match="not found"):
        exiftool.file_type(tmp_path / "x")


def test_binary_is_found_where_the_skip_hook_looks():
    assert shutil.which(settings.exiftool_path)
