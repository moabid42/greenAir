from tests.e2e.conftest import bus_round_trip

CAPTURED = "raw_observations_atrai_2026-10-28.json"


def test_captured_records_cross_the_bus_unchanged(load_raw):
    records = load_raw(CAPTURED)
    received = bus_round_trip(records)

    assert received == records
    assert len(received) == 34
    assert {record.station_id for record in received} == {"69bd6c0f867a8a00078bebc4"}


def test_provider_nulls_keys_and_naive_times_are_preserved(load_raw):
    received = bus_round_trip(load_raw(CAPTURED))

    nulls = {record.raw_key for record in received if record.raw_value is None}
    assert {"Illuminance", "UV Index", "Wind Speed", "Rain Rate"} <= nulls
    pm25 = next(record for record in received if record.raw_key == "Finedust PM2.5")
    assert pm25.raw_value == 3.82
    assert pm25.observed_at.tzinfo is None
    assert pm25.retrieved_at.utcoffset().total_seconds() == 0
    assert (pm25.longitude, pm25.latitude) == (8.989321, 49.15711)
