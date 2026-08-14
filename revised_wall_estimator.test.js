'use strict';

const assert = require('node:assert/strict');
const {
  RevisedEstimator,
  makeKernel,
} = require('./revised_wall_estimator.js');

const results = [];

function run(name, fn) {
  const t0 = performance.now();
  try {
    const detail = fn() || {};
    results.push({ name, status: 'PASS', ms: performance.now() - t0, ...detail });
  } catch (error) {
    results.push({ name, status: 'FAIL', ms: performance.now() - t0, error: error.stack || String(error) });
  }
}

function measurement(d, sigmaD = 0.1, poseVariance = 0.01) {
  return {
    i: 0,
    j: 1,
    m: 0,
    pI: { x: 10, y: 15 },
    pJ: { x: 20, y: 15 },
    SigmaI: [poseVariance, 0, poseVariance],
    SigmaJ: [poseVariance, 0, poseVariance],
    d,
    sigmaD,
  };
}

function normalVariance(mode) {
  const eig = (() => {
    const tr = mode.N00 + mode.N11;
    const disc = Math.sqrt(Math.max(0, (mode.N00 - mode.N11) ** 2 + 4 * mode.N01 ** 2));
    const lambda = 0.5 * (tr + disc);
    let x = mode.N01;
    let y = lambda - mode.N00;
    if (x * x + y * y < 1e-14) {
      if (mode.N00 >= mode.N11) { x = 1; y = 0; }
      else { x = 0; y = 1; }
    }
    const n = Math.hypot(x, y);
    return [x / n, y / n];
  })();
  return mode.P00 * eig[0] ** 2 + 2 * mode.P01 * eig[0] * eig[1] + mode.P11 * eig[1] ** 2;
}

function ingestLine(estimator, snapshot, y, angle = Math.PI / 2, x0 = 4, x1 = 56, step = 0.75, weight = 1) {
  const kernels = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) kernels.push(makeKernel(x, y, angle, 0.75, 0.16, weight));
  estimator.debugIngestKernels(snapshot, kernels);
}

function ridgeYClusters(grid, tolerance = 0.65) {
  const ys = grid.ridgePoints.map((point) => point.y).sort((a, b) => a - b);
  const clusters = [];
  for (const y of ys) {
    const last = clusters.at(-1);
    if (!last || y - last.max > tolerance) clusters.push({ min: y, max: y, n: 1 });
    else { last.max = y; last.n++; }
  }
  return clusters;
}

run('1 nominal path admission', () => {
  const estimator = new RevisedEstimator({ KMode: 4 });
  const accepted = estimator.updateSnapshot(0, [measurement(12)]);
  const rejected = estimator.updateSnapshot(1, [measurement(10), measurement(9.9)]);
  assert.equal(accepted.admittedPaths, 1);
  assert.equal(accepted.nominallyRejectedPaths, 0);
  assert.equal(rejected.admittedPaths, 0);
  assert.equal(rejected.nominallyRejectedPaths, 2);
  assert.equal(rejected.totalEllipseSamples, 0);
  return { admitted: accepted.admittedPaths, rejected: rejected.nominallyRejectedPaths };
});

run('2 uncertainty monotonicity', () => {
  const low = new RevisedEstimator({ KMode: 4 });
  const highRange = new RevisedEstimator({ KMode: 4 });
  const highPose = new RevisedEstimator({ KMode: 4 });
  low.updateSnapshot(0, [measurement(14, 0.05, 0.0025)]);
  highRange.updateSnapshot(0, [measurement(14, 0.40, 0.0025)]);
  highPose.updateSnapshot(0, [measurement(14, 0.05, 0.09)]);
  const v0 = normalVariance(low.exportModes()[0]);
  const vr = normalVariance(highRange.exportModes()[0]);
  const vp = normalVariance(highPose.exportModes()[0]);
  assert.ok(vr >= v0 - 1e-12, `${vr} < ${v0}`);
  assert.ok(vp >= v0 - 1e-12, `${vp} < ${v0}`);
  return { base: v0, rangeNoise: vr, poseNoise: vp };
});

run('3 zero-noise positive definiteness', () => {
  const estimator = new RevisedEstimator({ sigmaModel: 0.08, cS: 0.5 });
  estimator.updateSnapshot(0, [measurement(14, 0, 0)]);
  const determinants = estimator.exportModes().map((mode) => mode.determinant);
  assert.ok(determinants.length > 0);
  assert.ok(determinants.every((value) => value > 0));
  return { minDeterminant: Math.min(...determinants) };
});

