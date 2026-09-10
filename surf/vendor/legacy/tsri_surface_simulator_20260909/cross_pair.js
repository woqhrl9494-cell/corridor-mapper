/* Experimental point-support rule requested by user. Anisotropic covariance
 * is used intact. This is a heuristic score, NOT posterior probability:
 * different pairs have different contacts, and may share pose biases.
 * No candidate coordinate averaging or time pooling. O(W^2 K^2), O(WK).
 * Constants frozen before evaluation; no ground truth or residual ranking.
 */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CrossPair=api;})(globalThis,()=>{
'use strict';
const defaults=Object.freeze({selectionMode:'mixture',supportRatio:3,minSupportPairs:2,supportChi2:9.210340372,discriminationMultiplier:3});
function compatibility(a,b){
  if(!a.covariance||!b.covariance)return null;
  const A=a.covariance[0][0]+b.covariance[0][0],B=a.covariance[0][1]+b.covariance[0][1],C=a.covariance[1][1]+b.covariance[1][1],det=A*C-B*B;
  if(!(det>0))return null;
  const dx=a.x[0]-b.x[0],dy=a.x[1]-b.x[1],d2=(C*dx*dx-2*B*dx*dy+A*dy*dy)/det;
  return {d2,logDensity:-Math.log(2*Math.PI)-.5*Math.log(det)-.5*d2};
}
const logSumExp=a=>{if(!a.length)return -Infinity;const m=Math.max(...a);return m===-Infinity?m:m+Math.log(a.reduce((s,v)=>s+Math.exp(v-m),0));};
function select(rows,config={}){
  const cfg={...defaults,...config};
  for(const row of rows){
    row.accepted=false;row.selectedId=null;
    const peers=rows.filter(r=>r!==row&&r.method===row.method&&r.pair!==row.pair&&Math.abs(r.t0-row.t0)<1e-8&&!r.associationAmbiguous);
    const pairGroups=new Map();for(const p of peers){if(!pairGroups.has(p.pair))pairGroups.set(p.pair,[]);pairGroups.get(p.pair).push(p);}
    const positions=new Map();for(const p of [row,...peers])if(p.observedCenter){positions.set(p.observedCenter.i,p.observedCenter.tx);positions.set(p.observedCenter.j,p.observedCenter.rx);}
    for(const c of row.candidates){
      const logs=[];let supportPairs=0;
      for(const group of pairGroups.values()){
        const scores=group.flatMap(p=>p.candidates).map(b=>compatibility(c,b)).filter(Boolean);
        if(scores.length){logs.push(Math.max(...scores.map(s=>s.logDensity)));if(scores.some(s=>s.d2<=cfg.supportChi2))supportPairs++;}
      }
      const projections=[...positions.values()].map(p=>c.normal?c.normal[0]*p.x+c.normal[1]*p.y:NaN);let gap=Infinity;
      for(let i=0;i<projections.length;i++)for(let j=i+1;j<projections.length;j++)gap=Math.min(gap,Math.abs(projections[i]-projections[j]));
      const n=c.normal,C=c.covariance,sigma=n&&C?Math.sqrt(Math.max(0,n[0]*n[0]*C[0][0]+2*n[0]*n[1]*C[0][1]+n[1]*n[1]*C[1][1])):Infinity;
      // Dimensionally consistent: both gap and sigma are metres. This is a
      // proposed heuristic, not a proved general E-intersect-D condition.
      c.supportLog=logSumExp(logs);c.supportPairs=supportPairs;c.discriminability=positions.size>=3?gap:0;c.sigmaPerp=sigma;
      c.discriminationOK=Number.isFinite(gap)&&gap>=cfg.discriminationMultiplier*sigma;
    }
    const ordered=row.candidates.slice().sort((a,b)=>b.supportLog-a.supportLog),best=ordered[0],second=ordered[1];
    const logRatio=second&&Number.isFinite(best.supportLog)?best.supportLog-second.supportLog:-Infinity;
    row.supportLogRatio=logRatio;row.reason=cfg.selectionMode==='mixture'?'candidate_mixture':row.associationAmbiguous?'association_ambiguity':!best?.eligible?'local_quality':best.supportPairs<cfg.minSupportPairs?'insufficient_pair_support':!best.discriminationOK?'insufficient_diversity':logRatio<Math.log(cfg.supportRatio)?'cross_pair_ambiguity':'experimental_support';
    if(row.reason==='experimental_support'){
      const keep={candidates:row.candidates,rootCount:row.rootCount,totalIterations:row.totalIterations,totalEvaluations:row.totalEvaluations,ms:row.ms,starts:row.starts};
      Object.assign(row,best,keep,{accepted:true,selectedId:best.id,ambiguous:false,reason:'experimental_support'});
    }
  }
  return rows;
}
return {defaults,compatibility,select};
});
