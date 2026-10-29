import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
function load(name) {
  const filename = path.resolve(__dirname, '../src/lib', name + '.ts');
  if (cache.has(filename)) return cache.get(filename);
  const compiled = { exports: {} };
  cache.set(filename, compiled.exports);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename })(
    (relative) => load(path.relative(path.resolve(__dirname, '../src/lib'), path.resolve(path.dirname(filename), relative))),
    compiled, compiled.exports,
  );
  return compiled.exports;
}
const score = load('score');
const format = load('format');
const missing = { hour: 2, tempC: null, humidity: null, pm25: null, no2: null,
  windKmh: null, rush: null, daylight: 1,
  factors: { heat: null, air: null, wind: null, traffic: null, safety: null, light: 100 } };

test('missing source readings cannot become a good daylight-only recommendation', () => {
  const result = score.hourScore(missing, 'run');
  assert.ok(Number.isNaN(result));
  assert.equal(score.verdict(result), 'unknown');
  assert.equal(format.displayNumber(result), '—');
  assert.deepEqual(score.bestWindows(Array(24).fill(result)), []);
  assert.equal(format.tempWord(null), 'No data');
  assert.equal(format.airWord(null), 'No data');
  assert.equal(format.trafficInfo({ hours: Array(24).fill(missing) }, 2).title, 'No data');
});

test('real zero remains a numeric value and partial windows exclude missing hours', () => {
  assert.equal(format.displayNumber(0), '0');
  const series = Array(24).fill(Number.NaN);
  series[8] = 80; series[9] = 90; series[11] = 70;
  assert.deepEqual(score.bestWindows(series), [{ start: 8, end: 10, score: 85 }, { start: 11, end: 12, score: 70 }]);
  assert.equal(format.rangeText([null, 0, 10]), '0° to 10°');
  assert.equal(format.rangeText([null]), 'No temperature data');
});

const time = load('time');
test('Berlin dates and hours handle UTC midnight boundaries and DST explicitly', () => {
  assert.equal(time.berlinDate(new Date('2026-10-28T23:30:00Z')), '2026-10-29');
  assert.equal(time.berlinHour(new Date('2026-10-28T23:30:00Z')), 0);
  assert.equal(time.berlinHour(new Date('2026-10-25T00:30:00Z')), 2);
  assert.equal(time.berlinHour(new Date('2026-10-25T01:30:00Z')), 2);
});

test('reminders reject nonexistent Berlin hours and choose first repeated instant', () => {
  assert.equal(time.berlinInstant('2026-03-29',2), null);
  assert.equal(time.berlinInstant('2026-10-25',2).toISOString(), '2026-10-25T00:00:00.000Z');
});

const lens = load('lens');
const rank = load('rank');
test('missing spatial inputs stay blank and cannot become static-only recommendations', () => {
  const empty = Array(24).fill(null);
  const cell = { id: 'partial', place: 'Captured road', heat: empty, air: empty, wind: empty,
    traffic: Array(24).fill(80), light: Array(24).fill(100), safety: null, green: null,
    surface: null, confidence: 0, recommendable: false };
  assert.ok(Number.isNaN(score.cellScore(cell, 12, 'ride')));
  assert.ok(Number.isNaN(lens.lensValue(cell, 12, 'safety', 'ride', {})));
  assert.ok(Number.isNaN(lens.lensValue(cell, 12, 'surface', 'ride', {})));
  const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[9.2,49.1],[9.21,49.1],[9.21,49.11],[9.2,49.11],[9.2,49.1]]] }, properties: cell };
  const grid = { cells: { features: [feature] } };
  assert.deepEqual(rank.rankSpots(grid, 12, 'ride', {}, 3, null, null), []);
  cell.heat = cell.air = cell.wind = Array(24).fill(90);
  assert.ok(Number.isFinite(score.cellScore(cell, 12, 'ride')));
  assert.deepEqual(rank.rankSpots(grid, 12, 'ride', {}, 3, null, null), []);
  cell.recommendable = true;
  assert.equal(rank.rankSpots(grid, 12, 'ride', {}, 3, null, null).length, 1);
});

