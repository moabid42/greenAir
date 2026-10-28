# <Source or feature> data contract

## Purpose and selection

- Feature / required geography, period, variables, units, resolution, acceptable age:
- Source type (observation / derived layer / model / archive / catalog / metadata):
- Catalog file, exact URL, and row citation:
- Reference file and section(s); snapshot date / hashes if needed:
- Original research verification wording:
- Selection decision and alternatives only if relevant:

## Checked contract

- Method, URL, parameters, request timeout, required access (no secrets):
- Current provider documentation consulted:
- UTC probe time and environment; HTTP status / content type / outcome:
- Evidence location (small fixture or manifest; distinguish synthetic samples):
- Record meaning; response envelope; fields actually observed; optional/null fields:
- Units, geometry/coordinate order, event/upload/model timestamps and timezone:
- Geographic filter, stable IDs, join keys, pagination and deduplication:
- Freshness observed; retained period/completeness still unknown:
- License / attribution and source metadata:

Use `unknown` or `not checked` where appropriate. A template is not evidence.

## Implementation and validation

- Adapter / consumer / fixture paths:
- Normalization and missing-value policy:
- Timeout, bounded retry, cache/TTL and partial-failure behavior:
- Export manifest / checkpoint location, if applicable (reference §20.3):
- Checks actually run and results; live checks separate from offline tests:
- Remaining assumptions / next action:

## Dated updates

Append material new evidence or changes in the contract; preserve the date and
meaning of earlier checks. Summarize the reusable result in `agents/STATE.md`.
