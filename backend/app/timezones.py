"""Time zone of a position, for photos whose camera knows where it was but not its UTC offset.

Zone boundaries come from tzfpy (timezone-boundary-builder data, built from OpenStreetMap); the offset at the
given local time comes from the system's or tzdata's zoneinfo, so daylight saving is decided by the date.
"""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import tzfpy

log = logging.getLogger(__name__)


def zone(lat: float, lon: float) -> str | None:
    """IANA zone name at the position; `Etc/GMT±N` at sea, None where tzfpy has nothing."""
    return tzfpy.get_tz(lon, lat) or None


def offset_minutes(lat: float, lon: float, local: datetime) -> int | None:
    """UTC offset in minutes of the zone at the position, at the given wall-clock time.

    An ambiguous hour (the repeated hour when clocks go back) resolves to its first occurrence.
    """
    name = zone(lat, lon)
    if name is None:
        return None
    try:
        tz = ZoneInfo(name)
    except ZoneInfoNotFoundError, ValueError:
        log.warning("time zone %r at %.4f, %.4f unknown to zoneinfo; is tzdata installed?", name, lat, lon)
        return None
    return int(local.replace(tzinfo=tz, fold=0).utcoffset().total_seconds() // 60)
