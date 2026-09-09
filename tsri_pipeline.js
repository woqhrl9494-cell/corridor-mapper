/* TSRI front end and fixed-lag map. No simulator module imported here.
 * The bounded range-only association beam is an explicit approximation.
 * Input per frame: observed poses, pair indices, unordered measured ranges.
 * Memory: O(pairCount * beam * window + retained output), never a spatial grid.
 */
(function(root,factory){const api=factory(typeof module==='object'?require('./tsri_solver.js'):root.TSRI);if(typeof module==='object')module.exports=api;else root.TSRIPipeline=api;})(globalThis,(S)=>{
'use strict';
const defaults={window:21,stride:10,starts:4,maxIter:60,maxCondition:1e4,maxRadius:2,weighting:'gls',rangeSigma:0.1,poseSigma:0.1,beam:8,maxSurfels:12000,preprocess:'raw',clusterWidth:0.25};
const median=a=>{const b=a.slice().sort((a,b)=>a-b);return b[Math.floor(b.length/2)];};
function preprocess(ms,config){
  // A merged echo's bias cannot be inferred from one reported range. Withhold
  // unless a calibrated front end exists; never inject simulation-only truth.
  if(config.preprocess==='withhold')return [];
  const sorted=ms.slice().sort((a,b)=>a.r-b.r),clusters=[];
  for(const m of sorted){const last=clusters.at(-1);if(last&&m.r-last[0].r<=config.clusterWidth)last.push(m);else clusters.push([m]);}
  return clusters.map(c=>{
    const m=c[Math.floor(c.length/2)],mad=median(c.map(v=>Math.abs(v.r-m.r)));
    // Median cluster representative, not a minimum edge or bias estimator.
    // No 1/sqrt(M) reduction: clustered reports may share errors.
    return {...m,sigma:Math.max(1e-6,Math.hypot(m.sigma,1.4826*mad)),multiplicity:c.length};
  });
}
function predict(track,t){
  const a=track.records.slice(-9),last=a.at(-1);if(a.length<3)return last.r;
  const span=Math.max(0.05,last.t-a[0].t),A=a.map(m=>[1,(m.t-last.t)/span]);
  const q=S.leastSquares(A,a.map(m=>m.r)).x;return q[0]+q[1]*(t-last.t)/span;
}
class Pipeline{
  constructor(config={}){
    this.config={...defaults,...config};this.tracks=new Map();this.map={lm:[],tr:[],vp:[]};this.candidates={lm:[],tr:[],vp:[]};this.rows=[];
    this.diagnostics={frames:0,input:0,clusters:0,windows:0,initFailures:0,pruned:0,expired:0,withheld:0,tracks:0,setupMs:0,droppedSurfels:0};
    this.lastTime=-Infinity;this.serial=0;this.lastComparison=null;
  }
  update(t,measurements){
    if(!(t>this.lastTime))throw new Error('Frames must arrive in increasing time order');this.lastTime=t;
    const cfg=this.config,d=this.diagnostics,groups=new Map();d.frames++;d.input+=measurements.length;
    for(const m of measurements){
      if(m.t>t+1e-10)throw new Error('Future measurement rejected');
      if(m.t!==t||![m.r,m.tx.x,m.tx.y,m.rx.x,m.rx.y].every(Number.isFinite))continue;
      // Fresh whitelist copy prevents accidental hidden-field propagation.
      const clean={i:m.i,j:m.j,key:m.key,t:m.t,r:m.r,tx:{x:m.tx.x,y:m.tx.y},rx:{x:m.rx.x,y:m.rx.y},sigma:m.sigma};
      const pair=`${m.i}:${m.j}`;if(!groups.has(pair))groups.set(pair,[]);groups.get(pair).push(clean);
    }
    const newRows=[];
    for(const pair of new Set([...this.tracks.keys(),...groups.keys()])){
      const incoming=groups.get(pair)||[],ms=preprocess(incoming,cfg);d.clusters+=ms.length;if(cfg.preprocess==='withhold')d.withheld+=incoming.length;
      const previous=this.tracks.get(pair)||[],next=[],used=new Set();
      for(const track of previous){
        const last=track.records.at(-1),prediction=predict(track,t);
        const candidates=ms.map((m,index)=>{
          const travel=Math.hypot(m.tx.x-last.tx.x,m.tx.y-last.tx.y)+Math.hypot(m.rx.x-last.rx.x,m.rx.y-last.rx.y);
          const noise=Math.max(0.015,Math.hypot(m.sigma,last.sigma)),gate=travel+4*noise+0.05;
          return {m,index,error:Math.abs(m.r-prediction),gate,noise};
        }).filter(c=>c.error<=c.gate).sort((a,b)=>a.error-b.error).slice(0,2);
        if(!candidates.length){if(t-last.t<=0.151)next.push({...track,cost:track.cost+3});else d.expired++;continue;}
        for(const c of candidates){used.add(c.index);next.push({id:track.id,records:[...track.records,c.m].slice(-cfg.window),cost:track.cost*0.8+(c.error/c.noise)**2});}
      }
      ms.forEach((m,i)=>{if(!used.has(i))next.push({id:++this.serial,records:[m],cost:0});});
      // Histories identical over the last seven frames merge as association
      // hypotheses, not as independent Gaussian map evidence.
      const signatures=new Set(),beam=[];
      next.sort((a,b)=>b.records.length-a.records.length||a.cost-b.cost);
      for(const tr of next){const sig=tr.records.slice(-7).map(m=>m.key).join(',');if(signatures.has(sig))continue;signatures.add(sig);beam.push(tr);}
      d.pruned+=Math.max(0,beam.length-cfg.beam);beam.length=Math.min(beam.length,cfg.beam);this.tracks.set(pair,beam);
      if(d.frames%cfg.stride!==0)continue;
      const solvedCenters=new Set();
      for(const track of beam){
        if(track.records.length<cfg.window||track.records.at(-1).t!==t)continue;
        const centerKey=track.records[Math.floor(cfg.window/2)].key;if(solvedCenters.has(centerKey))continue;solvedCenters.add(centerKey);
        const competing=beam.some(other=>other!==track&&other.records.length===cfg.window&&other.records[Math.floor(cfg.window/2)].key===centerKey&&Math.abs(other.cost-track.cost)<2);
        d.windows++;const comparison=S.compare(track.records,{...cfg,order:d.windows});
        d.setupMs+=comparison.setupMs||0;if(comparison.reason){d.initFailures++;continue;}
        comparison.key=`${pair}:${centerKey}`;comparison.records=track.records.map(m=>({...m}));comparison.pair=pair;
        comparison.associationAmbiguous=competing;
        for(const [method,result] of Object.entries(comparison.results)){
          result.availableAt=t;result.lag=t-result.t0;
          if(competing){result.accepted=false;result.reason='association_ambiguity';}
          if(cfg.preprocess==='stress'){result.accepted=false;result.reason='uncalibrated_scattering';}
          const row={key:comparison.key,centerKey,pair,method,frame:d.frames,seed:cfg.seed,...result};
          newRows.push(row);this.rows.push(row);
          if(!result.accepted){this.candidates[method].push({x:result.x[0],y:result.x[1],normal:result.normal,t0:result.t0});if(this.candidates[method].length>600)this.candidates[method].shift();}
          if(result.accepted){this.map[method].push({x:result.x[0],y:result.x[1],normal:result.normal,covariance:result.covariance,t0:result.t0,availableAt:t,key:comparison.key});
            if(this.map[method].length>cfg.maxSurfels){this.map[method].shift();d.droppedSurfels++;}}
        }
        this.lastComparison=comparison;
      }
    }
    d.tracks=[...this.tracks.values()].reduce((s,a)=>s+a.length,0);
    // Window diagnostics retain a bounded history. Exported run-wide metrics
    // are accumulated by the evaluator, independent of this rendering buffer.
    if(this.rows.length>3000)this.rows.splice(0,this.rows.length-3000);
    return newRows;
  }
}
return {Pipeline,preprocess,predict,defaults};
});
