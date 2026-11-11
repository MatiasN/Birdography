import pytest

from app import storage
from app.config import settings
from tests.conftest import login, make_jpeg, stored


def upload(client, data=None, name="bird.jpg"):
    return client.post("/photos", files={"file": (name, data or make_jpeg(), "image/jpeg")})


@pytest.mark.exiftool
def test_upload_reads_exif(client):
    data = make_jpeg(
        camera="Canon EOS R5",
        taken_at="2026:05:14 07:32:10",
        offset="+01:00",
        lat=38.5,
        lon=-9.25,
        settings={"iso": 800, "exposure": (1, 500), "fnumber": (28, 5), "focal_length": (600, 1)},
    )
    photo = upload(client, data).json()

    assert photo["camera"] == "Canon EOS R5"
    assert photo["taken_at_local"] == "2026-05-14T07:32:10"
    assert photo["taken_offset_minutes"] == 60
    assert photo["taken_at"] == "2026-05-14T06:32:10Z"
    assert photo["taken_at_manual"] is False
    assert photo["lat"] == pytest.approx(38.5)
    assert photo["lon"] == pytest.approx(-9.25)
    assert photo["iso"] == 800
    assert photo["shutter_seconds"] == pytest.approx(0.002)
    assert photo["aperture"] == pytest.approx(5.6)
    assert photo["focal_length_mm"] == pytest.approx(600)


def test_upload_without_exiftool_keeps_the_photo(client, monkeypatch, tmp_path, caplog):
    """Metadata is lost, not the upload; `reread-metadata` fills it in once ExifTool is installed."""
    monkeypatch.setattr(settings, "exiftool_path", str(tmp_path / "missing-exiftool"))
    response = upload(client, make_jpeg(camera="Canon EOS R5", taken_at="2026:05:14 07:32:10"))
    assert response.status_code == 201
    assert response.json()["camera"] is None and response.json()["taken_at"] is None
    assert "metadata not read" in caplog.text


def test_upload_without_exif(client):
    photo = upload(client).json()
    assert photo["taken_at"] is None
    assert photo["taken_at_local"] is None
    assert photo["lat"] is None
    assert photo["iso"] is None


def test_upload_records_original_file(client):
    data = make_jpeg()
    photo = upload(client, data, name="DSC_0001.jpg").json()

    file, thumbnail = photo["files"]
    assert file["kind"] == "original"
    assert thumbnail["kind"] == "thumbnail"
    assert file["format"] == "jpeg"
    assert file["is_raw"] is False
    assert file["size_bytes"] == len(data)
    assert (file["width"], file["height"]) == (8, 8)
    assert file["url"] == f"/photos/{photo['id']}/file?kind=original"


def test_duplicate_upload_is_rejected_for_everyone(client):
    data = make_jpeg()
    assert upload(client, data).status_code == 201
    assert upload(client, data, name="again.jpg").status_code == 409

    other = login("other@example.com")
    assert upload(other, data).status_code == 409
    assert other.get("/photos").json() == []


def test_type_comes_from_content_not_extension(client):
    photo = upload(client, make_jpeg(), name="DSC_0001.NEF").json()
    assert photo["files"][0]["is_raw"] is False
    assert photo["files"][0]["format"] == "jpeg"


def test_rejects_unsupported_type(client):
    assert upload(client, b"<html>", name="evil.jpg").status_code == 415
    assert stored() == []


def test_file_is_served_with_fallback(client):
    data = make_jpeg()
    photo = upload(client, data).json()
    original = client.get(f"/photos/{photo['id']}/file", params={"kind": "original"})
    assert original.content == data
    assert original.headers["content-type"] == "image/jpeg"
    # A JPEG needs no preview: that kind falls back to the original. The thumbnail exists.
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "preview"}).content == data
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "thumbnail"}).content != data
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "huge"}).status_code == 422


@pytest.mark.exiftool
def test_list_filters_by_camera(client):
    upload(client, make_jpeg(camera="Canon EOS R5"))
    upload(client, make_jpeg(camera="Nikon Z9"))

    photos = client.get("/photos", params={"camera": "Nikon Z9"}).json()
    assert [p["camera"] for p in photos] == ["Nikon Z9"]


