import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../drf/rng.mjs';
import { createWalls, createTwoLayerWallModel, evaluateUniformCubic, evaluateCentre,
  evaluateWall, twoLayerWallSpans, twoLayerWallBounds, evaluate, wallCells } from '../../drf/wall.mjs';

const close = (actual, expected, tolerance = 2e-11) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const derivatives = ['value', 'first', 'second', 'third'];

// Independent truncated-power cardinal basis, rather than the generator's
// four-control power matrix. N3 has support [-2,2] and right-sided N3'''.
function basis(z, order) {
  if (z < -2 || z >= 2) return 0;
  const multipliers = [1, -4, 6, -4, 1], degree = 3 - order,
    factor = [1 / 6, 1 / 2, 1, 1][order];
  return multipliers.reduce((sum, multiplier, k) => {
    const shifted = z + 2 - k;
    return sum + multiplier * (shifted >= 0 ? shifted ** degree : 0);
  }, 0) * factor;
}
function independentComponent(component, x, order) {
  return component.coefficients.reduce((sum, coefficient, index) => sum + coefficient
    * basis((x - component.origin) / component.spacing - (component.start + index), order)
    / component.spacing ** order, 0);
}

test('two-layer model uses full cubic support, independent addressed streams and serializable reproducibility', () => {
  const model = createTwoLayerWallModel({ seed: 1 });
  assert.deepEqual(model, createTwoLayerWallModel({ seed: 1 }));
  assert.deepEqual(model, JSON.parse(JSON.stringify(model)));
  assert.equal(model.attempt, 0);
  assert.equal(model.L, 60); assert.equal(model.W, 12); assert.equal(model.baseline, 15);
  for (const [component, sigma, address] of [[model.mu, 6, ['mu']], [model.d[0], .33, ['d', 0]], [model.d[1], .33, ['d', 1]]]) {
    const rng = createRng(1, 'wall', ...address);
    assert.equal(component.origin, component.spacing * rng.uniform());
    assert.equal(component.start, -2);
    assert.equal(component.coefficients.length, Math.ceil(model.L / component.spacing) + 4);
    assert.ok(component.origin > 0 && component.origin < component.spacing);
    for (const value of component.coefficients) assert.equal(value, Math.SQRT2 * sigma * rng.normal());
    for (let k = 0; k <= 120; k++) for (const [order, key] of derivatives.entries())
      close(evaluateUniformCubic(component, k / 2)[key], independentComponent(component, k / 2, order));
  }
  assert.notDeepEqual(model.d[0], model.d[1]);
  assert.deepEqual(createTwoLayerWallModel({ sigmaM: 12 }).d, model.d, 'Centre amplitude cannot alter wall roughness streams');
  assert.deepEqual(createTwoLayerWallModel({ sigmaDGeometry: .66 }).mu, model.mu, 'Geometry roughness cannot alter centre stream');
  const retry = createTwoLayerWallModel({ seed: 1, attempt: 1 }), retryRng = createRng(1, 'wall', 'mu', 1);
  assert.equal(retry.mu.origin, retry.mu.spacing * retryRng.uniform());
  assert.notDeepEqual(retry.mu, model.mu);
  for (const seed of [-1, 1.1, 2 ** 32, NaN]) assert.throws(() => createTwoLayerWallModel({ seed }));
  for (const attempt of [-1, .1, Infinity]) assert.throws(() => createTwoLayerWallModel({ attempt }));
  for (const options of [{ L: 0 }, { W: -1 }, { deltaM: 0 }, { deltaD: NaN }, { sigmaM: -1 }, { sigmaDGeometry: -1 }, { baseline: Infinity }])
    assert.throws(() => createTwoLayerWallModel(options));
  assert.throws(() => evaluateCentre(model, -1)); assert.throws(() => evaluateCentre(model, 61));
  assert.throws(() => evaluateWall(model, 30, 2));
});

test('union-knot spans match independent components and remain C2; inward curvature has the wall-side sign', () => {
  const model = createTwoLayerWallModel({ seed: 739, L: 61, deltaM: 19.7, deltaD: 3.8 }), spans = twoLayerWallSpans(model);
  assert.equal(new Set(spans.map(span => span.span)).size, spans.length);
  for (let wall = 0; wall < 2; wall++) {
    const list = spans.filter(span => span.wall === wall), side = wall === 1 ? 1 : -1;
    assert.equal(list[0].C[0][0], 0); close(evaluate(list.at(-1), 1).s[0], model.L);
    assert.ok(list.slice(0, -1).every(span => !span.last)); assert.equal(list.at(-1).last, true);
    for (const span of list) for (const u of [0, .25, .5, .75, 1]) {
      const value = evaluate(span, u), x = value.s[0], a = evaluateWall(model, x, wall),
        mu = evaluateCentre(model, x), d = evaluateUniformCubic(model.d[wall], x);
      close(value.s[1], mu.value + side * (model.W / 2 + d.value));
      close(value.s[1], a.value); close(value.t[1] / span.h, a.first); close(value.dd[1] / span.h ** 2, a.second);
      assert.ok(value.s[0] >= span.aabb[0] - 1e-12 && value.s[0] <= span.aabb[2] + 1e-12);
      assert.ok(value.s[1] >= span.aabb[1] - 1e-12 && value.s[1] <= span.aabb[3] + 1e-12);
      const signedCrossCurvature = -side * (value.t[0] * value.dd[1] - value.t[1] * value.dd[0]) / Math.hypot(...value.t) ** 3;
      close(signedCrossCurvature, -side * a.second / (1 + a.first ** 2) ** 1.5);
    }
    for (let k = 1; k < list.length; k++) {
      const previous = list[k - 1], next = list[k], left = evaluate(previous, 1), right = evaluate(next, 0);
      close(left.s[1], right.s[1]); close(left.t[1] / previous.h, right.t[1] / next.h);
      close(left.dd[1] / previous.h ** 2, right.dd[1] / next.h ** 2);
    }
  }
  for (const x of [1.1, 10.7, 25.3, 41.2, 59.1]) for (let wall = 0; wall < 2; wall++) {
    const h = .001, a = evaluateWall(model, x, wall);
    close((evaluateWall(model, x + h, wall).value - evaluateWall(model, x - h, wall).value) / (2 * h), a.first, 2e-7);
    close((evaluateWall(model, x + h, wall).value - 2 * a.value + evaluateWall(model, x - h, wall).value) / h ** 2, a.second, 2e-8);
  }
  const cells = wallCells(spans, .02);
  assert.ok(cells.length > 6000 && cells.every(cell => cell.ds > 0 && cell.ds < .0201));
});

