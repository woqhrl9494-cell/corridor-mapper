import { SurfaceMap } from "./map.mjs";
import { estimatorInput } from "./observations.mjs";
import { evaluateResult } from "./metrics.mjs";
import { exportData, pointCsv, png300dpi, download } from "./exports.mjs";
const $ = (id) => document.getElementById(id),
  fmt = (x, d = 2) =>
    x === null || !Number.isFinite(x)
      ? "—"
      : x.toLocaleString("en-US", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        });
const state = {
  scene: null,
  result: null,
  metrics: null,
  busy: false,
  token: 0,
  engine: null,
  playing: false,
  timer: null,
};
const layers = () => ({
  truth: $("showTruth").checked,
  curve: $("showCurve").checked,
  normals: $("showNormals").checked,
  cross: $("showCross").checked,
  candidates: $("showCandidates").checked,
});
const map = new SurfaceMap($("mapCanvas"), () => {
  $("autoFit").checked = false;
});
function config() {
  return {
    mode: $("symmetric").checked ? "symmetric" : $("shape").value,
    nBots: +$("vehicles").value,
    rangeSigma: +$("noise").value,
    seed: +$("seed").value,
  };
}
function syncConfig() {
  const symmetric = $("symmetric").checked;
  if (symmetric) {
    $("shape").value = "symmetric";
    $("vehicles").value = "5";
    $("noise").value = "0";
    $("seed").value = "92004";
  } else {
    if ($("shape").value === "symmetric") $("shape").value = "arc";
    if ($("seed").value === "92004") $("seed").value = "3311001";
  }
  for (const b of document.querySelectorAll(".shape-choice")) {
    const active = b.dataset.mode === $("shape").value;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
    b.disabled = symmetric;
  }
  for (const id of ["vehicles", "noise", "seed"]) $(id).disabled = symmetric;
  $("pairCount").textContent =
    (+$("vehicles").value * (+$("vehicles").value - 1)) / 2;
}
function progress(text, ratio = 0, error = false) {
  $("progressText").textContent = text;
  $("progressBar").style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  document.querySelector(".progress-region").classList.toggle("error", error);
}
function busy(value) {
  state.busy = value;
  $("configFields").disabled = value;
  $("runButton").disabled = value;
  $("resetButton").disabled = value;
  $("cancelButton").hidden = !value;
  document.querySelector(".progress-region").classList.toggle("busy", value);
  $("runButton").querySelector("span").textContent = value
    ? "계산 중"
    : "시뮬레이션 실행";
}
function stopPlayback() {
  state.playing = false;
  clearInterval(state.timer);
  $("replayButton").setAttribute("aria-label", "차량 기록 재생");
  $("replayButton").innerHTML = '<svg><use href="#i-play"/></svg>';
}
function resetTime() {
  stopPlayback();
  $("timeSlider").value = "240";
  map.frame = 240;
  $("timeLabel").textContent = "12.00 / 12.00 s";
}
function render() {
  const { scene, result } = state;
  map.set(scene, result, layers());
  const c = scene?.config ?? config();
  $("runDescription").textContent =
    `${c.motion === "symmetric" || c.mode === "symmetric" ? "원호, 정확 대칭" : c.shape === "sine" || c.mode === "sine" ? "사인" : "원호"} / 차량 ${c.nBots}대 / ${c.rangeSigma ? `거리 오차 ${c.rangeSigma * 100} cm` : "무잡음"}`;
  $("exportJson").disabled =
    $("exportCsv").disabled =
    $("exportPng").disabled =
      !result;
  if (!result) {
    for (const id of ["contactMetric", "coverageMetric", "countMetric"])
      $(id).textContent = "—";
    $("countTotal").textContent = "";
    $("statusMetric").textContent = "계산 후 표시";
    $("resultStatus").textContent = state.busy ? "계산 중" : "실행 대기";
    $("resultStatus").className = "status-tag neutral";
    $("sourceTag").textContent = "관측 기록 준비";
    $("sourceTag").className = "source-tag";
    $("comparisonBody").innerHTML =
      '<tr><th>SURF</th><td colspan="5">시뮬레이션을 실행하면 비교 결과가 표시됩니다.</td></tr>';
    $("modelSummary").textContent = "12초 전체 관측 기록을 사용합니다.";
    $("modelDetails").textContent = "계산 후 표시됩니다.";
    return;
  }
  const { surf, cross } = state.metrics,
    fit = result.fit,
    saved = result.provenance.kind === "saved_development_example";
  $("contactMetric").textContent = fmt(
    surf.contact_rmse_m === null ? null : surf.contact_rmse_m * 1000,
    3,
  );
  $("coverageMetric").textContent = fmt(surf.observed_coverage * 100, 1);
  $("countMetric").textContent = surf.count;
  $("countTotal").textContent = `/ ${surf.requested}`;
  $("statusMetric").textContent =
    fit.status === "UNIQUE"
      ? "단일 가설 채택"
      : fit.status === "AMBIGUOUS"
        ? "여러 가설 유지, 단일 점 미출력"
        : "유효한 단일 곡면 없음";
  document.querySelector(".map-panel").dataset.ambiguous = String(
    fit.status === "AMBIGUOUS",
  );
  $("resultStatus").textContent = fit.status;
  $("resultStatus").className =
    "status-tag " +
    (fit.status === "UNIQUE"
      ? ""
      : fit.status === "AMBIGUOUS"
        ? "ambiguous"
        : "unsupported");
  $("sourceTag").textContent = saved
    ? "저장된 개발 예시"
    : "이 브라우저에서 계산";
  $("sourceTag").className = "source-tag" + (saved ? "" : " computed");
  $("comparisonBody").innerHTML = [
    ["SURF", surf, fit.seconds],
    ["CROSS", cross, result.cross.seconds],
  ]
    .map(
      ([name, m, t]) =>
        `<tr><th>${name}${name === "SURF" ? '<span class="table-tag">주 방법</span>' : ""}</th><td>${fmt(m.contact_rmse_m === null ? null : m.contact_rmse_m * 1000, 3)}</td><td>${fmt(m.normal_rmse_deg, 4)}</td><td>${fmt(m.observed_coverage * 100, 1)}</td><td>${m.count} / ${m.requested}</td><td>${fmt(t, 2)}${saved ? "*" : ""}</td></tr>`,
    )
    .join("");
  const selected = fit.selected_complexity;
  $("modelSummary").textContent =
    `${selected ? `degree ${selected.degree}, λ ${selected.lambda_m4}` : "모델 미선택"} / ${fit.selected_ids.length}개 가설${saved ? " / *저장된 원 실행 시간" : " / 엔진 준비 시간 제외"}`;
  const final = fit.hypotheses.filter((h) => h.stage === "FULL_REFIT"),
    checks = final.filter((h) => h.final_reflection_check),
    rejected = checks.filter((h) => !h.final_reflection_check.passed).length,
    rays = checks.reduce(
      (s, h) => s + h.final_reflection_check.rays_checked,
      0,
    );
  const statusText =
    fit.status === "AMBIGUOUS"
      ? "구별할 수 없는 가설을 함께 유지합니다. 지도에는 대안 곡면을 점선으로 표시하며 채택 접점은 출력하지 않습니다."
      : fit.status === "UNIQUE"
        ? "반사 조건과 추정 곡면의 가시성 검사를 통과한 단일 가설입니다."
        : "현재 모델로 관측값을 설명하는 유효한 가설을 찾지 못했습니다.";
  $("modelDetails").innerHTML =
    `<p>${statusText}</p><p>최종 가시성 검사 ${checks.length}개 가설, ${rays.toLocaleString()}개 경로 / 추가 기각 ${rejected}개. 열린 경로당 127개 내부 표본을 확인합니다.</p><p>coverage: 모든 참 반사점에서 0.12 m 이내인 참 벽 표본 중, 채택 접점에서 0.2 m 이내인 비율. 추정 곡선을 촘촘히 그린 점은 이 평가에 포함하지 않습니다.</p><p>시간: SURF는 모델 선택, 전체 기록 재적합과 가시성 검사. CROSS는 C 후보 생성과 교차 검증. 결과는 두 방법 모두 12초 기록이 준비된 후 사용 가능합니다.</p><div class="table-scroll"><table><thead><tr><th>degree</th><th>λ</th><th>검증 거리 RMSE (mm)</th><th>선택</th></tr></thead><tbody>${fit.model_scores.map((s) => `<tr><th>${s.degree}</th><td>${s.lambda_m4}</td><td>${fmt(Math.sqrt(s.validation_mse_m2) * 1000, 4)}</td><td>${selected && s.degree === selected.degree && s.lambda_m4 === selected.lambda_m4 ? "선택" : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}
function generate(c) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./scenario.worker.mjs", import.meta.url), {
      type: "module",
    });
    w.onmessage = ({ data }) => {
      w.terminate();
      data.error ? reject(Error(data.error)) : resolve(data.scene);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(Error(e.message));
    };
    w.postMessage({ id: 1, config: c });
  });
}
async function settingsChanged() {
  const token = ++state.token;
  syncConfig();
  resetTime();
  state.result = null;
  state.metrics = null;
  state.scene = null;
  render();
  progress("관측 기록을 생성하는 중");
  try {
    const scene = await generate(config());
    if (token !== state.token) return;
    state.scene = scene;
    render();
    progress("관측 기록 준비 완료. 실행을 눌러 곡면을 추정하세요.");
  } catch (e) {
    if (token === state.token) progress(e.message, 0, true);
  }
}
function accept(result) {
  state.result = result;
  state.metrics = evaluateResult(result, state.scene.evaluation);
  render();
}
function engine() {
  if (state.engine) return state.engine;
  const w = new Worker(new URL("./engine.worker.mjs", import.meta.url), {
    type: "module",
  });
  state.engine = w;
  w.onmessage = ({ data }) => {
    if (data.id !== state.token) return;
    if (data.kind === "progress")
      progress(
        data.label,
        data.total ? 0.5 + (0.45 * data.done) / data.total : 0.12,
      );
    if (data.kind === "result") {
      busy(false);
      accept(data.result);
      progress("계산 완료. 12초 전체 기록으로 평가했습니다.", 1);
    }
    if (data.kind === "error") {
      busy(false);
      progress(data.error, 0, true);
      state.result = null;
      render();
    }
  };
  w.onerror = (e) => {
    busy(false);
    progress(`계산 엔진 오류: ${e.message}`, 0, true);
    w.terminate();
    state.engine = null;
  };
  return w;
}
$("runButton").addEventListener("click", async () => {
  const token = ++state.token;
  busy(true);
  resetTime();
  state.result = null;
  state.metrics = null;
  render();
  progress("12초 관측 기록을 생성하는 중", 0.03);
  try {
    const scene = await generate(config());
    if (token !== state.token) return;
    state.scene = scene;
    render();
    const wire = estimatorInput(scene.raw, scene.targets);
    engine().postMessage({ id: token, ...wire });
  } catch (e) {
    if (token === state.token) {
      busy(false);
      progress(e.message, 0, true);
    }
  }
});
$("cancelButton").addEventListener("click", () => {
  ++state.token;
  state.engine?.terminate();
  state.engine = null;
  busy(false);
  render();
  progress("계산을 취소했습니다. 다시 실행할 수 있습니다.");
});
for (const id of ["vehicles", "noise", "seed", "symmetric", "shape"])
  $(id).addEventListener("change", settingsChanged);
