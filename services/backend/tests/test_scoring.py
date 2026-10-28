import pytest

from app.scoring.components import apparent_temperature, comfort, daylight, flow, ramp, surface
from app.scoring.profiles import WEIGHTS, Component, Profile
from app.scoring.score import (
    air_gate,
    alert_gate,
    best_windows,
    confidence,
    idw_ratio,
    rain_gate,
    route_score,
    score,
    shrink_anomaly,
    shrink_ratio,
)

C = Component


def test_shrinkage_matches_draft_examples():
    assert shrink_ratio(2.0, 2) == pytest.approx(1.065, abs=1e-3)
    # The draft text says about 1.94; its own formula gives 2 ** (200 / 220) = 1.878.
    assert shrink_ratio(2.0, 200) == pytest.approx(1.878, abs=1e-3)
    assert shrink_ratio(1.3, 40) == pytest.approx(1.191, abs=1e-3)
    assert shrink_ratio(5.0, 0) == 1.0
    assert shrink_anomaly(1.5, 20) == pytest.approx(0.75)
    assert shrink_anomaly(1.5, 0) == 0.0


def test_idw_weights_by_inverse_square_distance():
    assert idw_ratio([(1.0, 2.0), (2.0, 1.0)]) == pytest.approx((2.0 + 0.25) / 1.25)
    assert idw_ratio([(0.0, 1.4), (1.0, 2.0)]) == 1.4
    assert idw_ratio([]) is None


@pytest.mark.parametrize(
    ("component", "value", "expected"),
    [
        (C.PM25, 5, 1.0),
        (C.PM25, 0, 1.0),
        (C.PM25, 35, 0.0),
        (C.PM25, 80, 0.0),
        (C.PM25, 20, 0.5),
        (C.NO2, 25, 0.70),
        (C.O3, 90, 0.625),
        (C.WIND, 10.8, 0.977),
        (C.UV, 3, 0.833),
        (C.CROWDING, 0.6, 0.429),
    ],
)
def test_ramp_is_clipped_linear(component, value, expected):
    assert ramp(component, value) == pytest.approx(expected, abs=1e-3)


def test_apparent_temperature_matches_worked_example():
    assert apparent_temperature(23.5, 50, 3) == pytest.approx(22.16, abs=0.01)


@pytest.mark.parametrize(
    ("profile", "at", "expected"),
    [
        (Profile.RUNNING, -5, 0.0),
        (Profile.RUNNING, 0, 0.5),
        (Profile.RUNNING, 5, 1.0),
        (Profile.RUNNING, 15, 1.0),
        (Profile.RUNNING, 21.5, 0.5),
        (Profile.RUNNING, 28, 0.0),
        (Profile.ROAD_CYCLING, 27, 0.5),
        (Profile.WALKING, 24, 1.0),
    ],
)
def test_comfort_trapezoid(profile, at, expected):
    assert comfort(profile, at) == pytest.approx(expected)


def test_direct_components():
    assert surface(0.2) == pytest.approx(0.8)
    assert surface(1.4) == 0.0
    assert flow(0.7) == 0.7
    assert daylight(Profile.RUNNING, True) == 1.0
    assert daylight(Profile.RUNNING, False, unlit_path=True) == 0.5
    assert daylight(Profile.WALKING, False, unlit_path=True) == 0.8
    assert daylight(Profile.ROAD_CYCLING, False) == 0.8


def test_gates():
    assert rain_gate(Profile.ROAD_CYCLING, 0.9) == 1.0
    assert rain_gate(Profile.ROAD_CYCLING, 1.0) == 0.0
    assert rain_gate(Profile.RUNNING, 2.0) == 1.0
    assert rain_gate(Profile.RUNNING, 3.0, soft=True) == pytest.approx(0.5)
    assert air_gate(74.9) == 1.0 and air_gate(75) == 0.0
    assert alert_gate(True) == 0.0 and alert_gate(False) == 1.0


def worked_example_goodness():
    """docs/scoring.md §8: running, 17:00, one hour ahead."""
    pm25 = 18 * shrink_ratio(1.3, 40)
    at = apparent_temperature(22 + 1.5, 50, 3)
    return {
        C.PM25: ramp(C.PM25, pm25),
        C.NO2: ramp(C.NO2, 25),
        C.O3: ramp(C.O3, 90),
        C.APPARENT_TEMPERATURE: comfort(Profile.RUNNING, at),
        C.WIND: ramp(C.WIND, 10.8),
        C.UV: ramp(C.UV, 3),
        C.SURFACE: surface(0.2),
        C.FLOW: flow(0.7),
        C.CROWDING: ramp(C.CROWDING, 0.6),
        C.DAYLIGHT: daylight(Profile.RUNNING, True),
    }


def test_worked_example_score_and_confidence():
    goodness = worked_example_goodness()
    assert goodness[C.PM25] == pytest.approx(0.45, abs=0.01)
    assert goodness[C.APPARENT_TEMPERATURE] == pytest.approx(0.45, abs=0.01)
    gates = [rain_gate(Profile.RUNNING, 0), air_gate(21.4), alert_gate(False)]

    assert score(Profile.RUNNING, goodness, gates) == pytest.approx(64, abs=0.5)
    assert confidence(40, 1.2, 1) == pytest.approx(0.67, abs=0.01)


def test_score_renormalizes_missing_and_zero_weight_components():
    full = score(Profile.RUNNING, {C.PM25: 1.0, C.NO2: 0.0})
    assert full == pytest.approx(75)
    assert score(Profile.RUNNING, {C.PM25: 1.0, C.NO2: 0.0, C.UV: None}) == full
    assert score(Profile.RUNNING, {C.PM25: 1.0, C.NO2: 0.0, C.OVERTAKING: 0.0}) == full
    assert score(Profile.RUNNING, {C.UV: None}) is None
    assert score(Profile.RUNNING, {C.PM25: 1.0}, gates=[1.0, 0.0]) == 0.0


def test_every_profile_weights_every_component_except_pm10():
    # §5.1 anchors PM10, but §6.2 gives it no weight, so it never affects the score.
    for weights in WEIGHTS.values():
        assert set(weights) == set(Component) - {C.PM10}
    assert score(Profile.RUNNING, {C.PM10: 0.0}) is None


def test_confidence_terms():
    assert confidence(None, 0, 0) == pytest.approx(0.3)
    assert confidence(1000, 0, 0) == pytest.approx(1.0)
    assert confidence(1000, 0, 12) == pytest.approx(0.368, abs=1e-3)


def test_best_windows_skips_neighbours_and_gaps():
    hourly = [10, 80, 79, None, 60, 70, 20, 75]
    assert best_windows(hourly) == [(1, 80), (7, 75), (5, 70)]
    assert best_windows([None, None]) == []


def test_route_score_is_length_weighted():
    assert route_score([(100, 80, 0.9), (300, 40, 0.5)]) == (50, 0.5)
    assert route_score([]) is None
