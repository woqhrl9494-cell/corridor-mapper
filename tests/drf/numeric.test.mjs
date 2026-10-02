import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../drf/rng.mjs';
import { realRoots, rootInfo, multiply, powerToBernstein, subdivideBernstein, evaluatePolynomial } from '../../drf/poly.mjs';
import { createWalls, evaluate, makeSpan, graphSpans, bsplineSpans, notAKnot, wallCells } from '../../drf/wall.mjs';
import { specularPoints, specularPolynomial, refineSpecularRoot, facetSinDelta, sameSide, visible } from '../../drf/specular.mjs';
import { diffuseProfile, sampleDiffuse } from '../../drf/diffuse.mjs';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const radians = degrees => degrees * Math.PI / 180;
const flat = () => ({ ...makeSpan([[-60, 0], [120, 0], [0, 0], [0, 0]], 1, 0, true), h: 120 });

test('not-a-knot coefficients agree with all 12 supplied spans; random walls remain a corridor', () => {
  const lower = [
    [-.00263095238095238, .103928571428571, -.976190476190476, 8],
    [-.00263095238095238, .025, .313095238095238, 6],
    [.00365476190476191, -.0539285714285714, .0238095238095239, 9],
    [-.00348809523809524, .0557142857142857, .0416666666666667, 7.5],
    [.00179761904761905, -.0489285714285714, .10952380952381, 10],
    [.00179761904761905, .005, -.329761904761905, 8],
  ];
  const upper = [
    [.00307142857142857, -.117142857142857, 1.06428571428571, 22],
    [.00307142857142857, -.025, -.357142857142857, 24],
    [-.00485714285714286, .0671428571428571, .0642857142857143, 21],
    [.00485714285714286, -.0785714285714286, -.05, 23.5],
    [-.00257142857142857, .0671428571428571, -.164285714285714, 20],
    [-.00257142857142857, -.01, .407142857142857, 22.5],
  ];
  for (const [y, expected] of [[[8, 6, 9, 7.5, 10, 8, 7], lower], [[22, 24, 21, 23.5, 20, 22.5, 23], upper]]) {
    const actual = notAKnot([0, 10, 20, 30, 40, 50, 60], y);
    actual.forEach((row, i) => row.forEach((value, j) => close(value, expected[i][j], 1e-12)));
  }
  for (let seed = 0; seed < 50; seed++) for (const span of createWalls({ scene: 'random', seed })) {
    for (let i = 0; i <= 50; i++) {
      const y = evaluate(span, i / 50).s[1];
      assert.ok(span.wall === 0 ? y < 12 : y > 18);
    }
  }
});

test('Bernstein roots include repeated and boundary roots and report degeneracy', () => {
  const p = multiply(multiply([-.123456789, 1], [-.123456789, 1]), [-.85, 1]);
  const info = rootInfo(p);
  assert.equal(info.roots.length, 2); close(info.roots[0], .123456789, 1e-12); close(info.roots[1], .85, 1e-12);
  assert.ok(info.nearMultiple > 0);
  assert.deepEqual(realRoots([0, -1, 1]), [0, 1]);
  assert.equal(rootInfo([0, 0, 0]).degenerate, true);
  assert.deepEqual(realRoots([1, 0, 1]), []);
  const b = powerToBernstein([1, 2, 3]), [left, right] = subdivideBernstein(b);
  close(left.at(-1), evaluatePolynomial([1, 2, 3], .5), 1e-15); close(right[0], left.at(-1), 1e-15);
  const boundary = graphSpans([-60, 0, 30, 60], [0, 0, 0, 0]);
  const points = specularPoints(boundary, [-3, 4], [3, 4]);
  assert.equal(points.length, 1); close(points[0].s[0], 0, 1e-12); assert.equal(points[0].span, 2);
  assert.equal(visible([flat()], [0, 1], [0, -1]), false);
  assert.equal(visible([flat()], [-3, 0], [3, 0]), false);
});

