/** New-model protocol check; never overwrites legacy reference evidence.
 * Reproduce: node tests/drf/run-layered.mjs. Report accuracy as unvalidated. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createSceneGeometry, normalizeInput } from '../../drf/scenario.mjs';
import { evaluateWall } from '../../drf/wall.mjs';
import { runExperiment } from '../../drf/sweep.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () => Object.fromEntries(['wall','scenario','rng','poly','specular','diffuse','wire','field','evaluate','sweep'].map(name => [name, sha(fs.readFileSync(new URL(`../../drf/${name}.mjs`, import.meta.url)))]));
const before = sourceHashes(), start = performance.now(), input = normalizeInput();
let rejected = 0, seedsWithRejection = 0, n = 0, sum = 0, sum2 = 0, curvatureSum = 0, curvature2 = 0;
const reasons = {}, rejectedSeeds = [];
for (let seed = 0; seed < 2000; seed++) {
  const scene = createSceneGeometry(normalizeInput({ seed })), generation = scene.wallGeneration;
  assert.ok(generation.bounds.minWidth > 4 && generation.minVehicleClearance >= 1);
  assert.ok(generation.bounds.ymin >= -20 && generation.bounds.ymax <= 50);
  rejected += generation.attempt;
  if (generation.attempt) { seedsWithRejection++; rejectedSeeds.push({ seed, attempt: generation.attempt }); }
  for (const reject of generation.rejections) for (const reason of reject.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  for (let x = .25; x < 60; x += .5) for (let wall = 0; wall < 2; wall++) {
    const value = evaluateWall(scene.wallModel, x, wall), side = wall ? 1 : -1,
      curvature = -side * value.second / (1 + value.first ** 2) ** 1.5;
    sum += value.second; sum2 += value.second ** 2;
    curvatureSum += curvature; curvature2 += curvature ** 2; n++;
  }
}
const geometryMs = performance.now() - start, runs = [];
for (const [vehicles, snapshots] of [[3,60],[3,80],[20,80]]) {
  const started = performance.now(), result = await runExperiment({ vehicles, snapshots });
  assert.ok(result.final.Dbar.every(Number.isFinite) && result.final.betaHat.every(Number.isFinite));
  const { final, ...record } = result;
  runs.push({ ...record, elapsedMs: performance.now() - started,
    final: { t: final.t, Q: final.Q, admitted: final.admitted, rejected: final.rejected,
      sha256: sha(Buffer.concat([Buffer.from(final.Dbar.buffer), Buffer.from(final.betaHat.buffer)])) } });
  console.log(`completed V=${vehicles}, T=${snapshots}, Q=${final.Q}`);
}
const after = sourceHashes(); assert.deepEqual(after, before);
const report = { schema: 'echomap-layered-validation/1', date: new Date().toISOString(), command: 'node tests/drf/run-layered.mjs',
  runtime: { node: process.version, platform: process.platform, arch: process.arch }, input,
  domain: [0,60,-20,50], clearanceAxis:'y', validationFleet:{vehicles:20,snapshots:80},
  acceptedWallSample: { seeds:2000, seedRange:[0,1999], totalAttempts:2000+rejected, rejectedAttempts:rejected,
    attemptRejectionRate:rejected/(2000+rejected), seedsWithRejection, reasons, rejectedSeeds,
    n, secondDerivativeStd:Math.sqrt(sum2/n-(sum/n)**2), curvatureStd:Math.sqrt(curvature2/n-(curvatureSum/n)**2), geometryMs },
  runs, integrity:{before,after,stable:true},
  limitations:['Accepted-wall statistics are rejection-conditioned; unconditioned scale has a separate 2000-seed test.',
    'Legacy y=15 partition evaluator is unchanged; reported summary metrics do not validate accuracy for the curved model.',
    'Vertical clearance does not guarantee Euclidean nearest-wall clearance or real vehicle width.',
    'Outer-face outgoing reflections retain the existing vehicle-facing curvature diagnostic.',
    'Browser engine and actual file:// UI checks are separate from this Node run.'] };
fs.writeFileSync(new URL('./layered-validation.json', import.meta.url), JSON.stringify(report, (_k,v) => typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)+'\n');
console.log(JSON.stringify(report.acceptedWallSample));
