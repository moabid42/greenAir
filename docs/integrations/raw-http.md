# Bounded HTTP raw landing

Recovered `LandingHTTPClient` from `842912b` with explicit bounds added on decoded
size and retry waiting. This transport does not select or verify a provider.
Source adapters must still follow the research workflow and current provider docs.

Each request attempt lands independently through `Repository.land_raw`, preserving
wire bytes, HTTP status/headers, request method/parameters/body, retrieval UTC and
transport errors before returning a parseable handle or retrying. Interruptions and
oversized bodies retain the received prefix with an error, and cannot be decoded.
Raw database failures propagate immediately; the client cannot hand unpersisted
bytes to an adapter. It never advances source watermarks or follows redirects.

Requests use explicit per-operation timeouts and a total elapsed check while
streaming, at most five attempts, exponential backoff, and a configurable maximum
retry delay (30 seconds by default). Each blocking read is still bounded by the
HTTP timeout. If Retry-After exceeds the waiting limit, return the landed failure
for a later scheduled pass; never retry earlier than the provider requested.
The worker must record a partial/failure manifest and preserve its checkpoint.

Accept-Encoding requests identity. If a server nevertheless compresses a JSON
response, gzip and zlib-wrapped deflate decode within the same byte bound. Unsupported
encodings, truncated/concatenated compressed streams and oversized decoded bodies
fail explicitly after raw landing. JSON media types must be application/json or
application/*+json. HTTP success and JSON media type do not bypass actual parsing.

Validation on 2026-10-28: 14 offline tests cover landed retries, exhausted attempts,
transport interruption, prefix preservation, exact gzip wire bytes, malformed JSON,
unsupported media/encoding, decompression limits, deferred long Retry-After and a
POST response persisted through the real repository before parse failure. These
use synthetic responses, not live availability evidence. Root checks and container
smoke verify compatibility with the existing standalone demo.
