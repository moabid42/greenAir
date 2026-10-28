import math
from datetime import UTC, datetime, timedelta

import pytest

from app.processing.forecaster import forecast, model_correction, model_series
from app.processing.temporal import Climatology
from app.schemas.observations import Observation, Phenomenon, QcFlag

P = Phenomenon
T0 = datetime(2026, 10, 28, 12, tzinfo=UTC)
H = timedelta(hours=1)


def hours(start, values):
    return {start + i * H: value for i, value in enumerate(values)}


def test_model_series_averages_usable_model_values_per_hour():
    def model(value, at, **overrides):
        fields = {
            "source": "open-meteo",
            "station_id": "grid",
            "platform": "stationary",
            "kind": "model",
            "phenomenon": P.PM2_5,
            "value": value,
            "unit": "µg/m³",
            "observed_at": at,
            "longitude": 9.2,
            "latitude": 49.1,
            "raw_key": "pm2_5",
            "raw_value": str(value),
            "raw_unit": "μg/m³",
        }
        return Observation(**(fields | overrides))

    series = model_series(
        [
            model(10, T0),
            model(20, T0, station_id="grid-2"),
            model(99, T0, kind="observation"),
            model(99, T0, qc_flags=(QcFlag.OUT_OF_RANGE,)),
            model(5, T0 + H + timedelta(minutes=30)),
        ],
        P.PM2_5,
    )
    assert series == {T0: 15, T0 + H: 5}


def test_correction_uses_overlap_in_the_last_24_hours():
    levels = hours(T0 - 30 * H, [100] * 6 + [12] * 25)
    model = hours(T0 - 30 * H, [1] * 6 + [8] * 25)
    assert model_correction(levels, model, T0) == pytest.approx(1.5)
    assert model_correction(levels, model, T0, additive=True) == pytest.approx(4)
    assert model_correction({}, model, T0) is None
    assert model_correction(levels, hours(T0 - 24 * H, [0] * 25), T0) is None


def test_model_forecast_is_bias_corrected_and_labelled():
    levels = hours(T0 - 24 * H, [12] * 25)
    model = hours(T0 - 24 * H, [8] * 25) | hours(T0 + H, [10, 20])
    result = forecast(P.PM2_5, T0 + timedelta(minutes=20), levels, model)

    assert (result.method, result.correction, result.issued_at) == ("model_bias_corrected", 1.5, T0)
    assert [(p.hours_ahead, p.value) for p in result.points] == [(1, 15), (2, 30)]
    assert result.at(T0 + 2 * H + timedelta(minutes=59)) == 30
    assert result.at(T0 + 3 * H) is None

    uncorrected = forecast(P.PM2_5, T0, {}, hours(T0 + H, [10]))
    assert (uncorrected.method, uncorrected.points[0].value) == ("model_uncorrected", 10)


def test_temperature_uses_additive_correction():
    levels = hours(T0 - 24 * H, [-1] * 25)
    model = hours(T0 - 24 * H, [1] * 25) | hours(T0 + H, [3])
    result = forecast(P.TEMPERATURE, T0, levels, model)
    assert result.correction == -2
    assert result.points[0].value == 1


def flat_climatology(value):
    return Climatology(
        values={(day, hour): value for day in range(7) for hour in range(24)},
        counts={(day, hour): 1 for day in range(7) for hour in range(24)},
    )


def test_climatology_fallback_decays_todays_anomaly():
    result = forecast(P.PM2_5, T0, {T0: 20}, climatology=flat_climatology(10), horizon_hours=48)
    assert (result.method, result.correction) == ("climatology_decay", 2)
    assert result.points[0].value == pytest.approx(10 * 2 ** math.exp(-1 / 6))
    assert result.points[5].value == pytest.approx(10 * 2 ** math.exp(-1))
    assert result.points[-1].value == pytest.approx(10, rel=1e-3)
    assert len(result.points) == 48

    additive = forecast(P.TEMPERATURE, T0, {T0: 14}, climatology=flat_climatology(10))
    assert additive.points[5].value == pytest.approx(10 + 4 * math.exp(-1))


def test_without_level_or_sources():
    assert forecast(P.PM2_5, T0, {}, climatology=flat_climatology(10)).points[0].value == 10
    assert forecast(P.PM2_5, T0, {T0: 20}) is None
