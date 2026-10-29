from datetime import UTC, datetime

import pytest

from app.processing.normalizer import normalize_batch
from app.schemas.observations import Observation, Phenomenon, QcFlag
from tests.e2e.conftest import bus_round_trip

P = Phenomenon


def test_captured_atrai_records_normalize_with_provenance(load_raw):
    report = normalize_batch(bus_round_trip(load_raw("raw_observations_atrai_2026-10-28.json")))

    assert report.unmapped_keys == {
        "Cloud Base": 2,
        "Dewpoint": 2,
        "Solar Radiation": 2,
        "Wind Direction": 2,
        "Wind Gust": 2,
    }
    assert len(report.observations) == 24
    # ATRAI createdAt has no time zone.
    assert all(QcFlag.ASSUMED_UTC in obs.qc_flags for obs in report.observations)

    pm25 = [obs for obs in report.observations if obs.phenomenon == P.PM2_5]
    assert [obs.value for obs in pm25] == [3.82, 3.79]
    assert pm25[0].observed_at == datetime(2026, 7, 8, 23, 19, 53, 736000, tzinfo=UTC)
    assert pm25[0].raw_key == "Finedust PM2.5" and pm25[0].sample_id == "560357"
    wind = next(obs for obs in report.observations if obs.phenomenon == P.WIND_SPEED)
    assert (wind.value, wind.qc_flags) == (None, (QcFlag.ASSUMED_UTC,))

    # The output crosses the next bus boundary unchanged.
    encoded = [obs.model_dump_json() for obs in report.observations]
    assert [Observation.model_validate_json(line) for line in encoded] == report.observations


def test_synthetic_qc_cases_end_to_end(load_raw):
    report = normalize_batch(bus_round_trip(load_raw("raw_observations_qc_synthetic.json")))

    assert report.duplicates == 1
    assert report.unmapped_keys == {"Battery": 1}
    by_box = {}
    for obs in report.observations:
        by_box.setdefault((obs.station_id, obs.phenomenon), []).append(obs)

    stuck = by_box[("synthetic-stuck", P.TEMPERATURE)]
    assert all(QcFlag.STUCK in obs.qc_flags for obs in stuck)
    pm = by_box[("synthetic-stuck", P.PM2_5)]
    assert [QcFlag.HUMID_PM in obs.qc_flags for obs in pm] == [True] * 6 + [False] * 6
    assert pm[0].raw_unit == "μg/m³" and pm[0].unit == "µg/m³"

    healthy = by_box[("synthetic-healthy", P.TEMPERATURE)]
    assert healthy[0].value == pytest.approx(21.0)
    assert all(obs.usable for obs in healthy)
    assert by_box[("synthetic-healthy", P.PRESSURE)][0].value == pytest.approx(1013.0)
    bad_pm = by_box[("synthetic-healthy", P.PM2_5)]
    assert [obs.qc_flags for obs in bad_pm] == [(QcFlag.OUT_OF_RANGE,), (QcFlag.NON_NUMERIC,)]
    assert not any(obs.usable for obs in bad_pm)
