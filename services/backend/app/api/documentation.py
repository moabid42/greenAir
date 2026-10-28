"""Generate OpenAPI from registered routes, with Google API design conventions.

There is no separately maintained OpenAPI snapshot. Additions to the routers are
included automatically, with shared errors and executable examples for demo queries.
"""

from datetime import UTC, date, datetime

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.api.errors import ERROR_RESPONSES, ErrorResponse
from app.serving.demo import DemoRepository

DESCRIPTION = """
Read-only Green City Heilbronn backend for frontend development.

**All serving data defaults to synthetic (`source: mock`).** Demo sensor identities,
street lines, measurements, and spatial patterns are invented. Confidence in street
scores is zero. No provider, database, broker, or data pipeline is needed to start.

### Try it
1. Open **Conditions → Get a day resource**, date `2026-10-29`.
2. Open **Conditions → Get a grid resource**, same date.
3. List sensors or segments and copy an ID into a Get operation.
4. List scores with profile `running`, t `2026-10-29T12:00:00Z`.
5. Look up a score at lat `49.1425`, lon `9.2115`, or request best times for segment `1`.

### Design and contracts
Versioned `/v1` routes use resource names, Get/List operation IDs, bounded pagination,
a custom `:lookup` method, and Google-style JSON errors with ErrorInfo details.
These follow Google's AIP-121, AIP-131/132, AIP-136, AIP-158, and AIP-193 guidance.
This is a pragmatic HTTP/OpenAPI implementation, not a protobuf API or a claim of
full Google AIP conformance. Compatibility exceptions are documented below.

The existing frontend uses `/api/v1/day`, `/api/v1/grid`, `/api/v1/sensors` and optional
unversioned street routes. They call the same application queries. Compatibility
sensor lists are bare arrays; their `name` is a display name (`resourceName` carries
the resource identity). GeoJSON collections retain their standard feature envelope.
Core responses use camelCase for frontend compatibility; street responses retain
snake_case. Canonical validation uses HTTP 400; compatibility validation retains 422.

Day/grid factors are 0–100, higher is better; **the client applies sport weights**.
Street scores are a separate contract using the backend sport engine.
UTC instants use RFC 3339; day/grid arrays always contain 24 Berlin wall-clock slots,
including DST days. Best-time recommendations skip nonexistent spring hours and use
the first occurrence of a repeated autumn hour. Demo dates: 2020-01-01 to 2100-12-31.

`/stations/status` defaults to mock; only explicit `GREENAIR_STATION_DATA_MODE=live`
uses the previously implemented openSenseMap adapter. Core serving remains mock.
SSE, vector tiles, storage, and pipeline refresh are deferred, not simulated as working.
"""

TAGS = [
    {"name": "Conditions", "description": "City day and grid resources; synthetic factor scores."},
    {"name": "Sensors", "description": "Synthetic markers and optional upstream station status."},
    {"name": "Street scores", "description": "Demo segment geometry and sport-specific scores."},
    {"name": "Operations", "description": "Process health and data-build status."},
    {
        "name": "Frontend compatibility",
        "description": "Existing frontend paths; shared query layer.",
    },
]


def configure_openapi(application: FastAPI) -> None:
    def generate() -> dict:
        if application.openapi_schema is not None:
            return application.openapi_schema
        schema = get_openapi(
            title=application.title,
            version=application.version,
            description=application.description,
            routes=application.routes,
            tags=TAGS,
        )
        schema["externalDocs"] = {
            "description": "Google API design guidance (AIPs)",
            "url": "https://google.aip.dev/121",
        }
        schema["servers"] = [{"url": "/", "description": "Current API origin"}]
        # Every route, including routes added after create_app, receives the actual
        # shared error contract. Canonical parameter validation returns 400, not 422.
        schema["components"]["schemas"].update(
            ErrorResponse.model_json_schema(ref_template="#/components/schemas/{model}").get(
                "$defs", {}
            )
        )
        error = ErrorResponse.model_json_schema(ref_template="#/components/schemas/{model}")
        error.pop("$defs", None)
        schema["components"]["schemas"]["ErrorResponse"] = error
        repository = DemoRepository()
        repository.generated_at = datetime(2026, 10, 28, tzinfo=UTC)
        example_day = repository.day(date(2026, 10, 29)).model_dump(mode="json", by_alias=True)
        example_sensor = repository.sensors()[0].model_dump(mode="json", by_alias=True)
        for path, methods in schema["paths"].items():
            for method, operation in methods.items():
                if method not in {"get", "post", "put", "patch", "delete"}:
                    continue
                responses = operation["responses"]
                codes = {400, 404, 503} if path.startswith("/v1/") else {400, 404, 422, 503}
                if path == "/stations/status":
                    codes.add(502)
                for code in codes:
                    responses[str(code)] = {
                        "description": ERROR_RESPONSES.get(code, {}).get(
                            "description", "Upstream service unavailable."
                        ),
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                                "example": {
                                    "error": {
                                        "code": code,
                                        "status": "NOT_FOUND"
                                        if code == 404
                                        else (
                                            "UNAVAILABLE"
                                            if code in {502, 503}
                                            else "INVALID_ARGUMENT"
                                        ),
                                        "message": "Check the resource and request parameters.",
                                        "details": [
                                            {
                                                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                                                "reason": "RESOURCE_NOT_FOUND"
                                                if code == 404
                                                else "REQUEST_FAILED",
                                                "domain": "greenair.local",
                                                "metadata": {},
                                            }
                                        ],
                                    }
                                },
                            }
                        },
                    }
                if path.startswith("/v1/"):
                    responses.pop("422", None)
                for parameter in operation.get("parameters", []):
                    examples = {
                        "date": "2026-10-29",
                        "segment_id": 1,
                        "sensor_id": "mock-1",
                        "profile": "running",
                    }
                    if parameter["name"] in examples:
                        parameter["example"] = examples[parameter["name"]]
                content = responses.get("200", {}).get("content", {}).get("application/json")
                if content is not None:
                    if operation["operationId"] in {"GetDay", "GetFrontendDay"}:
                        content["example"] = example_day
                    elif operation["operationId"] == "GetSensor":
                        content["example"] = example_sensor
        application.openapi_schema = schema
        return schema

    application.openapi = generate
