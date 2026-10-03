import { generateScenario, normalizeInput } from './scenario.mjs?v=20261003-pspt1';
import { createGrid, createField } from './field.mjs';
import { percentile } from './evaluate.mjs?v=20261003-pspt1';
import { createPSPTEvaluator } from './pspt-evaluate.mjs';
import { PSPT } from './pspt.mjs';

/** Same engine for Node validation and browser sweep; seeds, truth and evaluation
 * stay outside the estimator wire. Memory O(G+truth), frames are not retained. */
export async function runExperiment(raw, progress = () => {}) {
  const input = normalizeInput(raw);
  if (input.sigmaD === 0) throw new Error('현재 PSPT는 거리 오차 σd > 0이 필요합니다. σd = 0의 특이 공분산은 지원하지 않습니다.');
  const scenario = await generateScenario(input),
    grid = createGrid(input.grid, input.grid, scenario.domain), field = createField(grid, { band: input.band, perimeter: input.perimeter }),
    evaluator = createPSPTEvaluator(scenario, grid), estimator = new PSPT(), timings = [];
  let frame, evaluation, fieldMs = 0, evaluationMs = 0, psptMs = 0;
  for (const wire of scenario.wire) {
    frame = field.step(wire); fieldMs += frame.ms;
    const psptStart = performance.now(); frame.candidates = estimator.step(wire); frame.psptMs = performance.now() - psptStart;
    frame.method = 'guarded45'; psptMs += frame.psptMs; timings.push(frame.ms + frame.psptMs);
    const start = performance.now(); evaluation = evaluator.step(frame); evaluationMs += performance.now() - start;
    progress(frame.t, input.snapshots);
  }
  return { input, wallGeneration: scenario.wallGeneration, method: 'guarded45', summary: { precision: evaluation.precision, recall: evaluation.recall, holdRate: evaluation.holdRate, firstSupportPrecision: evaluation.firstSupportPrecision, medianError: evaluation.medianError, p95: evaluation.p95, offwall: evaluation.offwall,
    offset: evaluation.offset, f1: evaluation.f1, caMsd: evaluation.caMsd, caHd95: evaluation.caHd95,
    observedFraction: evaluation.observedFraction, missing: evaluation.missing,
    diffusePerConfig: evaluation.diagnostics.diffusePerConfig, duplicateFraction: evaluation.diagnostics.duplicateFraction,
    theoremMean: evaluation.diagnostics.theoremMean, theoremMedian: evaluation.diagnostics.theoremMedian,
    theoremN: evaluation.diagnostics.ratios.length, theoremNegative: evaluation.diagnostics.theoremNegative,
    Q: frame.Q, admitted: frame.admitted, rejected: frame.rejected },
    timing: { simulatorMs: scenario.simulatorMs, fieldMs, psptMs, evaluationMs, frameP50: percentile(timings, 0.5), frameP95: percentile(timings, 0.95) },
    final: { t: frame.t, Dbar: frame.Dbar, betaHat: frame.betaHat, Q: frame.Q, admitted: frame.admitted, rejected: frame.rejected },
  };
}
export function parseValues(text, integer = false) {
  const values = String(text).split(/[\s,]+/).filter(Boolean).map(Number);
  if (!values.length || values.some(v => !Number.isFinite(v) || (integer && (!Number.isInteger(v) || v < 0 || v > 0xffffffff)))) throw new Error('쉼표로 구분한 유효한 숫자를 입력하세요.');
  if (new Set(values).size !== values.length) throw new Error('중복된 값이나 seed를 제거하세요.');
  return values;
}
export function sweepJobs(base, noise, roughness, seeds) {
  if (noise.length * roughness.length * seeds.length > 1000) throw new Error('한 번에 최대 1,000개 조합을 실행할 수 있습니다.');
  return roughness.flatMap(r => noise.flatMap(d => seeds.map(seed => normalizeInput({ ...base, sigmaD: d, roughness: r, seed }))));
}
export function aggregateRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.input.roughness}:${run.input.sigmaD}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const fields = ['precision', 'recall', 'holdRate', 'firstSupportPrecision', 'medianError', 'p95', 'offwall', 'offset', 'f1', 'caMsd', 'caHd95', 'observedFraction', 'diffusePerConfig', 'duplicateFraction', 'theoremMean', 'theoremMedian'];
  return [...groups.values()].map(group => {
    const row = { roughness: group[0].input.roughness, sigmaD: group[0].input.sigmaD, n: group.length };
    for (const key of fields) {
      const all = group.map(run => run.summary[key]), values = all.filter(Number.isFinite), n = values.length,
        missing = all.filter(v => v == null).length, failed = all.length - n - missing,
        positive = all.includes(Infinity), negative = all.includes(-Infinity),
        invalid = all.some(v => v != null && !Number.isFinite(v) && v !== Infinity && v !== -Infinity);
      // Observed failures must not disappear into a finite-only performance average.
      const mean = failed ? invalid || (positive && negative) ? NaN : positive ? Infinity : -Infinity
        : n ? values.reduce((s, v) => s + v, 0) / n : null;
      row[key] = { mean, sd: !failed && n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null,
        n, failed, missing };
    }
    return row;
  }).sort((a, b) => a.roughness - b.roughness || a.sigmaD - b.sigmaD);
}
/** Bounded pool: at most four default jobs, no frame history.
 * Cancellation terminates workers and keeps only fully completed seed results. */
export function startSweep(jobs, onProgress, workerCount = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))) {
  const results = [], workers = []; let next = 0, completed = 0, cancelled = false, settled = false;
  let finish, fail;
  const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const stop = () => workers.forEach(worker => worker.terminate());
  function dispatch(worker) {
    if (next >= jobs.length) return;
    const id = next++; worker.postMessage({ type: 'run', input: jobs[id], id });
  }
  const count = Math.min(jobs.length, workerCount);
  for (let k = 0; k < count; k++) {
    const worker = new Worker(new URL('./sweep.worker.mjs?v=20261003-pspt1', import.meta.url), { type: 'module' }); workers.push(worker);
    worker.onmessage = ({ data }) => {
      if (cancelled || settled) return;
      if (data.type === 'error') { settled = true; stop(); fail(new Error(data.message)); return; }
      if (data.type === 'result') {
        const { final, ...record } = data.result; results.push(record); completed++; onProgress({ completed, total: jobs.length, results });
        if (completed === jobs.length) { settled = true; stop(); finish({ results, cancelled: false }); }
        else dispatch(worker);
      }
    };
    worker.onerror = event => { if (!settled) { settled = true; stop(); fail(new Error(event.message)); } };
    dispatch(worker);
  }
  if (!count) { settled = true; finish({ results, cancelled: false }); }
  return { promise, cancel() { if (settled) return; cancelled = true; settled = true; stop(); finish({ results, cancelled: true }); } };
}