run('4 arc-coverage ripple', () => {
  const spacing = 1;
  const sigma = 0.5 * spacing;
  const samples = 2000;
  let minValue = Infinity;
  let maxValue = -Infinity;
  let sum = 0;
  for (let n = 0; n < samples; n++) {
    const x = spacing * n / samples;
    let value = 0;
    for (let k = -8; k <= 8; k++) value += Math.exp(-0.5 * ((x - k * spacing) / sigma) ** 2);
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
    sum += value;
  }
  const ripple = (maxValue - minValue) / (sum / samples);
  assert.ok(ripple < 0.035, `ripple=${ripple}`);
  return { peakToPeakRipple: ripple };
});

run('5 visibility-off mass', () => {
  const estimator = new RevisedEstimator({ useVisibility: false, KMode: 6 });
  const diagnostics = estimator.updateSnapshot(0, [measurement(14)]);
  const mass = estimator.exportModes().reduce((sum, mode) => sum + mode.W, 0);
  assert.ok(Math.abs(mass - 1) < 1e-12, `mass=${mass}`);
  assert.equal(diagnostics.visibilityMean, 1);
  return { mass };
});

run('6 distinct-snapshot persistence', () => {
  const estimator = new RevisedEstimator({ cellSize: 2, KMode: 3, HConf: 2, tauB: 8 });
  const kernels = Array.from({ length: 50 }, (_, index) => makeKernel(10 + 0.002 * index, 10, Math.PI / 2, 0.75, 0.15, 0.02));
  estimator.debugIngestKernels(0, kernels);
  assert.equal(estimator.exportModes()[0].H, 1);
  estimator.debugIngestKernels(1, kernels);
  assert.equal(estimator.exportModes()[0].H, 2);
  return { H: estimator.exportModes()[0].H, kernelsPerSnapshot: kernels.length };
});

run('7 long-run state bound', () => {
  const KMode = 3;
  const estimator = new RevisedEstimator({ cellSize: 1, KMode, HConf: 3 });
  for (let t = 0; t < 200; t++) {
    const kernels = [];
    for (let n = 0; n < 120; n++) {
      const x = ((17 * n + 3 * t) % 600) / 10;
      const y = ((29 * n + 7 * t) % 300) / 10;
      kernels.push(makeKernel(x, y, (n % 4) * Math.PI / 4, 0.65, 0.14, 0.01));
    }
    const d = estimator.debugIngestKernels(t, kernels);
    assert.ok(d.localModes <= d.representedCells * KMode);
  }
  const d = estimator.getDiagnostics();
  return { modes: d.localModes, cells: d.representedCells, bound: d.representedCells * KMode };
});

run('8 analytic Gaussian derivatives', () => {
  const estimator = new RevisedEstimator({ cellSize: 2, KMode: 3, HConf: 1 });
  estimator.debugIngestKernels(0, [
    makeKernel(10, 10, Math.PI / 2, 0.8, 0.2, 0.7),
    makeKernel(10.4, 10.1, Math.PI / 2 + 0.08, 0.7, 0.18, 0.5),
  ]);
  const seed = [...estimator.cells.values()][0][0];
  const neighbors = estimator._neighbors(seed);
  const x = 10.17;
  const y = 10.08;
  const h = 1e-4;
  const f = (px, py) => estimator.evaluateModeField(px, py, neighbors).g;
  const value = estimator.evaluateModeField(x, y, neighbors);
  const gx = (f(x + h, y) - f(x - h, y)) / (2 * h);
  const gy = (f(x, y + h) - f(x, y - h)) / (2 * h);
  const hxx = (f(x + h, y) - 2 * f(x, y) + f(x - h, y)) / (h * h);
  const hyy = (f(x, y + h) - 2 * f(x, y) + f(x, y - h)) / (h * h);
  const hxy = (f(x + h, y + h) - f(x + h, y - h) - f(x - h, y + h) + f(x - h, y - h)) / (4 * h * h);
  const relative = (a, b) => Math.abs(a - b) / Math.max(1e-7, Math.abs(a), Math.abs(b));
  const errors = [relative(value.gradX, gx), relative(value.gradY, gy), relative(value.h00, hxx), relative(value.h11, hyy), relative(value.h01, hxy)];
  assert.ok(Math.max(...errors) < 2e-5, `max relative error=${Math.max(...errors)}`);
  return { maxRelativeError: Math.max(...errors) };
});

