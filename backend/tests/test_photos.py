import pytest

from tests.conftest import make_jpeg


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


def test_rejects_unsupported_type(client):
    assert upload(client, b"<html>", name="evil.html").status_code == 400


def test_file_is_served(client):
    data = make_jpeg()
    photo = upload(client, data).json()
    response = client.get(f"/photos/{photo['id']}/file")
    assert response.content == data


def test_list_filters_by_camera(client):
    upload(client, make_jpeg(camera="Canon EOS R5"))
    upload(client, make_jpeg(camera="Nikon Z9"))

    photos = client.get("/photos", params={"camera": "Nikon Z9"}).json()
    assert [p["camera"] for p in photos] == ["Nikon Z9"]


def test_assign_species(client):
    species = client.post("/species", json={"scientific_name": "Ardea cinerea"}).json()
    photo = upload(client).json()

    updated = client.patch(f"/photos/{photo['id']}", json={"species_id": species["id"]}).json()
    assert updated["species_id"] == species["id"]
    assert client.get("/photos", params={"species_id": species["id"]}).json() == [updated]


def test_assign_unknown_species(client):
    photo = upload(client).json()
    assert client.patch(f"/photos/{photo['id']}", json={"species_id": 999}).status_code == 400


def test_missing_photo(client):
    assert client.get("/photos/999").status_code == 404
