"""Seed a development stack with a known account and photos of real birds spread over a map.

Run by `scripts/dev.sh` inside the backend container (`python -m devtools.seed`), never in production: it refuses
to start unless BIRDOGRAPHY_DEV=1, which only compose.dev.yml sets. The password comes from DEV_USER_PASSWORD so
it doesn't show in the process list.

Each photo is a crop of one of the sample photos in `samples/` (credits in `samples/CREDITS.md`), tagged with the
species it shows, with generated EXIF (position, time, camera). Photos go through `photos.ingest`, the same path as
`POST /photos`, so their metadata, time zones and thumbnails are what a real upload of the same JPEG would give.
Photo number n is always the same image at the same spot for a given `--seed`, so a bug seen on photo 137 can be
reproduced (its number is in the file name and the EXIF description); adding more continues the numbering.
"""

import argparse
import io
import math
import os
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from functools import cache
from pathlib import Path

from PIL import Image, ImageOps
from PIL.TiffImagePlugin import IFDRational
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import derivatives, storage, timezones
from app.auth import create_user, password_problem, passwords, set_password
from app.cli import drop_root
from app.db import engine
from app.models import Photo, Species, User
from app.photos import DUPLICATE, Rejected, ingest, species_links

KM_PER_DEGREE = 111.32
MAX_LAT = 85.0  # Web Mercator, what the map can show
SAME_SPOT_HOTSPOTS = 3  # same-spot photos share the busiest few hotspots
REGIONS = {  # lat1, lon1, lat2, lon2
    "portugal": (36.95, -9.5, 42.15, -6.2),
    "iberia": (36.0, -9.5, 43.8, 3.3),
    "europe": (36.0, -10.0, 70.0, 40.0),
    "world": (-55.0, -180.0, 72.0, 180.0),
}
# Bodies of the RAW fixtures, with lenses birders put on them.
CAMERAS = [
    ("NIKON CORPORATION", "NIKON Z5_2", "NIKKOR Z 180-600mm f/5.6-6.3 VR"),
    ("Canon", "Canon EOS R6 Mark III", "RF100-500mm F4.5-7.1 L IS USM"),
    ("SONY", "ILCE-7S", "FE 200-600mm F5.6-6.3 G OSS"),
    ("Canon", "Canon EOS 5D Mark III", "EF100-400mm f/4.5-5.6L IS II USM"),
]
SAMPLES_DIR = Path(__file__).parent / "samples"


@dataclass(frozen=True)
class SampleSpecies:
    """A species as the eBird taxonomy gives it (2026, English UK and Portuguese PT names)."""

    ebird_code: str
    scientific_name: str
    name_en: str
    name_pt: str
    family: str
    order_name: str
    taxon_order: int


