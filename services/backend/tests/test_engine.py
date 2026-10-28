from datetime import UTC, datetime, timedelta

import pytest

from app.processing.forecaster import Forecast, ForecastPoint
from app.processing.spatial import Segment, SegmentLayer
from app.processing.temporal import Climatology
from app.schemas.observations import Phenomenon
from app.scoring.engine import (
    best_times,
    contrast_exponent,
    score_hour,
    score_segments,
    solar_elevation_deg,
)
from app.scoring.profiles import Component, Profile

P = Phenomenon
C = Component
HEILBRONN = (9.2109, 49.1427)
T0 = datetime(2026, 6, 21, 9, tzinfo=UTC)
SEGMENT = Segment(segment_id="s", coordinates=((9.2150, 49.1420), (9.2200, 49.1420)))


def layer(**overrides):
    fields = {
        "segment_id": "s",
        "pm_ratio": 1.0,
        "pm_samples": 40,
        "pm_source": "samples",
        "heat_anomaly": None,
        "heat_samples": 0,
        "roughness": None,
        "overtaking_share": None,
        "flow": None,
    }
    return SegmentLayer(**(fields | overrides))


def flat(phenomenon, value, hours=24):
    points = tuple(
        ForecastPoint(T0 + timedelta(hours=step), value, step) for step in range(1, hours + 1)
    )
    return Forecast(phenomenon, T0, "model_bias_corrected", 1.0, points)


def test_solar_elevation_at_heilbronn():
    # Summer solstice: maximum about 90 - 49.14 + 23.44 = 64.3° near 11:20 UTC.
    assert solar_elevation_deg(datetime(2026, 6, 21, 11, 20, tzinfo=UTC), HEILBRONN) == (
        pytest.approx(64.3, abs=0.5)
    )
    assert solar_elevation_deg(datetime(2026, 6, 21, 23, 20, tzinfo=UTC), HEILBRONN) < -15
    # Winter solstice noon: about 90 - 49.14 - 23.44 = 17.4°.
    assert solar_elevation_deg(datetime(2026, 12, 21, 11, 30, tzinfo=UTC), HEILBRONN) == (
        pytest.approx(17.4, abs=0.6)
    )


def test_contrast_exponent():
    clim = Climatology(values={(0, 7): 40.0, (0, 3): 10.0}, counts={(0, 7): 1, (0, 3): 1})
    monday_7_local = datetime(2026, 10, 26, 6, tzinfo=UTC)
    assert contrast_exponent(clim, monday_7_local) == 1.5
    assert contrast_exponent(clim, monday_7_local - timedelta(hours=4)) == 1.0 - 0.25
    assert contrast_exponent(clim, monday_7_local + timedelta(hours=1)) == 1.0
    assert contrast_exponent(None, monday_7_local) == 1.0


def test_score_hour_applies_pattern_anomaly_and_gates():
    forecasts = {
        P.PM2_5: flat(P.PM2_5, 10.0),
        P.TEMPERATURE: flat(P.TEMPERATURE, 10.0),
        P.RELATIVE_HUMIDITY: flat(P.RELATIVE_HUMIDITY, 50.0),
        P.WIND_SPEED: flat(P.WIND_SPEED, 2.0),
        P.PRECIPITATION: flat(P.PRECIPITATION, 0.0),
    }
    hour = T0 + timedelta(hours=2)
    busy = layer(pm_ratio=2.0, heat_anomaly=1.5, roughness=0.2, overtaking_share=0.6, flow=0.5)
    result = score_hour(SEGMENT, busy, Profile.ROAD_CYCLING, hour, 2, forecasts, 1.2)

    assert result.components[C.PM25] == pytest.approx((35 - 20) / 30)
    assert result.components[C.SURFACE] == pytest.approx(0.8)
    assert result.components[C.OVERTAKING] == 0.0
    assert result.components[C.WIND] == 1.0  # 7.2 km/h is below the 10 km/h anchor
    assert result.components[C.DAYLIGHT] == 1.0
    assert result.gates == {"alert": 1.0, "air": 1.0, "rain": 1.0}
    assert 0 < result.score < 100
    assert result.confidence == pytest.approx(min(1 - 2.718281828**-2, 0.67032, 0.84648), abs=1e-3)

    clean = score_hour(SEGMENT, layer(), Profile.ROAD_CYCLING, hour, 2, forecasts, 1.2)
    assert clean.components[C.PM25] > result.components[C.PM25]

    rainy = forecasts | {P.PRECIPITATION: flat(P.PRECIPITATION, 2.0)}
    assert score_hour(SEGMENT, busy, Profile.ROAD_CYCLING, hour, 2, rainy, 1.2).score == 0
    assert score_hour(SEGMENT, busy, Profile.RUNNING, hour, 2, rainy, 1.2).score > 0
    alert = score_hour(SEGMENT, busy, Profile.RUNNING, hour, 2, forecasts, 1.2, True)
    assert alert.score == 0


def test_missing_data_drops_components_and_lowers_confidence():
    hour = T0 + timedelta(hours=1)
    bare = score_hour(
        SEGMENT, layer(pm_source="none", pm_samples=0), Profile.WALKING, hour, 1, {}, 1
    )
    assert set(bare.components) == {C.DAYLIGHT}
    assert bare.score == 100
    assert bare.confidence == 0
    idw = score_hour(SEGMENT, layer(pm_source="idw", pm_samples=0), Profile.WALKING, hour, 1, {}, 0)
    assert idw.confidence == pytest.approx(0.3)


def test_score_segments_and_best_times():
    points = tuple(
        ForecastPoint(T0 + timedelta(hours=s), 5.0 if s == 3 else 30.0, s) for s in range(1, 7)
    )
    forecasts = {P.PM2_5: Forecast(P.PM2_5, T0, "model_bias_corrected", 1.0, points)}
    scores = score_segments(
        [SEGMENT],
        {"s": layer()},
        forecasts,
        [Profile.RUNNING, Profile.WALKING],
        T0 + timedelta(minutes=40),
        live_stations=[HEILBRONN],
        horizon_hours=6,
    )
    assert len(scores) == 12
    assert {item.hours_ahead for item in scores} == set(range(1, 7))
    best = best_times(scores, count=2)
    assert best[("s", Profile.RUNNING)][0] == (T0 + timedelta(hours=3), pytest.approx(100))
    assert len(best[("s", Profile.WALKING)]) == 2
