import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PSPT } from "../../drf/pspt.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./pspt-reference.json", import.meta.url)));
const columns = Object.fromEntries(fixture.columns.map((name, i) => [name, i]));
const statusCode = { pending: 0, supported: 1, contradicted: -1 };
const close = (a, b, label, tolerance = 1e-7) => assert.ok(Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${label}: JS=${a}, Python=${b}`);
const prefix = (count = 5) => {
  const est = new PSPT();
  for (const wire of fixture.cases[0].wire.slice(0, count)) est.step(wire);
  return est;
};
const fingerprint = (est) => JSON.stringify({ groups: est.groups, D: [...est.drf.D], A: [...est.drf.A], Q: est.drf.Q,
  hist: est.hist, ncl: est.ncl, ncfg: est.ncfg, sr2: est.sr2, last_t: est.last_t, current_t: est.current_t,
  statistic: est.geometry_statistic, informative: est.geometry_informative });

function compareRows(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: candidate count`);
  const byId = new Map(actual.map((r) => [`${r.gid}:${r.side}`, r]));
  for (const row of expected) {
    const id = `${row[columns.gid]}:${row[columns.side]}`, r = byId.get(id);
    assert.ok(r, `${label}: missing ${id}`);
    for (const name of ["gid", "side", "sg", "birth", "group_nobs", "own_core_snapshots", "own_matched_snapshots"])
      assert.equal(r[name], row[columns[name]], `${label}/${id}/${name}`);
    assert.equal(statusCode[r.status], row[columns.status], `${label}/${id}/status`);
    for (const [name, value] of [["x", r.center[0]], ["y", r.center[1]], ["kappa", r.kappa], ["ell", r.ell], ["score", r.score]])
      close(value, row[columns[name]], `${label}/${id}/${name}`);
    const angle = r.phi - row[columns.phi];
    close(Math.atan2(Math.sin(angle), Math.cos(angle)), 0, `${label}/${id}/phi modulo 2pi`);
    close(Math.sqrt(Math.max(0, r.cov[0][0])), row[columns.n_sd], `${label}/${id}/normal SD`);
    close(Math.sqrt(Math.max(0, r.cov[1][1])), row[columns.phi_sd], `${label}/${id}/angle SD`);
    assert.equal(r.score_kind, "uncalibrated_composite_weight");
    assert.equal(r.P, r.score);
  }
}

test("guarded45 matches frozen Python checkpoints on measurement-only wire", () => {
  const full = process.env.PSPT_FULL_PARITY === "1", cases = full ? fixture.cases : fixture.cases.slice(0, 1);
  for (const one of cases) {
    const est = new PSPT(), checks = new Map(one.checks.map((entry) => [entry.t, entry.rows]));
    for (const wire of one.wire.slice(0, full ? 120 : 30)) {
      const rows = est.step(wire);
      if (checks.has(wire.t)) compareRows(rows, checks.get(wire.t), `${one.caseId}/t${wire.t}`);
      assert.ok(est.groups.every((g) => g.log.every(([t]) => t > g.birth)), "creation data entered evidence");
    }
  }
});

