import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT, normalizeInput, createSceneGeometry, truePoses, generateSnapshot,
  generateScenario, LAYERED_DOMAIN } from '../../drf/scenario.mjs';
import { evaluateCentre, evaluateWall } from '../../drf/wall.mjs';
import { specularPoints, visible } from '../../drf/specular.mjs';
import { createRng } from '../../drf/rng.mjs';

const input = raw => normalizeInput({ scene: 'layered', ...raw });
const close = (a, b, tolerance = 2e-12) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
let cachedGeometry;
const geometry = () => cachedGeometry ??= createSceneGeometry(input());
const assertAccepted = g => {
  assert.deepEqual(g.domain, [0, 60, -20, 50]);
  const { bounds, minVehicleClearance, attempt, attempts, rejections } = g.wallGeneration;
  assert.ok(bounds.minWidth > 4 && bounds.ymin >= -20 && bounds.ymax <= 50 && minVehicleClearance >= 1);
  assert.equal(attempts, attempt + 1); assert.equal(rejections.length, attempt);
  assert.deepEqual(rejections.map(r => r.attempt), Array.from({ length: attempt }, (_, k) => k));
  assert.equal(g.wallGeneration.clearanceAxis, 'y');
  assert.deepEqual(g.wallGeneration.validationFleet, { vehicles: 20, snapshots: 80, wallInterval: [0, 60] });
};

test('layered scene validates its fixed domain and every supported interior vehicle pose', () => {
  assert.equal(DEFAULT_INPUT.scene, 'layered'); assert.deepEqual(LAYERED_DOMAIN, [0, 60, -20, 50]);
  const g = geometry(); assertAccepted(g);
  let minimum = Infinity;
  for (let t = 1; t <= 80; t++) for (const [x, y] of truePoses(t, 20, g.wallModel)) {
    if (x > 60) continue;
    minimum = Math.min(minimum, y - evaluateWall(g.wallModel, x, 0).value, evaluateWall(g.wallModel, x, 1).value - y);
  }
  assert.equal(minimum, g.wallGeneration.minVehicleClearance);
  for (const wall of g.walls) for (const [x, y] of wall) assert.ok(x >= 0 && x <= 60 && y >= -20 && y <= 50);
  assert.throws(() => generateSnapshot(input(), g.spans, 1), /accepted truth wall model/);
});

test('rejection records actual domain, opening and vehicle-clearance failures before acceptance', () => {
  const rough = createSceneGeometry(input({ seed: 1, sigmaDGeometry: 2 })); assertAccepted(rough);
  assert.ok(rough.wallGeneration.attempt > 0);
  for (const reason of ['passage-width', 'vehicle-clearance'])
    assert.ok(rough.wallGeneration.rejections.some(r => r.reasons.includes(reason)));
  const largeCentre = createSceneGeometry(input({ seed: 1, sigmaM: 12 })); assertAccepted(largeCentre);
  assert.ok(largeCentre.wallGeneration.rejections.some(r => r.reasons.includes('domain')));
});

test('60/80 duration, fleet size, measurement noise and field settings cannot select another wall', () => {
  const a = createSceneGeometry(input({ seed: 1, sigmaDGeometry: 2, snapshots: 60, vehicles: 3 }));
  const b = createSceneGeometry(input({ seed: 1, sigmaDGeometry: 2, snapshots: 80, vehicles: 20,
    sigmaP: 0.2, sigmaD: 0.3, roughness: 5, lambda0: 30, grid: 200, band: 'full', perimeter: 'ramanujan' }));
  assert.deepEqual(b, a, 'fixed supported-fleet rejection must preserve paired experiments and their common geometry');
  for (const t of [1, 60, 80]) assert.deepEqual(truePoses(t, 3, a.wallModel), truePoses(t, 20, b.wallModel).slice(0, 3));
});

test('all 20 vehicles exit through a tangent continuation of the centre without extending either wall', () => {
  const g = geometry(), end = evaluateCentre(g.wallModel, 60), poses = truePoses(80, 20, g.wallModel);
  assert.ok(poses.every(([x]) => x > 60));
  poses.forEach(([x, y], v) => close(y - 2 * Math.sin(2 * Math.PI * x / 30 + v + 1), end.value + end.first * (x - 60)));
  for (const wall of g.walls) assert.equal(wall.at(-1)[0], 60);
  assert.throws(() => evaluateWall(g.wallModel, 60.001, 0), /\[0,L\]/);
});

