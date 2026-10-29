"""One local system e2e run, owning every temporary service and database it uses."""

import argparse
import json
import os
import signal
import socket
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
IMAGE = (
    "timescale/timescaledb-ha:pg17@sha256:"
    "3f0b3f6bdf4912878444a36e6113a18346309583c4d1a61d81a0c511342a1afd"
)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, help="new artifact directory (defaults under ignored runtime)"
    )
    parser.add_argument(
        "--skip-checks", action="store_true", help="debug only: skip lint/unit/migration checks"
    )
    args = parser.parse_args()
    token = uuid4().hex[:12]
    output = (args.output or ROOT / f"data/runtime/e2e-{token}").resolve()
    output.mkdir(parents=True, exist_ok=False)
    pg_name, api_name = f"greenair-e2e-db-{token}", f"greenair-e2e-api-{token}"
    network, tag = f"greenair-e2e-{token}", f"greenair-e2e:{token}"
    api_port, web_port, admin_port = (free_port() for _ in range(3))
    assert len({api_port, web_port, admin_port}) == 3
    api, web, admin = (f"http://127.0.0.1:{p}" for p in (api_port, web_port, admin_port))
    env = os.environ.copy()
    for key in ("GREENAIR_DATABASE_URL", "GREENAIR_TEST_DATABASE_URL"):
        env.pop(key, None)
    env.update(
        NEXT_PUBLIC_API_URL=api, NEXT_PUBLIC_ECOMAB_API_BASE_URL="", NEXT_TELEMETRY_DISABLED="1"
    )
    processes, containers, checks, seed_results = [], set(), [], []
    log_files = []
    resources = {"network": False, "image": False}
    report = {
        "scope": (
            "Historical/selected fixtures over loopback HTTP; Bright Sky synthetic; "
            "empty basemap. No live source validation."
        ),
        "checked_at_utc": datetime.now(UTC).isoformat(),
        "passed": False,
        "checks": checks,
    }

    def run(command, label, *, run_env=env, timeout=300):
        print(f"e2e: {label}", flush=True)
        with (output / "commands.log").open("a") as log:
            log.write(f"\n{label}\n")
            log.flush()
            result = subprocess.run(
                command,
                cwd=ROOT,
                env=run_env,
                text=True,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=timeout,
            )
        if result.returncode:
            print((output / "commands.log").read_text()[-10000:], flush=True)
            raise RuntimeError(
                f"{label} failed ({result.returncode}); see {output / 'commands.log'}"
            )
        return result

    def json_get(path, expected=200):
        try:
            response = urlopen(api + path, timeout=15)
        except HTTPError as exc:
            response = exc
        with response:
            body = json.load(response)
            assert response.status == expected, (path, response.status, body)
            return body

    def ready(url):
        deadline = time.monotonic() + 90
        while True:
            try:
                with urlopen(url, timeout=2) as response:
                    if response.status == 200:
                        return
            except (URLError, TimeoutError, OSError):
                pass
            if time.monotonic() > deadline:
                raise RuntimeError(f"Service did not become ready: {url}")
            time.sleep(0.2)

    def pg_ready():
        deadline = time.monotonic() + 90
        while subprocess.run(
            ["docker", "exec", pg_name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("Temporary e2e PostgreSQL did not become ready")
            time.sleep(0.2)

    def start_api(mode):
        if api_name in containers:
            run(["docker", "rm", "--force", api_name], "replace owned API container")
            containers.remove(api_name)
        command = [
            "docker",
            "run",
            "--detach",
            "--name",
            api_name,
            "--network",
            network,
            "--publish",
            f"127.0.0.1:{api_port}:8000",
            "--read-only",
            "--tmpfs",
            "/tmp",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--env",
            f"GREENAIR_SERVING_DATA_MODE={mode}",
            "--env",
            "GREENAIR_STATION_DATA_MODE=mock",
            "--env",
            f"GREENAIR_CORS_ORIGINS={json.dumps([web, admin, 'http://localhost:3000'])}",
        ]
        if mode == "stored":
            command += [
                "--env",
                "GREENAIR_DATABASE_URL=postgresql+psycopg://postgres:e2e-only@db:5432/greenair_e2e",
            ]
        containers.add(api_name)
        run(command + [tag], f"start {mode} API")
        ready(api + "/health")

    def start_frontend(app, port):
        handle = (output / f"{app}.log").open("a")
        log_files.append(handle)
        child = subprocess.Popen(
            [
                "node",
                "node_modules/next/dist/bin/next",
                "start",
                "--hostname",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=ROOT / f"apps/{app}",
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        processes.append(child)
        ready(web if app == "web" else admin)

    def seed(phase):
        label = f"HTTP fixture worker and processing CLI: {phase}"
        run(
            [
                "uv",
                "run",
                "--locked",
                "--directory",
                "services/backend",
                "python",
                "tests/system_fixture.py",
                phase,
            ],
            label,
            run_env=seed_env,
        )
        # Last line is the fixture's bounded summary, without raw response bodies.
        lines = (output / "commands.log").read_text().splitlines()
        summary = json.loads(next(line for line in reversed(lines) if line.startswith('{"phase"')))
        seed_results.append(summary)
        checks.append(label)

    def browser(spatial=False):
        command = [
            "just",
            "smoke-real-browser",
            "--offline-map",
            "--web-base-url",
            web,
            "--api-base-url",
            api,
            "--output",
            str(output / ("web-spatial" if spatial else "web-conditions")),
        ]
        if spatial:
            command += ["--spatial", "--fixture-home"]
        run(command, "web browser: " + ("spatial" if spatial else "conditions"))
        checks.append(
            "Production web browser "
            + ("with spatial inputs" if spatial else "without spatial inputs")
        )

    def verify_api(spatial):
        day = json_get("/api/v1/day?date=2026-10-29")
        assert day["source"] == "forecast" and len(day["hours"]) == 24
        assert day["hours"][12]["provenance"]["pm25"]["kind"] == "model"
        sensors = json_get("/api/v1/sensors")
        assert {s["kind"] for s in sensors} == {"sensebox_home", "lubw"}
        assert all(s["source"] == "measured" for s in sensors)
        grid = json_get("/api/v1/grid?date=2026-10-29")
        if spatial:
            assert grid["coverage"] == {
                "roads": 2,
                "roughness": 1,
                "overtaking_share": 1,
                "flow": 1,
                "pm_spatial": 0,
            }
            assert len(grid["cells"]["features"]) == 2
            for feature in grid["cells"]["features"]:
                p = feature["properties"]
                assert p["air"] == [h["factors"]["air"] for h in day["hours"]]
                assert p["confidence"] == 0 and p["recommendable"] is False and p["green"] is None
            segments = json_get("/v1/segments")["features"]
            ids = {str(s["properties"]["segment_id"]) for s in segments}
            point = segments[0]["geometry"]["coordinates"][0]
            for profile in ("running", "cycling", "walking"):
                scores = json_get(f"/scores?profile={profile}&t=2026-10-29T12:00:00Z")
                assert set(scores["scores"]) == ids and all(
                    v[1] == 0 for v in scores["scores"].values()
                )
                detail = json_get(
                    f"/score?lat={point[1]}&lon={point[0]}&profile={profile}&t=2026-10-29T12:00:00Z"
                )
                assert detail["pm_source"] == "none" and detail["confidence"] == 0
                assert (
                    json_get(
                        f"/v1/segments/{detail['segment_id']}/bestTimes/2026-10-29?profile={profile}"
                    )["windows"]
                    == []
                )
        else:
            assert grid["source"] == "unavailable" and grid["cells"]["features"] == []
        assert json_get("/v1/days/2040-01-01", 404)["error"]["code"] == 404
        assert json_get("/openapi.json")["openapi"].startswith("3.")
        return day, grid, sensors

    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        assert subprocess.check_output(["node", "--version"], text=True).startswith("v24."), (
            "use Node24 from .nvmrc"
        )
        if not args.skip_checks:
            for task in ("lint", "test", "test-storage"):
                run(["just", task], task)
                checks.append(task)
        run(["docker", "network", "create", network], "create isolated e2e network")
        resources["network"] = True
        containers.add(pg_name)
        run(
            [
                "docker",
                "run",
                "--detach",
                "--name",
                pg_name,
                "--network",
                network,
                "--network-alias",
                "db",
                "--publish",
                "127.0.0.1::5432",
                "--env",
                "POSTGRES_PASSWORD=e2e-only",
                "--env",
                "POSTGRES_DB=greenair_e2e",
                IMAGE,
            ],
            "start disposable e2e PostgreSQL",
        )
        pg_ready()
        bindings = json.loads(
            subprocess.check_output(
                ["docker", "inspect", pg_name, "--format", "{{json .NetworkSettings.Ports}}"],
                text=True,
            )
        )
        pg_port = bindings["5432/tcp"][0]["HostPort"]
        seed_env = env | {
            "PYTHONPATH": str(ROOT / "services/backend"),
            "GREENAIR_DATABASE_URL": f"postgresql+psycopg://postgres:e2e-only@127.0.0.1:{pg_port}/greenair_e2e",
        }
        run(["just", "migrate"], "migrate isolated production database", run_env=seed_env)
        run(["docker", "build", "--tag", tag, "services/backend"], "build isolated API image")
        resources["image"] = True
        start_api("mock")
        run(
            ["just", "backend-smoke"],
            "all documented mock API routes",
            run_env=env | {"GREENAIR_SMOKE_URL": api},
        )
        checks.append("Containerized mock mode and all documented GET routes")
        start_api("stored")
        assert json_get("/v1/days/2026-10-29", 404)["error"]["code"] == 404
        seed("conditions")
        verify_api(False)
        for app in ("web", "admin"):
            run(["just", f"check-{app}"], f"{app}: lint, unit tests and production build")
            checks.append(f"check-{app}")
        start_frontend("web", web_port)
        start_frontend("admin", admin_port)
        browser()
        seed("spatial")
        original = verify_api(True)
        browser(True)
        run(
            [
                "uv",
                "run",
                "--no-project",
                "--with",
                "playwright==1.61.0",
                "python",
                "scripts/smoke-admin-browser.py",
                "--admin-base-url",
                admin,
                "--api-base-url",
                api,
                "--output",
                str(output / "admin"),
            ],
            "production admin browser",
        )
        checks.append(
            "Admin overview, endpoint failure/recovery, persistence, filters, "
            "configuration and CSV exports, mobile layout"
        )
        seed("failure")
        status = json_get("/v1/status")
        assert (
            next(s for s in status["sources"] if s["id"] == "openmeteo_fcst")["status"]
            == "UNREACHABLE"
        )
        run(["docker", "restart", api_name], "restart stored API")
        ready(api + "/health")
        assert verify_api(True) == original
        checks.append(
            "Failed source retains checkpoints/snapshots; real HTTP results survive API restart"
        )
        run(["docker", "stop", "--time", "5", pg_name], "simulate disposable database outage")
        assert json_get("/health")["status"] == "ok"
        assert json_get("/v1/days/2026-10-29", 503)["error"]["code"] == 503
        run(["docker", "start", pg_name], "recover disposable database")
        pg_ready()
        assert verify_api(True) == original
        checks.append(
            "Database outage gives typed503 with healthy process; reconnection preserves results"
        )
        report["passed"] = True
    finally:
        for child in reversed(processes):
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    continue
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=10)
        for handle in log_files:
            handle.close()
        cleanup_errors = []
        for name in (api_name, pg_name):
            if (
                name in containers
                and subprocess.run(
                    ["docker", "inspect", name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ).returncode
                == 0
            ):
                with (output / f"{name}.log").open("w") as log:
                    subprocess.run(["docker", "logs", name], stdout=log, stderr=subprocess.STDOUT)
                if subprocess.run(
                    ["docker", "rm", "--force", "--volumes", name], stdout=subprocess.DEVNULL
                ).returncode:
                    cleanup_errors.append(name)
        for enabled, command, name in (
            (resources["network"], ["docker", "network", "rm", network], network),
            (resources["image"], ["docker", "image", "rm", tag], tag),
        ):
            if enabled and subprocess.run(command, stdout=subprocess.DEVNULL).returncode:
                cleanup_errors.append(name)
        signal.signal(signal.SIGTERM, previous)
        report.update(
            seed_results=seed_results,
            artifacts=str(output),
            owned_resources_cleaned=not cleanup_errors,
            cleanup_errors=cleanup_errors,
        )
        if cleanup_errors:
            report["passed"] = False
        (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
