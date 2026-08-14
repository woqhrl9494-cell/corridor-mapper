'use strict';

const assert = require('node:assert/strict');
const {
  samplePolylineArcLength,
  sampleWallsArcLength,
  createObservedMask,
  markObservedGT,
  computeBoundaryMetrics,
} = require('./wall_metrics.js');

const line = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 0 }];
const sampled = samplePolylineArcLength(line, 1, 0);
assert.equal(sampled.length, 6);
for (let index = 1; index < sampled.length; index++) {
  assert.ok(Math.abs(Math.hypot(sampled[index].x - sampled[index - 1].x, sampled[index].y - sampled[index - 1].y) - 1) < 1e-12);
}

const walls = sampleWallsArcLength([
  [{ x: 0, y: 0 }, { x: 4, y: 0 }],
  [{ x: 0, y: 2 }, { x: 4, y: 2 }],
], 0.5);
const observed = createObservedMask(walls);
markObservedGT(walls, observed, [{ x: 1, y: 0 }], 0.55);
const observedCount = observed.reduce((sum, value) => sum + value, 0);
assert.ok(observedCount >= 2 && observedCount <= 3, `observedCount=${observedCount}`);

const perfectPrediction = walls.filter((_, index) => observed[index]);
const perfect = computeBoundaryMetrics(perfectPrediction, walls, observed, 0.1);
assert.equal(perfect.precision, 1);
assert.equal(perfect.recall, 1);
assert.equal(perfect.f1, 1);
assert.ok(perfect.caMsd < 1e-12);
assert.ok(perfect.caHd95 < 1e-12);

const shifted = perfectPrediction.map((point) => ({ x: point.x, y: point.y + 0.3 }));
const strict = computeBoundaryMetrics(shifted, walls, observed, 0.2);
const relaxed = computeBoundaryMetrics(shifted, walls, observed, 0.4);
assert.equal(strict.f1, 0);
assert.equal(relaxed.f1, 1);
assert.ok(Math.abs(relaxed.caMsd - 0.3) < 1e-12, `caMsd=${relaxed.caMsd}`);
assert.ok(Math.abs(relaxed.caHd95 - 0.3) < 1e-12, `caHd95=${relaxed.caHd95}`);

const falseWall = perfectPrediction.concat([{ x: 2, y: 1 }]);
const falseMetrics = computeBoundaryMetrics(falseWall, walls, observed, 0.1);
assert.ok(falseMetrics.precision < 1);
assert.equal(falseMetrics.recall, 1);

console.log(JSON.stringify({
  summary: { passed: 5, failed: 0, total: 5 },
  arcSamples: sampled.length,
  observedCount,
  perfect,
  strict,
  relaxed,
  falseMetrics,
}, null, 2));
