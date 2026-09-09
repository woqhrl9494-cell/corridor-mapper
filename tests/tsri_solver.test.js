'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../tsri_solver'),P=require('../tsri_pipeline'),E=require('../tsri_experiment');
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function fixture({noise=0,offset=0,timeScale=1}={}){
  const x=[4,8],beta=-.8;
  const records=Array.from({length:41},(_,k)=>{const t=(k-20)*.05,tx={x:2+3*t,y:1+1.8*t+.6*t*t},rx={x:7-1.4*t,y:2-.7*t+.3*t*t};
    return {t:offset+t*timeScale,r:S.geometry(x,{tx,rx}).f+beta*t*t+noise*Math.sin(k*1.81),tx,rx,sigma:.01,key:`m${k}`,i:0,j:1};});
  return {records,x,beta};
}
test('pivoted QR solves a badly scaled system without forming normal equations',()=>{
  const A=[[1,1e-5,1],[1,2e-5,0],[1,4e-5,1],[1,8e-5,3]],x=[2,30,-1],b=A.map(r=>S.dot(r,x));
  const q=S.leastSquares(A,b);assert.equal(q.rank,3);q.x.forEach((v,i)=>near(v,x[i],1e-7));
});
test('analytic full and projected Jacobians match central finite differences',()=>{
  const {records}=fixture({noise:.01}),p=S.prepare(records,[4.1,7.9],{poseSigma:.08}),q=[4.1,7.9,-.6];
  for(const projected of [false,true]){
    const ev=S.evaluate(p,q,projected);for(let j=0;j<(projected?2:3);j++){
      const a=q.slice(),b=q.slice(),eps=1e-5;a[j]+=eps;b[j]-=eps;
      const ea=S.evaluate(p,a,projected).e,eb=S.evaluate(p,b,projected).e;
      ea.forEach((v,i)=>near(-(v-eb[i])/(2*eps),ev.J[i][j],2e-6));
    }
  }
});
test('variable projection exactly minimizes beta for fixed x and fixed correlated R',()=>{
  const {records}=fixture(),p=S.prepare(records,[4,8],{poseSigma:.1}),ev=S.evaluate(p,[3.8,7.7],true);
  near(S.dot(p.a,ev.e),0,1e-7);
  near(S.evaluate(p,[3.8,7.7,ev.beta]).cost,ev.cost,1e-8);
  for(const delta of [-.01,.01])assert.ok(S.evaluate(p,[3.8,7.7,ev.beta+delta]).cost>ev.cost);
});
test('all three methods recover a noiseless identifiable contact from a shared nontruth start',()=>{
  const {records,x,beta}=fixture(),p=S.prepare(records,[4.1,7.9]);
  const start=[4.1,7.9,S.evaluate(p,[4.1,7.9],true).beta];
  for(const m of ['lm','tr','vp']){const r=S.solve(p,start,m);assert.ok(r.converged);near(r.x[0],x[0],1e-5);near(r.x[1],x[1],1e-5);near(r.b2,beta,1e-5);assert.ok(r.rmse<1e-7);
    r.history.slice(1).forEach((v,i)=>assert.ok(v<=r.history[i]));}
});
test('time units and absolute timestamps leave contacts invariant and scale b2 correctly',()=>{
  for(const m of ['lm','tr','vp']){
    const a=fixture(),b=fixture({offset:1e6,timeScale:1000});
    const ra=S.solve(S.prepare(a.records,[4.1,7.9]),[4.1,7.9,-.8],m),rb=S.solve(S.prepare(b.records,[4.1,7.9]),[4.1,7.9,-.8],m);
    near(ra.x[0],rb.x[0],1e-5);near(ra.b2,rb.b2*1e6,1e-5);
  }
});
test('fixed poses provide rank-deficient contact information; no finite certainty claimed',()=>{
  const records=Array.from({length:21},(_,k)=>({t:k*.05,r:12,tx:{x:0,y:0},rx:{x:4,y:0},sigma:.1}));
  const p=S.prepare(records,[2,Math.sqrt(32)]),r=S.solve(p,[2,Math.sqrt(32),0],'vp'),u=S.uncertainty(p,r);
  assert.equal(u.condition,Infinity);assert.equal(u.covariance,null);
});
test('Schur-complement marginal covariance agrees with full joint information inverse',()=>{
  const {records}=fixture(),p=S.prepare(records,[4,8],{poseSigma:.1}),r=S.solve(p,[4.1,7.9,-.8]),u=S.uncertainty(p,r),J=S.evaluate(p,[...r.x,r.beta]).J;
  const H=Array.from({length:3},(_,a)=>Array.from({length:3},(_,b)=>J.reduce((v,row)=>v+row[a]*row[b],0)));
  for(let col=0;col<2;col++){const x=S.leastSquares(H,[0,1,2].map(k=>+(k===col))).x;for(let row=0;row<2;row++)near(x[row],u.covariance[row][col],1e-6);}
});
test('iteration exhaustion is not labeled converged',()=>{
  const {records}=fixture(),r=S.solve(S.prepare(records,[10,20]),[10,20,1],'lm',{maxIter:0});assert.equal(r.converged,false);assert.equal(r.status,'iteration_limit');
});
test('invalid times, future data and non-SPD covariance fail closed',()=>{
  const {records}=fixture();assert.throws(()=>S.prepare(records.slice().reverse(),[4,8]),/increasing/);
  assert.throws(()=>S.cholesky([[1,2],[2,1]]),/positive/);
  const pipe=new P.Pipeline();assert.throws(()=>pipe.update(0,[records.at(-1)]),/Future/);
});
test('shared initialization is deterministic and multistart retains competing roots',()=>{
  const {records}=fixture(),a=S.compare(records),b=S.compare(records);assert.deepEqual(a.seeds,b.seeds);
  for(const m of ['lm','tr','vp']){assert.equal(a.results[m].starts,a.seeds.length);near(a.results[m].cost,b.results[m].cost,1e-8);}
});
test('shared-pose GLS whitening has nonzero temporal off-diagonal covariance',()=>{
  const {records}=fixture(),p=S.prepare(records,[4,8],{poseSigma:.1});assert.notEqual(p.L[1][0],0);
});
test('range preprocessing never promotes an unknown merged echo to calibrated data',()=>{
  const {records}=fixture();assert.equal(P.preprocess(records,{preprocess:'withhold'}).length,0);
});
test('seed-level confidence interval requires multiple independent runs',()=>{
  assert.equal(E.confidence([1]).low,null);const c=E.confidence([1,2,3,4,5]);near(c.mean,3);assert.ok(c.low<3&&c.high>3);assert.equal(E.confidence([null,NaN]).n,0);
});
module.exports={fixture};
