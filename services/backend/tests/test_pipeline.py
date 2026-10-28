from datetime import UTC, datetime, timedelta

from app.processing.pipeline import PipelineInput, main, run
from app.schemas.scores import PipelineResult

ISSUED = datetime(2026, 10, 28, 12, 20, tzinfo=UTC)
SEGMENT = {"segment_id": "s", "coordinates": [[9.2150, 49.1420], [9.2200, 49.1420]]}


def request(**overrides):
    fields = {
        "issued_at": ISSUED.isoformat(),
        "raw_observations": [],
        "segments": [SEGMENT],
        "profiles": ["running"],
        "horizon_hours": 3,
    }
    return PipelineInput.model_validate(fields | overrides)


def test_without_data_only_daylight_is_known_and_confidence_is_zero():
    result = run(request())
    assert result.forecasts == []
    assert [layer.pm_source for layer in result.layers] == ["none"]
    assert [score.at for score in result.scores] == [
        datetime(2026, 10, 28, 13 + step, tzinfo=UTC) for step in range(3)
    ]
    assert all(set(score.components) == {"daylight"} for score in result.scores)
    assert all(score.confidence == 0 for score in result.scores)


def test_model_only_input_is_forecast_without_correction():
    model = [
        {
            "source": "open-meteo:air-quality",
            "station_id": "grid",
            "platform": "stationary",
            "kind": "model",
            "raw_key": "pm2_5",
            "raw_value": 10.0,
            "raw_unit": "μg/m³",
            "observed_at": (ISSUED + timedelta(hours=step)).isoformat(),
            "longitude": 9.2,
            "latitude": 49.1,
        }
        for step in range(1, 4)
    ]
    result = run(request(raw_observations=model))
    assert [(f.phenomenon, f.method, f.points) for f in result.forecasts] == [
        ("pm2_5", "model_uncorrected", 3)
    ]
    assert all(score.components["pm25"] == 25 / 30 for score in result.scores)


def test_cli_writes_a_valid_result(tmp_path):
    source = tmp_path / "input.json"
    target = tmp_path / "result.json"
    source.write_text(request().model_dump_json(), encoding="utf-8")

    assert main([str(source), "--output", str(target)]) == 0
    result = PipelineResult.model_validate_json(target.read_text(encoding="utf-8"))
    assert len(result.scores) == 3
