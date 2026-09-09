'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function harness(){
  const messages=[],context=vm.createContext({performance,setTimeout,clearTimeout,console});
  context.self=context;context.postMessage=m=>messages.push(m);
  context.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f}));
  vm.runInContext(fs.readFileSync(path.join(root,'tsri_worker.js'),'utf8'),context);
  return {messages,send:data=>context.onmessage({data})};
}
test('worker uses the real solver stack for initialization, steps and export',async()=>{
  const h=harness();await h.send({type:'init',config:{nBots:3,window:11,stride:5}});await h.send({type:'steps',count:25});await h.send({type:'export'});
  assert.equal(h.messages[0].type,'state');assert.equal(h.messages[1].state.step,25);assert.ok(h.messages[1].state.diagnostics.windows>0);
  assert.equal(h.messages[2].type,'export');assert.ok(h.messages[2].data.rows.length>0);assert.ok(!h.messages.some(m=>m.type==='error'));
});
test('worker paired benchmark completes and emits seed-level confidence intervals',async()=>{
  const h=harness();await h.send({type:'benchmark',config:{nBots:2,window:11,stride:5,seed:21},seeds:2,steps:25});
  const final=h.messages.at(-1);assert.equal(final.type,'benchmark');assert.equal(final.trials.length,2);assert.equal(final.aggregate.methods.lm.contactRMSE.n,2);
  assert.ok(final.aggregate.methods.lm.contactRMSE.low!==null);
});
test('worker cancellation preserves only fully completed seed results',async()=>{
  const h=harness(),run=h.send({type:'benchmark',config:{nBots:2,window:11,seed:1},seeds:20,steps:300});
  await h.send({type:'cancel'});await run;const last=h.messages.at(-1);assert.equal(last.cancelled,true);assert.equal(last.trials.length,0);
});