test('independent lower/upper roughness is not a reflected wall; zero amplitudes yield parallel straight walls', () => {
  let distinct = 0;
  for (let seed = 0; seed < 20; seed++) {
    const model = createTwoLayerWallModel({ seed });
    const discrepancy = Array.from({ length: 121 }, (_, k) => {
      const x = k / 2;
      return evaluateWall(model, x, 0).value + evaluateWall(model, x, 1).value - 2 * evaluateCentre(model, x).value;
    });
    assert.ok(Math.max(...discrepancy.map(Math.abs)) > .1, 'Walls must not be reflections about the common centre');
    if (seed && model.mu.origin !== createTwoLayerWallModel({ seed: 0 }).mu.origin) distinct++;
  }
  assert.equal(distinct, 19);
  const flat = createTwoLayerWallModel({ sigmaM: 0, sigmaDGeometry: 0 });
  for (let k = 0; k <= 60; k++) for (let wall = 0; wall < 2; wall++) {
    const value = evaluateWall(flat, k, wall);
    assert.equal(value.value, wall ? 21 : 9);
    assert.ok(value.first === 0 && value.second === 0 && value.third === 0);
  }
  assert.deepEqual(twoLayerWallBounds(flat), { xmin: 0, xmax: 60, ymin: 9, ymax: 21, wallRanges: [[9, 9], [21, 21]], minWidth: 12, maxWidth: 12 });
  assert.equal(createWalls().length, 12, 'Legacy reference fixture remains available and unmodified');
});

test('analytic extrema bound dense wall samples and passage width without selecting a rejection policy', () => {
  for (let seed = 0; seed < 40; seed++) {
    const model = createTwoLayerWallModel({ seed }), stats = twoLayerWallBounds(model);
    let sampledMin = Infinity, sampledMax = -Infinity;
    for (let k = 0; k <= 1200; k++) {
      const x = k / 20, lower = evaluateWall(model, x, 0).value, upper = evaluateWall(model, x, 1).value, width = upper - lower;
      assert.ok(lower >= stats.wallRanges[0][0] - 1e-10 && lower <= stats.wallRanges[0][1] + 1e-10);
      assert.ok(upper >= stats.wallRanges[1][0] - 1e-10 && upper <= stats.wallRanges[1][1] + 1e-10);
      assert.ok(width >= stats.minWidth - 1e-10 && width <= stats.maxWidth + 1e-10);
      sampledMin = Math.min(sampledMin, width); sampledMax = Math.max(sampledMax, width);
    }
    assert.ok(sampledMin - stats.minWidth < 1e-3 && stats.maxWidth - sampledMax < 1e-3);
  }
  const squeezed = createTwoLayerWallModel({ sigmaDGeometry: 12 });
  assert.ok(twoLayerWallBounds(squeezed).minWidth < 0, 'Invalid generated attempts are observable, not silently clipped or accepted');
});

test('2000 seeded models reproduce the predicted second-derivative scale within one percent', t => {
  const expected = Math.sqrt(16 / 3 * (6 ** 2 / 20 ** 4 + .33 ** 2 / 4 ** 4));
  let n = 0, sum = 0, sum2 = 0, curvature2 = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const model = createTwoLayerWallModel({ seed });
    for (let x = .25; x < 60; x += .5) for (let wall = 0; wall < 2; wall++) {
      const value = evaluateWall(model, x, wall);
      sum += value.second; sum2 += value.second ** 2;
      curvature2 += value.second ** 2 / (1 + value.first ** 2) ** 3; n++;
    }
  }
  const observed = Math.sqrt(sum2 / n - (sum / n) ** 2), curvatureRms = Math.sqrt(curvature2 / n);
  assert.ok(Math.abs(observed / expected - 1) < .01, `${observed} versus prediction ${expected}`);
  assert.ok(curvatureRms < observed, 'Curvature has the slope denominator; it is not identical to y second derivative');
  t.diagnostic(`2000 seeds, ${n} samples: std(y'')=${observed}, predicted=${expected}, RMS(curvature)=${curvatureRms}`);
});
