import pytest

from app import storage
from tests.conftest import login, make_jpeg, stored


def upload(client, data=None, name="bird.jpg"):
    return client.post("/photos", files={"file": (name, data or make_jpeg(), "image/jpeg")})


def test_upload_reads_exif(client):
    data = make_jpeg(camera="Canon EOS R5", taken_at="2026:05:14 07:32:10", lat=38.5, lon=-9.25)
    photo = upload(client, data).json()

    assert photo["camera"] == "Canon EOS R5"
    assert photo["taken_at"].startswith("2026-05-14T07:32:10")
    assert photo["lat"] == pytest.approx(38.5)
    assert photo["lon"] == pytest.approx(-9.25)


def test_upload_without_exif(client):
    photo = upload(client).json()
    assert photo["taken_at"] is None
    assert photo["lat"] is None


def test_upload_records_original_file(client):
    data = make_jpeg()
    photo = upload(client, data, name="DSC_0001.jpg").json()

    (file,) = photo["files"]
    assert file["kind"] == "original"
    assert file["format"] == "jpeg"
    assert file["is_raw"] is False
    assert file["size_bytes"] == len(data)
    assert (file["width"], file["height"]) == (8, 8)
    assert file["url"] == f"/photos/{photo['id']}/file?kind=original"


def test_raw_original_has_no_dimensions(client):
    (file,) = upload(client, b"not really a NEF", name="DSC_0001.NEF").json()["files"]
    assert (file["format"], file["is_raw"], file["width"], file["height"]) == ("nef", True, None, None)


def test_duplicate_upload_is_rejected_for_everyone(client):
    data = make_jpeg()
    assert upload(client, data).status_code == 201
    assert upload(client, data, name="again.jpg").status_code == 409

    other = login("other@example.com")
    assert upload(other, data).status_code == 409
    assert other.get("/photos").json() == []
    assert len(stored()) == 1


def test_rejects_unsupported_type(client):
    assert upload(client, b"<html>", name="evil.html").status_code == 400
    assert stored() == []


def test_file_is_served_with_fallback(client):
    data = make_jpeg()
    photo = upload(client, data).json()
    original = client.get(f"/photos/{photo['id']}/file", params={"kind": "original"})
    assert original.content == data
    assert original.headers["content-type"] == "image/jpeg"
    # No preview or thumbnail yet: both fall back to the original.
    assert client.get(f"/photos/{photo['id']}/file").content == data
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "thumbnail"}).content == data
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "huge"}).status_code == 422


def test_file_missing_on_disk(client):
    photo = upload(client).json()
    for name in stored():
        storage.remove(name)
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "original"}).status_code == 404


def test_list_filters_by_camera(client):
    upload(client, make_jpeg(camera="Canon EOS R5"))
    upload(client, make_jpeg(camera="Nikon Z9"))

    photos = client.get("/photos", params={"camera": "Nikon Z9"}).json()
    assert [p["camera"] for p in photos] == ["Nikon Z9"]


def test_assign_several_species(client):
    heron = client.post("/species", json={"scientific_name": "Ardea cinerea"}).json()
    stork = client.post("/species", json={"scientific_name": "Ciconia ciconia"}).json()
    photo = upload(client).json()

    updated = client.patch(f"/photos/{photo['id']}", json={"species_ids": [stork["id"], heron["id"]]}).json()
    assert updated["species_ids"] == [stork["id"], heron["id"]]
    assert client.get("/photos", params={"species_id": heron["id"]}).json() == [updated]
    assert client.get("/photos", params={"species_id": stork["id"]}).json() == [updated]

    updated = client.patch(f"/photos/{photo['id']}", json={"species_ids": [heron["id"]]}).json()
    assert updated["species_ids"] == [heron["id"]]
    assert client.get("/photos", params={"species_id": stork["id"]}).json() == []


def test_assign_unknown_species(client):
    photo = upload(client).json()
    assert client.patch(f"/photos/{photo['id']}", json={"species_ids": [999]}).status_code == 400


def test_missing_photo(client):
    assert client.get("/photos/999").status_code == 404
