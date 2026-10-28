import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ENDPOINTS } from "../src/lib/defaults";
import { toCsv } from "../src/lib/csv";
import { deriveHealth, endpointStats } from "../src/lib/health";
import { probeUrl, resolveUrl } from "../src/lib/probe";
import { simDays } from "../src/lib/sim";
import { breakdown, periods, trend } from "../src/lib/stats";
import { parseConfig } from "../src/lib/storage";
import type { Probe } from "../src/lib/types";
import { pathFromUrl, urlProblem, validateEndpoint, validateRedirect, validateSettings } from "../src/lib/validate";

const ok = (ms: number, at = 0): Probe => ({ at, ok: true, ms, status: 200 });
const bad = (at = 0): Probe => ({ at, ok: false, ms: null, status: null, error: "Unreachable" });
const S = { degradedMs: 1000 };

test("resolveUrl fills placeholders and reports why it cannot", () => {
  const day = new Date(2026, 9, 28);
  const r = resolveUrl({ url: "{base}/api/v1/day?date={today}" }, { backendUrl: "http://localhost:8000" }, day);
  assert.equal(r.url, "http://localhost:8000/api/v1/day?date=2026-10-28");
  const none = resolveUrl({ url: "{base}/health" }, { backendUrl: "" }, day);
  assert.equal(none.url, null);
  assert.match((none as { reason: string }).reason, /Settings/);
  assert.equal(resolveUrl({ url: "" }, { backendUrl: "x" }, day).url, null);
});

test("probeUrl: success, HTTP error, CORS-hidden success, timeout, unreachable", async () => {
  const resp = (status: number) => ({ status, body: { cancel: async () => undefined } }) as unknown as Response;
  const good = await probeUrl("https://x", 500, (async () => resp(200)) as typeof fetch);
  assert.deepEqual([good.ok, good.status, good.opaque], [true, 200, undefined]);

  const http500 = await probeUrl("https://x", 500, (async () => resp(500)) as typeof fetch);
  assert.deepEqual([http500.ok, http500.status, http500.error], [false, 500, "HTTP 500"]);

  const modes: string[] = [];
  const cors = await probeUrl("https://x", 500, (async (_u: string, init: RequestInit) => {
    modes.push(String(init.mode));
    if (init.mode === "cors") throw new TypeError("Failed to fetch");
    return resp(0);
  }) as unknown as typeof fetch);
  assert.deepEqual(modes, ["cors", "no-cors"]);
  assert.deepEqual([cors.ok, cors.opaque, cors.status], [true, true, null]);

  const slow = await probeUrl("https://x", 30, ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch);
  assert.deepEqual([slow.ok, slow.error], [false, "Timed out"]);

  const down = await probeUrl("https://x", 500, (async () => {
    throw new TypeError("net");
  }) as typeof fetch);
  assert.deepEqual([down.ok, down.error], [false, "Unreachable"]);
});

test("deriveHealth rules", () => {
  assert.equal(deriveHealth([], S, false), "unconfigured");
  assert.equal(deriveHealth([], S, true), "checking");
  assert.equal(deriveHealth([ok(300)], S, true), "healthy");
  assert.equal(deriveHealth([ok(1200)], S, true), "degraded");
  assert.equal(deriveHealth([ok(100), bad()], S, true), "offline");
  assert.equal(deriveHealth([ok(100), bad(), ok(100)], S, true), "degraded");
  assert.equal(deriveHealth([bad(), ok(1), ok(1), ok(1), ok(1), ok(1)], S, true), "healthy");
});

test("endpointStats uptime and average latency", () => {
  const p = [ok(100, 10), ok(300, 20), bad(30), ok(200, 40)];
  assert.deepEqual(endpointStats(p), { checks: 4, uptimePct: 75, avgMs: 200, since: 10 });
  assert.equal(endpointStats(p, 25).checks, 2);
  assert.deepEqual(endpointStats([]), { checks: 0, uptimePct: null, avgMs: null, since: null });
});

test("URL validation refuses secrets, credentials and bad schemes", () => {
  assert.equal(urlProblem("https://api.example.org/v1/data?x=1"), null);
  assert.equal(urlProblem("{base}/health"), null);
  assert.match(urlProblem("https://a.org/x?api_key=abc") ?? "", /api_key/);
  assert.match(urlProblem("https://a.org/x?token=abc") ?? "", /token/);
  assert.match(urlProblem("https://user:pw@a.org") ?? "", /username/);
  assert.match(urlProblem("ftp://a.org") ?? "", /http/);
  assert.match(urlProblem("not a url") ?? "", /full URL/);
  assert.match(urlProblem("") ?? "", /Enter/);
  assert.match(urlProblem("{evil}/x") ?? "", /placeholder|full URL/);
  assert.match(urlProblem("http://a.org", { requireHttps: true }) ?? "", /https/);
});

