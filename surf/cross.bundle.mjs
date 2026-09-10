var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// surf/vendor/legacy/tsri_surface_simulator_20260909/src/linalg.js
var require_linalg = __commonJS({
  "surf/vendor/legacy/tsri_surface_simulator_20260909/src/linalg.js"(exports, module) {
    (function(root, factory) {
      const api = factory();
      if (typeof module === "object") module.exports = api;
      else root.MomentLA = api;
    })(globalThis, () => {
      "use strict";
      const zeros = (n, m) => Array.from({ length: n }, () => Array(m).fill(0));
      const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), norm = (a) => Math.hypot(...a);
      const tr = (A) => A[0].map((_, j) => A.map((r) => r[j]));
      const mm = (A, B) => {
        const cols = tr(B);
        return A.map((r) => cols.map((c) => dot(r, c)));
      };
      const mv = (A, v) => A.map((r) => dot(r, v));
      function qr(A, tol = 1e-12) {
        const n = A[0].length, V = tr(A).map((r) => r.slice()), Q = [], R = zeros(n, n), perm = Array.from({ length: n }, (_, i) => i);
        let rank = 0;
        const scale = Math.max(...V.map(norm), 1e-300);
        for (let j = 0; j < n; j++) {
          let k = j;
          for (let l = j + 1; l < n; l++) if (norm(V[l]) > norm(V[k])) k = l;
          [V[j], V[k]] = [V[k], V[j]];
          [perm[j], perm[k]] = [perm[k], perm[j]];
          for (let i = 0; i < j; i++) [R[i][j], R[i][k]] = [R[i][k], R[i][j]];
          R[j][j] = norm(V[j]);
          if (R[j][j] <= tol * scale) break;
          Q[j] = V[j].map((v) => v / R[j][j]);
          rank++;
          for (let l = j + 1; l < n; l++) for (let repeat = 0; repeat < 2; repeat++) {
            const c = dot(Q[j], V[l]);
            R[j][l] += c;
            for (let i = 0; i < A.length; i++) V[l][i] -= c * Q[j][i];
          }
        }
        function solve(b) {
          const z = Array(n).fill(0), x = Array(n).fill(0);
          for (let j = rank - 1; j >= 0; j--) {
            let c = dot(Q[j], b);
            for (let k = j + 1; k < rank; k++) c -= R[j][k] * z[k];
            z[j] = c / R[j][j];
          }
          perm.forEach((k, j) => x[k] = z[j]);
          return x;
        }
        return { rank, solve, R, perm };
      }
      function cholesky(A) {
        const n = A.length, L = zeros(n, n);
        for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
          let v = A[i][j];
          for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
          if (i === j) {
            if (!(v > 0)) throw Error("Metric must be SPD");
            L[i][j] = Math.sqrt(v);
          } else L[i][j] = v / L[j][j];
        }
        return L;
      }
      function lower(L, b) {
        const x = [];
        for (let i = 0; i < L.length; i++) {
          let v = b[i];
          for (let j = 0; j < i; j++) v -= L[i][j] * x[j];
          x[i] = v / L[i][i];
        }
        return x;
      }
      function covariance(factors, dimension) {
        const C = zeros(dimension, dimension);
        for (const v of factors) for (let i = 0; i < dimension; i++) for (let j = 0; j < dimension; j++) C[i][j] += v[i] * v[j];
        return C;
      }
      function eigenSymmetric(A) {
        const n = A.length, V = zeros(n, n), D = A.map((r) => r.slice());
        for (let i = 0; i < n; i++) V[i][i] = 1;
        const scale = Math.max(...D.map((r) => Math.max(...r.map(Math.abs))), 1e-300);
        for (let it = 0; it < 100 * n * n; it++) {
          let p = 0, q = 1, largest = 0;
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(D[i][j]) > largest) {
            largest = Math.abs(D[i][j]);
            p = i;
            q = j;
          }
          if (largest < 1e-13 * scale) break;
          const phi = 0.5 * Math.atan2(2 * D[p][q], D[q][q] - D[p][p]), c = Math.cos(phi), s = Math.sin(phi), app = D[p][p], aqq = D[q][q], apq = D[p][q];
          for (let k = 0; k < n; k++) if (k !== p && k !== q) {
            const x = D[k][p], y = D[k][q];
            D[k][p] = D[p][k] = c * x - s * y;
            D[k][q] = D[q][k] = s * x + c * y;
          }
          D[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
          D[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
          D[p][q] = D[q][p] = 0;
          for (let k = 0; k < n; k++) {
            const x = V[k][p], y = V[k][q];
            V[k][p] = c * x - s * y;
            V[k][q] = s * x + c * y;
          }
        }
        return Array.from({ length: n }, (_, j) => ({ value: D[j][j], vector: V.map((r) => r[j]) })).sort((a, b) => b.value - a.value);
      }
      const wrapPi = (a) => Math.atan2(Math.sin(2 * a), Math.cos(2 * a)) / 2;
      return { zeros, dot, norm, tr, mm, mv, qr, cholesky, lower, covariance, eigenSymmetric, wrapPi };
    });
  }
});

