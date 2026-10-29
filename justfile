actionlint_version := "1.7.12"

default:
    @just --list

# Install locked development dependencies and activate Git hooks.
setup:
    npm ci
    uv sync --locked --directory services/backend
    bash scripts/setup-actionlint.sh {{actionlint_version}}

# Start the local API with reload enabled.
dev:
    uv run --locked --directory services/backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Run backend, agent-tool, and commit-convention tests.
test:
    uv run --locked --directory services/backend pytest
    python3 -m unittest discover -s agents/tests -v
    npm run test:commits

# Check backend style, research integrity, workflows, tooling syntax, and whitespace.
lint: lint-workflows
    uv run --locked --directory services/backend ruff check .
    uv run --locked --directory services/backend ruff format --check .
    python3 agents/context.py check
    node --check commitlint.config.cjs
    node --check scripts/ci-range.mjs
    node --check scripts/check-whitespace.mjs
    node --check scripts/tests/ci-range.test.mjs
    node --check scripts/tests/commitlint.test.mjs
    bash -n scripts/setup-actionlint.sh
    git diff --check
    git diff --cached --check

# Check GitHub Actions workflows with the pinned linter installed by setup.
lint-workflows:
    .tools/actionlint/{{actionlint_version}}/actionlint -shellcheck= -pyflakes=

# Format backend Python files.
format:
    uv run --locked --directory services/backend ruff format .

# Print the dynamically generated OpenAPI JSON (no tracked snapshot).
openapi:
    uv run --locked --directory services/backend python -c 'import json; from app.main import app; print(json.dumps(app.openapi(), indent=2))'

# Build and start the standalone demo backend; wait for its health check.
backend-up:
    docker compose up --build --detach --wait backend

# Stop only this demo backend (does not remove unrelated ingestion infrastructure).
backend-down:
    docker compose down

# Follow API container logs.
backend-logs:
    docker compose logs --follow backend

# Smoke-test all documented routes through the running container's published port.
backend-smoke:
    python3 scripts/smoke-backend.py

# Install the mobile frontend's locked dependencies.
setup-web:
    npm ci --prefix apps/web

# Install the admin frontend's locked dependencies.
setup-admin:
    npm ci --prefix apps/admin

# Start the mobile frontend (set NEXT_PUBLIC_API_URL to use the backend).
dev-web:
    npm run dev --prefix apps/web

# Start the separate admin frontend on port 3200.
dev-admin:
    npm run dev --prefix apps/admin

# Lint, type-check, and build the mobile frontend.
check-web:
    npm run lint --prefix apps/web
    npm run build --prefix apps/web

# Lint, test, type-check, and build the admin frontend.
check-admin:
    npm run lint --prefix apps/admin
    npm test --prefix apps/admin
    npm run build --prefix apps/admin

# Apply ingestion migrations to an explicitly selected PostgreSQL database.
migrate:
    uv run --locked --directory services/backend alembic upgrade head

# Test storage against an isolated disposable PostgreSQL/PostGIS/TimescaleDB.
test-storage:
    python3 scripts/test-storage.py

# One bounded real-source pass; select a migrated database explicitly via env.
ingest-once *args:
    uv run --locked --directory services/backend python -m app.ingestion.worker --once {{args}}

# Persist day/sensor results from stored inputs; no upstream requests.
process-results *args:
    uv run --locked --directory services/backend python -m app.processing.refresh {{args}}

# Run one ingestion pass and build snapshots even when upstream coverage is partial.
refresh-once *args:
    uv run --locked --directory services/backend python -m app.ingestion.refresh {{args}}
