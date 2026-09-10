import Cross from "./cross.bundle.mjs";
import { estimatorInput } from "./observations.mjs";
const ROOT = new URL("../", import.meta.url),
  CDN = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";
let ready = null,
  job = null;
const stage = (label, done = null, total = null) =>
  self.postMessage({ id: job, kind: "progress", label, done, total });
async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error(`파일을 불러오지 못했습니다 (${r.status}).`);
  return r.text();
}
async function verified(path, sha) {
  const source = await text(new URL(path, ROOT));
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== sha)
    throw Error(
      "동결 코드의 해시가 일치하지 않습니다. 새로고침 후 다시 실행하세요.",
    );
  return source;
}
async function initialize() {
  stage("계산 엔진을 준비하는 중");
  const manifest = JSON.parse(
    await text(new URL("surf/core/manifest.json", ROOT)),
  );
  const [module, source, config, bridge] = await Promise.all([
    import(CDN + "pyodide.mjs"),
    verified("surf/core/surface.py", manifest.files["surf/core/surface.py"]),
    verified(
      "surf/core/protocol.json",
      manifest.files["surf/core/protocol.json"],
    ),
    text(new URL("surf/core/browser_bridge.py", ROOT)),
  ]);
  const py = await module.loadPyodide({ indexURL: CDN });
  stage("수치 계산 라이브러리를 준비하는 중");
  await py.loadPackage("numpy");
  py.FS.writeFile("/home/pyodide/surface.py", source);
  py.globals.set("progress_callback", (done, total) =>
    stage(
      done <= 16 ? "곡면 모델을 비교하는 중" : "최종 곡면을 추정하는 중",
      done,
      total,
    ),
  );
  py.runPython(bridge);
  return { py, config, manifest };
}
self.onmessage = async ({ data }) => {
  if (job !== null) {
    self.postMessage({
      id: data.id,
      kind: "error",
      error: "이미 계산 중입니다.",
    });
    return;
  }
  job = data.id;
  try {
    const payload = estimatorInput(data.raw, data.targets);
    if (!ready) ready = initialize();
    const { py, config, manifest } = await ready;
    const cfg = JSON.parse(config);
    stage("같은 관측값으로 CROSS를 계산하는 중");
    const local = Cross.run(payload.raw, payload.targets, cfg);
    const cross = {
      predictions: local.windows.map((w, k) => {
        const decision = w.cross,
          h = w.candidates.find((h) => h.id === decision.candidateId),
          t = payload.targets[k];
        return {
          target_id: t.target_id,
          measurement_id: t.measurement_id,
          key: t.key,
          time_s: t.time_s,
          pair: t.pair,
          method_id: "CROSS_E0",
          valid: decision.status === "SINGLE_SUPPORTED",
          status: decision.status,
          x: h?.x ?? null,
          normal: h?.normal ?? null,
          selected_id: h?.id ?? null,
          alternative_ids: w.candidates.map((h) => h.id),
          available_at: 12,
          information_cutoff: 12,
        };
      }),
      candidates: local.candidates,
      seconds: local.timing.C_E0 + local.timing.CROSS,
    };
    stage("SURF 모델을 계산하는 중", 0, 18);
    py.globals.set("wire_raw", JSON.stringify(payload.raw));
    py.globals.set("wire_targets", JSON.stringify(payload.targets));
    py.globals.set("wire_config", config);
    const result = JSON.parse(
      await py.runPythonAsync(
        "browser_estimate(wire_raw,wire_targets,wire_config)",
      ),
    );
    stage("반사 조건과 가시성 확인 완료", 18, 18);
    self.postMessage({
      id: job,
      kind: "result",
      result: {
        ...result,
        cross,
        provenance: {
          kind: "browser_computed",
          frozen_source_sha256: manifest.frozen_source_sha256,
          surface_sha256: manifest.files["surf/core/surface.py"],
          runtime: "Pyodide 314.0.6",
          numpy: py.runPython("np.__version__"),
        },
      },
    });
    py.runPython("del wire_raw,wire_targets,wire_config");
  } catch (error) {
    self.postMessage({
      id: job,
      kind: "error",
      error: String(error.message || error),
    });
    ready = null;
  } finally {
    job = null;
  }
};