for (const b of document.querySelectorAll(".shape-choice"))
  b.addEventListener("click", () => {
    $("shape").value = b.dataset.mode;
    settingsChanged();
  });
$("resetButton").addEventListener("click", () => {
  $("symmetric").checked = false;
  $("shape").value = "arc";
  $("vehicles").value = "5";
  $("noise").value = "0";
  $("seed").value = "3311001";
  $("autoFit").checked = true;
  map.auto = true;
  settingsChanged();
});
for (const id of [
  "showTruth",
  "showCurve",
  "showNormals",
  "showCross",
  "showCandidates",
])
  $(id).addEventListener("change", () =>
    map.set(state.scene, state.result, layers()),
  );
$("fitView").onclick = () => {
  $("autoFit").checked = true;
  map.fit();
};
$("zoomIn").onclick = () => map.zoom(1.3);
$("zoomOut").onclick = () => map.zoom(1 / 1.3);
$("autoFit").onchange = () => {
  map.auto = $("autoFit").checked;
  if (map.auto) map.fit();
};
function moveTime() {
  map.frame = +$("timeSlider").value;
  $("timeLabel").textContent = `${(map.frame * 0.05).toFixed(2)} / 12.00 s`;
  map.draw();
}
$("timeSlider").oninput = () => {
  stopPlayback();
  moveTime();
};
$("replayButton").onclick = () => {
  if (state.playing) {
    stopPlayback();
    return;
  }
  state.playing = true;
  if (+$("timeSlider").value >= 240) $("timeSlider").value = "1";
  moveTime();
  $("replayButton").setAttribute("aria-label", "차량 기록 일시정지");
  $("replayButton").innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM15 5h4v14h-4z"/></svg>';
  state.timer = setInterval(() => {
    const next = +$("timeSlider").value + 1;
    if (next > 240) {
      stopPlayback();
      return;
    }
    $("timeSlider").value = String(next);
    moveTime();
  }, 50);
};
$("aboutButton").onclick = () => $("aboutDialog").showModal();
$("closeAbout").onclick = () => $("aboutDialog").close();
$("aboutDialog").addEventListener("click", (e) => {
  if (e.target === $("aboutDialog")) {
    const b = $("aboutDialog").getBoundingClientRect();
    if (
      e.clientX < b.left ||
      e.clientX > b.right ||
      e.clientY < b.top ||
      e.clientY > b.bottom
    )
      $("aboutDialog").close();
  }
});
$("exportJson").onclick = () =>
  download(
    new Blob(
      [
        JSON.stringify(
          exportData(state.scene, state.result, state.metrics),
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    `EchoMap_${state.scene.raw.run_id}.json`,
  );
$("exportCsv").onclick = () =>
  download(
    new Blob([pointCsv(state.scene, state.result)], {
      type: "text/csv;charset=utf-8",
    }),
    `EchoMap_${state.scene.raw.run_id}_contacts.csv`,
  );
$("exportPng").onclick = async () =>
  download(
    await png300dpi(await map.png()),
    `EchoMap_${state.scene.raw.run_id}_300dpi.png`,
  );
async function initial() {
  const token = state.token;
  try {
    const res = await fetch(
      new URL("./reference/preview.json.gz", import.meta.url),
    );
    if (!res.ok) throw Error("예시를 불러오지 못했습니다.");
    const data = await new Response(
      res.body.pipeThrough(new DecompressionStream("gzip")),
    ).json();
    if (token !== state.token) return;
    state.scene = data.scene;
    accept(data.result);
    progress("저장된 B0–B3 개발 예시입니다. 실행을 누르면 다시 계산합니다.", 1);
  } catch (e) {
    if (token === state.token) {
      render();
      progress("예시를 불러오지 못했습니다. 실행을 눌러 계산하세요.", 0, true);
    }
  }
}
syncConfig();
render();
initial();