run('9 single wall ridge', () => {
  const estimator = new RevisedEstimator({ HConf: 3, KMode: 2, tauE: 0.005, tauR: 0.04, tauD: 0.45, tauC: 0.4 });
  for (let t = 0; t < 5; t++) ingestLine(estimator, t, 10);
  const grid = estimator.extractGrid(120);
  const near = grid.ridgePoints.filter((point) => Math.abs(point.y - 10) <= 0.6);
  assert.ok(near.length >= 20, `near-wall ridge points=${near.length}`);
  return { ridgePoints: grid.ridgePoints.length, nearWall: near.length };
});

run('10 two parallel walls with K_mode >= 2', () => {
  const estimator = new RevisedEstimator({ cellSize: 3, HConf: 2, KMode: 2, tauB: 0.5, tauE: 0.005, tauR: 0.04, tauD: 0.45 });
  for (let t = 0; t < 4; t++) {
    const kernels = [];
    for (let x = 4; x <= 56; x += 0.75) {
      kernels.push(makeKernel(x, 10, Math.PI / 2, 0.75, 0.14, 1));
      kernels.push(makeKernel(x, 12, Math.PI / 2, 0.75, 0.14, 1));
    }
    estimator.debugIngestKernels(t, kernels);
  }
  const grid = estimator.extractGrid(120);
  const recall = [10, 12].map((wallY) => grid.ridgePoints.some((point) => Math.abs(point.y - wallY) <= 0.6));
  assert.deepEqual(recall, [true, true]);
  return { wallRecall: recall.filter(Boolean).length / recall.length, clusters: ridgeYClusters(grid).length };
});

run('11 corner orientation preservation', () => {
  const fixture = (KMode) => {
    const estimator = new RevisedEstimator({ cellSize: 4, HConf: 2, KMode, tauB: 0.2 });
    for (let t = 0; t < 3; t++) {
      const kernels = [];
      for (let s = -1.5; s <= 1.5; s += 0.25) {
        kernels.push(makeKernel(10 + s, 10, Math.PI / 2, 0.7, 0.14, 1));
        kernels.push(makeKernel(10, 10 + s, 0, 0.7, 0.14, 1));
      }
      estimator.debugIngestKernels(t, kernels);
    }
    return estimator.exportModes().filter((mode) => mode.cellX === 2 && mode.cellY === 2);
  };
  const one = fixture(1);
  const two = fixture(2);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  return { K1Modes: one.length, K2Modes: two.length };
});

run('12 branch orientation preservation', () => {
  const estimator = new RevisedEstimator({ cellSize: 5, HConf: 2, KMode: 3, tauB: 0.2 });
  for (let t = 0; t < 3; t++) {
    const kernels = [];
    for (let s = -1.2; s <= 1.2; s += 0.2) {
      kernels.push(makeKernel(10 + s, 10, Math.PI / 2, 0.7, 0.14, 1));
      kernels.push(makeKernel(10 + s, 10 + s, -Math.PI / 4, 0.7, 0.14, 1));
      kernels.push(makeKernel(10 + s, 10 - s, Math.PI / 4, 0.7, 0.14, 1));
    }
    estimator.debugIngestKernels(t, kernels);
  }
  const centerModes = estimator.exportModes().filter((mode) => mode.cellX === 2 && mode.cellY === 2);
  assert.equal(centerModes.length, 3);
  return { survivingOrientations: centerModes.length };
});

run('13 dwell-time normalization', () => {
  const build = (snapshots) => {
    const estimator = new RevisedEstimator({ cellSize: 2, HConf: 1, KMode: 2, tauB: 4 });
    for (let t = 0; t < snapshots; t++) estimator.debugIngestKernels(t, [makeKernel(10, 10, Math.PI / 2, 0.75, 0.15, 1)]);
    return estimator.exportModes()[0];
  };
  const short = build(5);
  const long = build(25);
  assert.ok(long.W > short.W * 4.9);
  assert.ok(Math.abs(long.averageMass - short.averageMass) < 1e-12);
  return { rawMassRatio: long.W / short.W, averageMassRatio: long.averageMass / short.averageMass };
});

