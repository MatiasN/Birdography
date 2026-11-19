"""What the Catalogue and the Upload tab need from the photo API (plan 0008 §4): species on photos, the filters,
counts, cameras, species set while uploading, and duplicates pointing at the existing photo."""

import pytest

from tests.conftest import login, make_jpeg, stored


def upload(client, data=None, species_ids=None):
    form = {"species_ids": [str(i) for i in species_ids]} if species_ids is not None else None
    return client.post("/photos", files={"file": ("bird.jpg", data or make_jpeg(), "image/jpeg")}, data=form)


def species(client, scientific, en):
    return client.post("/species", json={"scientific_name": scientific, "name_en": en}).json()


def ids(client, **params):
    return [p["id"] for p in client.get("/photos", params=params).json()]


def test_photos_carry_their_species_names_in_order(client):
    heron = species(client, "Ardea cinerea", "Grey Heron")
    stork = species(client, "Ciconia ciconia", "White Stork")
    photo = upload(client, species_ids=[stork["id"], heron["id"]]).json()

    assert [s["name_en"] for s in photo["species"]] == ["White Stork", "Grey Heron"]
    assert photo["species"][0] == {
        "id": stork["id"],
        "scientific_name": "Ciconia ciconia",
        "name_en": "White Stork",
        "name_pt": None,
        "ebird_code": None,
    }
    client.delete(f"/species/{stork['id']}")
    listed = client.get("/photos").json()[0]
    assert [s["id"] for s in listed["species"]] == [heron["id"]]


def test_species_filter_matches_any_of_several(client):
    heron = species(client, "Ardea cinerea", "Grey Heron")
    egret = species(client, "Egretta garzetta", "Little Egret")
    stork = species(client, "Ciconia ciconia", "White Stork")
    with_heron = upload(client, species_ids=[heron["id"]]).json()["id"]
    with_egret = upload(client, species_ids=[egret["id"]]).json()["id"]
    upload(client, species_ids=[stork["id"]])

    assert sorted(ids(client, species_id=[heron["id"], egret["id"]])) == sorted([with_heron, with_egret])


@pytest.mark.exiftool
def test_located_filter(client):
    placed = upload(client, make_jpeg(lat=38.7, lon=-9.1)).json()["id"]
    loose = upload(client).json()["id"]

    assert ids(client, located=True) == [placed]
    assert ids(client, located=False) == [loose]
    assert [p["id"] for p in client.get("/photos/points", params={"located": False}).json()] == []


@pytest.mark.exiftool
def test_date_filter_uses_the_day_on_the_camera_both_ends_included(client):
    # 23:30 local in UTC+10 is 13:30 UTC the same day, and 00:30 local in UTC-5 is 05:30 UTC: by the camera's
    # clock both are on the days written, whatever the instant.
    late = upload(client, make_jpeg(taken_at="2026:05:14 23:30:00", offset="+10:00")).json()["id"]
    early = upload(client, make_jpeg(taken_at="2026:05:16 00:30:00", offset="-05:00")).json()["id"]
    upload(client, make_jpeg(taken_at="2026:05:13 23:59:59"))

    assert ids(client, date_from="2026-05-14", date_to="2026-05-14") == [late]
    assert ids(client, date_from="2026-05-16") == [early]
    assert sorted(ids(client, date_from="2026-05-14", date_to="2026-05-16")) == sorted([late, early])
    assert ids(client, date_to="2026-05-13") != []


def test_summary_counts_photos_and_species_under_the_filters(client):
    heron = species(client, "Ardea cinerea", "Grey Heron")
    stork = species(client, "Ciconia ciconia", "White Stork")
    upload(client, species_ids=[heron["id"], stork["id"]])
    upload(client, species_ids=[heron["id"]])
    upload(client)

    assert client.get("/photos/summary").json() == {"photos": 3, "species": 2}
    assert client.get("/photos/summary", params={"species_id": stork["id"]}).json() == {"photos": 1, "species": 2}
    client.delete(f"/species/{stork['id']}")
    assert client.get("/photos/summary").json() == {"photos": 3, "species": 1}


def test_summary_of_an_empty_catalogue(client):
    assert client.get("/photos/summary").json() == {"photos": 0, "species": 0}


@pytest.mark.exiftool
def test_cameras_are_the_users_own_most_used_first(client):
    for camera in ("Nikon Z8", "Canon EOS R5", "Nikon Z8"):
        upload(client, make_jpeg(camera=camera))
    upload(client)  # no camera: not an option
    other = login("other@example.org")
    other.post("/photos", files={"file": ("x.jpg", make_jpeg(camera="Sony ILCE-7M4"), "image/jpeg")})

    assert client.get("/photos/cameras").json() == [
        {"make": "Nikon", "model": "Z8", "photos": 2},
        {"make": "Canon", "model": "EOS R5", "photos": 1},
    ]


def test_upload_with_unknown_species_stores_nothing(client):
    heron = species(client, "Ardea cinerea", "Grey Heron")
    response = upload(client, species_ids=[heron["id"], 999])
    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown species"
    assert stored() == []
    assert client.get("/photos").json() == []


def test_upload_without_species(client):
    photo = upload(client).json()
    assert photo["species"] == []


def test_duplicate_points_at_the_users_own_photo(client):
    data = make_jpeg()
    first = upload(client, data).json()
    response = upload(client, data)
    assert response.status_code == 409
    assert response.json() == {"detail": "This file has already been uploaded", "photo_id": first["id"]}


def test_duplicate_of_a_trashed_or_someone_elses_photo_names_no_photo(client):
    data = make_jpeg()
    other = login("other@example.org")
    assert other.post("/photos", files={"file": ("x.jpg", data, "image/jpeg")}).status_code == 201
    response = upload(client, data)
    assert response.status_code == 409 and "photo_id" not in response.json()

    own = make_jpeg()
    photo = upload(client, own).json()
    client.delete(f"/photos/{photo['id']}")
    response = upload(client, own)
    assert response.status_code == 409 and "photo_id" not in response.json()
