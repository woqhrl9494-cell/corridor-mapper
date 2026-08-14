/*
 * Revised causal bistatic wall estimator.
 *
 * Input boundary per snapshot:
 *   {i, j, m, pI:{x,y}, pJ:{x,y}, SigmaI:[sxx,sxy,syy],
 *    SigmaJ:[sxx,sxy,syy], d, sigmaD, SigmaIJ?:[sxx,sxy,syy]}
 *
 * State per local mode:
 *   (W, H, s, Q, O, lastSupportedSnapshot).
 * The spatial grid is used only for indexing/capacity and field queries.
 */
(function attachRevisedWallEstimator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RevisedWallEstimator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildApi() {
  'use strict';

  const EPS = 1e-12;
  const TWO_PI = 2 * Math.PI;

  const DEFAULT_CONFIG = Object.freeze({
    worldWidth: 60,
    worldHeight: 30,
    cellSize: 1.0,
    deltaS: 1.5,
    minEllipseSamples: 12,
    arcLookupFactor: 8,
    cS: 0.5,
    sigmaModel: 0.12,
    KMode: 3,
    thetaMode: Math.PI / 6,
    tauB: 2.0,
    HConf: 3,
    TStale: 12,
    extractionRadiusCells: 2,
    thetaExtraction: Math.PI / 7,
    tauE: 0.015,
    tauC: 0.45,
    tauR: 0.10,
    tauD: 0.35,
    useVisibility: false,
    visibilityAlpha: 1.0,
    visibilityMin: 0.05,
    visibilityCoherence: 0.65,
    outputDedupTolerance: 0.20,
  });

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function covariance3(value, fallbackVariance) {
    if (Array.isArray(value) && value.length >= 3) {
      const a = Math.max(0, finiteOr(value[0], fallbackVariance));
      const b = finiteOr(value[1], 0);
      const c = Math.max(0, finiteOr(value[2], fallbackVariance));
      return [a, b, c];
    }
    if (Array.isArray(value) && value.length >= 2 && Array.isArray(value[0])) {
      const a = Math.max(0, finiteOr(value[0][0], fallbackVariance));
      const b = 0.5 * (finiteOr(value[0][1], 0) + finiteOr(value[1][0], 0));
      const c = Math.max(0, finiteOr(value[1][1], fallbackVariance));
      return [a, b, c];
    }
    return [fallbackVariance, 0, fallbackVariance];
  }

  function quad2(vx, vy, matrix) {
    return matrix[0] * vx * vx + 2 * matrix[1] * vx * vy + matrix[2] * vy * vy;
  }

  function det2(a, b, c) {
    return a * c - b * b;
  }

  function eigenvaluesSym2(a, b, c) {
    const tr = a + c;
    const disc = Math.sqrt(Math.max(0, (a - c) * (a - c) + 4 * b * b));
    return [0.5 * (tr + disc), 0.5 * (tr - disc)];
  }

  function dominantEigenvector(a, b, c) {
    const values = eigenvaluesSym2(a, b, c);
    const lambda = values[0];
    let x = b;
    let y = lambda - a;
    if (x * x + y * y < EPS) {
      if (a >= c) { x = 1; y = 0; }
      else { x = 0; y = 1; }
    }
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length, lambda1: values[0], lambda2: values[1] };
  }

  function axialTrace(nA, nB) {
    return nA[0] * nB[0] + 2 * nA[1] * nB[1] + nA[2] * nB[2];
  }

  function ellipsePerimeter(a, b) {
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b) + EPS);
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  }

  function bhattacharyyaKernelToMode(kernel, modeStats) {
    const aA = kernel.P00;
    const aB = kernel.P01;
    const aC = kernel.P11;
    const bA = modeStats.P00;
    const bB = modeStats.P01;
    const bC = modeStats.P11;
    const detA = det2(aA, aB, aC);
    const detB = det2(bA, bB, bC);
    if (!(detA > EPS) || !(detB > EPS)) return Infinity;

    const sA = 0.5 * (aA + bA);
    const sB = 0.5 * (aB + bB);
    const sC = 0.5 * (aC + bC);
    const detS = det2(sA, sB, sC);
    if (!(detS > EPS)) return Infinity;

    const dx = kernel.mx - modeStats.mx;
    const dy = kernel.my - modeStats.my;
    const quadratic = (sC * dx * dx - 2 * sB * dx * dy + sA * dy * dy) / detS;
    return 0.125 * quadratic + 0.5 * Math.log(detS / Math.sqrt(detA * detB));
  }

  class RevisedEstimator {
    constructor(config) {
      this.config = this._validateConfig({ ...DEFAULT_CONFIG, ...(config || {}) });
      this.reset();
    }

    _validateConfig(config) {
      const out = { ...config };
      out.worldWidth = Math.max(EPS, finiteOr(out.worldWidth, DEFAULT_CONFIG.worldWidth));
      out.worldHeight = Math.max(EPS, finiteOr(out.worldHeight, DEFAULT_CONFIG.worldHeight));
      out.cellSize = Math.max(0.05, finiteOr(out.cellSize, DEFAULT_CONFIG.cellSize));
      out.deltaS = Math.max(0.02, finiteOr(out.deltaS, DEFAULT_CONFIG.deltaS));
      out.minEllipseSamples = Math.max(4, Math.floor(finiteOr(out.minEllipseSamples, DEFAULT_CONFIG.minEllipseSamples)));
      out.arcLookupFactor = Math.max(4, Math.floor(finiteOr(out.arcLookupFactor, DEFAULT_CONFIG.arcLookupFactor)));
      out.cS = Math.max(0.05, finiteOr(out.cS, DEFAULT_CONFIG.cS));
      out.sigmaModel = Math.max(1e-6, finiteOr(out.sigmaModel, DEFAULT_CONFIG.sigmaModel));
      out.KMode = Math.max(1, Math.floor(finiteOr(out.KMode, DEFAULT_CONFIG.KMode)));
      out.thetaMode = clamp(finiteOr(out.thetaMode, DEFAULT_CONFIG.thetaMode), 0, Math.PI / 2);
      out.tauB = Math.max(0, finiteOr(out.tauB, DEFAULT_CONFIG.tauB));
      out.HConf = Math.max(1, Math.floor(finiteOr(out.HConf, DEFAULT_CONFIG.HConf)));
      out.TStale = Math.max(0, Math.floor(finiteOr(out.TStale, DEFAULT_CONFIG.TStale)));
      out.extractionRadiusCells = Math.max(0, Math.floor(finiteOr(out.extractionRadiusCells, DEFAULT_CONFIG.extractionRadiusCells)));
      out.thetaExtraction = clamp(finiteOr(out.thetaExtraction, DEFAULT_CONFIG.thetaExtraction), 0, Math.PI / 2);
      out.tauE = Math.max(0, finiteOr(out.tauE, DEFAULT_CONFIG.tauE));
      out.tauC = clamp(finiteOr(out.tauC, DEFAULT_CONFIG.tauC), 0, 1);
      out.tauR = Math.max(0, finiteOr(out.tauR, DEFAULT_CONFIG.tauR));
      out.tauD = Math.max(0, finiteOr(out.tauD, DEFAULT_CONFIG.tauD));
      out.visibilityAlpha = Math.max(0, finiteOr(out.visibilityAlpha, DEFAULT_CONFIG.visibilityAlpha));
      out.visibilityMin = clamp(finiteOr(out.visibilityMin, DEFAULT_CONFIG.visibilityMin), 0, 1);
      out.visibilityCoherence = clamp(finiteOr(out.visibilityCoherence, DEFAULT_CONFIG.visibilityCoherence), 0, 1);
      out.outputDedupTolerance = Math.max(0, finiteOr(out.outputDedupTolerance, DEFAULT_CONFIG.outputDedupTolerance));
      out.useVisibility = !!out.useVisibility;
      return out;
    }

    configure(partial) {
      this.config = this._validateConfig({ ...this.config, ...(partial || {}) });
    }

    reset() {
      this.cells = new Map();
      this.nextModeId = 1;
      this.lastSnapshot = -1;
      this.previousOcclusion = new Map();
      this.lastDiagnostics = this._newDiagnostics(-1);
    }

    _newDiagnostics(snapshot) {
      return {
        snapshot,
        admittedPaths: 0,
        nominallyRejectedPaths: 0,
        totalEllipseSamples: 0,
        degenerateNormalGuards: 0,
        localModes: 0,
        representedCells: 0,
        confirmedModes: 0,
        staleCandidatesRemoved: 0,
        capacityModesRemoved: 0,
        visibilityMin: 1,
        visibilityMean: 0,
        visibilitySamples: 0,
        updateRuntimeMs: 0,
        stateBytesApprox: 0,
        supportPoints: 0,
        ridgePoints: 0,
      };
    }

    _cellCoordinates(x, y) {
      return {
        ix: Math.floor(x / this.config.cellSize),
        iy: Math.floor(y / this.config.cellSize),
      };
    }

    _cellKey(ix, iy) {
      return `${ix},${iy}`;
    }

    _modeStats(mode) {
      const invW = 1 / Math.max(mode.W, EPS);
      const mx = mode.sx * invW;
      const my = mode.sy * invW;
      let P00 = mode.Q00 * invW - mx * mx;
      let P01 = mode.Q01 * invW - mx * my;
      let P11 = mode.Q11 * invW - my * my;
      P00 = Math.max(P00, 1e-10);
      P11 = Math.max(P11, 1e-10);
      let determinant = det2(P00, P01, P11);
      if (!(determinant > 1e-14)) {
        const jitter = Math.max(1e-10, 1e-8 - determinant);
        P00 += jitter;
        P11 += jitter;
        determinant = det2(P00, P01, P11);
      }
      const N00 = mode.O00 * invW;
      const N01 = mode.O01 * invW;
      const N11 = mode.O11 * invW;
      const eig = eigenvaluesSym2(N00, N01, N11);
      const coherence = Math.max(0, (eig[0] - eig[1]) / (eig[0] + eig[1] + EPS));
      return { mx, my, P00, P01, P11, determinant, N00, N01, N11, coherence };
    }

    _buildOcclusionMap() {
      const map = new Map();
      for (const [key, modes] of this.cells) {
        let confidence = 0;
        for (const mode of modes) {
          if (mode.H < this.config.HConf) continue;
          const stats = this._modeStats(mode);
          if (stats.coherence < this.config.visibilityCoherence) continue;
          const averageMass = mode.W / Math.max(mode.H, 1);
          confidence = Math.max(confidence, clamp(averageMass * stats.coherence, 0, 1));
        }
        if (confidence > 0) map.set(key, confidence);
      }
      return map;
    }

    _rayOpticalDepth(origin, target, cache) {
      const targetCell = this._cellCoordinates(target.x, target.y);
      const cacheKey = `${origin.x.toFixed(5)},${origin.y.toFixed(5)}>${targetCell.ix},${targetCell.iy}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const length = Math.hypot(dx, dy);
      if (!(length > EPS) || this.previousOcclusion.size === 0) {
        cache.set(cacheKey, 0);
        return 0;
      }
      const nSteps = Math.max(1, Math.ceil(length / (0.5 * this.config.cellSize)));
      const ds = length / nSteps;
      let depth = 0;
      for (let k = 0; k < nSteps; k++) {
        const u = (k + 0.5) / nSteps;
        const x = origin.x + u * dx;
        const y = origin.y + u * dy;
        const cell = this._cellCoordinates(x, y);
        if (cell.ix === targetCell.ix && cell.iy === targetCell.iy) continue;
        const key = this._cellKey(cell.ix, cell.iy);
        // Midpoint quadrature at spacing <= cellSize/2. Repeated samples in
        // one traversed cell are intentional: q_c is integrated over the
        // actual ray length inside that cell instead of counted once per cell.
        depth += (this.previousOcclusion.get(key) || 0) * ds;
      }
      depth *= this.config.visibilityAlpha;
      cache.set(cacheKey, depth);
      return depth;
    }

    _sampleEllipse(measurement, diagnostics, rayCache) {
      const pI = measurement.pI;
      const pJ = measurement.pJ;
      const dx = pJ.x - pI.x;
      const dy = pJ.y - pI.y;
      const rho = Math.hypot(dx, dy);
      const d = finiteOr(measurement.d, NaN);
      if (!(d > rho)) {
        diagnostics.nominallyRejectedPaths++;
        return [];
      }
      diagnostics.admittedPaths++;

      const a = 0.5 * d;
      const focal = 0.5 * rho;
      const b2 = a * a - focal * focal;
      if (!(b2 > 0)) {
        diagnostics.nominallyRejectedPaths++;
        diagnostics.admittedPaths--;
        return [];
      }
      const b = Math.sqrt(b2);
      const perimeter = ellipsePerimeter(a, b);
      const count = Math.max(this.config.minEllipseSamples, Math.ceil(perimeter / this.config.deltaS));
      const lookupCount = Math.max(128, this.config.arcLookupFactor * count);
      const cumulative = new Float64Array(lookupCount + 1);
      let total = 0;
      let prevX = a;
      let prevY = 0;
      for (let k = 1; k <= lookupCount; k++) {
        const phi = TWO_PI * k / lookupCount;
        const x = a * Math.cos(phi);
        const y = b * Math.sin(phi);
        total += Math.hypot(x - prevX, y - prevY);
        cumulative[k] = total;
        prevX = x;
        prevY = y;
      }

      const centerX = 0.5 * (pI.x + pJ.x);
      const centerY = 0.5 * (pI.y + pJ.y);
      const angle = Math.atan2(dy, dx);
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const defaultVariance = 0;
      const SigmaI = covariance3(measurement.SigmaI, defaultVariance);
      const SigmaJ = covariance3(measurement.SigmaJ, defaultVariance);
      const SigmaIJ = measurement.SigmaIJ ? covariance3(measurement.SigmaIJ, 0) : null;
      const sigmaD = Math.max(0, finiteOr(measurement.sigmaD, 0));
      const sigmaParallel = this.config.cS * this.config.deltaS;
      const sigmaParallel2 = sigmaParallel * sigmaParallel;
      const kernels = new Array(count);
      let visibilitySum = 0;

      for (let n = 0; n < count; n++) {
        const targetArc = total * (n + 0.5) / count;
        let lo = 0;
        let hi = lookupCount;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (cumulative[mid] < targetArc) lo = mid;
          else hi = mid;
        }
        const denom = cumulative[hi] - cumulative[lo];
        const fraction = denom > EPS ? (targetArc - cumulative[lo]) / denom : 0;
        const phi = TWO_PI * (lo + fraction) / lookupCount;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        const localX = a * cp;
        const localY = b * sp;
        const mx = centerX + localX * ca - localY * sa;
        const my = centerY + localX * sa + localY * ca;

        const ri = Math.hypot(mx - pI.x, my - pI.y);
        const rj = Math.hypot(mx - pJ.x, my - pJ.y);
        const eiX = (mx - pI.x) / Math.max(ri, EPS);
        const eiY = (my - pI.y) / Math.max(ri, EPS);
        const ejX = (mx - pJ.x) / Math.max(rj, EPS);
        const ejY = (my - pJ.y) / Math.max(rj, EPS);
        const gx = eiX + ejX;
        const gy = eiY + ejY;
        const g2 = gx * gx + gy * gy;
        if (!(g2 > 1e-16)) diagnostics.degenerateNormalGuards++;
        const gLength = Math.sqrt(Math.max(g2, 1e-16));
        const nx = gx / gLength;
        const ny = gy / gLength;
        const tx = ny;
        const ty = -nx;

        let sigmaResidual2 = sigmaD * sigmaD + quad2(eiX, eiY, SigmaI) + quad2(ejX, ejY, SigmaJ);
        if (SigmaIJ) sigmaResidual2 += 2 * (SigmaIJ[0] * eiX * ejX + SigmaIJ[1] * (eiX * ejY + eiY * ejX) + SigmaIJ[2] * eiY * ejY);
        sigmaResidual2 = Math.max(0, sigmaResidual2);
        const sigmaPerp2 = this.config.sigmaModel * this.config.sigmaModel + sigmaResidual2 / Math.max(g2, 1e-16);
        const P00 = sigmaParallel2 * tx * tx + sigmaPerp2 * nx * nx;
        const P01 = sigmaParallel2 * tx * ty + sigmaPerp2 * nx * ny;
        const P11 = sigmaParallel2 * ty * ty + sigmaPerp2 * ny * ny;

        let visibility = 1;
        if (this.config.useVisibility) {
          const depthI = this._rayOpticalDepth(pI, { x: mx, y: my }, rayCache);
          const depthJ = this._rayOpticalDepth(pJ, { x: mx, y: my }, rayCache);
          visibility = Math.max(this.config.visibilityMin, Math.exp(-depthI - depthJ));
        }
        visibilitySum += visibility;
        diagnostics.visibilityMin = Math.min(diagnostics.visibilityMin, visibility);
        diagnostics.visibilitySamples++;
        kernels[n] = {
          mx, my,
          P00, P01, P11,
          N00: nx * nx,
          N01: nx * ny,
          N11: ny * ny,
          nx, ny,
          sigmaPerp2,
          w: visibility / count,
        };
      }
      diagnostics.totalEllipseSamples += count;
      if (count > 0 && this.config.useVisibility) diagnostics.visibilityMean += visibilitySum;
      return kernels;
    }

    _newMode(kernel, cell, snapshot) {
      const w = kernel.w;
      return {
        id: this.nextModeId++,
        cellX: cell.ix,
        cellY: cell.iy,
        W: w,
        H: 1,
        sx: w * kernel.mx,
        sy: w * kernel.my,
        Q00: w * (kernel.P00 + kernel.mx * kernel.mx),
        Q01: w * (kernel.P01 + kernel.mx * kernel.my),
        Q11: w * (kernel.P11 + kernel.my * kernel.my),
        O00: w * kernel.N00,
        O01: w * kernel.N01,
        O11: w * kernel.N11,
        lastSupportedSnapshot: snapshot,
        birthSnapshot: snapshot,
      };
    }

    _addKernel(mode, kernel, snapshot) {
      const w = kernel.w;
      mode.W += w;
      mode.sx += w * kernel.mx;
      mode.sy += w * kernel.my;
      mode.Q00 += w * (kernel.P00 + kernel.mx * kernel.mx);
      mode.Q01 += w * (kernel.P01 + kernel.mx * kernel.my);
      mode.Q11 += w * (kernel.P11 + kernel.my * kernel.my);
      mode.O00 += w * kernel.N00;
      mode.O01 += w * kernel.N01;
      mode.O11 += w * kernel.N11;
      if (mode.lastSupportedSnapshot !== snapshot) {
        mode.H += 1;
        mode.lastSupportedSnapshot = snapshot;
      }
    }

    _capacityScore(mode) {
      const stats = this._modeStats(mode);
      const averageMass = mode.W / Math.max(mode.H, 1);
      return averageMass * stats.coherence * Math.min(1, mode.H / this.config.HConf);
    }

    _assignKernel(kernel, snapshot, touchedCells) {
      if (!(kernel.w > 0)) return;
      const cell = this._cellCoordinates(kernel.mx, kernel.my);
      const key = this._cellKey(cell.ix, cell.iy);
      let modes = this.cells.get(key);
      if (!modes) {
        modes = [];
        this.cells.set(key, modes);
      }
      const cos2 = Math.cos(this.config.thetaMode) ** 2;
      let best = null;
      let bestDistance = Infinity;
      for (const mode of modes) {
        const stats = this._modeStats(mode);
        const orientation = axialTrace([stats.N00, stats.N01, stats.N11], [kernel.N00, kernel.N01, kernel.N11]);
        if (orientation < cos2) continue;
        const distance = bhattacharyyaKernelToMode(kernel, stats);
        if (distance > this.config.tauB) continue;
        if (distance < bestDistance - 1e-12 || (Math.abs(distance - bestDistance) <= 1e-12 && mode.id < best.id)) {
          best = mode;
          bestDistance = distance;
        }
      }
      if (best) this._addKernel(best, kernel, snapshot);
      else modes.push(this._newMode(kernel, cell, snapshot));
      touchedCells.add(key);
    }

    _pruneAndCap(snapshot, touchedCells, diagnostics) {
      for (const [key, modes] of this.cells) {
        const kept = modes.filter((mode) => {
          const stale = mode.H < this.config.HConf && snapshot - mode.lastSupportedSnapshot > this.config.TStale;
          if (stale) diagnostics.staleCandidatesRemoved++;
          return !stale;
        });
        if (touchedCells.has(key) && kept.length > this.config.KMode) {
          kept.sort((a, b) => {
            const delta = this._capacityScore(b) - this._capacityScore(a);
            return Math.abs(delta) > 1e-12 ? delta : a.id - b.id;
          });
          diagnostics.capacityModesRemoved += kept.length - this.config.KMode;
          kept.length = this.config.KMode;
        }
        kept.sort((a, b) => a.id - b.id);
        if (kept.length) this.cells.set(key, kept);
        else this.cells.delete(key);
      }
    }

    updateSnapshot(snapshot, measurements) {
      const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (!Number.isInteger(snapshot) || snapshot < 0) throw new Error('snapshot must be a non-negative integer');
      if (snapshot <= this.lastSnapshot) throw new Error('updateSnapshot must be called with strictly increasing snapshots');
      const diagnostics = this._newDiagnostics(snapshot);
      this.previousOcclusion = this._buildOcclusionMap();
      const rayCache = new Map();
      const touchedCells = new Set();
      const list = Array.isArray(measurements) ? measurements : [];
      for (const measurement of list) {
        if (!measurement || !measurement.pI || !measurement.pJ) continue;
        const kernels = this._sampleEllipse(measurement, diagnostics, rayCache);
        for (const kernel of kernels) this._assignKernel(kernel, snapshot, touchedCells);
      }
      this._pruneAndCap(snapshot, touchedCells, diagnostics);
      this.lastSnapshot = snapshot;

      let modeCount = 0;
      let confirmed = 0;
      for (const modes of this.cells.values()) {
        modeCount += modes.length;
        for (const mode of modes) if (mode.H >= this.config.HConf) confirmed++;
      }
      diagnostics.localModes = modeCount;
      diagnostics.representedCells = this.cells.size;
      diagnostics.confirmedModes = confirmed;
      diagnostics.stateBytesApprox = modeCount * 18 * 8;
      if (modeCount > this.cells.size * this.config.KMode) throw new Error('state bound R_t <= B_t K_mode violated');
      if (diagnostics.visibilitySamples > 0) {
        diagnostics.visibilityMean = this.config.useVisibility
          ? diagnostics.visibilityMean / diagnostics.visibilitySamples
          : 1;
      }
      const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      diagnostics.updateRuntimeMs = t1 - t0;
      this.lastDiagnostics = diagnostics;
      return { ...diagnostics };
    }

    _confirmedModes() {
      const out = [];
      for (const modes of this.cells.values()) {
        for (const mode of modes) if (mode.H >= this.config.HConf) out.push(mode);
      }
      out.sort((a, b) => a.id - b.id);
      return out;
    }

    _neighbors(seed) {
      const out = [];
      const seedStats = this._modeStats(seed);
      const radius = this.config.extractionRadiusCells;
      const cos2 = Math.cos(this.config.thetaExtraction) ** 2;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const modes = this.cells.get(this._cellKey(seed.cellX + ox, seed.cellY + oy));
          if (!modes) continue;
          for (const mode of modes) {
            if (mode.H < this.config.HConf) continue;
            const stats = this._modeStats(mode);
            if (axialTrace([seedStats.N00, seedStats.N01, seedStats.N11], [stats.N00, stats.N01, stats.N11]) >= cos2) {
              out.push({ mode, stats });
            }
          }
        }
      }
      out.sort((a, b) => a.mode.id - b.mode.id);
      return out;
    }

    evaluateModeField(x, y, neighborEntries) {
      let g = 0;
      let gradX = 0;
      let gradY = 0;
      let h00 = 0;
      let h01 = 0;
      let h11 = 0;
      let M00 = 0;
      let M01 = 0;
      let M11 = 0;
      let weightedP00 = 0;
      let weightedP01 = 0;
      let weightedP11 = 0;
      const entries = neighborEntries || [];

      for (const entry of entries) {
        const mode = entry.mode || entry;
        const stats = entry.stats || this._modeStats(mode);
        const determinant = stats.determinant;
        if (!(determinant > EPS)) continue;
        const inv00 = stats.P11 / determinant;
        const inv01 = -stats.P01 / determinant;
        const inv11 = stats.P00 / determinant;
        const dx = x - stats.mx;
        const dy = y - stats.my;
        const ux = inv00 * dx + inv01 * dy;
        const uy = inv01 * dx + inv11 * dy;
        const exponent = dx * ux + dy * uy;
        if (exponent > 40) continue;
        const phi = Math.exp(-0.5 * exponent) / (TWO_PI * Math.sqrt(determinant));
        const averageMass = mode.W / Math.max(mode.H, 1);
        const amplitude = averageMass * phi;
        if (!(amplitude > 0)) continue;
        g += amplitude;
        gradX -= amplitude * ux;
        gradY -= amplitude * uy;
        h00 += amplitude * (ux * ux - inv00);
        h01 += amplitude * (ux * uy - inv01);
        h11 += amplitude * (uy * uy - inv11);
        M00 += amplitude * stats.N00;
        M01 += amplitude * stats.N01;
        M11 += amplitude * stats.N11;
        weightedP00 += amplitude * stats.P00;
        weightedP01 += amplitude * stats.P01;
        weightedP11 += amplitude * stats.P11;
      }

      if (!(g > EPS)) return null;
      const normal = dominantEigenvector(M00, M01, M11);
      const coherence = Math.max(0, (normal.lambda1 - normal.lambda2) / (normal.lambda1 + normal.lambda2 + EPS));
      const P00 = weightedP00 / g;
      const P01 = weightedP01 / g;
      const P11 = weightedP11 / g;
      const detP = Math.max(EPS, det2(P00, P01, P11));
      const sigmaPerp2 = Math.max(EPS, P00 * normal.x * normal.x + 2 * P01 * normal.x * normal.y + P11 * normal.y * normal.y);
      const normalCurvature = normal.x * normal.x * h00 + 2 * normal.x * normal.y * h01 + normal.y * normal.y * h11;
      const A = Math.max(0, -normalCurvature);
      const E = TWO_PI * Math.sqrt(detP) * g;
      const R = sigmaPerp2 * A / (g + EPS);
      const D = Math.sqrt(sigmaPerp2) * Math.abs(normal.x * gradX + normal.y * gradY) / (g + EPS);
      const support = E >= this.config.tauE && coherence >= this.config.tauC && R >= this.config.tauR;
      const ridge = support && D <= this.config.tauD && normalCurvature < 0;
      return { g, gradX, gradY, h00, h01, h11, normalX: normal.x, normalY: normal.y, P00, P01, P11, sigmaPerp2, E, C: coherence, R, D, normalCurvature, support, ridge };
    }

    extractGrid(gridSize) {
      const G = Math.max(4, Math.floor(finiteOr(gridSize, 100)));
      const size = G * G;
      const evidence = new Float32Array(size);
      const coherence = new Float32Array(size);
      const concentration = new Float32Array(size);
      const stationarity = new Float32Array(size);
      stationarity.fill(Infinity);
      const support = new Uint8Array(size);
      const ridge = new Uint8Array(size);
      const ridgeOwner = new Int32Array(size);
      ridgeOwner.fill(0x7fffffff);
      const ridgeX = new Float32Array(size);
      const ridgeY = new Float32Array(size);
      const ridgeNX = new Float32Array(size);
      const ridgeNY = new Float32Array(size);
      ridgeX.fill(NaN);
      ridgeY.fill(NaN);
      ridgeNX.fill(NaN);
      ridgeNY.fill(NaN);
      const cellWidth = this.config.worldWidth / G;
      const cellHeight = this.config.worldHeight / G;
      const confirmed = this._confirmedModes();

      for (const seed of confirmed) {
        const neighbors = this._neighbors(seed);
        if (!neighbors.length) continue;
        const seedStats = this._modeStats(seed);
        const radius = this.config.extractionRadiusCells;
        const xMinWorld = Math.max(0, (seed.cellX - radius) * this.config.cellSize);
        const xMaxWorld = Math.min(this.config.worldWidth, (seed.cellX + radius + 1) * this.config.cellSize);
        const yMinWorld = Math.max(0, (seed.cellY - radius) * this.config.cellSize);
        const yMaxWorld = Math.min(this.config.worldHeight, (seed.cellY + radius + 1) * this.config.cellSize);
        const gxMin = clamp(Math.floor(xMinWorld / cellWidth), 0, G - 1);
        const gxMax = clamp(Math.ceil(xMaxWorld / cellWidth), 0, G - 1);
        const gyTop = clamp(Math.floor((this.config.worldHeight - yMaxWorld) / cellHeight), 0, G - 1);
        const gyBottom = clamp(Math.ceil((this.config.worldHeight - yMinWorld) / cellHeight), 0, G - 1);
        for (let gy = gyTop; gy <= gyBottom; gy++) {
          const y = this.config.worldHeight - (gy + 0.5) * cellHeight;
          for (let gx = gxMin; gx <= gxMax; gx++) {
            const x = (gx + 0.5) * cellWidth;
            const value = this.evaluateModeField(x, y, neighbors);
            if (!value) continue;
            const index = gy * G + gx;
            if (value.E > evidence[index]) evidence[index] = value.E;
            if (value.C > coherence[index]) coherence[index] = value.C;
            if (value.R > concentration[index]) concentration[index] = value.R;
            if (value.D < stationarity[index]) stationarity[index] = value.D;
            if (value.support) support[index] = 1;
            if (value.ridge && seed.id < ridgeOwner[index]) {
              ridge[index] = 1;
              ridgeOwner[index] = seed.id;
              ridgeX[index] = x;
              ridgeY[index] = y;
              ridgeNX[index] = value.normalX;
              ridgeNY[index] = value.normalY;
            }
          }
        }

        // Every confirmed local mode is also a deterministic continuous seed.
        // Evaluating the analytic field at its recovered mean prevents a narrow
        // ridge from disappearing merely because no raster cell center lands on
        // the stationary set. The grid stores only the query result, not state.
        const seedValue = this.evaluateModeField(seedStats.mx, seedStats.my, neighbors);
        if (seedValue && seedValue.ridge) {
          const gx = clamp(Math.floor(seedStats.mx / cellWidth), 0, G - 1);
          const gy = clamp(Math.floor((this.config.worldHeight - seedStats.my) / cellHeight), 0, G - 1);
          const index = gy * G + gx;
          if (seed.id < ridgeOwner[index]) {
            ridge[index] = 1;
            ridgeOwner[index] = seed.id;
            ridgeX[index] = seedStats.mx;
            ridgeY[index] = seedStats.my;
            ridgeNX[index] = seedValue.normalX;
            ridgeNY[index] = seedValue.normalY;
          }
        }
      }

      const ridgePoints = [];
      let supportPoints = 0;
      for (let gy = 0; gy < G; gy++) {
        for (let gx = 0; gx < G; gx++) {
          const index = gy * G + gx;
          if (!Number.isFinite(stationarity[index])) stationarity[index] = 0;
          if (support[index]) supportPoints++;
          if (ridge[index]) ridgePoints.push({
            x: Number.isFinite(ridgeX[index]) ? ridgeX[index] : (gx + 0.5) * cellWidth,
            y: Number.isFinite(ridgeY[index]) ? ridgeY[index] : this.config.worldHeight - (gy + 0.5) * cellHeight,
            nx: Number.isFinite(ridgeNX[index]) ? ridgeNX[index] : 0,
            ny: Number.isFinite(ridgeNY[index]) ? ridgeNY[index] : 1,
            gx,
            gy,
          });
        }
      }

      this.lastDiagnostics.supportPoints = supportPoints;
      this.lastDiagnostics.ridgePoints = ridgePoints.length;
      return { G, cellWidth, cellHeight, evidence, coherence, concentration, stationarity, support, ridge, ridgePoints };
    }

    exportModes() {
      const out = [];
      for (const modes of this.cells.values()) {
        for (const mode of modes) {
          const stats = this._modeStats(mode);
          out.push({
            id: mode.id,
            cellX: mode.cellX,
            cellY: mode.cellY,
            W: mode.W,
            H: mode.H,
            lastSupportedSnapshot: mode.lastSupportedSnapshot,
            averageMass: mode.W / Math.max(mode.H, 1),
            ...stats,
          });
        }
      }
      out.sort((a, b) => a.id - b.id);
      return out;
    }

    getDiagnostics() {
      return { ...this.lastDiagnostics };
    }

    // Test-only deterministic kernel injection. It exercises assignment,
    // persistence, stale pruning, and the per-cell capacity rule without an oracle.
    debugIngestKernels(snapshot, kernels) {
      if (!Number.isInteger(snapshot) || snapshot < 0 || snapshot <= this.lastSnapshot) throw new Error('invalid snapshot');
      const diagnostics = this._newDiagnostics(snapshot);
      this.previousOcclusion = this._buildOcclusionMap();
      const touched = new Set();
      for (const kernel of kernels || []) this._assignKernel(kernel, snapshot, touched);
      this._pruneAndCap(snapshot, touched, diagnostics);
      this.lastSnapshot = snapshot;
      let count = 0;
      let confirmed = 0;
      for (const modes of this.cells.values()) {
        count += modes.length;
        for (const mode of modes) if (mode.H >= this.config.HConf) confirmed++;
      }
      diagnostics.localModes = count;
      diagnostics.representedCells = this.cells.size;
      diagnostics.confirmedModes = confirmed;
      diagnostics.stateBytesApprox = count * 18 * 8;
      if (count > this.cells.size * this.config.KMode) throw new Error('state bound violated');
      this.lastDiagnostics = diagnostics;
      return { ...diagnostics };
    }
  }

  function makeKernel(x, y, angle, sigmaParallel, sigmaPerp, weight) {
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const tx = ny;
    const ty = -nx;
    const sp2 = sigmaParallel * sigmaParallel;
    const sn2 = sigmaPerp * sigmaPerp;
    return {
      mx: x,
      my: y,
      P00: sp2 * tx * tx + sn2 * nx * nx,
      P01: sp2 * tx * ty + sn2 * nx * ny,
      P11: sp2 * ty * ty + sn2 * ny * ny,
      N00: nx * nx,
      N01: nx * ny,
      N11: ny * ny,
      nx,
      ny,
      sigmaPerp2: sn2,
      w: finiteOr(weight, 1),
    };
  }

  return {
    DEFAULT_CONFIG,
    RevisedEstimator,
    makeKernel,
    ellipsePerimeter,
    bhattacharyyaKernelToMode,
  };
});
