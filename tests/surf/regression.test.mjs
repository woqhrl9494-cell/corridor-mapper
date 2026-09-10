import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { generateScenario, scenarioConfig } from "../../surf/scenario.mjs";
import { estimatorInput } from "../../surf/observations.mjs";
import {
  boundsOf,
  fitCamera,
  toScreen,
  toWorld,
  zoomCamera,
  visiblePoints,
} from "../../surf/map.mjs";
import { evaluateResult } from "../../surf/metrics.mjs";
import { exportData, pointCsv, png300dpi } from "../../surf/exports.mjs";
const require = createRequire(import.meta.url),
  Env = require("../../surf/environment.js"),
  root = new URL("../../", import.meta.url),
  read = (p) => JSON.parse(fs.readFileSync(new URL(p, root))),
  gunzip = (p) =>
    JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(p, root))));
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex"),
  hash = (v) => sha(JSON.stringify(canonical(v)));
for (const c of read("tests/surf/development-hashes.json"))
  test(`unchanged development generator: ${c.id}`, () => {
    const s = generateScenario(Env, c.config);
    assert.equal(hash(s.raw.records), c.records);
    assert.equal(hash(s.raw.poses), c.poses);
    assert.equal(hash(s.targets), c.targets);
    assert.equal(hash(s.evaluation.wall), c.wall);
    assert.equal(hash(s.evaluation.truth), c.truth);
  });
