# greenAir

Green City Heilbronn hackathon: environmental context and street-level activity
scoring with a Python/FastAPI demo backend, a Next.js mobile client and a separate
Next.js admin frontend. Backend serving data defaults to explicitly labelled mock values.

## Development

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/getting-started/installation/),
`just`, and Node.js 24 with npm for Git hooks and commit checks. Development uses
Python 3.12; [tool versions](docs/development.md) match the CI configuration.

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
apps/web/           Next.js mobile frontend with MapLibre
apps/admin/         Separate Next.js endpoint-monitoring frontend
infrastructure/     Planned database, event bus, cache, tile-server configuration
docs/               Architecture and source research
agents/             Focused research lookup and development context
data/               Source endpoint catalog
```

See [the architecture mapping](docs/architecture.md) for implemented versus
reserved components, based on [the research](docs/research.md).

## Run the integrated demo

```sh
just backend-up
just setup-web
NEXT_PUBLIC_API_URL=http://localhost:8000 just dev-web
```

Open the mobile client at <http://localhost:3000> and Swagger at
<http://localhost:8000/docs>. Keep `NEXT_PUBLIC_ECOMAB_API_BASE_URL` empty while
vector tiles are deferred. Day/grid scores, street geometry and sensor readings
are synthetic and labelled as such. See [the API contract](docs/backend-api.md).

The optional admin app runs separately:

```sh
just setup-admin
NEXT_PUBLIC_API_URL=http://localhost:8000 just dev-admin
```

Open <http://localhost:3200>. Admin endpoint probes are real HTTP checks; its
traffic/client-data charts are simulated and its settings are local to the browser.
Use `just check-web` and `just check-admin` for frontend lint/build checks and admin
tests. CI runs these alongside the backend and container checks. Node.js 24 is pinned
in `.nvmrc`. `just backend-down` stops the demo backend.

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
