"""Production admin e2e: local API probes, browser persistence and labelled exports."""

import argparse
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from browser_fixture import local_browser
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin-base-url", required=True)
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    endpoints = [
        {
            "id": identifier,
            "name": name,
            "path": path.split("?")[0],
            "url": "{base}" + path,
            "category": "backend",
            "origin": "backend",
            "note": "Local system e2e fixture",
            "redirect": {"mode": "off", "target": ""},
        }
        for identifier, name, path in [
            ("health", "Backend health", "/health"),
            ("day", "Day forecast", "/api/v1/day?date=2026-10-29"),
            ("grid", "Place grid", "/api/v1/grid?date=2026-10-29"),
            ("sensors", "Sensors", "/api/v1/sensors"),
        ]
    ]
    persisted = {
        "settings": {
            "backendUrl": args.api_base_url,
            "intervalSec": 0,
            "timeoutMs": 10000,
            "degradedMs": 9000,
            "defaultRange": 14,
        },
        "endpoints": endpoints,
        "probes": {},
    }
    checks, errors, responses = [], [], []
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=str(chrome) if chrome.exists() else None, headless=True
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000}, timezone_id="UTC", service_workers="block"
        )
        blocked = local_browser(context)
        context.add_init_script(
            "if (!localStorage.getItem('ecomab-admin:v1')) localStorage.setItem('ecomab-admin:v1', "
            + json.dumps(json.dumps(persisted))
            + ");"
        )
        page = context.new_page()
        page.clock.set_fixed_time(datetime(2026, 10, 29, 12, tzinfo=UTC))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: responses.append({"url": r.url, "status": r.status}))

        def probe_status(name, code):
            page.wait_for_function(
                """({name,code}) => {
                const s=JSON.parse(localStorage.getItem('ecomab-admin:v1'));
                const ep=s.endpoints.find(e=>e.name===name);
                return ep && s.probes[ep.id]?.at(-1)?.status===code;
            }""",
                arg={"name": name, "code": code},
            )

        try:
            page.goto(args.admin_base_url, wait_until="domcontentloaded")
            page.get_by_role("heading", name="Admin overview", exact=True).wait_for()
            page.wait_for_function("""() => {
                const s=JSON.parse(localStorage.getItem('ecomab-admin:v1'));
                return s.endpoints.every(e=>s.probes[e.id]?.at(-1)?.ok===true);
            }""")
            assert all(
                any(
                    r["url"].startswith(args.api_base_url + ep["path"]) and r["status"] == 200
                    for r in responses
                )
                for ep in endpoints
            )
            page.get_by_text("Demo data", exact=True).wait_for()
            checks.append(
                "Overview probes the real local backend through browser CORS; "
                "demo telemetry is labelled"
            )
            page.screenshot(path=str(args.output / "overview.png"))
            page.get_by_role("link", name="Endpoints", exact=True).click()
            page.get_by_role("heading", name="Endpoints", exact=True).wait_for()
            page.get_by_role("button", name="Add endpoint", exact=True).click()
            dialog = page.get_by_role("dialog")
            dialog.get_by_label("Name", exact=True).fill("E2E probe")
            dialog.get_by_label("URL", exact=True).fill(args.api_base_url + "/v1/days/2040-01-01")
            dialog.get_by_role("button", name="Add endpoint", exact=True).click()
            page.get_by_label("Search endpoints", exact=True).fill("E2E probe")
            page.get_by_role("button", name="Run all checks", exact=True).click()
            probe_status("E2E probe", 404)
            page.get_by_role("button", name="Edit E2E probe", exact=True).click()
            dialog.get_by_label("URL", exact=True).fill(args.api_base_url + "/health")
            dialog.get_by_role("button", name="Save changes", exact=True).click()
            page.get_by_role("button", name="Run all checks", exact=True).click()
            probe_status("E2E probe", 200)
            page.reload()
            page.get_by_label("Search endpoints", exact=True).fill("E2E probe")
            page.get_by_role("button", name="Edit E2E probe", exact=True).wait_for()
            checks.append(
                "Endpoint add/edit/search persist after reload; HTTP404 failure recovers to HTTP200"
            )
            page.get_by_role("link", name="Client data", exact=True).click()
            page.get_by_role("heading", name="Client data", exact=True).wait_for()
            page.get_by_text(
                "These numbers are a simulated sample, not measurements.", exact=True
            ).wait_for()
            page.get_by_role("combobox", name=re.compile("Filter by result")).select_option(
                "rejected"
            )
            with page.expect_download() as downloaded:
                page.get_by_role("button", name="Export CSV", exact=True).click()
            csv_path = args.output / "simulated.csv"
            downloaded.value.save_as(csv_path)
            csv_text = csv_path.read_text()
            assert "note" in csv_text.splitlines()[0] and "simulated sample" in csv_text
            checks.append(
                "Client-data filters work; exported CSV explicitly labels simulated samples"
            )
            page.get_by_role("link", name="Settings", exact=True).click()
            page.get_by_role("heading", name="Settings", exact=True).wait_for()
            page.get_by_label("Check every", exact=True).select_option("30")
            page.get_by_role("button", name="Save settings", exact=True).click()
            page.wait_for_function(
                "JSON.parse(localStorage.getItem('ecomab-admin:v1')).settings.intervalSec===30"
            )
            page.get_by_label("Check every", exact=True).select_option("0")
            page.get_by_role("button", name="Save settings", exact=True).click()
            with page.expect_download() as downloaded:
                page.get_by_role("button", name="Export configuration", exact=True).click()
            config_path = args.output / "config.json"
            downloaded.value.save_as(config_path)
            config = json.loads(config_path.read_text())
            assert config["kind"] == "ecomab-admin-config"
            assert config["settings"]["backendUrl"] == args.api_base_url
            assert any(e["name"] == "E2E probe" for e in config["endpoints"])
            page.get_by_label("Choose a configuration file", exact=True).set_input_files(
                {"name": "bad.json", "mimeType": "application/json", "buffer": b"not json"}
            )
            page.get_by_text("This file is not valid JSON.", exact=True).wait_for()
            page.get_by_label("Choose a configuration file", exact=True).set_input_files(
                config_path
            )
            page.reload()
            assert (
                page.get_by_label("greenAir backend URL", exact=True).input_value()
                == args.api_base_url
            )
            checks.append(
                "Settings persist; configuration export/import works and invalid JSON is rejected"
            )
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("link", name="Endpoints", exact=True).click()
            page.get_by_label("Search endpoints", exact=True).fill("E2E probe")
            page.get_by_role("button", name="Edit E2E probe", exact=True).wait_for()
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
            page.screenshot(path=str(args.output / "mobile-endpoints.png"))
            checks.append("Mobile navigation and persisted endpoint cards fit the viewport")
            assert not errors, errors
            assert not blocked, blocked
            assert not [
                r
                for r in responses
                if r["url"].startswith(args.api_base_url) and r["status"] >= 500
            ]
        except Exception:
            page.screenshot(path=str(args.output / "failure.png"))
            print(page.locator("body").inner_text()[:5000], flush=True)
            raise
        finally:
            (args.output / "browser-results.json").write_text(
                json.dumps(
                    {
                        "checks": checks,
                        "page_errors": errors,
                        "blocked_external_requests": blocked,
                        "api_responses": [
                            r for r in responses if r["url"].startswith(args.api_base_url)
                        ],
                    },
                    indent=2,
                )
                + "\n"
            )
            browser.close()
        print(json.dumps({"admin_browser_checks": checks}), flush=True)


if __name__ == "__main__":
    main()
