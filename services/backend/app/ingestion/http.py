"""Bounded HTTP retrieval that commits raw bytes before returning or retrying."""

import json
import time
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from math import isfinite
from typing import Any, Protocol

import httpx

from app.ingestion.contracts import RawPayload

RETRYABLE = {429, 500, 502, 503, 504}


class RawLanding(Protocol):
    def land_raw(self, raw: RawPayload) -> int: ...


@dataclass(frozen=True)
class LandedResponse:
    raw_ref: int
    raw: RawPayload
    latency_ms: float
    max_decoded_bytes: int = 16_777_216

    def json(self) -> Any:
        """Decode only after landing, honoring a provider's content encoding."""
        headers = httpx.Headers(self.raw.response_headers)
        content_type = headers.get("content-type", "").lower().split(";")[0].strip()
        if content_type != "application/json" and not (
            content_type.startswith("application/") and content_type.endswith("+json")
        ):
            raise ValueError(f"expected JSON, got {content_type!r}")
        if self.raw.error or self.raw.http_status != 200:
            raise ValueError(self.raw.error or f"HTTP {self.raw.http_status}")
        body = self.raw.body
        encoding = headers.get("content-encoding", "identity").lower().strip()
        if encoding in {"gzip", "deflate"}:
            decoder = zlib.decompressobj(31 if encoding == "gzip" else 15)
            try:
                body = decoder.decompress(body, self.max_decoded_bytes + 1)
            except zlib.error as exc:
                raise ValueError("invalid compressed payload") from exc
            if len(body) > self.max_decoded_bytes or decoder.unconsumed_tail:
                raise ValueError("decoded response exceeded byte limit")
            if not decoder.eof or decoder.unused_data:
                raise ValueError("incomplete or concatenated compressed payload")
        elif encoding != "identity":
            raise ValueError(f"unsupported response encoding {encoding!r}")
        if len(body) > self.max_decoded_bytes:
            raise ValueError("decoded response exceeded byte limit")
        return json.loads(body)


class LandingHTTPClient:
    def __init__(
        self,
        client: httpx.Client,
        landing: RawLanding,
        *,
        timeout: float = 30,
        max_attempts: int = 3,
        max_bytes: int = 16_777_216,
        max_retry_delay: float = 30,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be finite and positive")
        if not 1 <= max_attempts <= 5 or max_bytes <= 0:
            raise ValueError("invalid attempt or response byte limit")
        if not isfinite(max_retry_delay) or max_retry_delay <= 0:
            raise ValueError("retry delay limit must be finite and positive")
        self.client = client
        self.landing = landing
        self.timeout = timeout
        self.max_attempts = max_attempts
        self.max_bytes = max_bytes
        self.max_retry_delay = max_retry_delay
        self.sleep = sleep

    def fetch(
        self,
        source_id: str,
        url: str,
        *,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
    ) -> LandedResponse:
        """Each attempt lands separately, including HTTP/network/size failures.

        No hidden redirects: a redirect's body and headers are evidence, and a
        caller can explicitly follow a verified distribution URL. Byte limits
        preserve the received prefix with an error; incomplete bodies must never
        enter an adapter. The caller records the final run manifest.
        """
        for attempt in range(self.max_attempts):
            started = time.monotonic()
            received = bytearray()
            status = None
            response_headers: dict[str, str] = {}
            error = None
            transport_failure = False
            try:
                with self.client.stream(
                    method,
                    url,
                    params=params,
                    content=body,
                    headers={"Accept-Encoding": "identity", **(headers or {})},
                    timeout=self.timeout,
                    follow_redirects=False,
                ) as response:
                    status = response.status_code
                    response_headers = dict(response.headers)
                    for chunk in response.iter_raw():
                        if time.monotonic() - started > self.timeout:
                            error = "response exceeded total timeout; stored bytes are a prefix"
                            transport_failure = True
                            break
                        remaining = self.max_bytes - len(received)
                        received.extend(chunk[:remaining])
                        if len(chunk) > remaining:
                            error = "response exceeded byte limit; stored bytes are a prefix"
                            break
            except httpx.RequestError as exc:
                error = f"{type(exc).__name__}: {exc}"
                transport_failure = True
            latency_ms = (time.monotonic() - started) * 1000
            raw = RawPayload(
                source_id=source_id,
                url=url,
                method=method,
                request_params=params or {},
                request_body=body,
                retrieved_at_utc=datetime.now(UTC),
                http_status=status,
                response_headers=response_headers,
                body=bytes(received),
                error=error,
            )
            landed = LandedResponse(self.landing.land_raw(raw), raw, latency_ms, self.max_bytes)
            if attempt + 1 == self.max_attempts:
                return landed
            if status not in RETRYABLE and not transport_failure:
                return landed
            delay = 0.5 * 2**attempt
            retry_after = response_headers.get("retry-after")
            if retry_after:
                try:
                    advertised = float(retry_after)
                except ValueError:
                    try:
                        advertised = (
                            parsedate_to_datetime(retry_after) - datetime.now(UTC)
                        ).total_seconds()
                    except (TypeError, ValueError, OverflowError):
                        advertised = 0
                if isfinite(advertised):
                    delay = max(delay, advertised)
            if delay > self.max_retry_delay:
                # Do not retry before the provider's advertised time, or block
                # a bounded pass for an arbitrary duration. A later poll can resume.
                return landed
            self.sleep(max(0, delay))
        raise AssertionError("unreachable")
