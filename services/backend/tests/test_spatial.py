import math
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.processing.spatial import (
    Segment,
    SegmentIndex,
    StationRatio,
    build_layers,
    distance_m,
    fill_uncovered,
    point_to_line_m,
    station_ratios,
)
from app.schemas.observations import Observation, Phenomenon, QcFlag

P = Phenomenon
HOUR = datetime(2026, 7, 1, 10, tzinfo=UTC)
# 0.0001° of latitude is about 11.1 m.
NORTH_11M = 0.0001
EAST_WEST = Segment(segment_id="ew", coordinates=((9.2150, 49.1420), (9.2200, 49.1420)))


def test_distances():
    assert distance_m((9.2150, 49.1420), (9.2150, 49.1430)) == pytest.approx(111.2, abs=0.2)
    assert EAST_WEST.length_m == pytest.approx(364.6, abs=1)
    assert EAST_WEST.center == pytest.approx((9.2175, 49.1420))
    line = EAST_WEST.coordinates
    assert point_to_line_m((9.2170, 49.1420 + NORTH_11M), line) == pytest.approx(11.1, abs=0.1)
    beyond_end = (9.2210, 49.1420)
    assert point_to_line_m(beyond_end, line) == pytest.approx(distance_m(beyond_end, line[1]))


def test_segment_validation():
    with pytest.raises(ValidationError):
        Segment(segment_id="x", coordinates=((9.2, 49.1),))
    with pytest.raises(ValidationError):
        Segment(segment_id="x", coordinates=((9.2, 49.1), (9.3, 49.1)), roughness=1.5)


def test_index_returns_nearest_segment_within_distance():
    parallel = Segment(segment_id="parallel", coordinates=((9.2150, 49.1422), (9.2200, 49.1422)))
    index = SegmentIndex([EAST_WEST, parallel])
    segment, distance = index.nearest((9.2170, 49.1420 + 0.00005))
    assert segment.segment_id == "ew" and distance == pytest.approx(5.6, abs=0.1)
    assert index.nearest((9.2170, 49.1420 + 6 * NORTH_11M)) is None


def obs(phenomenon, value, lon, lat, at=HOUR, **overrides):
    fields = {
        "source": "atrai",
        "station_id": "bike-1",
        "platform": "mobile",
        "kind": "observation",
        "phenomenon": phenomenon,
        "value": value,
        "unit": {P.PM2_5: "µg/m³", P.TEMPERATURE: "°C"}[phenomenon],
        "observed_at": at,
        "longitude": lon,
        "latitude": lat,
        "raw_key": phenomenon.value,
        "raw_value": str(value),
        "raw_unit": None,
    }
    return Observation(**(fields | overrides))


def test_build_layers_computes_shrunk_ratios_and_anomalies():
    on_line = (9.2170, 49.1420 + 0.00005)
    samples = [obs(P.PM2_5, 15, *on_line, sample_id=str(i)) for i in range(20)]
    samples += [obs(P.TEMPERATURE, 24, *on_line, sample_id=str(i)) for i in range(20)]
    samples += [
        obs(P.PM2_5, 99, *on_line, qc_flags=(QcFlag.HUMID_PM,)),
        obs(P.PM2_5, 99, *on_line, platform="stationary"),
        obs(P.PM2_5, 10, 9.2170, 49.1460),  # far away
        obs(P.PM2_5, 10, *on_line, at=HOUR + timedelta(hours=5)),  # no level that hour
    ]
    report = build_layers(
        [EAST_WEST], samples, pm_levels={HOUR: 10.0}, temperature_reference={HOUR: 20.0}
    )
    layer = report.layers["ew"]
    assert layer.pm_ratio == pytest.approx(math.exp(0.5 * math.log(1.5)))
    assert (layer.pm_samples, layer.pm_source) == (20, "samples")
    assert layer.heat_anomaly == pytest.approx(2.0)
    assert (report.matched, report.unmatched, report.without_level) == (40, 1, 1)


def test_zero_reading_is_floored_and_empty_segment_is_neutral():
    on_line = (9.2170, 49.1420)
    report = build_layers([EAST_WEST], [obs(P.PM2_5, 0, *on_line)], pm_levels={HOUR: 10.0})
    assert report.layers["ew"].pm_ratio == pytest.approx(math.exp(1 / 21 * math.log(0.1)))
    empty = build_layers([EAST_WEST], [], pm_levels={})
    assert (empty.layers["ew"].pm_ratio, empty.layers["ew"].pm_source) == (1.0, "none")
    assert empty.layers["ew"].heat_anomaly is None


def test_station_ratios_and_idw_fill():
    hours = [HOUR + timedelta(hours=i) for i in range(30)]
    levels = {hour: 10.0 for hour in hours}
    boxes = [
        obs(P.PM2_5, 8, 9.2150, 49.1420, at=hour, station_id="box-a", platform="stationary")
        for hour in hours
    ] + [
        obs(P.PM2_5, 12, 9.2200, 49.1420, at=hour, station_id="box-b", platform="stationary")
        for hour in hours[:10]
    ]
    ratios = station_ratios(boxes, levels)
    assert [(r.station_id, r.ratio, r.hours) for r in ratios] == [("box-a", 0.8, 30)]
    assert station_ratios(boxes, levels, min_hours=10)[1].ratio == pytest.approx(1.2)

    report = build_layers([EAST_WEST], [], pm_levels=levels)
    filled = fill_uncovered(report, [EAST_WEST], ratios)
    assert (filled.layers["ew"].pm_ratio, filled.layers["ew"].pm_source) == (0.8, "idw")
    near_a = StationRatio("a", (9.2150, 49.1420), 0.8, 30)
    near_b = StationRatio("b", (9.2200, 49.1420), 1.2, 30)
    both = fill_uncovered(build_layers([EAST_WEST], [], {}), [EAST_WEST], [near_a, near_b])
    assert both.layers["ew"].pm_ratio == pytest.approx(1.0)