test('t=30 specular fixtures: four visible roots, geometry and signed curvature', () => {
  const spans = createWalls(), pT = [26.5, 15.5276039972134], pR = [32.5, 14.2544345273238];
  const points = specularPoints(spans, pT, pR);
  const expected = [
    [4, .0811873434988399, 30.811873434988, 7.568684880199, 15.947466042164, .931633800345, .026755440582],
    [9, .637701005930427, 26.377010059304, 22.880800710428, 17.932750595116, .955255473335, .065867209226],
    [10, .0566001331171416, 30.566001331171, 23.447409697095, 18.296774402865, .942477303710, -.033832564015],
    [10, .246120222914435, 32.461202229144, 22.973406210189, 18.257186887995, .942827330063, .031567368684],
  ];
  assert.equal(points.length, 4);
  points.forEach((p, i) => {
    assert.equal(p.span, expected[i][0]);
    [p.u, ...p.s, p.rho, p.cth, p.dkap].forEach((value, j) => close(value, expected[i][j + 1]));
    assert.ok(visible(spans, pT, p.s) && visible(spans, pR, p.s));
  });
  assert.equal(points.diagnostics.unresolved, 0);
  const profile = diffuseProfile(spans, pT, pR, radians(2), 10, .02, { partition: 'x' });
  close(profile.lambdaTotal[0], 31.416105407464, 1e-12); close(profile.lambdaTotal[1], 53.153918989339, 1e-12);
});

test('near-caustic Newton does not wander and reports an uncertified root count', () => {
  const pT = [-1, 1], pR = [1, 1];
  for (const perturbation of [1e-12, 1e-14, 1e-15]) {
    const k = .25 + perturbation;
    const span = makeSpan([[-.5, k / 4], [1, -k], [0, k], [0, 0]], 1, 0, true);
    // For y=k*x^2, P=2*x*((4*k-1)-k*x^2-2*k^3*x^4).
    // Three stationary points exist; Float64 subdivision may merge their cluster.
    const z = 2 * (4 * k - 1) / (k + Math.sqrt(k * k + 8 * k ** 3 * (4 * k - 1)));
    const exactRoots = [.5 - Math.sqrt(z), .5, .5 + Math.sqrt(z)];
    assert.ok(z > 0 && exactRoots.every(u => u > 0 && u < 1));
    for (const u of exactRoots) {
      const { s } = evaluate(span, u);
      assert.ok(visible([span], pT, s) && visible([span], pR, s));
    }
    const points = specularPoints([span], pT, pR);
    assert.ok(points.diagnostics.nearMultiple > 0);
    assert.ok(points.diagnostics.unresolved > 0, 'merged roots cannot certify a complete count');
    for (const point of points) {
      const { t } = evaluate(span, point.u);
      assert.ok(Math.abs(point.u - .5) < 1e-4, 'Newton must remain in the near-caustic cluster');
      assert.ok(Math.abs(facetSinDelta(t, point.s, pT, pR)) <= 64 * Number.EPSILON);
    }
  }
});

function facetDelta(x, pT, pR) {
  const a = [pT[0] - x, pT[1]], b = [pR[0] - x, pR[1]], ra = Math.hypot(...a), rb = Math.hypot(...b);
  const difference = [b[0] / rb - a[0] / ra, b[1] / rb - a[1] / ra];
  return Math.asin(difference[1] / Math.hypot(...difference));
}
test('flat-wall derivative and diffuse integrals match supplied fixtures', () => {
  const spans = [flat()], pT = [-3, 4], pR = [5, 3], [point] = specularPoints(spans, pT, pR), x = 11 / 7;
  close(point.s[0], x, 1e-12); close(point.cth, .658504607869, 1e-12); close(point.dkap, .126474926254, 1e-12);
  const h = 1e-4;
  close((facetDelta(x + h, pT, pR) - facetDelta(x - h, pT, pR)) / (2 * h), point.dkap, 1e-8);
  for (const [degrees, integral, prediction] of [[1, .345547, .345910], [2, .688955, .691820], [5, 1.688328, 1.729549]]) {
    const profile = diffuseProfile(spans, pT, pR, radians(degrees), 1, .002, { partition: 'x' });
    close(profile.lambdaTotal[0], integral, 5e-7);
    close(Math.sqrt(2 * Math.PI) * radians(degrees) / point.dkap, prediction, 5e-7);
  }
  assert.deepEqual(diffuseProfile(spans, pT, pR, 0, 10, .02).cells, []);
  const cells = wallCells(createWalls(), .02);
  assert.ok(cells.every(c => c.ds > 0 && c.ds < .0201));
});