@pytest.mark.exiftool
def test_list_filters_by_date(client):
    early = upload(client, make_jpeg(taken_at="2026:01:10 08:00:00")).json()
    late = upload(client, make_jpeg(taken_at="2026:06:10 08:00:00")).json()

    assert client.get("/photos", params={"taken_from": "2026-03-01T00:00:00Z"}).json() == [late]
    assert client.get("/photos", params={"taken_to": "2026-03-01T00:00:00Z"}).json() == [early]
    params = {"taken_from": "2026-01-01T00:00:00Z", "taken_to": "2026-12-31T00:00:00Z"}
    assert [p["id"] for p in client.get("/photos", params=params).json()] == [late["id"], early["id"]]


def test_assign_and_clear_location(client):
    location = client.post("/locations", json={"name": "Home", "lat": 38.7, "lon": -9.1}).json()
    photo = upload(client).json()

    assert (
        client.patch(f"/photos/{photo['id']}", json={"location_id": location["id"]}).json()["location_id"]
        == (location["id"])
    )
    assert client.patch(f"/photos/{photo['id']}", json={"location_id": None}).json()["location_id"] is None
    assert client.patch(f"/photos/{photo['id']}", json={"location_id": 999}).status_code == 400

    other = login("other@example.com")
    theirs = other.post("/locations", json={"name": "Away", "lat": 0, "lon": 0}).json()
    assert client.patch(f"/photos/{photo['id']}", json={"location_id": theirs["id"]}).status_code == 400


def test_file_missing_on_disk(client):
    photo = upload(client).json()
    for name in stored():
        storage.remove(name)
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "original"}).status_code == 404


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


@pytest.mark.exiftool
def test_user_overrides_taken_date(client):
    photo = upload(client, make_jpeg(taken_at="2020:01:01 00:00:00")).json()

    fixed = client.patch(f"/photos/{photo['id']}", json={"taken_at_local": "2026-05-14T07:32:10"}).json()
    assert fixed["taken_at_local"] == "2026-05-14T07:32:10"
    assert fixed["taken_at"] == "2026-05-14T07:32:10Z"
    assert fixed["taken_at_manual"] is True

    with_offset = client.patch(f"/photos/{photo['id']}", json={"taken_at_local": "2026-05-14T07:32:10-03:00"}).json()
    assert with_offset["taken_offset_minutes"] == -180
    assert with_offset["taken_at"] == "2026-05-14T10:32:10Z"

    reverted = client.patch(f"/photos/{photo['id']}", json={"taken_at_local": None}).json()
    assert reverted["taken_at_local"] == "2020-01-01T00:00:00"
    assert reverted["taken_at_manual"] is False


@pytest.mark.exiftool
def test_offset_comes_from_gps_when_the_camera_has_none(client):
    photo = upload(client, make_jpeg(taken_at="2020:04:02 18:19:31", lat=37.3, lon=-78.4)).json()
    assert photo["taken_offset_minutes"] == -240
    assert photo["taken_at"] == "2020-04-02T22:19:31Z"
    assert photo["point_manual"] is False


@pytest.mark.exiftool
def test_user_places_photo_on_the_map(client):
    """No GPS: the user picks the spot; the offset follows it, and the camera's data comes back on revert."""
    photo = upload(client, make_jpeg(taken_at="2026:05:14 07:32:10")).json()
    assert (photo["lat"], photo["taken_offset_minutes"]) == (None, None)

    placed = client.patch(f"/photos/{photo['id']}", json={"lat": 38.7, "lon": -9.1}).json()
    assert (placed["lat"], placed["lon"], placed["point_manual"]) == (pytest.approx(38.7), pytest.approx(-9.1), True)
    assert placed["taken_offset_minutes"] == 60 and placed["taken_at"] == "2026-05-14T06:32:10Z"
    assert placed["taken_at_manual"] is False
    assert client.get("/photos", params={"camera": None}).json()[0]["lat"] == pytest.approx(38.7)

    moved = client.patch(f"/photos/{photo['id']}", json={"lat": 40.7, "lon": -74.0}).json()
    assert moved["taken_offset_minutes"] == -240

    cleared = client.patch(f"/photos/{photo['id']}", json={"lat": None, "lon": None}).json()
    assert (cleared["lat"], cleared["point_manual"], cleared["taken_offset_minutes"]) == (None, False, None)
    assert cleared["taken_at"] == "2026-05-14T07:32:10Z"


@pytest.mark.exiftool
def test_user_position_overrides_camera_gps_and_revert_restores_it(client):
    photo = upload(client, make_jpeg(taken_at="2026:05:14 07:32:10", offset="+02:00", lat=38.5, lon=-9.25)).json()
    placed = client.patch(f"/photos/{photo['id']}", json={"lat": 40.7, "lon": -74.0}).json()
    assert placed["lon"] == pytest.approx(-74.0) and placed["point_manual"] is True
    assert placed["taken_offset_minutes"] == 120  # the camera's own offset still wins

    reverted = client.patch(f"/photos/{photo['id']}", json={"lat": None, "lon": None}).json()
    assert (reverted["lat"], reverted["lon"]) == (pytest.approx(38.5), pytest.approx(-9.25))
    assert reverted["point_manual"] is False


