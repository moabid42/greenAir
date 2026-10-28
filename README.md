# greenAir

Green City Heilbronn hackathon: environmental context and street-level activity
scoring, starting with a Python/FastAPI backend scaffold.

## Development

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/getting-started/installation/),
`just`, and Node.js 22+ with npm for Git hooks and commit checks.

```sh
just setup
just dev
```

API: `http://127.0.0.1:8000/health`. Interactive docs:
`http://127.0.0.1:8000/docs`. Run `just test` and `just lint` for local checks.
Run `just` to list the available recipes.
Configuration and service details are in [services/backend](services/backend/README.md).
`just setup` also activates Husky: lint before commits, commit-message validation,
and tests before pushes. Use `verb(scope): short message`, with a required scope,
one line, and a 72-character limit. For example: `feat(backend): add health endpoint`.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the convention and CI details.

```text
services/backend/   FastAPI app, domain module boundaries, tests, dependency lock
apps/web/           Reserved MapLibre client
infrastructure/     Planned database, event bus, cache, tile-server configuration
docs/               Architecture and source research
agents/             Focused research lookup and development context
data/               Source endpoint catalog
```

See [the architecture mapping](docs/architecture.md) for implemented versus
reserved components, based on [the research](docs/research.md).

## Research and agent workflow

Start development with [AGENTS.md](AGENTS.md). The [agent context tools](agents/README.md)
provide focused endpoint searches, reference excerpts, and a workflow for carrying
verified data contracts and decisions through development.

```sh
python3 agents/context.py overview
python3 agents/context.py find roughness
python3 agents/context.py section 3.2 3.3
```

The original [data reference](docs/GREENCITY_HEILBRONN_COMPLETE_DATA_REFERENCE_2026-10-28.md)
and [endpoint catalog](data/GREENCITY_HEILBRONN_ENDPOINT_CATALOG_2026-10-28.csv)
are research snapshots dated 2026-10-28; check current responses before relying
on a source in an integration.
