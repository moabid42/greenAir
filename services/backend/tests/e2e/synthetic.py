"""SYNTHETIC raw records for end-to-end tests. Not observations; never present as data.

Three stationary boxes report PM2.5 and humidity every hour for two weeks across
the 2026-10-25 DST change. The PM2.5 level follows a known pattern in Berlin local
time, so tests can check that processing recovers it:

    level = 8 µg/m³, plus 12 on weekdays at 07-08 and 17-18 local time
    station value = factor * level + jitter, factors 0.8 / 1.0 / 1.2 (median ≈ level)

The jitter (at most ±0.02) mimics sensor noise; without it, long constant runs
are correctly flagged as stuck. Station `synthetic-c` reports a stuck 50.0 on
Sunday 2026-10-18 (local).
"""

from datetime import UTC, date, datetime, timedelta

from app.processing.temporal import LOCAL_TZ
from app.schemas.observations import RawObservation

START = datetime(2026, 10, 12, 0, tzinfo=UTC)  # Monday
HOURS = 14 * 24
STATIONS = {
    "synthetic-a": (0.8, 9.2000, 49.1400),
    "synthetic-b": (1.0, 9.2109, 49.1427),
    "synthetic-c": (1.2, 9.2250, 49.1500),
}
STUCK_DAY = date(2026, 10, 18)
RUSH_HOURS = {7, 8, 17, 18}


def pm25_level(moment: datetime) -> float:
    local = moment.astimezone(LOCAL_TZ)
    rush = local.weekday() < 5 and local.hour in RUSH_HOURS
    return 20.0 if rush else 8.0


def jitter(step: int, index: int) -> float:
    return ((step * 7 + index * 3) % 5 - 2) * 0.01


def raw(station: str, key: str, value: float | str, unit: str, at: datetime, **extra):
    _, longitude, latitude = STATIONS.get(station, (1.0, 9.2109, 49.1427))
    fields = {
        "source": "opensensemap",
        "station_id": station,
        "platform": "stationary",
        "raw_key": key,
        "raw_value": value,
        "raw_unit": unit,
        "observed_at": at,
        "longitude": longitude,
        "latitude": latitude,
    }
    return RawObservation(**(fields | extra))


def station_records(start: datetime = START, hours: int = HOURS) -> list[RawObservation]:
    records = []
    for step in range(hours):
        at = start + timedelta(hours=step)
        for index, (station, (factor, _, _)) in enumerate(STATIONS.items()):
            stuck = station == "synthetic-c" and at.astimezone(LOCAL_TZ).date() == STUCK_DAY
            noise = jitter(step, index)
            value = 50.0 if stuck else round(factor * pm25_level(at) + noise, 3)
            records.append(raw(station, "PM25", f"{value}", "µg/m³", at))
            records.append(raw(station, "rel. Luftfeuchte", f"{60 + 100 * noise:.1f}", "%", at))
    return records
