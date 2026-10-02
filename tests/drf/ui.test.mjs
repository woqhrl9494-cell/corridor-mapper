import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DrfMap, mapToScreen, mapToWorld, zoomMap, rawPanelSize, drawMetricHistory, drawSweep, drawHistogram, drawProfile, drawCounts } from '../../drf/render.mjs';
import { SurfaceMap } from '../../surf/map.mjs';

test('DRF DOM contract and readable stylesheet', () => {
  const html=readFileSync(new URL('../../drf.html',import.meta.url),'utf8');
  const ids='settings runButton pauseButton stepButton resetButton cancelButton status mapCanvas fitView zoomIn zoomOut firstSnapshot aspectMode densityCanvas contrastCanvas historyMetric timeSlider snapshotLabel replayButton playbackSpeed heatField scaleMode themeButton showEllipses showVehicles showProxy showTruth showSpecular showDiffuse showObserved qValue acceptedValue rejectedValue medianValue p95Value offwallValue f1Value msdValue hd95Value timingValue pathValue inspector metricChart sweepPanel diagnosticPanel exportPanel sweepSettings sweepButton sweepCancel sweepStatus sweepChart sweepTable configSelect diagnosticChart profileChart countChart diagnosticSummary exportJson exportCsv exportPng aboutButton aboutDialog closeAbout provenanceCommit provenanceCore'.split(' ');
  for (const id of ids) assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length,1,id);
  for (const name of 'scene vehicles snapshots sigmaP sigmaD roughness lambda0 cellStep resolution specular grid band perimeter seed'.split(' ')) assert.ok(html.includes(`name="${name}"`),name);
  for (const path of ['../../drf/style.css','../../surf/style.css']) {
    const css=readFileSync(new URL(path,import.meta.url),'utf8');
    for (const match of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(match[1])>=(path.includes('/drf/') ? 14 : 16),`${path}: ${match[0]}`);
  }
  assert.match(html,/name="sigmaP"[^>]*value="0.1"/);
  assert.match(html,/name="roughness"[\s\S]*?value="2" selected/);
});

test('axis-fitted camera preserves metre coordinates and the zoom anchor', () => {
  const camera={cx:30,cy:15,scaleX:21,scaleY:11},box={x:44,y:16,w:1640,h:288};
  const close=(actual,expected) => actual.forEach((value,k)=>assert.ok(Math.abs(value-expected[k])<1e-11,`${value} != ${expected[k]}`));
  for (const point of [[0,0],[60,30],[-12,45],[31.5,12.75]]) close(mapToWorld(mapToScreen(point,camera,box),camera,box),point);
  const anchor=[box.x+box.w*.37,box.y+box.h*.61],world=mapToWorld(anchor,camera,box),zoomed=zoomMap(camera,1.7,anchor,box);
  close(mapToWorld(anchor,zoomed,box),world);
  close([zoomed.scaleX,zoomed.scaleY],[camera.scaleX*1.7,camera.scaleY*1.7]);
  assert.deepEqual(camera,{cx:30,cy:15,scaleX:21,scaleY:11},'zoom must leave the old camera untouched');
});

test('RAW panel follows its metre range within desktop and mobile space', () => {
  const desktop=rawPanelSize(1595,377,{xmin:0,xmax:60,ymin:6,ymax:24});
  assert.equal(desktop.width,1110);
  assert.equal(desktop.height,377);
  assert.ok(desktop.width<=1595 && desktop.height<=377);
  assert.ok(Math.abs((desktop.width-60)/(desktop.height-62)-60/18)<1e-12);
  const mobile=rawPanelSize(364,Infinity,{xmin:0,xmax:60,ymin:0,ymax:30});
  assert.equal(mobile.width,364);
  assert.equal(mobile.height,214);
  assert.ok(Math.abs((mobile.width-60)/(mobile.height-62)-2)<1e-12);
});

