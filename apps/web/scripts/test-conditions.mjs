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
