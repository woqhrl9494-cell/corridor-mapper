/* Forward model only. Metres, seconds, Float64. No estimator imports.
 * Smooth graph q(s)=[s,f(s)]. Specular paths solve d/ds (|q-pi|+|q-pj|)=0.
 * Finite endpoints are not specular paths. O(B^2 Nscan) per frame.
 * Observation and evaluation objects are deliberately separate.
 */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.SimpleCurveEnvironment=api;})(globalThis,()=>{
'use strict';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1],dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function rng(seed){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
const normal=r=>Math.sqrt(-2*Math.log(Math.max(r(),1e-15)))*Math.cos(2*Math.PI*r());
function curve(shape){
 if(shape==='arc')return {domain:[-13,13],f:x=>26-Math.sqrt(18**2-x*x),df:x=>x/Math.sqrt(18**2-x*x),ddf:x=>18**2/(18**2-x*x)**1.5};
 if(shape==='sine')return {domain:[-13,13],f:x=>8+.8*Math.sin(x/4),df:x=>.2*Math.cos(x/4),ddf:x=>-.05*Math.sin(x/4)};
 throw Error('Unknown curve');
}
function reflection(c,pi,pj,nodes=128){
 const value=x=>{const q=[x,c.f(x)],t=[1,c.df(x)],a=q.map((v,k)=>v-pi[k]),b=q.map((v,k)=>v-pj[k]),da=Math.hypot(...a),db=Math.hypot(...b);return {q,g:dot(a,t)/da+dot(b,t)/db,r:da+db};};
 const [lo,hi]=c.domain,roots=[];let a=lo,va=value(a);
 for(let k=1;k<=nodes;k++){const b=lo+(hi-lo)*k/nodes,vb=value(b);if(va.g*vb.g<0||va.g===0){let l=a,h=b,gl=va.g;for(let j=0;j<48;j++){const m=(l+h)/2,gm=value(m).g;if(gl*gm<=0)h=m;else{l=m;gl=gm;}}const v=value((l+h)/2);if(roots.every(w=>dist(v.q,w.q)>1e-7))roots.push(v);}a=b;va=vb;}
 return roots.filter(v=>{
  const n=[-c.df(v.q[0]),1],scale=Math.hypot(...n);v.normal=n.map(z=>z/scale);
  const ei=v.q.map((z,k)=>(z-pi[k])/dist(v.q,pi)),ej=v.q.map((z,k)=>(z-pj[k])/dist(v.q,pj));
  v.residual=Math.abs((ei[0]+ej[0])*v.normal[1]-(ei[1]+ej[1])*v.normal[0]);
  if(dot(ei,v.normal)<=0||dot(ej,v.normal)<=0)return false;
  // Visibility check on the two open ray segments, independent of inverse model.
  for(const p of [pi,pj])for(let k=1;k<128;k++){const u=k/128,x=p[0]+u*(v.q[0]-p[0]),y=p[1]+u*(v.q[1]-p[1]);if(x>=lo&&x<=hi&&y>=c.f(x)-1e-10)return false;}
  return v.residual<1e-9;
 });
}
function create(options={}){
 const cfg={shape:'arc',nBots:5,seed:101,rangeSigma:0,poseSigma:0,dt:.05,motion:'diverse',...options},c=curve(cfg.shape),motionRng=rng(cfg.seed),noise=rng(cfg.seed^0x72c3a9);
 const bots=Array.from({length:cfg.nBots},(_,i)=>({dx:.85*(i-(cfg.nBots-1)/2)+.2*(motionRng()-.5),y:-1.5+3.4*i/(cfg.nBots-1),phase:motionRng()*6.2831853}));
 const bias=bots.map(()=>[normal(noise)*cfg.poseSigma,normal(noise)*cfg.poseSigma]);let frame=0;
 function positions(t){return bots.map(b=>cfg.motion==='symmetric'?[-9+1.5*t+b.dx,0]:[-9+1.5*t+b.dx+.35*Math.sin(.37*t+b.phase),b.y+.45*Math.sin(.6*t+b.phase)]);}
 function step(){const t=++frame*cfg.dt,p=positions(t),observations=[],truth=[],counts={missing:0,multiple:0};
  for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
   const paths=reflection(c,p[i],p[j]);if(paths.length!==1){counts[paths.length?'multiple':'missing']++;continue;}
   const path=paths[0],key=`${frame}:${i}:${j}`;
   observations.push({key,i,j,t,r:path.r+cfg.rangeSigma*normal(noise),sigma:cfg.rangeSigma,tx:{x:p[i][0]+bias[i][0],y:p[i][1]+bias[i][1]},rx:{x:p[j][0]+bias[j][0],y:p[j][1]+bias[j][1]}});
   truth.push({key,t,i,j,hit:path.q,normal:path.normal,range:path.r,residual:path.residual});
  }
  return {t,frame,observations,evaluation:{truth,positions:p,counts}};
 }
 return {step,curve:c,config:cfg};
}
return {curve,reflection,create,rng,normal,dist};
});