// surf/vendor/legacy/tsri_surface_simulator_20260909/src/moments.js
var require_moments = __commonJS({
  "surf/vendor/legacy/tsri_surface_simulator_20260909/src/moments.js"(exports, module) {
    (function(root, factory) {
      const node = typeof module === "object", api = factory(node ? require_linalg() : root.MomentLA);
      if (node) module.exports = api;
      else root.TSRIMoments = api;
    })(globalThis, (LA) => {
      "use strict";
      const xy = (p) => [p.x, p.y], zero = () => [0, 0];
      function rangeSigma(r, o) {
        if (o.rangeObservationSigma !== void 0) return o.rangeObservationSigma;
        return o.legacyPreprocessSigmaFloor && o.rangeSigma === 0 && r.sigma === 1e-6 ? 0 : r.sigma ?? o.rangeSigma ?? 0.1;
      }
      function recordId(r) {
        return JSON.stringify([r.i, r.j, r.t, r.r, r.tx.x, r.tx.y, r.rx.x, r.rx.y, r.sigma ?? null]);
      }
      function cleanRecords(records, availableAt = Infinity) {
        const seen = /* @__PURE__ */ new Set(), out = [];
        for (const r of records) {
          if (r.t > availableAt + 1e-10) throw Error("Future observation rejected");
          if (![r.t, r.r, r.tx.x, r.tx.y, r.rx.x, r.rx.y].every(Number.isFinite)) throw Error("Invalid observation");
          const id = recordId(r);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ i: r.i, j: r.j, key: r.key, t: r.t, r: r.r, sigma: r.sigma, tx: { x: r.tx.x, y: r.tx.y }, rx: { x: r.rx.x, y: r.rx.y } });
        }
        if (out.length < 5) throw Error("At least five distinct observations required");
        for (let k = 0; k < out.length; k++) if (k && out[k].t <= out[k - 1].t || out[k].i !== out[0].i || out[k].j !== out[0].j) throw Error("Non-increasing times or mixed pair");
        return out;
      }
      function regression(T, metricCovariance) {
        const n = T.length, L0 = metricCovariance ? LA.cholesky(metricCovariance) : null, whiten = (v) => L0 ? LA.lower(L0, v) : v;
        const Tw = LA.tr(LA.tr(T).map(whiten)), factor = LA.qr(Tw);
        if (factor.rank < 3) throw Error("Temporal design rank deficient");
        const taps = LA.tr(Array.from({ length: n }, (_, j) => factor.solve(whiten(Array.from({ length: n }, (_2, i) => +(i === j))))));
        return { taps, rank: factor.rank };
      }
      function fit(raw, options = {}) {
        const records = cleanRecords(raw, options.available_at ?? Infinity), center = records[Math.floor(records.length / 2)], t0 = center.t, h = Math.max(...records.map((r) => Math.abs(r.t - t0)));
        const T = records.map((r) => [1, (r.t - t0) / h, ((r.t - t0) / h) ** 2]), n = records.length;
        const variances = records.map((r) => rangeSigma(r, options) ** 2);
        const R = options.rangeCovariance || LA.zeros(n, n).map((row, i) => row.map((_, j) => i === j ? variances[i] : 0));
        let metric = options.metricCovariance || null, metricKind = metric ? "provided_fixed_metric" : "identity";
        if (options.moment_weighting === "range_gls" && variances.every((v) => v > 0)) {
          metric = R;
          metricKind = "range_gls";
        }
        const { taps } = regression(T, metric), a = LA.mv(taps, records.map((r) => r.r)), Ca = LA.mm(LA.mm(taps, R), LA.tr(taps));
        const poseTaps = regression(T, null).taps, vtx = ["x", "y"].map((k) => LA.dot(poseTaps[1], records.map((r) => r.tx[k])) / h), vrx = ["x", "y"].map((k) => LA.dot(poseTaps[1], records.map((r) => r.rx[k])) / h);
        return {
          records,
          T,
          taps,
          poseTaps,
          a,
          Ca,
          R_range: R,
          metricKind,
          t0,
          h,
          tx: xy(center.tx),
          rx: xy(center.rx),
          vtx,
          vrx,
          rho: a[0],
          rate: a[1] / h,
          range_rate_covariance: [[Ca[0][0], Ca[0][1] / h], [Ca[1][0] / h, Ca[1][1] / h ** 2]],
          measurement_ids: records.map(recordId),
          source_window_id: JSON.stringify(records.map(recordId)),
          available_at: records.at(-1).t
        };
      }
      function geometry(x, m) {
        const deltas = [m.tx, m.rx].map((p) => x.map((v, k) => v - p[k])), dist = deltas.map(LA.norm);
        if (dist.some((d) => d < 1e-8)) return { valid: false, reason: "near_focus" };
        const e = deltas.map((d, i) => d.map((v) => v / dist[i])), H = e.map((v, i) => [[1 - v[0] * v[0], -v[0] * v[1]], [-v[0] * v[1], 1 - v[1] * v[1]]].map((row) => row.map((z) => z / dist[i])));
        const g = e[0].map((v, k) => v + e[1][k]), gn = LA.norm(g);
        if (gn < 1e-8) return { valid: false, reason: "small_gradient" };
        const F = dist[0] + dist[1], Ft = -LA.dot(e[0], m.vtx) - LA.dot(e[1], m.vrx), gt = LA.mv(H[0], m.vtx).map((v, k) => -v - LA.mv(H[1], m.vrx)[k]);
        const normal = g.map((v) => v / gn), G = [g, gt.map((v) => m.h * v)];
        return { valid: true, F, Ft, m: [F, m.h * Ft], e, H, g, gn, normal, theta: Math.atan2(normal[1], normal[0]), G };
      }
      function sources(m, options = {}) {
        if (options.errorSources) return options.errorSources;
        if (options.rangeCovariance) throw Error("Supply global errorSources for correlated range observations; cross-window correlations cannot be inferred");
        const out = [], n = m.records.length, c = Math.floor(n / 2), sumV = LA.dot(m.poseTaps[1], Array(n).fill(1)) / m.h;
        const make = (id) => ({ id, da: zero(), pi: zero(), pj: zero(), vi: zero(), vj: zero() });
        for (let k = 0; k < n; k++) {
          const sigma = rangeSigma(m.records[k], options);
          if (sigma) {
            const s = make("range:" + m.measurement_ids[k]);
            s.da = [m.taps[0][k] * sigma, m.taps[1][k] * sigma];
            out.push(s);
          }
        }
        for (const [who, id] of [["i", m.records[0].i], ["j", m.records[0].j]]) for (let d = 0; d < 2; d++) {
          const sigma = options.poseSigma ?? 0;
          if (sigma) {
            const s = make(`vehicle:${id}:constant_bias:${d}`);
            s["p" + who][d] = sigma;
            s["v" + who][d] = (Math.abs(sumV) < 1e-13 ? 0 : sumV) * sigma;
            out.push(s);
          }
          const sp = options.poseIndependentSigma ?? 0;
          if (sp) for (let k = 0; k < n; k++) {
            const s = make(`vehicle:${id}:sample:${m.records[k].t}:${d}`);
            s["p" + who][d] = k === c ? sp : 0;
            s["v" + who][d] = m.poseTaps[1][k] / m.h * sp;
            out.push(s);
          }
        }
        return out;
      }
      function propagate(m, x, options = {}) {
        const geo = geometry(x, m);
        if (!geo.valid) return { valid: false, reason: geo.reason };
        const factor = LA.qr(geo.G), gram = LA.mm(geo.G, LA.tr(geo.G)), eig = LA.eigenSymmetric(gram), condition = eig.at(-1).value > 0 ? Math.sqrt(eig[0].value / eig.at(-1).value) : Infinity;
        if (factor.rank < 2) return { valid: false, reason: "moment_rank_deficient", condition };
        const nperp = [-geo.normal[1], geo.normal[0]], Ht = geo.H[0].map((r, i) => r.map((v, j) => v + geo.H[1][i][j]));
        const factors = sources(m, options).map((s) => {
          const de = [s.da[0] + LA.dot(geo.e[0], s.pi) + LA.dot(geo.e[1], s.pj), s.da[1] + m.h * (-LA.dot(LA.mv(geo.H[0], m.vtx), s.pi) - LA.dot(LA.mv(geo.H[1], m.vrx), s.pj) + LA.dot(geo.e[0], s.vi) + LA.dot(geo.e[1], s.vj))];
          const dx = factor.solve(de), dg = LA.mv(Ht, dx).map((v, k) => v - LA.mv(geo.H[0], s.pi)[k] - LA.mv(geo.H[1], s.pj)[k]), dtheta = LA.dot(nperp, dg) / geo.gn;
          return { id: s.id, e: de, y: [...dx, dtheta] };
        });
        const Ce = LA.covariance(factors.map((s) => s.e), 2), joint = LA.covariance(factors.map((s) => s.y), 3), Cx = joint.slice(0, 2).map((r) => r.slice(0, 2)), e = m.a.slice(0, 2).map((v, k) => v - geo.m[k]), spectrum = LA.eigenSymmetric(Ce);
        const stochasticRank = spectrum.filter((q) => q.value > Math.max(0, spectrum[0].value) * 1e-12 && q.value > 0).length;
        let Jstat = null;
        if (stochasticRank === 2) {
          const w = LA.lower(LA.cholesky(Ce), e);
          Jstat = LA.dot(w, w);
        }
        const biasMap = LA.tr([[1, 0], [0, 1]].map((v) => {
          const dx = factor.solve(v);
          return [...dx, LA.dot(nperp, LA.mv(Ht, dx)) / geo.gn];
        }));
        return {
          valid: true,
          normal: geo.normal,
          theta: geo.theta,
          condition,
          e,
          Jstat,
          C_e: Ce,
          Sigma_measurement_local: Cx,
          joint_position_normal_covariance: joint,
          stochasticRank,
          factors,
          biasMap,
          covariance_assumptions: "Linearized local measurement covariance; independent range errors and explicitly shared vehicle bias/sample factors; no model discrepancy included",
          model_bias_description: { kind: "unbounded", scope: "Temporal coefficient bias not specified; measurement ellipse is not a total 95% confidence region" }
        };
      }
      function crossCovariance(a, b) {
        const index = new Map(b.factors.map((s) => [s.id, s.y])), C = LA.zeros(3, 3);
        for (const s of a.factors) {
          const q = index.get(s.id);
          if (q) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += s.y[i] * q[j];
        }
        return C;
      }
      function momentObjective(m, x, Ce) {
        const g = geometry(x, m);
        if (!g.valid) return Infinity;
        const e = m.a.slice(0, 2).map((v, k) => v - g.m[k]), w = LA.lower(LA.cholesky(Ce), e);
        return LA.dot(w, w);
      }
      function stability(m, options = {}) {
        const cut = Math.floor(m.records.length / 4);
        if (cut < 2) return { kind: "unbounded", reason: "insufficient_nested_window" };
        const inner = fit(m.records.slice(cut, -cut), { ...options, metricCovariance: void 0, rangeCovariance: void 0 }), scale = m.h / inner.h;
        const A = m.taps.slice(0, 2).map((r) => r.slice());
        for (let j = 0; j < inner.records.length; j++) {
          A[0][j + cut] -= inner.taps[0][j];
          A[1][j + cut] -= scale * inner.taps[1][j];
        }
        const delta = [m.a[0] - inner.a[0], m.a[1] - scale * inner.a[1]], C = LA.mm(LA.mm(A, m.R_range), LA.tr(A));
        return {
          kind: "multiwindow_stability_only",
          unbounded_terms: ["range temporal remainder", "velocity-fit truncation", "association error"],
          delta_a01: delta,
          C_delta_measurement: C,
          outer_half_window: m.h,
          inner_half_window: inner.h,
          bound_available: false,
          interpretation: "Correlated nested-window diagnostic, not a mathematical or empirically calibrated bias bound. No covariance inflation or confidence claim.",
          normalization: "Both coefficient differences are metres; inner a1 rescaled to outer half-window."
        };
      }
      return { recordId, cleanRecords, regression, fit, geometry, sources, propagate, crossCovariance, momentObjective, stability };
    });
  }
});