HERON = SampleSpecies("graher1", "Ardea cinerea", "Grey Heron", "Garça-real", "Ardeidae", "Pelecaniformes", 7803)
CORMORANT = SampleSpecies(
    "grecor", "Phalacrocorax carbo", "Great Cormorant", "Corvo-marinho-comum", "Phalacrocoracidae", "Suliformes", 7452
)
WREN = SampleSpecies(
    "winwre4", "Nannus troglodytes", "Eurasian Wren", "Carriça", "Troglodytidae", "Passeriformes", 27418
)
CRESTED_TIT = SampleSpecies(
    "cretit2", "Lophophanes cristatus", "Crested Tit", "Chapim-de-poupa", "Paridae", "Passeriformes", 22093
)
ROBIN = SampleSpecies(
    "eurrob1", "Erithacus rubecula", "European Robin", "Pisco-de-peito-ruivo", "Muscicapidae", "Passeriformes", 29444
)
CHAFFINCH = SampleSpecies(
    "comcha", "Fringilla coelebs", "Common Chaffinch", "Tentilhão", "Fringillidae", "Passeriformes", 32187
)
SWAN = SampleSpecies("whoswa", "Cygnus cygnus", "Whooper Swan", "Cisne-bravo", "Anatidae", "Anseriformes", 396)
BLUE_TIT = SampleSpecies(
    "blutit", "Cyanistes caeruleus", "Eurasian Blue Tit", "Chapim-azul", "Paridae", "Passeriformes", 22213
)
SPARROW = SampleSpecies(
    "houspa", "Passer domesticus", "House Sparrow", "Pardal-do-telhado", "Passeridae", "Passeriformes", 31772
)
LONG_TAILED_TIT = SampleSpecies(
    "lottit1", "Aegithalos caudatus", "Long-tailed Tit", "Chapim-rabilongo", "Aegithalidae", "Passeriformes", 25319
)
KINGFISHER = SampleSpecies(
    "comkin1", "Alcedo atthis", "Common Kingfisher", "Guarda-rios", "Alcedinidae", "Coraciiformes", 9981
)
STORK = SampleSpecies(
    "whisto1", "Ciconia ciconia", "White Stork", "Cegonha-branca", "Ciconiidae", "Ciconiiformes", 7346
)
VULTURE = SampleSpecies(
    "egyvul1", "Neophron percnopterus", "Egyptian Vulture", "Britango", "Accipitridae", "Accipitriformes", 7920
)
# The photos in samples/ and the species each shows.
SAMPLES = {
    "arminep-grey-heron-8030000_1920.jpg": HERON,
    "bernhardjaeck-cormorant-9455109_1920.jpg": CORMORANT,
    "dienaturreise-wren-6002068_1920.jpg": WREN,
    "erik_karits-european-crested-tit-7575701_1920.jpg": CRESTED_TIT,
    "gruendercoach-robin-9361610_1920.jpg": ROBIN,
    "juergen57bs-chaffinch-9494979_1920.jpg": CHAFFINCH,
    "lancier-swan-7606921_1920.jpg": SWAN,
    "max_gindele_photography-blue-tit-8024809_1920.jpg": BLUE_TIT,
    "netti_nu_nu-robin-6906521_1920.jpg": ROBIN,
    "schauhi-sparrow-6300790_1920.jpg": SPARROW,
    "sharkolot-long-tailed-tit-7803007_1920.jpg": LONG_TAILED_TIT,
    "taligar-kingfisher-1905255_1920.jpg": KINGFISHER,
    "tim_bastian-stork-8618904_1920.jpg": STORK,
    "wildfaces-egyptian-vulture-1336359_1920.jpg": VULTURE,
}
SPECIES = list(dict.fromkeys(SAMPLES.values()))  # each once, in the order above
NO_SPECIES_PCT = 8  # photos still to identify
MIN_CROP = 0.75  # each side keeps at least this share of the sample


@dataclass(frozen=True)
class Options:
    photos: int
    region: tuple[float, float, float, float]
    hotspots: int
    spread_km: float
    same_spot_pct: float
    no_gps_pct: float
    years: int
    image_px: int
    seed: int


@dataclass(frozen=True)
class Hotspot:
    number: int
    lat: float
    lon: float
    weight: float


@dataclass(frozen=True)
class Shot:
    """Everything about photo number `number`, before it becomes a JPEG."""

    number: int
    hotspot: Hotspot
    lat: float | None
    lon: float | None
    local: datetime
    offset_minutes: int | None
    camera: tuple[str, str, str]
    iso: int
    exposure: tuple[int, int]
    fnumber: tuple[int, int]
    focal_length: int
    sample: str  # file in samples/
    crop: tuple[float, float, float, float]  # left, top, right, bottom, as shares of the sample's size
    mirror: bool
    species: tuple[str, ...] = ()  # scientific names: the sample's species, or none while "to identify"


def parse_region(value: str) -> tuple[float, float, float, float]:
    """A preset name or `lat1,lon1,lat2,lon2`, corners in any order."""
    if value.lower() in REGIONS:
        return REGIONS[value.lower()]
    try:
        lat1, lon1, lat2, lon2 = (float(part) for part in value.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"region must be one of {', '.join(REGIONS)} or lat1,lon1,lat2,lon2, not {value!r}"
        ) from None
    if not (-90 <= lat1 <= 90 and -90 <= lat2 <= 90 and -180 <= lon1 <= 180 and -180 <= lon2 <= 180):
        raise argparse.ArgumentTypeError(f"region {value!r} is outside -90..90, -180..180")
    return min(lat1, lat2), min(lon1, lon2), max(lat1, lat2), max(lon1, lon2)