test("frozen algorithm/protocol/environment copied byte for byte", () => {
  for (const [p, hash] of Object.entries(read("surf/core/manifest.json").files))
    assert.equal(sha(fs.readFileSync(new URL(p, root))), hash);
  const entry=fs.readFileSync(new URL("surf/vendor/cross-entry.cjs",root),"utf8");
  assert.equal(sha(entry.slice(entry.indexOf("function legacyVP("),entry.indexOf("module.exports="))),read("surf/core/manifest.json").cross_function_body_sha256);
  const frozen=read("surf/core/B4_frozen_protocol.json");
  for(const file of read("surf/cross-build.json").inputs.filter(p=>!p.endsWith("cross-entry.cjs"))){
    const original=file.replace("surf/vendor/","code/");
    assert.equal(sha(fs.readFileSync(new URL(file,root))),frozen.source_files_sha256[original],original);
  }
  const c = read("surf/core/protocol.json");
  assert.deepEqual(c.surface.degrees, [2, 4, 6, 8]);
  assert.deepEqual(c.surface.lambdas, [0, 1e-5]);
});
test("reserved TEST-ID seeds cannot be executed by UI generator", () => {
  assert.throws(() => scenarioConfig({ seed: 3312001 }));
  assert.throws(() => scenarioConfig({ seed: 3312050 }));
});
const preview = gunzip("surf/reference/preview.json.gz");
test("wire boundary ignores truth, shape and future values before reading them", () => {
  const raw = structuredClone(preview.scene.raw),
    targets = preview.scene.targets,
    expected = estimatorInput(raw, targets);
  for (const k of ["truth", "shape", "evaluation", "seed", "poses"])
    Object.defineProperty(raw, k, {
      get() {
        throw Error("oracle read " + k);
      },
    });
  raw.records.push({
    t: 12.05,
    get tx() {
      throw Error("future observation read");
    },
  });
  const got = estimatorInput(raw, targets);
  assert.deepEqual(got, expected);
  assert.equal("run_id" in got.raw, false);
  assert.equal("poses" in got.raw, false);
  assert.ok(got.targets.every((t) => t.information_cutoff_s === 12));
});
test("reject malformed geometry and non-batch cutoff", () => {
  const raw = structuredClone(preview.scene.raw);
  raw.cutoff_s = 6;
  assert.throws(() => estimatorInput(raw, []));
  raw.cutoff_s = 12;
  raw.records[0].tx.x = NaN;
  assert.throws(() => estimatorInput(raw, []));
});
test("metre camera fits every point and has an inverse at desktop and mobile sizes", () => {
  for (const [w, h] of [
    [1000, 400],
    [235, 320],
    [1, 1],
  ]) {
    const bounds = { xmin: -15, xmax: 14, ymin: -14, ymax: 15 },
      c = fitCamera(bounds, w, h),
      box = { x: 55, y: 34, w, h };
    for (const p of [
      [-15, -14],
      [14, 15],
      [0, 0],
    ]) {
      const q = toScreen(p, c, box),
        r = toWorld(q, c, box);
      assert.ok(q[0] >= box.x && q[0] <= box.x + w);
      assert.ok(q[1] >= box.y && q[1] <= box.y + h);
      assert.ok(Math.hypot(r[0] - p[0], r[1] - p[1]) < 1e-10);
    }
    const a = toScreen([0, 0], c, box),
      x = toScreen([1, 0], c, box),
      y = toScreen([0, 1], c, box);
    assert.ok(Math.abs(x[0] - a[0] - (a[1] - y[1])) < 1e-10);
    const z = zoomCamera(c, 1.5, a, box);
    assert.ok(Math.hypot(...toWorld(a, z, box)) < 1e-10);
  }
});
test("auto-fit includes opposite hypotheses/candidates and ignores nonfinite geometry", () => {
  const scene = { raw: { poses: [] }, evaluation: { wall: [[0, 8]] } },
    r = {
      predictions: [],
      curves: [
        {
          points: [
            [-12, 8],
            [12, 8],
          ],
        },
        {
          points: [
            [-12, -8],
            [12, -8],
          ],
        },
      ],
      cross: { candidates: [{ x: [33, -17] }] },
    };
  assert.deepEqual(
    boundsOf(visiblePoints(scene, r, { curve: true, candidates: true })),
    { xmin: -12, xmax: 33, ymin: -17, ymax: 8 },
  );
  assert.equal(
    boundsOf([
      [1, 2],
      [NaN, 3],
    ]).xmin,
    1,
  );
});
test("point metrics reproduce frozen evaluation; dense curve is excluded", () => {
  const expected = read("tests/surf/preview-metrics.json"),
    result = evaluateResult(preview.result, preview.scene.evaluation);
  for (const row of expected) {
    const m = result[row.method === "SURF" ? "surf" : "cross"];
    assert.ok(Math.abs(m.contact_rmse_m - row.contact_m_rmse) < 1e-12);
    assert.ok(Math.abs(m.normal_rmse_deg - row.normal_deg_rmse) < 1e-7);
    assert.equal(m.observed_coverage, row.observed_coverage);
    assert.equal(m.count, row.unique_outputs);
  }
  const changed = structuredClone(preview.result);
  changed.curves = [{ points: preview.scene.evaluation.wall }];
  assert.deepEqual(evaluateResult(changed, preview.scene.evaluation), result);
});
test("JSON keeps input/measurement/result/Intended Point separate; CSV retains missing rows", () => {
  const d = exportData(preview.scene, preview.result, {});
  for (const k of ["input", "measurement", "result", "Intended Point"])
    assert.ok(d[k]);
  assert.equal(d.availability.mode, "BATCH");
  assert.ok(d.result.surf.every((p) => p.method_id === "SURF"));
  assert.equal(
    pointCsv(preview.scene, preview.result).trim().split("\r\n").length,
    441,
  );
});
test("300 dpi PNG metadata is 11811 px/m and preserves image data", async () => {
  const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==",
      "base64",
    ),
    out = Buffer.from(await (await png300dpi(new Blob([pixel]))).arrayBuffer());
  const idx = out.indexOf("pHYs");
  assert.ok(idx > 0);
  assert.equal(out.readUInt32BE(idx + 4), 11811);
  assert.equal(out.readUInt32BE(idx + 8), 11811);
  assert.equal(out[idx + 12], 1);
  assert.ok(out.includes(Buffer.from("IDAT")));
});
