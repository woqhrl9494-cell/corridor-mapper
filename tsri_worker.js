'use strict';
importScripts('diffuse_path.js','wall_metrics.js','echo_environment.js','tsri_solver.js','tsri_pipeline.js','tsri_experiment.js');
let experiment=null,cancel=false;
self.onmessage=async({data})=>{
  try{
    if(data.type==='cancel'){cancel=true;return;}
    if(data.type==='init'){experiment=new TSRIExperiment.Experiment(data.config);self.postMessage({type:'state',state:experiment.snapshot()});}
    if(data.type==='steps'){
      for(let k=0;k<data.count;k++)experiment.step();
      self.postMessage({type:'state',state:experiment.snapshot()});
    }
    if(data.type==='export')self.postMessage({type:'export',data:{config:experiment.config,rows:experiment.exportRows,summary:experiment.summary()}});
    if(data.type==='benchmark'){
      cancel=false;const trials=[];
      for(let i=0;i<data.seeds;i++){
        const e=new TSRIExperiment.Experiment({...data.config,seed:data.config.seed+i});
        for(let k=0;k<data.steps;k++){
          if(cancel)break;e.step();
          if(k%10===9){self.postMessage({type:'progress',trial:i+1,seeds:data.seeds,step:k+1,steps:data.steps});await new Promise(r=>setTimeout(r,0));}
        }
        if(cancel)break;trials.push({seed:e.config.seed,summary:e.summary(),diagnostics:{...e.pipeline.diagnostics}});
      }
      self.postMessage({type:'benchmark',trials,aggregate:TSRIExperiment.aggregate(trials),cancelled:cancel,config:{...data.config,reflectionModel:EchoEnvironment.REFLECTION_MODEL},steps:data.steps});
    }
  }catch(error){self.postMessage({type:'error',message:error.stack||String(error)});}
};
