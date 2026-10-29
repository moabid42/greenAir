# AI companion context and voice input — 2026-10-29

The web Coach uses on-device inference for every typed or spoken question.
`CoachScreen.tsx` no longer calls the deterministic analyst for replies or errors.
An unavailable model prompts the user to enable AI; failed/empty generation shows
an error/status rather than inserting a canned assistant answer. Existing saved
conversations remain readable.

## Existing application contract

`apps/web/src/lib/api/types.ts` and `consumer.ts` define the existing serving
contracts; no source adapter, backend endpoint or upstream contract changed.
`ai/records.ts` makes all currently loaded day, grid, station, segment and local
wearable records candidates. Raw field names, values, units, provenance and
missing/stale flags remain available. A columnar day overview retains every
hour's values, factors, missing fields and UTC instants without repeating keys.
Per-hour records retain detailed channel provenance. Derived activity scores,
recommended windows and ride summaries are included with an explicit derived label.

Local saved WHOOP/Apple Watch fixture sessions are included even if disconnected,
with an explicit synthetic label. No fixtures are automatically connected or
played. Real BLE samples retain source_type/quality, timestamps and units and are
deduplicated by sample_id across recorded/recent buffers. No wearable data are
uploaded for inference.

The model has a 4,096-token context. Full records are selected by question relevance
within a conservative budget, reserving room for an answer and the chat template.
Every category reports total and included record counts. Omitted/oversized records
are not treated as missing source data. This is access to loaded application data,
not an exhaustive query of the backend archive or every future day. The existing
research reference §1.4 and §16 govern coordinates, timezone and freshness;
this change does not introduce a new catalog source or revise the dated snapshot.

## Local contract probe

GET `http://localhost:8000/api/v1/day?date=2026-10-29`, checked
2026-10-29T10:47:37Z: HTTP 200, application/json. Existing keys: name, date,
timezone, generatedAt, source, hours, buildId, status, retrievedAt, attribution.
The decoded response serialized to about 41 KB, demonstrating why raw provenance
cannot all fit into a short model prompt. GET `/api/v1/sensors` at the same UTC
check returned HTTP 200 JSON, an array with 22 records. Counts describe this local
response only. No claim about current upstream availability or latest observation
time was established; timestamps in individual records remain authoritative.

## Voice completion contract

Speech recognition uses continuous/interim results to update a draft. Recognition
ending on a pause restarts listening and retains finalized phrases. Only an explicit
**Finish speaking** tap requests stop; submission waits for the recognizer's end
and final results. Errors, cancellation, new chat and leaving Coach never submit.
Duplicate completion callbacks cannot send twice. Microphone use requires a ready
AI and cannot start while generating. Browser speech recognition can use a provider
service; it is distinct from local model inference.

Browser API contract checked against MDN:
[continuous](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous),
[stop](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop),
[final results](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult/isFinal).

Validation: web lint, TypeScript and production build passed on Node 24.22.2;
10 web tests cover existing missing-data/DST behavior plus transcript accumulation,
pauses, final-result draining, cancellation, permissions/errors, device/backend
provenance, deduplication, context limits, refreshed samples and all-hour coverage.
Real microphone hardware and downloaded-model answer quality were not exercised.
