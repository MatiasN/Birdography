"""Loading the eBird taxonomy (plan 0009 §3). eBird is never called: downloads are replaced by small fixtures."""

import io
import json
import urllib.error
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli, taxonomy
from app.db import engine
from app.models import Species


def entry(code, sci, name, category="species", order=1.0, family="Ardeidae", **extra):
    return {
        "speciesCode": code,
        "sciName": sci,
        "comName": name,
        "category": category,
        "taxonOrder": order,
        "order": "Pelecaniformes",
        "familySciName": family,
        **extra,
    }


EN = [
    entry("graher1", "Ardea cinerea", "Grey Heron", order=7803.0),
    entry("gryher1", "Ardea cinerea cinerea/jouyi", "Grey Heron (Grey)", category="issf", order=7804.0),
    entry("heron1", "Ardea sp.", "heron sp.", category="spuh", order=7900.0),
    entry("x00001", "Ardea cinerea x alba", "Grey x Great Egret (hybrid)", category="hybrid", order=7901.0),
    entry("litegr", "Egretta garzetta", "Little Egret", order=7830.0),
    entry("whisto1", "Ciconia ciconia", "White Stork", order=7346.0, family="Ciconiidae"),
]
PT = [
    entry("graher1", "Ardea cinerea", "Garça-real"),
    entry("litegr", "Egretta garzetta", "Garça-branca-pequena"),
    # White Stork has no Portuguese name here: the English one stands in
]
RAW = {"en_UK": EN, "pt_PT": PT}


def species() -> dict[str, Species]:
    with Session(engine) as db:
        return {s.scientific_name: s for s in db.scalars(select(Species))}


def load(raw=RAW) -> taxonomy.Report:
    with Session(engine) as db:
        return taxonomy.load(db, taxonomy.entries(raw))


# --- reading -----------------------------------------------------------------------------------------------------


def test_entries_are_the_species_in_taxonomic_order_with_both_names():
    found = taxonomy.entries(RAW)
    assert [e.ebird_code for e in found] == ["whisto1", "graher1", "litegr"]
    heron = found[1]
    assert (heron.name_en, heron.name_pt, heron.family, heron.order_name) == (
        "Grey Heron",
        "Garça-real",
        "Ardeidae",
        "Pelecaniformes",
    )
    assert heron.taxon_order == Decimal("7803.0")
    assert found[0].name_pt == "White Stork"


def test_an_unexpected_format_is_a_clear_error():
    with pytest.raises(taxonomy.TaxonomyError, match="missing 'sciName'"):
        taxonomy.entries({"en_UK": [{"speciesCode": "a", "category": "species"}], "pt_PT": []})


class Responses:
    """Stands in for urlopen: JSON bodies by URL fragment, or an exception."""

    def __init__(self, monkeypatch, bodies=None, error=None):
        self.urls = []
        self.bodies, self.error = bodies or {}, error
        monkeypatch.setattr(taxonomy.urllib.request, "urlopen", self)

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        if self.error:
            raise self.error
        body = next(value for key, value in self.bodies.items() if key in request.full_url)
        return io.BytesIO(json.dumps(body).encode())


def test_fetch_downloads_each_locale(monkeypatch):
    responses = Responses(monkeypatch, {"locale=en_UK": EN, "locale=pt_PT": PT})
    assert taxonomy.fetch() == RAW
    assert all(url.startswith(taxonomy.API + "/ebird?fmt=json") for url in responses.urls)


def test_fetch_with_a_folder_saves_downloads_and_reuses_them(monkeypatch, tmp_path):
    folder = tmp_path / "taxonomy"
    (folder).mkdir()
    (folder / "pt_PT.json").write_text(json.dumps(PT))
    responses = Responses(monkeypatch, {"locale=en_UK": EN})
    assert taxonomy.fetch(folder) == RAW
    assert len(responses.urls) == 1  # pt_PT came from the folder
    assert json.loads((folder / "en_UK.json").read_text()) == EN
    assert taxonomy.fetch(folder) == RAW and len(responses.urls) == 1


def test_fetch_reports_a_broken_file(tmp_path):
    (tmp_path / "en_UK.json").write_text("{not json")
    with pytest.raises(taxonomy.TaxonomyError, match="en_UK.json is not valid JSON"):
        taxonomy.fetch(tmp_path)


@pytest.mark.parametrize("error", [urllib.error.URLError("no network"), TimeoutError("slow")])
def test_download_errors_are_clear(monkeypatch, error):
    Responses(monkeypatch, error=error)
    with pytest.raises(taxonomy.TaxonomyError, match="could not download https://api.ebird.org"):
        taxonomy.download("en_UK")


def test_latest_version(monkeypatch):
    Responses(
        monkeypatch, {"versions": [{"authorityVer": 2025.0, "latest": False}, {"authorityVer": 2026.0, "latest": True}]}
    )
    assert taxonomy.latest_version() == "2026"
    Responses(monkeypatch, {"versions": []})
    assert taxonomy.latest_version() is None


