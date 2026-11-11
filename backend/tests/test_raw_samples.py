"""Real camera RAW files (shrunk, see tests/fixtures/raw/README.md) through detection, preview and upload."""

import shutil

import pytest

from app import exiftool, filetypes
from tests.conftest import RAW_SAMPLES

pytestmark = pytest.mark.exiftool

SAMPLES = list(RAW_SAMPLES.values())


def by_format(sample):
    return sample.format


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_detected_by_content_without_extension(tmp_path, sample):
    upload_temp = tmp_path / "upload"
    shutil.copyfile(sample.path, upload_temp)
    assert filetypes.detect(upload_temp) == filetypes.TYPES[sample.format]


def test_nikon_z_nef_is_not_mistaken_for_coolpix_nrw(tmp_path):
    """ExifTool 13.50 reports this NEF as NRW even with a .nef extension; detection corrects it."""
    sample = RAW_SAMPLES["nef"]
    upload_temp = tmp_path / "upload"
    shutil.copyfile(sample.path, upload_temp)
    reported = exiftool.file_type(upload_temp)
    assert reported["file_type"] in ("NEF", "NRW")
    assert reported["model"] == sample.model
    assert filetypes.detect(upload_temp).format == "nef"


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_metadata_survived_shrinking(sample):
    tags = exiftool.metadata(sample.path)
    assert tags["IFD0:Model"] == sample.model
    assert tags["ExifIFD:DateTimeOriginal"] == sample.taken_at
    assert str(tags.get("ExifTool:Warning", "[Minor]")).startswith("[Minor]")  # nothing truncated
