import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../drf/app.mjs',import.meta.url),'utf8');
const section=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,`Actual app source section: ${start}`);
  return source.slice(a,b);
};

test('actual full run extends a restored 60-snapshot URL to the exit; single steps retain their experiment length',async()=>{
  for (const [single,requested,expected] of [[false,60,80],[true,60,60],[false,80,80]]) {
    const input={vehicles:10,snapshots:requested,grid:150,band:4,perimeter:'exact'},generated=[],filled=[],advanced=[];
    const state={generation:0,scenario:null,mode:'idle'},location={hash:'#v1=old'};
    const context=vm.createContext({state,location,DEFAULT_INPUT:{snapshots:80},
      settings:()=>({...input}),fillSettings:value=>filled.push({...value}),
      cancel:()=>{state.generation++;},controls(){},notice(){},createGrid:(nx,ny)=>({nx,ny}),
      makeWorker:name=>({stop(){},async request(message){
        if (name==='scenario') {generated.push({...message.input});return {scenario:{input:message.input}};}
        return {};
      }}),advance:value=>advanced.push(value??false),fail:error=>{throw error;},
    });
    vm.runInContext(section('async function prepare(','function fail('),context);
    await context.prepare(single);
    assert.equal(generated.length,1);
    assert.equal(generated[0].snapshots,expected,'Generate the same length stored in the URL');
    assert.equal(state.scenario.input.snapshots,expected);
    assert.equal(JSON.parse(decodeURIComponent(location.hash.slice(3))).snapshots,expected);
    assert.equal(generated[0].vehicles,10,'Preserve the restored vehicle count');
    assert.deepEqual(filled,single || requested===expected ? [] : [{...input,snapshots:expected}],'Synchronize the visible settings when extending the drive');
    assert.deepEqual(advanced,[single]);
    assert.equal(state.mode,single ? 'paused' : 'running');
  }
});

test('actual lower-map buttons affect only their own camera',()=>{
  const nodes=new Map(),calls=[],$=id=>{if (!nodes.has(id)) nodes.set(id,{});return nodes.get(id);};
  const view=name=>({zoom:factor=>calls.push([name,'zoom',factor]),fit:()=>calls.push([name,'fit'])});
  vm.runInNewContext(section("for (const [prefix,view] of [['density'","$('configSelect').onchange"),
    {$,densityMap:view('density'),contrastMap:view('contrast')});
  for (const prefix of ['density','contrast']) {
    $(prefix+'ZoomIn').onclick();$(prefix+'ZoomOut').onclick();$(prefix+'ResetView').onclick();
  }
  assert.deepEqual(calls,[['density','zoom',1.3],['density','zoom',1/1.3],['density','fit'],
    ['contrast','zoom',1.3],['contrast','zoom',1/1.3],['contrast','fit']]);
});

test('actual preview geometry stays cached when the truth overlay is hidden',()=>{
  const truth={checked:true},fields={scene:{value:'reference'},seed:{value:'1'}};
  let generated=0;
  const context=vm.createContext({$:()=>truth,form:{elements:{namedItem:name=>fields[name]}},
    previewKey:'',preview:[],createWalls:()=>{generated++;return [[0,6],[60,24]];},sampleWalls:walls=>walls});
  vm.runInContext(section('function previewWalls()','function renderSelected()'),context);
  const initial=context.previewWalls();
  truth.checked=false;assert.equal(context.previewWalls(),initial,'Hiding the preview must keep the scene extent');
  truth.checked=true;assert.equal(context.previewWalls(),initial);
  assert.equal(generated,1,'Layer toggles must reuse the scene, without regenerating it');
});