// surf/vendor/legacy/tsri_surface_simulator_20260909/root_geometry.js
var require_root_geometry = __commonJS({
  "surf/vendor/legacy/tsri_surface_simulator_20260909/root_geometry.js"(exports, module) {
    (function(root, factory) {
      const api = factory();
      if (typeof module === "object") module.exports = api;
      else root.RootGeometry = api;
    })(globalThis, () => {
      "use strict";
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1], distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), TAU = 2 * Math.PI;
      function enumerate({ tx, rx, vtx, vrx, rho, rate }, nodes = 256) {
        if (![...tx, ...rx, ...vtx, ...vrx, rho, rate].every(Number.isFinite)) return { roots: [], status: "invalid_input" };
        const dx = rx[0] - tx[0], dy = rx[1] - tx[1], d = Math.hypot(dx, dy), a = rho / 2;
        if (!(rho > d + 1e-9)) return { roots: [], status: "degenerate_ellipse" };
        const b = Math.sqrt((rho - d) * (rho + d)) / 2, u = d > 1e-12 ? [dx / d, dy / d] : [1, 0], v = [-u[1], u[0]], c = tx.map((z, k) => (z + rx[k]) / 2);
        const point = (t) => c.map((z, k) => z + a * Math.cos(t) * u[k] + b * Math.sin(t) * v[k]);
        function evaluate(t) {
          const x = point(t), xp = u.map((z, k) => -a * Math.sin(t) * z + b * Math.cos(t) * v[k]);
          let h = rate, dh = 0;
          for (const [p, vel] of [[tx, vtx], [rx, vrx]]) {
            const q = x.map((z, k) => z - p[k]), r = Math.hypot(...q), e = q.map((z) => z / r);
            h += dot(e, vel);
            dh += (dot(xp, vel) - dot(e, vel) * dot(e, xp)) / r;
          }
          return { h, dh, x };
        }
        const scale = Math.max(1, Math.hypot(...vtx) + Math.hypot(...vrx) + Math.abs(rate)), tol = 1e-10 * scale;
        function scan(N) {
          const samples = Array.from({ length: N + 1 }, (_, j) => evaluate(TAU * j / N));
          if (samples.every((s) => Math.abs(s.h) < tol && Math.abs(s.dh) < tol)) return { roots: [], status: "continuum", nodes: N };
          const angles = [];
          const add = (t) => {
            const w = (t % TAU + TAU) % TAU;
            if (angles.every((z) => Math.min(Math.abs(z - w), TAU - Math.abs(z - w)) > 1e-7)) angles.push(w);
          };
          function bisect(lo, hi, field) {
            let fl = evaluate(lo)[field];
            for (let k = 0; k < 55; k++) {
              const mid = (lo + hi) / 2, fm = evaluate(mid)[field];
              if (fl * fm <= 0) hi = mid;
              else {
                lo = mid;
                fl = fm;
              }
            }
            return (lo + hi) / 2;
          }
          for (let j = 0; j < N; j++) {
            const lo = TAU * j / N, hi = TAU * (j + 1) / N, A = samples[j], B = samples[j + 1];
            if (Math.abs(A.h) < tol) add(lo);
            if (A.h * B.h < 0) add(bisect(lo, hi, "h"));
            if (A.dh * B.dh < 0) {
              const t = bisect(lo, hi, "dh");
              if (Math.abs(evaluate(t).h) < tol) add(t);
            }
          }
          const roots = angles.sort((a2, b2) => a2 - b2).map((psi) => ({ ...evaluate(psi), psi }));
          return { roots, status: roots.length ? "roots" : "no_roots", nodes: N };
        }
        let result = scan(nodes);
        if (result.roots.length === 1) {
          const refined = scan(nodes * 2);
          result = { ...refined, rescanned: true };
        }
        return { ...result, rho, rate, ellipse: { center: c, a, b, u, v } };
      }
      return { enumerate, dot, distance };
    });
  }
});

