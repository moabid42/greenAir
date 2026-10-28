# Agent context tools

Start with the root [AGENTS.md](../AGENTS.md). It points here explicitly; these
supporting files are loaded when relevant. The standard `AGENTS.md` name follows
[official instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

The lookup tool needs Python 3.9+ and the standard library only. It runs offline,
reads the canonical files on every invocation, and writes no generated index.
Run these commands from the repository root; the script resolves its sources
relative to its own location, so absolute invocation works from other folders.

```sh
# Compact source map, counts, section ranges, and snapshot fingerprints
python3 agents/context.py overview

# Search all CSV fields; all words must match, ignoring case
python3 agents/context.py find roughness
python3 agents/context.py find pm --source bike --limit 3

# List a source's endpoints without guessing keywords
python3 agents/context.py find --source home
python3 agents/context.py find --source open-meteo --json

# Foreign ATRAI city layers are excluded by default; global collections remain
python3 agents/context.py find bumpy_roads --all-cities --limit 10

# Read original text, with line numbers; parent sections include subsections
python3 agents/context.py section 1.3 3.2 3.3
python3 agents/context.py section 18
python3 agents/context.py section appendix-a

# Structural integrity, routing coverage, and full content hashes (no network)
python3 agents/context.py check
python3 -m unittest discover -s agents/tests -v
```

`find` returns at most five rows unless `--limit` is supplied. It reports the
total matches and truncation; exact endpoint names rank first, followed by name
matches and then matches in other fields. `section` has a total output budget of 160 source
lines; increase `--max-lines` deliberately when needed. Search misses exit with
status 1; invalid input or a failed integrity check exits with status 2.
`find --json` preserves all nine CSV fields and adds citations, scope guidance,
matching counts, and reference locations. No tool command makes HTTP requests.

| File | Purpose |
|---|---|
| [WORKFLOW.md](WORKFLOW.md) | Data development steps and source-specific traps |
| [STATE.md](STATE.md) | Decisions, dated evidence, and useful resumption context |
| [templates/integration.md](templates/integration.md) | Contract and evidence template, used when a connector/feature begins |
| [sources.json](sources.json) | Canonical paths and card-to-reference routing; contains no copied endpoint data |
| [context.py](context.py) | Bounded CSV search, Markdown section extraction, integrity checks |

When a new research version is adopted, retain the old snapshot, change the
canonical paths and routes in `sources.json`, update links in `AGENTS.md`, and
run both checks. Review section meanings as well as their identifiers. New CSV
cards require routing entries; missing routes and broken references fail `check`.
Record the switch in `STATE.md`. Exact hashes in `check` identify the input
version used for an integration note; no cached summary needs regeneration.