run('14 visibility causality', () => {
  const estimator = new RevisedEstimator({ useVisibility: true, HConf: 1, cellSize: 1, visibilityAlpha: 4, visibilityCoherence: 0.2, KMode: 3 });
  const first = estimator.updateSnapshot(0, [measurement(14)]);
  const second = estimator.updateSnapshot(1, [measurement(14)]);
  assert.equal(first.visibilityMean, 1, 'current candidates must not occlude themselves');
  assert.ok(second.visibilityMean <= 1 + 1e-12);
  return { firstSnapshotMean: first.visibilityMean, nextSnapshotMean: second.visibilityMean };
});

function reflectedRange(tx, rx, wallY) {
  return Math.hypot(rx.x - tx.x, (2 * wallY - rx.y) - tx.y);
}

function doubleBounceRange(tx, rx, lowerY, upperY) {
  const reflectedUpper = 2 * upperY - rx.y;
  const reflectedTwice = 2 * lowerY - reflectedUpper;
  return Math.hypot(rx.x - tx.x, reflectedTwice - tx.y);
}

function doubleBounceExperiment(useVisibility) {
  const estimator = new RevisedEstimator({
    useVisibility,
    visibilityAlpha: 3,
    visibilityCoherence: 0.35,
    HConf: 3,
    KMode: 3,
    tauE: 0.008,
    tauR: 0.05,
    tauD: 0.45,
    cellSize: 1,
  });
  const lowerY = 8;
  const upperY = 22;
  const vehicles = Array.from({ length: 10 }, (_, index) => ({ x: 5 + index * 5.2, y: 14 + (index % 2) * 2 }));
  for (let t = 0; t < 6; t++) {
    const measurements = [];
    let m = 0;
    for (let i = 0; i < vehicles.length - 1; i++) {
      const j = i + 1;
      for (const wallY of [lowerY, upperY]) {
        measurements.push({ i, j, m: m++, pI: vehicles[i], pJ: vehicles[j], SigmaI: [0.0025, 0, 0.0025], SigmaJ: [0.0025, 0, 0.0025], d: reflectedRange(vehicles[i], vehicles[j], wallY), sigmaD: 0.05 });
      }
    }
    estimator.updateSnapshot(t, measurements);
  }
  const phantomMeasurements = [];
  let m = 0;
  for (let i = 0; i < vehicles.length - 2; i++) {
    const j = i + 2;
    phantomMeasurements.push({ i, j, m: m++, pI: vehicles[i], pJ: vehicles[j], SigmaI: [0.0025, 0, 0.0025], SigmaJ: [0.0025, 0, 0.0025], d: doubleBounceRange(vehicles[i], vehicles[j], lowerY, upperY), sigmaD: 0.05 });
  }
  const diagnostics = estimator.updateSnapshot(6, phantomMeasurements);
  const grid = estimator.extractGrid(100);
  const truthTolerance = 0.9;
  const truePoints = grid.ridgePoints.filter((point) => Math.min(Math.abs(point.y - lowerY), Math.abs(point.y - upperY)) <= truthTolerance);
  const phantomPoints = grid.ridgePoints.length - truePoints.length;
  const precision = grid.ridgePoints.length ? truePoints.length / grid.ridgePoints.length : 0;
  const recall = [lowerY, upperY].filter((wallY) => grid.ridgePoints.some((point) => Math.abs(point.y - wallY) <= truthTolerance)).length / 2;
  return { phantomPoints, precision, recall, visibilityMean: diagnostics.visibilityMean, ridgePoints: grid.ridgePoints.length };
}

run('15 double-bounce visibility ablation', () => {
  const off = doubleBounceExperiment(false);
  const on = doubleBounceExperiment(true);
  assert.ok(Number.isFinite(off.precision) && Number.isFinite(on.precision));
  assert.ok(Number.isFinite(off.recall) && Number.isFinite(on.recall));
  return { off, on, beneficial: on.phantomPoints < off.phantomPoints && on.recall >= off.recall };
});

const failures = results.filter((result) => result.status !== 'PASS');
console.log(JSON.stringify({ summary: { passed: results.length - failures.length, failed: failures.length, total: results.length }, results }, null, 2));
if (failures.length) process.exitCode = 1;