// surf/vendor/legacy/tsri_surface_simulator_20260909/cross_pair.js
var require_cross_pair = __commonJS({
  "surf/vendor/legacy/tsri_surface_simulator_20260909/cross_pair.js"(exports, module) {
    (function(root, factory) {
      const api = factory();
      if (typeof module === "object") module.exports = api;
      else root.CrossPair = api;
    })(globalThis, () => {
      "use strict";
      const defaults = Object.freeze({ selectionMode: "mixture", supportRatio: 3, minSupportPairs: 2, supportChi2: 9.210340372, discriminationMultiplier: 3 });
      function compatibility(a, b) {
        if (!a.covariance || !b.covariance) return null;
        const A = a.covariance[0][0] + b.covariance[0][0], B = a.covariance[0][1] + b.covariance[0][1], C = a.covariance[1][1] + b.covariance[1][1], det = A * C - B * B;
        if (!(det > 0)) return null;
        const dx = a.x[0] - b.x[0], dy = a.x[1] - b.x[1], d2 = (C * dx * dx - 2 * B * dx * dy + A * dy * dy) / det;
        return { d2, logDensity: -Math.log(2 * Math.PI) - 0.5 * Math.log(det) - 0.5 * d2 };
      }
      const logSumExp = (a) => {
        if (!a.length) return -Infinity;
        const m = Math.max(...a);
        return m === -Infinity ? m : m + Math.log(a.reduce((s, v) => s + Math.exp(v - m), 0));
      };
      function select(rows, config = {}) {
        const cfg = { ...defaults, ...config };
        for (const row of rows) {
          row.accepted = false;
          row.selectedId = null;
          const peers = rows.filter((r) => r !== row && r.method === row.method && r.pair !== row.pair && Math.abs(r.t0 - row.t0) < 1e-8 && !r.associationAmbiguous);
          const pairGroups = /* @__PURE__ */ new Map();
          for (const p of peers) {
            if (!pairGroups.has(p.pair)) pairGroups.set(p.pair, []);
            pairGroups.get(p.pair).push(p);
          }
          const positions = /* @__PURE__ */ new Map();
          for (const p of [row, ...peers]) if (p.observedCenter) {
            positions.set(p.observedCenter.i, p.observedCenter.tx);
            positions.set(p.observedCenter.j, p.observedCenter.rx);
          }
          for (const c of row.candidates) {
            const logs = [];
            let supportPairs = 0;
            for (const group of pairGroups.values()) {
              const scores = group.flatMap((p) => p.candidates).map((b) => compatibility(c, b)).filter(Boolean);
              if (scores.length) {
                logs.push(Math.max(...scores.map((s) => s.logDensity)));
                if (scores.some((s) => s.d2 <= cfg.supportChi2)) supportPairs++;
              }
            }
            const projections = [...positions.values()].map((p) => c.normal ? c.normal[0] * p.x + c.normal[1] * p.y : NaN);
            let gap = Infinity;
            for (let i = 0; i < projections.length; i++) for (let j = i + 1; j < projections.length; j++) gap = Math.min(gap, Math.abs(projections[i] - projections[j]));
            const n = c.normal, C = c.covariance, sigma = n && C ? Math.sqrt(Math.max(0, n[0] * n[0] * C[0][0] + 2 * n[0] * n[1] * C[0][1] + n[1] * n[1] * C[1][1])) : Infinity;
            c.supportLog = logSumExp(logs);
            c.supportPairs = supportPairs;
            c.discriminability = positions.size >= 3 ? gap : 0;
            c.sigmaPerp = sigma;
            c.discriminationOK = Number.isFinite(gap) && gap >= cfg.discriminationMultiplier * sigma;
          }
          const ordered = row.candidates.slice().sort((a, b) => b.supportLog - a.supportLog), best = ordered[0], second = ordered[1];
          const logRatio = second && Number.isFinite(best.supportLog) ? best.supportLog - second.supportLog : -Infinity;
          row.supportLogRatio = logRatio;
          row.reason = cfg.selectionMode === "mixture" ? "candidate_mixture" : row.associationAmbiguous ? "association_ambiguity" : !best?.eligible ? "local_quality" : best.supportPairs < cfg.minSupportPairs ? "insufficient_pair_support" : !best.discriminationOK ? "insufficient_diversity" : logRatio < Math.log(cfg.supportRatio) ? "cross_pair_ambiguity" : "experimental_support";
          if (row.reason === "experimental_support") {
            const keep = { candidates: row.candidates, rootCount: row.rootCount, totalIterations: row.totalIterations, totalEvaluations: row.totalEvaluations, ms: row.ms, starts: row.starts };
            Object.assign(row, best, keep, { accepted: true, selectedId: best.id, ambiguous: false, reason: "experimental_support" });
          }
        }
        return rows;
      }
      return { defaults, compatibility, select };
    });
  }
});

