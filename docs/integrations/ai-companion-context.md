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

## Latency correction — 2026-10-29

The data integration changed short summaries into near-full-context prompts, even
for greetings, and increased the output ceiling from 70 to 200 tokens. Inference
still runs locally through wllama; sending a chat does not query a backend LLM.
Prompt caching reuses a matching prefix, but changed reference records still need
prefill. These are code-level causes of additional work, not a measured attribution
of the user's total latency to a particular device/backend.

Self-contained greetings/thanks now skip record construction and injection. Data
questions and ambiguous follow-ups retain fresh record access. Reference selection
has a 1,600 estimated-token ceiling, expanded to 2,000 for daily/timing questions
so the full-day columnar overview can fit. Question-related day, station, street or
device records outrank unrelated metadata. Complete selected records, original
values, source labels and included/total counts remain intact; larger records can
still be omitted. The reply ceiling is 120 tokens. The system prompt is unchanged.

Thinking was already disabled with `reasoning: false` and
`enable_thinking: false` at load, warmup and generation. Load now also sets
`reasoning_budget_tokens: 0`. The installed wllama 3.8.1 source declares and
forwards these settings; Qwen documents the template's
[hard thinking switch](https://qwen.readthedocs.io/en/stable/getting_started/quickstart.html).
An offline fake-runtime test verifies the actual arguments passed at each boundary;
it does not establish real-model behavior or generation speed.

Local stored-API probe at 2026-10-29T11:13:14Z: GET
`http://localhost:8000/api/v1/day?date=2026-10-29`,
`/api/v1/grid?date=2026-10-29` and `/api/v1/sensors` all returned HTTP 200,
application/json with the existing contracts. The loaded sample supplied 1,613
candidate records, including 24 hours, 1,562 grid cells and 22 sensors. This is a
local retrieval sample, not a claim about current upstream observations; individual
record timestamps/provenance remain authoritative.

Against that sample, estimated serialized prompt sizes before/after were:
greeting 3,591/1,122; best running time 3,607/3,077 with the full-day overview
retained; station air quality 3,526/2,853 with three station records selected
(previously zero). Estimates use the application's conservative character heuristic,
not the model tokenizer. The sample excludes activity metadata, wearables and
conversation history, so actual chat sizes vary. Capture/probe script:
ignored `data/runtime/ai-latency-20261029/`. No real model latency benchmark or
answer-quality claim is made.

Validation: `just check-web` passed lint, 13 tests and the production build;
`just lint` passed. Rebuilt only the local web container. It reports healthy;
HTTP checks verified isolation headers and the served JavaScript's new context
policy, disabled-thinking flags, zero reasoning budget and 120-token output cap.
No downloaded-model generation or real-device timing was exercised.


### Further prompt reduction and timing — 2026-10-29

Shortened the fixed system instructions while retaining tone, scope, provenance,
missing-data, capability and medical-safety rules. Focused questions now exclude
unrelated categories before serialization, instead of filling every spare token.
Explicit follow-ups (such as “And tomorrow?”) and unclassified questions still
consider all categories. Availability metadata is selected first to preserve units
and source-loading/errors. Topic detection is heuristic; mixed/implicit questions
can still omit useful records. Included/total counts remain explicit.

The second local probe at 2026-10-29T11:21:11Z used the same three GET routes,
all HTTP 200 application/json, and again supplied 1,613 candidates. Compared with
the first fix, prompt estimates fell from 1,122 to 812 for greetings, 3,077 to
2,710 for daily timing (all hours retained), and 2,853 to 2,290 for station air
quality (two complete station records plus availability/units). The smaller
station selection trades breadth for essential context. Question-time record
selection skips serialization of irrelevant grid records. This is a bounded local
sample; timing includes tooling overhead and is not a model benchmark.

AI settings now show the last generation's time to first visible text and total
elapsed time, including preparation of the inference request. Timing starts after
application context construction. State retains only timings, input character
count and whether the user stopped; no prompt or answer text, persistence or
telemetry is added. The measurements include runtime scheduling and streaming,
so they do not isolate prefill from all other overhead. Thinking remains disabled.
A fake-runtime test verifies timings/counts as well as the disabled-thinking
arguments. Web lint/tests (14)/production build pass. Actual device latency and
model answer quality remain unverified.

### Question-specific data contracts — 2026-10-29

`ai/selection.ts` routes questions locally before constructing records. The six
families are weather, air, station measurements, devices, streets and activity.
Mixed questions select multiple families. Weather includes only tempC, humidity,
windKmh and daylight plus hour/UTC instants, original missing flags and matching
channel provenance. Air forecasts use pm25/no2. Activity advice retains all day
fields/factors. Station questions select measurements without a city forecast,
unless explicitly comparing with a forecast. Pollutant/temperature station queries
project matching original channel keys and provenance; selected/omitted channel
names disclose the projection, retaining identity, exposure, timestamps and stale
flags. Generic station queries retain every station channel. Source data are not
mutated. Unrecognized provider channel names may be omitted by channel matching.

Street questions select grid/segment data; device questions select synthetic
fixture and real BLE records with the original distinct source labels. The scoped
candidate pool excludes unrelated families before expensive construction. Coverage
counts describe that candidate pool, not every backend record; availability
metadata still reports loaded day/grid status, sensor count, errors and units.
The record budget remains 1,600 estimated tokens, expanded to 2,000 for activity
advice; complete selected fields/records can still be omitted for size.

Temporal/pronominal follow-ups inherit the most recent recognized **user** topic
within six recent turns, never topics introduced only by assistant claims.
Explicit new topics replace previous ones. Unknown questions without usable
context receive availability metadata plus needsClarification=true, not all data.
The model is instructed to ask which data the user means. A requested date does
not imply that date's records were loaded: routing does not fetch new dates,
query the backend archive or create a forecast. Topic matching uses bounded local
English/German keyword rules, not an extra inference request; unsupported wording
can require clarification and real-model compliance is still unverified.

Validation covers weather/air field projection, null/zero, original units and
provenance, station freshness, explicit model/measurement comparisons, mixed
families, full-day exercise advice, user-only history inheritance and clarification.
Local stored-data GET probes at 2026-10-29T11:27:07Z again returned HTTP 200 JSON
on the existing day/grid/sensor routes. Selected prompt estimates: weather 2,460,
station air 2,617, device query with no loaded device 1,201. These are local
heuristic size estimates, not measured model latency. Ignored probe reports remain
in data/runtime/ai-latency-20261029/. No upstream API or serving contract changed.

Final checks: web lint, all 20 tests, TypeScript and production build passed;
root `just lint` passed. Local web container rebuilt and healthy. HTTP 200 and
served-bundle checks verified topic routing, explicit forecast selection, selected/
omitted channel labels and disabled thinking. Real model interpretation and
real-device latency remain unverified.
