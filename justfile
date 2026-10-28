default:
    @just --list

# Install locked development dependencies and activate Git hooks.
setup:
    npm ci
    uv sync --locked --directory services/backend

# Start the local API with reload enabled.
dev:
    uv run --locked --directory services/backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Run backend, agent-tool, and commit-convention tests.
test:
    uv run --locked --directory services/backend pytest
    python3 -m unittest discover -s agents/tests -v
    npm run test:commits

# Check backend style, research integrity, tooling syntax, and whitespace.
lint:
    uv run --locked --directory services/backend ruff check .
    uv run --locked --directory services/backend ruff format --check .
    python3 agents/context.py check
    node --check commitlint.config.cjs
    node --check scripts/tests/commitlint.test.mjs
    git diff --check
    git diff --cached --check

# Format backend Python files.
format:
    uv run --locked --directory services/backend ruff format .