// surf/vendor/legacy/tsri-s-simulator/tsri_solver.js
var require_tsri_solver = __commonJS({
  "surf/vendor/legacy/tsri-s-simulator/tsri_solver.js"(exports, module) {
    (function(root, factory) {
      const api = factory();
      if (typeof module === "object") module.exports = api;
      else root.TSRI = api;
    })(globalThis, () => {
      "use strict";
      const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), norm = (a) => Math.sqrt(dot(a, a));
      const zeros = (n, m) => Array.from({ length: n }, () => Array(m).fill(0));
      const transpose = (A) => A[0].map((_, j) => A.map((r) => r[j]));
      const now = () => performance.now();
      function leastSquares(A, b, tol = 1e-12) {
        const m = A.length, n = A[0].length, V = transpose(A).map((c) => c.slice()), Q = [], R = zeros(n, n), perm = Array.from({ length: n }, (_, i) => i);
        const initial = Math.max(...V.map(norm), 1e-30);
        let rank = 0;
        for (let j = 0; j < n; j++) {
          let k = j;
          for (let l = j + 1; l < n; l++) if (norm(V[l]) > norm(V[k])) k = l;
          [V[j], V[k]] = [V[k], V[j]];
          [perm[j], perm[k]] = [perm[k], perm[j]];
          for (let i = 0; i < j; i++) [R[i][j], R[i][k]] = [R[i][k], R[i][j]];
          R[j][j] = norm(V[j]);
          if (R[j][j] <= tol * initial) break;
          Q[j] = V[j].map((v) => v / R[j][j]);
          rank++;
          for (let l = j + 1; l < n; l++) for (let repeat = 0; repeat < 2; repeat++) {
            const c = dot(Q[j], V[l]);
            R[j][l] += c;
            for (let i = 0; i < m; i++) V[l][i] -= c * Q[j][i];
          }
        }
        const z = Array(n).fill(0), x = Array(n).fill(0);
        for (let j = rank - 1; j >= 0; j--) {
          let c = dot(Q[j], b);
          for (let k = j + 1; k < rank; k++) c -= R[j][k] * z[k];
          z[j] = c / R[j][j];
        }
        perm.forEach((k, j) => {
          x[k] = z[j];
        });
        return { x, rank };
      }
      function cholesky(R) {
        const n = R.length, L = zeros(n, n);
        for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
          let v = R[i][j];
          for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
          if (i === j) {
            if (!(v > 0)) throw new Error("R must be positive definite");
            L[i][j] = Math.sqrt(v);
          } else L[i][j] = v / L[j][j];
        }
        return L;
      }
      function whiten(L, v) {
        const z = [];
        for (let i = 0; i < v.length; i++) {
          let t = v[i];
          for (let j = 0; j < i; j++) t -= L[i][j] * z[j];
          z[i] = t / L[i][i];
        }
        return z;
      }
      function geometry(x, m) {
        const dx = x[0] - m.tx.x, dy = x[1] - m.tx.y, ex = x[0] - m.rx.x, ey = x[1] - m.rx.y;
        const a = Math.max(1e-12, Math.hypot(dx, dy)), b = Math.max(1e-12, Math.hypot(ex, ey));
        return { f: a + b, g: [dx / a + ex / b, dy / a + ey / b], jp: [-dx / a, -dy / a, -ex / b, -ey / b] };
      }
      function prepare(records, reference, options = {}) {
        if (records.length < 5) throw new Error("At least 5 observations required");
        if (records.some((r, i) => !Number.isFinite(r.r + r.t + r.tx.x + r.tx.y + r.rx.x + r.rx.y) || i > 0 && r.t <= records[i - 1].t)) throw new Error("Invalid or non-increasing measurements");
        const center = records[Math.floor(records.length / 2)], t0 = center.t, h = Math.max(...records.map((m) => Math.abs(m.t - t0)));
        if (!(h > 0)) throw new Error("Nonzero time span required");
        const u2 = records.map((m) => ((m.t - t0) / h) ** 2), n = records.length;
        const jp = records.map((m) => geometry(reference, m).jp), sp = options.poseSigma || 0;
        const R = options.R || zeros(n, n).map((row, i) => row.map((_, j) => options.weighting === "ols" ? i === j ? 1 : 0 : (i === j ? Math.max(1e-12, (records[i].sigma ?? options.rangeSigma ?? 0.1) ** 2) : 0) + sp * sp * dot(jp[i], jp[j])));
        const L = cholesky(R), a = whiten(L, u2), aa = dot(a, a);
        return { records, t0, h, u2, L, a, aa, center, weighting: options.weighting || "gls" };
      }
      function evaluate(problem, q, projected = false) {
        const { records, L, a, aa, u2 } = problem, geom = records.map((m) => geometry(q, m));
        const d = whiten(L, records.map((m, i) => m.r - geom[i].f));
        const beta = projected ? dot(a, d) / aa : q[2], e = d.map((v, i) => v - beta * a[i]);
        const G = transpose([0, 1].map((j) => whiten(L, geom.map((g) => g.g[j]))));
        const J = projected ? transpose(transpose(G).map((c) => {
          const v = dot(a, c) / aa;
          return c.map((z, i) => z - v * a[i]);
        })) : G.map((r, i) => [...r, a[i]]);
        const raw = records.map((m, i) => m.r - geom[i].f - beta * u2[i]);
        return { e, J, beta, cost: dot(e, e), raw };
      }
      function dogleg(A, e, radius) {
        const cols = transpose(A), g = cols.map((c2) => dot(c2, e)), Ag = A.map((r) => dot(r, g));
        const alpha = dot(g, g) / Math.max(1e-30, dot(Ag, Ag)), sd = g.map((v) => alpha * v);
        const gn = leastSquares(A, e);
        if (gn.rank === g.length && norm(gn.x) <= radius) return gn.x;
        if (norm(sd) >= radius || gn.rank < g.length) return g.map((v) => v * radius / Math.max(norm(g), 1e-30));
        const delta = gn.x.map((v, i) => v - sd[i]), b = 2 * dot(sd, delta), c = dot(sd, sd) - radius * radius;
        const tau = (-b + Math.sqrt(Math.max(0, b * b - 4 * dot(delta, delta) * c))) / (2 * dot(delta, delta));
        return sd.map((v, i) => v + tau * delta[i]);
      }
      function solve(problem, initial, method = "lm", options = {}) {
        const started = now(), projected = method === "vp", p = projected ? 2 : 3;
        let q = initial.slice(0, p), ev = evaluate(problem, q, projected), lambda = 1e-3, nu = 2, radius = options.radius || 10;
        let evaluations = 1, accepted = 0, rejected = 0, status = "iteration_limit", iterations = 0;
        const history = [ev.cost], maxIter = options.maxIter ?? 60;
        for (let it = 0; it < maxIter; it++) {
          iterations = it + 1;
          const cols = transpose(ev.J), D = cols.map((c) => Math.max(1e-10, norm(c))), A = ev.J.map((r) => r.map((v, j) => v / D[j]));
          const g = transpose(A).map((c) => dot(c, ev.e)), gnorm = Math.max(...g.map(Math.abs));
          if (gnorm < 1e-7 * Math.max(1, norm(ev.e))) {
            status = "gradient";
            break;
          }
          let z;
          if (method === "tr") z = dogleg(A, ev.e, radius);
          else {
            const aug = A.concat(zeros(p, p).map((r, i) => r.map((_, j) => i === j ? Math.sqrt(lambda) : 0)));
            z = leastSquares(aug, ev.e.concat(Array(p).fill(0))).x;
          }
          const step = z.map((v, j) => v / D[j]), trial = q.map((v, j) => v + step[j]);
          const next = evaluate(problem, trial, projected);
          evaluations++;
          const model = ev.e.map((v, i) => v - dot(ev.J[i], step));
          const prediction = ev.cost - dot(model, model), actual = ev.cost - next.cost;
          const ratio = prediction > 0 ? actual / prediction : -Infinity;
          if (method === "tr") {
            if (ratio < 0.25) radius = Math.max(1e-12, radius * 0.25);
            else if (ratio > 0.75 && norm(z) > 0.9 * radius) radius = Math.min(1e6, radius * 2);
          }
          if (Number.isFinite(next.cost) && ratio > 1e-4 && actual > 0) {
            q = trial;
            ev = next;
            accepted++;
            history.push(ev.cost);
            if (method !== "tr") {
              lambda = Math.max(1e-15, lambda * Math.max(1 / 3, 1 - (2 * ratio - 1) ** 3));
              nu = 2;
            }
          } else {
            rejected++;
            if (method !== "tr") {
              lambda = Math.min(1e20, lambda * nu);
              nu = Math.min(nu * 2, 1e8);
            }
          }
          if (norm(step) < 1e-10 * (1 + norm(q)) || lambda >= 1e20 || radius <= 1e-12) {
            const c = transpose(ev.J), scaled = c.map((v) => Math.abs(dot(v, ev.e)) / Math.max(norm(v), 1e-10));
            status = Math.max(...scaled) < 1e-5 * Math.max(1, norm(ev.e)) ? "stationary" : "stalled";
            break;
          }
        }
        return {
          x: q.slice(0, 2),
          beta: ev.beta,
          b2: ev.beta / problem.h ** 2,
          cost: ev.cost,
          rmse: Math.sqrt(dot(ev.raw, ev.raw) / ev.raw.length),
          converged: status === "gradient" || status === "stationary",
          status,
          iterations,
          evaluations,
          accepted,
          rejected,
          history,
          ms: now() - started
        };
      }
      function eigen2(a, b, c) {
        const hi = (a + c + Math.hypot(a - c, 2 * b)) / 2, lo = hi > 0 ? Math.max(0, (a * c - b * b) / hi) : 0;
        return { lo, hi };
      }
      function uncertainty(problem, solution) {
        const ev = evaluate(problem, [...solution.x, solution.beta]), cols = transpose(ev.J), { a, aa } = problem;
        const v = cols.slice(0, 2).map((c) => {
          const k = dot(c, a) / aa;
          return c.map((z, i) => z - k * a[i]);
        });
        const A = dot(v[0], v[0]), B = dot(v[0], v[1]), C = dot(v[1], v[1]), eig = eigen2(A, B, C), det = A * C - B * B;
        const condition = eig.lo > eig.hi * 1e-14 ? Math.sqrt(eig.hi / eig.lo) : Infinity;
        const dof = problem.records.length - 3, scale = problem.weighting === "ols" ? Math.max(1e-12, solution.cost / dof) : 1;
        const covariance = det > 0 && Number.isFinite(condition) ? [[scale * C / det, -scale * B / det], [-scale * B / det, scale * A / det]] : null;
        const geo = geometry(solution.x, problem.center), g = geo.g, ng = norm(g), normal = ng > 1e-8 ? g.map((z) => z / ng) : null;
        const radius95 = covariance ? Math.sqrt(5.991 * eigen2(covariance[0][0], covariance[0][1], covariance[1][1]).hi) : Infinity;
        const reducedChi2 = solution.cost / dof;
        const scaled = cols.map((c) => c.map((z) => z / Math.max(norm(c), 1e-20)));
        const H = scaled.map((c) => scaled.map((d) => dot(c, d)));
        for (let it = 0; it < 24; it++) {
          let p = 0, q = 1;
          for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.abs(H[i][j]) > Math.abs(H[p][q])) {
            p = i;
            q = j;
          }
          if (Math.abs(H[p][q]) < 1e-14) break;
          const theta = 0.5 * Math.atan2(2 * H[p][q], H[q][q] - H[p][p]), c = Math.cos(theta), s = Math.sin(theta);
          const app = H[p][p], aqq = H[q][q], apq = H[p][q];
          for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
            const x = H[k][p], y = H[k][q];
            H[k][p] = H[p][k] = c * x - s * y;
            H[k][q] = H[q][k] = s * x + c * y;
          }
          H[p][p] = c * c * app - 2 * c * s * apq + s * s * aqq;
          H[q][q] = s * s * app + 2 * c * s * apq + c * c * aqq;
          H[p][q] = H[q][p] = 0;
        }
        const fullEigen = H.map((r, i) => r[i]), fullCondition = Math.min(...fullEigen) > 1e-14 ? Math.sqrt(Math.max(...fullEigen) / Math.min(...fullEigen)) : Infinity;
        return { covariance, normal, condition, fullCondition, radius95, reducedChi2 };
      }
      function initializers(records, count = 4) {
        const mid = Math.floor(records.length / 2), t0 = records[mid].t, h = Math.max(...records.map((m) => Math.abs(m.t - t0)));
        const T = records.map((m) => [1, (m.t - t0) / h, ((m.t - t0) / h) ** 2]), fit = leastSquares(T, records.map((m) => m.r)).x;
        const center = records[mid], vx = ["tx", "rx"].map((key) => ["x", "y"].map((dim) => leastSquares(T, records.map((m) => m[key][dim])).x[1] / h));
        const dx = center.rx.x - center.tx.x, dy = center.rx.y - center.tx.y, d = Math.hypot(dx, dy);
        if (!(fit[0] > d + 1e-6)) return [];
        const A = fit[0] / 2, B = Math.sqrt(A * A - d * d / 4), ex = d > 1e-9 ? dx / d : 1, ey = d > 1e-9 ? dy / d : 0;
        const at = (theta) => [
          (center.tx.x + center.rx.x) / 2 + A * Math.cos(theta) * ex - B * Math.sin(theta) * ey,
          (center.tx.y + center.rx.y) / 2 + A * Math.cos(theta) * ey + B * Math.sin(theta) * ex
        ];
        const f = (theta) => {
          const geo = geometry(at(theta), center);
          return dot(geo.jp, [...vx[0], ...vx[1]]) - fit[1] / h;
        };
        const roots = [], N = 96;
        for (let j = 0; j < N; j++) {
          let a = 2 * Math.PI * j / N, b = 2 * Math.PI * (j + 1) / N, fa = f(a), fb = f(b);
          if (fa * fb > 0) continue;
          for (let it = 0; it < 35; it++) {
            const c = (a + b) / 2, fc = f(c);
            if (fa * fc <= 0) {
              b = c;
              fb = fc;
            } else {
              a = c;
              fa = fc;
            }
          }
          roots.push((a + b) / 2);
        }
        const samples = Array.from({ length: N }, (_, j) => ({ theta: 2 * Math.PI * j / N, error: Math.abs(f(2 * Math.PI * j / N)) }));
        for (let j = 0; j < N; j++) if (samples[j].error <= samples[(j + N - 1) % N].error && samples[j].error <= samples[(j + 1) % N].error) roots.push(samples[j].theta);
        const seeds = [];
        for (const theta of roots.sort((a, b) => Math.abs(f(a)) - Math.abs(f(b)))) {
          const x = at(theta);
          if (seeds.every((s) => Math.hypot(s[0] - x[0], s[1] - x[1]) > 0.25)) seeds.push(x);
          if (seeds.length >= count) break;
        }
        return seeds;
      }
      function compare(records, options = {}) {
        const setup = now(), seeds = initializers(records, options.starts || 4);
        if (!seeds.length) return { reason: "initialization", results: {} };
        const provisional = prepare(records, seeds[0], { weighting: "ols" });
        seeds.sort((a, b) => evaluate(provisional, a, true).cost - evaluate(provisional, b, true).cost);
        const problem = prepare(records, seeds[0], options);
        const initials = seeds.map((x) => [...x, evaluate(problem, x, true).beta]);
        const setupMs = now() - setup, results = {};
        const order = ["lm", "tr", "vp"];
        const offset = (options.order || 0) % 3;
        for (let k = 0; k < 3; k++) {
          const method = order[(k + offset) % 3], start = now(), all = initials.map((q) => solve(problem, q, method, options)).sort((a, b) => a.cost - b.cost);
          const best = all[0], distinct = all.filter((v, i) => i === 0 || Math.hypot(v.x[0] - best.x[0], v.x[1] - best.x[1]) > 0.5);
          const info = uncertainty(problem, best), delta = distinct[1] ? distinct[1].cost - best.cost : Infinity;
          const comparableDelta = problem.weighting === "ols" ? delta / Math.max(1e-10, best.cost / (records.length - 3)) : delta;
          const ambiguous = distinct.length > 1 && comparableDelta < 3.84;
          const residualOK = problem.weighting === "gls" ? info.reducedChi2 <= 1 + 3 * Math.sqrt(2 / (records.length - 3)) : best.rmse < 3 * Math.max(options.rangeSigma || 0, 0.01);
          const accepted = best.converged && !ambiguous && info.condition < (options.maxCondition || 1e4) && info.radius95 < (options.maxRadius || 2) && residualOK && !!info.normal;
          results[method] = {
            ...best,
            ...info,
            accepted,
            ambiguous,
            alternatives: distinct.slice(1).map((s) => ({ x: s.x, cost: s.cost })),
            starts: all.length,
            totalIterations: all.reduce((s, v) => s + v.iterations, 0),
            totalEvaluations: all.reduce((s, v) => s + v.evaluations, 0),
            ms: now() - start,
            t0: problem.t0,
            availableAt: records.at(-1).t,
            lag: records.at(-1).t - problem.t0,
            reason: !best.converged ? best.status : ambiguous ? "multiple_solutions" : !Number.isFinite(info.condition) || info.condition >= (options.maxCondition || 1e4) ? "conditioning" : info.radius95 >= (options.maxRadius || 2) ? "uncertainty" : !residualOK ? "model_residual" : "accepted"
          };
        }
        return { results, seeds: initials, t0: problem.t0, setupMs, centerKey: problem.center.key };
      }
      return { leastSquares, cholesky, whiten, geometry, prepare, evaluate, solve, uncertainty, initializers, compare, dot, norm, eigen2 };
    });
  }
});

