'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Env=require('../echo_environment');
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const segment={ax:-10,ay:0,bx:10,by:0};

test('exact planar reflection agrees with image-source path length and reverses with Tx/Rx',()=>{
  const tx={x:-1,y:5},rx={x:1,y:5};
  const a=Env.specularOnSegment(tx,rx,segment),b=Env.specularOnSegment(rx,tx,segment);
  close(a.hit.x,0);close(a.hit.y,0);close(a.length,Math.sqrt(104));
  assert.deepEqual(a.hit,b.hit);assert.ok(a.residual<1e-14);
  // The audited old 25-step / cosine gate emitted x=0.1465 on this facet,
  // although its supporting-line reflection lies outside the finite facet.
  assert.equal(Env.specularOnSegment(tx,rx,{ax:.1,ay:0,bx:.2,by:0}),null);
});

test('analytic contact agrees with independent derivative bisection on 500 rotated facets',()=>{
  let seed=314159;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let k=0;k<500;k++){
    const angle=6.28*rng(),ux=Math.cos(angle),uy=Math.sin(angle),nx=-uy,ny=ux;
    const a={x:40*rng()-20,y:40*rng()-20},length=2+20*rng();
    const point=(s,h)=>({x:a.x+s*ux+h*nx,y:a.y+s*uy+h*ny});
    const tx=point(length*(.1+.8*rng()),.2+10*rng()),rx=point(length*(.1+.8*rng()),.2+10*rng());
    const b=point(length,0),seg={ax:a.x,ay:a.y,bx:b.x,by:b.y};
    const derivative=s=>{const p=point(s,0);return [tx,rx].reduce((v,q)=>v+((p.x-q.x)*ux+(p.y-q.y)*uy)/Math.hypot(p.x-q.x,p.y-q.y),0);};
    let lo=0,hi=length;
    assert.ok(derivative(lo)<0&&derivative(hi)>0);
    for(let j=0;j<70;j++){const mid=(lo+hi)/2;if(derivative(mid)<0)lo=mid;else hi=mid;}
    const expected=point((lo+hi)/2,0),r=Env.specularOnSegment(tx,rx,seg);
    assert.ok(r);close(r.hit.x,expected.x);close(r.hit.y,expected.y);
    close(derivative(r.u*length),0);
    const reversed=Env.specularOnSegment(tx,rx,{ax:b.x,ay:b.y,bx:a.x,by:a.y});
    close(reversed.hit.x,r.hit.x);close(reversed.hit.y,r.hit.y);
  }
});

test('nonreflecting, corner, grazing and degenerate geometry is not emitted',()=>{
  for(const [tx,rx,seg] of [
    [{x:0,y:1},{x:1,y:-1},segment],
    [{x:0,y:0},{x:1,y:1},segment],
    [{x:0,y:1},{x:0,y:2},{ax:0,ay:0,bx:1,by:0}],
    [{x:0,y:1},{x:0,y:2},{ax:0,ay:0,bx:0,by:0}],
    [{x:NaN,y:1},{x:0,y:2},segment]
  ])assert.equal(Env.specularOnSegment(tx,rx,seg),null);
  assert.ok(Env.specularOnSegment({x:-1,y:1e-6},{x:1,y:1e-6},segment));
});

test('visibility blocks vertices, collinear overlaps, and obstacles less than 5 cm from hit',()=>{
  const a={x:0,y:0},b={x:1,y:0};
  for(const s of [
    {ax:.5,ay:-1,bx:.5,by:1},
    {ax:.5,ay:0,bx:.5,by:1},
    {ax:.98,ay:-1,bx:.98,by:1},
    {ax:.2,ay:0,bx:.8,by:0},
    {ax:-1,ay:0,bx:2,by:0}
  ])assert.equal(Env.segmentBlocksLeg(a,b,s),true);
  for(const s of [
    {ax:1,ay:-1,bx:1,by:1},
    {ax:0,ay:0,bx:0,by:1},
    {ax:1.1,ay:0,bx:2,by:0},
    {ax:-1,ay:0,bx:0,by:0},
    {ax:0,ay:.1,bx:1,by:.1}
  ])assert.equal(Env.segmentBlocksLeg(a,b,s),false);
});

// Independent audit: derive the tangent from the physical facet containing
// the exported hit; never trust a solver's reported normal/residual.
function verifyReflection(m,segments){
  const p=m.specularHit||m.hit;
  const matches=segments.filter(s=>{
    const dx=s.bx-s.ax,dy=s.by-s.ay,l2=dx*dx+dy*dy;
    const u=((p.x-s.ax)*dx+(p.y-s.ay)*dy)/l2;
    return u>0&&u<1&&Math.hypot(p.x-s.ax-u*dx,p.y-s.ay-u*dy)<1e-9;
  });
  assert.equal(matches.length,1);
  const s=matches[0],len=Math.hypot(s.bx-s.ax,s.by-s.ay),ux=(s.bx-s.ax)/len,uy=(s.by-s.ay)/len;
  const d1=Math.hypot(p.x-m.tx.x,p.y-m.tx.y),d2=Math.hypot(p.x-m.rx.x,p.y-m.rx.y);
  const gx=(p.x-m.tx.x)/d1+(p.x-m.rx.x)/d2,gy=(p.y-m.tx.y)/d1+(p.y-m.rx.y)/d2;
  close(gx*ux+gy*uy,0,1e-10);
  if(!m.diffuse)close(m.r,d1+d2,1e-12);
}

test('Corridor/Torus emitted paths obey stationarity; diffuse paths retain a valid specular reference',()=>{
  let examined=0;
  for(const scenario of ['corridor','torus'])for(const seed of [7,31,42,87])for(const useDiffusePaths of [false,true]){
    const e=Env.create({scenario,seed,useDiffusePaths,nBots:4,noiseSigma:0,posSigma:.2});
    for(let k=0;k<15;k++){
      const f=e.step();assert.equal(f.truth.length,f.observations.length);
      assert.ok(f.reflection.maxResidual<=Env.REFLECTION_TOL);
      for(let j=0;j<f.truth.length;j++){
        verifyReflection(f.truth[j],e.segments);examined++;
        assert.deepEqual(Object.keys(f.observations[j]).sort(),['i','j','key','r','rx','sigma','t','tx']);
        close(f.observations[j].r,f.truth[j].r,0);
      }
    }
  }
  assert.ok(examined>1000,`Only ${examined} paths were checked`);
});
