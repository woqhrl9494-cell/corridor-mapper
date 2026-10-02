/** Evaluation only: truth never goes back to field.mjs.
 * Input: emitted truth through t and the field at t. Output: corridor proxy and metrics.
 * The outer-peak readout uses a corridor prior; it is not a final wall extractor.
 */
import '../wall_metrics.js';
import { evaluate as wallPoint } from './wall.mjs';
const metrics = globalThis.WallMetrics;
export const percentile = (values, p) => {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.max(0, Math.min(a.length - 1, Math.ceil(p * a.length) - 1))];
};
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
export function outerPeak(field, grid, eta = 0.5) {
  const { nx, ny, x, y } = grid, proxy = [], byColumn = [Array(nx).fill(null), Array(nx).fill(null)];
  for (let ix = 0; ix < nx; ix++) for (let wall = 0; wall < 2; wall++) {
    let maximum = 0;
    for (let iy = 0; iy < ny; iy++) if ((y[iy] < 15 ? 0 : 1) === wall) maximum = Math.max(maximum, field[iy * nx + ix]);
    if (!(maximum > 0)) continue;
    const candidates = [];
    for (let iy = 1; iy < ny - 1; iy++) {
      if ((y[iy] < 15 ? 0 : 1) !== wall) continue;
      const a = field[(iy - 1) * nx + ix], b = field[iy * nx + ix], c = field[(iy + 1) * nx + ix];
      if (b >= eta * maximum && b >= a && b >= c && (b > a || b > c)) candidates.push(iy);
    }
    if (!candidates.length) continue;
    const iy = wall === 0 ? candidates[0] : candidates.at(-1);
    const a = field[(iy - 1) * nx + ix], b = field[iy * nx + ix], c = field[(iy + 1) * nx + ix], curvature = a - 2 * b + c;
    const offset = curvature < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / curvature)) : 0;
    const point = [x[ix], y[iy] + offset * grid.dy];
    byColumn[wall][ix] = point; proxy.push(point);
  }
  return { proxy, byColumn };
}
function graphY(wall, x, spans, wallIndex) {
  if (spans) {
    const span = spans.find(s => s.wall === wallIndex && x >= s.C[0][0] && x <= s.C[0][0] + s.h);
    if (span) return wallPoint(span, (x - span.C[0][0]) / span.h).s[1];
  }
  let lo = 0, hi = wall.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (wall[mid][0] <= x) lo = mid; else hi = mid; }
  const a = wall[lo], b = wall[hi], fraction = (x - a[0]) / (b[0] - a[0]);
  return a[1] + fraction * (b[1] - a[1]);
}
/** Evaluation wall samples are independent of the grid; no tolerance is tuned on truth. */
export function createEvaluator(scenario, grid) {
  const gt = metrics.sampleWallsArcLength(scenario.walls.map(w => w.map(([x, y]) => ({ x, y }))), 0.2);
  const mask = metrics.createObservedMask(gt), specColumns = [new Uint8Array(grid.nx), new Uint8Array(grid.nx)];
  const ratios = [], counts = [], predictedCounts = [], folds = [], duplicateFlags = [];
  let cursor = 0, specularCount = 0, diffuseCount = 0, degenerate = 0;
  return {
    step(frame) {
      if (!Number.isInteger(frame.t) || frame.t < cursor || frame.t > scenario.truth.length) throw new Error('Evaluation snapshots must be causal and monotone');
      while (cursor < frame.t) {
        const snapshot = scenario.truth[cursor++], hits = [];
        for (const config of snapshot.configs) {
          const spec = config.specular, diff = config.diffuse;
          specularCount += spec.length; diffuseCount += diff.length; counts.push(diff.length);
          let countPrediction = 0;
          for (const q of [...spec, ...diff]) hits.push({ x: q.s[0], y: q.s[1] });
          for (const q of spec) {
            const wall = q.wall ?? (q.span <= 6 ? 0 : 1);
            for (let ix = 0; ix < grid.nx; ix++) if (Math.abs(grid.x[ix] - q.s[0]) <= 0.4) specColumns[wall][ix] = 1;
            if (scenario.input.roughness > 0 && Math.abs(q.dkap) > 1e-9) countPrediction += scenario.input.lambda0 * Math.sqrt(2 * Math.PI) * scenario.input.roughness * Math.PI / 180 / Math.abs(q.dkap);
            const sigmaR = Math.sqrt(scenario.input.sigmaD ** 2 + 2 * scenario.input.sigmaP ** 2);
            if (q.cth > 1e-9) folds.push(0.765 * Math.SQRT2 * sigmaR / (2 * q.cth));
          }
          predictedCounts.push(countPrediction);
          for (const q of diff) {
            duplicateFlags.push(spec.some(s => Math.abs(s.rho - q.rho) <= scenario.input.sigmaD) ? 1 : 0);
            const wall = q.wall ?? (q.span <= 6 ? 0 : 1), sameWall = spec.filter(s => (s.wall ?? (s.span <= 6 ? 0 : 1)) === wall);
            const nearest = sameWall.reduce((best, s) => !best || Math.hypot(s.s[0] - q.s[0], s.s[1] - q.s[1]) < Math.hypot(best.s[0] - q.s[0], best.s[1] - q.s[1]) ? s : best, null);
            if (!nearest) continue;
            if (Math.abs(nearest.dkap) <= 1e-9 || scenario.input.roughness === 0) { degenerate++; continue; }
            const sigma = scenario.input.roughness * Math.PI / 180;
            if (Math.abs(q.s[0] - nearest.s[0]) <= 4 * sigma / Math.abs(nearest.dkap)) {
              const varsigma = nearest.cth * sigma ** 2 / nearest.dkap;
              if (Math.abs(varsigma) > 1e-15) ratios.push((q.rho - nearest.rho) / varsigma);
            }
          }
        }
        metrics.markObservedGT(gt, mask, hits, 1.0);
      }
      const { proxy, byColumn } = outerPeak(frame.Dbar, grid), errors = [], offsets = [];
      let observedColumns = 0, totalColumns = 0, missing = 0;
      for (let ix = 0; ix < grid.nx; ix++) {
        if (grid.x[ix] < 10 || grid.x[ix] > 50) continue;
        for (let wall = 0; wall < 2; wall++) {
          totalColumns++; if (!specColumns[wall][ix]) continue;
          observedColumns++;
          const referenceY = graphY(scenario.walls[wall], grid.x[ix], scenario.spans, wall);
          const point = byColumn[wall][ix];
          // Missing observed predictions count as failures rather than silently improving errors.
          if (point) errors.push(Math.abs(point[1] - referenceY)); else { errors.push(Infinity); missing++; }
          let peak = -1, peakValue = 0;
          for (let iy = 0; iy < grid.ny; iy++) if (Math.abs(grid.y[iy] - referenceY) <= 1.5 && frame.Dbar[iy * grid.nx + ix] > peakValue) {
            peak = iy; peakValue = frame.Dbar[iy * grid.nx + ix];
          }
          if (peak >= 0) offsets.push((wall === 0 ? 1 : -1) * (grid.y[peak] - referenceY));
        }
      }
      const boundary = metrics.computeBoundaryMetrics(proxy.map(([x, y]) => ({ x, y })), gt, mask, 0.4);
      const observed = gt.filter((_, k) => mask[k]).map(p => [p.x, p.y]);
      return { t: frame.t, proxy, observed, medianError: percentile(errors, 0.5), p95: percentile(errors, 0.95),
        offwall: errors.length ? errors.filter(x => x > 0.5).length / errors.length : null,
        offset: mean(offsets), observedColumns, observedFraction: totalColumns ? observedColumns / totalColumns : 0, missing,
        ...boundary, diagnostics: { specularCount, diffuseCount, configurationCount: counts.length,
          diffusePerConfig: mean(counts), duplicateFraction: mean(duplicateFlags),
          theoremMean: mean(ratios), theoremMedian: percentile(ratios, 0.5), theoremNegative: ratios.filter(x => x < 0).length,
          ratios: ratios.slice(), diffuseCounts: counts.slice(), predictedCounts: predictedCounts.slice(),
          foldPrediction: mean(folds), degenerate },
      };
    },
  };
}
export function snapshotCsv(frames, evaluations) {
  const keys = ['snapshot', 'Q', 'admitted', 'rejected', 'median_abs_error_m', 'p95_m', 'offwall_fraction', 'signed_offset_m', 'f1', 'ca_msd_m', 'ca_hd95_m', 'field_ms'];
  const rows = frames.map((frame, k) => {
    const e = evaluations[k];
    return [frame.t, frame.Q, frame.admitted, frame.rejected, e?.medianError, e?.p95, e?.offwall, e?.offset, e?.f1, e?.caMsd, e?.caHd95, frame.ms];
  });
  return '\ufeff' + [keys, ...rows].map(row => row.map(v => typeof v === 'number' && !Number.isFinite(v) ? '' : v ?? '').join(',')).join('\r\n') + '\r\n';
}
