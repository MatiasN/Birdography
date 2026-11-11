from datetime import datetime

from app import timezones

LISBON = (38.7, -9.1)
NEW_YORK = (40.7, -74.0)


def test_zone_names():
    assert timezones.zone(*LISBON) == "Europe/Lisbon"
    assert timezones.zone(*NEW_YORK) == "America/New_York"
    assert timezones.zone(0.0, -30.0) == "Etc/GMT+2"  # mid-Atlantic


def test_offset_follows_daylight_saving():
    assert timezones.offset_minutes(*LISBON, datetime(2026, 5, 14, 7, 32, 10)) == 60
    assert timezones.offset_minutes(*LISBON, datetime(2026, 1, 14, 7, 32, 10)) == 0
    assert timezones.offset_minutes(*NEW_YORK, datetime(2020, 4, 2, 18, 19, 31)) == -240
    assert timezones.offset_minutes(0.0, -30.0, datetime(2026, 5, 14, 7, 32, 10)) == -120


def test_ambiguous_hour_is_the_first_occurrence():
    # Lisbon leaves summer time on 2026-10-25 at 02:00; 01:30 happens twice.
    assert timezones.offset_minutes(*LISBON, datetime(2026, 10, 25, 1, 30)) == 60
    assert timezones.offset_minutes(*LISBON, datetime(2026, 10, 25, 2, 30)) == 0


def test_unknown_positions_and_zones(monkeypatch, caplog):
    monkeypatch.setattr(timezones.tzfpy, "get_tz", lambda lon, lat: "")
    assert timezones.zone(*LISBON) is None
    assert timezones.offset_minutes(*LISBON, datetime(2026, 5, 14)) is None

    monkeypatch.setattr(timezones.tzfpy, "get_tz", lambda lon, lat: "Nowhere/Zone")
    assert timezones.offset_minutes(*LISBON, datetime(2026, 5, 14)) is None
    assert "unknown to zoneinfo" in caplog.text
