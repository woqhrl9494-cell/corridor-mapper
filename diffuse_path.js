/*
 * Pure geometry and sampling helpers for post-channel-estimation diffuse paths.
 * No estimator state, ground truth decision, or future measurement is read here.
 */
(function attachDiffusePath(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DiffusePath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildDiffusePathApi() {
  'use strict';

  const EPS = 1e-12;

  function finitePoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  function buildWallArcTable(polyline) {
    const points = Array.isArray(polyline)
      ? polyline.filter(finitePoint).map((point) => ({ x: point.x, y: point.y }))
      : [];
    if (points.length < 2) return { points, segmentLengths: new Float64Array(0), cumulative: new Float64Array(points.length), totalLength: 0 };
    const segmentLengths = new Float64Array(points.length - 1);
    const cumulative = new Float64Array(points.length);
    for (let index = 0; index < segmentLengths.length; index++) {
      const length = Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
      segmentLengths[index] = length;
      cumulative[index + 1] = cumulative[index] + length;
    }
    return { points, segmentLengths, cumulative, totalLength: cumulative[cumulative.length - 1] };
  }

  function arcLengthAtSegment(table, segmentIndex, fraction) {
    if (!table || !(table.segmentLengths instanceof Float64Array)) return NaN;
    const index = Math.floor(segmentIndex);
    if (index < 0 || index >= table.segmentLengths.length) return NaN;
    const u = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    return table.cumulative[index] + u * table.segmentLengths[index];
  }

  function pointAtArcLength(table, arcLength) {
    if (!table || !Array.isArray(table.points) || table.points.length < 2 || !(table.totalLength > EPS)) return null;
    const s = Number.isFinite(arcLength) ? arcLength : NaN;
    if (!(s >= 0 && s <= table.totalLength)) return null;
    let lo = 0;
    let hi = table.segmentLengths.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (table.cumulative[mid] <= s) lo = mid;
      else hi = mid;
    }
    const segmentIndex = Math.min(table.segmentLengths.length - 1, lo);
    const length = Math.max(EPS, table.segmentLengths[segmentIndex]);
    const u = Math.max(0, Math.min(1, (s - table.cumulative[segmentIndex]) / length));
    const left = table.points[segmentIndex];
    const right = table.points[segmentIndex + 1];
    return {
      x: left.x * (1 - u) + right.x * u,
      y: left.y * (1 - u) + right.y * u,
      segmentIndex,
      u,
      arcLength: s,
    };
  }

  function normalSample(rng) {
    const random = typeof rng === 'function' ? rng : Math.random;
    let u = 0;
    let v = 0;
    while (u <= EPS) u = random();
    while (v <= EPS) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function shiftedPoisson(meanPathCount, rng) {
    const mean = Math.max(1, Number.isFinite(meanPathCount) ? meanPathCount : 1);
    const lambda = mean - 1;
    if (!(lambda > EPS)) return 1;
    const random = typeof rng === 'function' ? rng : Math.random;
    const limit = Math.exp(-lambda);
    let product = 1;
    let count = 0;
    do {
      count++;
      product *= Math.max(0, Math.min(1 - Number.EPSILON, random()));
    } while (product > limit && count < 10000);
    return count;
  }

  function sampleTruncatedArc(specularArc, wallLength, sigmaS, rng, maxAttempts = 40) {
    const center = Number.isFinite(specularArc) ? specularArc : NaN;
    const length = Number.isFinite(wallLength) ? wallLength : NaN;
    const sigma = Math.max(0, Number.isFinite(sigmaS) ? sigmaS : 0);
    if (!(center >= 0 && center <= length && length >= 0)) return null;
    if (!(sigma > EPS)) return { arcLength: center, deltaS: 0, boundaryResampleCount: 0, attempts: 1 };
    const attemptsLimit = Math.max(1, Math.floor(maxAttempts));
    let boundaryResampleCount = 0;
    for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
      const deltaS = sigma * normalSample(rng);
      const candidate = center + deltaS;
      if (candidate >= 0 && candidate <= length) {
        return { arcLength: candidate, deltaS, boundaryResampleCount, attempts: attempt };
      }
      boundaryResampleCount++;
    }
    return null;
  }

  return {
    buildWallArcTable,
    arcLengthAtSegment,
    pointAtArcLength,
    normalSample,
    shiftedPoisson,
    sampleTruncatedArc,
  };
});