const { startDictation } = load('ai/speech');
function recognizer() {
  return { starts: 0, stops: 0, aborts: 0,
    start() { this.starts++; }, stop() { this.stops++; }, abort() { this.aborts++; },
    result(...parts) {
      this.onresult?.({ results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
    },
  };
}
test('dictation waits through interim results, final phrases and pauses until Finish', () => {
  const rec = recognizer();
  const submitted = []; const drafts = [];
  const session = startDictation(rec, { draft: (s) => drafts.push(s), finish: (s) => submitted.push(s), error: assert.fail });
  rec.result(['Can I', false]);
  rec.result(['Can I run', true], ['after', false]);
  assert.deepEqual(submitted, []);
  rec.onend(); // browser ends on a pause, but the user has not finished
  assert.equal(rec.starts, 2);
  rec.result(['after work', true]);
  session.finish();
  assert.deepEqual(submitted, []); // wait for recognition to drain after stop
  rec.result(['after work today', true]);
  rec.onend();
  rec.onend();
  assert.deepEqual(submitted, ['Can I run after work today']);
  assert.equal(drafts.at(-1), 'Can I run after work today');
});
test('cancel, recognition error and denied permission never submit a question', () => {
  for (const mode of ['cancel', 'error', 'throw']) {
    const rec = recognizer(); let errors = 0;
    if (mode === 'throw') rec.start = () => { throw new Error('permission'); };
    const session = startDictation(rec, { draft() {}, finish: assert.fail, error() { errors++; } });
    if (mode === 'cancel') session.cancel();
    if (mode === 'error') rec.onerror();
    rec.onend?.();
    session.finish();
    assert.equal(errors, mode === 'cancel' ? 0 : 1);
    assert.ok(rec.aborts >= 1);
  }
});

const { contextRecords } = load('ai/records');
const { buildMessages, estimateTokens, selectRecords } = load('ai/context');
const { CONTEXT_TOKENS } = load('ai/engine');
const facts = { date: '2026-10-29', sport: 'run', area: 'Heilbronn', reachKm: null, sensitiveToAir: false };
test('fresh AI context preserves backend fields, zero, null, provenance and device source distinctions', () => {
  const observed = { sample_id: 'real', timestamp_utc: '2026-10-29T12:00:00Z', value: 82, unit: 'bpm', source_type: 'ble_gatt' };
  const records = contextRecords({
    day: { date: facts.date, source: 'forecast', hours: [{ hour: 12, tempC: 0, no2: null, provenance: { tempC: { kind: 'model', unit: '°C', observedAt: ['2026-10-29T12:00:00Z'] } } }] },
    grid: { source: 'mixed', cells: { features: [{ properties: { id: 'cell', recommendable: false, confidence: 0 } }] } },
    sensors: [{ id: 'station', latest: { ozone: 32 }, stale: true }],
    segments: { source: 'mixed', scores: { 123: [70, 0.4, 0] } }, segmentDetail: { segment_id: 123, missing: ['air'] },
    devices: [{ id: 'demo', name: 'WHOOP', connected: false, samples: [{ timestamp: '2026-10-29T11:00:00Z', heartRateBpm: 120 }], summary: { recoveryScoreDemo: 65 } }],
    readings: [observed], recent: [observed], ble: { connected: true, battery: 0, last: observed }, error: null,
  });
  assert.equal(records.filter((r) => r.category === 'ble_sample').length, 1);
  const messages = buildMessages({ question: 'Compare WHOOP heart rate with air and ozone at the station and street segment temperature today', facts, memory: {}, history: [], records });
  const body = messages.at(-1).content;
  for (const field of ['synthetic local fixture', 'observed BLE', 'ozone', 'provenance', 'recommendable', 'segment_id', 'tempC":0', 'no2":null', 'recoveryScoreDemo']) assert.ok(body.includes(field), field);
  assert.doesNotMatch(messages[0].content, /no live weather/);
});
test('large references stay bounded, select relevant records and count omissions truthfully', () => {
  const records = Array.from({ length: 1000 }, (_, n) => ({ category: 'sensor', data: { id: `station-${n}`, payload: 'x'.repeat(500) } }));
  records.push({ category: 'device_sample', data: { name: 'WHOOP', source: 'synthetic', heartRateBpm: 123 } });
  const messages = buildMessages({ question: 'WHOOP heart rate?', facts, memory: {}, history: [{ role: 'user', text: 'x'.repeat(2000) }], records });
  assert.ok(messages.at(-1).content.includes('heartRateBpm":123'));
  assert.ok(messages.at(-1).content.includes('"total":1000'));
  assert.ok(estimateTokens(JSON.stringify(messages)) + 200 < CONTEXT_TOKENS);
  const none = selectRecords('air', [{ category: 'sensor', data: 'x'.repeat(10000) }], 150);
  assert.ok(none.includes('"included":0'));
  const refreshed = buildMessages({ question: 'WHOOP heart rate?', facts, memory: {}, history: [], records: [{ category: 'device_sample', data: { heartRateBpm: 99 } }] });
  assert.ok(refreshed.at(-1).content.includes('heartRateBpm":99'));
  assert.ok(!refreshed.at(-1).content.includes('heartRateBpm":123'));
});

test('all-hour overview keeps every value available when repeated provenance exceeds the context', () => {
  const records = contextRecords({
    day: { date: facts.date, timezone: 'Europe/Berlin', source: 'forecast', hours: Array.from({ length: 24 }, (_, hour) => ({
      hour, tempC: hour, humidity: null, no2: 0, factors: { air: hour + 50 }, missing: ['humidity'],
      provenance: { tempC: { kind: 'model', rawRefs: Array(100).fill(123), observedAt: ['2026-10-29T12:00:00Z'] } },
    })) },
    grid: null, sensors: [], segments: null, segmentDetail: null, devices: [], readings: [], recent: [],
    ble: { connected: false, battery: null, last: null }, error: null,
  });
  const messages = buildMessages({ question: 'When is the best time today?', facts, memory: {}, history: [], records });
  const body = messages.at(-1).content;
  assert.ok(body.includes('"tempC":[' + Array.from({ length: 24 }, (_, n) => n).join(',') + ']'));
  assert.ok(body.includes('"no2":[' + Array(24).fill(0).join(',') + ']'));
  assert.ok(body.includes('"source":"forecast"'));
  assert.ok(estimateTokens(JSON.stringify(messages)) + 200 < CONTEXT_TOKENS);
});

test('social turns skip records but data questions and ambiguous follow-ups retain access', () => {
  const { questionNeedsRecords } = load('ai/context');
  const records = [{ category: 'sensor', data: { privateMarker: 'fresh-reading', temperature: 12 } }];
  for (const question of ['Hello!', 'hi coach', 'Thanks.', 'How are you?']) {
    assert.equal(questionNeedsRecords(question), false);
    const messages = buildMessages({ question, facts, memory: {}, history: [], records });
    assert.ok(!messages.at(-1).content.includes('fresh-reading'));
    assert.ok(estimateTokens(JSON.stringify(messages)) < 1400);
  }
  for (const question of ['Hello, what is the air quality?', 'And tomorrow?', 'What about that?', 'Tell me more']) {
    assert.equal(questionNeedsRecords(question), true);
    const messages = buildMessages({ question, facts, memory: {}, history: [], records });
    assert.ok(messages.at(-1).content.includes('fresh-reading'));
  }
});

test('station records outrank unrelated metadata under a tight data budget', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({ category: 'grid_metadata', data: { id: i, payload: 'x'.repeat(100) } }));
  records.push({ category: 'sensor', data: { id: 'measured-station', no2: 0, stale: true } });
  const reference = selectRecords('Air quality at the station?', records, 300);
  assert.ok(reference.includes('measured-station'));
  assert.ok(reference.includes('"no2":0'));
  assert.ok(reference.includes('"stale":true'));
  assert.ok(reference.includes('"total":20'));
});

