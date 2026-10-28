from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.processing.normalizer import RAW_KEYS, normalize, normalize_batch
from app.schemas.observations import CANONICAL_UNITS, Phenomenon, QcFlag, RawObservation

P = Phenomenon
T0 = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


def raw(key="Temperatur", value="21.5", unit="°C", at=T0, **overrides):
    fields = {
        "source": "opensensemap",
        "station_id": "box-1",
        "platform": "stationary",
        "raw_key": key,
        "raw_value": value,
        "raw_unit": unit,
        "observed_at": at,
        "longitude": 9.2109,
        "latitude": 49.1427,
    }
    return RawObservation(**(fields | overrides))


def test_known_keys_map_case_insensitively_to_canonical_units():
    for key in ["Temperatur", "Finedust PM2.5", "PM25", "rel. Luftfeuchte", "UV-Intensität"]:
        assert normalize(raw(key=key, unit=None)) is not None
    obs = normalize(raw(key="FINEDUST PM2.5", value=3.82, unit=None))
    assert (obs.phenomenon, obs.value, obs.unit) == (P.PM2_5, 3.82, "µg/m³")
    assert set(RAW_KEYS.values()) <= set(CANONICAL_UNITS)


def test_unknown_key_is_skipped():
    assert normalize(raw(key="Cloud Base")) is None


@pytest.mark.parametrize(
    ("key", "value", "unit", "expected"),
    [
        ("Temperatur", "294.65", "K", 21.5),
        ("Temperatur", "50", "°F", 10.0),
        ("Luftdruck", "101325", "Pa", 1013.25),
        ("Wind Speed", "36", "km/h", 10.0),
        ("UV-Intensität", "12", "μW/cm²", 12.0),
        ("PM25", "11.55", "µg/m³", 11.55),
    ],
)
def test_units_convert_to_canonical(key, value, unit, expected):
    obs = normalize(raw(key=key, value=value, unit=unit))
    assert obs.value == pytest.approx(expected)
    assert obs.qc_flags == ()
    assert obs.raw_unit == unit and obs.raw_value == value


def test_flags_keep_the_raw_value():
    unknown = normalize(raw(unit="furlong"))
    assert (unknown.value, unknown.raw_value) == (None, "21.5")
    assert unknown.qc_flags == (QcFlag.UNKNOWN_UNIT,)
    text = normalize(raw(value="n/a"))
    assert (text.value, text.qc_flags) == (None, (QcFlag.NON_NUMERIC,))
    hot = normalize(raw(value="61"))
    assert (hot.value, hot.qc_flags, hot.usable) == (61.0, (QcFlag.OUT_OF_RANGE,), False)


def test_null_value_stays_null_without_flags():
    obs = normalize(raw(value=None, unit=None))
    assert (obs.value, obs.raw_value, obs.qc_flags) == (None, None, ())


def test_naive_time_is_assumed_utc_and_aware_time_converted():
    naive = normalize(raw(at=datetime(2026, 7, 1, 12, 0), unit=None))
    assert naive.observed_at == T0
    assert naive.qc_flags == (QcFlag.ASSUMED_UTC, QcFlag.ASSUMED_UNIT)
    summer = timezone(timedelta(hours=2))
    assert normalize(raw(at=datetime(2026, 7, 1, 14, 0, tzinfo=summer))).observed_at == T0


def test_batch_deduplicates_and_counts_unmapped_keys():
    report = normalize_batch([raw(), raw(), raw(key="Cloud Base"), raw(source="atrai")])
    assert len(report.observations) == 2
    assert report.duplicates == 1
    assert report.unmapped_keys == {"Cloud Base": 1}


def series(values, key="Temperatur", step=timedelta(minutes=5), **overrides):
    return [raw(key=key, value=v, at=T0 + i * step, **overrides) for i, v in enumerate(values)]


def test_stuck_runs_are_flagged_only_at_threshold_and_only_when_stationary():
    flat = series(["20.0"] * 3 + ["21.0"] * 4)
    report = normalize_batch(flat, stuck_run=4)
    flags = [QcFlag.STUCK in obs.qc_flags for obs in report.observations]
    assert flags == [False] * 3 + [True] * 4

    assert report.flag_counts[QcFlag.STUCK] == 4
    mobile = normalize_batch(series(["20.0"] * 6, platform="mobile"), stuck_run=4)
    assert mobile.flag_counts[QcFlag.STUCK] == 0
    dark = normalize_batch(series(["0"] * 6, key="Beleuchtungsstärke", unit="lx"), stuck_run=4)
    assert dark.flag_counts[QcFlag.STUCK] == 0


def test_humid_pm_uses_nearest_humidity_of_the_same_station_within_window():
    records = [
        raw(key="rel. Luftfeuchte", value="80", unit="%", at=T0),
        raw(key="PM25", value="12", unit="µg/m³", at=T0 + timedelta(minutes=2)),
        raw(key="PM25", value="12", unit="µg/m³", at=T0 + timedelta(minutes=30)),
        raw(key="PM25", value="12", unit="µg/m³", at=T0, station_id="box-2"),
        raw(key="rel. Luftfeuchte", value="75", unit="%", at=T0, station_id="box-3"),
        raw(key="PM25", value="12", unit="µg/m³", at=T0, station_id="box-3"),
    ]
    report = normalize_batch(records)
    humid = {
        (obs.station_id, obs.observed_at)
        for obs in report.observations
        if QcFlag.HUMID_PM in obs.qc_flags
    }
    assert humid == {("box-1", T0 + timedelta(minutes=2))}