test('actual layered measurements repeat, preserve causal prefixes and keep paired RNG outside the wire', async () => {
  const first = await generateScenario(input({ snapshots: 1 }));
  const repeat = await generateScenario(input({ snapshots: 1 }));
  const longer = await generateScenario(input({ snapshots: 2 }));
  for (const key of ['wallModel', 'wallGeneration', 'spans', 'walls', 'domain']) assert.deepEqual(repeat[key], first[key]);
  assert.deepEqual(repeat.truth, first.truth); assert.deepEqual(repeat.wire, first.wire);
  assert.deepEqual(longer.truth.slice(0, 1), first.truth); assert.deepEqual(longer.wire.slice(0, 1), first.wire);
  const paired = generateSnapshot(input({ sigmaP: 0.2, sigmaD: 0.3, roughness: 5 }), first.spans, 1, first.wallModel);
  assert.deepEqual(paired.truth.p, first.truth[0].p); assert.deepEqual(paired.truth.poseNoise, first.truth[0].poseNoise);
  for (let c = 0; c < paired.truth.configs.length; c++) {
    assert.deepEqual(paired.truth.configs[c].specular, first.truth[0].configs[c].specular);
    const config = paired.wire.configs[c];
    assert.deepEqual(Object.keys(config).sort(), ['i', 'j', 'pHat_i', 'pHat_j', 'Sigma_i', 'Sigma_j', 'paths'].sort());
    for (const path of config.paths) assert.deepEqual(Object.keys(path).sort(), ['dHat', 'sigmaD']);
    assert.equal(config.pHat_i.length, 2); assert.equal(config.pHat_j.length, 2);
    assert.equal(config.Sigma_i.length, 3); assert.equal(config.Sigma_j.length, 3);
  }
  assert.deepEqual(Object.keys(paired.wire).sort(), ['configs', 't']);
  for (let v = 0; v < paired.truth.poseNoise.length; v++) {
    const rng = createRng(1, 'pose', 1, v + 1);
    assert.deepEqual(paired.truth.poseNoise[v], [rng.normal(), rng.normal()]);
  }
});

test('regular layered roots match independent unsquared Fermat brackets and inward graph curvature', () => {
  const g = geometry(), poses = truePoses(1, 3, g.wallModel);
  // Independent power sums and finite sign-change brackets; this fixture tests
  // regular roots, not completeness at even-multiplicity/caustic clusters.
  const power = (span, u) => ({
    s: [0, 1].map(d => span.C.reduce((sum, row, k) => sum + row[d] * u ** k, 0)),
    t: [0, 1].map(d => span.C.slice(1).reduce((sum, row, k) => sum + (k + 1) * row[d] * u ** k, 0)),
    dd: [0, 1].map(d => span.C.slice(2).reduce((sum, row, k) => sum + (k + 1) * (k + 2) * row[d] * u ** k, 0)),
  });
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const pT = poses[i], pR = poses[j], points = specularPoints(g.spans, pT, pR), bracketed = [];
    assert.ok(points.length > 0, 'the fixture must exercise visible regular roots');
    assert.equal(points.diagnostics.unresolved, 0); assert.equal(points.diagnostics.nearMultiple, 0);
    for (const span of g.spans) {
      const residual = u => {
        const { s, t } = power(span, u), a = s.map((value, d) => value - pT[d]), b = s.map((value, d) => value - pR[d]);
        return t.reduce((sum, value, d) => sum + value * (a[d] / Math.hypot(...a) + b[d] / Math.hypot(...b)), 0);
      };
      let previous = residual(0);
      for (let k = 1; k <= 1024; k++) {
        let lo = (k - 1) / 1024, hi = k / 1024, flo = previous;
        const current = residual(hi); previous = current;
        if (!(flo * current < 0)) continue;
        for (let n = 0; n < 60; n++) {
          const mid = (lo + hi) / 2, f = residual(mid);
          if (f === 0) { lo = hi = mid; break; }
          if (Math.sign(f) === Math.sign(flo)) { lo = mid; flo = f; } else hi = mid;
        }
        const u = (lo + hi) / 2, { s, t } = power(span, u), side = p => t[0] * (s[1] - p[1]) - t[1] * (s[0] - p[0]);
        if (side(pT) * side(pR) > 0 && visible(g.spans, pT, s) && visible(g.spans, pR, s)) bracketed.push({ s, span: span.span });
      }
    }
    assert.equal(points.length, bracketed.length, `configuration ${i + 1},${j + 1}: visible regular root count`);
    for (const point of points) {
      assert.ok(bracketed.some(root => root.span === point.span && Math.hypot(...root.s.map((v, d) => v - point.s[d])) < 1e-9));
      const span = g.spans.find(s => s.span === point.span), { s, t, dd } = power(span, point.u);
      const a = s.map((v, d) => v - pT[d]), b = s.map((v, d) => v - pR[d]), ra = Math.hypot(...a), rb = Math.hypot(...b);
      const bisector = a.map((v, d) => v / ra + b[d] / rb);
      const normalized = Math.abs(t[0] * bisector[0] + t[1] * bisector[1]) / (Math.hypot(...t) * Math.hypot(...bisector));
      assert.ok(normalized <= 64 * Number.EPSILON, `regular Fermat residual ${normalized}`);
      const yp = t[1] / t[0], ypp = dd[1] / t[0] ** 2, side = point.wall === 1 ? 1 : -1;
      const inward = -side * ypp / (1 + yp ** 2) ** 1.5;
      close(point.cth * (1 / ra + 1 / rb) / 2 - point.dkap, inward);
    }
  }
});