test("validateEndpoint: required fields, duplicates, editing itself", () => {
  const form = { name: "Pollen", path: "/pollen", url: "https://pollen.example/api", category: "air" as const, note: "" };
  assert.deepEqual(validateEndpoint(form, DEFAULT_ENDPOINTS), {});
  assert.ok(validateEndpoint({ ...form, name: "A" }, DEFAULT_ENDPOINTS).name);
  assert.ok(validateEndpoint({ ...form, name: "weather" }, DEFAULT_ENDPOINTS).name, "duplicate name, case-insensitive");
  assert.ok(validateEndpoint({ ...form, url: DEFAULT_ENDPOINTS[4].url }, DEFAULT_ENDPOINTS).url, "duplicate URL");
  assert.ok(validateEndpoint({ ...form, path: "pollen" }, DEFAULT_ENDPOINTS).path);
  const weather = DEFAULT_ENDPOINTS.find((e) => e.name === "Weather")!;
  assert.deepEqual(validateEndpoint({ name: weather.name, path: weather.path, url: weather.url, category: weather.category, note: "" }, DEFAULT_ENDPOINTS, weather.id), {}, "editing without changes is valid");
  assert.equal(pathFromUrl("https://a.org/v1/x/?q=1"), "/v1/x");
});

test("validateRedirect and validateSettings", () => {
  assert.deepEqual(validateRedirect({ mode: "off", target: "" }, "https://a.org"), {});
  assert.ok(validateRedirect({ mode: "on-failure", target: "" }, "https://a.org").target);
  assert.ok(validateRedirect({ mode: "always", target: "https://a.org" }, "https://a.org").target, "same as endpoint");
  assert.ok(validateRedirect({ mode: "always", target: "https://b.org/?token=1" }, "https://a.org").target);
  assert.deepEqual(validateRedirect({ mode: "on-failure", target: "https://b.org/fallback" }, "https://a.org"), {});
  const base = { backendUrl: "", intervalSec: 60 as const, timeoutMs: 8000, degradedMs: 1000, defaultRange: 30 as const };
  assert.deepEqual(validateSettings(base), {});
  assert.ok(validateSettings({ ...base, backendUrl: "nope" }).backendUrl);
  assert.ok(validateSettings({ ...base, backendUrl: "http://x?y=1" }).backendUrl);
  assert.ok(validateSettings({ ...base, degradedMs: 9000 }).degradedMs, "must be below the timeout");
  assert.ok(validateSettings({ ...base, timeoutMs: 100 }).timeoutMs);
});

test("simulated data is deterministic, plausible and internally consistent", () => {
  const a = simDays("2026-10-28");
  const b = simDays("2026-10-28");
  assert.deepEqual(a, b);
  assert.equal(a.length, 180);
  assert.equal(a.at(-1)!.date, "2026-10-28");
  for (const d of a) {
    assert.equal(d.types.activity + d.types.environment + d.types.wearable, d.records, d.date);
    assert.ok(d.clients <= d.records && d.clients > 0);
  }
  const { current, previous } = periods(a, 30);
  assert.ok(current.records > 2200 && current.records < 3600, `30-day records ${current.records}`);
  assert.ok(previous && previous.records < current.records, "growing trend");
  assert.ok(current.requests > current.records * 3.5);
});

test("breakdown percentages always total 100 and trend handles gaps", () => {
  for (const t of [{ activity: 1, environment: 1, wearable: 1 }, { activity: 1420, environment: 855, wearable: 572 }, { activity: 5, environment: 3, wearable: 3 }]) {
    const { total, rows } = breakdown(t);
    assert.equal(rows.reduce((s, r) => s + r.pct, 0), 100);
    assert.equal(total, t.activity + t.environment + t.wearable);
  }
  assert.equal(breakdown({ activity: 0, environment: 0, wearable: 0 }).rows[0].pct, 0);
  assert.equal(trend(124, 100), 24);
  assert.equal(trend(80, 100), -20);
  assert.equal(trend(5, 0), null);
  assert.equal(trend(5, null), null);
});

test("csv escapes quotes and neutralises spreadsheet formulas", () => {
  const out = toCsv(["a", "b"], [['he said "hi", ok', "=SUM(A1)"], [3, "-5"]]);
  assert.equal(out, 'a,b\n"he said ""hi"", ok",\'=SUM(A1)\n3,-5\n');
});

test("parseConfig accepts exports and rejects anything else", () => {
  const good = JSON.stringify({ kind: "ecomab-admin-config", settings: { intervalSec: 300 }, endpoints: DEFAULT_ENDPOINTS });
  const parsed = parseConfig(good);
  assert.equal(parsed.endpoints.length, DEFAULT_ENDPOINTS.length);
  assert.equal(parsed.settings.intervalSec, 300);
  assert.throws(() => parseConfig("{"), /JSON/);
  assert.throws(() => parseConfig('{"kind":"other"}'), /not an EcoMAB/);
  assert.throws(() => parseConfig(JSON.stringify({ kind: "ecomab-admin-config", endpoints: [{ bad: 1 }] })), /no usable/);
});
