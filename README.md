# greenAir

Green City Heilbronn hackathon: environmental context and street-level activity
scoring with Python/FastAPI, a Next.js mobile client and a separate
Next.js admin frontend. The local stack uses persisted real provider data.

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

## Run everything with Docker

With Docker running, start storage, migrations, automatic provider refresh, API, web and admin:

```sh
just up
```

- Web: <http://localhost:3000>
- Admin: <http://localhost:3200>
- API / Swagger: <http://localhost:8000/docs>

The command builds production images and starts a dedicated PostgreSQL17 database
with PostGIS/TimescaleDB, applies migrations, and starts the refresh worker and both
clients. Docker and `just` are enough. Initial builds download dependencies/fonts.
The API serves **stored real data**; station status uses live openSenseMap. Initial
weather/sensor results arrive after the first bounded refresh; the road capture
resumes in small pages over several cycles. Until then the UI shows unavailable
coverage. No fixtures or synthetic fallback are loaded.

The worker checks due weather/modelled air, stationary openSenseMap, Bright Sky and
UBA jobs, processes today/tomorrow and sensors, and bootstraps the four verified
Heilbronn road layers. It resumes checkpoints after restarts and checks for a new
static capture weekly (an application policy, not a survey cadence). Failed or
partial sources retain last-success results and visible gaps. Sources, UTC times,
counts and latest processing attempts are available in Admin → Source data and
`/api/v1/data-status`. See [runtime details](docs/integrations/real-data-runtime.md).

Stop and remove this application's containers and Compose network:

```sh
just down
```

This does not delete volumes, images or containers from other Compose projects,
including the existing ingestion PostgreSQL/Redis services. The Compose project
remains `greenair-demo`. Use `docker compose logs --follow` for all application logs.
`just backend-up` starts the API and its storage/migration dependencies;
`backend-down` stops only the API; `just down` tears down
the full application stack.

Ports can be changed with `GREENAIR_PORT`, `GREENAIR_WEB_PORT` and
`GREENAIR_ADMIN_PORT`. If the API address changes, set `GREENAIR_PUBLIC_API_URL`
to its **browser-accessible** URL before rebuilding. For example:

```sh
GREENAIR_PORT=8010 GREENAIR_WEB_PORT=3010 GREENAIR_ADMIN_PORT=3210 \
  GREENAIR_PUBLIC_API_URL=http://localhost:8010 just up
just down
```

The frontends embed that address during their builds. A browser cannot resolve
Compose's internal `backend` hostname. CORS defaults follow the frontend port
variables; set `GREENAIR_CORS_ORIGINS` for other browser origins. Containers bind
to loopback by default (`GREENAIR_BIND_HOST`). Keep
`NEXT_PUBLIC_ECOMAB_API_BASE_URL` empty while vector tiles remain deferred.

Both Next.js images use [standalone output](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output),
locked npm installs, Node 24, nonroot runtime users and read-only filesystems with
temporary caches. [Docker's Next.js guide](https://docs.docker.com/guides/nextjs)
describes this deployment pattern. Secrets and host build artifacts are excluded
from their Docker contexts.

For source editing with hot reload, the existing host recipes remain available:
`just setup-web` / `setup-admin`, then run `just dev-web` or `just dev-admin`
with `NEXT_PUBLIC_API_URL=http://localhost:8000`. Run `just check-web` and `just check-admin` for checks.
Admin probes are real HTTP requests and pipeline status comes from stored records.
Client upload/request analytics remain unavailable; configuration stays in the browser.
Wearables wait for an actual Bluetooth heart-rate device. Development `just dev`
uses stored/live mode and the Compose database at localhost:55433 (override with
GREENAIR_DATABASE_URL); stop the container API first to free port8000.
Offline synthetic web data and sample wearables require explicit
`NEXT_PUBLIC_DEMO_MODE=true`; Compose does not enable this. Backend defaults also select stored/live; offline test/demo providers require explicit
`GREENAIR_SERVING_DATA_MODE=mock` and `GREENAIR_STATION_DATA_MODE=mock`.

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
