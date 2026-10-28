"""Nullable source contracts must remain explicit in models and generated OpenAPI."""

from datetime import UTC, datetime

from app.main import create_app
from app.schemas.serving import DayForecast, Factors, HourConditions


def test_null_contract_keeps_zero_distinct_and_preserves_instant_provenance():
    hour = HourConditions(
        hour=2,
        temp_c=None,
        humidity=None,
        pm25=0,
        no2=None,
        wind_kmh=None,
        rush=None,
        daylight=None,
        factors=Factors(heat=None, air=None, wind=None, traffic=None, light=None, safety=None),
        instants=[],
        missing=["tempC", "traffic"],
    )
    result = DayForecast(
        name="days/2026-03-29",
        date="2026-03-29",
        generated_at=datetime.now(UTC),
        source="forecast",
        hours=[hour.model_copy(update={"hour": h}) for h in range(24)],
        status="partial",
    )
    payload = result.model_dump(mode="json", by_alias=True)
    assert payload["hours"][2]["tempC"] is None and payload["hours"][2]["pm25"] == 0
    schema = create_app().openapi()["components"]["schemas"]
    for field in ["tempC", "humidity", "pm25", "no2", "windKmh", "rush"]:
        assert {v.get("type") for v in schema["HourConditions"]["properties"][field]["anyOf"]} >= {
            "null"
        }
    assert "ChannelProvenance" in schema
