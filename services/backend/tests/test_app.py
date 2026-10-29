import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_service_starts_and_exposes_health_without_external_infrastructure():
    settings = Settings(_env_file=None, app_name="Test API", cors_origins=[])
    assert settings.serving_data_mode == "stored" and settings.station_data_mode == "live"
    application = create_app(settings)
    with TestClient(application) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "Test API"}

        schema = client.get("/openapi.json")
        assert schema.status_code == 200
        assert schema.json()["info"]["title"] == "Test API"
        assert "/health" in schema.json()["paths"]
        assert client.get("/docs").status_code == 200


@pytest.mark.parametrize(
    ("origin", "status", "allowed_origin"),
    [
        ("http://localhost:5173", 200, "http://localhost:5173"),
        ("https://unconfigured.example", 400, None),
    ],
)
def test_cors_preflight_uses_configured_origins(origin, status, allowed_origin):
    application = create_app(Settings(_env_file=None, cors_origins=["http://localhost:5173"]))
    with TestClient(application) as client:
        response = client.options(
            "/health",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )
    assert response.status_code == status
    assert response.headers.get("access-control-allow-origin") == allowed_origin


def test_settings_load_service_dotenv_and_environment_takes_precedence(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        'GREENAIR_APP_NAME="From file"\nGREENAIR_CORS_ORIGINS=["http://localhost:5173"]\n',
        encoding="utf-8",
    )
    monkeypatch.delenv("GREENAIR_CORS_ORIGINS", raising=False)
    monkeypatch.setenv("GREENAIR_APP_NAME", "From environment")

    settings = Settings(_env_file=env_file)

    assert settings.app_name == "From environment"
    assert settings.cors_origins == ["http://localhost:5173"]
