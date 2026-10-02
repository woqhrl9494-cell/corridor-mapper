/** Paired causal endpoint validation: node tests/drf/run-endpoint.mjs
 * Same walls, seeds, 0.75 m/snapshot and 150x150 grid; compare t=60 with t=80.
 * Memory O(grid + generated truth/wire); retain scalar readouts, not frame histories.
 * Ground truth is used only by the diagnostics/evaluator, never by createField.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { endianness } from 'node:os';
import { DEFAULT_INPUT, generateScenario, truePoses } from '../../drf/scenario.mjs';
import { evaluate as wallPoint } from '../../drf/wall.mjs';
import { createGrid, createField } from '../../drf/field.mjs';
import { createEvaluator, outerPeak, percentile } from '../../drf/evaluate.mjs';

const sourcePaths = ['drf/rng.mjs', 'drf/poly.mjs', 'drf/wall.mjs', 'drf/specular.mjs', 'drf/diffuse.mjs',
  'drf/scenario.mjs', 'drf/wire.mjs', 'drf/field.mjs', 'drf/evaluate.mjs', 'drf/sweep.mjs', 'wall_metrics.js'];
const root = new URL('../../', import.meta.url), sha = data => createHash('sha256').update(data).digest('hex');
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(new URL(path, root)))])));
const fieldHash = frame => createHash('sha256').update(new Uint8Array(frame.Dbar.buffer, frame.Dbar.byteOffset, frame.Dbar.byteLength))
  .update(new Uint8Array(frame.betaHat.buffer, frame.betaHat.byteOffset, frame.betaHat.byteLength)).digest('hex');
const frozenHash = '991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926';
assert.equal(DEFAULT_INPUT.snapshots, 80, 'Run after the 80-snapshot extension has been applied');
const beforeSources = await sourceHashes(), runs = [];
let prefixEqual = false;
for (const vehicles of [2, 3]) for (const seed of [1, 2, 3, 4, 5]) {
  const scenario = await generateScenario({ scene: 'reference', vehicles, seed, snapshots: 80, grid: 150 });
  const grid = createGrid(150, 150), field = createField(grid), evaluator = createEvaluator(scenario, grid);
  const samples = [0, 1].map(wall => Array.from({ length: 51 }, (_, k) => {
    const x = 55 + k * 0.1, span = scenario.spans.find(s => s.wall === wall && x >= s.C[0][0] && x <= s.C[0][0] + s.h);
    return [x, wallPoint(span, (x - span.C[0][0]) / span.h).s[1]];
  }));
  const mask = [new Uint8Array(51), new Uint8Array(51)], hitCounts = [{ specular: 0, diffuse: 0 }, { specular: 0, diffuse: 0 }];
  const row = { vehicles, seed, input: scenario.input, checkpoints: [] }; let prefixFrame;
  for (const [k, wire] of scenario.wire.entries()) {
    const frame = field.step(wire); // The estimator receives only the current measurement wire.
    for (const config of scenario.truth[k].configs) for (const kind of ['specular', 'diffuse']) for (const hit of config[kind]) {
      if (hit.s[0] >= 55 && hit.s[0] <= 60) hitCounts[hit.wall][kind]++;
      for (const [i, point] of samples[hit.wall].entries())
        if (!mask[hit.wall][i] && Math.hypot(point[0] - hit.s[0], point[1] - hit.s[1]) <= 1) mask[hit.wall][i] = 1;
    }
    if (![60, 80].includes(frame.t)) continue;
    if (frame.t === 60 && vehicles === 3 && seed === 1) prefixFrame = frame;
    const evaluation = evaluator.step(frame), { byColumn } = outerPeak(frame.Dbar, grid);
    const endpoint = [0, 1].map(wall => {
      const errors = Array.from(grid.x.entries()).filter(([, x]) => x >= 55 && x <= 60).map(([ix, x]) => {
        const span = scenario.spans.find(s => s.wall === wall && x >= s.C[0][0] && x <= s.C[0][0] + s.h);
        return byColumn[wall][ix] ? Math.abs(byColumn[wall][ix][1] - wallPoint(span, (x - span.C[0][0]) / span.h).s[1]) : Infinity;
      });
      const observedSamples = mask[wall].reduce((n, value) => n + value, 0);
      return { wall, ...hitCounts[wall], observedSamples, totalSamples: 51, coverage1m: observedSamples / 51,
        proxyColumns: errors.length, missingProxy: errors.filter(e => e === Infinity).length,
        proxyRecall04: errors.filter(e => e <= 0.4).length / errors.length,
        proxyMedian: percentile(errors, 0.5), proxyP95: percentile(errors, 0.95) };
    });
    row.checkpoints.push({ t: frame.t, Q: frame.Q, fieldHash: fieldHash(frame), poses: scenario.truth[k].p, endpoint,
      standardEvaluation: Object.fromEntries(['medianError', 'p95', 'observedFraction', 'coverage', 'f1', 'caMsd', 'caHd95', 'missing'].map(key => [key, evaluation[key]])) });
  }
  for (const e of row.checkpoints[0].endpoint) assert.equal(e.coverage1m, 0, 'The old route does not observe the final 5 m');
  for (const e of row.checkpoints[1].endpoint) assert.equal(e.coverage1m, 1, 'The extended route observes the final 5 m');
  if (vehicles === 3 && seed === 1) {
    const old = await generateScenario({ scene: 'reference', vehicles, seed, snapshots: 60, grid: 150 });
    assert.deepEqual(scenario.truth.slice(0, 60), old.truth); assert.deepEqual(scenario.wire.slice(0, 60), old.wire);
    assert.equal(row.checkpoints[0].fieldHash, frozenHash, 'The original 60-snapshot numerical result must remain identical');
    assert.deepEqual(createEvaluator(old, grid).step(prefixFrame), createEvaluator(scenario, grid).step(prefixFrame),
      'Future truth must not affect any t=60 evaluation output');
    prefixEqual = true;
  }
  runs.push(row);
}
assert.deepEqual(await sourceHashes(), beforeSources, 'Scientific sources changed during validation');
const report = { schema: 'echomap-drf-endpoint-validation/1', date: new Date().toISOString(), command: 'node tests/drf/run-endpoint.mjs',
  sourceSHA256: beforeSources, byteOrder: endianness(), dtype: 'Float32Array', original60PrefixEqual: prefixEqual, original60FieldHash: frozenHash,
  protocol: { scene: 'reference', vehicles: [2, 3], seeds: [1, 2, 3, 4, 5], snapshots: [60, 80], grid: [150, 150], gridDomainM: [0, 60, 0, 30],
    routeStepMPerSnapshot: 0.75, endpointXM: [55, 60], samplesPerWall: 51, sampleStepXM: 0.1, observedHitRadiusM: 1,
    proxyToleranceM: 0.4, missingProxyError: 'Infinity', standardErrorXM: [10, 50] },
  limitations: ['Ground truth and endpoint diagnostics are evaluation-only.', 'The outer-peak proxy uses a corridor prior; observed coverage does not guarantee extraction accuracy.',
    'Two vehicles retain endpoint ambiguity despite 100% observed coverage.', 'Internal median/P95 can worsen while endpoint coverage improves.',
    'Walls end at x=60 m with an open exit; extended point vehicles may travel outside the finite wall interval.', 'One snapshot is a sampling index; 0.75 m/snapshot is not a specified physical speed.'],
  finalFleetXRangeM: [Math.min(...truePoses(80, 20).map(p => p[0])), Math.max(...truePoses(80, 20).map(p => p[0]))], runs };
await writeFile(new URL('./endpoint-validation.json', import.meta.url), JSON.stringify(report, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2) + '\n');
console.log(`Endpoint validation passed: ${runs.length} paired runs; original 60-snapshot field hash retained; final 5 m coverage 0% -> 100%.`);
