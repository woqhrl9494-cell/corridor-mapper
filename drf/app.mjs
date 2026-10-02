import { DEFAULT_INPUT, normalizeInput } from './scenario.mjs?v=20261002-model8';
import { createGrid } from './field.mjs';
import { percentile, snapshotCsv } from './evaluate.mjs';
import { startSweep, parseValues, sweepJobs, aggregateRuns } from './sweep.mjs?v=20261002-model8';
import { DrfMap, drawMetricHistory, drawSweep, drawHistogram, drawProfile, drawCounts } from './render.mjs?v=20261002-grid6';
import { createWalls, sampleWalls } from './wall.mjs';
import { download, png300dpi } from '../surf/exports.mjs';

const $ = id => document.getElementById(id), form = $('settings');
const state = { mode: 'idle', scenario: null, grid: null, frames: [], evaluations: [], selected: 0, next: 0,
  busy: false, replay: false, replayAt: 0, generation: 0, workers: [], sweep: null, sweepRuns: [], valid: false, followLive: true };
let fieldWorker, evalWorker, hoverWorker, hoverTimer, hoverGeneration = 0, replayFrame = 0, reference = [], provenance = {};
const fmt = (v, places = 3) => typeof v !== 'number' ? '—' : Number.isFinite(v) ? v.toFixed(places) : v === Infinity ? '실패 (∞)' : v === -Infinity ? '실패 (−∞)' : '실패 (NaN)';
const notice = text => { $('status').textContent = text; };
function fillSettings(input) {
  for (const [key, value] of Object.entries(input)) {
    const field = form.elements.namedItem(key);
    if (field) field.type === 'checkbox' ? field.checked = value : field.value = String(value);
  }
}
function settings() {
  if (!form.reportValidity()) throw new Error('입력값과 허용 범위를 확인하세요.');
  const values = Object.fromEntries(new FormData(form)); values.specular = form.elements.namedItem('specular').checked;
  return normalizeInput(values);
}
function makeWorker(name, onProgress = () => {}) {
  const worker = globalThis.__drfOffline?.worker(name) ?? new Worker(new URL(`./${name}.worker.mjs?v=20261002-model8`, import.meta.url), { type: 'module' }), pending = new Map(); let id = 0, stopped = false;
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { onProgress(data); return; }
    const request = pending.get(data.requestId); if (!request) return;
    pending.delete(data.requestId);
    data.type === 'error' ? request.reject(new Error(data.message ?? data.error)) : request.resolve(data);
  };
  worker.onerror = event => { for (const p of pending.values()) p.reject(new Error(event.message)); pending.clear(); };
  const handle = { request(message) { return new Promise((resolve, reject) => {
    if (stopped) { reject(new Error('Cancelled')); return; }
    const requestId = ++id; pending.set(requestId, { resolve, reject }); worker.postMessage({ ...message, requestId });
  }); }, stop() { stopped = true; worker.terminate(); for (const p of pending.values()) p.reject(new Error('Cancelled')); pending.clear(); } };
  state.workers.push(handle); return handle;
}
function stopReplay() { cancelAnimationFrame(replayFrame); replayFrame = 0; state.replay = false; $('replayButton').textContent = '재생'; }
function controls() {
  const active = ['running', 'paused'].includes(state.mode), sweeping = !!state.sweep, preparing = active && !state.scenario;
  $('runButton').disabled = active || sweeping; $('pauseButton').disabled = !active || preparing;
  $('pauseButton').textContent = state.mode === 'paused' ? '계속 실행' : '일시정지';
  $('stepButton').disabled = preparing || state.busy || state.mode === 'running' || sweeping;
  $('cancelButton').disabled = !active;
  for (const el of form.elements) el.disabled = active || sweeping;
  for (const el of $('sweepSettings').elements) el.disabled = active || sweeping;
  $('sweepButton').disabled = active || sweeping; $('sweepCancel').disabled = !sweeping;
  $('timeSlider').max = state.frames.length; $('timeSlider').value = state.selected; $('timeSlider').disabled = !state.frames.length;
  $('replayButton').disabled = !state.frames.length;
  $('firstSnapshot').disabled = !state.frames.length;
  $('exportJson').disabled = (!state.valid || !state.frames.length) && !state.sweepRuns.length;
  for (const id of ['exportCsv', 'exportPng']) $(id).disabled = !state.valid || !state.frames.length;
  document.body.dataset.state = state.mode;
}
function cancel(clear = false) {
  state.generation++; hoverGeneration++; clearTimeout(hoverTimer); stopReplay();
  for (const worker of state.workers) worker.stop(); state.workers = [];
  fieldWorker = null; evalWorker = null; hoverWorker = null;
  state.busy = false; state.mode = clear ? 'idle' : 'cancelled';
  if (clear) {
    state.scenario = null; state.grid = null; state.frames = []; state.evaluations = []; state.selected = 0; state.next = 0; state.valid = false;
    state.followLive = true;
    $('mapCanvas').removeAttribute('data-field-hash');
    for (const view of [map,densityMap,contrastMap]) view.fit();
  } else if (state.frames.length && state.scenario) {
    // Preserve inspection of completed prefixes after cancellation; no future wire is supplied.
    hoverWorker = makeWorker('field'); evalWorker = makeWorker('eval');
    evalWorker.request({ type: 'init', scenario: state.scenario, grid: state.grid }).catch(error => { if (error.message !== 'Cancelled') notice(error.message); });
  }
  controls(); renderSelected();
}
async function prepare(single = false) {
  try {
    const input = settings(); cancel(true); state.mode = 'running'; const generation = state.generation; controls();
    location.hash = `v1=${encodeURIComponent(JSON.stringify(input))}`;
    notice('참 장면과 측정 기록을 생성하는 중입니다.');
    const scenarioWorker = makeWorker('scenario', ({ t, total }) => { if (generation === state.generation) notice(`측정 생성 ${t} / ${total}`); });
    const { scenario } = await scenarioWorker.request({ type: 'generate', input });
    if (generation !== state.generation) return;
    scenarioWorker.stop(); state.scenario = scenario; state.grid = createGrid(input.grid, input.grid); state.valid = true;
    fieldWorker = makeWorker('field'); evalWorker = makeWorker('eval'); hoverWorker = makeWorker('field');
    await Promise.all([
      fieldWorker.request({ type: 'init', grid: state.grid, numerical: { band: input.band, perimeter: input.perimeter } }),
      evalWorker.request({ type: 'init', scenario, grid: state.grid }),
    ]);
    if (generation !== state.generation) return;
    if (single) { state.mode = 'paused'; await advance(true); } else advance();
  } catch (error) { fail(error); }
}
function fail(error) {
  if (error.message === 'Cancelled') return;
  cancel(false); state.valid = false; controls(); notice(`실행 중단: ${error.message}`);
}
async function advance(single = false) {
  if (state.busy || !state.scenario || (state.mode !== 'running' && !single)) return;
  const generation = state.generation; state.busy = true; controls();
  try {
    const wire = state.scenario.wire[state.next];
    const data = await fieldWorker.request({ type: 'step', snapshot: wire });
    if (generation !== state.generation) return;
    const { type, requestId, ...frame } = data;
    const { evaluation } = await evalWorker.request({ type: 'evaluate', frame });
    if (generation !== state.generation) return;
    state.frames.push(frame); state.evaluations.push(evaluation); state.next++;
    if (state.followLive || !state.selected) state.selected = state.frames.length;
    $('timeSlider').value = state.selected; state.busy = false;
    renderSelected(); notice(`필드 계산 ${frame.t} / ${state.scenario.input.snapshots}`);
    if (state.next === state.scenario.wire.length) {
      state.mode = 'done'; controls(); const hash = await hashField(frame);
      if (generation !== state.generation) return;
      $('mapCanvas').dataset.fieldHash = hash;
      notice(`계산 완료 · 측정 생성 ${(state.scenario.simulatorMs / 1000).toFixed(2)} s · 참조 .m 원본 대조 미완료`);
    } else if (single) state.mode = 'paused';
    controls();
    if (state.mode === 'running') requestAnimationFrame(() => advance());
  } catch (error) { state.busy = false; fail(error); }
}
async function hashField(frame) {
  const bytes = new Uint8Array(frame.Dbar.byteLength + frame.betaHat.byteLength);
  bytes.set(new Uint8Array(frame.Dbar.buffer)); bytes.set(new Uint8Array(frame.betaHat.buffer), frame.Dbar.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
const inspect = point => {
  clearTimeout(hoverTimer); const generation = ++hoverGeneration;
  const frame = state.frames[state.selected - 1];
  if (!frame || point.index < 0 || !hoverWorker) { $('inspector').textContent = '지도 위로 포인터를 이동하면 격자 값을 표시합니다.'; return; }
  const grid = state.grid, ix = point.index % grid.nx, iy = Math.floor(point.index / grid.nx), x = grid.x[ix], y = grid.y[iy];
  hoverTimer = setTimeout(async () => {
    if (generation !== hoverGeneration || !hoverWorker) return;
    try {
      const value = await hoverWorker.request({ type: 'prefixInspect', grid, numerical: { band: state.scenario.input.band, perimeter: state.scenario.input.perimeter },
        snapshots: state.scenario.wire.slice(0, frame.t), index: point.index, epsilonA: frame.epsilonA });
      if (generation !== hoverGeneration) return;
      let wallDistance = '';
      if ($('showTruth').checked) {
        let distance = Infinity;
        for (const wall of state.scenario.walls) for (const p of wall) distance = Math.min(distance, Math.hypot(x - p[0], y - p[1]));
        wallDistance = ` · 벽 표본 거리 ${fmt(distance)} m · 평가 전용`;
      }
      $('inspector').textContent = `snapshot ${value.t} · 격자 (${fmt(x, 2)}, ${fmt(y, 2)}) m · D ${fmt(value.D)} · A ${fmt(value.A)} [1/m²] · Q ${value.Q} · D̄ ${fmt(value.Dbar)} · β̂ ${fmt(value.betaHat)}${wallDistance}`;
    } catch (error) { if (error.message !== 'Cancelled') $('inspector').textContent = `조회 중단: ${error.message}`; }
  }, 100);
};
const map = new DrfMap($('mapCanvas'),inspect),densityMap=new DrfMap($('densityCanvas'),inspect),contrastMap=new DrfMap($('contrastCanvas'),inspect);
let previewKey='',preview=[];
function previewWalls() {
  if (!$('showTruth').checked) return [];
  const scene=form.elements.namedItem('scene').value,seed=Number(form.elements.namedItem('seed').value),key=`${scene}:${seed}`;
  if (!Number.isInteger(seed) || seed<0 || seed>0xffffffff) return [];
  // Geometry preview belongs to display/evaluation only; no wire or inferred field is fabricated.
  if (key!==previewKey) { preview=sampleWalls(createWalls({scene,seed}));previewKey=key; }
  return preview;
}
function renderSelected() {
  hoverGeneration++;
  $('inspector').textContent = '지도 위로 포인터를 이동하면 격자 값을 표시합니다.';
  const frame = state.frames[state.selected - 1], evaluation = state.evaluations[state.selected - 1], scenario = state.scenario;
  const layers = Object.fromEntries(['showEllipses', 'showVehicles', 'showProxy', 'showTruth', 'showSpecular', 'showDiffuse', 'showObserved'].map(id => [id, $(id).checked]));
  const display={ grid: state.grid, frame, truth: scenario?.truth[state.selected - 1], wire: scenario?.wire[state.selected - 1], walls: scenario?.walls ?? previewWalls(),
    proxy: evaluation?.proxy, observed: evaluation?.observed, layers, heatField: $('heatField').value, scaleMode: $('scaleMode').value,
    history: scenario?.wire.slice(0, state.selected),aspectMode:$('aspectMode').value };
  map.set({...display,mode:'geometry'});
  const fieldLayers={showTruth:layers.showTruth,showVehicles:layers.showVehicles};
  densityMap.set({...display,layers:fieldLayers,heatField:'Dbar',focus:true});
  contrastMap.set({...display,layers:fieldLayers,heatField:'betaHat',focus:true});
  $('snapshotLabel').textContent = `${frame?.t ?? 0} / ${scenario?.input.snapshots ?? form.elements.namedItem('snapshots').value}`;
  $('qValue').textContent = frame?.Q ?? 0; $('acceptedValue').textContent = frame?.admitted ?? 0; $('rejectedValue').textContent = frame?.rejected ?? 0;
  const metricIds = { medianValue: 'medianError', p95Value: 'p95', f1Value: 'f1', msdValue: 'caMsd', hd95Value: 'caHd95' };
  for (const [id, key] of Object.entries(metricIds)) $(id).textContent = fmt(evaluation?.[key]);
  $('offwallValue').textContent = evaluation?.offwall == null ? '—' : fmt(100 * evaluation.offwall, 1);
  const diag = evaluation?.diagnostics;
  $('pathValue').textContent = diag ? `정반사 ${diag.specularCount} / diffuse ${diag.diffuseCount}` : '—';
  const times = state.frames.slice(0, state.selected).map(f => f.ms);
  $('timingValue').textContent = `snapshot p50 ${fmt(percentile(times, .5), 1)} / p95 ${fmt(percentile(times, .95), 1)} ms`;
  drawMetricHistory($('metricChart'), state.evaluations.slice(0, state.selected),$('historyMetric').value);
  if (diag) {
    $('diagnosticSummary').textContent = `diffuse / configuration ${fmt(diag.diffusePerConfig, 1)} · 거리 중복 ${diag.duplicateFraction == null ? '—' : fmt(100 * diag.duplicateFraction, 1) + '%'} · Theorem 2: 평균 ${fmt(diag.theoremMean)}, 중앙 ${fmt(diag.theoremMedian)}, n=${diag.ratios.length}, 음수=${diag.theoremNegative} · field offset ${fmt(evaluation.offset)} m / fold 예측 ${fmt(diag.foldPrediction)} m`;
    if (!$('diagnosticPanel').hidden) {
      drawHistogram($('diagnosticChart'), diag.ratios); drawCounts($('countChart'), diag.diffuseCounts, diag.predictedCounts); updateProfile();
    }
  }
  if (!diag) {
    $('diagnosticSummary').textContent = '실행 결과가 없습니다.';
    drawHistogram($('diagnosticChart'), []); drawProfile($('profileChart'), []); drawCounts($('countChart'), [], []);
  }
  const selectedConfig = $('configSelect').value;
  $('configSelect').replaceChildren(...(scenario?.truth[state.selected - 1]?.configs ?? []).map((c, k) => {
    const option = document.createElement('option'); option.value = k; option.textContent = `snapshot ${frame.t} · 차량 ${c.i}–${c.j}`; return option;
  }));
  $('configSelect').value = selectedConfig || '0';
  if (!$('configSelect').value && $('configSelect').options.length) $('configSelect').value = '0';
}
async function updateProfile() {
  if (!state.selected || !evalWorker) return;
  const selected = state.selected, generation = state.generation, configIndex = Number($('configSelect').value || 0);
  try {
    const { profile } = await evalWorker.request({ type: 'profile', t: state.frames[selected - 1].t, configIndex });
    if (generation === state.generation && selected === state.selected && configIndex === Number($('configSelect').value || 0)) drawProfile($('profileChart'), profile.cells);
  } catch (error) { if (error.message !== 'Cancelled') $('diagnosticSummary').textContent = error.message; }
}
function replayTick(time) {
  if (!state.replay) return;
  const interval = 250 / Number($('playbackSpeed').value);
  if (time - state.replayAt >= interval) {
    state.replayAt = time; state.selected = state.selected >= state.frames.length ? 1 : state.selected + 1;
    $('timeSlider').value = state.selected; renderSelected();
  }
  replayFrame = requestAnimationFrame(replayTick);
}
function toggleReplay() {
  if (!state.frames.length) return;
  if (state.replay) stopReplay(); else { state.followLive = false; state.replay = true; state.replayAt = 0; $('replayButton').textContent = '재생 정지'; replayFrame = requestAnimationFrame(replayTick); }
}
function firstSnapshot() {
  if (!state.frames.length) return;
  stopReplay(); if (state.mode === 'running') state.mode = 'paused';
  state.followLive = false; state.selected = 1; $('timeSlider').value = 1;
  for (const view of [map,densityMap,contrastMap]) view.fit();
  controls(); renderSelected(); notice('첫 snapshot으로 돌아왔습니다. 계산된 기록은 유지합니다.');
}
$('runButton').onclick = () => prepare();
$('pauseButton').onclick = () => { state.mode = state.mode === 'paused' ? 'running' : 'paused'; controls(); if (state.mode === 'running') { state.followLive = true; advance(); } else notice('현재 snapshot에서 일시정지했습니다.'); };
$('stepButton').onclick = () => { state.followLive = true; state.mode === 'paused' ? advance(true) : prepare(true); };
$('firstSnapshot').onclick = firstSnapshot;
$('cancelButton').onclick = () => { cancel(); notice('취소했습니다. 완전히 계산된 snapshot만 남겼습니다.'); };
$('resetButton').onclick = () => { state.sweep?.cancel(); state.sweepRuns = []; cancel(true); fillSettings(DEFAULT_INPUT); renderSelected(); location.hash = ''; renderSweep(); $('sweepStatus').textContent = '실행 결과가 없습니다.'; notice('기본 설정으로 재설정했습니다.'); };
form.addEventListener('change', () => { state.sweepRuns = []; cancel(true); renderSweep(); $('sweepStatus').textContent = '실행 결과가 없습니다.'; notice('설정이 바뀌어 이전 결과를 무효화했습니다.'); try { location.hash = `v1=${encodeURIComponent(JSON.stringify(settings()))}`; } catch (e) { notice(e.message); } });
$('timeSlider').oninput = () => { stopReplay(); state.followLive = false; state.selected = Number($('timeSlider').value); hoverGeneration++; renderSelected(); };
$('replayButton').onclick = toggleReplay;
document.addEventListener('keydown', event => {
  if (event.target.matches('input,select,textarea,button') || $('aboutDialog').open) return;
  if (event.code === 'Space') { event.preventDefault(); toggleReplay(); }
  if (['ArrowLeft', 'ArrowRight'].includes(event.key) && state.frames.length) {
    event.preventDefault(); stopReplay(); state.followLive = false; state.selected = Math.max(1, Math.min(state.frames.length, state.selected + (event.key === 'ArrowRight' ? 1 : -1)));
    $('timeSlider').value = state.selected; renderSelected();
  }
});
for (const id of ['showEllipses', 'showVehicles', 'showProxy', 'showTruth', 'showSpecular', 'showDiffuse', 'showObserved', 'heatField', 'scaleMode','historyMetric','aspectMode']) $(id).onchange = renderSelected;
$('fitView').onclick = () => { for (const view of [map,densityMap,contrastMap]) view.fit(true); }; $('zoomIn').onclick = () => map.zoom(1.3); $('zoomOut').onclick = () => map.zoom(1 / 1.3);
$('configSelect').onchange = updateProfile;
$('aboutButton').onclick = () => $('aboutDialog').showModal(); $('closeAbout').onclick = () => $('aboutDialog').close();
$('themeButton').onclick = () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'light' : 'dark'; renderSelected(); renderSweep();
};
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const selected = tab === button; tab.setAttribute('aria-selected', selected); $(tab.dataset.tab).hidden = !selected;
  }
  renderSelected(); renderSweep();
};
function renderSweep() {
  const aggregates = aggregateRuns(state.sweepRuns); if ($('sweepPanel').hidden) return;
  drawSweep($('sweepChart'), aggregates, reference);
  const body = $('sweepTable').querySelector('tbody'); body.replaceChildren();
  const statistic = (metric, total, scale = 1, places = 3) => {
    const counts = `유효 ${metric.n}/${total}, 실패 ${metric.failed}, 미관측 ${metric.missing}`;
    return metric.failed ? `실패 포함 (${counts})` : `${fmt(metric.mean == null ? null : scale * metric.mean, places)} ± ${fmt(metric.sd == null ? null : scale * metric.sd, places)} (${counts})`;
  };
  for (const row of aggregates) {
    const tr = document.createElement('tr');
    for (const value of [row.roughness, row.sigmaD, row.n, statistic(row.medianError, row.n), statistic(row.p95, row.n), statistic(row.offwall, row.n, 100, 1)]) {
      const cell = document.createElement('td'); cell.textContent = value; tr.append(cell);
    }
    body.append(tr);
  }
}
$('sweepButton').onclick = async () => {
  const generation = state.generation; let handle;
  try {
    const base = settings(), values = Object.fromEntries(new FormData($('sweepSettings'))), jobs = sweepJobs(base, parseValues(values.sweepNoise), parseValues(values.sweepRoughness), parseValues(values.sweepSeeds, true));
    state.sweepRuns = []; $('sweepButton').disabled = true; $('sweepCancel').disabled = false;
    $('sweepStatus').textContent = `0 / ${jobs.length} · 완료된 seed만 기록합니다.`;
    handle = state.sweep = startSweep(jobs, ({ completed, total, results }) => {
      if (generation !== state.generation) return;
      state.sweepRuns = results; $('sweepStatus').textContent = `${completed} / ${total} 완료 · 평균 ± 1 표준편차`; renderSweep();
    });
    controls();
    const result = await handle.promise;
    if (generation !== state.generation) return;
    state.sweepRuns = result.results;
    $('sweepStatus').textContent = `${result.cancelled ? '취소' : '완료'} · ${result.results.length} / ${jobs.length} · 원본 .m 대조 미완료`;
    renderSweep();
  } catch (error) { if (generation === state.generation) $('sweepStatus').textContent = `Sweep 중단: ${error.message}`; }
  finally { if (state.sweep === handle) { state.sweep = null; controls(); } }
};
$('sweepCancel').onclick = () => state.sweep?.cancel();
const jsonValue = (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : typeof value === 'number' && !Number.isFinite(value) ? null : value;
$('exportJson').onclick = () => {
  const data = { schema: 'echomap-drf/1', provenance, units: { position: 'm', range: 'm', poseCovariance: 'm²', roughnessInput: 'deg', truthAngles: 'rad', D: '1/m²', A: '1/m²', Dbar: '1/m²', betaHat: 'dimensionless', time: 'snapshot index; physical dt unspecified' },
    grid: state.grid ? { ...state.grid, arrayOrder: 'iy*nx+ix; ascending y; cell centers' } : null,
    input: state.scenario?.input ?? state.sweepRuns[0]?.input, measurement: state.scenario?.wire.slice(0, state.frames.length) ?? [], result: state.frames,
    evaluation: state.evaluations, truth: { role: 'evaluation only', walls: state.scenario?.walls ?? [], snapshots: state.scenario?.truth.slice(0, state.frames.length) ?? [] },
    sweep: { completeSeedResults: state.sweepRuns.map(({ final, ...run }) => run), aggregates: aggregateRuns(state.sweepRuns) } };
  download(new Blob([JSON.stringify(data, jsonValue)], { type: 'application/json' }), 'echomap-drf.json');
};
$('exportCsv').onclick = () => download(new Blob([snapshotCsv(state.frames, state.evaluations)], { type: 'text/csv;charset=utf-8' }), 'echomap-drf-snapshots.csv');
$('exportPng').onclick = async () => { try { const field=$('heatField').value;download(await png300dpi(await (field==='betaHat' ? contrastMap : densityMap).png()), `echomap-drf-${field}-300dpi.png`); } catch (error) { notice(`PNG 저장 중단: ${error.message}`); } };
const chartResize = new ResizeObserver(() => { renderSelected(); renderSweep(); });
chartResize.observe($('analysis-panel') ?? $('sweepPanel'));
chartResize.observe($('metricChart'));
window.addEventListener('resize', () => { renderSelected(); renderSweep(); });
window.addEventListener('beforeunload', () => { for (const worker of state.workers) worker.stop(); state.sweep?.cancel(); });
try {
  const raw = location.hash.startsWith('#v1=') ? JSON.parse(decodeURIComponent(location.hash.slice(4))) : DEFAULT_INPUT;
  fillSettings(normalizeInput(raw));
} catch (error) { fillSettings(DEFAULT_INPUT); notice(`URL 설정을 불러오지 못했습니다: ${error.message}`); }
(globalThis.__drfOffline ? Promise.resolve(globalThis.__drfOffline.metadata) : Promise.all([fetch(new URL('./provenance.json', import.meta.url)).then(r => r.json()), fetch(new URL('./reference/octave/fixtures.json', import.meta.url)).then(r => r.json())]))
  .then(([p, f]) => { provenance = p; reference = f.statistics; $('provenanceCommit').textContent = `기준 commit ${p.baseCommit.slice(0, 8)}`;
    $('provenanceCore').textContent = `core ${p.coreHash.slice(0, 12)}`; renderSweep(); })
  .catch(error => notice(`검증 정보를 불러오지 못했습니다: ${error.message}`));
controls(); renderSelected();
