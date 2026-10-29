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


def test_missing_species(client):
    assert client.get("/species/999").status_code == 404
