from tests.conftest import make_jpeg

HERON = {"scientific_name": "Ardea cinerea", "name_en": "Grey Heron", "name_pt": "Garça-real", "family": "Ardeidae"}


def test_create_and_get(client):
    created = client.post("/species", json=HERON)
    assert created.status_code == 201
    assert client.get(f"/species/{created.json()['id']}").json() == created.json()


def test_duplicate_scientific_name(client):
    client.post("/species", json=HERON)
    assert client.post("/species", json=HERON).status_code == 409


def test_search_matches_any_language(client):
    client.post("/species", json=HERON)
    client.post("/species", json={"scientific_name": "Ciconia ciconia", "name_en": "White Stork"})

    for q in ["ardea", "heron", "garça"]:
        names = [s["scientific_name"] for s in client.get("/species", params={"q": q}).json()]
        assert names == ["Ardea cinerea"]


def test_delete_missing_species(client):
    assert client.delete("/species/999").status_code == 404


def test_missing_species(client):
    assert client.get("/species/999").status_code == 404


def test_delete_hides_species_and_unlinks_photos(client):
    species = client.post("/species", json=HERON).json()
    photo = client.post("/photos", files={"file": ("bird.jpg", make_jpeg(), "image/jpeg")}).json()
    client.patch(f"/photos/{photo['id']}", json={"species_ids": [species["id"]]})

    assert client.delete(f"/species/{species['id']}").status_code == 204
    assert client.get(f"/species/{species['id']}").status_code == 404
    assert client.get("/species").json() == []
    assert client.get(f"/photos/{photo['id']}").json()["species_ids"] == []
    assert client.patch(f"/photos/{photo['id']}", json={"species_ids": [species["id"]]}).status_code == 400