test("wire allowlist, malformed measurements and duplicate/reverse times reject before mutation", () => {
  const est = prefix(), before = fingerprint(est), next = fixture.cases[0].wire[5];
  const invalid = [];
  for (const t of [5, 4, 7, NaN, Infinity, 0, 6.5]) invalid.push({ ...structuredClone(next), t });
  let getterRead = false;
  const poisoned = structuredClone(next);
  Object.defineProperty(poisoned, "wallSide", { enumerable: true, get() { getterRead = true; throw Error("oracle read"); } });
  invalid.push(poisoned);
  for (const mutate of [
    (v) => { v.configs[0].truth = []; },
    (v) => { v.configs[0].paths[0].isSpecular = true; },
    (v) => { v.configs[0].Sigma_i = [-1, 0, 1]; },
    (v) => { v.configs[0].pHat_i[0] += 1; },
    (v) => { v.configs[0].paths[0].sigmaD = -.1; },
    (v) => { v.configs.push(structuredClone(v.configs[0])); },
    (v) => { for (const c of v.configs) { c.Sigma_i = [0, 0, 0]; c.Sigma_j = [0, 0, 0]; for (const p of c.paths) p.sigmaD = 0; } },
    (v) => { v.configs = []; },
  ]) { const value = structuredClone(next); mutate(value); invalid.push(value); }
  for (const wire of invalid) {
    assert.throws(() => est.step(wire));
    assert.equal(fingerprint(est), before);
  }
  assert.equal(getterRead, false);
  assert.throws(() => new PSPT({ seed: 1 }));
  assert.throws(() => new PSPT({ scene: "upper" }));
  assert.throws(() => new PSPT({ geometry_alpha: .05 }));
  assert.throws(() => new PSPT({ nx: NaN }));
  const fresh = new PSPT(), initial = fingerprint(fresh);
  assert.throws(() => fresh.step({ ...structuredClone(next), t: 2 }));
  assert.equal(fingerprint(fresh), initial);
  assert.throws(() => est.report(6));
  assert.throws(() => est.report(4));
  assert.equal(fingerprint(est), before);
  // C=190 pairs can share only 40 pose-error dimensions. sigmaD=0 must not
  // enter a potentially singular joint update even with positive pose noise.
  const twentyVehicleConfigs = [];
  for (let i = 1; i <= 20; i++) for (let j = i + 1; j <= 20; j++) twentyVehicleConfigs.push({
    i, j, pHat_i: [i, 15], pHat_j: [j, 15], Sigma_i: [.01, 0, .01], Sigma_j: [.01, 0, .01],
    paths: [{ dHat: Math.hypot(j - i, 12), sigmaD: 0 }],
  });
  assert.throws(() => est.step({ t: 6, configs: twentyVehicleConfigs }), /sigmaD > 0/);
  assert.equal(fingerprint(est), before);
});

test("all groups score against frozen t-1 weights independent of order and non-index IDs", () => {
  const a = prefix(), b = prefix();
  for (const est of [a, b]) {
    for (const g of est.groups) g.gid = 10 + 7 * g.gid;
    // Component test: freeze the existing candidate set, preserve original scoring/KF.
    est._births = () => {};
  }
  b.groups.reverse();
  for (const wire of fixture.cases[0].wire.slice(5, 9)) {
    const ra = a.step(wire), rb = new Map(b.step(wire).map((r) => [r.id, r]));
    for (const r of ra) {
      const other = rb.get(r.id);
      close(r.score, other.score, `${r.id}/score`, 1e-10);
      r.center.forEach((value, i) => close(value, other.center[i], `${r.id}/center`, 1e-10));
      assert.equal(r.status, other.status);
    }
  }
});

test("collinear pose geometry holds exact mirror alternatives", () => {
  const est = new PSPT(), sigma = [.01, 0, .01];
  for (let t = 1; t <= 7; t++) {
    const points = [5, 8, 11].map((x) => [x + .5 * t, 15]), configs = [];
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) configs.push({ i, j,
      pHat_i: points[i], pHat_j: points[j], Sigma_i: sigma, Sigma_j: sigma,
      paths: [{ dHat: Math.hypot(points[i][0] - points[j][0], 6), sigmaD: .1 }] });
    est.step({ t, configs });
  }
  const rows = est.report();
  assert.ok(rows.length > 0);
  assert.equal(est.geometry_informative, false);
  assert.ok(rows.every((r) => r.status === "pending" && r.qualified_active === 0));
});

test("past report values remain unchanged after future measurements and expose no truth fields", () => {
  const a = prefix(), b = prefix(), before = a.report(), saved = JSON.stringify(before);
  assert.equal(JSON.stringify(b.report()), saved);
  const changed = structuredClone(fixture.cases[0].wire[5]);
  for (const c of changed.configs) for (const p of c.paths) p.dHat += 3;
  a.step(changed);
  assert.equal(JSON.stringify(before), saved, "reports must copy mutable patch state");
  assert.ok(before.every((r) => !["wallSide", "truth", "seed", "walls", "future"].some((key) => key in r)));
  assert.ok(a.groups.every((g) => g.log.every(([t]) => t > g.birth)));
});