// surf/vendor/normal_events.js
var require_normal_events = __commonJS({
  "surf/vendor/normal_events.js"(exports, module) {
    "use strict";
    var dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    var norm = (a) => Math.hypot(...a);
    var mix = (a, b, u) => a.map((v, k) => v + (b[k] - v) * u);
    function geometry(h, a, b, u) {
      const n = h.normal, t = [-n[1], n[0]], dt = b.t - a.t, pi = mix(a.tx, b.tx, u), pj = mix(a.rx, b.rx, u), vi = a.tx.map((v, k) => (b.tx[k] - v) / dt), vj = a.rx.map((v, k) => (b.rx[k] - v) / dt);
      const di = h.x.map((v, k) => v - pi[k]), dj = h.x.map((v, k) => v - pj[k]), ri = norm(di), rj = norm(dj);
      if (Math.min(ri, rj) < 1e-8) return null;
      const ei = di.map((v) => v / ri), ej = dj.map((v) => v / rj), g = ei.map((v, k) => v + ej[k]);
      const Hvi = vi.map((v, k) => (v - ei[k] * dot(ei, vi)) / ri), Hvj = vj.map((v, k) => (v - ej[k] * dot(ej, vj)) / rj), gt = Hvi.map((v, k) => -v - Hvj[k]);
      const sideI = dot(ei, n), sideJ = dot(ej, n);
      return { phi: dot(t, g), phiDot: dot(t, gt), g, F: ri + rj, tx: pi, rx: pj, normalAlignment: Math.abs(dot(n, g)) / Math.max(norm(g), 1e-300), valid: norm(g) > 1e-6 && sideI * sideJ > 0 && Math.min(Math.abs(sideI), Math.abs(sideJ)) > 1e-6 };
    }
    function findEvents(h, positionTracks, options = {}) {
      const cfg = { pairMode: "disjoint", timeMode: "history", minSlope: 0.01, maxGap: 0.075, until: Infinity, substeps: 1, ...options };
      if (![...h.x, ...h.normal, h.availableAt].every(Number.isFinite) || Math.abs(norm(h.normal) - 1) > 1e-6) throw Error("Invalid candidate units/normal");
      const source = new Set(h.sourcePair), events = [], stats = { eligiblePairs: 0, weak: 0, invalidReflection: 0 };
      if (cfg.until < h.availableAt) return { events, stats };
      for (const track of positionTracks) {
        if (track.pair[0] === h.sourcePair[0] && track.pair[1] === h.sourcePair[1]) continue;
        const shared = track.pair.some((i) => source.has(i));
        if (cfg.pairMode === "disjoint" && shared) continue;
        stats.eligiblePairs++;
        let last = -Infinity;
        const ps = track.positions;
        for (let k = 1; k < ps.length; k++) {
          const a = ps[k - 1], b = ps[k];
          if (!(b.t > a.t)) throw Error("Non-increasing pose timestamps");
          if (b.t > cfg.until || b.t - a.t > cfg.maxGap) continue;
          if (cfg.timeMode === "prospective" && a.t < h.availableAt - 1e-10) continue;
          for (let part = 0; part < cfg.substeps; part++) {
            const l0 = part / cfg.substeps, r0 = (part + 1) / cfg.substeps, A = geometry(h, a, b, l0), B = geometry(h, a, b, r0);
            if (!A || !B) continue;
            if (Math.abs(A.phi) > 1e-12 && Math.abs(B.phi) > 1e-12 && A.phi * B.phi > 0) continue;
            let lo = l0, hi = r0, fl = A.phi;
            if (Math.abs(A.phi) <= 1e-12) hi = lo;
            else if (Math.abs(B.phi) <= 1e-12) lo = hi;
            else for (let it = 0; it < 42; it++) {
              const m = (lo + hi) / 2, v = geometry(h, a, b, m);
              if (!v) break;
              if (fl * v.phi <= 0) hi = m;
              else {
                lo = m;
                fl = v.phi;
              }
            }
            const u = (lo + hi) / 2, t = a.t + u * (b.t - a.t);
            if (Math.abs(t - last) < 1e-7) continue;
            last = t;
            const geo = geometry(h, a, b, u);
            if (!geo?.valid) {
              stats.invalidReflection++;
              continue;
            }
            if (Math.abs(geo.phiDot) < cfg.minSlope) {
              stats.weak++;
              continue;
            }
            events.push({ pair: track.pair.slice(), sharedVehicle: shared, t, availableAt: Math.max(h.availableAt, b.t), lowerTime: a.t, upperTime: b.t, u, ...geo });
          }
        }
      }
      events.sort((a, b) => a.availableAt - b.availableAt || a.t - b.t || a.pair[0] - b.pair[0] || a.pair[1] - b.pair[1]);
      return { events, stats };
    }
    function validateEvent(h, e, rangeTracks, rule = null) {
      const records = rangeTracks.get(e.pair.join(":")) || [], a = records.find((r) => Math.abs(r.t - e.lowerTime) < 1e-9), b = records.find((r) => Math.abs(r.t - e.upperTime) < 1e-9);
      if (!a || !b) return { ...e, status: "UNVERIFIED", reason: "missing_observation" };
      const ids = new Set(h.sourceIds);
      if (ids.has(a.key) || ids.has(b.key)) throw Error("Source measurement reuse");
      if (a.t > e.availableAt + 1e-9 || b.t > e.availableAt + 1e-9) throw Error("Future observation");
      const w = 1 - e.u, observed = w * a.r + e.u * b.r, residual = observed - e.F;
      const sigmaRange = Math.hypot(w * a.sigma, e.u * b.sigma), C = h.covariance || [[0, 0], [0, 0]], g = e.g, sourceVariance = g[0] * g[0] * C[0][0] + 2 * g[0] * g[1] * C[0][1] + g[1] * g[1] * C[1][1];
      const sigmaLinear = Math.sqrt(Math.max(0, sourceVariance) + sigmaRange * sigmaRange);
      const tolerance = rule ? rule.modelTolerance + rule.sigmaMultiplier * sigmaLinear : null;
      return { ...e, observationIds: [a.key, b.key], observed, residual, sigmaRange, sigmaLinear, tolerance, status: rule ? Math.abs(residual) <= tolerance ? "SUPPORTED" : "REJECTED" : "OBSERVED", reason: "range_checked" };
    }
    function audit(h, positionTracks, rangeTracks, options = {}, rule = null) {
      const found = findEvents(h, positionTracks, options), checked = found.events.map((e) => validateEvent(h, e, rangeTracks, rule));
      const first = checked.find((e) => e.reason === "range_checked") || null;
      return { id: h.id, events: checked, geometryStats: found.stats, decision: first, status: first?.status || "UNVERIFIED", delay: first ? first.availableAt - h.availableAt : null };
    }
    function resolveWindows(records) {
      const groups = /* @__PURE__ */ new Map();
      for (const r of records) {
        if (!groups.has(r.h.rowIndex)) groups.set(r.h.rowIndex, []);
        groups.get(r.h.rowIndex).push(r);
      }
      return [...groups].map(([rowIndex, rs]) => {
        const supported = rs.filter((r) => r.result.status === "SUPPORTED"), unverified = rs.filter((r) => r.result.status === "UNVERIFIED");
        if (supported.length !== 1 || unverified.length) return { rowIndex, status: unverified.length ? "UNVERIFIED_ALTERNATIVES" : supported.length > 1 ? "MULTIPLE_SUPPORTED" : "NO_SUPPORTED", x: null, availableAt: null };
        const availableAt = Math.max(...rs.map((r) => r.result.decision.availableAt));
        return { rowIndex, status: "SINGLE_SUPPORTED", candidateId: supported[0].h.id, x: supported[0].h.x.slice(), availableAt, delay: availableAt - Math.max(...rs.map((r) => r.h.availableAt)) };
      });
    }
    module.exports = { geometry, findEvents, validateEvent, audit, resolveWindows };
  }
});

