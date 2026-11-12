import argparse
import io
import random
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import exif, photos
from app.auth import create_user, passwords
from app.config import settings
from app.db import engine
from app.models import Photo, User
from devtools import seed
from tests.conftest import stored

EMAIL = "dev@birdography.local"
PASSWORD = "birdography-dev"
OPTIONS = seed.Options(
    photos=4,
    region=seed.REGIONS["portugal"],
    hotspots=5,
    spread_km=1.5,
    same_spot_pct=20,
    no_gps_pct=20,
    years=2,
    image_px=64,
    seed=7,
)


@pytest.fixture
def dev(monkeypatch):
    monkeypatch.setenv("BIRDOGRAPHY_DEV", "1")
    monkeypatch.setenv("DEV_USER_PASSWORD", PASSWORD)


def run(*args: str) -> None:
    seed.main(["--email", EMAIL, "--image-px", "64", "--hotspots", "5", *args])


def photos_of(email: str) -> list[Photo]:
    with Session(engine) as db:
        return db.scalars(select(Photo).join(User).where(User.email == email).order_by(Photo.id)).all()


# --- generation ------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(seed.REGIONS))
def test_region_presets(name):
    assert seed.parse_region(name.upper()) == seed.REGIONS[name]


def test_custom_region_corners_in_any_order():
    assert seed.parse_region("42,-6,37,-9.5") == (37.0, -9.5, 42.0, -6.0)


@pytest.mark.parametrize("value", ["mars", "1,2,3", "a,b,c,d", "91,0,0,0", "0,-181,1,1"])
def test_rejects_bad_regions(value):
    with pytest.raises(argparse.ArgumentTypeError):
        seed.parse_region(value)


def test_hotspots_are_inside_the_region_and_depend_on_the_seed_only():
    spots = seed.hotspots(OPTIONS)
    lat1, lon1, lat2, lon2 = OPTIONS.region
    assert len(spots) == 5
    assert all(lat1 <= s.lat <= lat2 and lon1 <= s.lon <= lon2 for s in spots)
    assert spots == seed.hotspots(OPTIONS)
    assert spots != seed.hotspots(OPTIONS.__class__(**{**OPTIONS.__dict__, "seed": 8}))
    assert [s.weight for s in spots] == sorted((s.weight for s in spots), reverse=True)


def test_hotspots_stay_within_what_the_map_shows():
    world = seed.Options(**{**OPTIONS.__dict__, "region": (-90.0, -180.0, 90.0, 180.0), "hotspots": 200})
    assert all(abs(s.lat) <= seed.MAX_LAT for s in seed.hotspots(world))


def test_photos_are_reproducible_and_follow_the_shares():
    spots = seed.hotspots(OPTIONS)
    shots = [seed.shot(n, spots, OPTIONS) for n in range(1, 401)]
    assert shots[10] == seed.shot(11, spots, OPTIONS)

    no_gps = [s for s in shots if s.lat is None]
    on_spot = [s for s in shots if s.lat is not None and (s.lat, s.lon) == (s.hotspot.lat, s.hotspot.lon)]
    assert 50 < len(no_gps) < 110  # 20% of 400
    assert 50 < len(on_spot) < 110
    assert {s.hotspot.number for s in on_spot} <= {1, 2, 3}  # the busiest ones, so they stack up
    assert all(s.offset_minutes is None for s in no_gps)
    assert any(s.offset_minutes is not None for s in shots) and any(s.offset_minutes is None for s in shots)
    assert all(7 <= s.local.hour <= 18 for s in shots)

    scattered = [s for s in shots if s not in no_gps and s not in on_spot]
    # 1.5 km standard deviation: practically everything within 10 km (0.09°) of its hotspot
    assert all(abs(s.lat - s.hotspot.lat) < 0.09 for s in scattered)


def test_scatter_wraps_longitude_and_clamps_latitude():
    rng = random.Random(1)
    points = [seed.scatter(rng, 84.99, 179.99, 50) for _ in range(200)]
    assert all(-seed.MAX_LAT <= lat <= seed.MAX_LAT and -180 <= lon < 180 for lat, lon in points)
    assert any(lon < 0 for _, lon in points)  # crossed the antimeridian


def test_dms():
    assert seed.dms(-38.5125) == (38.0, 30.0, 45.0)


@pytest.mark.exiftool
def test_jpeg_metadata_reads_back(tmp_path):
    spots = seed.hotspots(OPTIONS)
    item = next(s for n in range(1, 50) if (s := seed.shot(n, spots, OPTIONS)).lat and s.offset_minutes is not None)
    path = tmp_path / "photo.jpg"
    path.write_bytes(seed.jpeg(item, 64))
    meta = exif.read(path)
    assert meta["lat"] == pytest.approx(item.lat, abs=1e-5)
    assert meta["lon"] == pytest.approx(item.lon, abs=1e-5)
    assert meta["taken_at_local"] == item.local
    assert meta["taken_offset_minutes"] == item.offset_minutes
    assert meta["camera"] and meta["lens"] == item.camera[2]


