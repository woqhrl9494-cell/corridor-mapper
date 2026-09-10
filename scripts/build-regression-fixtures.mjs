/** Record hashes and metrics from existing development files only. No estimator. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
const root = process.argv[2];
if (!root) throw Error("Provide existing B0–B3 folder.");
const read = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)));
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
const hash = (v) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const cases = fs
  .readdirSync(path.join(root, "raw"))
  .filter((n) => n.endsWith(".json.gz"))
  .sort()
  .map((n) => {
    const rid = n.replace(".json.gz", ""),
      raw = read(path.join(root, "raw", n)),
      ev = read(path.join(root, "evaluation_only", n)),
      targets = fs
        .readFileSync(path.join(root, "targets", rid + ".jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
    return {
      id: rid,
      config: {
        ...ev.config,
        mode: ev.config.motion === "symmetric" ? "symmetric" : ev.config.shape,
      },
      records: hash(raw.records),
      poses: hash(raw.poses),
      targets: hash(targets),
      wall: hash(ev.wall),
      truth: hash(ev.truth),
    };
  });
fs.writeFileSync(
  "tests/surf/development-hashes.json",
  JSON.stringify(cases, null, 2) + "\n",
);
const csv = fs
  .readFileSync(path.join(root, "metrics_by_run.csv"), "utf8")
  .trim()
  .split("\n")
  .map((s) => s.split(","));
const fields = csv.shift();
const wanted = [
  "method",
  "contact_m_rmse",
  "normal_deg_rmse",
  "observed_coverage",
  "unique_outputs",
  "targets",
];
const metrics = csv
  .map((row) => Object.fromEntries(fields.map((f, k) => [f, row[k]])))
  .filter(
    (m) =>
      m.run_id === "arc_5_0_3311001" && ["SURF", "CROSS_E0"].includes(m.method),
  )
  .map((m) =>
    Object.fromEntries(
      wanted.map((f) => [f, f === "method" ? m[f] : Number(m[f])]),
    ),
  );
fs.writeFileSync(
  "tests/surf/preview-metrics.json",
  JSON.stringify(metrics, null, 2) + "\n",
);
