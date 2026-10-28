from datetime import UTC, datetime, timedelta

import pytest

from app.processing.normalizer import normalize_batch
from app.processing.temporal import (
    climatology,
    current_level,
    fit_calibration,
    hourly_levels,
)
from app.schemas.observations import Phenomenon, QcFlag
from tests.e2e import synthetic
from tests.e2e.conftest import bus_round_trip

P = Phenomenon


@pytest.fixture(scope="module")
def observations():
    return normalize_batch(bus_round_trip(synthetic.station_records())).observations


def test_climatology_recovers_the_local_rush_hour_pattern(observations):
    clim = climatology(hourly_levels(observations, P.PM2_5))

    # Weekday rush at 07-08 and 17-18 local time, both before and after the DST change.
    for day in range(5):
        for hour in synthetic.RUSH_HOURS:
            assert clim.values[(day, hour)] == pytest.approx(20.0, abs=0.05)
        assert clim.values[(day, 12)] == pytest.approx(8.0, abs=0.05)
    assert clim.values[(5, 8)] == pytest.approx(8.0, abs=0.05)
    # The same local hour maps to different UTC hours across the DST change:
    # 07:00 CEST, 09:00 CEST, 07:00 CET.
    rush = pytest.approx(20.0, abs=0.05)
    assert clim.at(datetime(2026, 10, 20, 5, tzinfo=UTC)) == rush
    assert clim.at(datetime(2026, 10, 21, 7, tzinfo=UTC)) == pytest.approx(8.0, abs=0.05)
    assert clim.at(datetime(2026, 10, 26, 6, tzinfo=UTC)) == rush
    # Two Sundays; on 2026-10-25 local 02:00 occurs twice.
    assert clim.counts[(6, 2)] == 3


def test_stuck_station_is_flagged_and_excluded_from_levels(observations):
    stuck = [
        obs
        for obs in observations
        if obs.station_id == "synthetic-c" and obs.phenomenon == P.PM2_5 and obs.value == 50.0
    ]
    assert len(stuck) == 24
    assert all(QcFlag.STUCK in obs.qc_flags for obs in stuck)

    levels = hourly_levels(observations, P.PM2_5)
    # Sunday 2026-10-18 12:00 local: median of the two remaining stations (6.4, 8.0).
    assert levels[datetime(2026, 10, 18, 10, tzinfo=UTC)] == pytest.approx(7.2, abs=0.05)
    assert levels[datetime(2026, 10, 19, 10, tzinfo=UTC)] == pytest.approx(8.0, abs=0.05)


def test_current_level_with_calibration_against_a_reference(observations):
    now = synthetic.START + timedelta(hours=synthetic.HOURS - 1, minutes=10)
    level = current_level(observations, P.PM2_5, now)
    assert (level.value, level.stations) == (pytest.approx(8.0, abs=0.05), 3)

    # Calibrate every box against synthetic-b as the reference station.
    by_hour = {}
    for obs in observations:
        if obs.phenomenon == P.PM2_5 and obs.usable:
            by_hour.setdefault(obs.observed_at, {})[obs.station_id] = obs.value
    calibrations = {
        station: fit_calibration(
            [(row[station], row["synthetic-b"]) for row in by_hour.values() if station in row]
        )
        for station in synthetic.STATIONS
    }
    assert calibrations["synthetic-a"].alpha == pytest.approx(1.25, abs=0.01)
    assert calibrations["synthetic-a"].beta == pytest.approx(0.0, abs=0.05)

    calibrated = current_level(observations, P.PM2_5, now, calibrations=calibrations)
    assert calibrated.value == pytest.approx(8.0, abs=0.05)
    assert hourly_levels(observations, P.PM2_5, calibrations)[
        datetime(2026, 10, 18, 10, tzinfo=UTC)
    ] == pytest.approx(8.0, abs=0.05)
