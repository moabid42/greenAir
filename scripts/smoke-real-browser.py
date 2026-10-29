"""Browser smoke for the dated stored-source replay, with no provider requests.

Run with an isolated API/web preview built against that API. See the integration note.
"""

import argparse
import json
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-base-url", default="http://localhost:3010")
    parser.add_argument("--api-base-url", default="http://localhost:8010")
    parser.add_argument("--date", type=date.fromisoformat, default=date(2026, 10, 29))
    parser.add_argument("--output", type=Path, default=Path("data/runtime/real-browser-smoke"))
    parser.add_argument("--spatial", action="store_true", help="expect verified stored street inputs")
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    next_date = (args.date + timedelta(days=1)).strftime("%a %d %b").replace(" 0", " ")
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=str(chrome) if chrome.exists() else None,
            headless=True,
            args=["--enable-unsafe-swiftshader"],
        )
        context = browser.new_context(
            viewport={"width": 430, "height": 932}, timezone_id="UTC", service_workers="block"
        )
        page = context.new_page()
        page.clock.set_fixed_time(
            datetime.combine(args.date - timedelta(days=1), datetime.min.time(), UTC).replace(
                hour=23, minute=30
            )
        )
        errors = []
        responses = []
        requests = []
        checks = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: responses.append({"url": r.url, "status": r.status}))
        page.on("request", lambda r: requests.append(r.url))
        try:
            page.goto(args.web_base_url, wait_until="domcontentloaded", timeout=60000)
            page.get_by_role("button", name="Skip", exact=True).click(timeout=45000)
            page.locator("summary").filter(has_text="Modelled city conditions").wait_for(
                timeout=45000
            )
            assert any(f"date={args.date}" in r["url"] and r["status"] == 200 for r in responses)
            page.locator("summary").filter(has_text="Modelled city conditions").click()
            if args.spatial:
                page.get_by_text(re.compile("Street attributes: historical rider-derived data")).wait_for()
                page.get_by_text(re.compile("Flow is a speed proxy, not current traffic")).wait_for()
                checks.append("Historical street capture, unknown survey age and model air are explicit")
            else:
                page.get_by_text(
                    "Street grid and place rankings unavailable; no street-level pollution differences are inferred.",
                    exact=True,
                ).wait_for()
            page.get_by_text("No data", exact=True).first.wait_for()
            checks.append("UTC browser chooses Berlin date; model provenance and traffic gap are visible")
            page.locator(".maplibregl-marker").first.wait_for(timeout=45000)
            page.screenshot(path=str(root / "today.png"))
            markers = page.get_by_role("button", name=re.compile("tap for details"))
            markers.first.wait_for(timeout=45000)
            print("markers", markers.count(), flush=True)
            if markers.count():
                page.locator("summary").filter(has_text="Modelled city conditions").click()
                page.wait_for_timeout(1500)
                visible = [
                    m
                    for m in markers.all()
                    if m.evaluate(
                        "(el) => { const r=el.getBoundingClientRect(); return r.x>15 && r.x<340 && r.y>160 && r.y<480 && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el; }"
                    )
                ]
                assert visible, "No unobstructed sensor marker in viewport"
                (visible[0] if visible else markers.first).click(timeout=15000)
                page.get_by_role("dialog").wait_for()
                checks.append("Real station marker opens per-channel sensor details")
                page.screenshot(path=str(root / "sensor.png"))
                page.get_by_role("dialog").get_by_role(
                    "button", name="Close", exact=True
                ).last.click()
            page.get_by_role("radio", name="Ride", exact=True).click()
            if args.spatial:
                surface = page.get_by_role("radio", name="Road surface", exact=True)
                assert surface.is_enabled()
                surface.click()
                page.get_by_role("heading", name="Rider-derived street data").wait_for()
                page.screenshot(path=str(root / "ride-surface.png"))
                page.locator(".maplibregl-canvas").click(position={"x":250, "y":300})
                page.get_by_text("Partial street coverage", exact=True).wait_for()
                page.get_by_text(re.compile("Survey age unknown · spatial confidence 0%")).wait_for()
                page.screenshot(path=str(root / "street-cell.png"))
                page.get_by_role("button", name="Back", exact=True).click()
                checks.append("Stored surface/close-pass lenses and tapped road-cell details expose zero confidence")
            else:
                assert page.get_by_role("button", name="Road surface", exact=True).is_disabled()
            page.get_by_role("radio", name="Walk", exact=True).click()
            page.get_by_role("radio", name="Run", exact=True).click()
            checks.append("All sports work without direct environmental provider requests")
            page.get_by_role("navigation", name="Main").get_by_role(
                "button", name="Explore", exact=True
            ).click()
            page.get_by_text(
                "Place rankings require verified spatial confidence. Historical street attributes remain inspectable on the map."
                if args.spatial else
                "Verified street rankings are unavailable. The chart shows city-wide conditions.",
                exact=True,
            ).wait_for()
            page.get_by_role("button", name="Play through the day", exact=True).click()
            page.wait_for_timeout(900)
            page.get_by_role("button", name="Pause", exact=True).click()
            page.screenshot(path=str(root / "explore.png"))
            checks.append("Explore plays available city conditions without place rankings")
            page.get_by_role("navigation", name="Main").get_by_role(
                "button", name="Analytics", exact=True
            ).click()
            page.get_by_text("modelled conditions", exact=True).wait_for()
            page.get_by_role("radio", name="7 days", exact=True).click()
            page.wait_for_timeout(1500)
            page.screenshot(path=str(root / "analytics.png"))
            checks.append("Analytics handles available dates and missing forecast dates")
            page.get_by_role("navigation", name="Main").get_by_role(
                "button", name="Coach", exact=True
            ).click()
            page.get_by_text("Answers from modelled city data", exact=True).wait_for()
            page.get_by_label("Message Coach").fill("Which park should I choose?")
            page.get_by_role("button", name="Send", exact=True).click()
            page.get_by_text(re.compile(
                "spatial confidence is insufficient" if args.spatial
                else "Verified street layers are not connected"
            )).wait_for(timeout=30000)
            checks.append("Coach declines street/park ranking without spatial coverage")
            page.screenshot(path=str(root / "coach.png"))
            page.get_by_role("navigation", name="Main").get_by_role(
                "button", name="Today", exact=True
            ).click()
            page.get_by_role("button", name=re.compile("BEST WINDOW")).click()
            page.get_by_role("dialog").get_by_role("button", name=re.compile(next_date)).click()
            page.get_by_text("No recommendation available", exact=True).wait_for()
            page.screenshot(path=str(root / "partial-day.png"))
            page.get_by_role("button", name="Next day", exact=True).click()
            page.get_by_role("button", name="Choose an available date", exact=True).wait_for()
            page.get_by_text(
                "No stored data covers this resource. Refresh inputs or select an available date.",
                exact=True,
            ).wait_for()
            page.screenshot(path=str(root / "no-data.png"))
            checks.append(
                "Partial day and out-of-horizon date show explicit gaps/errors with date recovery, without dummy fallback"
            )
            assert not [
                r
                for r in responses
                if r["url"].startswith(args.api_base_url) and r["status"] >= 500
            ], "Unexpected API server error"
            assert not errors, errors
            assert not [u for u in requests if "open-meteo.com" in u or "api.atrai.bike" in u]
            assert not re.search(r"\bNaN\b|\bInfinity\b", page.locator("body").inner_text())
        except Exception:
            print(page.locator("body").inner_text()[:6000])
            page.screenshot(path=str(root / "failure.png"))
            raise
        finally:
            (root / "browser-results.json").write_text(
                json.dumps(
                    {
                        "checked_at_utc": datetime.now(UTC).isoformat(),
                        "scope": "dated captured replay; not current observations",
                        "selected_date": args.date.isoformat(),
                        "checks": checks,
                        "page_errors": errors,
                        "api_responses": [
                            r for r in responses if r["url"].startswith(args.api_base_url)
                        ],
                        "direct_provider_requests": [
                            u for u in requests if "open-meteo.com" in u or "api.atrai.bike" in u
                        ],
                    },
                    indent=2,
                )
                + "\n"
            )
            print(checks, errors, flush=True)
            browser.close()


if __name__ == "__main__":
    main()
