/* Geometry-only root enumeration. Inputs: center Tx/Rx [m], velocities
 * [m/s], range [m], range rate [m/s]. No scene/truth dependencies.
 * Output: roots of F=rho and Ft=rhodot, or explicit degeneracy/failure.
 * Uniform angular scan plus bisection; also scan h' for tangential roots.
 * Complexity O(Npsi + K*log(1/tol)); memory O(Npsi+K). Float64.
 */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.RootGeometry=api;})(globalThis,()=>{
'use strict';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1],distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),TAU=2*Math.PI;
function enumerate({tx,rx,vtx,vrx,rho,rate},nodes=256){
  if(![...tx,...rx,...vtx,...vrx,rho,rate].every(Number.isFinite))return {roots:[],status:'invalid_input'};
  const dx=rx[0]-tx[0],dy=rx[1]-tx[1],d=Math.hypot(dx,dy),a=rho/2;
  if(!(rho>d+1e-9))return {roots:[],status:'degenerate_ellipse'};
  const b=Math.sqrt((rho-d)*(rho+d))/2,u=d>1e-12?[dx/d,dy/d]:[1,0],v=[-u[1],u[0]],c=tx.map((z,k)=>(z+rx[k])/2);
  const point=t=>c.map((z,k)=>z+a*Math.cos(t)*u[k]+b*Math.sin(t)*v[k]);
  function evaluate(t){
    const x=point(t),xp=u.map((z,k)=>-a*Math.sin(t)*z+b*Math.cos(t)*v[k]);let h=rate,dh=0;
    for(const [p,vel]of [[tx,vtx],[rx,vrx]]){const q=x.map((z,k)=>z-p[k]),r=Math.hypot(...q),e=q.map(z=>z/r);h+=dot(e,vel);dh+=(dot(xp,vel)-dot(e,vel)*dot(e,xp))/r;}
    return {h,dh,x};
  }
  const scale=Math.max(1,Math.hypot(...vtx)+Math.hypot(...vrx)+Math.abs(rate)),tol=1e-10*scale;
  function scan(N){
    const samples=Array.from({length:N+1},(_,j)=>evaluate(TAU*j/N));
    if(samples.every(s=>Math.abs(s.h)<tol&&Math.abs(s.dh)<tol))return {roots:[],status:'continuum',nodes:N};
    const angles=[];
    const add=t=>{const w=((t%TAU)+TAU)%TAU;if(angles.every(z=>Math.min(Math.abs(z-w),TAU-Math.abs(z-w))>1e-7))angles.push(w);};
    function bisect(lo,hi,field){let fl=evaluate(lo)[field];for(let k=0;k<55;k++){const mid=(lo+hi)/2,fm=evaluate(mid)[field];if(fl*fm<=0)hi=mid;else{lo=mid;fl=fm;}}return (lo+hi)/2;}
    for(let j=0;j<N;j++){
      const lo=TAU*j/N,hi=TAU*(j+1)/N,A=samples[j],B=samples[j+1];
      if(Math.abs(A.h)<tol)add(lo);
      if(A.h*B.h<0)add(bisect(lo,hi,'h'));
      if(A.dh*B.dh<0){const t=bisect(lo,hi,'dh');if(Math.abs(evaluate(t).h)<tol)add(t);}
    }
    const roots=angles.sort((a,b)=>a-b).map(psi=>({...evaluate(psi),psi}));
    return {roots,status:roots.length?'roots':'no_roots',nodes:N};
  }
  let result=scan(nodes);
  if(result.roots.length===1){const refined=scan(nodes*2);result={...refined,rescanned:true};}
  return {...result,rho,rate,ellipse:{center:c,a,b,u,v}};
}
return {enumerate,dot,distance};
});