# --- loading -----------------------------------------------------------------------------------------------------


def test_first_load_adds_every_species():
    report = load()
    assert (report.added, report.updated, report.unchanged) == (3, 0, 0)
    heron = species()["Ardea cinerea"]
    assert (heron.ebird_code, heron.name_pt, heron.taxon_order) == ("graher1", "Garça-real", Decimal("7803.00"))


def test_loading_again_changes_nothing():
    load()
    report = load()
    assert (report.added, report.updated, report.unchanged) == (0, 0, 3)
    assert report.lines() == ["0 added, 0 updated, 3 unchanged, 0 existing species matched by scientific name"]


def test_existing_species_are_matched_kept_or_reported():
    with Session(engine) as db:
        db.add_all(
            [
                Species(scientific_name="ardea CINEREA", name_en="Heron (typed by hand)"),  # adopted
                Species(scientific_name="Troglodytes troglodytes", name_en="Wren"),  # not in eBird
                Species(scientific_name="Oldus lumpus", name_en="Lumped", ebird_code="lumped1"),  # gone from eBird
                Species(
                    scientific_name="Egretta garzetta",
                    name_en="Little Egret",
                    ebird_code="litegr",
                    deleted_at=datetime.now(UTC),
                ),  # in the trash, updated anyway
            ]
        )
        db.commit()
    report = load()
    rows = species()
    heron = rows["Ardea cinerea"]  # eBird's spelling of the scientific name too
    assert (heron.ebird_code, heron.name_en) == ("graher1", "Grey Heron")
    egret = rows["Egretta garzetta"]
    assert egret.name_pt == "Garça-branca-pequena" and egret.deleted_at is not None
    assert rows["Troglodytes troglodytes"].name_en == "Wren"
    assert (report.added, report.updated) == (1, 1)
    assert (report.adopted, report.custom, report.gone) == (["Ardea cinerea"], ["Troglodytes troglodytes"], ["lumped1"])
    lines = "\n".join(report.lines())
    assert "1 existing species matched by scientific name" in lines
    assert "Not in eBird, left as they are" in lines and "No longer in the eBird taxonomy, kept: lumped1" in lines


def test_a_new_code_for_the_same_species_is_followed():
    with Session(engine) as db:
        db.add(Species(scientific_name="Ciconia ciconia", name_en="White Stork", ebird_code="whisto"))
        db.commit()
    report = load()
    assert species()["Ciconia ciconia"].ebird_code == "whisto1"
    assert report.gone == [] and report.updated == 1


def test_a_rename_is_followed_unless_another_species_has_the_new_name():
    load()
    renamed = [entry("graher1", "Ardea cinerea major", "Grey Heron", order=7803.0), *EN[1:]]
    load({"en_UK": renamed, "pt_PT": PT})
    assert "Ardea cinerea major" in species() and "Ardea cinerea" not in species()

    clash = [entry("graher1", "Egretta garzetta", "Grey Heron", order=7803.0), *EN[1:]]
    report = load({"en_UK": clash, "pt_PT": PT})
    assert report.skipped == ["Ardea cinerea major → Egretta garzetta"]
    assert species()["Ardea cinerea major"].ebird_code == "graher1"
    assert "Skipped: the new scientific name belongs to another species" in "\n".join(report.lines())


def test_loaded():
    found = taxonomy.entries(RAW)
    with Session(engine) as db:
        assert not taxonomy.loaded(db, found)
        taxonomy.load(db, found)
        assert taxonomy.loaded(db, found)


# --- the command -------------------------------------------------------------------------------------------------


def run(monkeypatch, capsys, *argv) -> str:
    monkeypatch.setattr("sys.argv", ["cli", "import-taxonomy", *argv])
    cli.main()
    return capsys.readouterr().out


def test_command_downloads_and_loads(monkeypatch, capsys):
    Responses(monkeypatch, {"versions": [{"authorityVer": 2026.0, "latest": True}], "en_UK": EN, "pt_PT": PT})
    out = run(monkeypatch, capsys)
    assert "Downloading the eBird taxonomy (version 2026)" in out
    assert "3 added" in out and taxonomy.ATTRIBUTION in out


def test_command_with_a_folder_and_if_missing(monkeypatch, capsys, tmp_path):
    for locale, body in RAW.items():
        (tmp_path / f"{locale}.json").write_text(json.dumps(body))
    Responses(monkeypatch, error=AssertionError("no download expected"))
    assert "3 added" in run(monkeypatch, capsys, "--dir", str(tmp_path), "--if-missing")
    assert "All 3 eBird species are loaded already" in run(monkeypatch, capsys, "--dir", str(tmp_path), "--if-missing")


def test_command_fails_clearly_without_network(monkeypatch, capsys):
    Responses(monkeypatch, error=urllib.error.URLError("no network"))
    with pytest.raises(SystemExit, match="import-taxonomy: could not download"):
        run(monkeypatch, capsys)
