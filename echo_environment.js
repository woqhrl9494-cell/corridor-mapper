/* Environment extracted from the public EchoMap 5b03dc7 source.
 * Corridor/Torus geometry, vehicle motion, range RNG and reflection generator
 * retain their original implementations. Pose reports additionally receive a
 * reproducible per-vehicle constant Gaussian bias, shared across time/pairs.
 * This is a pose-error model for GLS validation, not an IMU/GNSS simulator.
 */
(function(root,factory){const api=factory(typeof module==='object'?require('./diffuse_path.js'):root.DiffusePath);if(typeof module==='object')module.exports=api;else root.EchoEnvironment=api;})(globalThis,(DiffusePath)=>{
'use strict';
const defaults={seed:42,gap:10,rough:0.4,curve:0.25,torusR:10,nBots:8,speed:5,spread:6,noiseSigma:0.1,posSigma:0.1,useDiffusePaths:false,diffuseSigma:1,diffuseMean:2,scenario:'corridor'};
function create(supplied={}){
const config={...defaults,...supplied};
const document={getElementById:id=>({value:config[id],checked:!!config[id]}),documentElement:{dataset:{}}};
const window={DiffusePath};
const WW=60,WH=30,EPS=1e-9,DT=0.05,K_PER_WALL=4,GM_NOISE_STD=config.noiseSigma;
const finiteOr=(x,d)=>Number.isFinite(x)?x:d,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
let topWall=[],botWall=[],wallSegs=[],spine=[],bots=[],scenarioMode=config.scenario;
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

window.RevisedWallEstimator={regularizeCorridorOffsets};
function getDiffuseSettings(){
  const enabled=!!document.getElementById('useDiffusePaths')?.checked;
  const sigmaS=enabled?Math.max(0,+(document.getElementById('diffuseSigma')?.value||0)):0;
  const configuredMean=Math.max(1,+(document.getElementById('diffuseMean')?.value||1));
  return {enabled,sigmaS,meanPathCount:enabled&&sigmaS>EPS?configuredMean:1};
}
function seededRNG(seed) {
  let s = (seed|0) + 1;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

// Deterministic standard normal from [0,1) RNG (Box–Muller), for repeatable range noise.
// Mathematical meaning: ϵ ~ N(0,1), r = d + σ_τ·ϵ in each simulation step.
// Why this avoids instability: reproducible noise stabilizes ablation/evaluation under fixed seed and avoids random drift.
function randn(rng) {
  const u1 = Math.max(EPS, rng());
  const u2 = Math.max(EPS, rng());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function simPairNoiseRng(seedBase, stepIdx, pairIdx, txPos, rxPos) {
  const sx = Math.imul(stepIdx + 1, 0x9E3779B9);
  const sy = Math.imul(pairIdx + 1, 0x85EBCA6B);
  const sp = Math.imul(((txPos.x * 1000) | 0), 0xC2B2AE35);
  const sr = Math.imul(((rxPos.y * 1000) | 0), 0x27D4EB2D);
  const seed = (seedBase + sx + sy + sp + sr) >>> 0;
  return seededRNG(seed);
}

function polylineMaxTurnAngle(points){
  const lengths=[];
  for(let i=1;i<points.length;i++){
    const length=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
    if(length>EPS) lengths.push(length);
  }
  lengths.sort((a,b)=>a-b);
  const meaningfulLength=0.25*(lengths[Math.floor(lengths.length/2)]||0);
  let maximum=0;
  for(let i=1;i<points.length-1;i++){
    const ax=points[i].x-points[i-1].x,ay=points[i].y-points[i-1].y;
    const bx=points[i+1].x-points[i].x,by=points[i+1].y-points[i].y;
    const la=Math.hypot(ax,ay),lb=Math.hypot(bx,by);
    // Hard domain clamping can create sub-pixel backtracking segments at x=0
    // or x=WW. They do not form a rendered wall corner and must not dominate
    // the geometric turn diagnostic.
    if(!(la>=meaningfulLength&&lb>=meaningfulLength)) continue;
    const cosine=Math.max(-1,Math.min(1,(ax*bx+ay*by)/(la*lb)));
    maximum=Math.max(maximum,Math.acos(cosine));
  }
  return maximum;
}

// ═══════════════════════════════════════
// CORRIDOR WALLS
// ═══════════════════════════════════════
function makeCorridorWalls() {
  const seed  = +document.getElementById('seed').value;
  const rough = +document.getElementById('rough').value * 0.5;
  const curve = +document.getElementById('curve').value;
  const gap   = +document.getElementById('gap').value;
  const rng   = seededRNG(seed);
  const nPts  = 600;

  // A curvature-budgeted Fourier centerline is C2 continuous and cannot
  // concentrate an almost-right-angle turn in one short interval. One, two,
  // and three full cycles make the maximum setting visibly meander. Their
  // modest amplitudes provide a stable backbone; random-phase terms below
  // determine the seed-specific asymmetry. Wall texture is added separately.
  const harmonicCycles=[1,2,3];
  const randomSign=()=>rng()<0.5?-1:1;
  // Metre-valued backbone amplitudes at curve=0.5. The two-cycle term prevents
  // the tunnel from spending its full curvature range on one broad half-wave.
  const harmonicBaseAmplitudes=[0.30,1.20,0.15];
  const harmonicCoefficients=[
    randomSign()*harmonicBaseAmplitudes[0],
    randomSign()*harmonicBaseAmplitudes[1],
    randomSign()*harmonicBaseAmplitudes[2],
  ];
  // Random-phase terms break the left/right cosine symmetry. Multiplication by
  // sin^2(pi*x/WW) makes both their value and first derivative vanish at the
  // map boundaries, so randomness cannot reintroduce clipped end hooks.
  const asymmetryCycles=[1,2,3];
  const asymmetryBaseAmplitudes=[2.0,1.5,0.35];
  const asymmetryTerms=asymmetryCycles.map((cycles,index)=>({
    cycles,
    amplitude:asymmetryBaseAmplitudes[index]*(0.70+0.60*rng()),
    phase:rng()*Math.PI*2,
  }));
  const margin=gap*0.5+rough*6.5+1.0;
  const verticalLimit=Math.max(0,WH*0.5-margin);
  const curveGain=Math.max(0,Math.min(1,curve/0.5));
  const nominalOffset=gap*0.5+2.5*rough;
  const rawShape=new Float64Array(nPts+1);
  const rawFirstDerivative=new Float64Array(nPts+1);
  const rawSecondDerivative=new Float64Array(nPts+1);
  let rawMin=Infinity,rawMax=-Infinity;
  let rawMaxSecondDerivative=0;
  for(let i=0;i<=nPts;i++){
    const x=(i/nPts)*WW;
    let value=0,firstDerivative=0,secondDerivative=0;
    for(let index=0;index<harmonicCoefficients.length;index++){
      const waveNumber=harmonicCycles[index]*Math.PI*2/WW;
      const coefficient=harmonicCoefficients[index];
      const phase=waveNumber*x;
      value+=coefficient*Math.cos(phase);
      firstDerivative-=coefficient*waveNumber*Math.sin(phase);
      secondDerivative-=coefficient*waveNumber*waveNumber*Math.cos(phase);
    }
    const envelopePhase=Math.PI*x/WW;
    const envelope=Math.sin(envelopePhase)**2;
    const envelopeD=(Math.PI/WW)*Math.sin(2*envelopePhase);
    const envelopeDD=2*(Math.PI/WW)**2*Math.cos(2*envelopePhase);
    for(const term of asymmetryTerms){
      const waveNumber=term.cycles*Math.PI*2/WW;
      const phase=waveNumber*x+term.phase;
      const sine=Math.sin(phase),cosine=Math.cos(phase);
      value+=term.amplitude*envelope*sine;
      firstDerivative+=term.amplitude*(envelopeD*sine+envelope*waveNumber*cosine);
      secondDerivative+=term.amplitude*(
        envelopeDD*sine+2*envelopeD*waveNumber*cosine-envelope*waveNumber*waveNumber*sine);
    }
    rawShape[i]=value;
    rawFirstDerivative[i]=firstDerivative;
    rawSecondDerivative[i]=secondDerivative;
    rawMin=Math.min(rawMin,value);rawMax=Math.max(rawMax,value);
    rawMaxSecondDerivative=Math.max(rawMaxSecondDerivative,Math.abs(secondDerivative));
  }
  const rawCenter=0.5*(rawMin+rawMax);
  const rawHalfRange=0.5*(rawMax-rawMin);
  // Since |kappa| <= scale*|f''| for y=scale*f(x), this bound is
  // conservative even when the centerline slope is nonzero.
  const curvatureScale=curveGain>EPS
    ?Math.min(1,0.70/Math.max(EPS,nominalOffset*curveGain*rawMaxSecondDerivative)):1;
  const preScale=curveGain*curvatureScale;
  const verticalScale=preScale*rawHalfRange>EPS?Math.min(1,verticalLimit/(preScale*rawHalfRange)):1;
  const shapeScale=preScale*verticalScale;
  const maxDev=shapeScale*rawHalfRange;
  const spineRaw=[];
  for(let i=0;i<=nPts;i++){
    const x=(i/nPts)*WW;
    spineRaw.push({
      pt:{x,y:WH*0.5+(rawShape[i]-rawCenter)*shapeScale},
      d:{x:1,y:rawFirstDerivative[i]*shapeScale},
      dd:{x:0,y:rawSecondDerivative[i]*shapeScale},
    });
  }

  const n=spineRaw.length;
  const nH=14, nR=6;
  const hA=[],hF=[],hP=[], rA=[],rF=[],rP=[];
  const rngT=seededRNG(seed+7);
  const rngB=seededRNG(seed+77);
  for (let k=0;k<nH;k++){
    hF.push((k+1)*Math.PI*2/n);
    hA.push(rough*(1.5/(k+1))*(rngT()*2-1));
    hP.push(rngT()*Math.PI*2);
  }
  for (let k=0;k<nR;k++){
    rF.push((nH+k+2)*Math.PI*2/n);
    rA.push(rough*0.25*(rngT()*2-1));
    rP.push(rngT()*Math.PI*2);
  }
  const hAb=[],hPb=[],rAb=[],rPb=[];
  for (let k=0;k<nH;k++){
    hAb.push(rough*(1.5/(k+1))*(rngB()*2-1));
    hPb.push(rngB()*Math.PI*2);
  }
  for (let k=0;k<nR;k++){
    rAb.push(rough*0.25*(rngB()*2-1));
    rPb.push(rngB()*Math.PI*2);
  }

  const geometry=new Array(n);
  const desiredTop=new Float64Array(n),desiredBottom=new Float64Array(n);
  const signedCurvature=new Float64Array(n),arcLength=new Float64Array(n);
  for (let i=0;i<spineRaw.length;i++){
    const {pt,d,dd}=spineRaw[i];
    const dl=Math.hypot(d.x,d.y)+EPS;
    const nx=-d.y/dl, ny=d.x/dl;
    const speed2=d.x*d.x+d.y*d.y;
    signedCurvature[i]=(d.x*dd.y-d.y*dd.x)/Math.max(EPS,Math.pow(speed2,1.5));
    if(i>0) arcLength[i]=arcLength[i-1]+Math.hypot(pt.x-spineRaw[i-1].pt.x,pt.y-spineRaw[i-1].pt.y);
    let wT=0,wB=0;
    for (let k=0;k<nH;k++){
      wT+=hA[k] *Math.cos(hF[k]*i+hP[k]);
      wB+=hAb[k]*Math.cos(hF[k]*i+hPb[k]);
    }
    for (let k=0;k<nR;k++){
      wT+=rA[k] *Math.cos(rF[k]*i+rP[k]);
      wB+=rAb[k]*Math.cos(rF[k]*i+rPb[k]);
    }
    const halfG    = gap * 0.5;
    const MIN_HALF = 1.2;
    desiredTop[i]=Math.max(MIN_HALF,halfG+wT);
    desiredBottom[i]=Math.max(MIN_HALF,halfG+wB);
    geometry[i]={pt,nx,ny};
  }
  const safeOffsets=window.RevisedWallEstimator.regularizeCorridorOffsets(
    desiredTop,desiredBottom,signedCurvature,arcLength,
    {safetyProduct:0.72,maxOffsetSlope:0.35});

  const topWall=[], botWall=[], spineOut=[];
  for(let i=0;i<n;i++){
    const {pt,nx,ny}=geometry[i];
    const offT=safeOffsets.top[i],offB=safeOffsets.bottom[i];
    const MARGIN = 0.5;
    const twx = pt.x+nx*offT, twy = pt.y+ny*offT;
    const bwx = pt.x-nx*offB, bwy = pt.y-ny*offB;
    topWall.push({ x: Math.max(MARGIN, Math.min(WW-MARGIN, twx)),
                   y: Math.max(MARGIN, Math.min(WH-MARGIN, twy)) });
    botWall.push({ x: Math.max(MARGIN, Math.min(WW-MARGIN, bwx)),
                   y: Math.max(MARGIN, Math.min(WH-MARGIN, bwy)) });
    spineOut.push({ x:pt.x, y:pt.y, nx, ny });
  }
  const centerlineMirrorRms=Math.sqrt(spineRaw.reduce((sum,sample,index)=>{
    const mirrored=spineRaw[n-1-index];
    return sum+(sample.pt.y-mirrored.pt.y)**2;
  },0)/n);
  // Generation-only audit data. This is never passed to either estimator.
  window.lastCorridorGeometryDiagnostics={
    harmonicCount:harmonicCoefficients.length,
    harmonicCycles:harmonicCycles.join(','),
    asymmetryTermCount:asymmetryTerms.length,
    centerlineAmplitude:maxDev,
    centerlineMirrorRms,
    maxOffsetCurvatureProduct:safeOffsets.maxOffsetCurvatureProduct,
    maxTopTurnAngle:polylineMaxTurnAngle(topWall),
    maxBottomTurnAngle:polylineMaxTurnAngle(botWall),
    minimumPairedWidth:topWall.reduce((minimum,point,index)=>
      Math.min(minimum,Math.hypot(point.x-botWall[index].x,point.y-botWall[index].y)),Infinity),
  };
  document.documentElement.dataset.corridorGeometryAudit=JSON.stringify(window.lastCorridorGeometryDiagnostics);
  return { topWall, botWall, spineOut };
}

// ═══════════════════════════════════════
// TORUS WALLS
// ═══════════════════════════════════════
function makeTorusWalls(){
  const seed  = +document.getElementById('seed').value;
  const rough = +document.getElementById('rough').value * 0.5;
  const gap   = +document.getElementById('gap').value;
  const R     = +document.getElementById('torusR').value;
  const nPts  = 800;
  const cx = WW*0.5, cy = WH*0.5;

  const rngI = seededRNG(seed+3);
  const rngO = seededRNG(seed+77);
  const nH=10, nR2=5;
  const hFI=[],hAI=[],hPI=[], rFI=[],rAI=[],rPI=[];
  const hFO=[],hAO=[],hPO=[], rFO=[],rAO=[],rPO=[];
  for(let k=0;k<nH;k++){
    const f=(k+1)*Math.PI*2/nPts;
    hFI.push(f); hAI.push(rough*(1.2/(k+1))*(rngI()*2-1)); hPI.push(rngI()*Math.PI*2);
    hFO.push(f); hAO.push(rough*(1.2/(k+1))*(rngO()*2-1)); hPO.push(rngO()*Math.PI*2);
  }
  for(let k=0;k<nR2;k++){
    const f=(nH+k+2)*Math.PI*2/nPts;
    rFI.push(f); rAI.push(rough*0.2*(rngI()*2-1)); rPI.push(rngI()*Math.PI*2);
    rFO.push(f); rAO.push(rough*0.2*(rngO()*2-1)); rPO.push(rngO()*Math.PI*2);
  }

  const innerWall=[], outerWall=[], spineOut=[];
  const halfG = gap*0.5;
  const MIN_HALF = 1.0;

  for(let i=0;i<nPts;i++){
    const ang = (i/nPts)*Math.PI*2;
    const rnx = Math.cos(ang), rny = Math.sin(ang);
    let wI=0, wO=0;
    for(let k=0;k<nH;k++){
      wI += hAI[k]*Math.cos(hFI[k]*i+hPI[k]);
      wO += hAO[k]*Math.cos(hFO[k]*i+hPO[k]);
    }
    for(let k=0;k<nR2;k++){
      wI += rAI[k]*Math.cos(rFI[k]*i+rPI[k]);
      wO += rAO[k]*Math.cos(rFO[k]*i+rPO[k]);
    }
    const rI = Math.max(MIN_HALF, halfG + wI);
    const rO = Math.max(MIN_HALF, halfG + wO);
    const sx = cx + rnx*R, sy = cy + rny*R;
    innerWall.push({ x: sx - rnx*rI, y: sy - rny*rI });
    outerWall.push({ x: sx + rnx*rO, y: sy + rny*rO });
    spineOut.push({ x: sx, y: sy, nx: -rnx, ny: -rny });
  }
  innerWall.push({...innerWall[0]});
  outerWall.push({...outerWall[0]});
  spineOut.push({...spineOut[0]});

  return { topWall: outerWall, botWall: innerWall, spineOut };
}

// ═══════════════════════════════════════
// WALL SEGMENTS
// ═══════════════════════════════════════
function buildWallSegments(topWall, botWall){
  const segs=[];
  for(let i=0;i<topWall.length-1;i++){
    const ax=topWall[i].x,ay=topWall[i].y,bx=topWall[i+1].x,by=topWall[i+1].y;
    segs.push({ax,ay,bx,by,wid:0,segmentIndex:i,mx:(ax+bx)*0.5,my:(ay+by)*0.5});
  }
  for(let i=0;i<botWall.length-1;i++){
    const ax=botWall[i].x,ay=botWall[i].y,bx=botWall[i+1].x,by=botWall[i+1].y;
    segs.push({ax,ay,bx,by,wid:1,segmentIndex:i,mx:(ax+bx)*0.5,my:(ay+by)*0.5});
  }
  return segs;
}

let wallSegsW0 = [];
let wallSegsW1 = [];
let wallArcTables = [];
function partitionWallSegs() {
  wallSegsW0 = wallSegs.filter(s => (s.wid ?? 0) === 0);
  wallSegsW1 = wallSegs.filter(s => (s.wid ?? 0) === 1);
}

function _topKSegs(wallArr, txPos, rxPos) {
  const top = [];
  for (const seg of wallArr) {
    const lb = Math.hypot(txPos.x - seg.mx, txPos.y - seg.my)
             + Math.hypot(rxPos.x - seg.mx, rxPos.y - seg.my);
    if (top.length < K_PER_WALL || lb < top[top.length - 1].lb) {
      let lo = 0, hi = top.length;
      while (lo < hi) { const m = (lo + hi) >> 1; top[m].lb <= lb ? lo = m+1 : hi = m; }
      top.splice(lo, 0, { seg, lb });
      if (top.length > K_PER_WALL) top.length = K_PER_WALL;
    }
  }
  return top;
}

function raySegIntersect(ox,oy,dx,dy,ax,ay,bx,by){
  const ex=bx-ax,ey=by-ay,denom=dx*ey-dy*ex;
  if(Math.abs(denom)<EPS) return null;
  const t=((ax-ox)*ey-(ay-oy)*ex)/denom;
  const u=((ax-ox)*dy-(ay-oy)*dx)/denom;
  if(t>0.001&&u>1e-4&&u<1-1e-4) return {t,x:ox+t*dx,y:oy+t*dy};
  return null;
}

function isPathOccluded(origin,target){
  const dx=target.x-origin.x,dy=target.y-origin.y;
  const length=Math.hypot(dx,dy);
  if(!(length>EPS)) return true;
  const ux=dx/length,uy=dy/length;
  for(const segment of wallSegs){
    const hit=raySegIntersect(origin.x,origin.y,ux,uy,segment.ax,segment.ay,segment.bx,segment.by);
    if(hit&&hit.t<length-0.05) return true;
  }
  return false;
}

function newDiffuseDiagnostics(){
  return {
    nominalFamilies:0,
    targetPaths:0,
    generatedPaths:0,
    generationFailures:0,
    boundaryResampleCount:0,
    visibilityResampleCount:0,
    deltaCount:0,
    deltaSum:0,
    deltaSquaredSum:0,
  };
}
let diffuseDiagnostics=newDiffuseDiagnostics();

// SIMULATION — Fermat-based bistatic
// ═══════════════════════════════════════
function simulatePair(txPos, rxPos, noiseRng){
  const noise = GM_NOISE_STD;
  const localNoiseRng = noiseRng || seededRNG(1);
  const diffuse=getDiffuseSettings();

  const topSegs = [
    ..._topKSegs(wallSegsW0, txPos, rxPos),
    ..._topKSegs(wallSegsW1, txPos, rxPos),
  ];

  const candidates = [];
  for(const {seg} of topSegs){
    const {ax,ay,bx,by} = seg;
    const ex=bx-ax, ey=by-ay, sl=Math.hypot(ex,ey);
    if(sl<EPS) continue;
    const wnx=-ey/sl, wny=ex/sl;

    let t=0.5;
    for(let iter=0;iter<25;iter++){
      const px=ax+t*ex, py=ay+t*ey;
      const d1=Math.hypot(txPos.x-px,txPos.y-py)+EPS;
      const d2=Math.hypot(rxPos.x-px,rxPos.y-py)+EPS;
      const grad=((px-txPos.x)*ex+(py-txPos.y)*ey)/d1
                +((px-rxPos.x)*ex+(py-rxPos.y)*ey)/d2;
      t=Math.max(0.01,Math.min(0.99,t-0.25*grad));
    }
    if(t<0.02||t>0.98) continue;

    const hx=ax+t*ex, hy=ay+t*ey;
    const iL=Math.hypot(hx-txPos.x,hy-txPos.y); if(iL<EPS) continue;
    const iDx=(hx-txPos.x)/iL, iDy=(hy-txPos.y)/iL;
    const rDx=rxPos.x-hx, rDy=rxPos.y-hy;
    const rL=Math.hypot(rDx,rDy); if(rL<EPS) continue;
    const cosIn =Math.abs(iDx*wnx+iDy*wny);
    const cosOut=Math.abs((rDx/rL)*wnx+(rDy/rL)*wny);
    if(Math.abs(cosIn-cosOut)>0.04) continue;

    let blocked=false;
    for(const s2 of wallSegs){
      if(s2===seg) continue;
      const chk=raySegIntersect(txPos.x,txPos.y,iDx,iDy,s2.ax,s2.ay,s2.bx,s2.by);
      if(chk&&chk.t<iL-0.05){blocked=true;break;}
    }
    if(blocked) continue;

    let blocked2=false;
    const rUx=rDx/rL, rUy=rDy/rL;
    for(const s2 of wallSegs){
      if(s2===seg) continue;
      const chk=raySegIntersect(hx,hy,rUx,rUy,s2.ax,s2.ay,s2.bx,s2.by);
      if(chk&&chk.t<rL-0.05){blocked2=true;break;}
    }
    if(blocked2) continue;

    if(!diffuse.enabled){
      // Regression path: keep the original RNG call order and measurement fields.
      const eps = randn(localNoiseRng) * noise;
      const r = (iL+rL) + eps;
      candidates.push({r, hit:{x:hx,y:hy}});
      continue;
    }

    const wallId=seg.wid??0;
    const arcTable=wallArcTables[wallId];
    const specularArc=window.DiffusePath.arcLengthAtSegment(arcTable,seg.segmentIndex,t);
    const familyId=diffuseDiagnostics.nominalFamilies++;
    const targetCount=window.DiffusePath.shiftedPoisson(diffuse.meanPathCount,localNoiseRng);
    diffuseDiagnostics.targetPaths+=targetCount;
    if(!arcTable||!Number.isFinite(specularArc)){
      diffuseDiagnostics.generationFailures+=targetCount;
      continue;
    }
    const distanceToWallEnd=Math.min(specularArc,arcTable.totalLength-specularArc);
    for(let pathIndex=0;pathIndex<targetCount;pathIndex++){
      let accepted=false;
      let pathBoundaryRetries=0;
      for(let attempt=0;attempt<40;attempt++){
        const deltaS=diffuse.sigmaS>EPS?randn(localNoiseRng)*diffuse.sigmaS:0;
        const diffuseArc=specularArc+deltaS;
        if(diffuseArc<0||diffuseArc>arcTable.totalLength){
          pathBoundaryRetries++;
          diffuseDiagnostics.boundaryResampleCount++;
          continue;
        }
        const diffuseHit=window.DiffusePath.pointAtArcLength(arcTable,diffuseArc);
        if(!diffuseHit) continue;
        // A diffuse point remains on the same wall and is visibility-tested,
        // but is deliberately not subjected to the specular equal-angle gate.
        if(isPathOccluded(txPos,diffuseHit)||isPathOccluded(diffuseHit,rxPos)){
          diffuseDiagnostics.visibilityResampleCount++;
          continue;
        }
        const diffuseIL=Math.hypot(diffuseHit.x-txPos.x,diffuseHit.y-txPos.y);
        const diffuseRL=Math.hypot(rxPos.x-diffuseHit.x,rxPos.y-diffuseHit.y);
        const r=diffuseIL+diffuseRL+randn(localNoiseRng)*noise;
        candidates.push({
          r,
          hit:{x:diffuseHit.x,y:diffuseHit.y},
          specularHit:{x:hx,y:hy},
          deltaS,
          familyId,
          wallId,
          distanceToWallEnd,
          boundaryResampleCount:pathBoundaryRetries,
          diffuse:true,
        });
        diffuseDiagnostics.generatedPaths++;
        diffuseDiagnostics.deltaCount++;
        diffuseDiagnostics.deltaSum+=deltaS;
        diffuseDiagnostics.deltaSquaredSum+=deltaS*deltaS;
        accepted=true;
        break;
      }
      if(!accepted) diffuseDiagnostics.generationFailures++;
    }
  }
  if(!candidates.length) return [];
  return candidates.map(c=>({tx:{...txPos},rx:{...rxPos},...c}));
}

let spineArcPerIdx = 1.0;

function computeSpineArc(){
  let total = 0;
  for(let i = 1; i < spine.length; i++)
    total += Math.hypot(spine[i].x-spine[i-1].x, spine[i].y-spine[i-1].y);
  spineArcPerIdx = total / Math.max(1, spine.length - 1);
}

function spawnRobots(){
  const N      = +document.getElementById('nBots').value;
  const spread = +document.getElementById('spread').value;
  const gap    = +document.getElementById('gap').value;
  const maxOff = gap * 0.5 * 0.75;
  const rng    = seededRNG(+document.getElementById('seed').value + 999);
  bots = [];

  if(scenarioMode === 'torus'){
    const halfN = Math.floor(N/2);
    const halfG = gap * 0.5;
    const clusterCentre = rng();
    const clusterWidth  = 0.08;
    for(let i=0;i<N;i++){
      const frac = ((clusterCentre + (rng()*2-1)*clusterWidth) % 1 + 1) % 1;
      const si   = Math.floor(frac * spine.length) % spine.length;
      const sp   = spine[si];
      let yOff;
      if(i < halfN){ yOff = -(halfG * (0.15 + rng()*0.70)); }
      else          { yOff =  (halfG * (0.15 + rng()*0.70)); }
      bots.push({ pos: { x: sp.x + sp.nx*yOff, y: sp.y + sp.ny*yOff },
                  yOff, spineIdx: si, speedJitter: 1.0 + (rng()*2-1)*0.15 });
    }
  } else {
    const corrCentre = 0.1 + rng()*0.05;
    const corrWidth  = 0.08;
    for(let i=0;i<N;i++){
      const frac = Math.max(0, Math.min(1, corrCentre + (rng()*2-1)*corrWidth));
      const si   = Math.min(spine.length-1, Math.floor(frac * spine.length));
      const sp   = spine[si];
      const yOff = (rng()*2-1) * spread * 0.5;
      const yOffC = Math.max(-maxOff, Math.min(maxOff, yOff));
      bots.push({ pos: { x: sp.x + sp.nx*yOffC, y: sp.y + sp.ny*yOffC },
                  yOff: yOffC, spineIdx: si, speedJitter: 1.0 + (rng()*2-1)*0.15 });
    }
  }
}

function moveBots(){
  const spd = +document.getElementById('speed').value;
  const SN  = spine.length;
  const idxPerStep = (spd * DT) / spineArcPerIdx;

  for(const bot of bots){
    bot.spineIdx += idxPerStep * (bot.speedJitter ?? 1.0) * (bot.dir ?? 1);

    if(scenarioMode === 'torus'){
      if(bot.spineIdx >= SN - 1) bot.spineIdx -= (SN - 1);
      if(bot.spineIdx < 0)       bot.spineIdx += (SN - 1);
    } else {
      if(bot.spineIdx >= SN - 1){
        bot.spineIdx = 2*(SN-1) - bot.spineIdx;
        bot.dir = -(bot.dir ?? 1);
      } else if(bot.spineIdx < 0){
        bot.spineIdx = -bot.spineIdx;
        bot.dir = -(bot.dir ?? 1);
      }
      bot.spineIdx = Math.max(0, Math.min(SN-1, bot.spineIdx));
    }

    const i0  = Math.floor(bot.spineIdx);
    const i1  = Math.min(SN-1, i0+1);
    const f   = bot.spineIdx - i0;
    const spx = spine[i0].x*(1-f) + spine[i1].x*f;
    const spy = spine[i0].y*(1-f) + spine[i1].y*f;
    const snx = spine[i0].nx*(1-f) + spine[i1].nx*f;
    const sny = spine[i0].ny*(1-f) + spine[i1].ny*f;

    bot.pos.x = spx + snx * bot.yOff;
    bot.pos.y = spy + sny * bot.yOff;
  }
}


const walls=scenarioMode==='torus'?makeTorusWalls():makeCorridorWalls();
topWall=walls.topWall;botWall=walls.botWall;spine=walls.spineOut;
wallArcTables=[DiffusePath.buildWallArcTable(topWall),DiffusePath.buildWallArcTable(botWall)];
wallSegs=buildWallSegments(topWall,botWall);
if(scenarioMode==='torus')for(const [wid,w] of [[0,topWall],[1,botWall]]){
 const a=w[w.length-2],b=w[0];wallSegs.push({ax:a.x,ay:a.y,bx:b.x,by:b.y,wid,segmentIndex:w.length-2,mx:(a.x+b.x)/2,my:(a.y+b.y)/2});
}
partitionWallSegs();computeSpineArc();spawnRobots();
const poseRng=seededRNG((config.seed^0x5a871bcd)>>>0);
const biases=bots.map(()=>({x:randn(poseRng)*config.posSigma,y:randn(poseRng)*config.posSigma}));
let stepIndex=0;
function step(){
 moveBots();const t=(stepIndex+1)*DT,truth=[],observations=[];
 const poses=bots.map((b,i)=>({x:b.pos.x+biases[i].x,y:b.pos.y+biases[i].y}));
 let pair=0;for(let i=0;i<bots.length;i++)for(let j=i+1;j<bots.length;j++){
  const ms=simulatePair(bots[i].pos,bots[j].pos,simPairNoiseRng(config.seed,stepIndex,pair++,bots[i].pos,bots[j].pos));
  ms.forEach((m,k)=>{
   const key=`${stepIndex}:${i}:${j}:${k}`;
   truth.push({...m,i,j,key,t});
   observations.push({i,j,key,t,r:m.r,tx:{...poses[i]},rx:{...poses[j]},sigma:config.noiseSigma});
  });
 }
 stepIndex++;
 return {t,step:stepIndex,observations,truth,poses,bots:bots.map(b=>({...b.pos})),diffuse:{...diffuseDiagnostics}};
}
return {config,step,walls:[topWall,botWall],segments:wallSegs,spine,bots:()=>bots.map(b=>({...b.pos})),DT,geometryDiagnostics:window.lastCorridorGeometryDiagnostics};
}
return {create,defaults};
});
