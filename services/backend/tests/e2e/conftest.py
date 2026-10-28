"""End-to-end tests: raw records on disk -> public processing entry point -> final output.

No mocks. Fixture files carry a `_provenance` note; captured values are historical
and synthetic values are labelled as synthetic.
"""

import json
from pathlib import Path

import pytest

from app.schemas.observations import RawObservation

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def bus_round_trip(records: list[RawObservation]) -> list[RawObservation]:
    """Serialize as JSON lines, as on the `observations.raw` bus subject, and decode again."""
    lines = [record.model_dump_json() for record in records]
    return [RawObservation.model_validate_json(line) for line in lines]


@pytest.fixture
def load_raw():
    def load(name: str) -> list[RawObservation]:
        document = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        assert document["_provenance"]
        return [RawObservation.model_validate(record) for record in document["records"]]

    return load