test('render keeps world row order, uses real DPR/300 dpi pixels, and charts execute', async () => {
  const snapshots={},created=[],rectangles=[],labels=[],gridSegments=[],gridColor='#c4d3e2';
  const context=() => {
    let path=[],point;
    return new Proxy({font:'16px Arial',createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(data)=>{snapshots.image=data.data;},measureText:(text)=>({width:text.length*9}),createLinearGradient:()=>({addColorStop(){}})}, {get(target,key){return key in target ? target[key] : (...args)=>{
      if (key==='beginPath') {path=[];point=undefined;}
      if (key==='moveTo') point=args;
      if (key==='lineTo') {if (point) path.push([point,args]);point=args;}
      if (key==='stroke' && target.strokeStyle===gridColor) gridSegments.push(...path);
      if (key==='fillText') {assert.ok(parseFloat(target.font.match(/(\d+)px/)[1])>=14,args[0]);labels.push(args[0]);}
      if (key==='strokeRect') rectangles.push(args);
    };}});
  };
  const makeCanvas=()=>{const ctx=context();return {clientWidth:700,clientHeight:540,width:0,height:0,style:{},dataset:{},getContext:()=>ctx,addEventListener(){},toBlob(callback){callback(new Blob(['png']));}};};
  const assertGrid=(box,message) => {
    const near=(a,b)=>Math.abs(a-b)<1e-8,inside=(v,lo,hi)=>v>lo+1e-8 && v<hi-1e-8;
    assert.ok(gridSegments.some(([a,b])=>near(a[0],b[0]) && inside(a[0],box.x,box.x+box.w) && near(Math.min(a[1],b[1]),box.y) && near(Math.max(a[1],b[1]),box.y+box.h)),`${message}: vertical grid inside plot`);
    assert.ok(gridSegments.some(([a,b])=>near(a[1],b[1]) && inside(a[1],box.y,box.y+box.h) && near(Math.min(a[0],b[0]),box.x) && near(Math.max(a[0],b[0]),box.x+box.w)),`${message}: horizontal grid inside plot`);
  };
  const assertChartGrids=message=>rectangles.forEach(([x,y,w,h],k)=>assertGrid({x,y,w,h},`${message} subplot ${k}`));
  const saved={};
  const stubs={document:{createElement:()=>{const c=makeCanvas();created.push(c);return c;},documentElement:{}},window:{devicePixelRatio:2},getComputedStyle:()=>({getPropertyValue:name=>name==='--color-grid' ? gridColor : '#111111'}),ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame:()=>1};
  try {
    for (const [key,value] of Object.entries(stubs)) {saved[key]=globalThis[key];globalThis[key]=value;}
    const canvas=makeCanvas(),map=new DrfMap(canvas),frame={Dbar:new Float32Array([0,1,2,3]),betaHat:new Float32Array([0,.2,.5,1])};
    map.set({grid:{nx:2,ny:2,domain:[0,60,0,30]},frame,heatField:'Dbar',scaleMode:'linear',layers:{}});
    assert.equal(snapshots.image.length,16);
    assert.deepEqual([...snapshots.image.slice(4,7)],[184,41,20],'largest world y row must become top image row');
    assert.deepEqual([...snapshots.image.slice(8,12)],[255,255,255,0],'zero values are transparent in the bottom world row');
    assert.deepEqual([...frame.Dbar],[0,1,2,3],'presentation must not mutate field values');
    map.paint(canvas,1);const cssView=JSON.parse(canvas.dataset.view);
    assertGrid(map.box,'density');
    assert.equal(cssView.plotWidth,592,'heatmap must use the full width after axes and colorbar');
    assert.equal(cssView.plotHeight,478,'heatmap must use the full height after axes');
    map.paint(canvas,2);assert.equal(canvas.width,1400);assert.equal(canvas.height,1080);
    assert.deepEqual(JSON.parse(canvas.dataset.view),cssView,'DPR must not change the metre viewport');
    const target=makeCanvas();map.paint(target,300/96);assert.equal(target.width,2188);assert.equal(target.height,1688);
    assert.ok(await map.png() instanceof Blob);
    assert.ok(labels.includes('D̄ [1/m²]'));assert.ok(labels.some(text=>text.includes('linear color scale')));
    assert.ok(labels.includes('Axes: independent x/y scale'),'export must disclose the selected axis scale');
    gridSegments.length=0;map.set({...map.state,heatField:'betaHat'});map.paint(canvas,1);
    assertGrid(map.box,'contrast');
    rectangles.length=0;gridSegments.length=0;
    drawMetricHistory(canvas,[{t:1,offset:.1,p95:.3,offwall:.05}]);
    assert.equal(rectangles.length,3);assert.ok(rectangles.every(([, , ,height])=>height>=117),'history compactness follows each subplot height');
    assertChartGrids('history');
    rectangles.length=0;gridSegments.length=0;canvas.clientHeight=360;
    drawMetricHistory(canvas,[{t:1,offset:.1,p95:.3,offwall:.05}]);
    assert.equal(rectangles.length,3);assert.ok(rectangles.every(([, , ,height])=>height>=50),'compact history plots must retain usable vertical space');
    assertChartGrids('compact history');
    rectangles.length=0;gridSegments.length=0;canvas.clientHeight=240;
    drawMetricHistory(canvas,[{t:1,offset:.1,p95:.3,offwall:.05}],'p95');
    assert.equal(rectangles.length,1);assert.ok(rectangles[0][3]>=170,'selected metric uses one large plot');
    assertChartGrids('selected history');
    const display={grid:{nx:2,ny:2,domain:[0,60,0,30]},frame,layers:{showTruth:false},walls:[[[0,-100],[60,100]]],wire:{configs:[{pHat_i:[50,15],pHat_j:[52,15]}]},focus:true};
    map.set(display);map.paint(canvas,2);const view=JSON.parse(canvas.dataset.view);
    assert.equal(map.camera.cx,48);assert.equal(map.camera.cy,15);
    assert.ok(view.xmax-view.xmin<40,'current-pose view must magnify the local field');
    map.set({...display,walls:[[[0,-1000],[60,1000]]]});map.paint(canvas,2);
    assert.deepEqual(JSON.parse(canvas.dataset.view),view,'hidden truth cannot change the view');
    map.fit(true);map.paint(canvas,2);assert.equal(map.camera.cx,30,'full view returns to the public domain');
    map.fit();canvas.clientWidth=1700;canvas.clientHeight=350;
    gridSegments.length=0;
    map.set({...display,focus:false,mode:'geometry',aspectMode:'fill',layers:{showTruth:true},walls:[[[0,6],[60,24]]]});map.paint(canvas,2);
    const wideView=JSON.parse(canvas.dataset.view);
    assert.equal(wideView.plotWidth,1640,'the graph must use the full available panel width');
    assert.equal(wideView.plotHeight,288,'the graph must use the full available panel height');
    assert.equal(wideView.pixelsPerMetreX,wideView.pixelsPerMetreY,'RAW must remain isometric even when fill is requested');
    const origin=mapToScreen([30,15],map.camera,map.box),unitX=mapToScreen([31,15],map.camera,map.box),unitY=mapToScreen([30,16],map.camera,map.box);
    assert.ok(Math.abs(Math.hypot(unitX[0]-origin[0],unitX[1]-origin[1])-Math.hypot(unitY[0]-origin[0],unitY[1]-origin[1]))<1e-10,'one metre must have the same screen length in each RAW direction');
    assertGrid(map.box,'RAW');
    map.zoom(1.3,[100,80]);map.paint(canvas,2);
    const manualCamera={...map.camera},manualView=canvas.dataset.view,manualBox={...map.box};
    labels.length=0;assert.ok(await map.png() instanceof Blob);
    assert.ok(labels.includes('Axes: equal metres'),'RAW PNG must report its effective metric scale');
    assert.ok(!labels.includes('Axes: independent x/y scale'));
    assert.deepEqual(map.camera,manualCamera,'selected-axis PNG export must not reset the manual screen camera');
    assert.equal(canvas.dataset.view,manualView,'PNG export must leave the screen viewport unchanged');
    assert.deepEqual(map.box,manualBox,'PNG export must leave the screen hit-test box unchanged');
    map.set({...map.state,mode:undefined,aspectMode:'fill'});map.fit();map.paint(canvas,2);
    assert.notEqual(map.camera.scaleX,map.camera.scaleY,'field fill mode retains its selected independent scales');
    labels.length=0;assert.ok(await map.png() instanceof Blob);
    assert.ok(labels.includes('Axes: independent x/y scale'),'field fill PNG reports independent scales');
    map.set({...map.state,aspectMode:'equal'});map.fit();map.paint(canvas,2);
    assert.equal(map.camera.scaleX,map.camera.scaleY,'explicit equal-axis mode preserves metres in both directions');
    labels.length=0;assert.ok(await map.png() instanceof Blob);
    assert.ok(labels.includes('Axes: equal metres'),'equal-axis export must disclose its metric scale');
    assert.deepEqual([...frame.Dbar],[0,1,2,3]);
    assert.deepEqual([...frame.betaHat],[0,...new Float32Array([.2,.5]),1],'display and export must not mutate either field');
    canvas.clientWidth=700;
    canvas.clientHeight=540;
    for (const draw of [()=>drawSweep(canvas,[{roughness:2,sigmaD:.1,medianError:{mean:.13,sd:.02}}],[{roughness:2,sigmaD:.1,medianError:.134}]),()=>drawHistogram(canvas,[-.1,.1,.4,1,2]),()=>drawCounts(canvas,[10,20],[11,19])]) {
      rectangles.length=0;gridSegments.length=0;draw();
      assert.equal(rectangles.length,1);
      assert.ok(rectangles[0][2]>=canvas.clientWidth*.85 && rectangles[0][3]>=canvas.clientHeight*.65,'each analysis chart uses most of its allocated area');
      assertChartGrids('analysis');
    }
    rectangles.length=0;gridSegments.length=0;canvas.clientHeight=600;
    drawProfile(canvas,[{s:[10,6],wall:0,delta:.1,w:.5,lambda:.1},{s:[20,22],wall:1,delta:.2,w:.3,lambda:.06}]);
    assert.equal(rectangles.length,3);
    assert.ok(rectangles.every(([, , ,height])=>height>=130),'every profile subplot must use most of its allotted height');
    assertChartGrids('profile');
    canvas.clientHeight=540;
    const mobile=makeCanvas();mobile.clientWidth=250;mobile.clientHeight=385;
    const surf=new SurfaceMap(mobile,()=>{});
    surf.set({config:{shape:'arc',nBots:3},evaluation:{wall:[]},raw:{poses:[]}},{fit:{status:'UNIQUE'},cross:{candidates:[],predictions:[]},curves:[],predictions:[]},{truth:true,curve:true});
    assert.ok(await surf.png() instanceof Blob);
    assert.ok(created.at(-1).height>Math.round((385+104)*300/96),'mobile captions must wrap into a taller export');
  } finally {for (const [key,value] of Object.entries(saved)) value===undefined ? delete globalThis[key] : globalThis[key]=value;}
});
