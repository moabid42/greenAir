# Backend development

Read the root [AGENTS.md](../../AGENTS.md) and
[architecture mapping](../../docs/architecture.md). This service uses Python
3.12+, FastAPI, Pydantic 2, and uv. The `app` package is imported from this service
directory; use absolute `app.*` imports.

- Keep routes in `app/api/routes`, validated contracts in `app/schemas`, and
  processing/domain logic in its corresponding module. Register routes through
  `app/api/router.py`.
- `create_app` must start without a database, broker, network fetch, or scheduler.
  Add resource lifecycles explicitly when those resources are implemented.
  Polling/long-running workers must have their own entrypoint rather than being
  started by API imports or development reloads.
- Module placeholders mark planned ownership. Implement a thin, validated data
  slice before adding cross-service frameworks or scoring APIs.
- Add dependencies in `pyproject.toml` and refresh `uv.lock` deliberately. Local
  settings use `services/backend/.env` and `GREENAIR_` environment variables.
- Follow the root data workflow before implementing a source adapter. Architecture
  proposals are not new endpoint verification evidence.

From the repository root, validate changes with `just lint` and `just test`.
For backend-only iteration:

```sh
uv run --locked --directory services/backend ruff check .
uv run --locked --directory services/backend ruff format --check .
uv run --locked --directory services/backend pytest
```
