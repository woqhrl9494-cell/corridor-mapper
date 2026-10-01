/** Reproduce the browser sweep engine without retaining field histories.
 * node tests/drf/run-reference.mjs --seed-count 10 --workers 3
 * O(workers * grid + retained scalar summaries); only stdlib Node workers.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { endianness } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runExperiment, aggregateRuns, sweepJobs } from '../../drf/sweep.mjs';

const sourcePaths = ['drf/rng.mjs', 'drf/poly.mjs', 'drf/wall.mjs', 'drf/specular.mjs', 'drf/diffuse.mjs',
  'drf/scenario.mjs', 'drf/wire.mjs', 'drf/field.mjs', 'drf/evaluate.mjs', 'drf/sweep.mjs', 'wall_metrics.js'];
const root = new URL('../../', import.meta.url);
const output = new URL('./validation-results.json', import.meta.url);
const sha = data => createHash('sha256').update(data).digest('hex');
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(new URL(path, root)))])));
}
const equalHashes = (a, b) => sourcePaths.every(path => a[path] === b[path]);
const bytes = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

const referenceRows = [
  [0, .05, .123, .349, .035], [0, .1, .136, .389, .044], [0, .2, .173, .438, .034], [0, .3, .224, .545, .067],
  [2, .05, .126, .845, .096], [2, .1, .134, .812, .094], [2, .2, .165, .663, .074], [2, .3, .214, .727, .094],
  [5, .05, .101, .590, .064], [5, .1, .110, .536, .060], [5, .2, .143, .429, .041], [5, .3, .189, .499, .046],
  [10, .05, .073, .626, .069], [10, .1, .083, .560, .060], [10, .2, .110, .393, .039], [10, .3, .145, .338, .018],
];
const counts = { 2: 13.8, 5: 34.5, 10: 69.7 };
const duplicates = { 2: [.86, .91, .93, .93], 5: [.59, .73, .82, .85], 10: [.34, .46, .59, .67] };
function compareReference(groups, seedCount) {
  const comparisons = [];
  for (const row of groups) {
    const ref = referenceRows.find(r => r[0] === row.roughness && r[1] === row.sigmaD);
    function check(metric, expected, tolerance, kind) {
      const result = row[metric], radius = kind === 'relative' ? tolerance * Math.abs(expected) : tolerance;
      const lower = expected - radius, upper = expected + radius;
      comparisons.push({ roughness: row.roughness, sigmaD: row.sigmaD, metric, value: result.mean,
        expected, tolerance, kind, lower, upper, sampleCount: result.n, missing: result.missing,
        pass: result.n === seedCount && Number.isFinite(result.mean) && result.mean >= lower && result.mean <= upper });
    }
    check('medianError', ref[2], .015, 'absolute');
    check('p95', ref[3], .30, 'relative');
    check('offwall', ref[4], .30, 'relative');
    check('observedFraction', .94, .02, 'absolute');
    if (row.roughness) {
      check('diffusePerConfig', counts[row.roughness], .03, 'relative');
      check('duplicateFraction', duplicates[row.roughness][[.05, .1, .2, .3].indexOf(row.sigmaD)], .03, 'absolute');
    }
    if (row.roughness === 2) {
      check('theoremMean', 1, .05, 'absolute');
      check('theoremMedian', .43, .04, 'absolute');
    }
  }
  return comparisons;
}

if (!isMainThread) {
  const loadedHashes = await sourceHashes();
  if (!equalHashes(loadedHashes, workerData.sourceHashes)) throw new Error('Source changed before worker startup');
  parentPort.on('message', async ({ id, input }) => {
    const started = performance.now();
    try {
      const before = await sourceHashes();
      if (!equalHashes(before, loadedHashes)) throw new Error('Source changed before experiment');
      const result = await runExperiment(input), after = await sourceHashes();
      if (!equalHashes(after, loadedHashes)) throw new Error('Source changed during experiment');
      const Dbar = bytes(result.final.Dbar), betaHat = bytes(result.final.betaHat);
      const final = { t: result.final.t, Q: result.final.Q, admitted: result.final.admitted, rejected: result.final.rejected,
        cells: result.final.Dbar.length, byteOrder: endianness(), dtype: 'Float32Array',
        checksumDbar: sha(Dbar), checksumBetaHat: sha(betaHat),
        checksumFields: createHash('sha256').update(Dbar).update(betaHat).digest('hex') };
      const nonfiniteSummary = Object.fromEntries(Object.entries(result.summary).filter(([, value]) => typeof value === 'number' && !Number.isFinite(value)).map(([key, value]) => [key, String(value)]));
      parentPort.postMessage({ id, input: result.input, summary: result.summary, nonfiniteSummary,
        timing: { ...result.timing, totalMs: performance.now() - started }, final, sourceSHA256: loadedHashes, sourceStable: true });
    } catch (error) {
      parentPort.postMessage({ id, input, error: error.message, timing: { totalMs: performance.now() - started }, sourceSHA256: loadedHashes, sourceStable: false });
    }
  });
} else {
  const args = process.argv.slice(2);
  let seedCount = 10, workerCount = 3;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('node tests/drf/run-reference.mjs [--seed-count 1..50] [--workers 1..8]'); process.exit(0); }
    const value = Number(args[++i]);
    if (args[i - 1] === '--seed-count' && Number.isInteger(value) && value >= 1 && value <= 50) seedCount = value;
    else if (args[i - 1] === '--workers' && Number.isInteger(value) && value >= 1 && value <= 8) workerCount = value;
    else throw new Error('Unknown option or value; use --help');
  }
  const initialHashes = await sourceHashes(), started = performance.now();
  const jobs = sweepJobs({ snapshots: 60, grid: 150, scene: 'reference' }, [.05, .1, .2, .3], [0, 2, 5, 10], Array.from({ length: seedCount }, (_, i) => i + 1));
  const runs = Array(jobs.length), workers = [];
  let next = 0, completed = 0;
  await new Promise((resolve, reject) => {
    function dispatch(worker) {
      if (next < jobs.length) { const id = next++; worker.postMessage({ id, input: jobs[id] }); }
    }
    for (let i = 0; i < Math.min(workerCount, jobs.length); i++) {
      const worker = new Worker(new URL(import.meta.url), { workerData: { sourceHashes: initialHashes } }); workers.push(worker);
      worker.on('message', run => {
        runs[run.id] = run; completed++;
        if (completed % 10 === 0 || completed === jobs.length) console.log(`${completed}/${jobs.length} complete; ${((performance.now() - started) / 1000).toFixed(1)} s`);
        if (completed === jobs.length) resolve(); else dispatch(worker);
      });
      worker.on('error', reject);
      dispatch(worker);
    }
  }).finally(() => Promise.all(workers.map(worker => worker.terminate())));
  const finalHashes = await sourceHashes(), validRuns = runs.filter(run => !run.error), aggregate = aggregateRuns(validRuns);
  const comparisons = compareReference(aggregate, seedCount), failures = comparisons.filter(row => !row.pass);
  const sourcesStable = equalHashes(initialHashes, finalHashes) && runs.every(run => run.sourceStable);
  let gitCommit = null;
  try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(); } catch {}
  const result = {
    schemaVersion: 1, createdAt: new Date().toISOString(), engine: 'drf/sweep.mjs runExperiment + aggregateRuns',
    command: `node tests/drf/run-reference.mjs --seed-count ${seedCount} --workers ${workerCount}`,
    environment: { node: process.version, platform: process.platform, architecture: process.arch, byteOrder: endianness(), workerCount, gitCommit },
    scope: { scene: 'reference', snapshots: 60, grid: [150, 150], seedCount, seeds: Array.from({ length: seedCount }, (_, i) => i + 1),
      roughnessDegrees: [0, 2, 5, 10], rangeNoiseMeters: [.05, .1, .2, .3] },
    reference: { source: 'User-supplied EchoMap DRF Lab prompt section 8.3', originalMatlabFilesAvailable: false,
      originalOctaveExecuted: false, exactOctaveParityVerified: false,
      aggregation: 'Mean and sample standard deviation of per-seed statistics; original aggregation details unavailable',
      rows: referenceRows, diffusePerConfig: counts, duplicateFractions: duplicates },
    integrity: { sourcesStable, initialSHA256: initialHashes, finalSHA256: finalHashes },
    execution: { requested: jobs.length, completed: validRuns.length, errors: runs.filter(run => run.error).length, totalMs: performance.now() - started },
    acceptance: { statisticallyEligible: seedCount >= 10, comparisons: comparisons.length, passed: comparisons.length - failures.length,
      failed: failures.length, referenceWithinTolerance: sourcesStable && validRuns.length === jobs.length && seedCount >= 10 && failures.length === 0 },
    aggregate, comparisons, failures, runs,
    limitations: ['Original .m sources and main algorithm are unavailable; table agreement does not establish Octave implementation parity.',
      'Mean signed column offset is reported by the shared evaluator; the supplied +0.139 m statistic has an unspecified aggregation.',
      'Near-zero curvature and finite-roughness neighborhoods can violate the local Theorem 2 approximation; no filter or threshold was changed to match the table.',
      'Nonfinite per-run numbers are serialized as strings and separately listed, never silently counted as successful samples.'],
  };
  await writeFile(output, JSON.stringify(result, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2) + '\n');
  console.table(aggregate.map(row => ({ sigma: row.roughness, sigmaD: row.sigmaD, median: row.medianError.mean,
    p95: row.p95.mean, offwall: row.offwall.mean, diffuse: row.diffusePerConfig.mean,
    theoremMean: row.theoremMean.mean, theoremMedian: row.theoremMedian.mean })));
  console.log(`Saved ${fileURLToPath(output)}; reference checks ${comparisons.length - failures.length}/${comparisons.length}; eligible=${seedCount >= 10}; stable=${sourcesStable}`);
  if (!sourcesStable || validRuns.length !== jobs.length) process.exitCode = 1;
  else if (seedCount >= 10 && failures.length) process.exitCode = 2;
}
