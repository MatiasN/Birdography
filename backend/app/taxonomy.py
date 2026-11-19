"""The eBird taxonomy as the built-in species list (plan 0009 §3).

The taxonomy is downloaded from the eBird API when the import runs (no API key needed) and never shipped with
Birdography, because eBird's terms don't allow redistributing it. English names are eBird's UK English, Portuguese
names its Portugal Portuguese. Only `category: species` entries are loaded; subspecies groups, hybrids, "spuh" and
slash entries are not species a photo is tagged with.
"""

import json
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Species

API = "https://api.ebird.org/v2/ref/taxonomy"
LOCALES = {"name_en": "en_UK", "name_pt": "pt_PT"}
TIMEOUT = 120  # seconds; each locale is about 6 MB
ATTRIBUTION = "Species names and taxonomy from eBird (ebird.org), Cornell Lab of Ornithology"


class TaxonomyError(Exception):
    """The taxonomy could not be downloaded or read."""


@dataclass(frozen=True)
class Entry:
    ebird_code: str
    scientific_name: str
    name_en: str
    name_pt: str
    family: str | None
    order_name: str | None
    taxon_order: Decimal

    def fields(self) -> dict:
        return asdict(self)


@dataclass
class Report:
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    adopted: list[str] = field(default_factory=list)  # existing species that got their eBird code
    custom: list[str] = field(default_factory=list)  # species not in eBird, left as they are
    gone: list[str] = field(default_factory=list)  # eBird codes no longer in the taxonomy
    skipped: list[str] = field(default_factory=list)  # renames that clash with another species

    def lines(self) -> list[str]:
        out = [
            f"{self.added} added, {self.updated} updated, {self.unchanged} unchanged, {len(self.adopted)} existing "
            f"species matched by scientific name"
        ]
        for title, names in (
            ("Matched by scientific name (names now eBird's)", self.adopted),
            (
                "Not in eBird, left as they are (merge them with `merge-species` if they are an eBird species)",
                self.custom,
            ),
            ("No longer in the eBird taxonomy, kept", self.gone),
            ("Skipped: the new scientific name belongs to another species", self.skipped),
        ):
            if names:
                out.append(f"{title}: {', '.join(sorted(names))}")
        return out


def _get(url: str):
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Birdography"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        raise TaxonomyError(f"could not download {url}: {err}") from err


def download(locale: str) -> list[dict]:
    return _get(f"{API}/ebird?fmt=json&locale={locale}")


def latest_version() -> str | None:
    """The newest taxonomy version eBird lists, e.g. "2026"; None if eBird doesn't say."""
    versions = _get(f"{API}/versions")
    latest = next((v["authorityVer"] for v in versions if v.get("latest")), None)
    return None if latest is None else f"{latest:g}"


def fetch(directory: Path | None = None) -> dict[str, list[dict]]:
    """The raw taxonomy per locale. With `directory`, `<locale>.json` there is used when present, and a downloaded
    one is saved there, so later imports (and installs without internet) don't download again."""
    raw = {}
    for locale in LOCALES.values():
        path = directory / f"{locale}.json" if directory else None
        if path and path.exists():
            try:
                raw[locale] = json.loads(path.read_text(encoding="utf-8"))
            except ValueError as err:
                raise TaxonomyError(f"{path} is not valid JSON: {err}") from err
            continue
        raw[locale] = download(locale)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(raw[locale], ensure_ascii=False), encoding="utf-8")
    return raw


def entries(raw: dict[str, list[dict]]) -> list[Entry]:
    """The species of the taxonomy with their names in both languages, in taxonomic order."""
    english, portuguese = (raw[LOCALES[key]] for key in ("name_en", "name_pt"))
    pt_names = {item["speciesCode"]: item["comName"] for item in portuguese}
    try:
        return sorted(
            (
                Entry(
                    ebird_code=item["speciesCode"],
                    scientific_name=item["sciName"],
                    name_en=item["comName"],
                    name_pt=pt_names.get(item["speciesCode"]) or item["comName"],
                    family=item.get("familySciName"),
                    order_name=item.get("order"),
                    taxon_order=Decimal(str(item["taxonOrder"])),
                )
                for item in english
                if item.get("category") == "species"
            ),
            key=lambda entry: entry.taxon_order,
        )
    except (KeyError, TypeError) as err:
        raise TaxonomyError(f"unexpected taxonomy format: missing {err}") from err


def loaded(db: Session, taxonomy: list[Entry]) -> bool:
    """Whether every species of `taxonomy` is in the table already (by eBird code)."""
    codes = [entry.ebird_code for entry in taxonomy]
    found = db.scalar(select(func.count()).select_from(Species).where(Species.ebird_code.in_(codes))) or 0
    return found == len(codes)


def load(db: Session, taxonomy: list[Entry]) -> Report:
    """Add and update species from `taxonomy`, in one transaction (see the table in plan 0009 §3.2).

    A species is found by its eBird code, else by its scientific name (any case), which adopts a species added by
    hand: it gets the code and eBird's names. Species in the trash are updated but stay there. Nothing is deleted.
    """
    report = Report()
    rows = db.scalars(select(Species)).all()
    by_code = {row.ebird_code: row for row in rows if row.ebird_code}
    by_name = {row.scientific_name.lower(): row for row in rows}
    seen = set()
    for entry in taxonomy:
        row = by_code.get(entry.ebird_code)
        if row is None and (row := by_name.get(entry.scientific_name.lower())) is not None:
            if row.ebird_code:  # eBird changed this species' code: follow it
                by_code.pop(row.ebird_code, None)
            else:
                report.adopted.append(entry.scientific_name)
        if row is None:
            row = Species(**entry.fields())
            db.add(row)
            report.added += 1
        else:
            owner = by_name.get(entry.scientific_name.lower())
            if owner is not None and owner is not row:
                report.skipped.append(f"{row.scientific_name} → {entry.scientific_name}")
                seen.add(row.id)
                continue
            changed = {key: value for key, value in entry.fields().items() if getattr(row, key) != value}
            if changed:
                by_name.pop(row.scientific_name.lower(), None)
                for key, value in changed.items():
                    setattr(row, key, value)
                if entry.scientific_name not in report.adopted:
                    report.updated += 1
            else:
                report.unchanged += 1
            seen.add(row.id)
        by_code[entry.ebird_code] = row
        by_name[entry.scientific_name.lower()] = row
    for row in rows:
        if row.id not in seen:
            (report.gone if row.ebird_code else report.custom).append(row.ebird_code or row.scientific_name)
    db.commit()
    return report
