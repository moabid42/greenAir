"""Write the observation contracts as JSON Schema for adapters in other languages or services.

Run from services/backend: `uv run --locked python -m app.schemas.export_contracts`.
"""

import json
from pathlib import Path

from pydantic import BaseModel

from app.core.config import SERVICE_ROOT
from app.schemas.observations import Observation, RawObservation

CONTRACTS_DIR = SERVICE_ROOT.parents[1] / "docs" / "contracts"
CONTRACTS: dict[str, type[BaseModel]] = {
    "raw-observation.schema.json": RawObservation,
    "observation.schema.json": Observation,
}


def render(model: type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema(), indent=2, ensure_ascii=False) + "\n"


def main(directory: Path = CONTRACTS_DIR) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, model in CONTRACTS.items():
        (directory / name).write_text(render(model), encoding="utf-8")


if __name__ == "__main__":
    main()
