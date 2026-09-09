/* Reproducible physical-generator audit and unchanged-estimator smoke run.
 * node tests/validate_reflection.js [output.json]
 * Truth is used only by this evaluator, never to initialize or tune TSRI.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const Env=require('../echo_environment'),{Experiment}=require('../tsri_experiment');
const root=path.resolve(__dirname,'..'),baseline='e7e55a4e94b1d807a11f12b6700fd61bb12f6765';
const source=cp.execFileSync('git',['show',baseline+':echo_environment.js'],{cwd:root,encoding:'utf8'});
const legacyModule={exports:{}};
new Function('require','module','exports',source)(name=>require(path.join(root,name)),legacyModule,legacyModule.exports);
const Legacy=legacyModule.exports;
function nearest(p,segments){
  let best=null,bestD=Infinity;
  for(const s of segments){
    const dx=s.bx-s.ax,dy=s.by-s.ay,l2=dx*dx+dy*dy;
    const u=Math.max(0,Math.min(1,((p.x-s.ax)*dx+(p.y-s.ay)*dy)/l2));
    const d=Math.hypot(p.x-s.ax-u*dx,p.y-s.ay-u*dy);
    if(d<bestD){bestD=d;best={...s,ux:dx/Math.sqrt(l2),uy:dy/Math.sqrt(l2)};}
  }
  assert.ok(bestD<1e-9);return best;
}
function inspect(m,segments){
  const p=m.specularHit||m.hit,s=nearest(p,segments);
  const residual=p=>{
    const d1=Math.hypot(p.x-m.tx.x,p.y-m.tx.y),d2=Math.hypot(p.x-m.rx.x,p.y-m.rx.y);
    return ((p.x-m.tx.x)/d1+(p.x-m.rx.x)/d2)*s.ux+((p.y-m.tx.y)/d1+(p.y-m.rx.y)/d2)*s.uy;
  };
  return {residual:Math.abs(residual(p)),noInteriorRoot:residual({x:s.ax,y:s.ay})*residual({x:s.bx,y:s.by})>0};
}
const cases=[],start=performance.now();
for(const scenario of ['corridor','torus'])for(const seed of [7,31,42,87]){
  const config={scenario,seed,nBots:8,noiseSigma:0,posSigma:0,useDiffusePaths:false};
  const before=Legacy.create(config),after=Env.create(config);
  assert.deepEqual(before.walls,after.walls);assert.deepEqual(before.segments,after.segments);
  const stats=()=>({paths:0,noInteriorRoot:0,maxTangentResidual:0,generationMs:0});
  const oldStats=stats(),newStats=stats();
  for(let k=0;k<100;k++){
    let t=performance.now();const oldFrame=before.step();oldStats.generationMs+=performance.now()-t;
    t=performance.now();const newFrame=after.step();newStats.generationMs+=performance.now()-t;
    assert.deepEqual(oldFrame.bots,newFrame.bots);assert.deepEqual(oldFrame.poses,newFrame.poses);
    for(const [frame,env,summary] of [[oldFrame,before,oldStats],[newFrame,after,newStats]]){
      for(const m of frame.truth){
        const a=inspect(m,env.segments);summary.paths++;summary.noInteriorRoot+=+a.noInteriorRoot;
        summary.maxTangentResidual=Math.max(summary.maxTangentResidual,a.residual);
      }
    }
  }
  assert.ok(newStats.paths>0);assert.equal(newStats.noInteriorRoot,0);assert.ok(newStats.maxTangentResidual<1e-10);
  const item={config,frames:100,geometryAndMotionIdentical:true,before:oldStats,after:newStats};
  cases.push(item);console.log(JSON.stringify(item));
}
const pipeline=[];
for(const scenario of ['corridor','torus'])for(const sigma of [.1,0]){
  const e=new Experiment({scenario,seed:42,nBots:8,window:21,stride:10,noiseSigma:sigma,posSigma:sigma});
  for(let k=0;k<100;k++)e.step();
  const wrongAccepted={};
  for(const method of ['lm','tr','vp']){
    const rows=e.exportRows.filter(r=>r.method===method);
    assert.ok(rows.length>0);
    assert.ok(rows.every(r=>r.x.every(Number.isFinite)&&Number.isFinite(r.cost)));
    wrongAccepted[method]=rows.filter(r=>r.accepted&&r.contactError>.4).length;
  }
  const item={config:e.config,frames:100,summary:e.summary(),wrongAcceptedOver04m:wrongAccepted};
  pipeline.push(item);console.log(JSON.stringify({scenario,sigma,windows:item.summary.lm.windows,accepted:item.summary.lm.accepted,wrong:wrongAccepted.lm}));
}
const sources={};
for(const file of ['echo_environment.js','tsri_solver.js','tsri_pipeline.js','tsri_experiment.js']){
  sources[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
}
const result={createdAt:new Date().toISOString(),baseline,reflectionModel:Env.REFLECTION_MODEL,node:process.version,platform:process.platform,arch:process.arch,
  runMs:performance.now()-start,sources,cases,pipeline,notes:[
    'Geometry and true/reported poses are exactly matched before/after. Reflection observations intentionally differ.',
    'Physical residuals are checked against the actual containing segment, independently of the generator diagnostics.',
    'No estimator, association, initializers, covariance model or acceptance thresholds were changed.',
    'No claim of continuous smooth-wall branch validity across facet boundaries or calibrated scattering correction.'
  ]};
const destination=process.argv[2]||path.join(root,'reflection_validation.json');
fs.writeFileSync(destination,JSON.stringify(result,null,2));console.log('Saved '+destination);
