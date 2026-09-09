'use strict';
(()=>{
const $=id=>document.getElementById(id),methods=['lm','tr','vp'],colors={lm:'#0072b2',tr:'#d55e00',vp:'#009e73'};
let scenario='corridor',state=null,worker=null,local=null,busy=false,running=false,timer=null,benchmarking=false,trialResult=null,epoch=0;
const f=(v,d=3)=>v===Infinity?'∞':Number.isFinite(v)?v.toFixed(d):'—',pct=v=>Number.isFinite(v)?(100*v).toFixed(1)+'%':'—';
const reason={accepted:'채택',multiple_solutions:'대안 해 구별 불가',association_ambiguity:'거리 연결 모호',conditioning:'위치 정보 부족',uncertainty:'위치 불확실성 큼',model_residual:'모형 잔차 초과',uncalibrated_scattering:'산란 편향 미보정',gradient:'수렴',stationary:'수렴',iteration_limit:'반복 상한',stalled:'개선 정지'};
function config(){return {seed:+$('seed').value,gap:+$('gap').value,rough:+$('rough').value,curve:+$('curve').value,torusR:+$('torusR').value,nBots:+$('nBots').value,
  speed:+$('speed').value,spread:+$('spread').value,noiseSigma:+$('noiseSigma').value,posSigma:+$('posSigma').value,useDiffusePaths:$('useDiffusePaths').checked,
  diffuseSigma:+$('diffuseSigma').value,diffuseMean:+$('diffuseMean').value,scatteringMode:$('scatteringMode').value,scenario,
  window:+$('windowSize').value,stride:+$('solveStride').value,maxIter:+$('maxIter').value,weighting:$('weighting').value};}
function statusControls(){
  $('btnRun').textContent=running?'Pause simulation':'Start simulation';$('btnRun').classList.toggle('running',running);
  for(const id of ['btnStep','btn20','btnExport','btnFigure'])$(id).disabled=busy||benchmarking;
  $('btnRun').disabled=benchmarking;
  $('btnBenchmark').textContent=benchmarking?'반복 비교 중지':'같은 조건으로 반복 비교';
  document.querySelectorAll('.sidebar input:not([id^="show"]), .sidebar select, .scen-pill').forEach(el=>{el.disabled=benchmarking;});
  $('diffuseSigma').disabled=benchmarking||!$('useDiffusePaths').checked;
  $('diffuseMean').disabled=benchmarking||!$('useDiffusePaths').checked||+$('diffuseSigma').value===0;
}
function stop(){running=false;clearTimeout(timer);timer=null;statusControls();}
function updateLabels(){
  const c=config();$('lagLabel').textContent=`中心 시각 접점, ${((c.window-1)*.025).toFixed(2)} s 지연`.replace('中心','중심');
  $('diffuseToggleText').textContent=`Scattering stress test / ${c.useDiffusePaths?'ON':'OFF'}`;
  $('chipDiffuse').classList.toggle('checked',c.useDiffusePaths);$('diffuseParams').classList.toggle('disabled',!c.useDiffusePaths);
  $('vDiffuseSigma').textContent=f(c.diffuseSigma,2)+' m';$('vDiffuseMean').textContent=f(c.diffuseMean,2);
  $('corridorParams').style.display=scenario==='corridor'?'':'none';$('torusParams').style.display=scenario==='torus'?'':'none';
  $('btnScenCorridor').classList.toggle('active',scenario==='corridor');$('btnScenTorus').classList.toggle('active',scenario==='torus');
}
function message(data){
  if(worker){worker.postMessage(data);return;}
  const taskEpoch=epoch;
  // file:// supports the same code without Worker cross-origin restrictions.
  setTimeout(async()=>{try{
    if(taskEpoch!==epoch)return;
    if(data.type==='init'){local=new TSRIExperiment.Experiment(data.config);receive({type:'state',state:local.snapshot()});}
    if(data.type==='steps'){for(let i=0;i<data.count;i++){if(taskEpoch!==epoch)return;local.step();if(i%3===2)await new Promise(r=>setTimeout(r,0));}if(taskEpoch===epoch)receive({type:'state',state:local.snapshot()});}
    if(data.type==='export')receive({type:'export',data:{config:local.config,rows:local.exportRows,summary:local.summary()}});
    if(data.type==='cancel')benchmarking=false;
    if(data.type==='benchmark'){
      const trials=[];for(let i=0;i<data.seeds&&benchmarking&&taskEpoch===epoch;i++){
        const e=new TSRIExperiment.Experiment({...data.config,seed:data.config.seed+i});
        for(let k=0;k<data.steps&&benchmarking&&taskEpoch===epoch;k++){e.step();if(k%10===9){receive({type:'progress',trial:i+1,seeds:data.seeds,step:k+1,steps:data.steps});await new Promise(r=>setTimeout(r,0));}}
        if(benchmarking)trials.push({seed:e.config.seed,summary:e.summary(),diagnostics:{...e.pipeline.diagnostics}});
      }
      if(taskEpoch===epoch)receive({type:'benchmark',trials,aggregate:TSRIExperiment.aggregate(trials),cancelled:!benchmarking,config:data.config,steps:data.steps});
    }
  }catch(error){receive({type:'error',message:error.stack||String(error)});}},0);
}
function reset(){
  epoch++;stop();if(worker)worker.terminate();worker=null;
  if(location.protocol!=='file:'&&typeof Worker!=='undefined'){
    worker=new Worker('tsri_worker.js');worker.onmessage=e=>receive(e.data);worker.onerror=e=>receive({type:'error',message:e.message});
  }
  busy=true;state=null;trialResult=null;$('trialResults').hidden=true;$('btnTrialExport').hidden=true;$('errorStatus').hidden=true;
  $('benchmarkStatus').textContent='현재 seed부터 순차 실행, seed별 95% 신뢰구간';
  updateLabels();statusControls();message({type:'init',config:config()});
}
function steps(count){if(busy||benchmarking)return;busy=true;statusControls();message({type:'steps',count});}
function receive(data){
  if(data.type==='state'){
    state=data.state;busy=false;statusControls();render();
    if(running)timer=setTimeout(()=>steps(1),1000/Math.max(1,+$('panelFps').value));
  }else if(data.type==='error'){busy=false;benchmarking=false;stop();$('errorStatus').hidden=false;$('errorStatus').textContent=data.message;}
  else if(data.type==='progress')$('benchmarkStatus').textContent=`Seed ${data.trial}/${data.seeds}, ${data.step}/${data.steps} frames`;
  else if(data.type==='benchmark'){
    benchmarking=false;trialResult=data;statusControls();$('benchmarkStatus').textContent=`${data.trials.length} seed 완료${data.cancelled?' / 중지됨':''}, 95% 신뢰구간`;
    $('btnTrialExport').hidden=false;renderTrials();
  }else if(data.type==='export'){
    const fields=['seed','frame','key','pair','method','t0','availableAt','lag','accepted','converged','reason','b2','cost','rmse','contactError','normalError','condition','fullCondition','radius95','totalIterations','totalEvaluations','ms','starts'];
    const header=[...fields,'x_m','y_m','cov_xx','cov_xy','cov_yy','weighting','window','rangeSigma','poseSigma'];
    const rows=data.data.rows.map(r=>[...fields.map(k=>r[k]),...r.x,r.covariance?.[0][0],r.covariance?.[0][1],r.covariance?.[1][1],data.data.config.weighting,data.data.config.window,data.data.config.noiseSigma,data.data.config.posSigma]);
    const csv=[header,...rows].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
    download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),'tsri-windows.csv');
  }
}
function render(){
  if(!state)return;const d=state.diagnostics;
  $('runStatus').textContent=`${state.step} frames / ${f(state.time,2)} s / seed ${state.config.seed}`;
  $('mapStatus').textContent=`${d.windows} windows / ${d.tracks} track 후보 / 관측한 참 벽 ${pct(state.coverage)}`;
  const rows=[['풀이 수렴률','convergence',pct],['지도 채택률, 전체 창 기준','outputRate',pct],['접점 RMSE, 보류 포함 (m)','contactRMSE',f],['채택 접점 RMSE (m)','acceptedRMSE',f],['법선 RMSE, 보류 포함 (deg)','normalRMSE',f],['거리 잔차 RMSE (m)','rangeRMSE',f],['풀이 시간, 평균 / p95 (ms)',null,(s)=>f(s.meanMs,2)+' / '+f(s.p95Ms,2)],['총 반복 / 함수 평가, 창당',null,s=>f(s.iterations,1)+' / '+f(s.evaluations,1)],['위치 조건수 중앙값','conditionMedian',v=>f(v,1)],['누적 채택 수','accepted',v=>String(v)],['지도 P / R / F1 @ 0.4 m',null,s=>[s.mapPrecision,s.mapRecall,s.mapF1].map(v=>f(v,2)).join(' / ')]];
  $('comparisonBody').innerHTML=rows.map(([label,key,format])=>`<tr><td>${label}</td>${methods.map(m=>`<td>${format(key?state.summary[m][key]:state.summary[m])}</td>`).join('')}</tr>`).join('');
  $('diagnostics').textContent=`입력 ${d.input}개 → 거리 군집 ${d.clusters}개 → 풀이 창 ${d.windows}개. 초기화 실패 ${d.initFailures}개. 연관 후보 제한으로 제외 ${d.pruned}개. 병합 거리 보류 ${d.withheld}개. 시간은 모든 초기 후보의 최적화와 품질 계산 포함, 공통 전처리 / 화면 그리기 제외. p95는 최근 최대 10,000개 창 기준. 지도 저장 한도 초과로 제거한 점 ${d.droppedSurfels}개.`;
  for(const m of methods){const s=state.summary[m];$('note'+m.toUpperCase()).textContent=`채택 ${s.accepted} / ${s.windows}개, 접점 RMSE ${f(s.contactRMSE,2)} m`;}
  drawMap($('cvsMain'),methods,true);methods.forEach(m=>drawMap($('cvs'+m.toUpperCase()),[m],false));
  const c=state.lastComparison;if(c){
    $('windowInfo').innerHTML=`<p>차량쌍 ${c.pair}, 중심 ${f(c.t0,2)} s<br>출력 ${f(c.results.lm.availableAt,2)} s, 지연 ${f(c.results.lm.lag,2)} s<br>초기 후보 ${c.seeds.length}개, 공통 준비 ${f(c.setupMs,2)} ms</p>`+methods.map(m=>{const r=c.results[m];return `<p style="color:${colors[m]}">${m.toUpperCase()}: ${reason[r.reason]||r.reason}<br>b₂ ${f(r.b2,3)} m/s², 위치 κ ${f(r.condition,1)}<br>정규화한 전체 J의 κ ${f(r.fullCondition,1)}, 95% 반경 ${f(r.radius95,2)} m</p>`;}).join('');
    drawCost();
  }
}
function canvasSetup(canvas,width,height){
  const W=width||canvas.clientWidth||300,H=height||canvas.clientHeight||200,dpr=width?1:Math.max(1,devicePixelRatio||1);
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,W,H};
}
function drawMap(canvas,selected,overview,width,height){
  const {ctx,W,H}=canvasSetup(canvas,width,height);ctx.fillStyle='#fbfbfd';ctx.fillRect(0,0,W,H);
  const margin=width?90:overview?26:22,scale=Math.min((W-2*margin)/60,(H-2*margin)/30),ox=(W-60*scale)/2,oy=(H-30*scale)/2;
  const x=v=>ox+v*scale,y=v=>H-oy-v*scale;
  ctx.font=`${width?36:10}px -apple-system,sans-serif`;ctx.lineWidth=1.5;
  for(let xx=0;xx<=60;xx+=10){ctx.strokeStyle='#e8e8ee';ctx.beginPath();ctx.moveTo(x(xx),y(0));ctx.lineTo(x(xx),y(30));ctx.stroke();ctx.fillStyle='#93939d';ctx.fillText(String(xx),x(xx)-5,y(0)+14);}
  for(let yy=0;yy<=30;yy+=10){ctx.strokeStyle='#e8e8ee';ctx.beginPath();ctx.moveTo(x(0),y(yy));ctx.lineTo(x(60),y(yy));ctx.stroke();}
  ctx.fillStyle='#777783';ctx.fillText('m',x(60)+5,y(0)+14);
  if(!state)return;
  if($('showGT').checked)for(const wall of state.walls){ctx.beginPath();wall.forEach((p,i)=>i?ctx.lineTo(x(p.x),y(p.y)):ctx.moveTo(x(p.x),y(p.y)));ctx.lineWidth=width?6.25:1.5;ctx.strokeStyle='#73737e';ctx.stroke();}
  if(overview&&$('showPaths').checked){ctx.strokeStyle='#879ab32e';ctx.lineWidth=1.5;for(const p of state.paths){ctx.beginPath();ctx.moveTo(x(p.tx.x),y(p.tx.y));ctx.lineTo(x(p.hit.x),y(p.hit.y));ctx.lineTo(x(p.rx.x),y(p.rx.y));ctx.stroke();}}
  for(const m of selected){ctx.fillStyle=colors[m];ctx.strokeStyle=colors[m];ctx.lineWidth=width?6.25:1.5;
    if($('showCandidates').checked){ctx.save();ctx.globalAlpha=.28;for(const p of state.candidates[m]){ctx.beginPath();ctx.arc(x(p.x),y(p.y),width?5:2.5,0,Math.PI*2);ctx.stroke();}ctx.restore();}
    for(const p of state.maps[m]){
      ctx.beginPath();ctx.arc(x(p.x),y(p.y),width?4:2,0,Math.PI*2);ctx.fill();
      if(p.normal){ctx.beginPath();ctx.moveTo(x(p.x-p.normal[0]*.32),y(p.y-p.normal[1]*.32));ctx.lineTo(x(p.x+p.normal[0]*.32),y(p.y+p.normal[1]*.32));ctx.stroke();}
    }
    const result=state.lastComparison?.results[m];
    if(result&&$('showCandidates').checked){
      const candidates=[result.x,...result.alternatives.map(a=>a.x)];ctx.setLineDash([3,3]);
      for(const p of candidates){ctx.beginPath();ctx.arc(x(p[0]),y(p[1]),width?9:5,0,Math.PI*2);ctx.stroke();}ctx.setLineDash([]);
    }
    if(result?.covariance&&$('showCov').checked){
      const C=result.covariance,e=TSRI.eigen2(C[0][0],C[0][1],C[1][1]),theta=.5*Math.atan2(2*C[0][1],C[0][0]-C[1][1]);
      const a=Math.sqrt(5.991*e.hi)*scale,b=Math.sqrt(5.991*e.lo)*scale;
      if(a<1e5){ctx.save();ctx.globalAlpha=.35;ctx.beginPath();ctx.ellipse(x(result.x[0]),y(result.x[1]),a,b,-theta,0,Math.PI*2);ctx.stroke();ctx.restore();}
    }
  }
  for(const p of state.bots){ctx.beginPath();ctx.arc(x(p.x),y(p.y),width?8:3.5,0,Math.PI*2);ctx.fillStyle='#314761';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#fff';ctx.stroke();}
  if(overview){ctx.font=`${width?44:11}px -apple-system,sans-serif`;selected.forEach((m,i)=>{ctx.fillStyle=colors[m];ctx.fillText({lm:'LM',tr:'TR-GN',vp:'VP + LM'}[m],x(0)+i*(width?210:74),y(30)-8);});}
}
function drawCost(){
  const canvas=$('cvsCost');if(!canvas.clientWidth)return;
  const {ctx,W,H}=canvasSetup(canvas),c=state?.lastComparison;if(!c)return;
  ctx.fillStyle='#fafafd';ctx.fillRect(0,0,W,H);const logs=methods.flatMap(m=>c.results[m].history.map(v=>Math.log10(Math.max(v,1e-15))));
  const lo=Math.min(...logs)-.1,hi=Math.max(lo+1,...logs),n=Math.max(...methods.map(m=>c.results[m].history.length));
  ctx.font='11px sans-serif';ctx.fillStyle='#777';ctx.fillText('log10 objective / accepted steps',12,18);
  ctx.fillText(f(hi,1),4,38);ctx.fillText(f(lo,1),4,H-22);
  methods.forEach((m,mi)=>{ctx.strokeStyle=colors[m];ctx.lineWidth=1.8;ctx.setLineDash(mi===1?[6,3]:mi===2?[2,3]:[]);ctx.beginPath();c.results[m].history.forEach((v,i)=>{const x=35+i/Math.max(1,n-1)*(W-48),y=32+(hi-Math.log10(Math.max(v,1e-15)))/(hi-lo)*(H-55);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();});ctx.setLineDash([]);
}
function renderTrials(){
  const el=$('trialResults');el.hidden=false;const a=trialResult.aggregate;
  const cell=o=>o?.mean===null?'—':`${f(o.mean,3)}${o.low!==null?' ['+f(o.low,3)+', '+f(o.high,3)+']':''}`;
  el.innerHTML=`<strong>${a.trials}개 seed 반복 비교, 평균 [95% CI]</strong><p class="micro-note">현재 지도 실행과 별도. 동일 seed의 세 방법을 짝지어 비교. 설정: ${trialResult.config.scenario}, 창 ${trialResult.config.window}, ${trialResult.steps} frames/seed. 보류한 창도 접점 RMSE에 포함.</p><div class="table-wrap"><table><thead><tr><th>항목</th><th>LM</th><th>TR-GN</th><th>VP + LM</th></tr></thead><tbody>`+
    [['contactRMSE','접점 RMSE (m)'],['normalRMSE','법선 RMSE (deg)'],['rangeRMSE','거리 잔차 (m)'],['convergence','수렴률 (0–1)'],['outputRate','지도 채택률 (0–1)'],['meanMs','평균 시간 (ms)']].map(([k,label])=>`<tr><td>${label}</td>${methods.map(m=>`<td>${cell(a.methods[m][k])}</td>`).join('')}</tr>`).join('')+`<tr><td>LM 대비 시간 차이 (ms)</td><td>0</td><td>${cell(a.pairedVsLM.tr.meanMs)}</td><td>${cell(a.pairedVsLM.vp.meanMs)}</td></tr></tbody></table></div>`;
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
async function exportFigure(){
  const c=document.createElement('canvas');drawMap(c,methods,true,3600,1800);
  const blob=await new Promise(r=>c.toBlob(r,'image/png')),bytes=new Uint8Array(await blob.arrayBuffer());
  // PNG pHYs: 300 dots/inch = round(300/0.0254) pixels/metre.
  const chunk=new Uint8Array(21),v=new DataView(chunk.buffer);v.setUint32(0,9);chunk.set([112,72,89,115],4);v.setUint32(8,11811);v.setUint32(12,11811);chunk[16]=1;v.setUint32(17,crc32(chunk.slice(4,17)));
  const parts=[bytes.slice(0,8)];
  for(let offset=8;offset+12<=bytes.length;){
    const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0),end=offset+12+length;
    if(end>bytes.length)throw Error('Invalid PNG chunk');
    const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));
    if(type!=='pHYs')parts.push(bytes.slice(offset,end));
    if(type==='IHDR')parts.push(chunk);offset=end;
  }
  download(new Blob(parts,{type:'image/png'}),'tsri-map-300dpi.png');
}
document.querySelectorAll('.control-group .sec-toggle').forEach(b=>b.addEventListener('click',()=>{const group=b.closest('.control-group');b.setAttribute('aria-expanded',String(!group.classList.toggle('collapsed')));}));
for(const [id,label,d] of [['seed','vSeed',0],['gap','vGap',1],['rough','vRough',2],['curve','vCurve',2],['torusR','vTR',1],['nBots','vN',0],['speed','vSpeed',1],['spread','vSpread',1],['noiseSigma','vNoiseSigma',2],['posSigma','vPosSigma',2]])$(id).addEventListener('input',()=>{$(label).textContent=f(+$(id).value,d);});
document.querySelectorAll('.sidebar input:not([id^="show"]):not(#panelFps), .sidebar select:not(#trialCount):not(#trialSteps)').forEach(el=>el.addEventListener('change',()=>{if(el.id==='diffuseSigma'&&+el.value===0)$('diffuseMean').value=1;reset();}));
$('panelFps').addEventListener('input',()=>{$('vPanelFps').textContent=$('panelFps').value;});
document.querySelectorAll('[id^="show"]').forEach(el=>el.addEventListener('change',render));
$('btnScenCorridor').onclick=()=>{scenario='corridor';reset();};$('btnScenTorus').onclick=()=>{scenario='torus';reset();};
$('btnRun').onclick=()=>{if(running)stop();else{running=true;statusControls();if(!busy)steps(1);}};
$('btnStep').onclick=()=>steps(1);$('btn20').onclick=()=>steps(20);$('btnReset').onclick=()=>{benchmarking=false;reset();};
$('btnExport').onclick=()=>message({type:'export'});$('btnFigure').onclick=exportFigure;
$('btnBenchmark').onclick=()=>{if(benchmarking){message({type:'cancel'});$('benchmarkStatus').textContent='중지 요청, 완료한 seed 결과 보존';return;}stop();benchmarking=true;statusControls();message({type:'benchmark',config:config(),seeds:+$('trialCount').value,steps:+$('trialSteps').value});};
$('btnTrialExport').onclick=()=>download(new Blob([JSON.stringify(trialResult,null,2)],{type:'application/json'}),'tsri-seed-comparison.json');
$('windowDetail').addEventListener('toggle',drawCost);
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(render,80);});
window.TSRIApp={getState:()=>state,getTrialResult:()=>trialResult,config,steps,reset};
reset();
})();
