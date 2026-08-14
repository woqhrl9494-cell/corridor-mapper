'use strict';

const assert = require('node:assert/strict');
const {
  RevisedEstimator,
  makeKernel,
  buildSurfaceContinuationGraph,
  extractCorridorOuterPeakRidge,
  regularizeCorridorOffsets,
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

run('16 evidence-dominance rejects trivial self-ridges', () => {
  const build = (tauEDominance) => {
    const estimator = new RevisedEstimator({
      HConf: 2,
      KMode: 3,
      tauB: 4,
      tauE: 0.001,
      tauC: 0.35,
      tauR: 0.03,
      tauD: 0.45,
      evidenceQuantile: 0.99,
      tauEDominance,
    });
    for (let t = 0; t < 3; t++) {
      const kernels = [];
      for (let x = 4; x <= 56; x += 0.75) kernels.push(makeKernel(x, 10, Math.PI / 2, 0.75, 0.16, 1));
      for (let y = 4; y <= 26; y += 2.5) {
        if (Math.abs(y - 10) < 1) continue;
        for (let x = 6; x <= 54; x += 3) kernels.push(makeKernel(x, y, Math.PI / 2, 0.75, 0.16, 0.08));
      }
      estimator.debugIngestKernels(t, kernels);
    }
    const grid = estimator.extractGrid(120);
    const near = grid.ridgePoints.filter((point) => Math.abs(point.y - 10) <= 0.6).length;
    const far = grid.ridgePoints.length - near;
    return { estimator, grid, near, far };
  };

  const raw = build(0);
  const gated = build(0.60);
  const diagnostics = gated.estimator.getDiagnostics();
  assert.ok(gated.near >= 20, `near-wall ridge points=${gated.near}`);
  assert.ok(gated.far <= Math.max(2, 0.2 * raw.far), `far raw=${raw.far}, gated=${gated.far}`);
  assert.ok(diagnostics.rawRidgePoints > diagnostics.ridgePoints);
  assert.ok(diagnostics.evidenceDominanceThreshold > gated.estimator.config.tauE);
  return {
    rawRidges: raw.grid.ridgePoints.length,
    gatedRidges: gated.grid.ridgePoints.length,
    rawFar: raw.far,
    gatedFar: gated.far,
    nearWall: gated.near,
    evidenceThreshold: diagnostics.evidenceDominanceThreshold,
  };
});

run('17 normal NMS thins a multi-mode ridge band', () => {
  const build = (useNormalNms) => {
    const estimator = new RevisedEstimator({
      cellSize: 0.5,
      HConf: 2,
      KMode: 3,
      tauB: 0.01,
      tauE: 0.001,
      tauC: 0.35,
      tauR: 0.03,
      tauD: 0.60,
      tauEDominance: 0,
      useNormalNms,
    });
    for (let t = 0; t < 3; t++) {
      const kernels = [];
      for (let x = 4; x <= 56; x += 0.75) {
        kernels.push(makeKernel(x, 9.8, Math.PI / 2, 0.75, 0.12, 0.80));
        kernels.push(makeKernel(x, 10.0, Math.PI / 2, 0.75, 0.12, 1.00));
        kernels.push(makeKernel(x, 10.2, Math.PI / 2, 0.75, 0.12, 0.90));
      }
      estimator.debugIngestKernels(t, kernels);
    }
    const grid = estimator.extractGrid(150);
    const columnCounts = new Map();
    for (const point of grid.ridgePoints) columnCounts.set(point.gx, (columnCounts.get(point.gx) || 0) + 1);
    return {
      grid,
      diagnostics: estimator.getDiagnostics(),
      maxColumnThickness: Math.max(0, ...columnCounts.values()),
    };
  };

  const thick = build(false);
  const thin = build(true);
  assert.ok(thick.grid.ridgePoints.length > thin.grid.ridgePoints.length, `${thick.grid.ridgePoints.length} <= ${thin.grid.ridgePoints.length}`);
  assert.ok(thin.maxColumnThickness < thick.maxColumnThickness, `${thin.maxColumnThickness} >= ${thick.maxColumnThickness}`);
  assert.ok(thin.diagnostics.normalNmsRemoved > 0);
  assert.ok(thin.grid.ridgePoints.some((point) => Math.abs(point.y - 10) <= 0.25));
  return {
    thickPoints: thick.grid.ridgePoints.length,
    thinPoints: thin.grid.ridgePoints.length,
    thickCellsPerColumn: thick.maxColumnThickness,
    thinCellsPerColumn: thin.maxColumnThickness,
    removed: thin.diagnostics.normalNmsRemoved,
  };
});

run('18 simulation-oracle fields cannot affect estimator output', () => {
  const cleanEstimator = new RevisedEstimator({ HConf: 2, KMode: 3 });
  const oracleEstimator = new RevisedEstimator({ HConf: 2, KMode: 3 });
  for (let snapshot = 0; snapshot < 4; snapshot++) {
    const clean = measurement(14 + 0.05 * snapshot);
    const withOracleFields = {
      ...clean,
      hit: { x: 15, y: 10 },
      specularHit: { x: 15.2, y: 10.1 },
      deltaS: 2.3,
      familyId: 91,
      wallId: 0,
      actualPathCount: 6,
      gtWallId: 1,
      futureSnapshot: snapshot + 100,
      futureHit: { x: 40, y: 20 },
    };
    cleanEstimator.updateSnapshot(snapshot, [clean]);
    oracleEstimator.updateSnapshot(snapshot, [withOracleFields]);
  }
  assert.deepEqual(oracleEstimator.exportModes(), cleanEstimator.exportModes());
  const cleanGrid = cleanEstimator.extractGrid(80);
  const oracleGrid = oracleEstimator.extractGrid(80);
  assert.deepEqual(Array.from(oracleGrid.evidence), Array.from(cleanGrid.evidence));
  assert.deepEqual(Array.from(oracleGrid.ridge), Array.from(cleanGrid.ridge));
  assert.deepEqual(oracleGrid.ridgePoints, cleanGrid.ridgePoints);
  return { modes: cleanEstimator.exportModes().length, ridgePoints: cleanGrid.ridgePoints.length };
});

run('19 surface graph follows cumulative curvature by adjacent continuation', () => {
  const radius = 5;
  const nodes = [];
  let id = 1;
  for (let angle = -0.70; angle <= 0.7001; angle += 0.14) {
    nodes.push({
      id: id++,
      mx: 10 + radius * Math.cos(angle),
      my: 10 + radius * Math.sin(angle),
      nx: Math.cos(angle),
      ny: Math.sin(angle),
    });
  }
  const graph = buildSurfaceContinuationGraph(nodes, {
    cellSize: 1,
    graphLinkDistance: 1.5,
    graphLinkAngle: Math.PI / 6,
    graphSecantAngle: Math.PI / 8,
  });
  const endpointCompatibility = Math.abs(nodes[0].nx * nodes.at(-1).nx + nodes[0].ny * nodes.at(-1).ny);
  assert.ok(endpointCompatibility < Math.cos(Math.PI / 6), 'fixture endpoints must fail direct seed-to-all orientation');
  assert.equal(graph.groups.length, 1);
  assert.ok(graph.groups[0].diameter > 6.5, `diameter=${graph.groups[0].diameter}`);
  return { nodes: nodes.length, diameter: graph.groups[0].diameter, endpointCompatibility };
});

run('20 symmetric secant gate separates nearby parallel walls', () => {
  const nodes = [];
  let id = 1;
  for (const y of [10, 12]) {
    for (let x = 2; x <= 10; x += 1) nodes.push({ id: id++, mx: x, my: y, nx: 0, ny: 1 });
  }
  const graph = buildSurfaceContinuationGraph(nodes, {
    cellSize: 1,
    graphLinkDistance: 2.1,
    graphLinkAngle: Math.PI / 6,
    graphSecantAngle: Math.PI / 8,
  });
  assert.equal(graph.groups.length, 2);
  assert.deepEqual(graph.groups.map((group) => group.nodeCount), [9, 9]);
  assert.ok(graph.groups.every((group) => group.diameter >= 7.9));
  return { groups: graph.groups.length, diameters: graph.groups.map((group) => group.diameter) };
});

run('21 shadow graph cannot alter evidence or ridge output', () => {
  const build = (enableSurfaceGraphShadow) => {
    const estimator = new RevisedEstimator({
      HConf: 2,
      KMode: 3,
      enableSurfaceGraphShadow,
      tauE: 0.005,
      tauR: 0.04,
      tauD: 0.45,
    });
    for (let snapshot = 0; snapshot < 4; snapshot++) ingestLine(estimator, snapshot, 10);
    return { estimator, grid: estimator.extractGrid(120) };
  };
  const disabled = build(false);
  const shadow = build(true);
  assert.deepEqual(Array.from(shadow.grid.evidence), Array.from(disabled.grid.evidence));
  assert.deepEqual(Array.from(shadow.grid.ridge), Array.from(disabled.grid.ridge));
  assert.deepEqual(shadow.grid.ridgePoints, disabled.grid.ridgePoints);
  assert.ok(shadow.estimator.getDiagnostics().graphGroups > 0);
  return {
    graphGroups: shadow.estimator.getDiagnostics().graphGroups,
    graphMaxDiameter: shadow.estimator.getDiagnostics().graphMaxDiameter,
  };
});

run('22 surface groups aggregate pair and temporal support without GT', () => {
  const pairWords = (bits) => {
    const words = new Array(14).fill(0);
    for (const bit of bits) words[bit >>> 5] |= 1 << (bit & 31);
    return words;
  };
  const nodes = [
    { id: 1, mx: 0, my: 0, nx: 0, ny: 1, H: 3, coherence: 0.8, birthSnapshot: 2, lastSupportedSnapshot: 4, pairSupportWords: pairWords([0, 2]) },
    { id: 2, mx: 1, my: 0, nx: 0, ny: 1, H: 5, coherence: 0.6, birthSnapshot: 1, lastSupportedSnapshot: 7, pairSupportWords: pairWords([2, 34]) },
    { id: 3, mx: 2, my: 0, nx: 0, ny: 1, H: 4, coherence: 1.0, birthSnapshot: 3, lastSupportedSnapshot: 8, pairSupportWords: pairWords([65]) },
  ];
  const graph = buildSurfaceContinuationGraph(nodes, {
    cellSize: 1,
    graphLinkDistance: 1.1,
    graphLinkAngle: Math.PI / 6,
    graphSecantAngle: Math.PI / 8,
  });
  assert.equal(graph.groups.length, 1);
  const group = graph.groups[0];
  assert.equal(group.pairSupportCount, 4);
  assert.equal(group.supportSpanSnapshots, 8);
  assert.equal(group.maxSnapshotSupport, 5);
  assert.ok(Math.abs(group.meanSnapshotSupport - 4) < 1e-12);
  assert.ok(Math.abs(group.meanCoherence - 0.8) < 1e-12);
  return {
    pairSupportCount: group.pairSupportCount,
    supportSpanSnapshots: group.supportSpanSnapshots,
    meanSnapshotSupport: group.meanSnapshotSupport,
  };
});

run('23 directional normal gate blocks Bhattacharyya over-merge', () => {
  const build = (useDirectionalAssignment) => {
    const estimator = new RevisedEstimator({
      cellSize: 1,
      HConf: 1,
      KMode: 3,
      useDirectionalAssignment,
      assignmentNormalSigma: 2,
      tauB: 2,
    });
    estimator.debugIngestKernels(0, [
      makeKernel(4.5, 4.10, Math.PI / 2, 0.5, 0.20, 1),
      makeKernel(4.5, 4.75, Math.PI / 2, 0.5, 0.20, 1),
    ]);
    return estimator.exportModes();
  };
  const directional = build(true);
  const bhattacharyya = build(false);
  assert.equal(directional.length, 2);
  assert.equal(bhattacharyya.length, 1);
  return { directionalModes: directional.length, bhattacharyyaModes: bhattacharyya.length };
});

run('24 neighboring-cell assignment is deterministically re-indexed', () => {
  const estimator = new RevisedEstimator({
    cellSize: 1,
    HConf: 1,
    KMode: 3,
    useDirectionalAssignment: true,
    assignmentSearchRadiusCells: 1,
  });
  estimator.debugIngestKernels(0, [
    makeKernel(0.95, 4, 0, 0.5, 0.15, 1),
    makeKernel(1.05, 4, 0, 0.5, 0.15, 1),
  ]);
  const modes = estimator.exportModes();
  assert.equal(modes.length, 1);
  assert.equal(modes[0].cellX, 1);
  assert.ok(Math.abs(modes[0].mx - 1) < 1e-12);
  return { modes: modes.length, meanX: modes[0].mx, cellX: modes[0].cellX };
});

run('25 corridor Evidence E extractor returns two thin curved walls', () => {
  const G = 60;
  const evidence = new Float32Array(G * G);
  const expected = new Map();
  for (let gx = 0; gx < G; gx++) {
    const top = 12 + Math.round(3 * Math.sin(gx / 8));
    const bottom = 45 + Math.round(2 * Math.sin(gx / 9 + 0.4));
    expected.set(gx, [top, bottom]);
    for (let gy = 0; gy < G; gy++) {
      evidence[gy * G + gx] = Math.exp(-0.5 * ((gy - top) / 1.2) ** 2)
        + 0.9 * Math.exp(-0.5 * ((gy - bottom) / 1.2) ** 2)
        + 0.02 * ((gx * 17 + gy * 13) % 11) / 10;
    }
  }
  const points = extractCorridorOuterPeakRidge(evidence, G, 60, 30, 0.60);
  assert.equal(points.length, 2 * G);
  let maxRowError = 0;
  for (const point of points) {
    const error = Math.min(...expected.get(point.gx).map((row) => Math.abs(row - point.gy)));
    maxRowError = Math.max(maxRowError, error);
  }
  assert.ok(maxRowError <= 1, `max row error=${maxRowError}`);
  return { points: points.length, maxRowError };
});

run('26 corridor Evidence E extractor rejects weak exterior false peaks', () => {
  const G = 30;
  const evidence = new Float32Array(G * G);
  for (let gx = 0; gx < G; gx++) {
    evidence[4 * G + gx] = 0.3;
    evidence[9 * G + gx] = 1.0;
    evidence[21 * G + gx] = 0.9;
  }
  const points = extractCorridorOuterPeakRidge(evidence, G, 60, 30, 0.60);
  assert.equal(points.length, 2 * G);
  assert.ok(points.every((point) => point.gy === 9 || point.gy === 21));
  return { points: points.length, rows: [...new Set(points.map((point) => point.gy))] };
});

run('27 corridor extractor rejects converging parenthesis end caps', () => {
  const G = 60;
  const evidence = new Float32Array(G * G);
  const expectedColumns = new Set();
  for (let gx = 4; gx <= 55; gx++) {
    let top = 14;
    let bottom = 46;
    if (gx < 10) {
      const inward = 3 * (10 - gx);
      top += inward;
      bottom -= inward;
    } else if (gx > 49) {
      const inward = 3 * (gx - 49);
      top += inward;
      bottom -= inward;
    } else {
      expectedColumns.add(gx);
    }
    for (let gy = 0; gy < G; gy++) {
      evidence[gy * G + gx] = Math.exp(-0.5 * ((gy - top) / 1.15) ** 2)
        + 0.95 * Math.exp(-0.5 * ((gy - bottom) / 1.15) ** 2);
    }
  }
  // Single-mode clutter must not be emitted as one side of a wall pair.
  evidence[30 * G + 2] = 0.8;
  const points = extractCorridorOuterPeakRidge(evidence, G, 60, 30, 0.60);
  const outputColumns = new Set(points.map((point) => point.gx));
  assert.ok(points.every((point) => point.gy === 14 || point.gy === 46));
  assert.ok([...outputColumns].every((gx) => expectedColumns.has(gx)));
  assert.equal(points.length, 2 * expectedColumns.size);
  return { points: points.length, acceptedColumns: outputColumns.size };
});

run('28 corridor offsets remain below the parallel-curve cusp limit', () => {
  const curvature = Float64Array.from([0, 0.08, 0.20, 0.50, 0.20, -0.45, -0.10, 0]);
  const desiredTop = new Float64Array(curvature.length).fill(5);
  const desiredBottom = new Float64Array(curvature.length).fill(5);
  const arcLength = Float64Array.from(curvature, (_, index) => index);
  const result = regularizeCorridorOffsets(desiredTop, desiredBottom, curvature, arcLength, {
    safetyProduct: 0.72,
    maxOffsetSlope: 0.35,
  });
  assert.ok(result.maxOffsetCurvatureProduct <= 0.72 + 1e-12);
  assert.ok(curvature[3] * result.top[3] <= 0.72 + 1e-12);
  assert.ok((-curvature[5]) * result.bottom[5] <= 0.72 + 1e-12);
  assert.ok(result.top[3] < result.bottom[3]);
  assert.ok(result.bottom[5] < result.top[5]);
  for (const profile of [result.top, result.bottom]) {
    for (let index = 1; index < profile.length; index++) {
      assert.ok(Math.abs(profile[index] - profile[index - 1]) <= 0.35 + 1e-12);
      assert.ok(profile[index] <= 5 + 1e-12);
    }
  }
  return {
    maxOffsetCurvatureProduct: result.maxOffsetCurvatureProduct,
    minimumTopOffset: Math.min(...result.top),
    minimumBottomOffset: Math.min(...result.bottom),
  };
});

run('29 zero diffuse spread is regression-identical to fixed tangency', () => {
  const fixed = new RevisedEstimator({ HConf: 2, KMode: 4, useMaterialAwareTangency: false });
  const zeroDiffuse = new RevisedEstimator({ HConf: 2, KMode: 4, useMaterialAwareTangency: true, diffuseSigmaS: 0 });
  for (let snapshot = 0; snapshot < 4; snapshot++) {
    const measurements = [measurement(14 + 0.03 * snapshot), measurement(16 - 0.02 * snapshot)];
    fixed.updateSnapshot(snapshot, measurements);
    zeroDiffuse.updateSnapshot(snapshot, measurements);
  }
  assert.deepEqual(zeroDiffuse.exportModes(), fixed.exportModes());
  const fixedGrid = fixed.extractGrid(90);
  const zeroGrid = zeroDiffuse.extractGrid(90);
  assert.deepEqual(Array.from(zeroGrid.evidence), Array.from(fixedGrid.evidence));
  assert.deepEqual(Array.from(zeroGrid.ridge), Array.from(fixedGrid.ridge));
  return { modes: fixed.exportModes().length, ridgePoints: fixedGrid.ridgePoints.length };
});

run('30 material-aware tangency widens acceptance and reduces orientation trust', () => {
  const first = makeKernel(10, 10, 0, 0.75, 0.16, 1);
  const second = makeKernel(10, 10, 40 * Math.PI / 180, 0.75, 0.16, 1);
  const sigmaTheta = 0.60;
  const theta0 = Math.PI / 6;
  const rhoTangency = theta0 * theta0 / (theta0 * theta0 + sigmaTheta * sigmaTheta);
  for (const kernel of [first, second]) {
    kernel.sigmaTheta = sigmaTheta;
    kernel.rhoTangency = rhoTangency;
  }
  const fixed = new RevisedEstimator({ HConf: 1, KMode: 3, cellSize: 2, useMaterialAwareTangency: false });
  const adaptive = new RevisedEstimator({ HConf: 1, KMode: 3, cellSize: 2, useMaterialAwareTangency: true, diffuseSigmaS: 1 });
  fixed.debugIngestKernels(0, [first, second]);
  adaptive.debugIngestKernels(0, [first, second]);
  assert.equal(fixed.exportModes().length, 2);
  assert.equal(adaptive.exportModes().length, 1);
  const mode = adaptive.exportModes()[0];
  assert.ok(mode.gamma < 1 && mode.gamma > 0);
  assert.ok(mode.effectiveCoherence > mode.coherence);
  return {
    fixedModes: fixed.exportModes().length,
    adaptiveModes: adaptive.exportModes().length,
    gamma: mode.gamma,
    rawCoherence: mode.coherence,
    effectiveCoherence: mode.effectiveCoherence,
  };
});

run('31 sample-wise diffuse sensitivity diagnostics use only ellipse geometry and sigmaS', () => {
  const estimator = new RevisedEstimator({ useMaterialAwareTangency: true, diffuseSigmaS: 2, KMode: 6 });
  const diagnostics = estimator.updateSnapshot(0, [measurement(14)]);
  assert.equal(diagnostics.materialAwareTangency, true);
  assert.ok(diagnostics.tangencySamples > 0);
  assert.ok(diagnostics.meanSigmaTheta > 0);
  assert.ok(diagnostics.meanRhoTangency > 0 && diagnostics.meanRhoTangency < 1);
  return {
    samples: diagnostics.tangencySamples,
    meanSigmaTheta: diagnostics.meanSigmaTheta,
    meanRhoTangency: diagnostics.meanRhoTangency,
  };
});

const failures = results.filter((result) => result.status !== 'PASS');
console.log(JSON.stringify({ summary: { passed: results.length - failures.length, failed: failures.length, total: results.length }, results }, null, 2));
if (failures.length) process.exitCode = 1;
