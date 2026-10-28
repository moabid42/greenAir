import math

import pytest

from app.processing.normalizer import normalize_batch
from app.processing.spatial import Segment, build_layers, fill_uncovered, station_ratios
from app.processing.temporal import hourly_levels
from app.schemas.observations import Phenomenon, QcFlag
from tests.e2e import synthetic
from tests.e2e.conftest import bus_round_trip

P = Phenomenon


@pytest.fixture(scope="module")
def result():
    records = synthetic.station_records() + synthetic.mobile_records()
    observations = normalize_batch(bus_round_trip(records)).observations
    segments = [Segment.model_validate(segment) for segment in synthetic.SEGMENTS]
    pm_levels = hourly_levels(observations, P.PM2_5)
    temperature = hourly_levels(observations, P.TEMPERATURE)
    report = build_layers(segments, observations, pm_levels, temperature)
    stations = station_ratios(observations, pm_levels)
    return observations, fill_uncovered(report, segments, stations), stations


def test_bike_samples_are_normalized_and_humid_pm_flagged(result):
    observations, _, _ = result
    bike = [obs for obs in observations if obs.station_id == "synthetic-bike"]
    assert all(QcFlag.ASSUMED_UTC in obs.qc_flags for obs in bike)
    humid = [obs for obs in bike if QcFlag.HUMID_PM in obs.qc_flags]
    assert {obs.sample_id.split("-")[0] for obs in humid} == {"humid"}
    assert len(humid) == 10


def test_segment_patterns_recover_the_ride_factors(result):
    _, report, _ = result
    shrink = 40 / (40 + 20)
    busy, park = report.layers["seg-busy"], report.layers["seg-park"]

    assert (busy.pm_samples, busy.heat_samples, busy.pm_source) == (40, 40, "samples")
    assert busy.pm_ratio == pytest.approx(math.exp(shrink * math.log(1.5)), abs=0.01)
    assert busy.heat_anomaly == pytest.approx(shrink * 2.0, abs=0.02)
    assert (busy.roughness, busy.overtaking_share, busy.flow) == (0.6, 0.5, 0.3)

    assert park.pm_ratio == pytest.approx(math.exp(shrink * math.log(0.7)), abs=0.01)
    assert park.heat_anomaly == pytest.approx(shrink * -1.0, abs=0.02)

    # Far samples (about 55 m away) are unmatched; humid PM is not counted.
    assert report.unmatched == 20
    assert report.matched == 160


def test_uncovered_segment_gets_idw_from_station_ratios(result):
    _, report, stations = result
    assert [station.station_id for station in stations] == list(synthetic.STATIONS)
    ratios = {station.station_id: station.ratio for station in stations}
    assert ratios["synthetic-a"] < ratios["synthetic-b"] < ratios["synthetic-c"]

    uncovered = report.layers["seg-uncovered"]
    assert (uncovered.pm_source, uncovered.pm_samples, uncovered.heat_anomaly) == ("idw", 0, None)
    # About 120 m from synthetic-a, so its ratio dominates.
    assert uncovered.pm_ratio == pytest.approx(ratios["synthetic-a"], abs=0.02)