def hotspots(options: Options) -> list[Hotspot]:
    """Centres photos gather around, a few busy and many quiet (Zipf-like weights). Depend on the seed only."""
    rng = random.Random(f"{options.seed}:hotspots")
    lat1, lon1, lat2, lon2 = options.region
    lat1, lat2 = max(lat1, -MAX_LAT), min(lat2, MAX_LAT)
    return [
        Hotspot(i + 1, rng.uniform(lat1, lat2), rng.uniform(lon1, lon2), 1 / (i + 1)) for i in range(options.hotspots)
    ]


def shot(number: int, spots: list[Hotspot], options: Options) -> Shot:
    """Photo `number`, the same for the same options every time."""
    rng = random.Random(f"{options.seed}:photo:{number}")
    spot = rng.choices(spots, weights=[s.weight for s in spots])[0]
    roll = rng.uniform(0, 100)
    if roll < options.no_gps_pct:
        lat = lon = None
    elif roll < options.no_gps_pct + options.same_spot_pct:
        # Exactly on one of the busiest hotspots, so they stack up into groups that never split on the map.
        spot = rng.choice(spots[:SAME_SPOT_HOTSPOTS])
        lat, lon = spot.lat, spot.lon
    else:
        lat, lon = scatter(rng, spot.lat, spot.lon, options.spread_km)

    day = rng.randrange(max(options.years, 1) * 365)
    local = (datetime.now() - timedelta(days=day)).replace(
        hour=rng.randint(7, 18), minute=rng.randrange(60), second=rng.randrange(60), microsecond=0
    )
    # Newer bodies record their offset; for the others it comes from the position, as with real older cameras.
    offset = timezones.offset_minutes(lat, lon, local) if lat is not None and rng.random() < 0.5 else None
    return Shot(
        number=number,
        hotspot=spot,
        lat=lat,
        lon=lon,
        local=local,
        offset_minutes=offset,
        camera=rng.choice(CAMERAS),
        iso=rng.choice([200, 400, 800, 1600, 3200, 6400]),
        exposure=(1, rng.choice([250, 500, 1000, 1600, 2000, 3200])),
        fnumber=rng.choice([(56, 10), (63, 10), (71, 10), (8, 1)]),
        focal_length=rng.choice([300, 400, 500, 600]),
        **pick_sample(number, options.seed),
    )


def pick_sample(number: int, seed: int) -> dict:
    """The sample photo `number` is made from, how it is cropped, and its species (none for some, still to
    identify). A stream of its own, so the position, time and camera of the shot don't depend on it."""
    rng = random.Random(f"{seed}:sample:{number}")
    sample = rng.choice(sorted(SAMPLES))
    width, height = rng.uniform(MIN_CROP, 1), rng.uniform(MIN_CROP, 1)
    left, top = rng.uniform(0, 1 - width), rng.uniform(0, 1 - height)
    untagged = rng.uniform(0, 100) < NO_SPECIES_PCT
    return {
        "sample": sample,
        "crop": (left, top, left + width, top + height),
        "mirror": rng.random() < 0.5,
        "species": () if untagged else (SAMPLES[sample].scientific_name,),
    }


def ensure_species(db: Session) -> dict[str, int]:
    """Every species of SPECIES, by scientific name -> id, created with its eBird fields when missing (found by
    eBird code or scientific name, so a loaded eBird taxonomy is reused). Species are shared by all accounts, so
    existing ones are left as they are; one in the trash is skipped rather than restored."""
    rows = db.scalars(select(Species)).all()
    by_code = {s.ebird_code: s for s in rows if s.ebird_code}
    by_name = {s.scientific_name.lower(): s for s in rows}
    found = {}
    for item in SPECIES:
        row = by_code.get(item.ebird_code) or by_name.get(item.scientific_name.lower())
        if row is None:
            fields = {**item.__dict__, "taxon_order": Decimal(item.taxon_order)}
            row = Species(**fields)
            db.add(row)
        found[item.scientific_name] = row
    db.commit()
    return {name: row.id for name, row in found.items() if row.deleted_at is None}