// surf/vendor/cross-entry.cjs
var require_cross_entry = __commonJS({
  "surf/vendor/cross-entry.cjs"(exports, module) {
    var M = require_moments();
    var G = require_root_geometry();
    var CP = require_cross_pair();
    var S = require_tsri_solver();
    var N = require_normal_events();
    function legacyVP(records, options) {
      const seeds = S.initializers(records, options.starts || 4);
      if (!seeds.length) return { accepted: false, reason: "initialization" };
      const provisional = S.prepare(records, seeds[0], { weighting: "ols" });
      seeds.sort((a, b) => S.evaluate(provisional, a, true).cost - S.evaluate(provisional, b, true).cost);
      const problem = S.prepare(records, seeds[0], options), all = seeds.map((x) => S.solve(problem, [...x, S.evaluate(problem, x, true).beta], "vp", options)).sort((a, b) => a.cost - b.cost), best = all[0], distinct = all.filter((v, i) => i === 0 || Math.hypot(v.x[0] - best.x[0], v.x[1] - best.x[1]) > 0.5), info = S.uncertainty(problem, best), delta = distinct[1] ? distinct[1].cost - best.cost : Infinity;
      const comparableDelta = problem.weighting === "ols" ? delta / Math.max(1e-10, best.cost / (records.length - 3)) : delta, ambiguous = distinct.length > 1 && comparableDelta < 3.84, residualOK = problem.weighting === "gls" ? info.reducedChi2 <= 1 + 3 * Math.sqrt(2 / (records.length - 3)) : best.rmse < 3 * Math.max(options.rangeSigma || 0, 0.01);
      const accepted = best.converged && !ambiguous && info.condition < (options.maxCondition || 1e4) && info.radius95 < (options.maxRadius || 2) && residualOK && !!info.normal;
      return { ...best, ...info, accepted, ambiguous, alternatives: distinct.slice(1).map((s) => ({ x: s.x, cost: s.cost })), reason: !best.converged ? best.status : ambiguous ? "multiple_solutions" : !Number.isFinite(info.condition) || info.condition >= (options.maxCondition || 1e4) ? "conditioning" : info.radius95 >= (options.maxRadius || 2) ? "uncertainty" : !residualOK ? "model_residual" : "accepted" };
    }
    function run(raw, targets, protocol) {
      raw = { ...raw, records: raw.records.filter((r) => r.t <= raw.cutoff_s) };
      const started = performance.now(), byKey = new Map(raw.records.map((r) => [r.key, r])), tracks = raw.pairs.map((pair) => ({ pair, positions: raw.records.filter((r) => r.i === pair[0] && r.j === pair[1]).map((r) => ({ t: r.t, tx: [r.tx.x, r.tx.y], rx: [r.rx.x, r.rx.y] })) })), ranges = new Map(raw.pairs.map((pair) => [pair.join(":"), raw.records.filter((r) => r.i === pair[0] && r.j === pair[1])]));
      const windows = [], events = [], candidates = [], timing = { C_E0: 0, CROSS: 0, LEGACY_TSRI: 0, LEGACY_C_POINT: 0, CROSS_FIXED_TIMES: 0 };
      for (const [rowIndex, t] of targets.entries()) {
        const [i, j] = t.pair, records = Array.from({ length: 21 }, (_, k) => byKey.get(`${t.window_end_frame - 20 + k}:${i}:${j}`)), sourceIds = records.filter(Boolean).map((r) => r.key), base = { target: t, sourceIds, candidates: [], old: { accepted: false, reason: "missing_source" }, point: { accepted: false, reason: "missing_source" }, cross: { status: "NO_CANDIDATES" }, fixed: { status: "NO_CANDIDATES" } };
        windows.push(base);
        if (t.source_available_at_s > raw.cutoff_s || records.some((r) => !r)) continue;
        const options = { rangeSigma: raw.range_sigma_m, rangeObservationSigma: raw.range_sigma_m, poseSigma: 0, available_at: t.source_available_at_s, weighting: "gls", maxIter: 60, maxCondition: 1e4, maxRadius: 2, starts: 4, selectionMode: "point" };
        let begin2 = performance.now();
        const moment = M.fit(records, options), enumeration = G.enumerate(moment, 256);
        base.moments = { a: moment.a, rho: moment.rho, rate: moment.rate, tx: moment.tx, rx: moment.rx, vtx: moment.vtx, vrx: moment.vrx, status: enumeration.status };
        base.candidates = enumeration.roots.map((r, k) => {
          const p = M.propagate(moment, r.x, options), normal = M.geometry(r.x, moment).normal;
          return { id: `${t.target_id}/C/${k}`, rowIndex, rootIndex: k, x: r.x, normal, covariance: p.Sigma_measurement_local || null, condition: p.condition, eligible: p.valid && p.condition < 1e4, sourcePair: t.pair, t0: t.time_s, availableAt: t.source_available_at_s, sourceIds };
        });
        timing.C_E0 += (performance.now() - begin2) / 1e3;
        candidates.push(...base.candidates);
        begin2 = performance.now();
        base.old = legacyVP(records, options);
        timing.LEGACY_TSRI += (performance.now() - begin2) / 1e3;
        const audited = [];
        begin2 = performance.now();
        for (const h of base.candidates) {
          const a = N.audit(h, tracks, ranges, protocol.cross, protocol.cross);
          audited.push({ h, result: a });
          events.push(...a.events.map((e, k) => ({ ...e, event_id: h.id + "/event/" + k, candidate_id: h.id, target_id: t.target_id, variant: "CROSS_E0" })));
          h.cross_status = a.status;
          h.cross_decision = a.decision;
          h.geometryStats = a.geometryStats;
        }
        base.cross = N.resolveWindows(audited)[0] || { status: "NO_CANDIDATES" };
        timing.CROSS += (performance.now() - begin2) / 1e3;
        begin2 = performance.now();
        const fixed = [];
        for (const h of base.candidates) {
          let decision = null;
          outer: for (const tm of protocol.fixed_time_ablation.times_s) for (const tr of tracks) {
            if (tr.pair.some((x) => h.sourcePair.includes(x))) continue;
            const k = tr.positions.findIndex((p) => Math.abs(p.t - tm) < 1e-8);
            if (k < 1) continue;
            const a = tr.positions[k - 1], b = tr.positions[k], geo = N.geometry(h, a, b, 1);
            if (!geo) continue;
            const e = { ...geo, t: tm, pair: tr.pair, u: 1, lowerTime: a.t, upperTime: b.t, availableAt: Math.max(h.availableAt, b.t) };
            decision = N.validateEvent(h, e, ranges, protocol.cross);
            if (decision.reason === "range_checked") break outer;
          }
          const result = { status: decision?.status || "UNVERIFIED", decision };
          fixed.push({ h, result });
          if (decision) events.push({ ...decision, event_id: h.id + "/fixed", candidate_id: h.id, target_id: t.target_id, variant: "CROSS_FIXED_TIMES" });
          h.fixed_status = result.status;
        }
        base.fixed = N.resolveWindows(fixed)[0] || { status: "NO_CANDIDATES" };
        timing.CROSS_FIXED_TIMES += (performance.now() - begin2) / 1e3;
      }
      const begin = performance.now();
      for (const end of [...new Set(targets.map((t) => t.window_end_frame))]) {
        const ws = windows.filter((w) => w.target.window_end_frame === end), rows = ws.map((w) => ({ candidates: w.candidates.map((c, k) => ({ ...c, id: k })), pair: w.target.pair.join(":"), method: "vp", t0: w.target.time_s, observedCenter: byKey.get(w.target.key), associationAmbiguous: false }));
        CP.select(rows, { selectionMode: "point" });
        rows.forEach((r, k) => ws[k].point = { accepted: r.accepted, reason: r.reason, x: r.accepted ? r.x : null, normal: r.accepted ? r.normal : null, selectedId: r.selectedId });
      }
      timing.LEGACY_C_POINT = (performance.now() - begin) / 1e3;
      return { windows, candidates, events, timing, total_seconds: (performance.now() - started) / 1e3 };
    }
    module.exports = { run, legacyVP };
  }
});
export default require_cross_entry();
