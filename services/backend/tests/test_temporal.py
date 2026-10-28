from datetime import UTC, datetime, timedelta

import pytest

from app.processing.temporal import (
    Calibration,
    climatology,
    current_level,
    fit_calibration,
    floor_hour,
    hourly_levels,
)
from app.schemas.observations import Observation, Phenomenon, QcFlag

P = Phenomenon
NOW = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


def obs(station, value, at=NOW, **overrides):
    fields = {
        "source": "opensensemap",
        "station_id": station,
        "platform": "stationary",
        "kind": "observation",
        "phenomenon": P.PM2_5,
        "value": value,
        "unit": "µg/m³",
        "observed_at": at,
        "longitude": 9.21,
        "latitude": 49.14,
        "raw_key": "PM25",
        "raw_value": str(value),
        "raw_unit": "µg/m³",
    }
    return Observation(**(fields | overrides))


def test_fit_calibration_recovers_a_linear_relation():
    calibration = fit_calibration([(1, 5), (2, 7), (4, 11)])
    assert (calibration.alpha, calibration.beta) == pytest.approx((2, 3))
    assert calibration.apply(3) == pytest.approx(9)
    with pytest.raises(ValueError):
        fit_calibration([(1, 2)])
    with pytest.raises(ValueError):
        fit_calibration([(1, 2), (1, 3)])


def test_current_level_uses_latest_live_value_per_station():
    observations = [
        obs("a", 10, NOW - timedelta(minutes=20)),
        obs("a", 12, NOW - timedelta(minutes=5)),
        obs("b", 20, NOW - timedelta(minutes=10)),
        obs("c", 30, NOW - timedelta(minutes=31)),  # not live
        obs("d", 99, NOW + timedelta(minutes=1)),  # future
    ]
    level = current_level(observations, P.PM2_5, NOW)
    assert (level.value, level.stations, level.method) == (16, 2, "median_live")


def test_current_level_skips_unusable_mobile_and_model_values():
    observations = [
        obs("a", 10),
        obs("b", 50, qc_flags=(QcFlag.STUCK,)),
        obs("c", 50, platform="mobile"),
        obs("d", 50, kind="model"),
        obs("e", None),
        obs("f", 40, phenomenon=P.PM10),
    ]
    level = current_level(observations, P.PM2_5, NOW)
    assert (level.value, level.stations) == (10, 1)


def test_current_level_applies_calibration_and_falls_back_to_reference():
    level = current_level([obs("a", 10)], P.PM2_5, NOW, calibrations={"a": Calibration(2, 1)})
    assert level.value == 21
    fallback = current_level([], P.PM2_5, NOW, reference=7.5)
    assert (fallback.value, fallback.stations, fallback.method) == (7.5, 0, "reference")
    assert current_level([], P.PM2_5, NOW) is None


def test_hourly_levels_take_median_of_station_hourly_means():
    hour = floor_hour(NOW)
    observations = [
        obs("a", 10, hour),
        obs("a", 20, hour + timedelta(minutes=30)),
        obs("b", 40, hour + timedelta(minutes=10)),
        obs("c", 1, hour + timedelta(minutes=50)),
        obs("a", 8, hour + timedelta(hours=1)),
    ]
    assert hourly_levels(observations, P.PM2_5) == {hour: 15, hour + timedelta(hours=1): 8}


def test_climatology_groups_by_local_weekday_and_hour_across_dst():
    # 2026-10-25 is the Sunday when Europe/Berlin goes from UTC+2 to UTC+1.
    levels = {
        datetime(2026, 10, 25, 0, tzinfo=UTC): 4.0,  # 02:00 CEST
        datetime(2026, 10, 25, 1, tzinfo=UTC): 6.0,  # 02:00 CET
        datetime(2026, 10, 18, 0, tzinfo=UTC): 8.0,  # 02:00 CEST, one week earlier
        datetime(2026, 10, 26, 6, tzinfo=UTC): 20.0,  # Monday 07:00 CET
    }
    clim = climatology(levels)
    assert clim.counts[(6, 2)] == 3
    assert clim.values[(6, 2)] == 6.0
    assert clim.at(datetime(2026, 11, 2, 6, 30, tzinfo=UTC)) == 20.0
    assert clim.at(datetime(2026, 11, 3, 6, tzinfo=UTC)) is None
    assert climatology(levels, min_samples=2).values == {(6, 2): 6.0}
