/* DOM integration only: does not claim installed-browser or layout validation.
 * Run with NODE_PATH pointing to an installed jsdom >= 27 environment.
 */
'use strict';
const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function context(){return new Proxy({measureText:s=>({width:String(s).length*6}),getImageData:()=>({data:new Uint8ClampedArray(16)})},{get(o,k){if(k in o)return o[k];return ()=>{};}});}
async function until(fn,ms=20000){const start=Date.now();while(!fn()){if(Date.now()-start>ms)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}}
async function main(){
 const html=fs.readFileSync(path.join(root,'legacy.html'),'utf8');const dom=new JSDOM(html,{url:'file://'+path.join(root,'legacy.html'),runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,errors=[];
 w.addEventListener('error',e=>errors.push(String(e.error)));w.HTMLCanvasElement.prototype.getContext=context;
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 for(const name of ['diffuse_path.js','wall_metrics.js','echo_environment.js','tsri_solver.js','tsri_pipeline.js','tsri_experiment.js','tsri_ui.js'])w.eval(fs.readFileSync(path.join(root,name),'utf8'));
 await until(()=>w.TSRIApp.getState());assert.equal(w.TSRIApp.getState().step,0);
 assert.equal(w.document.querySelectorAll('#comparisonBody tr').length,11);
 w.document.getElementById('btn20').click();await until(()=>w.TSRIApp.getState().step===20);
 w.document.getElementById('btn20').click();await until(()=>w.TSRIApp.getState().step===40);
 assert.ok(w.TSRIApp.getState().diagnostics.windows>0);
 assert.ok(w.document.getElementById('comparisonBody').textContent.includes('채택'));
 w.document.getElementById('btnExport').click();await new Promise(r=>setTimeout(r,20));
 w.document.getElementById('btnScenTorus').click();await until(()=>w.TSRIApp.getState()?.config.scenario==='torus');
 w.document.getElementById('useDiffusePaths').click();await until(()=>w.TSRIApp.getState()?.config.useDiffusePaths);
 w.document.getElementById('scatteringMode').value='withhold';w.document.getElementById('scatteringMode').dispatchEvent(new w.Event('change'));
 await until(()=>w.TSRIApp.getState()?.config.scatteringMode==='withhold');w.document.getElementById('btn20').click();await until(()=>w.TSRIApp.getState().step===20);
 assert.equal(w.TSRIApp.getState().diagnostics.windows,0);
 w.document.getElementById('btnReset').click();await until(()=>w.TSRIApp.getState()?.step===0);
 assert.deepEqual(errors,[]);assert.equal(w.document.getElementById('errorStatus').hidden,true);
 const out={passed:true,checks:['initial page','40 steps','paired comparison table','CSV handler','Torus switch','diffuse switch','merged withhold','reset'],uiErrors:errors};
 console.log(JSON.stringify(out));dom.window.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
