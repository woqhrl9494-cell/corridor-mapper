/* Environment extracted from the public EchoMap 5b03dc7 source.
 * Corridor/Torus geometry, vehicle motion and RNG algorithms are preserved.
 * Reflection uses the exact planar solution on the existing finite segments;
 * corrected path selection changes observations and RNG consumption.
 * Pose reports additionally receive a
 * reproducible per-vehicle constant Gaussian bias, shared across time/pairs.
 * This is a pose-error model for GLS validation, not an IMU/GNSS simulator.
 */
(function(root,factory){const api=factory(typeof module==='object'?require('./diffuse_path.js'):root.DiffusePath);if(typeof module==='object')module.exports=api;else root.EchoEnvironment=api;})(globalThis,(DiffusePath)=>{
'use strict';
const REFLECTION_MODEL='specular-segment-v2';
const REFLECTION_TOL=1e-10;
// Physical distance tolerance [m], including coordinate roundoff. This is not
// an incidence-angle bandwidth or a sensor-noise-dependent acceptance gate.
function geometryTolerance(a,b,c,d){
  return 1e-9+64*Number.EPSILON*Math.max(1,Math.abs(a.x),Math.abs(a.y),Math.abs(b.x),Math.abs(b.y),Math.abs(c.x),Math.abs(c.y),Math.abs(d.x),Math.abs(d.y));
}
// Cache static facet frames once per environment; do not allocate arrays or
// recompute wall normals for every pair on every frame. Storage O(S).
function prepareFacet(seg){
  const dx=seg.bx-seg.ax,dy=seg.by-seg.ay,length=Math.hypot(dx,dy);
  return {seg,dx,dy,length,ux:dx/length,uy:dy/length,
    minX:Math.min(seg.ax,seg.bx),maxX:Math.max(seg.ax,seg.bx),minY:Math.min(seg.ay,seg.by),maxY:Math.max(seg.ay,seg.by)};
}
/** Exact single specular reflection on a finite planar segment in 2D.
 * Input: tx/rx {x,y} [m], seg {ax,ay,bx,by} [m]. Output: null or
 * {hit:{x,y},u,length,residual}; u is dimensionless, length is total range [m].
 * Mirror method: s* = (h_rx*s_tx + h_tx*s_rx)/(h_tx+h_rx), using positive
 * heights above the SAME face. Tx/Rx must not lie on the supporting line.
 * Require an interior hit: corner diffraction and grazing paths are outside
 * this model. Reflection residual tests the full outgoing direction vector.
 * Cost O(1), memory O(1). No estimator or TSRI approximation is used here.
 */
function specularOnSegment(tx,rx,seg){
  if(![tx.x,tx.y,rx.x,rx.y,seg.ax,seg.ay,seg.bx,seg.by].every(Number.isFinite))return null;
  const a={x:seg.ax,y:seg.ay},b={x:seg.bx,y:seg.by},tol=geometryTolerance(tx,rx,a,b);
  return specularOnFacet(tx,rx,prepareFacet(seg),tol);
}
function specularOnFacet(tx,rx,facet,tol){
  const {seg,length,ux,uy}=facet,nx=-uy,ny=ux;
  if(length<=2*tol)return null;
  const st=(tx.x-seg.ax)*ux+(tx.y-seg.ay)*uy,sr=(rx.x-seg.ax)*ux+(rx.y-seg.ay)*uy;
  const ht=(tx.x-seg.ax)*nx+(tx.y-seg.ay)*ny,hr=(rx.x-seg.ax)*nx+(rx.y-seg.ay)*ny;
  if(Math.abs(ht)<=tol||Math.abs(hr)<=tol||Math.sign(ht)!==Math.sign(hr))return null;
  const s=st+(sr-st)*(Math.abs(ht)/(Math.abs(ht)+Math.abs(hr)));
  if(s<=tol||s>=length-tol)return null;
  const hit={x:seg.ax+s*ux,y:seg.ay+s*uy};
  const d1=Math.hypot(hit.x-tx.x,hit.y-tx.y),d2=Math.hypot(rx.x-hit.x,rx.y-hit.y);
  const ix=(hit.x-tx.x)/d1,iy=(hit.y-tx.y)/d1,ox=(rx.x-hit.x)/d2,oy=(rx.y-hit.y)/d2;
  const dn=ix*nx+iy*ny,residual=Math.hypot(ox-(ix-2*dn*nx),oy-(iy-2*dn*ny));
  if(!Number.isFinite(residual)||residual>REFLECTION_TOL)return null;
  return {hit,u:s/length,length:d1+d2,residual};
}
/** Does a CLOSED wall segment intersect the OPEN propagation leg?
 * Input in metres. Includes obstacle vertices and collinear overlaps;
 * excludes only numerical endpoint contact, not the old 5 cm blind region.
 * Cost O(1), memory O(1). The caller checks every obstacle (O(S) per leg).
 */
function prepareLeg(origin,target,tol){
  const dx=target.x-origin.x,dy=target.y-origin.y,len=Math.hypot(dx,dy);
  return {origin,dx,dy,len,tol,endpoint:tol/len,
    minX:Math.min(origin.x,target.x),maxX:Math.max(origin.x,target.x),minY:Math.min(origin.y,target.y),maxY:Math.max(origin.y,target.y)};
}
function facetBlocksLeg(leg,facet){
  const {origin,dx,dy,len,tol,endpoint}=leg,{seg,dx:ex,dy:ey,length:sl}=facet;
  if(len<=2*tol)return true;
  if(sl<=tol)return false;
  if(leg.maxX<facet.minX-tol||leg.minX>facet.maxX+tol||leg.maxY<facet.minY-tol||leg.minY>facet.maxY+tol)return false;
  const ax=seg.ax-origin.x,ay=seg.ay-origin.y,cross=dx*ey-dy*ex;
  if(Math.abs(cross)>32*Number.EPSILON*len*sl){
    const t=(ax*ey-ay*ex)/cross,u=(ax*dy-ay*dx)/cross;
    return t>endpoint&&t<1-endpoint&&u>=-tol/sl&&u<=1+tol/sl;
  }
  if(Math.abs(ax*dy-ay*dx)>tol*len)return false;
  const ta=(ax*dx+ay*dy)/(len*len),tb=ta+(ex*dx+ey*dy)/(len*len);
  return Math.min(ta,tb)<1-endpoint&&Math.max(ta,tb)>endpoint;
}
function segmentBlocksLeg(origin,target,seg){
  const tol=geometryTolerance(origin,target,{x:seg.ax,y:seg.ay},{x:seg.bx,y:seg.by});
  return facetBlocksLeg(prepareLeg(origin,target,tol),prepareFacet(seg));
}
const defaults={reflectionModel:REFLECTION_MODEL,seed:42,gap:10,rough:0.4,curve:0.25,torusR:10,nBots:8,speed:5,spread:6,noiseSigma:0.1,posSigma:0.1,useDiffusePaths:false,diffuseSigma:1,diffuseMean:2,scenario:'corridor'};
function create(supplied={}){
const config={...defaults,...supplied,reflectionModel:REFLECTION_MODEL};
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

let wallArcTables = [],wallFacets=[],wallMin={x:0,y:0},wallMax={x:0,y:0};
function isPathOccluded(origin,target,ignoreSegment=null){
  const leg=prepareLeg(origin,target,geometryTolerance(origin,target,wallMin,wallMax));
  return wallFacets.some(facet=>facet.seg!==ignoreSegment&&facetBlocksLeg(leg,facet));
}
function newReflectionDiagnostics(){
  return {testedSegments:0,stationaryCandidates:0,occludedPaths:0,cappedPaths:0,retainedPaths:0,maxResidual:0};
}
let reflectionDiagnostics=newReflectionDiagnostics();

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

  // Examine every facet BEFORE applying the existing four-path-per-wall cap.
  // Ranking facet midpoints first can omit the actual stationary reflection.
  // Geometry O(S), visibility O(V*S), memory O(V): S facets, V valid roots.
  const roots=[],tol=geometryTolerance(txPos,rxPos,wallMin,wallMax);
  for(const facet of wallFacets){
    const seg=facet.seg;
    reflectionDiagnostics.testedSegments++;
    const root=specularOnFacet(txPos,rxPos,facet,tol);
    if(!root)continue;
    reflectionDiagnostics.stationaryCandidates++;
    if(isPathOccluded(txPos,root.hit,seg)||isPathOccluded(root.hit,rxPos,seg)){
      reflectionDiagnostics.occludedPaths++;continue;
    }
    roots.push({seg,...root});
  }
  roots.sort((a,b)=>(a.seg.wid-b.seg.wid)||(a.length-b.length)||(a.seg.segmentIndex-b.seg.segmentIndex));
  const counts=new Map(),candidates=[];
  for(const root of roots){
    const {seg,hit:{x:hx,y:hy},u:t}=root,wall=seg.wid??0;
    if((counts.get(wall)||0)>=K_PER_WALL){reflectionDiagnostics.cappedPaths++;continue;}
    counts.set(wall,(counts.get(wall)||0)+1);
    reflectionDiagnostics.retainedPaths++;
    reflectionDiagnostics.maxResidual=Math.max(reflectionDiagnostics.maxResidual,root.residual);
    const iL=Math.hypot(hx-txPos.x,hy-txPos.y),rL=Math.hypot(rxPos.x-hx,rxPos.y-hy);

    if(!diffuse.enabled){
      // Noise is added only AFTER the physical reflection is computed.
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
wallFacets=wallSegs.map(prepareFacet);
wallMin={x:Math.min(...wallFacets.map(f=>f.minX)),y:Math.min(...wallFacets.map(f=>f.minY))};
wallMax={x:Math.max(...wallFacets.map(f=>f.maxX)),y:Math.max(...wallFacets.map(f=>f.maxY))};
computeSpineArc();spawnRobots();
const poseRng=seededRNG((config.seed^0x5a871bcd)>>>0);
const biases=bots.map(()=>({x:randn(poseRng)*config.posSigma,y:randn(poseRng)*config.posSigma}));
let stepIndex=0;
function step(){
 reflectionDiagnostics=newReflectionDiagnostics();
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
 return {t,step:stepIndex,observations,truth,poses,bots:bots.map(b=>({...b.pos})),diffuse:{...diffuseDiagnostics},reflection:{...reflectionDiagnostics}};
}
return {config,step,walls:[topWall,botWall],segments:wallSegs,spine,bots:()=>bots.map(b=>({...b.pos})),DT,geometryDiagnostics:window.lastCorridorGeometryDiagnostics};
}
return {create,defaults,specularOnSegment,segmentBlocksLeg,REFLECTION_MODEL,REFLECTION_TOL};
});
