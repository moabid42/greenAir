"""The generated document must describe the live route contracts, including errors."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.schemas.serving import DayForecast, Sensor


def test_openapi_covers_every_route_with_unique_operations_and_valid_references():
    application = create_app(Settings(_env_file=None))
    with TestClient(application) as client:
        assert client.get("/docs").status_code == 200
        assert client.get("/redoc").status_code == 200
        schema = client.get("/openapi.json").json()
    assert schema["openapi"].startswith("3.1.")
    expected = {
        "/health",
        "/stations/status",
        "/api/v1/day",
        "/api/v1/grid",
        "/api/v1/sensors",
        "/v1/days/{date}",
        "/v1/grids/{date}",
        "/v1/sensors",
        "/v1/sensors/{sensor_id}",
        "/v1/segments",
        "/v1/segments/{segment_id}",
        "/v1/scores",
        "/v1/scores:lookup",
        "/v1/segments/{segment_id}/bestTimes/{date}",
        "/v1/status",
        "/segments",
        "/scores",
        "/score",
        "/best-time",
        "/status",
    }
    assert expected == set(schema["paths"])
    operations = []
    for path, methods in schema["paths"].items():
        operation = methods["get"]
        operations.append(operation["operationId"])
        assert operation["summary"]
        assert operation["description"]
        assert operation["tags"]
        assert "200" in operation["responses"]
        assert operation["responses"]["404"]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorResponse"
        }
        if path.startswith("/v1/"):
            assert "400" in operation["responses"]
            assert "422" not in operation["responses"]
    assert len(operations) == len(set(operations))

    def check_refs(value):
        if isinstance(value, dict):
            if "$ref" in value:
                ref = value["$ref"]
                assert ref.startswith("#/")
                target = schema
                for key in ref[2:].split("/"):
                    target = target[key]
            for nested in value.values():
                check_refs(nested)
        elif isinstance(value, list):
            for nested in value:
                check_refs(nested)

    check_refs(schema)
    day = schema["paths"]["/v1/days/{date}"]["get"]["responses"]["200"]
    assert (
        DayForecast.model_validate(day["content"]["application/json"]["example"]).source == "mock"
    )
    sensor = schema["paths"]["/v1/sensors/{sensor_id}"]["get"]["responses"]["200"]
    assert Sensor.model_validate(sensor["content"]["application/json"]["example"]).id == "mock-1"
    assert schema["externalDocs"]["url"] == "https://google.aip.dev/121"


def test_openapi_is_generated_from_routes_and_settings_instead_of_a_static_file():
    application = create_app(Settings(_env_file=None, app_name="Custom application"))

    @application.get("/v1/example", tags=["Operations"], operation_id="GetExample")
    def example() -> dict[str, str]:
        """An additional route is included without editing an OpenAPI document."""
        return {"message": "example"}

    schema = application.openapi()
    assert schema["info"]["title"] == "Custom application"
    assert schema["paths"]["/v1/example"]["get"]["operationId"] == "GetExample"