test('model load, warmup and streamed replies explicitly disable thinking', async () => {
  const calls = [];
  class FakeWllama {
    cacheManager = { list: async () => [] };
    async loadModelFromUrl(url, options) { calls.push({ kind: 'load', options }); }
    async createChatCompletion(options) {
      calls.push({ kind: 'chat', options });
      if (!options.stream) return {};
      return (async function* () { yield { choices: [{ delta: { content: 'Hello!' } }] }; })();
    }
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/ai/engine.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiledEngine = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${outputText}\n})`, {
    WebAssembly, AbortController, performance, setTimeout, clearTimeout, self: { crossOriginIsolated: true },
    navigator: { hardwareConcurrency: 4, deviceMemory: 8, storage: { estimate: async () => ({ quota: 2 ** 32, usage: 0 }) } },
    document: { addEventListener() {} },
  })((name) => name === './prompt' ? load('ai/prompt') : { Wllama: FakeWllama }, compiledEngine, compiledEngine.exports);
  const engine = compiledEngine.exports;
  await engine.initAI();
  await engine.installModel();
  assert.equal(engine.getState().status, 'ready');
  const result = await engine.generate([{ role: 'user', content: 'Hello' }], () => {});
  assert.equal(result.text, 'Hello!');
  const metrics = engine.getState().lastGeneration;
  assert.equal(metrics.promptCharacters, 5);
  assert.ok(metrics.firstTextMs >= 0);
  assert.ok(metrics.totalMs >= metrics.firstTextMs);
  assert.equal(metrics.stopped, false);
  assert.ok(!JSON.stringify(metrics).includes('Hello'));
  const options = calls.find((c) => c.kind === 'load').options;
  assert.equal(options.reasoning, false);
  assert.equal(options.reasoning_budget_tokens, 0);
  assert.equal(options.default_template_kwargs.enable_thinking, false);
  const chats = calls.filter((c) => c.kind === 'chat');
  assert.equal(chats.length, 2);
  for (const { options } of chats) assert.equal(options.chat_template_kwargs.enable_thinking, false);
  assert.equal(chats[1].options.max_tokens, 120);
});

test('focused references leave spare budget unused rather than padding with unrelated records', () => {
  const records = [
    { category: 'availability_metadata', data: { sensorCount: 1, error: null } },
    { category: 'sensor', data: { id: 'station', no2: 0, stale: false } },
    { category: 'device_metadata', data: { name: 'unrelated-watch' } },
    { category: 'day_series_metadata', data: { tempC: [1, 2, 3] } },
  ];
  const focused = selectRecords('Air at the station?', records, 3000);
  assert.ok(focused.includes('"no2":0'));
  assert.ok(focused.includes('"sensorCount":1'));
  assert.ok(!focused.includes('unrelated-watch'));
  assert.ok(!focused.includes('"tempC"'));
  assert.ok(focused.includes('"device_metadata":{"total":1,"included":0}'));
  const followup = selectRecords('Tell me more', records, 3000);
  assert.ok(followup.includes('unrelated-watch'));
});
