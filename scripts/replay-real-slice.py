"""Create an isolated SQLite replay from the small dated real-source test fixture."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="data/runtime/real-slice.sqlite")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if output.exists():
        parser.error("output already exists; select a new replay file")
    output.parent.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(ROOT / "services/backend"))
    sys.path.insert(0, str(ROOT / "services/backend/tests"))
    from real_slice_fixture import replay
    from sqlalchemy import create_engine

    from app.storage import models as db
    from app.storage.repository import Repository

    engine = create_engine(f"sqlite:///{output}")
    try:
        db.metadata.create_all(engine)
        _, snapshot, counts = replay(Repository(engine))
        print(
            json.dumps(
                {
                    "label": "historical fixture replay; not current observations",
                    "output": str(output),
                    "day_build_id": snapshot.build_id,
                    "counts": counts,
                }
            )
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
