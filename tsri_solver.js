/* TSRI-S reference solver. Float64 JavaScript numbers; distances m, times s.
 * Input: n records {t,r,tx:{x,y},rx:{x,y},sigma}, n >= 5; fixed SPD R.
 * Output: center contact x[2], b2 [m/s^2], unsigned normal[2], marginal Cx[2,2].
 * Objective: ||L^-1(rho-F(x)-beta*u^2)||^2; u=(t-t0)/h, beta=b2*h^2.
 * No constraints on beta. No wall, path identity, true pose, or future data.
 * Cost: setup O(n^3), each iteration O(n^2 p+n p^2+p^3), p=2 or 3.
 * Memory O(n^2 + np). Dense whitening dominates; p is never a map dimension.
 */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.TSRI=api;})(globalThis,()=>{
'use strict';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), norm=a=>Math.sqrt(dot(a,a));
const zeros=(n,m)=>Array.from({length:n},()=>Array(m).fill(0));
const transpose=A=>A[0].map((_,j)=>A.map(r=>r[j]));
const now=()=>performance.now();

// Twice-reorthogonalized, column-pivoted QR. Never form J'J for a solver step.
function leastSquares(A,b,tol=1e-12){
  const m=A.length,n=A[0].length,V=transpose(A).map(c=>c.slice()),Q=[],R=zeros(n,n),perm=Array.from({length:n},(_,i)=>i);
  const initial=Math.max(...V.map(norm),1e-30);let rank=0;
  for(let j=0;j<n;j++){
    let k=j;for(let l=j+1;l<n;l++)if(norm(V[l])>norm(V[k]))k=l;
    [V[j],V[k]]=[V[k],V[j]];[perm[j],perm[k]]=[perm[k],perm[j]];
    for(let i=0;i<j;i++)[R[i][j],R[i][k]]=[R[i][k],R[i][j]];
    R[j][j]=norm(V[j]);if(R[j][j]<=tol*initial)break;
    Q[j]=V[j].map(v=>v/R[j][j]);rank++;
    for(let l=j+1;l<n;l++)for(let repeat=0;repeat<2;repeat++){
      const c=dot(Q[j],V[l]);R[j][l]+=c;for(let i=0;i<m;i++)V[l][i]-=c*Q[j][i];
    }
  }
  const z=Array(n).fill(0),x=Array(n).fill(0);
  for(let j=rank-1;j>=0;j--){let c=dot(Q[j],b);for(let k=j+1;k<rank;k++)c-=R[j][k]*z[k];z[j]=c/R[j][j];}
  perm.forEach((k,j)=>{x[k]=z[j];});return {x,rank};
}
function cholesky(R){
  const n=R.length,L=zeros(n,n);
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let v=R[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];
    if(i===j){if(!(v>0))throw new Error('R must be positive definite');L[i][j]=Math.sqrt(v);}else L[i][j]=v/L[j][j];
  }return L;
}
function whiten(L,v){const z=[];for(let i=0;i<v.length;i++){let t=v[i];for(let j=0;j<i;j++)t-=L[i][j]*z[j];z[i]=t/L[i][i];}return z;}
function geometry(x,m){
  const dx=x[0]-m.tx.x,dy=x[1]-m.tx.y,ex=x[0]-m.rx.x,ey=x[1]-m.rx.y;
  const a=Math.max(1e-12,Math.hypot(dx,dy)),b=Math.max(1e-12,Math.hypot(ex,ey));
  return {f:a+b,g:[dx/a+ex/b,dy/a+ey/b],jp:[-dx/a,-dy/a,-ex/b,-ey/b]};
}
function prepare(records,reference,options={}){
  if(records.length<5)throw new Error('At least 5 observations required');
  if(records.some((r,i)=>!Number.isFinite(r.r+r.t+r.tx.x+r.tx.y+r.rx.x+r.rx.y)||(i>0&&r.t<=records[i-1].t)))throw new Error('Invalid or non-increasing measurements');
  const center=records[Math.floor(records.length/2)],t0=center.t,h=Math.max(...records.map(m=>Math.abs(m.t-t0)));
  if(!(h>0))throw new Error('Nonzero time span required');
  const u2=records.map(m=>((m.t-t0)/h)**2),n=records.length;
  // Shared, constant robot bias across this window: Sigma_p = sigma_p^2 I_4.
  // Freeze at ONE data-derived reference for ALL seeds and ALL methods.
  const jp=records.map(m=>geometry(reference,m).jp),sp=options.poseSigma||0;
  const R=options.R||zeros(n,n).map((row,i)=>row.map((_,j)=>options.weighting==='ols'?(i===j?1:0):
    (i===j?Math.max(1e-12,(records[i].sigma??options.rangeSigma??0.1)**2):0)+sp*sp*dot(jp[i],jp[j])));
  const L=cholesky(R),a=whiten(L,u2),aa=dot(a,a);
  return {records,t0,h,u2,L,a,aa,center,weighting:options.weighting||'gls'};
}
function evaluate(problem,q,projected=false){
  const {records,L,a,aa,u2}=problem,geom=records.map(m=>geometry(q,m));
  const d=whiten(L,records.map((m,i)=>m.r-geom[i].f));
  const beta=projected?dot(a,d)/aa:q[2],e=d.map((v,i)=>v-beta*a[i]);
  const G=transpose([0,1].map(j=>whiten(L,geom.map(g=>g.g[j]))));
  // P = I-aa'/||a||^2 is constant because R is frozen and u does not depend on x.
  const J=projected?transpose(transpose(G).map(c=>{const v=dot(a,c)/aa;return c.map((z,i)=>z-v*a[i]);})):G.map((r,i)=>[...r,a[i]]);
  const raw=records.map((m,i)=>m.r-geom[i].f-beta*u2[i]);
  return {e,J,beta,cost:dot(e,e),raw};
}
function dogleg(A,e,radius){
  const cols=transpose(A),g=cols.map(c=>dot(c,e)),Ag=A.map(r=>dot(r,g));
  const alpha=dot(g,g)/Math.max(1e-30,dot(Ag,Ag)),sd=g.map(v=>alpha*v);
  const gn=leastSquares(A,e);
  if(gn.rank===g.length&&norm(gn.x)<=radius)return gn.x;
  if(norm(sd)>=radius||gn.rank<g.length)return g.map(v=>v*radius/Math.max(norm(g),1e-30));
  const delta=gn.x.map((v,i)=>v-sd[i]),b=2*dot(sd,delta),c=dot(sd,sd)-radius*radius;
  const tau=(-b+Math.sqrt(Math.max(0,b*b-4*dot(delta,delta)*c)))/(2*dot(delta,delta));
  return sd.map((v,i)=>v+tau*delta[i]);
}
function solve(problem,initial,method='lm',options={}){
  const started=now(),projected=method==='vp',p=projected?2:3;
  let q=initial.slice(0,p),ev=evaluate(problem,q,projected),lambda=1e-3,nu=2,radius=options.radius||10;
  let evaluations=1,accepted=0,rejected=0,status='iteration_limit',iterations=0;
  const history=[ev.cost],maxIter=options.maxIter??60;
  for(let it=0;it<maxIter;it++){
    iterations=it+1;
    const cols=transpose(ev.J),D=cols.map(c=>Math.max(1e-10,norm(c))),A=ev.J.map(r=>r.map((v,j)=>v/D[j]));
    const g=transpose(A).map(c=>dot(c,ev.e)),gnorm=Math.max(...g.map(Math.abs));
    if(gnorm<1e-7*Math.max(1,norm(ev.e))){status='gradient';break;}
    let z;
    if(method==='tr')z=dogleg(A,ev.e,radius);
    else {
      const aug=A.concat(zeros(p,p).map((r,i)=>r.map((_,j)=>i===j?Math.sqrt(lambda):0)));
      z=leastSquares(aug,ev.e.concat(Array(p).fill(0))).x;
    }
    const step=z.map((v,j)=>v/D[j]),trial=q.map((v,j)=>v+step[j]);
    const next=evaluate(problem,trial,projected);evaluations++;
    const model=ev.e.map((v,i)=>v-dot(ev.J[i],step));
    const prediction=ev.cost-dot(model,model),actual=ev.cost-next.cost;
    const ratio=prediction>0?actual/prediction:-Infinity;
    if(method==='tr'){
      if(ratio<0.25)radius=Math.max(1e-12,radius*0.25);
      else if(ratio>0.75&&norm(z)>0.9*radius)radius=Math.min(1e6,radius*2);
    }
    if(Number.isFinite(next.cost)&&ratio>1e-4&&actual>0){
      q=trial;ev=next;accepted++;history.push(ev.cost);
      if(method!=='tr'){lambda=Math.max(1e-15,lambda*Math.max(1/3,1-(2*ratio-1)**3));nu=2;}
    }else{rejected++;if(method!=='tr'){lambda=Math.min(1e20,lambda*nu);nu=Math.min(nu*2,1e8);}}
    if(norm(step)<1e-10*(1+norm(q))||lambda>=1e20||radius<=1e-12){
      const c=transpose(ev.J),scaled=c.map(v=>Math.abs(dot(v,ev.e))/Math.max(norm(v),1e-10));
      status=Math.max(...scaled)<1e-5*Math.max(1,norm(ev.e))?'stationary':'stalled';break;
    }
  }
  return {x:q.slice(0,2),beta:ev.beta,b2:ev.beta/problem.h**2,cost:ev.cost,rmse:Math.sqrt(dot(ev.raw,ev.raw)/ev.raw.length),
    converged:status==='gradient'||status==='stationary',status,iterations,evaluations,accepted,rejected,history,ms:now()-started};
}
function eigen2(a,b,c){const hi=(a+c+Math.hypot(a-c,2*b))/2,lo=hi>0?Math.max(0,(a*c-b*b)/hi):0;return {lo,hi};}
function uncertainty(problem,solution){
  const ev=evaluate(problem,[...solution.x,solution.beta]),cols=transpose(ev.J),{a,aa}=problem;
  const v=cols.slice(0,2).map(c=>{const k=dot(c,a)/aa;return c.map((z,i)=>z-k*a[i]);});
  const A=dot(v[0],v[0]),B=dot(v[0],v[1]),C=dot(v[1],v[1]),eig=eigen2(A,B,C),det=A*C-B*B;
  const condition=eig.lo>eig.hi*1e-14?Math.sqrt(eig.hi/eig.lo):Infinity;
  const dof=problem.records.length-3,scale=problem.weighting==='ols'?Math.max(1e-12,solution.cost/dof):1;
  const covariance=det>0&&Number.isFinite(condition)?[[scale*C/det,-scale*B/det],[-scale*B/det,scale*A/det]]:null;
  const geo=geometry(solution.x,problem.center),g=geo.g,ng=norm(g),normal=ng>1e-8?g.map(z=>z/ng):null;
  const radius95=covariance?Math.sqrt(5.991*eigen2(covariance[0][0],covariance[0][1],covariance[1][1]).hi):Infinity;
  const reducedChi2=solution.cost/dof;
  const scaled=cols.map(c=>c.map(z=>z/Math.max(norm(c),1e-20)));
  const H=scaled.map(c=>scaled.map(d=>dot(c,d)));
  // Full 3-column conditioning diagnostic from small symmetric Jacobi eigensolver.
  for(let it=0;it<24;it++){
    let p=0,q=1;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(H[i][j])>Math.abs(H[p][q])){p=i;q=j;}
    if(Math.abs(H[p][q])<1e-14)break;
    const theta=0.5*Math.atan2(2*H[p][q],H[q][q]-H[p][p]),c=Math.cos(theta),s=Math.sin(theta);
    const app=H[p][p],aqq=H[q][q],apq=H[p][q];
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const x=H[k][p],y=H[k][q];H[k][p]=H[p][k]=c*x-s*y;H[k][q]=H[q][k]=s*x+c*y;}
    H[p][p]=c*c*app-2*c*s*apq+s*s*aqq;H[q][q]=s*s*app+2*c*s*apq+c*c*aqq;H[p][q]=H[q][p]=0;
  }
  const fullEigen=H.map((r,i)=>r[i]),fullCondition=Math.min(...fullEigen)>1e-14?Math.sqrt(Math.max(...fullEigen)/Math.min(...fullEigen)):Infinity;
  return {covariance,normal,condition,fullCondition,radius95,reducedChi2};
}
// Data-only local quadratic range regression and center pose derivative.
function initializers(records,count=4){
  const mid=Math.floor(records.length/2),t0=records[mid].t,h=Math.max(...records.map(m=>Math.abs(m.t-t0)));
  const T=records.map(m=>[1,(m.t-t0)/h,((m.t-t0)/h)**2]),fit=leastSquares(T,records.map(m=>m.r)).x;
  const center=records[mid],vx=['tx','rx'].map(key=>['x','y'].map(dim=>leastSquares(T,records.map(m=>m[key][dim])).x[1]/h));
  const dx=center.rx.x-center.tx.x,dy=center.rx.y-center.tx.y,d=Math.hypot(dx,dy);
  if(!(fit[0]>d+1e-6))return [];
  const A=fit[0]/2,B=Math.sqrt(A*A-d*d/4),ex=d>1e-9?dx/d:1,ey=d>1e-9?dy/d:0;
  const at=theta=>[(center.tx.x+center.rx.x)/2+A*Math.cos(theta)*ex-B*Math.sin(theta)*ey,
    (center.tx.y+center.rx.y)/2+A*Math.cos(theta)*ey+B*Math.sin(theta)*ex];
  const f=theta=>{const geo=geometry(at(theta),center);return dot(geo.jp,[...vx[0],...vx[1]])-fit[1]/h;};
  const roots=[],N=96;for(let j=0;j<N;j++){
    let a=2*Math.PI*j/N,b=2*Math.PI*(j+1)/N,fa=f(a),fb=f(b);
    if(fa*fb>0)continue;
    for(let it=0;it<35;it++){const c=(a+b)/2,fc=f(c);if(fa*fc<=0){b=c;fb=fc;}else{a=c;fa=fc;}}
    roots.push((a+b)/2);
  }
  // Tangential roots / noisy range slope outside feasible interval: retain
  // local minima of slope mismatch ON the ellipse, never a spatial lattice.
  const samples=Array.from({length:N},(_,j)=>({theta:2*Math.PI*j/N,error:Math.abs(f(2*Math.PI*j/N))}));
  for(let j=0;j<N;j++)if(samples[j].error<=samples[(j+N-1)%N].error&&samples[j].error<=samples[(j+1)%N].error)roots.push(samples[j].theta);
  const seeds=[];
  for(const theta of roots.sort((a,b)=>Math.abs(f(a))-Math.abs(f(b)))){
    const x=at(theta);if(seeds.every(s=>Math.hypot(s[0]-x[0],s[1]-x[1])>0.25))seeds.push(x);
    if(seeds.length>=count)break;
  }return seeds;
}
function compare(records,options={}){
  const setup=now(),seeds=initializers(records,options.starts||4);if(!seeds.length)return {reason:'initialization',results:{}};
  // One reference selected from data-only OLS profile costs; common covariance.
  const provisional=prepare(records,seeds[0],{weighting:'ols'});
  seeds.sort((a,b)=>evaluate(provisional,a,true).cost-evaluate(provisional,b,true).cost);
  const problem=prepare(records,seeds[0],options);
  const initials=seeds.map(x=>[...x,evaluate(problem,x,true).beta]);
  const setupMs=now()-setup,results={};
  const order=['lm','tr','vp'];const offset=(options.order||0)%3;
  for(let k=0;k<3;k++){
    const method=order[(k+offset)%3],start=now(),all=initials.map(q=>solve(problem,q,method,options)).sort((a,b)=>a.cost-b.cost);
    const best=all[0],distinct=all.filter((v,i)=>i===0||Math.hypot(v.x[0]-best.x[0],v.x[1]-best.x[1])>0.5);
    const info=uncertainty(problem,best),delta=distinct[1]?distinct[1].cost-best.cost:Infinity;
    const comparableDelta=problem.weighting==='ols'?delta/Math.max(1e-10,best.cost/(records.length-3)):delta;
    const ambiguous=distinct.length>1&&comparableDelta<3.84;
    const residualOK=problem.weighting==='gls'?info.reducedChi2<=1+3*Math.sqrt(2/(records.length-3)):best.rmse<3*Math.max(options.rangeSigma||0,0.01);
    const accepted=best.converged&&!ambiguous&&info.condition<(options.maxCondition||1e4)&&info.radius95<(options.maxRadius||2)&&residualOK&&!!info.normal;
    results[method]={...best,...info,accepted,ambiguous,alternatives:distinct.slice(1).map(s=>({x:s.x,cost:s.cost})),
      starts:all.length,totalIterations:all.reduce((s,v)=>s+v.iterations,0),totalEvaluations:all.reduce((s,v)=>s+v.evaluations,0),
      ms:now()-start,t0:problem.t0,availableAt:records.at(-1).t,lag:records.at(-1).t-problem.t0,
      reason:!best.converged?best.status:ambiguous?'multiple_solutions':!Number.isFinite(info.condition)||info.condition>=(options.maxCondition||1e4)?'conditioning':info.radius95>=(options.maxRadius||2)?'uncertainty':!residualOK?'model_residual':'accepted'};
  }
  return {results,seeds:initials,t0:problem.t0,setupMs,centerKey:problem.center.key};
}
return {leastSquares,cholesky,whiten,geometry,prepare,evaluate,solve,uncertainty,initializers,compare,dot,norm,eigen2};
});
