"""Exercise the documented backend over HTTP; no development dependencies required.

This offline contract smoke requires an explicitly configured mock API:
GREENAIR_SERVING_DATA_MODE=mock GREENAIR_STATION_DATA_MODE=mock just backend-up
Then run `just backend-smoke`. Override GREENAIR_SMOKE_URL for another port.
Normal `just up` is real data; use /api/v1/data-status for its coverage/status.
"""

import gzip
import json
import os
import urllib.error
import urllib.request

BASE_URL = os.environ.get("GREENAIR_SMOKE_URL", "http://127.0.0.1:8000").rstrip("/")


def get(path, expected=200):
    request = urllib.request.Request(
        BASE_URL + path, headers={"Accept-Encoding": "gzip", "Origin": "http://localhost:3000"}
    )
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        assert response.status == expected, (path, response.status, response.read()[:200])
        body = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return body, response.headers


def json_get(path, expected=200):
    body, _ = get(path, expected)
    return json.loads(body)


def main():
    assert json_get("/health")["status"] == "ok"
    assert b"swagger-ui" in get("/docs")[0]
    assert b"redoc" in get("/redoc")[0]
    schema = json_get("/openapi.json")
    samples = {
        "date": "2026-10-29", "sensor_id": "mock-1", "segment_id": "1",
        "profile": "running", "t": "2026-10-29T12:00:00Z",
        "lat": "49.1425", "lon": "9.2115",
    }
    checked = 0
    # Follow every documented GET operation, using schema locations and required parameters.
    for path, operations in schema["paths"].items():
        operation = operations.get("get")
        if operation is None:
            continue
        url = path
        query = []
        for parameter in operation.get("parameters", []):
            if not parameter.get("required"):
                continue
            name = parameter["name"]
            value = samples[name]
            if parameter["in"] == "path":
                url = url.replace("{" + name + "}", value)
            else:
                query.append(name + "=" + value)
        if query:
            url += "?" + "&".join(query)
        json_get(url)
        checked += 1
    assert checked >= 20
    day = json_get("/api/v1/day?date=2026-10-29")
    assert day["source"] == "mock" and len(day["hours"]) == 24
    grid, headers = get("/api/v1/grid?date=2026-10-29")
    assert headers.get("Content-Encoding") == "gzip"
    assert headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"
    assert len(json.loads(grid)["cells"]["features"]) > 1000
    assert json_get("/stations/status")["source"] == "mock"
    error = json_get("/v1/days/invalid", expected=400)["error"]
    assert error["status"] == "INVALID_ARGUMENT"
    assert json_get("/v1/sensors/missing", expected=404)["error"]["status"] == "NOT_FOUND"
    print(f"PASS: {checked} documented GET routes, Swagger/ReDoc/OpenAPI, mock provenance, gzip, CORS, errors")


if __name__ == "__main__":
    main()
