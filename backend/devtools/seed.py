"""Seed a development stack with a known account and generated photos spread over a map.

Run by `scripts/dev.sh` inside the backend container (`python -m devtools.seed`), never in production: it refuses
to start unless BIRDOGRAPHY_DEV=1, which only compose.dev.yml sets. The password comes from DEV_USER_PASSWORD so
it doesn't show in the process list.

Photos go through `photos.ingest`, the same path as `POST /photos`, so their metadata, time zones and thumbnails
are what a real upload of the same JPEG would give. Photo number n is always the same image at the same spot for a
given `--seed`, so a bug seen on photo 137 can be reproduced; adding more continues the numbering.
"""

import argparse
import io
import math
import os
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta

from PIL import Image, ImageDraw, ImageFont, ImageOps
from PIL.TiffImagePlugin import IFDRational
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import derivatives, storage, timezones
from app.auth import create_user, password_problem, passwords, set_password
from app.cli import drop_root
from app.db import engine
from app.models import Photo, User
from app.photos import DUPLICATE, Rejected, ingest

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
PALETTE = ["#1b4332", "#2d6a4f", "#40916c", "#1d3557", "#457b9d", "#6d597a", "#b56576", "#e07a5f", "#3d405b"]


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
    )


def scatter(rng: random.Random, lat: float, lon: float, spread_km: float) -> tuple[float, float]:
    """A point around (lat, lon), normally distributed with `spread_km` standard deviation."""
    new_lat = lat + rng.gauss(0, spread_km / KM_PER_DEGREE)
    new_lat = max(-MAX_LAT, min(MAX_LAT, new_lat))
    new_lon = lon + rng.gauss(0, spread_km / (KM_PER_DEGREE * max(math.cos(math.radians(lat)), 0.01)))
    new_lon = (new_lon + 180) % 360 - 180
    return new_lat, new_lon


def jpeg(item: Shot, image_px: int) -> bytes:
    """A gradient in the hotspot's colours with the photo's number on it, and its metadata as EXIF."""
    width, height = image_px, max(image_px * 2 // 3, 1)
    top = PALETTE[item.hotspot.number % len(PALETTE)]
    bottom = PALETTE[(item.hotspot.number * 3 + 1) % len(PALETTE)]
    image = ImageOps.colorize(Image.linear_gradient("L").resize((width, height)), black=top, white=bottom)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=max(height // 5, 10))
    small = ImageFont.load_default(size=max(height // 14, 8))
    draw.text((width / 2, height * 0.42), f"#{item.number}", fill="white", font=font, anchor="mm")
    where = f"Spot {item.hotspot.number}" if item.lat is not None else "no GPS"
    draw.text((width / 2, height * 0.68), where, fill="white", font=small, anchor="mm")

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
    number = photo_count(db, user)
    added = 0
    while added < options.photos:
        number += 1
        item = shot(number, spots, options)
        try:
            photo, inline = ingest(db, user, io.BytesIO(jpeg(item, options.image_px)), f"dev-{number:05d}.jpg")
        except Rejected as err:
            if err.detail == DUPLICATE:  # this number exists already (photos deleted in between): take the next
                continue
            raise
        if not inline:
            derivatives.process(photo.id)
        added += 1
        if added % 25 == 0 or added == options.photos:
            print(f"  {added}/{options.photos} photos", file=out, flush=True)
    return added


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m devtools.seed", description=__doc__.split("\n\n")[0])
    p.add_argument("--email", required=True, help="dev account; its password is read from DEV_USER_PASSWORD")
    p.add_argument("--photos", type=int, default=300, help="photos to add (default 300)")
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
