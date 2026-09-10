/* Read-only frozen-candidate audit. No simulator/truth imports.
 * x[2] [m], n[2] unit normal axis, poses [m], times [s], phi dimensionless.
 * phi=tangent' * grad_x F=0; normals can have either orientation.
 * Geometry chooses events BEFORE any validation range is read.
 * H candidates, P pairs/candidate, B pose samples, K events/pair, L=42 bisections.
 * O(HPB + HPK(L+B+log(PK))) time; validation uses linear record lookup.
 * O(H+PB+HPK) storage for batch diagnostics; no real-time latency claim.
 * Shared/correlated evidence is NOT accumulated as independent likelihoods.
 */
'use strict';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1],norm=a=>Math.hypot(...a),mix=(a,b,u)=>a.map((v,k)=>v+(b[k]-v)*u);
function geometry(h,a,b,u){
 const n=h.normal,t=[-n[1],n[0]],dt=b.t-a.t,pi=mix(a.tx,b.tx,u),pj=mix(a.rx,b.rx,u),vi=a.tx.map((v,k)=>(b.tx[k]-v)/dt),vj=a.rx.map((v,k)=>(b.rx[k]-v)/dt);
 const di=h.x.map((v,k)=>v-pi[k]),dj=h.x.map((v,k)=>v-pj[k]),ri=norm(di),rj=norm(dj);
 if(Math.min(ri,rj)<1e-8)return null;
 const ei=di.map(v=>v/ri),ej=dj.map(v=>v/rj),g=ei.map((v,k)=>v+ej[k]);
 const Hvi=vi.map((v,k)=>(v-ei[k]*dot(ei,vi))/ri),Hvj=vj.map((v,k)=>(v-ej[k]*dot(ej,vj))/rj),gt=Hvi.map((v,k)=>-v-Hvj[k]);
 const sideI=dot(ei,n),sideJ=dot(ej,n);
 return {phi:dot(t,g),phiDot:dot(t,gt),g,F:ri+rj,tx:pi,rx:pj,normalAlignment:Math.abs(dot(n,g))/Math.max(norm(g),1e-300),valid:norm(g)>1e-6&&sideI*sideJ>0&&Math.min(Math.abs(sideI),Math.abs(sideJ))>1e-6};
}
function findEvents(h,positionTracks,options={}){
 const cfg={pairMode:'disjoint',timeMode:'history',minSlope:.01,maxGap:.075,until:Infinity,substeps:1,...options};
 if(![...h.x,...h.normal,h.availableAt].every(Number.isFinite)||Math.abs(norm(h.normal)-1)>1e-6)throw Error('Invalid candidate units/normal');
 const source=new Set(h.sourcePair),events=[],stats={eligiblePairs:0,weak:0,invalidReflection:0};
 if(cfg.until<h.availableAt)return {events,stats};
 for(const track of positionTracks){if(track.pair[0]===h.sourcePair[0]&&track.pair[1]===h.sourcePair[1])continue;
  const shared=track.pair.some(i=>source.has(i));if(cfg.pairMode==='disjoint'&&shared)continue;stats.eligiblePairs++;
  let last=-Infinity;
  const ps=track.positions;
  for(let k=1;k<ps.length;k++){
   const a=ps[k-1],b=ps[k];if(!(b.t>a.t))throw Error('Non-increasing pose timestamps');
   if(b.t>cfg.until||b.t-a.t>cfg.maxGap)continue;
   // Prospective audit waits for a bracket fully after candidate availability.
   if(cfg.timeMode==='prospective'&&a.t<h.availableAt-1e-10)continue;
   for(let part=0;part<cfg.substeps;part++){
    const l0=part/cfg.substeps,r0=(part+1)/cfg.substeps,A=geometry(h,a,b,l0),B=geometry(h,a,b,r0);if(!A||!B)continue;
    if(Math.abs(A.phi)>1e-12&&Math.abs(B.phi)>1e-12&&A.phi*B.phi>0)continue;
    let lo=l0,hi=r0,fl=A.phi;
    if(Math.abs(A.phi)<=1e-12)hi=lo;else if(Math.abs(B.phi)<=1e-12)lo=hi;
    else for(let it=0;it<42;it++){const m=(lo+hi)/2,v=geometry(h,a,b,m);if(!v)break;if(fl*v.phi<=0)hi=m;else{lo=m;fl=v.phi;}}
    const u=(lo+hi)/2,t=a.t+u*(b.t-a.t);if(Math.abs(t-last)<1e-7)continue;last=t;
    const geo=geometry(h,a,b,u);if(!geo?.valid){stats.invalidReflection++;continue;}
    if(Math.abs(geo.phiDot)<cfg.minSlope){stats.weak++;continue;}
    events.push({pair:track.pair.slice(),sharedVehicle:shared,t,availableAt:Math.max(h.availableAt,b.t),lowerTime:a.t,upperTime:b.t,u,...geo});
   }
  }
 }
 events.sort((a,b)=>a.availableAt-b.availableAt||a.t-b.t||a.pair[0]-b.pair[0]||a.pair[1]-b.pair[1]);
 return {events,stats};
}
function validateEvent(h,e,rangeTracks,rule=null){
 const records=rangeTracks.get(e.pair.join(':'))||[],a=records.find(r=>Math.abs(r.t-e.lowerTime)<1e-9),b=records.find(r=>Math.abs(r.t-e.upperTime)<1e-9);
 if(!a||!b)return {...e,status:'UNVERIFIED',reason:'missing_observation'};
 const ids=new Set(h.sourceIds);if(ids.has(a.key)||ids.has(b.key))throw Error('Source measurement reuse');
 if(a.t>e.availableAt+1e-9||b.t>e.availableAt+1e-9)throw Error('Future observation');
 const w=1-e.u,observed=w*a.r+e.u*b.r,residual=observed-e.F;
 const sigmaRange=Math.hypot(w*a.sigma,e.u*b.sigma),C=h.covariance||[[0,0],[0,0]],g=e.g,sourceVariance=g[0]*g[0]*C[0][0]+2*g[0]*g[1]*C[0][1]+g[1]*g[1]*C[1][1];
 const sigmaLinear=Math.sqrt(Math.max(0,sourceVariance)+sigmaRange*sigmaRange);
 // At a true specular event rho_dot=F_t (envelope theorem); time/normal
 // error has no first-order residual term. Finite errors and interpolation
 // need a separate tolerance. This is NOT a calibrated confidence test.
 const tolerance=rule?rule.modelTolerance+rule.sigmaMultiplier*sigmaLinear:null;
 return {...e,observationIds:[a.key,b.key],observed,residual,sigmaRange,sigmaLinear,tolerance,status:rule?(Math.abs(residual)<=tolerance?'SUPPORTED':'REJECTED'):'OBSERVED',reason:'range_checked'};
}
function audit(h,positionTracks,rangeTracks,options={},rule=null){
 const found=findEvents(h,positionTracks,options),checked=found.events.map(e=>validateEvent(h,e,rangeTracks,rule));
 // Selection depends only on chronology and observation presence, never r.
 const first=checked.find(e=>e.reason==='range_checked')||null;
 return {id:h.id,events:checked,geometryStats:found.stats,decision:first,status:first?.status||'UNVERIFIED',delay:first?first.availableAt-h.availableAt:null};
}
function resolveWindows(records){
 const groups=new Map();for(const r of records){if(!groups.has(r.h.rowIndex))groups.set(r.h.rowIndex,[]);groups.get(r.h.rowIndex).push(r);}
 return [...groups].map(([rowIndex,rs])=>{
  const supported=rs.filter(r=>r.result.status==='SUPPORTED'),unverified=rs.filter(r=>r.result.status==='UNVERIFIED');
  if(supported.length!==1||unverified.length)return {rowIndex,status:unverified.length?'UNVERIFIED_ALTERNATIVES':supported.length>1?'MULTIPLE_SUPPORTED':'NO_SUPPORTED',x:null,availableAt:null};
  // The alternative rejections may arrive later than positive support.
  const availableAt=Math.max(...rs.map(r=>r.result.decision.availableAt));
  return {rowIndex,status:'SINGLE_SUPPORTED',candidateId:supported[0].h.id,x:supported[0].h.x.slice(),availableAt,delay:availableAt-Math.max(...rs.map(r=>r.h.availableAt))};
 });
}
module.exports={geometry,findEvents,validateEvent,audit,resolveWindows};
