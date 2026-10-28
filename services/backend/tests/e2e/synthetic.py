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
            records.append(raw(station, "Temperatur", f"{15 + 10 * noise:.2f}", "°C", at))
    return records


def model_records(
    start: datetime = START, hours: int = HOURS + 24, factor: float = 0.5
) -> list[RawObservation]:
    """Open-Meteo-like PM2.5 model output that underestimates the level by `factor`,
    for the history and one day ahead."""
    return [
        raw(
            "open-meteo-grid",
            "pm2_5",
            round(factor * pm25_level(start + timedelta(hours=step)), 3),
            "μg/m³",
            start + timedelta(hours=step),
            source="open-meteo:air-quality",
            kind="model",
        )
        for step in range(hours)
    ]


SEGMENTS = [
    {
        "segment_id": "seg-busy",
        "coordinates": [[9.2150, 49.1420], [9.2200, 49.1420]],
        "roughness": 0.6,
        "overtaking_share": 0.5,
        "flow": 0.3,
    },
    {
        "segment_id": "seg-park",
        "coordinates": [[9.2050, 49.1500], [9.2050, 49.1550]],
        "roughness": 0.1,
        "overtaking_share": 0.05,
        "flow": 0.9,
    },
    {
        "segment_id": "seg-uncovered",
        "coordinates": [[9.2010, 49.1395], [9.2020, 49.1395]],
        "roughness": 0.3,
    },
]
# (segment, PM factor, temperature offset, humidity, longitude, latitude) per sample group.
RIDES = [
    ("busy", 1.5, 2.0, 55, lambda i: (9.2150 + i * 0.0001, 49.14205)),
    ("park", 0.7, -1.0, 55, lambda i: (9.20507, 49.1500 + i * 0.0001)),
    ("humid", 3.0, None, 85, lambda i: (9.2150 + i * 0.0001, 49.14205)),
    ("far", 5.0, 2.0, 55, lambda i: (9.2150 + i * 0.0001, 49.1425)),
]
RIDE_COUNTS = {"busy": 40, "park": 40, "humid": 10, "far": 10}


def mobile_records(start: datetime = START + timedelta(days=1)) -> list[RawObservation]:
    """ATRAI-like bike samples, 10 minutes apart, with naive timestamps."""
    records = []
    step = 0
    for group, factor, offset, humidity, place in RIDES:
        for i in range(RIDE_COUNTS[group]):
            at = start + timedelta(minutes=10 * step)
            longitude, latitude = place(i)
            common = {
                "source": "atrai:bike",
                "platform": "mobile",
                "longitude": longitude,
                "latitude": latitude,
                "sample_id": f"{group}-{i}",
            }
            naive = at.replace(tzinfo=None)
            values = [
                ("Finedust PM2.5", round(factor * pm25_level(at), 3)),
                ("Rel. Humidity", humidity),
            ]
            if offset is not None:
                values.append(("Temperature", 15 + offset))
            for key, value in values:
                records.append(raw("synthetic-bike", key, value, None, naive, **common))
            step += 1
    return records


RAIN_HOUR = datetime(2026, 10, 26, 12, tzinfo=UTC)


def weather_model_records(start: datetime = START, hours: int = HOURS + 24) -> list[RawObservation]:
    """Open-Meteo-like weather model: 15 °C, 60 %, 10 km/h, UV 2 by day, dry except
    4 mm at `RAIN_HOUR`."""
    records = []
    for step in range(hours):
        at = start + timedelta(hours=step)
        local_hour = at.astimezone(LOCAL_TZ).hour
        values = [
            ("temperature_2m", 15.0, "°C"),
            ("relative_humidity_2m", 60.0, "%"),
            ("wind_speed_10m", 10.0, "km/h"),
            ("precipitation", 4.0 if at == RAIN_HOUR else 0.0, "mm"),
            ("uv_index", 2.0 if 9 <= local_hour <= 15 else 0.0, ""),
        ]
        for key, value, unit in values:
            records.append(
                raw(
                    "open-meteo-grid",
                    key,
                    value,
                    unit,
                    at,
                    source="open-meteo:forecast",
                    kind="model",
                )
            )
    return records
