'use strict';
const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const Env=require('../echo_environment'),root=path.resolve(__dirname,'..');
const original=cp.execFileSync('git',['show','5b03dc7:index.html'],{cwd:root,encoding:'utf8',maxBuffer:5e6});
const inline=original.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function context(){return new Proxy({measureText:s=>({width:String(s).length*6}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get(o,k){return k in o?o[k]:()=>{};}});}
const plain=v=>JSON.parse(JSON.stringify(v));let frames=0,changedFrames=0;const counts={old:0,corrected:0};
for(const config of [{scenario:'corridor',seed:42,useDiffusePaths:false},{scenario:'torus',seed:31,useDiffusePaths:false},{scenario:'corridor',seed:51,useDiffusePaths:true}]){
 const dom=new JSDOM(original,{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLCanvasElement.prototype.getContext=context;w.requestAnimationFrame=()=>0;w.ResizeObserver=class{observe(){}};
 for(const file of ['diffuse_path.js','wall_metrics.js','revised_wall_estimator.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 w.eval(inline+`;window.originalSim={init:mode=>{scenarioMode=mode;init();},walls:()=>[topWall,botWall],snapshot:(seed,step)=>{moveBots();const result=[];let pair=0;for(let i=0;i<bots.length;i++)for(let j=i+1;j<bots.length;j++){const rng=simPairNoiseRng(seed,step,pair++,bots[i].pos,bots[j].pos);for(const m of simulatePair(bots[i].pos,bots[j].pos,rng))result.push({i,j,r:m.r,tx:m.tx,rx:m.rx,hit:m.hit});}return {bots:bots.map(b=>({...b.pos})),ranges:result};}};`);
 const cfg={...config,nBots:4,posSigma:0};for(const [key,v] of Object.entries(cfg)){const el=w.document.getElementById(key);if(el){if(typeof v==='boolean')el.checked=v;else el.value=String(v);}}
 w.originalSim.init(config.scenario);
 const e=Env.create(cfg);assert.deepEqual(plain(w.originalSim.walls()),e.walls);
 for(let k=0;k<5;k++){
  const old=w.originalSim.snapshot(config.seed,k);
  const current=e.step();assert.deepEqual(plain(old.bots),current.bots);
  const corrected=current.truth.map(m=>({i:m.i,j:m.j,r:m.r,tx:m.tx,rx:m.rx,hit:m.hit}));
  counts.old+=old.ranges.length;counts.corrected+=corrected.length;
  if(JSON.stringify(plain(old.ranges))!==JSON.stringify(corrected))changedFrames++;frames++;
 }
 dom.window.close();
}
assert.ok(changedFrames>0,'The corrected physical generator must not retain the old invalid paths');
console.log(JSON.stringify({passed:true,reference:'5b03dc7',scenarios:3,frames,changedFrames,counts,checks:['exact walls','exact true vehicle poses','intentional range/path changes after reflection correction']}));