@pytest.mark.exiftool
def test_manual_date_is_left_alone_when_the_position_changes(client):
    photo = upload(client, make_jpeg(taken_at="2026:05:14 07:32:10")).json()
    client.patch(f"/photos/{photo['id']}", json={"taken_at_local": "2024-06-01T12:00:00-03:00"})
    placed = client.patch(f"/photos/{photo['id']}", json={"lat": 38.7, "lon": -9.1}).json()
    assert (placed["taken_at_local"], placed["taken_offset_minutes"]) == ("2024-06-01T12:00:00", -180)
    # Reverting the date derives the offset from the spot the user chose.
    reverted = client.patch(f"/photos/{photo['id']}", json={"taken_at_local": None}).json()
    assert (reverted["taken_at_local"], reverted["taken_offset_minutes"]) == ("2026-05-14T07:32:10", 60)
    # Both in one request: the new position decides the offset of the reverted date.
    both = client.patch(f"/photos/{photo['id']}", json={"taken_at_local": None, "lat": 40.7, "lon": -74.0}).json()
    assert both["taken_offset_minutes"] == -240


def test_position_must_be_a_complete_valid_pair(client):
    photo = upload(client).json()
    bodies = ({"lat": 38.7}, {"lon": -9.1}, {"lat": 38.7, "lon": None}, {"lat": 91, "lon": 0}, {"lat": 0, "lon": 181})
    for body in bodies:
        assert client.patch(f"/photos/{photo['id']}", json=body).status_code == 422, body


def test_delete_moves_to_trash(client):
    photo = upload(client).json()
    assert client.delete(f"/photos/{photo['id']}").status_code == 204

    assert client.get(f"/photos/{photo['id']}").status_code == 404
    assert client.get("/photos").json() == []
    # The files stay until the trash is purged.
    assert len(stored()) == 2


def test_missing_photo(client):
    assert client.get("/photos/999").status_code == 404


def test_points_are_every_located_photo_of_the_user(client):
    located = upload(client, make_jpeg(lat=37.0, lon=-8.0)).json()
    placed = upload(client).json()
    client.patch(f"/photos/{placed['id']}", json={"lat": 38.5, "lon": -9.25})
    upload(client)  # no position: not on the map
    gone = upload(client, make_jpeg(lat=1.0, lon=1.0)).json()
    client.delete(f"/photos/{gone['id']}")
    login("other@example.com").post("/photos", files={"file": ("x.jpg", make_jpeg(lat=5.0, lon=5.0), "image/jpeg")})

    points = client.get("/photos/points").json()
    by_id = {p["id"]: p for p in points}
    assert set(by_id) == {located["id"], placed["id"]}
    assert by_id[placed["id"]] == {"id": placed["id"], "lat": 38.5, "lon": -9.25}
    assert by_id[located["id"]]["lat"] == pytest.approx(37.0)
    assert by_id[located["id"]]["lon"] == pytest.approx(-8.0)


def test_points_have_no_limit(client):
    from sqlalchemy import update
    from sqlalchemy.orm import Session

    from app.db import engine
    from app.models import Photo

    for _ in range(205):
        upload(client)
    with Session(engine) as db:
        db.execute(update(Photo).values(point="SRID=4326;POINT(-8 37)"))
        db.commit()
    assert len(client.get("/photos/points").json()) == 205


@pytest.mark.exiftool
def test_points_use_the_list_filters(client):
    upload(client, make_jpeg(camera="Canon EOS R5", lat=37.0, lon=-8.0, taken_at="2026:01:10 08:00:00"))
    nikon = upload(client, make_jpeg(camera="Nikon Z9", lat=38.0, lon=-9.0, taken_at="2026:06:10 08:00:00")).json()

    assert [p["id"] for p in client.get("/photos/points", params={"camera": "Nikon Z9"}).json()] == [nikon["id"]]
    from_march = client.get("/photos/points", params={"taken_from": "2026-03-01T00:00:00Z"}).json()
    assert [p["id"] for p in from_march] == [nikon["id"]]


def test_points_need_login(anon):
    assert anon.get("/photos/points").status_code == 401
