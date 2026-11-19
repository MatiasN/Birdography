from sqlalchemy.orm import Session

from app.db import engine
from app.models import Photo, Species
from tests.conftest import login, make_jpeg
from tests.test_catalogue_api import upload

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


# --- search with a full taxonomy (plan 0009 §3.4) --------------------------------------------------------------

ROBINS = [
    {"scientific_name": "Turdus migratorius", "name_en": "American Robin", "taxon_order": 30000},
    {
        "scientific_name": "Erithacus rubecula",
        "name_en": "European Robin",
        "name_pt": "Pisco-de-peito-ruivo",
        "taxon_order": 29444,
    },
    {"scientific_name": "Copsychus saularis", "name_en": "Oriental Magpie-Robin", "taxon_order": 29000},
    {"scientific_name": "Petroica boodang", "name_en": "Scarlet Robin", "taxon_order": 26000},
    {"scientific_name": "Robinia fakeus", "name_en": "Hand-added bird"},  # no taxon order
    {"scientific_name": "Ardea cinerea", "name_en": "Grey Heron", "name_pt": "Garça-real", "taxon_order": 7803},
]


def add_all(client) -> dict[str, int]:
    return {s["scientific_name"]: client.post("/species", json=s).json()["id"] for s in ROBINS}


def search(client, **params) -> list[str]:
    return [s["scientific_name"] for s in client.get("/species", params=params).json()]


def test_list_is_in_taxonomic_order_with_hand_added_species_last(client):
    add_all(client)
    assert search(client) == [
        "Ardea cinerea",
        "Petroica boodang",
        "Copsychus saularis",
        "Erithacus rubecula",
        "Turdus migratorius",
        "Robinia fakeus",
    ]


def test_search_ranks_names_starting_with_the_text_first(client):
    add_all(client)
    # "Robinia" and the word "Robin" in names start with "robin"; "Magpie-Robin" counts too (hyphen = space)
    assert search(client, q="robin") == [
        "Petroica boodang",
        "Copsychus saularis",
        "Erithacus rubecula",
        "Turdus migratorius",
        "Robinia fakeus",
    ]
    assert search(client, q="rubecula") == ["Erithacus rubecula"]
    assert search(client, q="obin")[:1] == ["Petroica boodang"]  # inside a word: still found, taxonomic order


def test_search_puts_species_you_photographed_first(client):
    ids = add_all(client)
    upload(client, species_ids=[ids["Erithacus rubecula"]])
    assert search(client, q="robin")[0] == "Erithacus rubecula"
    other = login("other@example.com")  # not their photo: plain order
    assert search(other, q="robin")[0] == "Petroica boodang"


def test_search_ignores_hyphens_and_wildcards(client):
    add_all(client)
    assert search(client, q="garca real") == ["Ardea cinerea"]
    assert search(client, q="pisco de peito") == ["Erithacus rubecula"]
    assert search(client, q="%") == [] and search(client, q="_") == []
    assert len(search(client, q="  ")) == len(ROBINS)  # blank: no filter


def test_photographed_keeps_your_species_only(client):
    ids = add_all(client)
    photo = upload(client, species_ids=[ids["Ardea cinerea"], ids["Turdus migratorius"]]).json()
    trashed = upload(client, species_ids=[ids["Petroica boodang"]]).json()
    assert client.delete(f"/photos/{trashed['id']}").status_code == 204
    assert search(client, photographed="true") == ["Ardea cinerea", "Turdus migratorius"]
    assert search(client, photographed="true", q="robin") == ["Turdus migratorius"]
    assert search(login("other@example.com"), photographed="true") == []
    assert photo["species_ids"]


# --- merging a hand-added species (plan 0009 D11a) -------------------------------------------------------------


def test_merge_moves_photos_and_trashes_the_hand_added_species(client):
    ids = add_all(client)
    mine, ebird = ids["Robinia fakeus"], ids["Erithacus rubecula"]
    only_mine = upload(client, species_ids=[ids["Ardea cinerea"], mine]).json()
    both = upload(client, species_ids=[mine, ebird]).json()
    others = upload(login("other@example.com"), species_ids=[mine]).json()

    merged = client.post(f"/species/{mine}/merge-into/{ebird}")
    assert merged.status_code == 200 and merged.json()["id"] == ebird
    assert client.get(f"/photos/{only_mine['id']}").json()["species_ids"] == [ids["Ardea cinerea"], ebird]
    assert client.get(f"/photos/{both['id']}").json()["species_ids"] == [ebird]
    with Session(engine) as db:
        assert [link.species_id for link in db.get(Photo, others["id"]).species_links] == [ebird]
        assert db.get(Species, mine).deleted_at is not None


def test_merge_refuses_what_it_cannot_do(client):
    ids = add_all(client)
    mine, ebird = ids["Robinia fakeus"], ids["Erithacus rubecula"]
    client.post("/species", json={"scientific_name": "Coded", "name_en": "Coded", "ebird_code": "coded1"})
    coded_id = client.get("/species", params={"q": "coded"}).json()[0]["id"]
    assert client.post(f"/species/{mine}/merge-into/999").status_code == 404
    assert client.post(f"/species/999/merge-into/{ebird}").status_code == 404
    assert client.post(f"/species/{mine}/merge-into/{mine}").status_code == 400
    answer = client.post(f"/species/{coded_id}/merge-into/{ebird}")
    assert answer.status_code == 400 and "added by hand" in answer.json()["detail"]
    client.delete(f"/species/{ebird}")
    assert client.post(f"/species/{mine}/merge-into/{ebird}").status_code == 404