def scatter(rng: random.Random, lat: float, lon: float, spread_km: float) -> tuple[float, float]:
    """A point around (lat, lon), normally distributed with `spread_km` standard deviation."""
    new_lat = lat + rng.gauss(0, spread_km / KM_PER_DEGREE)
    new_lat = max(-MAX_LAT, min(MAX_LAT, new_lat))
    new_lon = lon + rng.gauss(0, spread_km / (KM_PER_DEGREE * max(math.cos(math.radians(lat)), 0.01)))
    new_lon = (new_lon + 180) % 360 - 180
    return new_lat, new_lon


@cache
def sample_image(name: str) -> Image.Image:
    """A sample photo, decoded once per process."""
    with Image.open(SAMPLES_DIR / name) as image:
        return image.convert("RGB")


def jpeg(item: Shot, image_px: int) -> bytes:
    """The shot's crop of its sample, `image_px` on the long edge, with its metadata as EXIF."""
    source = sample_image(item.sample)
    left, top, right, bottom = item.crop
    image = source.crop(
        (
            round(left * source.width),
            round(top * source.height),
            round(right * source.width),
            round(bottom * source.height),
        )
    )
    if item.mirror:
        image = ImageOps.mirror(image)
    scale = image_px / max(image.size)
    image = image.resize((max(round(image.width * scale), 1), max(round(image.height * scale), 1)), Image.LANCZOS)

    exif = Image.Exif()
    make, model, lens = item.camera
    exif[0x010E] = f"Birdography dev photo {item.number}"  # ImageDescription
    exif[0x010F], exif[0x0110] = make, model
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003] = item.local.strftime("%Y:%m:%d %H:%M:%S")  # DateTimeOriginal
    if item.offset_minutes is not None:
        sign = "+" if item.offset_minutes >= 0 else "-"
        hours, minutes = divmod(abs(item.offset_minutes), 60)
        ifd[0x9011] = f"{sign}{hours:02d}:{minutes:02d}"  # OffsetTimeOriginal
    ifd[0xA434] = lens  # LensModel
    ifd[0x8827] = item.iso
    ifd[0x829A] = IFDRational(*item.exposure)
    ifd[0x829D] = IFDRational(*item.fnumber)
    ifd[0x920A] = IFDRational(item.focal_length, 1)
    if item.lat is not None and item.lon is not None:
        gps = exif.get_ifd(0x8825)
        gps[1], gps[2] = ("N" if item.lat >= 0 else "S"), dms(item.lat)
        gps[3], gps[4] = ("E" if item.lon >= 0 else "W"), dms(item.lon)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=85, exif=exif)
    return out.getvalue()


def dms(value: float) -> tuple[float, float, float]:
    """Degrees, minutes, seconds of the absolute value, as EXIF GPS stores them."""
    value = abs(value)
    degrees = int(value)
    minutes = int((value - degrees) * 60)
    return float(degrees), float(minutes), round((value - degrees - minutes / 60) * 3600, 4)


def ensure_user(db: Session, email: str, password: str) -> User:
    """The dev account with this password, created, restored or reset as needed."""
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        print(f"Created user {email}")
        return create_user(db, email, password)
    if user.deleted_at is not None:
        user.deleted_at = None
        db.commit()
        print(f"Restored user {email} from the trash")
    if not passwords.verify(password, user.password_hash):
        set_password(db, user, password)
        print(f"Password of {email} reset to the configured one")
    return user


def photo_count(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(Photo).where(Photo.owner_id == user.id)) or 0


def remove_photos(db: Session, user: User) -> int:
    """Delete every photo of `user`, trashed ones included, with their files. Other accounts are not touched."""
    photos = db.scalars(select(Photo).where(Photo.owner_id == user.id)).all()
    names = [file.path for photo in photos for file in photo.files]
    for photo in photos:
        db.delete(photo)
    db.commit()
    for name in names:
        storage.remove(name)
    return len(photos)


