/* Simulation/evaluation orchestration. Truth is retained here only and is
 * never passed to TSRIPipeline. Each method consumes the very same windows.
 */
(function(root,factory){const node=typeof module==='object';const api=factory(node?require('./echo_environment.js'):root.EchoEnvironment,node?require('./tsri_pipeline.js'):root.TSRIPipeline,node?require('./tsri_solver.js'):root.TSRI,node?require('./wall_metrics.js'):root.WallMetrics);if(node)module.exports=api;else root.TSRIExperiment=api;})(globalThis,(E,P,S,WM)=>{
'use strict';
const methods=['lm','tr','vp'];
const percentile=(v,p)=>{const a=v.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor((a.length-1)*p)]:null;};
const mean=v=>v.length?v.reduce((s,x)=>s+x,0)/v.length:null;
function wallNormal(hit,segments){
  let best=Infinity,result=null;
  for(const s of segments){const dx=s.bx-s.ax,dy=s.by-s.ay,l2=dx*dx+dy*dy;if(l2<1e-16)continue;
    const t=Math.max(0,Math.min(1,((hit.x-s.ax)*dx+(hit.y-s.ay)*dy)/l2));
    const d=(hit.x-s.ax-t*dx)**2+(hit.y-s.ay-t*dy)**2;
    if(d<best){best=d;result=[-dy/Math.sqrt(l2),dx/Math.sqrt(l2)];}
  }return result;
}
function accumulator(){return {n:0,converged:0,accepted:0,sumSq:0,normalSumSq:0,normalN:0,evalN:0,acceptedSq:0,acceptedEvalN:0,iterations:0,evaluations:0,ms:0,times:[],conditions:[],residualSq:0,reasons:{}};}
class Experiment{
  constructor(config={}){
    this.config={...E.defaults,...P.defaults,...config};
    this.config.rangeSigma=this.config.noiseSigma;this.config.poseSigma=this.config.posSigma;
    this.config.preprocess=this.config.useDiffusePaths?(this.config.scatteringMode==='withhold'?'withhold':'stress'):'raw';
    this.environment=E.create(this.config);this.pipeline=new P.Pipeline(this.config);this.truth=new Map();this.last=null;
    this.config.reflectionModel=this.environment.config.reflectionModel;
    this.stats=Object.fromEntries(methods.map(m=>[m,accumulator()]));this.exportRows=[];this.frontendMs=0;this.elapsedMs=0;
    this.gt=WM.sampleWallsArcLength(this.environment.walls,0.2);this.observed=WM.createObservedMask(this.gt);
  }
  step(){
    const start=performance.now(),frame=this.environment.step();
    // Current simulator data are generated before estimation. Only the
    // observations whitelist crosses the estimator boundary.
    const front=performance.now(),rows=this.pipeline.update(frame.t,frame.observations);this.frontendMs+=performance.now()-front;
    for(const m of frame.truth)this.truth.set(m.key,m);
    WM.markObservedGT(this.gt,this.observed,frame.truth.map(m=>m.specularHit||m.hit),1);
    const normals=new Map();
    for(const row of rows){
      const target=this.truth.get(row.centerKey),s=this.stats[row.method];
      s.n++;s.converged+=+row.converged;s.accepted+=+row.accepted;s.iterations+=row.totalIterations;s.evaluations+=row.totalEvaluations;s.ms+=row.ms;
      s.times.push(row.ms);if(s.times.length>10000)s.times.shift();s.conditions.push(row.condition);if(s.conditions.length>10000)s.conditions.shift();
      s.residualSq+=row.rmse**2;s.reasons[row.reason]=(s.reasons[row.reason]||0)+1;
      if(target){
        const hit=target.specularHit||target.hit;
        row.contactError=Math.hypot(row.x[0]-hit.x,row.x[1]-hit.y);s.sumSq+=row.contactError**2;s.evalN++;
        if(!normals.has(row.centerKey))normals.set(row.centerKey,wallNormal(hit,this.environment.segments));
        const n=normals.get(row.centerKey);
        if(row.normal&&n){const angle=Math.acos(Math.min(1,Math.abs(S.dot(row.normal,n))))*180/Math.PI;row.normalError=angle;s.normalSumSq+=angle**2;s.normalN++;}
        if(row.accepted){s.acceptedSq+=row.contactError**2;s.acceptedEvalN++;}
      }
      this.exportRows.push(row);if(this.exportRows.length>30000)this.exportRows.splice(0,3);
    }
    const oldest=frame.t-Math.max(10,this.config.window*0.05*4);for(const [key,m] of this.truth)if(m.t<oldest)this.truth.delete(key);
    this.last=frame;this.elapsedMs+=performance.now()-start;return rows;
  }
  summary(){
    const d=this.pipeline.diagnostics,out={};
    for(const method of methods){const s=this.stats[method],metrics=WM.computeBoundaryMetrics(this.pipeline.map[method],this.gt,this.observed,0.4);
      out[method]={windows:s.n,convergence:s.n?s.converged/s.n:null,outputRate:d.windows?s.accepted/d.windows:null,accepted:s.accepted,
        contactRMSE:s.evalN?Math.sqrt(s.sumSq/s.evalN):null,acceptedRMSE:s.acceptedEvalN?Math.sqrt(s.acceptedSq/s.acceptedEvalN):null,
        normalRMSE:s.normalN?Math.sqrt(s.normalSumSq/s.normalN):null,rangeRMSE:s.n?Math.sqrt(s.residualSq/s.n):null,
        meanMs:s.n?s.ms/s.n:null,p95Ms:percentile(s.times,.95),iterations:s.n?s.iterations/s.n:null,evaluations:s.n?s.evaluations/s.n:null,
        conditionMedian:s.conditions.length?s.conditions.slice().sort((a,b)=>a-b)[Math.floor(s.conditions.length/2)]:null,reasons:{...s.reasons},mapPrecision:metrics.precision,mapRecall:metrics.recall,mapF1:metrics.f1};
    }return out;
  }
  snapshot(){return {config:this.config,walls:this.environment.walls,bots:this.last?.bots||this.environment.bots(),poses:this.last?.poses||[],
    paths:(this.last?.truth||[]).slice(0,250).map(m=>({tx:m.tx,rx:m.rx,hit:m.hit})),step:this.last?.step||0,time:this.last?.t||0,
    maps:this.pipeline.map,candidates:this.pipeline.candidates,diagnostics:this.pipeline.diagnostics,summary:this.summary(),lastComparison:this.pipeline.lastComparison,
    reflection:this.last?.reflection||null,
    coverage:this.observed.length?this.observed.reduce((s,v)=>s+v,0)/this.observed.length:0,elapsedMs:this.elapsedMs,frontendMs:this.frontendMs};}
}
// Seed-level intervals, not falsely independent overlapping-window intervals.
// Student t for n>=2 (tabulated 0.975 quantiles); null for a single seed.
function confidence(values){
  const a=values.filter(Number.isFinite),n=a.length;if(!n)return {mean:null,low:null,high:null,n};const m=mean(a);
  if(n<2)return {mean:m,low:null,high:null,n};
  const t=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];
  const variance=a.reduce((s,x)=>s+(x-m)**2,0)/(n-1),h=(t[Math.min(n-1,30)]||1.96)*Math.sqrt(variance/n);
  return {mean:m,low:m-h,high:m+h,n};
}
function aggregate(trials){
  const out={};for(const m of methods){out[m]={};for(const metric of ['contactRMSE','normalRMSE','rangeRMSE','convergence','outputRate','meanMs','p95Ms','mapF1'])out[m][metric]=confidence(trials.map(t=>t.summary[m][metric]));}
  const paired={};for(const m of ['tr','vp'])paired[m]={};
  for(const m of ['tr','vp'])for(const metric of ['contactRMSE','meanMs','rangeRMSE'])paired[m][metric]=confidence(trials.map(t=>{const a=t.summary[m][metric],b=t.summary.lm[metric];return Number.isFinite(a)&&Number.isFinite(b)?a-b:NaN;}));
  return {methods:out,pairedVsLM:paired,trials:trials.length};
}
return {Experiment,confidence,aggregate,methods};
});
