/* R2: joint temporal moments and primitive-error propagation.
 * Inputs: n observed ranges [m], positions [m], timestamps [s], noise model.
 * a[3] = [a0,a1,a2] all metres; m(x)=[F,Th*Ft] both metres.
 * R_range contains only range-observation errors, never full-F pose residuals.
 * Default covariance model matches the simulator: independent range errors,
 * independent per-vehicle constant pose biases shared by all pairs/windows.
 * Optional independent pose noise uses vehicle/time IDs across pairs.
 * O(n³+n²p) setup, O(n) per-root propagation; O(n²) storage, Float64.
 */
(function(root,factory){const node=typeof module==='object',api=factory(node?require('./linalg'):root.MomentLA);if(node)module.exports=api;else root.TSRIMoments=api;})(globalThis,LA=>{
'use strict';
const xy=p=>[p.x,p.y],zero=()=>[0,0];
// The frozen front end reports 1e-6 for a zero-noise singleton. This
// provenance flag removes that numerical artifact from physical covariance.
// rangeObservationSigma explicitly supplies pre-cluster sensor sigma. The
// legacy median/MAD spread is not reinterpreted as independent sensor noise.
function rangeSigma(r,o){if(o.rangeObservationSigma!==undefined)return o.rangeObservationSigma;return o.legacyPreprocessSigmaFloor&&o.rangeSigma===0&&r.sigma===1e-6?0:(r.sigma??o.rangeSigma??.1);}
function recordId(r){return JSON.stringify([r.i,r.j,r.t,r.r,r.tx.x,r.tx.y,r.rx.x,r.rx.y,r.sigma??null]);}
function cleanRecords(records,availableAt=Infinity){const seen=new Set(),out=[];for(const r of records){
  if(r.t>availableAt+1e-10)throw Error('Future observation rejected');
  if(![r.t,r.r,r.tx.x,r.tx.y,r.rx.x,r.rx.y].every(Number.isFinite))throw Error('Invalid observation');
  const id=recordId(r);if(seen.has(id))continue;seen.add(id);out.push({i:r.i,j:r.j,key:r.key,t:r.t,r:r.r,sigma:r.sigma,tx:{x:r.tx.x,y:r.tx.y},rx:{x:r.rx.x,y:r.rx.y}});
}if(out.length<5)throw Error('At least five distinct observations required');
for(let k=0;k<out.length;k++)if(k&&out[k].t<=out[k-1].t||out[k].i!==out[0].i||out[k].j!==out[0].j)throw Error('Non-increasing times or mixed pair');return out;}
function regression(T,metricCovariance){
  const n=T.length,L0=metricCovariance?LA.cholesky(metricCovariance):null,whiten=v=>L0?LA.lower(L0,v):v;
  const Tw=LA.tr(LA.tr(T).map(whiten)),factor=LA.qr(Tw);if(factor.rank<3)throw Error('Temporal design rank deficient');
  const taps=LA.tr(Array.from({length:n},(_,j)=>factor.solve(whiten(Array.from({length:n},(_,i)=>+(i===j))))));
  return {taps,rank:factor.rank};
}
function fit(raw,options={}){
  const records=cleanRecords(raw,options.available_at??Infinity),center=records[Math.floor(records.length/2)],t0=center.t,h=Math.max(...records.map(r=>Math.abs(r.t-t0)));
  const T=records.map(r=>[1,(r.t-t0)/h,((r.t-t0)/h)**2]),n=records.length;
  const variances=records.map(r=>rangeSigma(r,options)**2);
  const R=options.rangeCovariance||LA.zeros(n,n).map((row,i)=>row.map((_,j)=>i===j?variances[i]:0));
  let metric=options.metricCovariance||null,metricKind=metric?'provided_fixed_metric':'identity';
  if(options.moment_weighting==='range_gls'&&variances.every(v=>v>0)){metric=R;metricKind='range_gls';}
  // No physical noise floor: if R=0, use a fixed identity fit metric only.
  const {taps}=regression(T,metric),a=LA.mv(taps,records.map(r=>r.r)),Ca=LA.mm(LA.mm(taps,R),LA.tr(taps));
  const poseTaps=regression(T,null).taps,vtx=['x','y'].map(k=>LA.dot(poseTaps[1],records.map(r=>r.tx[k]))/h),vrx=['x','y'].map(k=>LA.dot(poseTaps[1],records.map(r=>r.rx[k]))/h);
  return {records,T,taps,poseTaps,a,Ca,R_range:R,metricKind,t0,h,tx:xy(center.tx),rx:xy(center.rx),vtx,vrx,rho:a[0],rate:a[1]/h,
    range_rate_covariance:[[Ca[0][0],Ca[0][1]/h],[Ca[1][0]/h,Ca[1][1]/h**2]],measurement_ids:records.map(recordId),source_window_id:JSON.stringify(records.map(recordId)),available_at:records.at(-1).t};
}
function geometry(x,m){
  const deltas=[m.tx,m.rx].map(p=>x.map((v,k)=>v-p[k])),dist=deltas.map(LA.norm);
  if(dist.some(d=>d<1e-8))return {valid:false,reason:'near_focus'};
  const e=deltas.map((d,i)=>d.map(v=>v/dist[i])),H=e.map((v,i)=>[[1-v[0]*v[0],-v[0]*v[1]],[-v[0]*v[1],1-v[1]*v[1]]].map(row=>row.map(z=>z/dist[i])));
  const g=e[0].map((v,k)=>v+e[1][k]),gn=LA.norm(g);if(gn<1e-8)return {valid:false,reason:'small_gradient'};
  const F=dist[0]+dist[1],Ft=-LA.dot(e[0],m.vtx)-LA.dot(e[1],m.vrx),gt=LA.mv(H[0],m.vtx).map((v,k)=>-v-LA.mv(H[1],m.vrx)[k]);
  const normal=g.map(v=>v/gn),G=[g,gt.map(v=>m.h*v)];
  return {valid:true,F,Ft,m:[F,m.h*Ft],e,H,g,gn,normal,theta:Math.atan2(normal[1],normal[0]),G};
}
function sources(m,options={}){
  if(options.errorSources)return options.errorSources;
  if(options.rangeCovariance)throw Error('Supply global errorSources for correlated range observations; cross-window correlations cannot be inferred');
  const out=[],n=m.records.length,c=Math.floor(n/2),sumV=LA.dot(m.poseTaps[1],Array(n).fill(1))/m.h;
  const make=id=>({id,da:zero(),pi:zero(),pj:zero(),vi:zero(),vj:zero()});
  for(let k=0;k<n;k++){const sigma=rangeSigma(m.records[k],options);if(sigma){const s=make('range:'+m.measurement_ids[k]);s.da=[m.taps[0][k]*sigma,m.taps[1][k]*sigma];out.push(s);}}
  for(const [who,id]of [['i',m.records[0].i],['j',m.records[0].j]])for(let d=0;d<2;d++){
    const sigma=options.poseSigma??0;if(sigma){const s=make(`vehicle:${id}:constant_bias:${d}`);s['p'+who][d]=sigma;s['v'+who][d]=(Math.abs(sumV)<1e-13?0:sumV)*sigma;out.push(s);}
    const sp=options.poseIndependentSigma??0;if(sp)for(let k=0;k<n;k++){const s=make(`vehicle:${id}:sample:${m.records[k].t}:${d}`);s['p'+who][d]=k===c?sp:0;s['v'+who][d]=m.poseTaps[1][k]/m.h*sp;out.push(s);}
  }
  return out;
}
function propagate(m,x,options={}){
  const geo=geometry(x,m);if(!geo.valid)return {valid:false,reason:geo.reason};
  const factor=LA.qr(geo.G),gram=LA.mm(geo.G,LA.tr(geo.G)),eig=LA.eigenSymmetric(gram),condition=eig.at(-1).value>0?Math.sqrt(eig[0].value/eig.at(-1).value):Infinity;
  if(factor.rank<2)return {valid:false,reason:'moment_rank_deficient',condition};
  const nperp=[-geo.normal[1],geo.normal[0]],Ht=geo.H[0].map((r,i)=>r.map((v,j)=>v+geo.H[1][i][j]));
  const factors=sources(m,options).map(s=>{
    const de=[s.da[0]+LA.dot(geo.e[0],s.pi)+LA.dot(geo.e[1],s.pj),s.da[1]+m.h*(-LA.dot(LA.mv(geo.H[0],m.vtx),s.pi)-LA.dot(LA.mv(geo.H[1],m.vrx),s.pj)+LA.dot(geo.e[0],s.vi)+LA.dot(geo.e[1],s.vj))];
    const dx=factor.solve(de),dg=LA.mv(Ht,dx).map((v,k)=>v-LA.mv(geo.H[0],s.pi)[k]-LA.mv(geo.H[1],s.pj)[k]),dtheta=LA.dot(nperp,dg)/geo.gn;
    return {id:s.id,e:de,y:[...dx,dtheta]};
  });
  const Ce=LA.covariance(factors.map(s=>s.e),2),joint=LA.covariance(factors.map(s=>s.y),3),Cx=joint.slice(0,2).map(r=>r.slice(0,2)),e=m.a.slice(0,2).map((v,k)=>v-geo.m[k]),spectrum=LA.eigenSymmetric(Ce);
  const stochasticRank=spectrum.filter(q=>q.value>Math.max(0,spectrum[0].value)*1e-12&&q.value>0).length;
  let Jstat=null;if(stochasticRank===2){const w=LA.lower(LA.cholesky(Ce),e);Jstat=LA.dot(w,w);}
  // Unit perturbations of temporal model bias [delta a0, delta a1].
  const biasMap=LA.tr([[1,0],[0,1]].map(v=>{const dx=factor.solve(v);return [...dx,LA.dot(nperp,LA.mv(Ht,dx))/geo.gn];}));
  return {valid:true,normal:geo.normal,theta:geo.theta,condition,e,Jstat,C_e:Ce,Sigma_measurement_local:Cx,joint_position_normal_covariance:joint,stochasticRank,factors,biasMap,
    covariance_assumptions:'Linearized local measurement covariance; independent range errors and explicitly shared vehicle bias/sample factors; no model discrepancy included',model_bias_description:{kind:'unbounded',scope:'Temporal coefficient bias not specified; measurement ellipse is not a total 95% confidence region'}};
}
function crossCovariance(a,b){const index=new Map(b.factors.map(s=>[s.id,s.y])),C=LA.zeros(3,3);for(const s of a.factors){const q=index.get(s.id);if(q)for(let i=0;i<3;i++)for(let j=0;j<3;j++)C[i][j]+=s.y[i]*q[j];}return C;}
function momentObjective(m,x,Ce){const g=geometry(x,m);if(!g.valid)return Infinity;const e=m.a.slice(0,2).map((v,k)=>v-g.m[k]),w=LA.lower(LA.cholesky(Ce),e);return LA.dot(w,w);}
function stability(m,options={}){
  const cut=Math.floor(m.records.length/4);if(cut<2)return {kind:'unbounded',reason:'insufficient_nested_window'};
  const inner=fit(m.records.slice(cut,-cut),{...options,metricCovariance:undefined,rangeCovariance:undefined}),scale=m.h/inner.h;
  const A=m.taps.slice(0,2).map(r=>r.slice());for(let j=0;j<inner.records.length;j++){A[0][j+cut]-=inner.taps[0][j];A[1][j+cut]-=scale*inner.taps[1][j];}
  const delta=[m.a[0]-inner.a[0],m.a[1]-scale*inner.a[1]],C=LA.mm(LA.mm(A,m.R_range),LA.tr(A));
  return {kind:'multiwindow_stability_only',unbounded_terms:['range temporal remainder','velocity-fit truncation','association error'],delta_a01:delta,C_delta_measurement:C,outer_half_window:m.h,inner_half_window:inner.h,bound_available:false,
    interpretation:'Correlated nested-window diagnostic, not a mathematical or empirically calibrated bias bound. No covariance inflation or confidence claim.',normalization:'Both coefficient differences are metres; inner a1 rescaled to outer half-window.'};
}
return {recordId,cleanRecords,regression,fit,geometry,sources,propagate,crossCovariance,momentObjective,stability};
});
