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