def test_every_photo_is_a_different_file():
    spots = seed.hotspots(OPTIONS)
    no_gps = next(s for n in range(1, 50) if (s := seed.shot(n, spots, OPTIONS)).lat is None)
    negative = seed.Shot(**{**no_gps.__dict__, "number": 999, "lat": -1.0, "lon": -1.0, "offset_minutes": -90})
    files = {seed.jpeg(seed.shot(n, spots, OPTIONS), 32) for n in range(1, 6)} | {seed.jpeg(no_gps, 32)}
    files.add(seed.jpeg(negative, 32))
    assert len(files) == 7


# --- running -----------------------------------------------------------------------------------------------------


def test_refuses_outside_the_dev_stack(monkeypatch):
    monkeypatch.delenv("BIRDOGRAPHY_DEV", raising=False)
    with pytest.raises(SystemExit, match="only runs in the dev stack"):
        run()


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (["--photos", "-1"], "--photos must be"),
        (["--hotspots", "0"], "--photos must be"),
        (["--same-spot-pct", "60", "--no-gps-pct", "50"], "add up to 100"),
        (["--no-gps-pct", "-1"], "add up to 100"),
    ],
)
def test_rejects_bad_options(dev, args, message):
    with pytest.raises(SystemExit, match=message):
        run(*args)


def test_rejects_a_short_password(dev, monkeypatch):
    monkeypatch.setenv("DEV_USER_PASSWORD", "short")
    with pytest.raises(SystemExit, match="DEV_USER_PASSWORD: .*10 characters"):
        run()


@pytest.mark.exiftool
def test_seeds_through_the_upload_path(dev, capsys):
    run("--photos", "3")
    seeded = photos_of(EMAIL)
    assert len(seeded) == 3
    assert {f.kind for f in seeded[0].files} == {"original", "thumbnail"}
    assert seeded[0].files[0].original_filename == "dev-00001.jpg"
    assert seeded[0].camera
    assert "now has 3 photos (3 added)" in capsys.readouterr().out

    run("--photos", "2", "--if-empty")
    assert len(photos_of(EMAIL)) == 3
    assert "has 3 photos already" in capsys.readouterr().out

    run("--count")
    assert capsys.readouterr().out.strip() == "3"

    run("--photos", "2")  # continues the numbering
    assert [p.files[0].original_filename for p in photos_of(EMAIL)][-1] == "dev-00005.jpg"


@pytest.mark.exiftool
def test_replace_only_touches_the_dev_user(dev, client):
    other = io.BytesIO(seed.jpeg(seed.shot(9999, seed.hotspots(OPTIONS), OPTIONS), 64))
    assert client.post("/photos", files={"file": ("mine.jpg", other)}).status_code == 201
    run("--photos", "2")
    dev_files = [f.path for p in photos_of(EMAIL) for f in p.files]
    run("--photos", "0", "--replace")
    assert photos_of(EMAIL) == []
    assert len(photos_of("me@example.com")) == 1
    assert not set(dev_files) & set(stored())


@pytest.mark.exiftool
def test_skips_numbers_already_uploaded_by_anyone(dev):
    """Hashes are unique across accounts: a second account seeded with the same seed gets the next photos."""
    with Session(engine) as db:
        first = create_user(db, "first@example.com", PASSWORD)
        seed.seed(db, first, OPTIONS)
        second = create_user(db, "second@example.com", PASSWORD)
        assert seed.seed(db, second, OPTIONS, out=io.StringIO()) == 4
    names = [p.files[0].original_filename for p in photos_of("second@example.com")]
    assert names == ["dev-00005.jpg", "dev-00006.jpg", "dev-00007.jpg", "dev-00008.jpg"]


def test_other_rejections_stop_the_seed(dev, monkeypatch):
    def reject(*args):
        raise photos.Rejected(415, "Unsupported file type")

    monkeypatch.setattr(seed, "ingest", reject)
    with pytest.raises(photos.Rejected), Session(engine) as db:
        seed.seed(db, create_user(db, EMAIL, PASSWORD), OPTIONS)


def test_large_photos_get_their_derivatives_after_ingest(dev, monkeypatch):
    monkeypatch.setattr(settings, "background_derivatives_mb", 0)
    with Session(engine) as db:
        seed.seed(db, create_user(db, EMAIL, PASSWORD), seed.Options(**{**OPTIONS.__dict__, "photos": 1}))
    assert {f.kind for f in photos_of(EMAIL)[0].files} == {"original", "thumbnail"}


def test_brings_the_dev_account_back_to_the_configured_password(dev, capsys):
    with Session(engine) as db:
        user = create_user(db, EMAIL, "an-older-password")
        user.deleted_at = user.created_at
        db.commit()
    run("--photos", "0")
    out = capsys.readouterr().out
    assert "Restored user" in out and "Password of" in out
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.email == EMAIL))
        assert user.deleted_at is None and passwords.verify(PASSWORD, user.password_hash)
    run("--photos", "0")  # nothing to change the second time
    assert "Restored" not in capsys.readouterr().out
    assert Path(settings.upload_dir).exists()
