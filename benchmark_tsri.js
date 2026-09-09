'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Experiment,aggregate}=require('./tsri_experiment');
const count=Number(process.argv[2]||10),steps=Number(process.argv[3]||100),destination=process.argv[4]||'tsri_validation.json';
if(!Number.isInteger(count)||count<2||!Number.isInteger(steps)||steps<61)throw Error('Use >= 2 seeds and >= 61 frames');
// Warm up all three solvers before collecting wall-clock timings.
const warm=new Experiment({nBots:4,window:11,stride:5});for(let k=0;k<40;k++)warm.step();
const groups=[],start=performance.now();
for(const scenario of ['corridor','torus'])for(const window of [11,21,41])for(const useDiffusePaths of [false,true]){
  const trials=[];
  for(let i=0;i<count;i++){
    const e=new Experiment({scenario,window,useDiffusePaths,seed:1001+i});
    for(let k=0;k<steps;k++)e.step();
    const summary=e.summary();
    // Numerical failures are data in the report, never silently discarded.
    for(const row of e.exportRows)if(!Number.isFinite(row.cost)||!row.x.every(Number.isFinite))throw Error('Nonfinite solver output');
    trials.push({seed:e.config.seed,summary,diagnostics:{...e.pipeline.diagnostics}});
  }
  const group={scenario,window,useDiffusePaths,steps,trials,aggregate:aggregate(trials)};groups.push(group);
  console.log(JSON.stringify({scenario,window,useDiffusePaths,seeds:count,rmse:group.aggregate.methods.lm.contactRMSE.mean,output:group.aggregate.methods.lm.outputRate.mean}));
}
const sources={};for(const name of ['index.html','tsri_solver.js','tsri_pipeline.js','tsri_experiment.js','echo_environment.js','tsri_worker.js','tsri_ui.js'])sources[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex');
fs.writeFileSync(destination,JSON.stringify({schema:1,createdAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
  runMs:performance.now()-start,seedStart:1001,seedCount:count,steps,sources,groups,notes:['Paired inputs and starting points.','Student-t 95% CI across seeds; overlapping windows are not treated as independent.','Geometry/motion retained from 5b03dc7; exact specular-segment-v2 reflection and corrected visibility.','Diffuse runs use an uncalibrated preprocessing stress test; map output is withheld.','Timing includes all starts and quality checks; common preparation is excluded.']},null,2));
console.log('Saved '+destination);
