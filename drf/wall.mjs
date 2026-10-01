import { createRng } from './rng.mjs';

/** Not-a-knot cubic spline. Input x,y: n scalars; output: n-1 local
 * [c3,c2,c1,c0] spans. O(n^3), n=7 in the reference scene. */
export function notAKnot(x, y) {
  const n = x.length;
  if (n < 4 || y.length !== n || !x.every(Number.isFinite) || !y.every(Number.isFinite)) throw new TypeError('Spline requires matching finite arrays with >= 4 knots');
  const h = x.slice(1).map((value, i) => value - x[i]);
  if (h.some(value => value <= 0)) throw new RangeError('Spline knots must increase');
  const a = Array.from({ length: n }, () => Array(n + 1).fill(0));
  a[0][0] = -h[1]; a[0][1] = h[0] + h[1]; a[0][2] = -h[0];
  for (let i = 1; i < n - 1; i++) {
    a[i][i - 1] = h[i - 1]; a[i][i] = 2 * (h[i - 1] + h[i]); a[i][i + 1] = h[i];
    a[i][n] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
  }
  a[n - 1][n - 3] = -h[n - 2]; a[n - 1][n - 2] = h[n - 3] + h[n - 2]; a[n - 1][n - 1] = -h[n - 3];
  // ponytail: dense solve for seven knots; use a banded solver if knot count grows.
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const diagonal = a[k][k];
    for (let j = k; j <= n; j++) a[k][j] /= diagonal;
    for (let i = k + 1; i < n; i++) {
      const factor = a[i][k];
      for (let j = k; j <= n; j++) a[i][j] -= factor * a[k][j];
    }
  }
  const second = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) second[i] = a[i][n] - a[i].slice(i + 1, n).reduce((sum, value, j) => sum + value * second[i + j + 1], 0);
  return h.map((width, i) => [(second[i + 1] - second[i]) / (6 * width), second[i] / 2,
    (y[i + 1] - y[i]) / width - width * (2 * second[i] + second[i + 1]) / 6, y[i]]);
}
export function makeSpan(C, span, wall = 0, last = false) {
  const controls = [C[0], C[0].map((v, d) => v + C[1][d] / 3),
    C[0].map((v, d) => v + 2 * C[1][d] / 3 + C[2][d] / 3), C[0].map((v, d) => v + C[1][d] + C[2][d] + C[3][d])];
  return { C, span, wall, last, aabb: [Math.min(...controls.map(p => p[0])), Math.min(...controls.map(p => p[1])), Math.max(...controls.map(p => p[0])), Math.max(...controls.map(p => p[1]))] };
}
export function graphSpans(x, y, wall = 0, firstSpan = 1) {
  return notAKnot(x, y).map(([c3, c2, c1, c0], i) => {
    const h = x[i + 1] - x[i];
    return { ...makeSpan([[x[i], c0], [h, c1 * h], [0, c2 * h * h], [0, c3 * h ** 3]], firstSpan + i, wall, i === x.length - 2), h };
  });
}
export function bsplineSpans(points, { closed = true, wall = 0, firstSpan = 1 } = {}) {
  const M = [[1, 4, 1, 0], [-3, 0, 3, 0], [3, -6, 3, 0], [-1, 3, -3, 1]], count = closed ? points.length : points.length - 3;
  return Array.from({ length: count }, (_, k) => {
    const C = M.map(row => [0, 1].map(d => row.reduce((sum, value, j) => sum + value * points[(k + j) % points.length][d] / 6, 0)));
    return makeSpan(C, firstSpan + k, wall, !closed && k === count - 1);
  });
}
export function createWalls({ scene = 'reference', seed = 1 } = {}) {
  const x = [0, 10, 20, 30, 40, 50, 60], lower = [8, 6, 9, 7.5, 10, 8, 7], upper = [22, 24, 21, 23.5, 20, 22.5, 23];
  if (scene === 'random') {
    const rng = createRng(seed, 'wall');
    // Exploratory scene only: bounded knot perturbations, not an Octave fixture.
    for (let i = 0; i < x.length; i++) { lower[i] += rng.uniform() - 0.5; upper[i] += rng.uniform() - 0.5; }
  } else if (scene !== 'reference') throw new RangeError('Unknown corridor scene');
  return [...graphSpans(x, lower, 0, 1), ...graphSpans(x, upper, 1, 7)];
}
export function evaluate(span, u) {
  const { C } = span;
  return {
    s: [0, 1].map(d => ((C[3][d] * u + C[2][d]) * u + C[1][d]) * u + C[0][d]),
    t: [0, 1].map(d => (3 * C[3][d] * u + 2 * C[2][d]) * u + C[1][d]),
    dd: [0, 1].map(d => 6 * C[3][d] * u + 2 * C[2][d]),
  };
}
const cache = new WeakMap();
/** Geometry-only quadrature cells, reused across configurations. */
export function wallCells(spans, step, partition = 'arc') {
  if (!(Number.isFinite(step) && step > 0)) throw new RangeError('Cell step must be positive');
  let stored = cache.get(spans);
  if (!stored) { stored = new Map(); cache.set(spans, stored); }
  const key = `${partition}:${step}`;
  if (stored.has(key)) return stored.get(key);
  const cells = [];
  for (const span of spans) {
    let boundaries;
    if (partition === 'x') {
      if (!span.h) throw new RangeError('x partition requires graph spans');
      const n = Math.ceil(span.h / step);
      boundaries = Array.from({ length: n + 1 }, (_, i) => Math.min(1, i * step / span.h));
    } else if (partition === 'arc') {
      const lengthBound = span.C.slice(1).reduce((sum, row, i) => sum + (i + 1) * Math.hypot(...row), 0);
      const n = Math.max(32, Math.ceil(lengthBound / step)), arc = new Float64Array(n + 1);
      const speed = u => Math.hypot(...evaluate(span, u).t);
      for (let i = 0; i < n; i++) arc[i + 1] = arc[i] + (speed(i / n) + 4 * speed((i + 0.5) / n) + speed((i + 1) / n)) / (6 * n);
      const count = Math.ceil(arc[n] / step);
      let index = 0;
      boundaries = Array.from({ length: count + 1 }, (_, i) => {
        const target = i * arc[n] / count;
        while (index < n - 1 && arc[index + 1] < target) index++;
        return (index + (target - arc[index]) / (arc[index + 1] - arc[index])) / n;
      });
      boundaries[0] = 0; boundaries[count] = 1;
    } else throw new RangeError('Unknown cell partition');
    for (let i = 0; i < boundaries.length - 1; i++) {
      const du = boundaries[i + 1] - boundaries[i], u = (boundaries[i + 1] + boundaries[i]) / 2, value = evaluate(span, u);
      cells.push({ ...value, u, du, ds: Math.hypot(...value.t) * du, span: span.span, wall: span.wall });
    }
  }
  stored.set(key, cells);
  return cells;
}
export function sampleWalls(spans, step = 0.1) {
  const walls = Array.from({ length: Math.max(...spans.map(s => s.wall)) + 1 }, () => []);
  for (const cell of wallCells(spans, step)) walls[cell.wall].push(cell.s);
  for (const wall of walls.keys()) {
    const list = spans.filter(s => s.wall === wall);
    if (list.length) { walls[wall].unshift(evaluate(list[0], 0).s); walls[wall].push(evaluate(list.at(-1), 1).s); }
  }
  return walls;
}