def seed(db: Session, user: User, options: Options, out=sys.stdout) -> int:
    """Add `options.photos` photos to the user's catalog, continuing after the ones already there."""
    spots = hotspots(options)
    species = ensure_species(db)
    number = photo_count(db, user)
    added = 0
    while added < options.photos:
        number += 1
        item = shot(number, spots, options)
        try:
            links = species_links(db, [species[name] for name in item.species if name in species])
            data = io.BytesIO(jpeg(item, options.image_px))
            stored = ingest(db, user, data, f"dev-{number:05d}.jpg", links)
        except Rejected as err:
            if err.detail == DUPLICATE:  # this number exists already (photos deleted in between): take the next
                continue
            raise
        if not stored.inline:
            derivatives.process(stored.photo.id)
        added += 1
        if added % 25 == 0 or added == options.photos:
            print(f"  {added}/{options.photos} photos", file=out, flush=True)
    return added


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m devtools.seed", description=__doc__.split("\n\n")[0])
    p.add_argument("--email", required=True, help="dev account; its password is read from DEV_USER_PASSWORD")
    p.add_argument("--photos", type=int, default=100, help="photos to add (default 100)")
    p.add_argument("--if-empty", action="store_true", help="add photos only if the account has none")
    p.add_argument("--replace", action="store_true", help="delete the account's photos first")
    p.add_argument("--count", action="store_true", help="only print how many photos the account has")
    p.add_argument("--region", type=parse_region, default="portugal", help=f"{', '.join(REGIONS)} or a,b,c,d")
    p.add_argument("--hotspots", type=int, default=15)
    p.add_argument("--spread-km", type=float, default=1.5)
    p.add_argument("--same-spot-pct", type=float, default=5)
    p.add_argument("--no-gps-pct", type=float, default=5)
    p.add_argument("--years", type=int, default=3)
    p.add_argument("--image-px", type=int, default=1600)
    p.add_argument("--seed", type=int, default=42)
    return p


def main(argv: list[str] | None = None) -> None:
    if os.environ.get("BIRDOGRAPHY_DEV") != "1":
        raise SystemExit("devtools.seed only runs in the dev stack (BIRDOGRAPHY_DEV=1); use scripts/dev.sh")
    args = parser().parse_args(argv)
    if args.photos < 0 or args.hotspots < 1 or args.image_px < 16:
        raise SystemExit("--photos must be 0 or more, --hotspots at least 1 and --image-px at least 16")
    if args.same_spot_pct < 0 or args.no_gps_pct < 0 or args.same_spot_pct + args.no_gps_pct > 100:
        raise SystemExit("--same-spot-pct and --no-gps-pct must be 0 or more and add up to 100 at most")
    password = os.environ.get("DEV_USER_PASSWORD", "")
    if problem := password_problem(password):
        raise SystemExit(f"DEV_USER_PASSWORD: {problem}")
    options = Options(
        photos=args.photos,
        region=args.region,  # argparse converts the default too
        hotspots=args.hotspots,
        spread_km=args.spread_km,
        same_spot_pct=args.same_spot_pct,
        no_gps_pct=args.no_gps_pct,
        years=args.years,
        image_px=args.image_px,
        seed=args.seed,
    )

    drop_root()  # files must belong to the backend's user, as with app.cli
    with Session(engine) as db:
        user = ensure_user(db, args.email, password)
        if args.count:
            print(photo_count(db, user))
            return
        if args.replace:
            print(f"Deleted {remove_photos(db, user)} photos of {user.email}")
        if args.if_empty and photo_count(db, user):
            print(f"{user.email} has {photo_count(db, user)} photos already, not seeding")
            return
        if options.photos:
            print(f"Adding {options.photos} photos around {options.hotspots} hotspots...", flush=True)
        added = seed(db, user, options)
        print(f"{user.email} now has {photo_count(db, user)} photos ({added} added)")


if __name__ == "__main__":  # pragma: no cover
    main()