test('xoshiro streams reproduce, normal and Poisson moments, per-wall categorical sampling', () => {
  const a = createRng(123, 'pose', 1, 2), b = createRng(123, 'pose', 1, 2), independent = createRng(123, 'specNoise', 1, 2);
  for (let i = 0; i < 100; i++) assert.equal(a.normal(), b.normal());
  assert.notEqual(a.uniform(), independent.uniform());
  const rng = createRng(71, 'moments'), n = 20000;
  for (const [name, mean, expectedVariance, draw] of [
    ['normal', 0, 1, () => rng.normal()], ['poisson7', 7, 7, () => rng.poisson(7)], ['poisson37', 37, 37, () => rng.poisson(37)],
  ]) {
    let sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) { const x = draw(); sum += x; sum2 += x * x; }
    const observedMean = sum / n, variance = sum2 / n - observedMean ** 2;
    assert.ok(Math.abs(observedMean - mean) < 6 * Math.sqrt(expectedVariance / n), `${name} mean ${observedMean}`);
    assert.ok(Math.abs(variance - expectedVariance) < .05 * expectedVariance, `${name} variance ${variance}`);
  }
  const spans = [flat()], profile = { cells: [{ u: .2, du: 0, span: 1, wall: 0, lambda: 1 }, { u: .8, du: 0, span: 1, wall: 0, lambda: 3 }], lambdaTotal: [4, 9999] };
  let count = 0, left = 0;
  for (let i = 0; i < 2000; i++) for (const point of sampleDiffuse(spans, [-3, 4], [5, 3], profile, rng)) { count++; if (point.u < .5) left++; }
  assert.ok(Math.abs(count / 2000 - 4) < .2); assert.ok(Math.abs(left / count - .25) < .025);
  assert.equal(rng.poisson(0), 0); assert.throws(() => rng.poisson(-1));
});

test('closed 24-control B-spline: 300 interior pairs match independent physical-residual brackets', t => {
  const controls = Array.from({ length: 24 }, (_, i) => {
    const theta = i * 2 * Math.PI / 24, r = 10 * (1 + .45 * Math.sin(3 * theta + .4) + .2 * Math.cos(5 * theta) + .1 * Math.sin(8 * theta));
    return [r * Math.cos(theta), r * Math.sin(theta)];
  });
  const spans = bsplineSpans(controls), rng = createRng(20261001, 'root-brute'), started = performance.now();
  let count = 0, maxError = 0, maxSin = 0;
  const point = () => { const angle = 2 * Math.PI * rng.uniform(), radius = 2 * Math.sqrt(rng.uniform()); return [radius * Math.cos(angle), radius * Math.sin(angle)]; };
  for (let pair = 0; pair < 300; pair++) {
    const pT = point(), pR = point();
    for (const span of spans) {
      const residual = u => {
        const { s, t: tangent } = evaluate(span, u), a = [s[0] - pT[0], s[1] - pT[1]], b = [s[0] - pR[0], s[1] - pR[1]], ra = Math.hypot(...a), rb = Math.hypot(...b);
        return tangent[0] * (a[0] / ra + b[0] / rb) + tangent[1] * (a[1] / ra + b[1] / rb);
      };
      const brute = [];
      let previous = residual(0);
      for (let k = 1; k <= 512; k++) {
        let lo = (k - 1) / 512, hi = k / 512, current = residual(hi);
        if (previous * current < 0) {
          let flo = previous;
          for (let iteration = 0; iteration < 45; iteration++) {
            const mid = (lo + hi) / 2, value = residual(mid);
            if (Math.sign(value) === Math.sign(flo)) { lo = mid; flo = value; } else hi = mid;
          }
          const u = (lo + hi) / 2, value = evaluate(span, u);
          if (sameSide(value.t, value.s, pT, pR)) brute.push(u);
        }
        previous = current;
      }
      const roots = realRoots(specularPolynomial(span, pT, pR)).filter(u => { const value = evaluate(span, u); return u < 1 && sameSide(value.t, value.s, pT, pR); }).map(u => refineSpecularRoot(span, u, pT, pR));
      assert.equal(roots.length, brute.length, `pair=${pair} span=${span.span}`);
      roots.forEach((u, i) => {
        const error = Math.abs(u - brute[i]); maxError = Math.max(maxError, error); assert.ok(error <= 1e-9);
        const { s, t: tangent } = evaluate(span, u), sine = Math.abs(facetSinDelta(tangent, s, pT, pR));
        maxSin = Math.max(maxSin, sine);
        assert.ok(sine <= 1e-12, JSON.stringify({ pair, span: span.span, u, sine, pT, pR }));
      });
      count += roots.length;
    }
  }
  t.diagnostic(`300 pairs: ${count}/${count} roots; max |du|=${maxError}; max |sin delta|=${maxSin}; ${((performance.now() - started) / 1000).toFixed(3)} s; own seed, not the unavailable Octave pair list`);
});
