'use strict';
// Frozen run/legacyVP function bodies, byte-for-byte; Node file IO excluded.
const M=require('./legacy/tsri_surface_simulator_20260909/src/moments'),G=require('./legacy/tsri_surface_simulator_20260909/root_geometry'),CP=require('./legacy/tsri_surface_simulator_20260909/cross_pair'),S=require('./legacy/tsri-s-simulator/tsri_solver'),N=require('./normal_events');
function legacyVP(records,options){
 // Exact VP branch of the original compare(); LM/TR omitted only to avoid redundant runtime.
 const seeds=S.initializers(records,options.starts||4);if(!seeds.length)return {accepted:false,reason:'initialization'};
 const provisional=S.prepare(records,seeds[0],{weighting:'ols'});seeds.sort((a,b)=>S.evaluate(provisional,a,true).cost-S.evaluate(provisional,b,true).cost);
 const problem=S.prepare(records,seeds[0],options),all=seeds.map(x=>S.solve(problem,[...x,S.evaluate(problem,x,true).beta],'vp',options)).sort((a,b)=>a.cost-b.cost),best=all[0],distinct=all.filter((v,i)=>i===0||Math.hypot(v.x[0]-best.x[0],v.x[1]-best.x[1])>.5),info=S.uncertainty(problem,best),delta=distinct[1]?distinct[1].cost-best.cost:Infinity;
 const comparableDelta=problem.weighting==='ols'?delta/Math.max(1e-10,best.cost/(records.length-3)):delta,ambiguous=distinct.length>1&&comparableDelta<3.84,residualOK=problem.weighting==='gls'?info.reducedChi2<=1+3*Math.sqrt(2/(records.length-3)):best.rmse<3*Math.max(options.rangeSigma||0,.01);
 const accepted=best.converged&&!ambiguous&&info.condition<(options.maxCondition||1e4)&&info.radius95<(options.maxRadius||2)&&residualOK&&!!info.normal;
 return {...best,...info,accepted,ambiguous,alternatives:distinct.slice(1).map(s=>({x:s.x,cost:s.cost})),reason:!best.converged?best.status:ambiguous?'multiple_solutions':!Number.isFinite(info.condition)||info.condition>=(options.maxCondition||1e4)?'conditioning':info.radius95>=(options.maxRadius||2)?'uncertainty':!residualOK?'model_residual':'accepted'};
}
function run(raw,targets,protocol){
 raw={...raw,records:raw.records.filter(r=>r.t<=raw.cutoff_s)};
 const started=performance.now(),byKey=new Map(raw.records.map(r=>[r.key,r])),tracks=raw.pairs.map(pair=>({pair,positions:raw.records.filter(r=>r.i===pair[0]&&r.j===pair[1]).map(r=>({t:r.t,tx:[r.tx.x,r.tx.y],rx:[r.rx.x,r.rx.y]}))})),ranges=new Map(raw.pairs.map(pair=>[pair.join(':'),raw.records.filter(r=>r.i===pair[0]&&r.j===pair[1])]));
 const windows=[],events=[],candidates=[],timing={C_E0:0,CROSS:0,LEGACY_TSRI:0,LEGACY_C_POINT:0,CROSS_FIXED_TIMES:0};
 for(const [rowIndex,t]of targets.entries()){
  const [i,j]=t.pair,records=Array.from({length:21},(_,k)=>byKey.get(`${t.window_end_frame-20+k}:${i}:${j}`)),sourceIds=records.filter(Boolean).map(r=>r.key),base={target:t,sourceIds,candidates:[],old:{accepted:false,reason:'missing_source'},point:{accepted:false,reason:'missing_source'},cross:{status:'NO_CANDIDATES'},fixed:{status:'NO_CANDIDATES'}};
  windows.push(base);if(t.source_available_at_s>raw.cutoff_s||records.some(r=>!r))continue;
  const options={rangeSigma:raw.range_sigma_m,rangeObservationSigma:raw.range_sigma_m,poseSigma:0,available_at:t.source_available_at_s,weighting:'gls',maxIter:60,maxCondition:1e4,maxRadius:2,starts:4,selectionMode:'point'};
  let begin=performance.now();const moment=M.fit(records,options),enumeration=G.enumerate(moment,256);base.moments={a:moment.a,rho:moment.rho,rate:moment.rate,tx:moment.tx,rx:moment.rx,vtx:moment.vtx,vrx:moment.vrx,status:enumeration.status};
  base.candidates=enumeration.roots.map((r,k)=>{const p=M.propagate(moment,r.x,options),normal=M.geometry(r.x,moment).normal;return {id:`${t.target_id}/C/${k}`,rowIndex,rootIndex:k,x:r.x,normal,covariance:p.Sigma_measurement_local||null,condition:p.condition,eligible:p.valid&&p.condition<1e4,sourcePair:t.pair,t0:t.time_s,availableAt:t.source_available_at_s,sourceIds};});timing.C_E0+=(performance.now()-begin)/1000;
  candidates.push(...base.candidates);begin=performance.now();base.old=legacyVP(records,options);timing.LEGACY_TSRI+=(performance.now()-begin)/1000;
  const audited=[];begin=performance.now();for(const h of base.candidates){const a=N.audit(h,tracks,ranges,protocol.cross,protocol.cross);audited.push({h,result:a});events.push(...a.events.map((e,k)=>({...e,event_id:h.id+'/event/'+k,candidate_id:h.id,target_id:t.target_id,variant:'CROSS_E0'})));h.cross_status=a.status;h.cross_decision=a.decision;h.geometryStats=a.geometryStats;}base.cross=N.resolveWindows(audited)[0]||{status:'NO_CANDIDATES'};timing.CROSS+=(performance.now()-begin)/1000;
  begin=performance.now();const fixed=[];for(const h of base.candidates){let decision=null;outer:for(const tm of protocol.fixed_time_ablation.times_s)for(const tr of tracks){if(tr.pair.some(x=>h.sourcePair.includes(x)))continue;const k=tr.positions.findIndex(p=>Math.abs(p.t-tm)<1e-8);if(k<1)continue;const a=tr.positions[k-1],b=tr.positions[k],geo=N.geometry(h,a,b,1);if(!geo)continue;
    // Fixed-time control deliberately does not require the normal event or same-side validity.
    const e={...geo,t:tm,pair:tr.pair,u:1,lowerTime:a.t,upperTime:b.t,availableAt:Math.max(h.availableAt,b.t)};decision=N.validateEvent(h,e,ranges,protocol.cross);if(decision.reason==='range_checked')break outer;}
   const result={status:decision?.status||'UNVERIFIED',decision};fixed.push({h,result});if(decision)events.push({...decision,event_id:h.id+'/fixed',candidate_id:h.id,target_id:t.target_id,variant:'CROSS_FIXED_TIMES'});h.fixed_status=result.status;}
  base.fixed=N.resolveWindows(fixed)[0]||{status:'NO_CANDIDATES'};timing.CROSS_FIXED_TIMES+=(performance.now()-begin)/1000;
 }
 const begin=performance.now();for(const end of [...new Set(targets.map(t=>t.window_end_frame))]){const ws=windows.filter(w=>w.target.window_end_frame===end),rows=ws.map(w=>({candidates:w.candidates.map((c,k)=>({...c,id:k})),pair:w.target.pair.join(':'),method:'vp',t0:w.target.time_s,observedCenter:byKey.get(w.target.key),associationAmbiguous:false}));CP.select(rows,{selectionMode:'point'});rows.forEach((r,k)=>ws[k].point={accepted:r.accepted,reason:r.reason,x:r.accepted?r.x:null,normal:r.accepted?r.normal:null,selectedId:r.selectedId});}timing.LEGACY_C_POINT=(performance.now()-begin)/1000;
 return {windows,candidates,events,timing,total_seconds:(performance.now()-started)/1000};
}
module.exports={run,legacyVP};