test('actual view reset preserves simulation, selection and replay; experiment reset still clears them',async()=>{
  const nodes=new Map(),pending=new Map(),charts=new Map();let nextFrame=0,stoppedWorkers=0,cancelledSweeps=0,fitCalls=0,releaseField;
  const $=id=>{
    if (!nodes.has(id)) nodes.set(id,{id,value:'',textContent:'old snapshot value',checked:false,options:[],
      removeAttribute(){},replaceChildren(...options){this.options=options;}});
    return nodes.get(id);
  };
  const snapshots={value:'3'},elements=[snapshots];elements.namedItem=name=>name==='snapshots' ? snapshots : null;
  const form={elements};$('sweepSettings').elements=[];$('playbackSpeed').value='1';
  const state={mode:'done',frames:[1,2,3].map(t=>({t,Q:t,admitted:t,rejected:0,ms:1})),evaluations:[{},{},{}],
    selected:3,next:3,busy:false,replay:false,replayAt:0,generation:0,valid:true,grid:{},
    scenario:{input:{snapshots:3},truth:[{configs:[]},{configs:[]},{configs:[]}],wire:[],walls:[]},
    workers:[{stop(){stoppedWorkers++;}}],sweep:{cancel(){cancelledSweeps++;}},sweepRuns:[{}]};
  const context=vm.createContext({state,$,form,hoverGeneration:0,hoverTimer:0,replayFrame:0,
    fieldWorker:{},evalWorker:{},hoverWorker:{},DEFAULT_INPUT:{snapshots:60},location:{hash:'#old'},
    document:{body:{dataset:{}},createElement:()=>({})},map:{set(){},fit(){fitCalls++;}},densityMap:{set(){},fit(){fitCalls++;}},contrastMap:{set(){},fit(){fitCalls++;}},previewWalls:()=>[],
    fmt:v=>Number.isFinite(v) ? String(v) : '—',percentile:values=>values[0]??null,
    requestAnimationFrame:fn=>{const id=++nextFrame;pending.set(id,fn);return id;},cancelAnimationFrame:id=>pending.delete(id),clearTimeout(){},
    drawMetricHistory:(canvas,data)=>charts.set(canvas.id,data),drawHistogram:(canvas,data)=>charts.set(canvas.id,data),
    drawProfile:(canvas,data)=>charts.set(canvas.id,data),drawCounts:(canvas,a,b)=>charts.set(canvas.id,[a,b]),
    fillSettings:input=>{snapshots.value=String(input.snapshots);},renderSweep(){},notice:text=>{$('status').textContent=text;},
  });
  const reset=source.match(/^\$\('resetButton'\)\.onclick = .*;$/m)?.[0];assert.ok(reset,'Actual reset handler exists');
  const viewReset=source.match(/^\$\('firstSnapshot'\)\.onclick = .*;$/m)?.[0];assert.ok(viewReset,'Actual view reset handler exists');
  vm.runInContext([
    section('function stopReplay()','async function prepare('),
    section('function renderSelected()','async function updateProfile('),
    section('async function advance(','async function hashField('),
    section('function replayTick(','$(\'runButton\').onclick'),viewReset,reset,
  ].join('\n'),context);
  const assertViewOnly=()=>{
    const before={...state},beforeFit=fitCalls,queued=[...pending.keys()],replayFrame=context.replayFrame;
    const ui=[$('timeSlider').value,$('timeSlider').max,$('snapshotLabel').textContent,$('status').textContent,$('inspector').textContent,snapshots.value,context.location.hash];
    $('firstSnapshot').onclick();
    assert.equal(fitCalls-beforeFit,3,'Restore all three map cameras');
    assert.deepEqual(state,before,'Keep every simulation/selection/replay field unchanged');
    for (const key of ['frames','evaluations','scenario','grid','workers','sweep','sweepRuns']) assert.equal(state[key],before[key],`Preserve ${key} identity`);
    assert.deepEqual([...pending.keys()],queued,'Keep the queued replay/advance callbacks');
    assert.equal(context.replayFrame,replayFrame);
    assert.deepEqual([$('timeSlider').value,$('timeSlider').max,$('snapshotLabel').textContent,$('status').textContent,$('inspector').textContent,snapshots.value,context.location.hash],ui,'Preserve the current readout, settings and progress notice');
    assert.equal(stoppedWorkers,0);assert.equal(cancelledSweeps,0);
  };
  const completed={...state},settingsValue=snapshots.value,workers=state.workers;
  Object.assign(state,{frames:[],evaluations:[],scenario:null,grid:null,selected:0,next:0,valid:false,followLive:true,sweep:null,sweepRuns:[],generation:17});
  for (const mode of ['idle','running']) {
    state.mode=mode;context.controls();
    assert.equal($('firstSnapshot').disabled,false,`First view must be available while ${mode} without records`);
    const frames=state.frames,evaluations=state.evaluations;
    assertViewOnly();
    assert.equal(state.mode,mode,'Restoring the preview must not pause generation');
    assert.equal(state.followLive,true);assert.equal(state.selected,0);assert.equal(state.next,0);
    assert.equal(state.generation,17);assert.equal(state.scenario,null);assert.equal(state.valid,false);
    assert.equal(state.frames,frames);assert.equal(state.evaluations,evaluations);
    assert.equal(state.frames.length,0);assert.equal(state.evaluations.length,0);
    assert.equal(state.workers,workers);assert.equal(stoppedWorkers,0);
    assert.equal(snapshots.value,settingsValue);assert.equal(context.location.hash,'#old');
    assert.equal($('firstSnapshot').disabled,false);
  }
  Object.assign(state,completed);fitCalls=0;
  vm.runInContext('controls();',context);
  assert.equal(Number($('timeSlider').max),3);assert.equal(Number($('timeSlider').value),3);
  for (const mode of ['done','paused','running','cancelled']) {state.mode=mode;state.selected=2;state.followLive=false;context.controls();assertViewOnly();}
  state.mode='done';state.selected=3;context.controls();
  vm.runInContext('toggleReplay();stopReplay();toggleReplay();',context);
  assert.equal(pending.size,1,'Rapid start/stop/start must retain only one rAF');
  assertViewOnly();
  const [id,callback]=pending.entries().next().value;pending.delete(id);callback(300);
  assert.equal(pending.size,1,'Replay tick must retain only one next rAF');assert.equal(state.selected,1);
  vm.runInContext('stopReplay();',context);state.mode='running';state.selected=3;state.followLive=true;
  state.scenario.wire=Array.from({length:5},()=>({}));
  context.fieldWorker={request:()=>new Promise(resolve=>{releaseField=resolve;})};context.evalWorker={request:async()=>({evaluation:{}})};
  const inFlight=context.advance();assert.equal(state.busy,true);
  const beforeFit=fitCalls;assertViewOnly();assert.equal(state.selected,3);assert.equal(state.mode,'running');assert.equal(state.followLive,true);
  assert.equal(state.frames.length,3,'View reset must preserve completed records');assert.equal(fitCalls-beforeFit,3);assert.equal(pending.size,0);
  releaseField({type:'frame',requestId:1,t:4,Q:4,admitted:4,rejected:0,ms:1});await inFlight;
  assert.equal(state.frames.length,4,'An in-flight completed result must be retained');assert.equal(state.selected,4,'Live following must continue after a view reset');
  assert.equal(state.mode,'running');assert.equal(state.followLive,true);assert.equal(pending.size,1,'Keep advancing after the current frame');
  state.workers=[{stop(){stoppedWorkers++;}}];
  $('inspector').textContent='old D/A/Q';$('diagnosticSummary').textContent='old Theorem 2';
  vm.runInContext("$('resetButton').onclick();",context);
  for (const [id,callback] of [...pending]) {pending.delete(id);callback(400);}
  assert.equal(pending.size,0);assert.equal(stoppedWorkers,1);assert.equal(cancelledSweeps,1);
  assert.equal(state.frames.length,0);assert.equal(state.evaluations.length,0);assert.equal(state.scenario,null);assert.equal(state.valid,false);
  assert.equal(Number($('timeSlider').max),0);assert.equal(Number($('timeSlider').value),0);assert.equal($('timeSlider').disabled,true);
  assert.equal($('snapshotLabel').textContent,'0 / 60');
  assert.equal($('sweepStatus').textContent,'실행 결과가 없습니다.');
  assert.equal($('diagnosticSummary').textContent,'실행 결과가 없습니다.');
  assert.match($('inspector').textContent,/포인터/);assert.ok(!$('inspector').textContent.includes('old D/A/Q'));
  assert.equal(charts.get('diagnosticChart').length,0);assert.equal(charts.get('profileChart').length,0);
  assert.equal(charts.get('countChart')[0].length,0);assert.equal(charts.get('countChart')[1].length,0);
  assert.equal(context.fieldWorker,null);assert.equal(context.evalWorker,null);assert.equal(context.hoverWorker,null);
});
