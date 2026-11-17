from tests.conftest import make_jpeg

HERON = {
    "scientific_name": "Ardea cinerea",
    "name_en": "Grey Heron",
    "name_pt": "Garça-real",
    "family": "Ardeidae",
    "order_name": "Pelecaniformes",
    "ebird_code": "gryher1",
    "taxon_order": 1063.0,
}


def test_create_and_get(client):
    created = client.post("/species", json=HERON)
    assert created.status_code == 201
    assert created.json() == {"id": created.json()["id"], **HERON}
    assert client.get(f"/species/{created.json()['id']}").json() == created.json()


def test_duplicate_scientific_name(client):
    client.post("/species", json=HERON)
    assert client.post("/species", json=HERON).status_code == 409


def test_duplicate_ebird_code(client):
    client.post("/species", json=HERON)
    assert (
        client.post(
            "/species", json={"scientific_name": "Other", "name_en": "Other", "ebird_code": "gryher1"}
        ).status_code
        == 409
    )


def test_search_ignores_case_accents_and_language(client):
    client.post("/species", json=HERON)
    client.post("/species", json={"scientific_name": "Ciconia ciconia", "name_en": "White Stork"})

    for q in ["ardea", "HERON", "garça", "garca", "GARCA-REAL"]:
        names = [s["scientific_name"] for s in client.get("/species", params={"q": q}).json()]
        assert names == ["Ardea cinerea"], q


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


def test_existing_species_is_named_in_the_409(client):
    heron = client.post("/species", json=HERON).json()
    for clash in ({"scientific_name": "ardea cinerea", "name_pt": "Garça"}, {**HERON, "scientific_name": "Other"}):
        response = client.post("/species", json=clash)
        assert response.status_code == 409
        assert response.json()["species_id"] == heron["id"]


def test_a_trashed_species_blocks_its_name_without_being_offered(client):
    heron = client.post("/species", json=HERON).json()
    client.delete(f"/species/{heron['id']}")
    response = client.post("/species", json=HERON)
    assert response.status_code == 409 and "species_id" not in response.json()


def test_a_concurrent_create_still_answers_409(client, monkeypatch):
    """The name was free when checked, then someone else took it before the commit."""
    from sqlalchemy.orm import Session

    from app import species as module

    real_scalar = Session.scalar
    checks = []

    def scalar(self, statement, *args, **kwargs):
        """The first look for a clashing species finds nothing; everything else runs for real."""
        if "FROM species" in str(statement):
            checks.append(statement)
            if len(checks) == 1:
                return None
        return real_scalar(self, statement, *args, **kwargs)

    first = client.post("/species", json=HERON).json()
    monkeypatch.setattr(Session, "scalar", scalar)
    response = client.post("/species", json=HERON)
    assert response.status_code == 409
    assert response.json() == {"detail": module.EXISTS, "species_id": first["id"]}
    assert len(checks) == 2  # looked again after the insert failed


def test_a_scientific_and_a_common_name_are_required(client):
    for missing in (
        {"name_en": "Grey Heron"},
        {"scientific_name": "  ", "name_en": "Grey Heron"},
        {"scientific_name": "Ardea cinerea"},
        {"scientific_name": "Ardea cinerea", "name_en": " ", "name_pt": ""},
    ):
        assert client.post("/species", json=missing).status_code == 422, missing


def test_portuguese_alone_is_enough_and_spaces_are_trimmed(client):
    created = client.post(
        "/species", json={"scientific_name": " Ardea cinerea ", "name_en": None, "name_pt": "Garça-real "}
    ).json()
    assert (created["scientific_name"], created["name_en"], created["name_pt"]) == (
        "Ardea cinerea",
        None,
        "Garça-real",
    )
