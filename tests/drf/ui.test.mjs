import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DrfMap, drawMetricHistory, drawSweep, drawHistogram, drawProfile, drawCounts } from '../../drf/render.mjs';
import { SurfaceMap } from '../../surf/map.mjs';

test('DRF DOM contract and readable stylesheet', () => {
  const html=readFileSync(new URL('../../drf.html',import.meta.url),'utf8');
  const ids='settings runButton pauseButton stepButton resetButton cancelButton status mapCanvas fitView zoomIn zoomOut timeSlider snapshotLabel replayButton playbackSpeed heatField scaleMode themeButton showEllipses showVehicles showProxy showTruth showSpecular showDiffuse showObserved qValue acceptedValue rejectedValue medianValue p95Value offwallValue f1Value msdValue hd95Value timingValue pathValue inspector metricChart sweepPanel diagnosticPanel exportPanel sweepSettings sweepButton sweepCancel sweepStatus sweepChart sweepTable configSelect diagnosticChart profileChart countChart diagnosticSummary exportJson exportCsv exportPng aboutButton aboutDialog closeAbout provenanceCommit provenanceCore'.split(' ');
  for (const id of ids) assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length,1,id);
  for (const name of 'scene vehicles snapshots sigmaP sigmaD roughness lambda0 cellStep resolution specular grid band perimeter seed'.split(' ')) assert.ok(html.includes(`name="${name}"`),name);
  for (const path of ['../../drf/style.css','../../surf/style.css']) {
    const css=readFileSync(new URL(path,import.meta.url),'utf8');
    for (const match of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(match[1])>=(path.includes('/drf/') ? 14 : 16),`${path}: ${match[0]}`);
  }
  assert.match(html,/name="sigmaP"[^>]*value="0.1"/);
  assert.match(html,/name="roughness"[\s\S]*?value="2" selected/);
});

test('render keeps world row order, uses real DPR/300 dpi pixels, and charts execute', async () => {
  const snapshots={},created=[],rectangles=[],labels=[];
  const context=() => new Proxy({font:'16px Arial',createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(data)=>{snapshots.image=data.data;},measureText:(text)=>({width:text.length*9}),createLinearGradient:()=>({addColorStop(){}})}, {get(target,key){return key in target ? target[key] : (...args)=>{if (key==='fillText') {assert.ok(parseFloat(target.font.match(/(\d+)px/)[1])>=14,args[0]);labels.push(args[0]);}if (key==='strokeRect') rectangles.push(args);};}});
  const makeCanvas=()=>({clientWidth:700,clientHeight:540,width:0,height:0,dataset:{},getContext:()=>context(),addEventListener(){},toBlob(callback){callback(new Blob(['png']));}});
  const saved={};
  const stubs={document:{createElement:()=>{const c=makeCanvas();created.push(c);return c;},documentElement:{}},window:{devicePixelRatio:2},getComputedStyle:()=>({getPropertyValue:()=>'#111111'}),ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame:()=>1};
  try {
    for (const [key,value] of Object.entries(stubs)) {saved[key]=globalThis[key];globalThis[key]=value;}
    const canvas=makeCanvas(),map=new DrfMap(canvas),frame={Dbar:new Float32Array([0,1,2,3]),betaHat:new Float32Array([0,.2,.5,1])};
    map.set({grid:{nx:2,ny:2,domain:[0,60,0,30]},frame,heatField:'Dbar',scaleMode:'linear',layers:{}});
    assert.equal(snapshots.image.length,16);
    assert.deepEqual([...snapshots.image.slice(4,7)],[184,41,20],'largest world y row must become top image row');
    assert.deepEqual([...snapshots.image.slice(8,12)],[255,255,255,0],'zero values are transparent in the bottom world row');
    assert.deepEqual([...frame.Dbar],[0,1,2,3],'presentation must not mutate field values');
    map.paint(canvas,2);assert.equal(canvas.width,1400);assert.equal(canvas.height,1080);
    const target=makeCanvas();map.paint(target,300/96);assert.equal(target.width,2188);assert.equal(target.height,1688);
    assert.ok(await map.png() instanceof Blob);
    assert.ok(labels.includes('D̄ [1/m²]'));assert.ok(labels.some(text=>text.includes('linear color scale')));
    drawMetricHistory(canvas,[{t:1,offset:.1,p95:.3,offwall:.05}]);
    rectangles.length=0;canvas.clientHeight=360;
    drawMetricHistory(canvas,[{t:1,offset:.1,p95:.3,offwall:.05}]);
    assert.equal(rectangles.length,3);assert.ok(rectangles.every(([, , ,height])=>height>=50),'compact history plots must retain usable vertical space');
    rectangles.length=0;canvas.clientHeight=240;
    drawMetricHistory(canvas,[{t:1,offset:.1,p95:.3,offwall:.05}],'p95');
    assert.equal(rectangles.length,1);assert.ok(rectangles[0][3]>=170,'selected metric uses one large plot');
    const display={grid:{nx:2,ny:2,domain:[0,60,0,30]},frame,layers:{showTruth:false},walls:[[[0,-100],[60,100]]],wire:{configs:[{pHat_i:[50,15],pHat_j:[52,15]}]},focus:true};
    map.set(display);map.paint(canvas,2);const view=JSON.parse(canvas.dataset.view);
    assert.equal(map.camera.cx,48);assert.equal(map.camera.cy,15);
    assert.ok(view.xmax-view.xmin<40,'current-pose view must magnify the local field');
    map.set({...display,walls:[[[0,-1000],[60,1000]]]});map.paint(canvas,2);
    assert.deepEqual(JSON.parse(canvas.dataset.view),view,'hidden truth cannot change the view');
    map.fit(true);map.paint(canvas,2);assert.equal(map.camera.cx,30,'full view returns to the public domain');
    map.fit();canvas.clientWidth=1700;canvas.clientHeight=350;
    map.set({...display,focus:false,mode:'geometry',layers:{showTruth:true},walls:[[[0,6],[60,24]]]});map.paint(canvas,2);
    assert.ok(JSON.parse(canvas.dataset.view).xmax-JSON.parse(canvas.dataset.view).xmin<65,'a wide screen must not expand the corridor axes into empty space');
    canvas.clientWidth=700;
    canvas.clientHeight=540;
    drawSweep(canvas,[{roughness:2,sigmaD:.1,medianError:{mean:.13,sd:.02}}],[{roughness:2,sigmaD:.1,medianError:.134}]);
    drawHistogram(canvas,[-.1,.1,.4,1,2]);
    drawProfile(canvas,[{s:[10,6],wall:0,delta:.1,w:.5,lambda:.1},{s:[20,22],wall:1,delta:.2,w:.3,lambda:.06}]);
    drawCounts(canvas,[10,20],[11,19]);
    const mobile=makeCanvas();mobile.clientWidth=250;mobile.clientHeight=385;
    const surf=new SurfaceMap(mobile,()=>{});
    surf.set({config:{shape:'arc',nBots:3},evaluation:{wall:[]},raw:{poses:[]}},{fit:{status:'UNIQUE'},cross:{candidates:[],predictions:[]},curves:[],predictions:[]},{truth:true,curve:true});
    assert.ok(await surf.png() instanceof Blob);
    assert.ok(created.at(-1).height>Math.round((385+104)*300/96),'mobile captions must wrap into a taller export');
  } finally {for (const [key,value] of Object.entries(saved)) value===undefined ? delete globalThis[key] : globalThis[key]=value;}
});
