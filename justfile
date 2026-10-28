default:
    @just --list

# Install the backend's locked dependencies.
setup:
    uv sync --locked --directory services/backend

# Start the local API with reload enabled.
dev:
    uv run --locked --directory services/backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Run backend and agent-tool tests.
test:
    uv run --locked --directory services/backend pytest
    python3 -m unittest discover -s agents/tests -v

# Check backend style and local research integrity.
lint:
    uv run --locked --directory services/backend ruff check .
    uv run --locked --directory services/backend ruff format --check .
    python3 agents/context.py check

# Format backend Python files.
format:
    uv run --locked --directory services/backend ruff format .
