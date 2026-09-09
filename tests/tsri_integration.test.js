'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Experiment}=require('../tsri_experiment'),{Pipeline}=require('../tsri_pipeline'),Env=require('../echo_environment');
function stable(result){return JSON.parse(JSON.stringify(result,(k,v)=>['ms','setupMs'].includes(k)?undefined:v));}
test('oracle field poisoning cannot change pipeline outputs',()=>{
  const env=Env.create({nBots:3,posSigma:0}),a=new Pipeline({window:11,stride:5,poseSigma:0}),b=new Pipeline({window:11,stride:5,poseSigma:0});
  for(let i=0;i<30;i++){
    const frame=env.step(),poisoned=frame.observations.map(m=>{
      const value={...m};for(const k of ['hit','specularHit','wallId','familyId','truePose','future'])Object.defineProperty(value,k,{get(){throw new Error('Oracle accessed');}});return value;
    });
    assert.deepEqual(stable(a.update(frame.t,frame.observations)),stable(b.update(frame.t,poisoned)));
  }
  assert.ok(a.diagnostics.windows>0);
});
test('outputs are fixed-lag, paired, reproducible and never use a later frame',()=>{
  const a=new Experiment({seed:31,nBots:4,window:11,stride:5}),b=new Experiment({seed:31,nBots:4,window:11,stride:5});
  for(let k=0;k<45;k++){
    const aa=a.step(),bb=b.step();assert.deepEqual(stable(aa),stable(bb));
    for(let i=0;i<aa.length;i+=3){const group=aa.slice(i,i+3);assert.equal(new Set(group.map(r=>r.key)).size,1);assert.equal(new Set(group.map(r=>r.method)).size,3);for(const r of group){assert.ok(r.availableAt>=r.t0);assert.ok(r.availableAt<=(k+1)*.05+1e-10);}}
  }assert.ok(a.exportRows.length>0);assert.equal(a.exportRows.length,b.exportRows.length);
});
test('stationary, Torus, diffuse stress and merged inputs all finish without invalid output',()=>{
  for(const config of [{speed:0},{scenario:'torus'},{useDiffusePaths:true},{useDiffusePaths:true,scatteringMode:'withhold'}]){
    const e=new Experiment({...config,nBots:3,window:11,stride:5});for(let k=0;k<40;k++)e.step();
    for(const r of e.exportRows){assert.ok(Number.isFinite(r.cost));assert.ok(r.x.every(Number.isFinite));}
    if(config.speed===0||config.useDiffusePaths)assert.equal(e.summary().lm.accepted,0);
    if(config.scatteringMode==='withhold')assert.equal(e.pipeline.diagnostics.windows,0);
  }
});
test('pose perturbations are shared across snapshots and preserve raw range simulation',()=>{
  const a=Env.create({nBots:3,posSigma:0}),b=Env.create({nBots:3,posSigma:.2});let bias;
  for(let k=0;k<5;k++){
    const x=a.step(),y=b.step();assert.deepEqual(x.truth,y.truth);
    const current=y.poses.map((p,i)=>[p.x-y.bots[i].x,p.y-y.bots[i].y]);
    if(bias)current.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-bias[i][j])<1e-12)));bias=current;
  }
});
test('standalone estimator has no simulator truth or wall import',()=>{
  for(const file of ['tsri_solver.js','tsri_pipeline.js']){
    const src=fs.readFileSync(require.resolve('../'+file),'utf8');
    assert.doesNotMatch(src,/\btopWall\b|\bbotWall\b|\.specularHit|\.familyId|\.wallId|\.truePose|\.hit\b|require\(['"]\.\/echo_environment/);
  }
});
