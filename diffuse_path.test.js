'use strict';

const assert = require('node:assert/strict');
const {
  buildWallArcTable,
  arcLengthAtSegment,
  pointAtArcLength,
  shiftedPoisson,
  sampleTruncatedArc,
} = require('./diffuse_path.js');

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const wall = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
const table = buildWallArcTable(wall);
assert.equal(table.totalLength, 7);
assert.equal(arcLengthAtSegment(table, 1, 0.5), 5);
assert.deepEqual(pointAtArcLength(table, 5), { x: 3, y: 2, segmentIndex: 1, u: 0.5, arcLength: 5 });

const zero = sampleTruncatedArc(2.5, 7, 0, seededRng(1));
assert.deepEqual(zero, { arcLength: 2.5, deltaS: 0, boundaryResampleCount: 0, attempts: 1 });

const arcRng = seededRng(7);
const samples = Array.from({ length: 20000 }, () => sampleTruncatedArc(50, 100, 1.5, arcRng, 40));
assert.ok(samples.every(Boolean));
const meanDelta = samples.reduce((sum, sample) => sum + sample.deltaS, 0) / samples.length;
const variance = samples.reduce((sum, sample) => sum + (sample.deltaS - meanDelta) ** 2, 0) / samples.length;
assert.ok(Math.abs(meanDelta) < 0.04, `mean delta=${meanDelta}`);
assert.ok(Math.abs(Math.sqrt(variance) - 1.5) < 0.04, `std delta=${Math.sqrt(variance)}`);

const poissonRng = seededRng(19);
const counts = Array.from({ length: 50000 }, () => shiftedPoisson(3.5, poissonRng));
const countMean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
assert.ok(counts.every((value) => Number.isInteger(value) && value >= 1));
assert.ok(Math.abs(countMean - 3.5) < 0.04, `mean count=${countMean}`);
assert.equal(shiftedPoisson(1, seededRng(2)), 1);

console.log(JSON.stringify({
  summary: { passed: 5, failed: 0, total: 5 },
  meanDelta,
  realizedDeltaStd: Math.sqrt(variance),
  realizedPathCountMean: countMean,
}, null, 2));
