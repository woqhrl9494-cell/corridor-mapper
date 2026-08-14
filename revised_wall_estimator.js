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
  const MAX_PAIR_WORDS = 14; // 30 vehicles -> 30*29/2 = 435 unordered pairs.

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
    useDirectionalAssignment: true,
    useMaterialAwareTangency: false,
    diffuseSigmaS: 0,
    assignmentNormalSigma: 1.5,
    assignmentTangentialCells: 1.0,
    assignmentSearchRadiusCells: 1,
    HConf: 3,
    TStale: 12,
    extractionRadiusCells: 2,
    thetaExtraction: Math.PI / 7,
    tauE: 0.015,
    tauC: 0.45,
    tauR: 0.10,
    tauD: 0.35,
    evidenceQuantile: 0.99,
    tauEDominance: 0.70,
    tauEDominanceStart: 0.60,
    dominanceRampStart: 60,
    dominanceRampEnd: 120,
    useNormalNms: true,
    enableSurfaceGraphShadow: false,
    graphNodeGate: 'ridge',
    graphLinkDistance: 1.5,
    graphLinkAngle: Math.PI / 6,
    graphSecantAngle: Math.PI / 8,
    enableGraphPropagationShadow: false,
    graphPropagationEvidenceRatio: 0.90,
    graphPropagationMinPairSupport: 16,
    graphPropagationMinDiameter: 0,
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

  function unorderedPairIndex(i, j) {
    let left = Math.max(0, Math.floor(finiteOr(i, 0)));
    let right = Math.max(0, Math.floor(finiteOr(j, 1)));
    if (left === right) right = left + 1;
    if (left > right) { const swap = left; left = right; right = swap; }
    return Math.min(MAX_PAIR_WORDS * 32 - 1, right * (right - 1) / 2 + left);
  }

  function popcount32(value) {
    let x = value >>> 0;
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
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

  class DisjointSet {
    constructor(size) {
      this.parent = Int32Array.from({ length: size }, (_, index) => index);
      this.rank = new Uint8Array(size);
    }

    find(index) {
      let root = index;
      while (this.parent[root] !== root) root = this.parent[root];
      while (this.parent[index] !== index) {
        const next = this.parent[index];
        this.parent[index] = root;
        index = next;
      }
      return root;
    }

    union(left, right) {
      let rootLeft = this.find(left);
      let rootRight = this.find(right);
      if (rootLeft === rootRight) return false;
      if (this.rank[rootLeft] < this.rank[rootRight] ||
          (this.rank[rootLeft] === this.rank[rootRight] && rootLeft > rootRight)) {
        const swap = rootLeft;
        rootLeft = rootRight;
        rootRight = swap;
      }
      this.parent[rootRight] = rootLeft;
      if (this.rank[rootLeft] === this.rank[rootRight]) this.rank[rootLeft]++;
      return true;
    }
  }

  function weightedTreeFarthest(start, adjacency, nodes) {
    let bestIndex = start;
    let bestDistance = 0;
    const stack = [{ index: start, parent: -1, distance: 0 }];
    while (stack.length) {
      const current = stack.pop();
      const bestId = nodes[bestIndex].id;
      const currentId = nodes[current.index].id;
      if (current.distance > bestDistance + EPS ||
          (Math.abs(current.distance - bestDistance) <= EPS && currentId < bestId)) {
        bestIndex = current.index;
        bestDistance = current.distance;
      }
      for (const edge of adjacency.get(current.index) || []) {
        if (edge.to === current.parent) continue;
        stack.push({ index: edge.to, parent: current.index, distance: current.distance + edge.weight });
      }
    }
    return { index: bestIndex, distance: bestDistance };
  }

  function buildSurfaceContinuationGraph(inputNodes, config) {
    const cfg = config || {};
    const linkDistance = Math.max(EPS, finiteOr(cfg.graphLinkDistance, DEFAULT_CONFIG.graphLinkDistance));
    const linkAngle = clamp(finiteOr(cfg.graphLinkAngle, DEFAULT_CONFIG.graphLinkAngle), 0, Math.PI / 2);
    const secantAngle = clamp(finiteOr(cfg.graphSecantAngle, DEFAULT_CONFIG.graphSecantAngle), 0, Math.PI / 2);
    const indexCellSize = Math.max(EPS, finiteOr(cfg.cellSize, DEFAULT_CONFIG.cellSize));
    const nodes = (Array.isArray(inputNodes) ? inputNodes : []).map((node) => ({ ...node })).sort((a, b) => a.id - b.id);
    const spatial = new Map();
    const cellKey = (ix, iy) => `${ix},${iy}`;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const ix = Math.floor(node.mx / indexCellSize);
      const iy = Math.floor(node.my / indexCellSize);
      const key = cellKey(ix, iy);
      if (!spatial.has(key)) spatial.set(key, []);
      spatial.get(key).push(index);
      node.graphCellX = ix;
      node.graphCellY = iy;
    }

    const searchRadius = Math.max(1, Math.ceil(linkDistance / indexCellSize));
    const cosLink = Math.cos(linkAngle);
    const sinSecant = Math.sin(secantAngle);
    const edges = [];
    for (let left = 0; left < nodes.length; left++) {
      const a = nodes[left];
      for (let oy = -searchRadius; oy <= searchRadius; oy++) {
        for (let ox = -searchRadius; ox <= searchRadius; ox++) {
          const candidates = spatial.get(cellKey(a.graphCellX + ox, a.graphCellY + oy));
          if (!candidates) continue;
          for (const right of candidates) {
            if (right <= left) continue;
            const b = nodes[right];
            const dx = b.mx - a.mx;
            const dy = b.my - a.my;
            const distance = Math.hypot(dx, dy);
            if (!(distance > EPS) || distance > linkDistance + EPS) continue;
            const normalCompatibility = Math.abs(a.nx * b.nx + a.ny * b.ny);
            if (normalCompatibility + EPS < cosLink) continue;
            const ux = dx / distance;
            const uy = dy / distance;
            const secantNormal = Math.max(Math.abs(a.nx * ux + a.ny * uy), Math.abs(b.nx * ux + b.ny * uy));
            if (secantNormal > sinSecant + EPS) continue;
            edges.push({ left, right, weight: distance, normalCompatibility, secantNormal });
          }
        }
      }
    }
    edges.sort((a, b) => a.weight - b.weight || nodes[a.left].id - nodes[b.left].id || nodes[a.right].id - nodes[b.right].id);

    const components = new DisjointSet(nodes.length);
    for (const edge of edges) components.union(edge.left, edge.right);
    const componentNodes = new Map();
    for (let index = 0; index < nodes.length; index++) {
      const root = components.find(index);
      if (!componentNodes.has(root)) componentNodes.set(root, []);
      componentNodes.get(root).push(index);
    }
    const componentEdgesByRoot = new Map();
    for (const edge of edges) {
      const root = components.find(edge.left);
      if (!componentEdgesByRoot.has(root)) componentEdgesByRoot.set(root, []);
      componentEdgesByRoot.get(root).push(edge);
    }

    const groups = [];
    const modeToGroup = new Map();
    const orderedComponents = [...componentNodes.entries()].sort((a, b) => nodes[a[1][0]].id - nodes[b[1][0]].id);
    for (let groupIndex = 0; groupIndex < orderedComponents.length; groupIndex++) {
      const [componentRoot, members] = orderedComponents[groupIndex];
      const componentEdges = componentEdgesByRoot.get(componentRoot) || [];
      const memberLocalIndex = new Map(members.map((index, localIndex) => [index, localIndex]));
      const localTree = new DisjointSet(members.length);
      const mstEdges = [];
      let mstLength = 0;
      for (const edge of componentEdges) {
        if (!localTree.union(memberLocalIndex.get(edge.left), memberLocalIndex.get(edge.right))) continue;
        mstEdges.push(edge);
        mstLength += edge.weight;
        if (mstEdges.length === members.length - 1) break;
      }
      const adjacency = new Map(members.map((index) => [index, []]));
      for (const edge of mstEdges) {
        adjacency.get(edge.left).push({ to: edge.right, weight: edge.weight });
        adjacency.get(edge.right).push({ to: edge.left, weight: edge.weight });
      }
      const first = members[0];
      const endpointA = weightedTreeFarthest(first, adjacency, nodes);
      const endpointB = weightedTreeFarthest(endpointA.index, adjacency, nodes);
      const modeIds = members.map((index) => nodes[index].id).sort((a, b) => a - b);
      const group = {
        id: groupIndex + 1,
        modeIds,
        nodeCount: members.length,
        edgeCount: componentEdges.length,
        mstEdgeCount: mstEdges.length,
        mstLength,
        diameter: endpointB.distance,
        diameterEndpointIds: [nodes[endpointA.index].id, nodes[endpointB.index].id],
      };
      const pairWords = new Uint32Array(MAX_PAIR_WORDS);
      let minBirthSnapshot = Infinity;
      let maxLastSupportedSnapshot = -Infinity;
      let sumSnapshotSupport = 0;
      let maxSnapshotSupport = 0;
      let sumCoherence = 0;
      for (const member of members) {
        const node = nodes[member];
        const words = node.pairSupportWords || [];
        for (let word = 0; word < Math.min(MAX_PAIR_WORDS, words.length); word++) {
          pairWords[word] |= words[word] >>> 0;
        }
        minBirthSnapshot = Math.min(minBirthSnapshot, finiteOr(node.birthSnapshot, 0));
        maxLastSupportedSnapshot = Math.max(maxLastSupportedSnapshot, finiteOr(node.lastSupportedSnapshot, 0));
        sumSnapshotSupport += Math.max(0, finiteOr(node.H, 0));
        maxSnapshotSupport = Math.max(maxSnapshotSupport, Math.max(0, finiteOr(node.H, 0)));
        sumCoherence += Math.max(0, finiteOr(node.coherence, 0));
      }
      group.pairSupportCount = pairWords.reduce((sum, word) => sum + popcount32(word), 0);
      group.supportSpanSnapshots = Number.isFinite(minBirthSnapshot) && Number.isFinite(maxLastSupportedSnapshot)
        ? Math.max(0, maxLastSupportedSnapshot - minBirthSnapshot + 1) : 0;
      group.meanSnapshotSupport = members.length ? sumSnapshotSupport / members.length : 0;
      group.maxSnapshotSupport = maxSnapshotSupport;
      group.meanCoherence = members.length ? sumCoherence / members.length : 0;
      groups.push(group);
      for (const modeId of modeIds) modeToGroup.set(modeId, group.id);
    }
    return { nodes, edges, groups, modeToGroup };
  }

  /*
   * Corridor-only paired boundary extraction.
   *
   * Input:
   *   src              G-by-G causal Evidence E, row 0 at world top.
   *   evidenceRatio    Per-column peak gate in [0, 1].
   * Output:
   *   At most two one-cell-wide points per accepted column.
   *
   * Assumption: a corridor cross-section contains two separated, locally
   * parallel Evidence peaks with a lower-Evidence free-space valley between
   * them. Finite-support ellipse clouds violate that assumption at their end
   * caps: the two branches converge and their tangents point toward each other.
   *
   * Complexity: O(G^2) time for column scans and O(G) auxiliary memory.
   * No GT wall, simulator hit, future snapshot, or configured corridor gap is
   * read here.
   */
  function extractCorridorOuterPeakRidge(src, gridSize, worldWidth, worldHeight, evidenceRatio) {
    const G = Math.max(1, Math.floor(finiteOr(gridSize, 0)));
    if (!src || src.length !== G * G) return [];
    let globalMax = 0;
    for (let index = 0; index < src.length; index++) globalMax = Math.max(globalMax, finiteOr(src[index], 0));
    if (!(globalMax > EPS)) return [];
    const cellWidth = Math.max(EPS, finiteOr(worldWidth, DEFAULT_CONFIG.worldWidth)) / G;
    const cellHeight = Math.max(EPS, finiteOr(worldHeight, DEFAULT_CONFIG.worldHeight)) / G;
    const ratio = clamp(finiteOr(evidenceRatio, 0.60), 0, 1);
    const absoluteFloor = 0.08 * globalMax;
    const maxValleyRatio = 0.72;
    const minParallelCosine = Math.cos(Math.PI / 4);
    const candidates = new Array(G).fill(null);

    // Stage 1: retain a paired top/bottom peak only when the column has two
    // distinct modes and a genuine low-Evidence corridor between them.
    for (let gx = 0; gx < G; gx++) {
      let columnMax = 0;
      for (let gy = 0; gy < G; gy++) columnMax = Math.max(columnMax, finiteOr(src[gy * G + gx], 0));
      if (columnMax < absoluteFloor) continue;
      const threshold = Math.max(absoluteFloor, ratio * columnMax);
      let topRow = -1;
      let bottomRow = -1;
      for (let gy = 1; gy < G - 1; gy++) {
        const index = gy * G + gx;
        const value = src[index];
        if (value >= threshold && value >= src[index - G] && value > src[index + G]) { topRow = gy; break; }
      }
      for (let gy = G - 2; gy > 0; gy--) {
        const index = gy * G + gx;
        const value = src[index];
        if (value >= threshold && value > src[index - G] && value >= src[index + G]) { bottomRow = gy; break; }
      }
      if (topRow < 0 || bottomRow <= topRow + 1) continue;
      const topValue = finiteOr(src[topRow * G + gx], 0);
      const bottomValue = finiteOr(src[bottomRow * G + gx], 0);
      const weakerPeak = Math.min(topValue, bottomValue);
      if (weakerPeak < absoluteFloor) continue;
      let valleyValue = Infinity;
      for (let gy = topRow + 1; gy < bottomRow; gy++) {
        valleyValue = Math.min(valleyValue, finiteOr(src[gy * G + gx], 0));
      }
      const valleyRatio = valleyValue / Math.max(EPS, weakerPeak);
      if (valleyRatio > maxValleyRatio) continue;
      candidates[gx] = {
        gx,
        topRow,
        bottomRow,
        separation: bottomRow - topRow,
        strength: weakerPeak / globalMax,
        valleyRatio,
      };
    }

    // Stage 2: estimate the projected wall spacing from current Evidence only.
    // Sorting gives deterministic behavior and prevents a few end-cap columns
    // from setting the spacing.
    const strongSeparations = candidates
      .filter((candidate) => candidate && candidate.strength >= 0.12)
      .map((candidate) => candidate.separation)
      .sort((left, right) => left - right);
    if (!strongSeparations.length) return [];
    const nominalSeparation = strongSeparations[Math.floor(strongSeparations.length / 2)];
    const minSeparation = Math.max(2, 0.55 * nominalSeparation);
    const maxSeparation = 1.75 * nominalSeparation;
    const spacingValid = (candidate) => candidate &&
      candidate.separation >= minSeparation && candidate.separation <= maxSeparation;

    // Stage 3: the two branches must advance in approximately the same
    // direction. At an ellipse-cloud end cap their row slopes have opposite
    // signs, which produces the observed '(' and ')' artifacts.
    const parallelWith = (left, right) => {
      if (!spacingValid(left) || !spacingValid(right)) return false;
      const dx = right.gx - left.gx;
      if (!(dx > 0)) return false;
      const topDelta = right.topRow - left.topRow;
      const bottomDelta = right.bottomRow - left.bottomRow;
      const denominator = Math.hypot(dx, topDelta) * Math.hypot(dx, bottomDelta);
      if (!(denominator > EPS)) return false;
      return (dx * dx + topDelta * bottomDelta) / denominator >= minParallelCosine;
    };

    const accepted = new Uint8Array(G);
    for (let gx = 0; gx < G; gx++) {
      const candidate = candidates[gx];
      if (!spacingValid(candidate)) continue;
      for (let offset = 1; offset <= 2 && !accepted[gx]; offset++) {
        const left = gx - offset >= 0 ? candidates[gx - offset] : null;
        const right = gx + offset < G ? candidates[gx + offset] : null;
        if (parallelWith(left, candidate) || parallelWith(candidate, right)) accepted[gx] = 1;
      }
    }

    const points = [];
    const height = finiteOr(worldHeight, DEFAULT_CONFIG.worldHeight);
    for (let gx = 0; gx < G; gx++) {
      if (!accepted[gx]) continue;
      const candidate = candidates[gx];
      for (const gy of [candidate.topRow, candidate.bottomRow]) {
        points.push({
          x: (gx + 0.5) * cellWidth,
          y: height - (gy + 0.5) * cellHeight,
          gx,
          gy,
        });
      }
    }
    return points;
  }

  /*
   * Regularize the two normal offsets of an open corridor centerline.
   *
   * For a signed centerline curvature kappa and left-normal offset d, the
   * parallel-curve tangent is (1 - kappa*d)T. A cusp appears at kappa*d = 1.
   * The opposite wall has (1 + kappa*d)T, so only the inside wall of each turn
   * needs a curvature cap. A two-pass Lipschitz envelope makes the necessary
   * local narrowing gradual without ever increasing an unsafe offset.
   *
   * Input arrays are one-dimensional samples of equal length. arcLength is
   * cumulative metres. Complexity is O(N) time and O(N) memory.
   */
  function regularizeCorridorOffsets(desiredTop, desiredBottom, signedCurvature, arcLength, options) {
    const n = desiredTop?.length || 0;
    if (!n || desiredBottom?.length !== n || signedCurvature?.length !== n || arcLength?.length !== n) {
      return { top: [], bottom: [], maxOffsetCurvatureProduct: 0 };
    }
    const supplied = options || {};
    const safetyProduct = clamp(finiteOr(supplied.safetyProduct, 0.72), 0.05, 0.95);
    const maxOffsetSlope = Math.max(0.01, finiteOr(supplied.maxOffsetSlope, 0.35));
    const top = new Float64Array(n);
    const bottom = new Float64Array(n);

    for (let index = 0; index < n; index++) {
      const curvature = finiteOr(signedCurvature[index], 0);
      const topCap = curvature > EPS ? safetyProduct / curvature : Infinity;
      const bottomCap = curvature < -EPS ? safetyProduct / (-curvature) : Infinity;
      top[index] = Math.max(EPS, Math.min(Math.max(EPS, finiteOr(desiredTop[index], EPS)), topCap));
      bottom[index] = Math.max(EPS, Math.min(Math.max(EPS, finiteOr(desiredBottom[index], EPS)), bottomCap));
    }

    const applyLipschitzEnvelope = (profile) => {
      for (let index = 1; index < n; index++) {
        const ds = Math.max(EPS, finiteOr(arcLength[index], 0) - finiteOr(arcLength[index - 1], 0));
        profile[index] = Math.min(profile[index], profile[index - 1] + maxOffsetSlope * ds);
      }
      for (let index = n - 2; index >= 0; index--) {
        const ds = Math.max(EPS, finiteOr(arcLength[index + 1], 0) - finiteOr(arcLength[index], 0));
        profile[index] = Math.min(profile[index], profile[index + 1] + maxOffsetSlope * ds);
      }
    };
    applyLipschitzEnvelope(top);
    applyLipschitzEnvelope(bottom);

    let maxOffsetCurvatureProduct = 0;
    for (let index = 0; index < n; index++) {
      const curvature = finiteOr(signedCurvature[index], 0);
      const product = curvature >= 0 ? curvature * top[index] : (-curvature) * bottom[index];
      maxOffsetCurvatureProduct = Math.max(maxOffsetCurvatureProduct, product);
    }
    return { top, bottom, maxOffsetCurvatureProduct };
  }

  class RevisedEstimator {
    constructor(config) {
      const supplied = config || {};
      const merged = { ...DEFAULT_CONFIG, ...supplied };
      if (Object.prototype.hasOwnProperty.call(supplied, 'tauEDominance') &&
          !Object.prototype.hasOwnProperty.call(supplied, 'tauEDominanceStart')) {
        merged.tauEDominanceStart = supplied.tauEDominance;
      }
      this.config = this._validateConfig(merged);
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
      out.assignmentNormalSigma = Math.max(0.1,
        finiteOr(out.assignmentNormalSigma, DEFAULT_CONFIG.assignmentNormalSigma));
      out.diffuseSigmaS = Math.max(0, finiteOr(out.diffuseSigmaS, DEFAULT_CONFIG.diffuseSigmaS));
      out.assignmentTangentialCells = Math.max(0.1,
        finiteOr(out.assignmentTangentialCells, DEFAULT_CONFIG.assignmentTangentialCells));
      out.assignmentSearchRadiusCells = Math.max(0,
        Math.floor(finiteOr(out.assignmentSearchRadiusCells, DEFAULT_CONFIG.assignmentSearchRadiusCells)));
      out.HConf = Math.max(1, Math.floor(finiteOr(out.HConf, DEFAULT_CONFIG.HConf)));
      out.TStale = Math.max(0, Math.floor(finiteOr(out.TStale, DEFAULT_CONFIG.TStale)));
      out.extractionRadiusCells = Math.max(0, Math.floor(finiteOr(out.extractionRadiusCells, DEFAULT_CONFIG.extractionRadiusCells)));
      out.thetaExtraction = clamp(finiteOr(out.thetaExtraction, DEFAULT_CONFIG.thetaExtraction), 0, Math.PI / 2);
      out.tauE = Math.max(0, finiteOr(out.tauE, DEFAULT_CONFIG.tauE));
      out.tauC = clamp(finiteOr(out.tauC, DEFAULT_CONFIG.tauC), 0, 1);
      out.tauR = Math.max(0, finiteOr(out.tauR, DEFAULT_CONFIG.tauR));
      out.tauD = Math.max(0, finiteOr(out.tauD, DEFAULT_CONFIG.tauD));
      out.evidenceQuantile = clamp(finiteOr(out.evidenceQuantile, DEFAULT_CONFIG.evidenceQuantile), 0, 1);
      out.tauEDominance = Math.max(0, finiteOr(out.tauEDominance, DEFAULT_CONFIG.tauEDominance));
      out.tauEDominanceStart = Math.max(0, finiteOr(out.tauEDominanceStart, DEFAULT_CONFIG.tauEDominanceStart));
      out.dominanceRampStart = Math.max(0, Math.floor(finiteOr(out.dominanceRampStart, DEFAULT_CONFIG.dominanceRampStart)));
      out.dominanceRampEnd = Math.max(out.dominanceRampStart + 1,
        Math.floor(finiteOr(out.dominanceRampEnd, DEFAULT_CONFIG.dominanceRampEnd)));
      out.graphLinkDistance = Math.max(0.05, finiteOr(out.graphLinkDistance, DEFAULT_CONFIG.graphLinkDistance));
      out.graphLinkAngle = clamp(finiteOr(out.graphLinkAngle, DEFAULT_CONFIG.graphLinkAngle), 0, Math.PI / 2);
      out.graphSecantAngle = clamp(finiteOr(out.graphSecantAngle, DEFAULT_CONFIG.graphSecantAngle), 0, Math.PI / 2);
      out.graphPropagationEvidenceRatio = clamp(
        finiteOr(out.graphPropagationEvidenceRatio, DEFAULT_CONFIG.graphPropagationEvidenceRatio), 0, 1);
      out.graphPropagationMinPairSupport = Math.max(0,
        Math.floor(finiteOr(out.graphPropagationMinPairSupport, DEFAULT_CONFIG.graphPropagationMinPairSupport)));
      out.graphPropagationMinDiameter = Math.max(0,
        finiteOr(out.graphPropagationMinDiameter, DEFAULT_CONFIG.graphPropagationMinDiameter));
      out.visibilityAlpha = Math.max(0, finiteOr(out.visibilityAlpha, DEFAULT_CONFIG.visibilityAlpha));
      out.visibilityMin = clamp(finiteOr(out.visibilityMin, DEFAULT_CONFIG.visibilityMin), 0, 1);
      out.visibilityCoherence = clamp(finiteOr(out.visibilityCoherence, DEFAULT_CONFIG.visibilityCoherence), 0, 1);
      out.outputDedupTolerance = Math.max(0, finiteOr(out.outputDedupTolerance, DEFAULT_CONFIG.outputDedupTolerance));
      out.useVisibility = !!out.useVisibility;
      out.useDirectionalAssignment = out.useDirectionalAssignment !== false;
      out.useMaterialAwareTangency = out.useMaterialAwareTangency === true;
      out.useNormalNms = out.useNormalNms !== false;
      out.enableSurfaceGraphShadow = out.enableSurfaceGraphShadow !== false;
      out.enableGraphPropagationShadow = out.enableGraphPropagationShadow === true;
      out.graphNodeGate = ['confirmed', 'support', 'ridge'].includes(out.graphNodeGate)
        ? out.graphNodeGate : DEFAULT_CONFIG.graphNodeGate;
      return out;
    }

    configure(partial) {
      const supplied = partial || {};
      const merged = { ...this.config, ...supplied };
      if (Object.prototype.hasOwnProperty.call(supplied, 'tauEDominance') &&
          !Object.prototype.hasOwnProperty.call(supplied, 'tauEDominanceStart')) {
        merged.tauEDominanceStart = supplied.tauEDominance;
      }
      this.config = this._validateConfig(merged);
    }

    reset() {
      this.cells = new Map();
      this.nextModeId = 1;
      this.lastSnapshot = -1;
      this.previousOcclusion = new Map();
      this.lastSurfaceGraph = { nodes: [], edges: [], groups: [], modeToGroup: new Map() };
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
        capacityOverflowCells: 0,
        assignmentOrientationRejects: 0,
        assignmentNormalRejects: 0,
        assignmentTangentialRejects: 0,
        materialAwareTangency: false,
        tangencySamples: 0,
        meanSigmaTheta: 0,
        meanRhoTangency: 0,
        meanGamma: 1,
        meanCmode: 0,
        meanCeff: 0,
        visibilityMin: 1,
        visibilityMean: 0,
        visibilitySamples: 0,
        updateRuntimeMs: 0,
        stateBytesApprox: 0,
        supportPoints: 0,
        rawRidgePoints: 0,
        dominanceRidgePoints: 0,
        ridgePoints: 0,
        normalNmsRemoved: 0,
        graphPropagationAdded: 0,
        graphPropagationNmsRemoved: 0,
        graphPropagationPoints: 0,
        evidenceReference: 0,
        evidenceDominanceThreshold: 0,
        evidenceDominanceFactor: 0,
        graphNodes: 0,
        graphRejectedModes: 0,
        graphEdges: 0,
        graphGroups: 0,
        graphMaxDiameter: 0,
        graphMeanDiameter: 0,
        graphMstLength: 0,
        graphBuildRuntimeMs: 0,
        modeFieldSamples: 0,
        effectiveNeighborsMean: 0,
        effectiveNeighborsP10: 0,
        effectiveNeighborsP50: 0,
        effectiveNeighborsP90: 0,
        modeFailE: 0,
        modeFailC: 0,
        modeFailR: 0,
        modeFailD: 0,
        modeFailCurvature: 0,
        modePassLocalRidge: 0,
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
      const materialAware = this.config.useMaterialAwareTangency && this.config.diffuseSigmaS > EPS;
      const orientationWeight = materialAware ? Math.max(finiteOr(mode.Wori, mode.W), EPS) : Math.max(mode.W, EPS);
      const invOrientationWeight = 1 / orientationWeight;
      const N00 = mode.O00 * invOrientationWeight;
      const N01 = mode.O01 * invOrientationWeight;
      const N11 = mode.O11 * invOrientationWeight;
      const eig = eigenvaluesSym2(N00, N01, N11);
      const coherence = Math.max(0, (eig[0] - eig[1]) / (eig[0] + eig[1] + EPS));
      const gamma = materialAware ? clamp(orientationWeight / Math.max(mode.W, EPS), 0, 1) : 1;
      const effectiveCoherence = materialAware ? 1 - gamma * (1 - coherence) : coherence;
      return { mx, my, P00, P01, P11, determinant, N00, N01, N11, coherence, gamma, effectiveCoherence };
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
      const materialAware = this.config.useMaterialAwareTangency && this.config.diffuseSigmaS > EPS;
      const theta02 = this.config.thetaMode * this.config.thetaMode;
      const kernels = new Array(count);
      const pairIndex = unorderedPairIndex(measurement.i, measurement.j);
      const pairWord = pairIndex >>> 5;
      const pairBit = 1 << (pairIndex & 31);
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
        const Ahat = 0.25 * gLength * (1 / Math.max(ri, EPS) + 1 / Math.max(rj, EPS));
        const sigmaTheta = materialAware ? Ahat * this.config.diffuseSigmaS : 0;
        const rhoTangency = materialAware ? theta02 / Math.max(EPS, theta02 + sigmaTheta * sigmaTheta) : 1;

        let visibility = 1;
        if (this.config.useVisibility) {
          const depthI = this._rayOpticalDepth(pI, { x: mx, y: my }, rayCache);
          const depthJ = this._rayOpticalDepth(pJ, { x: mx, y: my }, rayCache);
          visibility = Math.max(this.config.visibilityMin, Math.exp(-depthI - depthJ));
        }
        visibilitySum += visibility;
        diagnostics.visibilityMin = Math.min(diagnostics.visibilityMin, visibility);
        diagnostics.visibilitySamples++;
        diagnostics.materialAwareTangency = materialAware;
        diagnostics.tangencySamples++;
        diagnostics.meanSigmaTheta += sigmaTheta;
        diagnostics.meanRhoTangency += rhoTangency;
        kernels[n] = {
          mx, my,
          P00, P01, P11,
          N00: nx * nx,
          N01: nx * ny,
          N11: ny * ny,
          nx, ny,
          sigmaPerp2,
          sigmaTheta,
          rhoTangency,
          pairWord,
          pairBit,
          w: visibility / count,
        };
      }
      diagnostics.totalEllipseSamples += count;
      if (count > 0 && this.config.useVisibility) diagnostics.visibilityMean += visibilitySum;
      return kernels;
    }

    _newMode(kernel, cell, snapshot) {
      const w = kernel.w;
      const wOri = w * clamp(finiteOr(kernel.rhoTangency, 1), 0, 1);
      const pairSupportWords = new Uint32Array(MAX_PAIR_WORDS);
      if (Number.isInteger(kernel.pairWord) && kernel.pairWord >= 0 && kernel.pairWord < MAX_PAIR_WORDS) {
        pairSupportWords[kernel.pairWord] |= kernel.pairBit >>> 0;
      }
      return {
        id: this.nextModeId++,
        cellX: cell.ix,
        cellY: cell.iy,
        W: w,
        Wori: wOri,
        H: 1,
        sx: w * kernel.mx,
        sy: w * kernel.my,
        Q00: w * (kernel.P00 + kernel.mx * kernel.mx),
        Q01: w * (kernel.P01 + kernel.mx * kernel.my),
        Q11: w * (kernel.P11 + kernel.my * kernel.my),
        O00: wOri * kernel.N00,
        O01: wOri * kernel.N01,
        O11: wOri * kernel.N11,
        lastSupportedSnapshot: snapshot,
        birthSnapshot: snapshot,
        pairSupportWords,
        UPerp: w * Math.max(EPS, finiteOr(kernel.sigmaPerp2, this.config.sigmaModel ** 2)),
      };
    }

    _addKernel(mode, kernel, snapshot) {
      const w = kernel.w;
      const wOri = w * clamp(finiteOr(kernel.rhoTangency, 1), 0, 1);
      mode.W += w;
      mode.Wori = finiteOr(mode.Wori, mode.W - w) + wOri;
      mode.sx += w * kernel.mx;
      mode.sy += w * kernel.my;
      mode.Q00 += w * (kernel.P00 + kernel.mx * kernel.mx);
      mode.Q01 += w * (kernel.P01 + kernel.mx * kernel.my);
      mode.Q11 += w * (kernel.P11 + kernel.my * kernel.my);
      mode.O00 += wOri * kernel.N00;
      mode.O01 += wOri * kernel.N01;
      mode.O11 += wOri * kernel.N11;
      mode.UPerp += w * Math.max(EPS, finiteOr(kernel.sigmaPerp2, this.config.sigmaModel ** 2));
      if (Number.isInteger(kernel.pairWord) && kernel.pairWord >= 0 && kernel.pairWord < MAX_PAIR_WORDS) {
        mode.pairSupportWords[kernel.pairWord] |= kernel.pairBit >>> 0;
      }
      if (mode.lastSupportedSnapshot !== snapshot) {
        mode.H += 1;
        mode.lastSupportedSnapshot = snapshot;
      }
    }

    _capacityScore(mode) {
      const stats = this._modeStats(mode);
      const averageMass = mode.W / Math.max(mode.H, 1);
      return averageMass * stats.effectiveCoherence * Math.min(1, mode.H / this.config.HConf);
    }

    _assignKernel(kernel, snapshot, touchedCells, diagnostics) {
      if (!(kernel.w > 0)) return;
      const cell = this._cellCoordinates(kernel.mx, kernel.my);
      const key = this._cellKey(cell.ix, cell.iy);
      let modes = this.cells.get(key);
      if (!modes) {
        modes = [];
        this.cells.set(key, modes);
      }
      const materialAware = this.config.useMaterialAwareTangency && this.config.diffuseSigmaS > EPS;
      const sigmaTheta = materialAware ? Math.max(0, finiteOr(kernel.sigmaTheta, 0)) : 0;
      const effectiveTheta2 = this.config.thetaMode * this.config.thetaMode + sigmaTheta * sigmaTheta;
      const effectiveTheta = Math.min(Math.PI / 2, Math.sqrt(effectiveTheta2));
      const cos2 = Math.cos(effectiveTheta) ** 2;
      let best = null;
      let bestDistance = Infinity;
      const candidates = [];
      const searchRadius = this.config.useDirectionalAssignment ? this.config.assignmentSearchRadiusCells : 0;
      for (let oy = -searchRadius; oy <= searchRadius; oy++) {
        for (let ox = -searchRadius; ox <= searchRadius; ox++) {
          const candidateModes = this.cells.get(this._cellKey(cell.ix + ox, cell.iy + oy));
          if (candidateModes) candidates.push(...candidateModes);
        }
      }
      candidates.sort((a, b) => a.id - b.id);
      for (const mode of candidates) {
        const stats = this._modeStats(mode);
        const orientation = clamp(axialTrace([stats.N00, stats.N01, stats.N11], [kernel.N00, kernel.N01, kernel.N11]), 0, 1);
        if (orientation < cos2) {
          if (diagnostics) diagnostics.assignmentOrientationRejects++;
          continue;
        }
        let distance;
        if (this.config.useDirectionalAssignment) {
          const normal = dominantEigenvector(stats.N00, stats.N01, stats.N11);
          const dx = kernel.mx - stats.mx;
          const dy = kernel.my - stats.my;
          const intrinsicModeVariance = mode.UPerp / Math.max(mode.W, EPS);
          const normalScale = Math.sqrt(Math.max(EPS, kernel.sigmaPerp2 + intrinsicModeVariance));
          const normalDistance = Math.abs(normal.x * dx + normal.y * dy) / normalScale;
          if (normalDistance > this.config.assignmentNormalSigma) {
            if (diagnostics) diagnostics.assignmentNormalRejects++;
            continue;
          }
          const tangentDistance = Math.abs(-normal.y * dx + normal.x * dy);
          const tangentLimit = this.config.assignmentTangentialCells * this.config.cellSize;
          if (tangentDistance > tangentLimit) {
            if (diagnostics) diagnostics.assignmentTangentialRejects++;
            continue;
          }
          const tangentNormalized = tangentDistance / Math.max(tangentLimit, EPS);
          const angleNormalized = materialAware
            ? Math.acos(Math.sqrt(orientation)) ** 2 / Math.max(effectiveTheta2, EPS)
            : (1 - orientation) / Math.max(1 - cos2, EPS);
          distance = normalDistance * normalDistance + tangentNormalized * tangentNormalized + angleNormalized;
        } else {
          distance = bhattacharyyaKernelToMode(kernel, stats);
          if (distance > this.config.tauB) continue;
        }
        if (distance < bestDistance - 1e-12 || (Math.abs(distance - bestDistance) <= 1e-12 && mode.id < best.id)) {
          best = mode;
          bestDistance = distance;
        }
      }
      if (best) this._addKernel(best, kernel, snapshot);
      else modes.push(this._newMode(kernel, cell, snapshot));
      touchedCells.add(key);
    }

    _reindexModes() {
      const ordered = [];
      for (const modes of this.cells.values()) ordered.push(...modes);
      ordered.sort((a, b) => a.id - b.id);
      const reindexed = new Map();
      for (const mode of ordered) {
        const stats = this._modeStats(mode);
        const cell = this._cellCoordinates(stats.mx, stats.my);
        mode.cellX = cell.ix;
        mode.cellY = cell.iy;
        const key = this._cellKey(cell.ix, cell.iy);
        if (!reindexed.has(key)) reindexed.set(key, []);
        reindexed.get(key).push(mode);
      }
      this.cells = reindexed;
    }

    _pruneAndCap(snapshot, touchedCells, diagnostics) {
      for (const [key, modes] of this.cells) {
        const kept = modes.filter((mode) => {
          const stale = mode.H < this.config.HConf && snapshot - mode.lastSupportedSnapshot > this.config.TStale;
          if (stale) diagnostics.staleCandidatesRemoved++;
          return !stale;
        });
        if (touchedCells.has(key) && kept.length > this.config.KMode) {
          diagnostics.capacityOverflowCells++;
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
        for (const kernel of kernels) this._assignKernel(kernel, snapshot, touchedCells, diagnostics);
      }
      if (this.config.useDirectionalAssignment) {
        this._reindexModes();
        for (const key of this.cells.keys()) touchedCells.add(key);
      }
      this._pruneAndCap(snapshot, touchedCells, diagnostics);
      this.lastSnapshot = snapshot;

      let modeCount = 0;
      let confirmed = 0;
      let gammaSum = 0;
      let coherenceSum = 0;
      let effectiveCoherenceSum = 0;
      for (const modes of this.cells.values()) {
        modeCount += modes.length;
        for (const mode of modes) {
          if (mode.H >= this.config.HConf) confirmed++;
          const stats = this._modeStats(mode);
          gammaSum += stats.gamma;
          coherenceSum += stats.coherence;
          effectiveCoherenceSum += stats.effectiveCoherence;
        }
      }
      diagnostics.localModes = modeCount;
      diagnostics.representedCells = this.cells.size;
      diagnostics.confirmedModes = confirmed;
      diagnostics.stateBytesApprox = modeCount * (20 * 8 + MAX_PAIR_WORDS * 4);
      if (diagnostics.tangencySamples > 0) {
        diagnostics.meanSigmaTheta /= diagnostics.tangencySamples;
        diagnostics.meanRhoTangency /= diagnostics.tangencySamples;
      } else diagnostics.meanRhoTangency = 1;
      diagnostics.meanGamma = modeCount ? gammaSum / modeCount : 1;
      diagnostics.meanCmode = modeCount ? coherenceSum / modeCount : 0;
      diagnostics.meanCeff = modeCount ? effectiveCoherenceSum / modeCount : 0;
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

    buildSurfaceGraph(confirmedModes, fieldByModeId) {
      const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const confirmed = Array.isArray(confirmedModes) ? confirmedModes : this._confirmedModes();
      if (!this.config.enableSurfaceGraphShadow) {
        this.lastSurfaceGraph = { nodes: [], edges: [], groups: [], modeToGroup: new Map() };
        return this.lastSurfaceGraph;
      }
      const fieldMap = fieldByModeId instanceof Map ? fieldByModeId : new Map();
      const qualified = confirmed.filter((mode) => {
        if (this.config.graphNodeGate === 'confirmed') return true;
        const value = fieldMap.get(mode.id);
        if (!value) return false;
        if (this.config.graphNodeGate === 'support') return value.support && value.normalCurvature < 0;
        return value.ridge;
      });
      const nodes = qualified.map((mode) => {
        const stats = this._modeStats(mode);
        const field = fieldMap.get(mode.id);
        const modeNormal = dominantEigenvector(stats.N00, stats.N01, stats.N11);
        return {
          id: mode.id,
          mx: stats.mx,
          my: stats.my,
          nx: field ? field.normalX : modeNormal.x,
          ny: field ? field.normalY : modeNormal.y,
          coherence: stats.coherence,
          W: mode.W,
          H: mode.H,
          averageMass: mode.W / Math.max(mode.H, 1),
          birthSnapshot: mode.birthSnapshot,
          lastSupportedSnapshot: mode.lastSupportedSnapshot,
          pairSupportWords: Array.from(mode.pairSupportWords || []),
          effectiveNeighbors: field ? field.effectiveNeighbors : 0,
          E: field ? field.E : 0,
          C: field ? field.C : stats.coherence,
          R: field ? field.R : 0,
          D: field ? field.D : Infinity,
          localGate: field
            ? (field.E < this.config.tauE ? 'E'
              : field.C < this.config.tauC ? 'C'
                : field.R < this.config.tauR ? 'R'
                  : field.D > this.config.tauD ? 'D'
                    : !(field.normalCurvature < 0) ? 'curvature' : 'pass')
            : 'not-evaluated',
        };
      });
      const graph = buildSurfaceContinuationGraph(nodes, this.config);
      const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      this.lastSurfaceGraph = graph;
      const diameters = graph.groups.map((group) => group.diameter);
      this.lastDiagnostics.graphNodes = graph.nodes.length;
      this.lastDiagnostics.graphRejectedModes = confirmed.length - graph.nodes.length;
      this.lastDiagnostics.graphEdges = graph.edges.length;
      this.lastDiagnostics.graphGroups = graph.groups.length;
      this.lastDiagnostics.graphMaxDiameter = diameters.length ? Math.max(...diameters) : 0;
      this.lastDiagnostics.graphMeanDiameter = diameters.length
        ? diameters.reduce((sum, value) => sum + value, 0) / diameters.length : 0;
      this.lastDiagnostics.graphMstLength = graph.groups.reduce((sum, group) => sum + group.mstLength, 0);
      this.lastDiagnostics.graphBuildRuntimeMs = t1 - t0;
      return graph;
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
      let squaredAmplitudeSum = 0;
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
        squaredAmplitudeSum += amplitude * amplitude;
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
      const effectiveNeighbors = g * g / Math.max(squaredAmplitudeSum, EPS);
      const support = E >= this.config.tauE && coherence >= this.config.tauC && R >= this.config.tauR;
      const ridge = support && D <= this.config.tauD && normalCurvature < 0;
      return { g, gradX, gradY, h00, h01, h11, normalX: normal.x, normalY: normal.y, P00, P01, P11, sigmaPerp2, E, C: coherence, R, D, effectiveNeighbors, normalCurvature, support, ridge };
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
      const ridgeScore = new Float32Array(size);
      ridgeScore.fill(-Infinity);
      const ridgeD = new Float32Array(size);
      ridgeD.fill(Infinity);
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
      const effectiveNeighborSamples = [];
      const modeGateCounts = { failE: 0, failC: 0, failR: 0, failD: 0, failCurvature: 0, pass: 0 };
      const seedContexts = [];
      const fieldByModeId = new Map();

      for (const seed of confirmed) {
        const neighbors = this._neighbors(seed);
        if (!neighbors.length) continue;
        const seedStats = this._modeStats(seed);
        const seedValue = this.evaluateModeField(seedStats.mx, seedStats.my, neighbors);
        seedContexts.push({ seed, neighbors, seedStats, seedValue });
        if (seedValue) {
          fieldByModeId.set(seed.id, seedValue);
          effectiveNeighborSamples.push(seedValue.effectiveNeighbors);
          if (seedValue.E < this.config.tauE) modeGateCounts.failE++;
          else if (seedValue.C < this.config.tauC) modeGateCounts.failC++;
          else if (seedValue.R < this.config.tauR) modeGateCounts.failR++;
          else if (seedValue.D > this.config.tauD) modeGateCounts.failD++;
          else if (!(seedValue.normalCurvature < 0)) modeGateCounts.failCurvature++;
          else modeGateCounts.pass++;
        }
      }

      // Phase 1 shadow graph. It uses current/past estimator state only and is
      // intentionally excluded from the output mask until validation shows
      // that component structure separates wall modes from chained clutter.
      const surfaceGraph = this.buildSurfaceGraph(confirmed, fieldByModeId);

      for (const context of seedContexts) {
        const { seed, neighbors, seedStats, seedValue } = context;
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
            if (value.ridge && (value.E > ridgeScore[index] + EPS ||
                (Math.abs(value.E - ridgeScore[index]) <= EPS && seed.id < ridgeOwner[index]))) {
              ridge[index] = 1;
              ridgeOwner[index] = seed.id;
              ridgeScore[index] = value.E;
              ridgeD[index] = value.D;
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
        if (seedValue && seedValue.ridge) {
          const gx = clamp(Math.floor(seedStats.mx / cellWidth), 0, G - 1);
          const gy = clamp(Math.floor((this.config.worldHeight - seedStats.my) / cellHeight), 0, G - 1);
          const index = gy * G + gx;
          if (seedValue.E > ridgeScore[index] + EPS ||
              (Math.abs(seedValue.E - ridgeScore[index]) <= EPS && seed.id < ridgeOwner[index])) {
            ridge[index] = 1;
            ridgeOwner[index] = seed.id;
            ridgeScore[index] = seedValue.E;
            ridgeD[index] = seedValue.D;
            ridgeX[index] = seedStats.mx;
            ridgeY[index] = seedStats.my;
            ridgeNX[index] = seedValue.normalX;
            ridgeNY[index] = seedValue.normalY;
          }
        }
      }

      // A single Gaussian mode has D=0, R=1 and negative normal curvature at
      // its own mean. Therefore the raw union of all per-seed analytic ridges
      // admits persistent ellipse-interior modes as trivial self-ridges. Keep
      // only ridges that also belong to the dominant evidence band:
      //   T_E = max(tau_E, tau_E,dom * Q_q({E(x) > 0})).
      // Q_0.99 is robust to one extreme cell and uses only the current causal
      // estimator state; ground truth and future snapshots are not inputs.
      const positiveEvidence = [];
      for (let index = 0; index < size; index++) {
        if (evidence[index] > 0) positiveEvidence.push(evidence[index]);
      }
      positiveEvidence.sort((a, b) => a - b);
      const quantileIndex = positiveEvidence.length
        ? Math.min(positiveEvidence.length - 1, Math.floor(this.config.evidenceQuantile * (positiveEvidence.length - 1)))
        : 0;
      const evidenceReference = positiveEvidence.length ? positiveEvidence[quantileIndex] : 0;
      // The high steady-state relative threshold is too aggressive before the
      // evidence distribution has accumulated. Use a fixed causal schedule;
      // snapshot count is estimator state, not GT or a future observation.
      const rampProgress = clamp(
        ((this.lastSnapshot + 1) - this.config.dominanceRampStart) /
          (this.config.dominanceRampEnd - this.config.dominanceRampStart),
        0,
        1
      );
      const evidenceDominanceFactor = this.config.tauEDominanceStart +
        rampProgress * (this.config.tauEDominance - this.config.tauEDominanceStart);
      const evidenceDominanceThreshold = Math.max(this.config.tauE, evidenceDominanceFactor * evidenceReference);
      const ridgeBeforeDominance = ridge.slice();
      let rawRidgePoints = 0;
      let dominanceRidgePoints = 0;
      for (let index = 0; index < size; index++) {
        if (!ridge[index]) continue;
        rawRidgePoints++;
        const candidateEvidence = Math.max(evidence[index], ridgeScore[index]);
        if (candidateEvidence + EPS < evidenceDominanceThreshold) ridge[index] = 0;
        else dominanceRidgePoints++;
      }

      // Shadow-only anchor propagation. A component is anchored only when at
      // least one of its current candidates passes the causal Q99 gate. Lower-E
      // candidates in that same continuation component are copied to a separate
      // mask for evaluation and never alter the production ridge mask here.
      const anchoredGroups = new Set();
      for (let index = 0; index < size; index++) {
        if (!ridge[index]) continue;
        const groupId = surfaceGraph.modeToGroup.get(ridgeOwner[index]);
        if (groupId) anchoredGroups.add(groupId);
      }
      const groupById = new Map(surfaceGraph.groups.map((group) => [group.id, group]));
      const graphPropagationRidge = this.config.enableGraphPropagationShadow ? ridge.slice() : null;
      let graphPropagationAdded = 0;
      for (let index = 0; graphPropagationRidge && index < size; index++) {
        if (!ridgeBeforeDominance[index] || graphPropagationRidge[index]) continue;
        const groupId = surfaceGraph.modeToGroup.get(ridgeOwner[index]);
        const group = groupById.get(groupId);
        const candidateEvidence = Math.max(evidence[index], ridgeScore[index]);
        if (this.config.enableGraphPropagationShadow && groupId && anchoredGroups.has(groupId) &&
            candidateEvidence + EPS >= this.config.graphPropagationEvidenceRatio * evidenceDominanceThreshold &&
            group.pairSupportCount >= this.config.graphPropagationMinPairSupport &&
            group.diameter + EPS >= this.config.graphPropagationMinDiameter) {
          graphPropagationRidge[index] = 1;
          graphPropagationAdded++;
        }
      }

      // One-cell normal-direction non-maximum suppression. The analytic D gate
      // identifies a finite band around a stationary ridge; it does not force a
      // unique raster cell. Compare only candidates on the same estimated
      // normal line and retain the strongest E, then the smallest D, then the
      // lowest deterministic cell index. This thins the display/output without
      // using ground truth or changing the continuous estimator state.
      const applyNormalNms = (mask) => {
        if (!this.config.useNormalNms) return 0;
        let removed = 0;
        const beforeNms = mask.slice();
        const betterCandidate = (candidateIndex, centerIndex) => {
          if (candidateIndex < 0 || candidateIndex >= size || !beforeNms[candidateIndex]) return false;
          const candidateScore = ridgeScore[candidateIndex];
          const centerScore = ridgeScore[centerIndex];
          const scoreTolerance = 1e-6 * Math.max(1, Math.abs(candidateScore), Math.abs(centerScore));
          if (candidateScore > centerScore + scoreTolerance) return true;
          if (Math.abs(candidateScore - centerScore) > scoreTolerance) return false;
          const dTolerance = 1e-6 * Math.max(1, Math.abs(ridgeD[candidateIndex]), Math.abs(ridgeD[centerIndex]));
          if (ridgeD[candidateIndex] < ridgeD[centerIndex] - dTolerance) return true;
          if (Math.abs(ridgeD[candidateIndex] - ridgeD[centerIndex]) > dTolerance) return false;
          return candidateIndex < centerIndex;
        };

        for (let gy = 0; gy < G; gy++) {
          for (let gx = 0; gx < G; gx++) {
            const index = gy * G + gx;
            if (!beforeNms[index]) continue;
            const scaledX = ridgeNX[index] / cellWidth;
            const scaledY = -ridgeNY[index] / cellHeight;
            const scale = Math.max(Math.abs(scaledX), Math.abs(scaledY));
            if (!(scale > EPS)) continue;
            const ox = Math.round(scaledX / scale);
            const oy = Math.round(scaledY / scale);
            const gxMinus = gx - ox;
            const gyMinus = gy - oy;
            const gxPlus = gx + ox;
            const gyPlus = gy + oy;
            const minusIndex = gxMinus >= 0 && gxMinus < G && gyMinus >= 0 && gyMinus < G ? gyMinus * G + gxMinus : -1;
            const plusIndex = gxPlus >= 0 && gxPlus < G && gyPlus >= 0 && gyPlus < G ? gyPlus * G + gxPlus : -1;
            if (betterCandidate(minusIndex, index) || betterCandidate(plusIndex, index)) {
              mask[index] = 0;
              removed++;
            }
          }
        }
        return removed;
      };
      const normalNmsRemoved = applyNormalNms(ridge);
      const graphPropagationNmsRemoved = graphPropagationRidge ? applyNormalNms(graphPropagationRidge) : 0;

      const ridgePoints = [];
      const graphPropagationPoints = [];
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
          if (graphPropagationRidge && graphPropagationRidge[index]) graphPropagationPoints.push({
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
      this.lastDiagnostics.rawRidgePoints = rawRidgePoints;
      this.lastDiagnostics.dominanceRidgePoints = dominanceRidgePoints;
      this.lastDiagnostics.ridgePoints = ridgePoints.length;
      this.lastDiagnostics.normalNmsRemoved = normalNmsRemoved;
      this.lastDiagnostics.graphPropagationAdded = graphPropagationAdded;
      this.lastDiagnostics.graphPropagationNmsRemoved = graphPropagationNmsRemoved;
      this.lastDiagnostics.graphPropagationPoints = graphPropagationPoints.length;
      this.lastDiagnostics.evidenceReference = evidenceReference;
      this.lastDiagnostics.evidenceDominanceThreshold = evidenceDominanceThreshold;
      this.lastDiagnostics.evidenceDominanceFactor = evidenceDominanceFactor;
      effectiveNeighborSamples.sort((a, b) => a - b);
      const sampleQuantile = (probability) => effectiveNeighborSamples.length
        ? effectiveNeighborSamples[Math.min(effectiveNeighborSamples.length - 1,
          Math.max(0, Math.ceil(probability * effectiveNeighborSamples.length) - 1))]
        : 0;
      this.lastDiagnostics.modeFieldSamples = effectiveNeighborSamples.length;
      this.lastDiagnostics.effectiveNeighborsMean = effectiveNeighborSamples.length
        ? effectiveNeighborSamples.reduce((sum, value) => sum + value, 0) / effectiveNeighborSamples.length : 0;
      this.lastDiagnostics.effectiveNeighborsP10 = sampleQuantile(0.10);
      this.lastDiagnostics.effectiveNeighborsP50 = sampleQuantile(0.50);
      this.lastDiagnostics.effectiveNeighborsP90 = sampleQuantile(0.90);
      this.lastDiagnostics.modeFailE = modeGateCounts.failE;
      this.lastDiagnostics.modeFailC = modeGateCounts.failC;
      this.lastDiagnostics.modeFailR = modeGateCounts.failR;
      this.lastDiagnostics.modeFailD = modeGateCounts.failD;
      this.lastDiagnostics.modeFailCurvature = modeGateCounts.failCurvature;
      this.lastDiagnostics.modePassLocalRidge = modeGateCounts.pass;
      return {
        G, cellWidth, cellHeight, evidence, coherence, concentration, stationarity, support,
        ridge, ridgePoints,
        graphPropagationRidge: graphPropagationRidge || new Uint8Array(0),
        graphPropagationPoints,
      };
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
            Wori: finiteOr(mode.Wori, mode.W),
            H: mode.H,
            lastSupportedSnapshot: mode.lastSupportedSnapshot,
            averageMass: mode.W / Math.max(mode.H, 1),
            gamma: stats.gamma,
            effectiveCoherence: stats.effectiveCoherence,
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

    exportSurfaceGraph() {
      const graph = this.lastSurfaceGraph || { nodes: [], edges: [], groups: [], modeToGroup: new Map() };
      return {
        nodes: graph.nodes.map((node) => ({ ...node, groupId: graph.modeToGroup.get(node.id) || 0 })),
        edges: graph.edges.map((edge) => ({
          leftModeId: graph.nodes[edge.left].id,
          rightModeId: graph.nodes[edge.right].id,
          weight: edge.weight,
          normalCompatibility: edge.normalCompatibility,
          secantNormal: edge.secantNormal,
        })),
        groups: graph.groups.map((group) => ({ ...group, modeIds: group.modeIds.slice(), diameterEndpointIds: group.diameterEndpointIds.slice() })),
      };
    }

    // Test-only deterministic kernel injection. It exercises assignment,
    // persistence, stale pruning, and the per-cell capacity rule without an oracle.
    debugIngestKernels(snapshot, kernels) {
      if (!Number.isInteger(snapshot) || snapshot < 0 || snapshot <= this.lastSnapshot) throw new Error('invalid snapshot');
      const diagnostics = this._newDiagnostics(snapshot);
      this.previousOcclusion = this._buildOcclusionMap();
      const touched = new Set();
      for (const kernel of kernels || []) this._assignKernel(kernel, snapshot, touched, diagnostics);
      if (this.config.useDirectionalAssignment) {
        this._reindexModes();
        for (const key of this.cells.keys()) touched.add(key);
      }
      this._pruneAndCap(snapshot, touched, diagnostics);
      this.lastSnapshot = snapshot;
      let count = 0;
      let confirmed = 0;
      let gammaSum = 0;
      let coherenceSum = 0;
      let effectiveCoherenceSum = 0;
      for (const modes of this.cells.values()) {
        count += modes.length;
        for (const mode of modes) {
          if (mode.H >= this.config.HConf) confirmed++;
          const stats = this._modeStats(mode);
          gammaSum += stats.gamma;
          coherenceSum += stats.coherence;
          effectiveCoherenceSum += stats.effectiveCoherence;
        }
      }
      diagnostics.localModes = count;
      diagnostics.representedCells = this.cells.size;
      diagnostics.confirmedModes = confirmed;
      diagnostics.stateBytesApprox = count * (20 * 8 + MAX_PAIR_WORDS * 4);
      diagnostics.meanGamma = count ? gammaSum / count : 1;
      diagnostics.meanCmode = count ? coherenceSum / count : 0;
      diagnostics.meanCeff = count ? effectiveCoherenceSum / count : 0;
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
    buildSurfaceContinuationGraph,
    extractCorridorOuterPeakRidge,
    regularizeCorridorOffsets,
  };
});
