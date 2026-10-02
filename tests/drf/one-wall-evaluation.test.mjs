import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGrid } from '../../drf/field.mjs';
import { createEvaluator, outerPeak } from '../../drf/evaluate.mjs';
import { evaluate as wallPoint } from '../../drf/wall.mjs';

const grid = createGrid(1, 30, [29.8, 30.2, 0, 30]);
function scene(wallSide, y) {
  const wall = wallSide === 'upper' ? 1 : 0, walls = [[], []];
  walls[wall] = [[0, y], [80, y]];
  return { input: { wallSide, roughness: 0, lambda0: 10, sigmaD: .1, sigmaP: .1 }, walls,
    truth: [{ t: 1, configs: [{ i: 1, j: 2, diffuse: [],
      specular: [{ s: [30, y], span: 1, wall, rho: 20, cth: 1, dkap: .1 }] }] },
    { get configs() { throw new Error('future truth read'); } }] };
}

test('one-wall scoring retains false opposite peaks and works across the fixed y=15 partition', () => {
  for (const [side, real, ghost] of [['upper', 8, 25], ['lower', 22, 4]]) {
    const Dbar = new Float32Array(grid.ny); Dbar[real] = 10; Dbar[ghost] = 7;
    const model = scene(side, grid.y[real]), frame = { t: 1, Dbar }, extracted = outerPeak(Dbar, grid),
      result = createEvaluator(model, grid).step(frame);
    assert.deepEqual(result.proxy, extracted.proxy, 'truth/configuration must never filter the measured-field peaks');
    assert.equal(result.predictedCount, 2); assert.equal(result.observedColumns, 1);
    assert.equal(result.observedFraction, 1); assert.equal(result.missing, 0);
    assert.ok(result.medianError < 1e-12);
    assert.equal(result.p95, Math.abs(grid.y[real] - grid.y[ghost]));
    assert.equal(result.offwall, .5); assert.equal(result.precision, .5);
    assert.ok(result.caMsd > 1 && result.f1 < 1, 'hallucinated absent-wall predictions must be penalized');

    const changedTruth = structuredClone({ ...model, truth: model.truth.slice(0, 1) });
    changedTruth.walls[side === 'upper' ? 1 : 0].forEach(p => { p[1] += 3; });
    assert.deepEqual(createEvaluator(changedTruth, grid).step(frame).proxy, extracted.proxy);
    Dbar[ghost] = 0;
    const clean = createEvaluator(model, grid).step(frame);
    assert.ok(clean.p95 < 1e-12); assert.equal(clean.missing, 0);
    assert.equal(clean.predictedCount, 1, 'a peak on the other y=15 side remains a valid one-wall prediction');
  }
});

test('one-wall observed failures remain infinite; no-observation snapshots remain missing', () => {
  const model = scene('upper', 8.5), frame = { t: 1, Dbar: new Float32Array(grid.ny) },
    failed = createEvaluator(model, grid).step(frame);
  assert.equal(failed.missing, 1); assert.equal(failed.observedColumns, 1);
  assert.equal(failed.medianError, Infinity); assert.equal(failed.p95, Infinity);
  assert.equal(failed.offwall, 1); assert.equal(failed.f1, 0);
  model.truth[0].configs[0].specular = [];
  const absent = createEvaluator(model, grid).step(frame);
  assert.equal(absent.medianError, null); assert.equal(absent.p95, null);
});

test('both-wall evaluator outputs exactly match the archived frozen evaluator', () => {
  const source = fs.readFileSync(new URL('./legacy-source/evaluate.mjs', import.meta.url), 'utf8')
    .replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
  const legacy = new Function('wallPoint', source + '\nreturn { createEvaluator };')(wallPoint);
  const model = scene('lower', 8.5);
  model.input.wallSide = 'both'; model.walls[1] = [[0, 22.5], [80, 22.5]];
  model.truth[0].configs[0].specular.push({ s: [30, 22.5], span: 7, wall: 1, rho: 20, cth: 1, dkap: .1 });
  for (const peaks of [[], [8, 22], [4, 8, 22, 25]]) {
    const Dbar = new Float32Array(grid.ny); peaks.forEach((k, i) => { Dbar[k] = 10 - i; });
    const frame = { t: 1, Dbar };
    assert.deepEqual(createEvaluator(model, grid).step(frame), legacy.createEvaluator(model, grid).step(frame));
  }
});
