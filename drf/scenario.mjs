/** Truth-side simulator. Units: m and rad; no estimator output is read here.
 * Input: experiment settings. Output: truth and a separately copied measurement wire.
 * Work per snapshot: O(C * (wall cells + emitted paths * visibility cost)).
 */
import { createWalls, sampleWalls } from './wall.mjs';
import { specularPoints } from './specular.mjs?v=20261002-model8';
import { diffuseProfile, sampleDiffuse } from './diffuse.mjs?v=20261002-model8';
import { createRng } from './rng.mjs';
import { makeWire } from './wire.mjs';

export const DEFAULT_INPUT = Object.freeze({
  scene: 'reference', vehicles: 3, snapshots: 60, sigmaP: 0.1, sigmaD: 0.1,
  roughness: 2, lambda0: 10, cellStep: 0.02, resolution: 0, specular: true,
  grid: 150, band: 4, perimeter: 'exact', seed: 1,
});
export function normalizeInput(raw = {}) {
  const p = {};
  for (const key of Object.keys(DEFAULT_INPUT)) p[key] = raw[key] ?? DEFAULT_INPUT[key];
  for (const key of ['vehicles', 'snapshots', 'sigmaP', 'sigmaD', 'roughness', 'lambda0', 'cellStep', 'resolution', 'grid', 'seed']) {
    p[key] = Number(p[key]);
    if (!Number.isFinite(p[key])) throw new Error(`${key}: finite number required`);
  }
  p.band = p.band === 'full' ? 'full' : Number(p.band);
  p.specular = p.specular === true || p.specular === 'true';
  if (!['reference', 'random'].includes(p.scene)) throw new Error('Unknown corridor scene');
  if (![2, 3].includes(p.vehicles) || !Number.isInteger(p.snapshots) || p.snapshots < 1 || p.snapshots > 60)
    throw new Error('Reference trajectories support 2–3 vehicles and 1–60 snapshots');
  if (![100, 150, 200].includes(p.grid) || ![3, 4, 5, 'full'].includes(p.band) || !['exact', 'ramanujan'].includes(p.perimeter))
    throw new Error('Unsupported numerical setting');
  if (p.sigmaP < 0 || p.sigmaD < 0 || p.sigmaP > 2 || p.sigmaD > 2 || p.sigmaP + p.sigmaD === 0)
    throw new Error('위치·거리 잡음 중 하나는 0보다 커야 합니다. 허용 범위는 0–2 m입니다.');
  if (p.roughness < 0 || p.roughness > 20 || p.lambda0 < 0 || p.lambda0 > 30 || p.cellStep < 0.005 || p.cellStep > 0.2 || p.resolution < 0 || p.resolution > 2)
    throw new Error('Scattering settings are outside the supported range');
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) throw new Error('Seed must be a uint32');
  return p;
}
export function truePoses(t, vehicles = 3) {
  return [4, 7, 10].slice(0, vehicles).map((x0, v) => {
    const x = x0 + 0.75 * t;
    return [x, 15 + 2 * Math.sin(2 * Math.PI * x / 30 + v + 1)];
  });
}
/** Independent streams preserve standard pose/specular noise across paired sweeps. */
export function generateSnapshot(input, spans, t) {
  const p = truePoses(t, input.vehicles), sigma2 = input.sigmaP ** 2;
  const poseNoise = p.map((_, v) => {
    // Stream addresses use the same 1-based vehicle IDs as the wire.
    const r = createRng(input.seed, 'pose', t, v + 1);
    return [r.normal(), r.normal()];
  });
  const pHat = p.map((q, v) => q.map((a, k) => a + input.sigmaP * poseNoise[v][k]));
  const truth = { t, p, poseNoise, configs: [] }, measured = { t, configs: [] };
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const spec = input.specular ? specularPoints(spans, p[i], p[j]) : [];
    const specRng = createRng(input.seed, 'specNoise', t, i + 1, j + 1);
    const diffRng = createRng(input.seed, 'diffNoise', t, i + 1, j + 1);
    const profile = diffuseProfile(spans, p[i], p[j], input.roughness * Math.PI / 180, input.lambda0, input.cellStep);
    const diffuse = [], diffuseSampling = { beforeThinning: [], afterThinning: [] };
    for (let wall = 0; wall < 2; wall++) {
      const cells = profile.cells.filter(c => c.wall === wall);
      const wallProfile = { cells, lambdaTotal: profile.lambdaTotal };
      const diagnostics = {}, points = sampleDiffuse(spans, p[i], p[j], wallProfile, createRng(input.seed, 'diffuse', t, i + 1, j + 1, wall), diagnostics);
      diffuseSampling.beforeThinning.push(diagnostics.generated);
      diffuseSampling.afterThinning.push(points.length);
      diffuse.push(...points);
    }
    const tagged = [
      ...spec.map(point => ({ ...point, kind: 'specular', z: specRng.normal() })),
      ...diffuse.map(point => ({ ...point, kind: 'diffuse', z: diffRng.normal() })),
    ];
    let emitted = tagged;
    if (input.resolution > 0) {
      emitted = []; let previous = -Infinity;
      for (const point of tagged.slice().sort((a, b) => a.rho - b.rho))
        if (point.rho - previous >= input.resolution) { emitted.push(point); previous = point.rho; }
    }
    const paths = emitted.map(point => ({ dHat: point.rho + input.sigmaD * point.z, sigmaD: input.sigmaD }));
    const shuffle = createRng(input.seed, 'shuffle', t, i + 1, j + 1);
    for (let k = paths.length - 1; k > 0; k--) {
      const n = Math.floor(shuffle.uniform() * (k + 1)); [paths[k], paths[n]] = [paths[n], paths[k]];
    }
    truth.configs.push({ i: i + 1, j: j + 1,
      specular: emitted.filter(q => q.kind === 'specular').map(({ kind, ...q }) => q),
      diffuse: emitted.filter(q => q.kind === 'diffuse').map(({ kind, ...q }) => q),
      lambdaTotal: profile.lambdaTotal,
      diffuseSampling,
      // Existing generated counts are visible paths before resolution merging.
      generated: { specular: spec.length, diffuse: diffuse.length },
      numericalDiagnostics: spec.diagnostics ?? { degenerateSpans: [], unresolved: 0 },
    });
    measured.configs.push({ i: i + 1, j: j + 1, pHat_i: pHat[i], pHat_j: pHat[j],
      Sigma_i: [sigma2, 0, sigma2], Sigma_j: [sigma2, 0, sigma2], paths });
  }
  return { truth, wire: makeWire(measured) };
}
export async function generateScenario(raw, progress = () => {}) {
  const input = normalizeInput(raw), spans = createWalls(input), walls = sampleWalls(spans, 0.1);
  const truth = [], wire = [], started = performance.now();
  for (let t = 1; t <= input.snapshots; t++) {
    const result = generateSnapshot(input, spans, t);
    truth.push(result.truth); wire.push(result.wire); progress(t, input.snapshots);
    // Yield only on the truth side; the estimator still receives one causal snapshot at a time.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { input, spans, walls, truth, wire, simulatorMs: performance.now() - started };
}
