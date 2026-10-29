import gzip

import httpx
import pytest
from test_ingestion_foundation import repository as repository  # noqa: F401

from app.ingestion.http import LandingHTTPClient


class LandingSpy:
    def __init__(self):
        self.rows = []

    def land_raw(self, raw):
        self.rows.append(raw)
        return len(self.rows)


def test_error_payload_lands_before_retry_and_success_before_decode():
    landing, delays = LandingSpy(), []

    def handler(request):
        assert request.headers["accept-encoding"] == "identity"
        assert dict(request.url.params) == {"limit": "3"}
        if not landing.rows:
            return httpx.Response(
                429, stream=httpx.ByteStream(b"rate limited"), headers={"Retry-After": "2"}
            )
        assert landing.rows[0].body == b"rate limited"
        return httpx.Response(
            200,
            stream=httpx.ByteStream(b'{"value": 3}'),
            headers={"Content-Type": "application/json"},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        response = LandingHTTPClient(client, landing, sleep=delays.append).fetch(
            "synthetic", "https://example.test/items", params={"limit": 3}
        )
    assert len(landing.rows) == 2
    assert response.raw_ref == 2
    assert response.json() == {"value": 3}
    assert delays == [2]


def test_wrong_type_and_oversized_payload_remain_raw_and_cannot_decode():
    landing = LandingSpy()
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, stream=httpx.ByteStream(b"<html>bad</html>"))
        )
    ) as client:
        response = LandingHTTPClient(client, landing, max_bytes=5).fetch(
            "synthetic", "https://example.test/items"
        )
    assert landing.rows[0].body == b"<html"
    assert "prefix" in landing.rows[0].error
    with pytest.raises(ValueError):
        response.json()


def test_wire_encoding_is_preserved_verbatim_before_decoding():
    landing = LandingSpy()
    compressed = gzip.compress(b'{"value": 3}')
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                stream=httpx.ByteStream(compressed),
                headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
            )
        )
    ) as client:
        response = LandingHTTPClient(client, landing).fetch("synthetic", "https://example.test")
    assert landing.rows[0].body == compressed
    assert response.json() == {"value": 3}


def test_transport_failure_is_landed_and_retried_with_backoff():
    landing, delays = LandingSpy(), []

    def fail(request):
        raise httpx.ConnectTimeout("synthetic timeout", request=request)

    with httpx.Client(transport=httpx.MockTransport(fail)) as client:
        response = LandingHTTPClient(client, landing, sleep=delays.append).fetch(
            "synthetic", "https://example.test"
        )
    assert response.raw.http_status is None
    assert len(landing.rows) == 3
    assert all("ConnectTimeout" in row.error for row in landing.rows)
    assert delays == [0.5, 1]


def test_timeout_after_headers_lands_prefix_and_retries_same_request():
    landing, delays, urls = LandingSpy(), [], []

    class Interrupted(httpx.SyncByteStream):
        def __iter__(self):
            yield b'{"value'
            raise httpx.ReadTimeout("synthetic body interruption")

    def handler(request):
        urls.append(str(request.url))
        return httpx.Response(
            200,
            stream=Interrupted() if not landing.rows else httpx.ByteStream(b'{"value": 3}'),
            headers={"Content-Type": "application/json"},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = LandingHTTPClient(client, landing, sleep=delays.append).fetch(
            "synthetic", "https://example.test/items", params={"offset": 3}
        )
    assert urls[0] == urls[1]
    assert landing.rows[0].body == b'{"value'
    assert "ReadTimeout" in landing.rows[0].error
    assert result.json() == {"value": 3}
    assert delays == [0.5]


def test_retries_exhaust_at_limit_and_every_failure_is_landed():
    landing, delays = LandingSpy(), []
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                503,
                stream=httpx.ByteStream(b"unavailable"),
                headers={"Content-Type": "text/plain"},
            )
        )
    ) as client:
        result = LandingHTTPClient(client, landing, max_attempts=2, sleep=delays.append).fetch(
            "synthetic",
            "https://example.test",
        )
    assert len(landing.rows) == 2 and delays == [0.5]
    assert result.raw.http_status == 503 and all(row.body == b"unavailable" for row in landing.rows)
    with pytest.raises(ValueError):
        result.json()


def test_large_retry_after_defers_instead_of_retrying_early_or_waiting_unbounded():
    landing, delays = LandingSpy(), []
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                429,
                stream=httpx.ByteStream(b"slow down"),
                headers={"Retry-After": "86400"},
            )
        )
    ) as client:
        result = LandingHTTPClient(client, landing, sleep=delays.append).fetch(
            "synthetic",
            "https://example.test",
        )
    assert len(landing.rows) == 1 and delays == [] and result.raw.http_status == 429


def test_decoded_size_limit_rejects_small_compressed_bomb_after_landing():
    landing = LandingSpy()
    wire = gzip.compress(b'"' + b"a" * 5000 + b'"')
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                stream=httpx.ByteStream(wire),
                headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
            )
        )
    ) as client:
        result = LandingHTTPClient(client, landing, max_bytes=100).fetch(
            "synthetic",
            "https://example.test",
        )
    assert landing.rows[0].body == wire and landing.rows[0].error is None
    with pytest.raises(ValueError, match="decoded response exceeded"):
        result.json()


@pytest.mark.parametrize(
    "media,encoding,body",
    [
        ("application/notjson", "identity", b"{}"),
        ("application/json", "br", b"{}"),
        ("application/json", "gzip", b"invalid gzip"),
        ("application/json", "gzip", gzip.compress(b"{}")[:-4]),
        ("application/json", "identity", b"invalid json"),
    ],
)
def test_invalid_contract_payloads_remain_replayable(media, encoding, body):
    landing = LandingSpy()
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                stream=httpx.ByteStream(body),
                headers={"Content-Type": media, "Content-Encoding": encoding},
            )
        )
    ) as client:
        response = LandingHTTPClient(client, landing).fetch("synthetic", "https://example.test")
    with pytest.raises(ValueError):
        response.json()
    assert landing.rows[0].body == body


def test_parse_failure_keeps_persisted_wire_evidence_and_checkpoint(repository):
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                stream=httpx.ByteStream(b"invalid json"),
                headers={"Content-Type": "application/json"},
            )
        )
    ) as client:
        result = LandingHTTPClient(client, repository).fetch(
            "synthetic",
            "https://example.test/query",
            method="POST",
            body=b'{"limit":3}',
        )
    with pytest.raises(ValueError):
        result.json()
    stored = repository.get_raw(result.raw_ref)
    assert stored.body == b"invalid json" and stored.request_body == b'{"limit":3}'
    assert stored.method == "POST" and repository.get_watermark("synthetic").last_offset == 0
