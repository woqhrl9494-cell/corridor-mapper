import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../drf/rng.mjs';
import { createWalls, makeSpan, wallCells } from '../../drf/wall.mjs';
import { diffuseProfile, sampleDiffuse } from '../../drf/diffuse.mjs';
import { facetSinDelta, visible } from '../../drf/specular.mjs';
import { DEFAULT_INPUT, generateScenario, generateSnapshot, normalizeInput, truePoses } from '../../drf/scenario.mjs';

const radians=degrees=>degrees*Math.PI/180;
const flat=(y=0,wall=0,span=1)=>makeSpan([[-60,y],[120,0],[0,0],[0,0]],span,wall,true);
const sum=values=>values.reduce((total,value)=>total+value,0);
const measuredData=scene=>({truth:scene.truth,wire:scene.wire});
const numericBits=value=>{
  const numbers=[];
  JSON.stringify(value,(_key,item)=>{if (typeof item==='number') numbers.push(item);return item;});
  return Buffer.from(Float64Array.from(numbers).buffer);
};
const bitEqual=(actual,expected,message)=>{
  assert.deepEqual(actual,expected,message);
  assert.ok(numericBits(actual).equals(numericBits(expected)),`${message}: Float64 bits`);
};
const input={...DEFAULT_INPUT,snapshots:3,seed:73};
let baseline;
const reference=()=>baseline ??= generateScenario(input);

test('fixed geometry midpoints approximate but do not move to a continuous reflection root', () => {
  const spans=[flat()],pT=[-3,4],pR=[5,3],root=(pR[0]*pT[1]+pT[0]*pR[1])/(pT[1]+pR[1]);
  assert.ok(Math.abs(facetSinDelta([120,0],[root,0],pT,pR))<1e-15,'the mirror-image root satisfies the continuous angle condition');
  for (const step of [.04,.02,.01]) {
    const cells=wallCells(spans,step),nearest=cells.reduce((best,cell)=>Math.abs(cell.s[0]-root)<Math.abs(best.s[0]-root) ? cell : best);
    const distance=Math.abs(nearest.s[0]-root);
    // Nearest-cell error is bounded by half a cell; grid alignment need not make it monotone.
    assert.ok(distance>1e-8 && distance<=step/2+1e-11);
    assert.ok(Math.abs(facetSinDelta(nearest.t,nearest.s,pT,pR))>1e-9,'finite midpoints need not satisfy the exact-root condition');
    const index=cells.indexOf(nearest),expected=-60+(index+.5)*120/cells.length;
    const roundoff=8*Number.EPSILON*120*cells.length;
    assert.ok(Math.abs(nearest.s[0]-expected)<=roundoff,'cell locations must remain geometry-only equal-arc midpoints within cumulative rounding error');
  }
});

test('actual flat and curved profiles have Poisson pre-thinning moments and the flat categorical CDF', () => {
  const flatSpans=[flat()],pT=[-3,4],pR=[5,3];
  const flatProfile=diffuseProfile(flatSpans,pT,pR,radians(5),30,.02);
  const curvedSpans=createWalls(),poses=truePoses(30);
  const curvedProfile=diffuseProfile(curvedSpans,poses[0],poses[2],radians(2),.3,.02);
  const cases=[{name:'flat',spans:flatSpans,pT,pR,profile:flatProfile,wall:0},
    ...[0,1].map(wall=>({name:`curved wall ${wall}`,spans:curvedSpans,pT:poses[0],pR:poses[2],profile:curvedProfile,wall}))];
  const repeats=1200;
  for (const fixture of cases) {
    const cells=fixture.profile.cells.filter(cell=>cell.wall===fixture.wall),profile={cells},mu=sum(cells.map(cell=>cell.lambda));
    assert.ok(mu>0);
    assert.ok(Math.abs(mu-fixture.profile.lambdaTotal[fixture.wall])<1e-12*Math.max(1,mu));
    if (fixture.name==='flat') assert.ok(mu>30,'the actual flat profile exercises summed Knuth Poisson draws');
    let total=0,totalSquared=0,retained=0;
    const quartiles=[0,0,0,0],cdf=[];
    if (fixture.name==='flat') for (const cell of cells) cdf.push((cdf.at(-1)??0)+cell.lambda);
    for (let seed=0;seed<repeats;seed++) {
      const diagnostics={},points=sampleDiffuse(fixture.spans,fixture.pT,fixture.pR,profile,
        createRng(seed,'truth-model-moments',fixture.name),diagnostics),count=diagnostics.generated;
      assert.ok(Number.isInteger(count) && count>=points.length,'pre-thinning count must include every retained sample');
      total+=count;totalSquared+=count*count;
      if (fixture.name==='flat') {
        assert.equal(points.length,count,'both legs above one flat wall require no thinning');
        for (const point of points) {
          let lo=0,hi=cells.length-1;
          while (lo<hi) {const mid=(lo+hi)>>>1;if (point.u<cells[mid].u+cells[mid].du/2) hi=mid;else lo=mid+1;}
          const cell=cells[lo],fraction=(point.u-cell.u+cell.du/2)/cell.du;
          assert.ok(fraction>=-1e-10 && fraction<=1+1e-10);
          const quantile=((lo ? cdf[lo-1] : 0)+cell.lambda*fraction)/mu;
          quartiles[Math.max(0,Math.min(3,Math.floor(quantile*4)))]++;retained++;
        }
      }
    }
    const mean=total/repeats,variance=(totalSquared-total*total/repeats)/(repeats-1);
    // For Poisson(mu): Var(mean)=mu/n and Var(unbiased sample variance)=mu/n+2*mu^2/(n-1).
    assert.ok(Math.abs(mean-mu)<=6*Math.sqrt(mu/repeats),`${fixture.name}: Poisson mean`);
    assert.ok(Math.abs(variance-mu)<=6*Math.sqrt(mu/repeats+2*mu*mu/(repeats-1)),`${fixture.name}: Poisson variance`);
    if (fixture.name==='flat') for (const count of quartiles)
      assert.ok(Math.abs(count/retained-.25)<=6*Math.sqrt(.25*.75/retained),'categorical mass and within-cell uniform location must yield a uniform CDF');
  }
});

test('retained curved-wall samples lie on the power-basis wall and satisfy both physical legs', async () => {
  const scene=await reference(),bySpan=new Map(scene.spans.map(span=>[span.span,span]));
  let retained=0;
  for (const snapshot of scene.truth) for (const config of snapshot.configs) {
    const pT=snapshot.p[config.i-1],pR=snapshot.p[config.j-1];
    for (const point of config.diffuse) {
      const span=bySpan.get(point.span);
      assert.equal(point.wall,span.wall);assert.ok(point.u>=0 && point.u<=1);
      // Independent power sum, rather than the producer's Horner evaluator.
      const position=[0,1].map(axis=>span.C.reduce((value,coefficient,k)=>value+coefficient[axis]*point.u**k,0));
      const tangent=[0,1].map(axis=>span.C.slice(1).reduce((value,coefficient,k)=>value+(k+1)*coefficient[axis]*point.u**k,0));
      assert.ok(Math.hypot(point.s[0]-position[0],point.s[1]-position[1])<1e-11,'no displacement away from the spline wall');
      const side=p=>tangent[0]*(point.s[1]-p[1])-tangent[1]*(point.s[0]-p[0]);
      assert.ok(side(pT)*side(pR)>0,'both vehicle legs must lie on the same tangent side');
      assert.ok(visible(scene.spans,pT,point.s) && visible(scene.spans,pR,point.s));
      retained++;
    }
    assert.equal(sum(config.diffuseSampling.afterThinning),config.generated.diffuse);
    assert.deepEqual(config.diffuseSampling.afterThinning,[0,1].map(wall=>config.diffuse.filter(point=>point.wall===wall).length));
    assert.ok(config.diffuseSampling.beforeThinning.every((count,wall)=>count>=config.diffuseSampling.afterThinning[wall]));
  }
  assert.ok(retained>0,'the geometric assertions must exercise actual samples');
});

test('an intervening flat wall removes every lower-wall sample without erasing the generated count', () => {
  const spans=[flat(0,0,1),flat(2,1,2)],pT=[-3,4],pR=[5,3];
  const full=diffuseProfile(spans,pT,pR,radians(5),30,.02),profile={cells:full.cells.filter(cell=>cell.wall===0)};
  let generated=0;
  for (let seed=0;seed<20;seed++) {
    const diagnostics={},points=sampleDiffuse(spans,pT,pR,profile,createRng(seed,'truth-model-occlusion'),diagnostics);
    // Every segment from y>2 to y=0 crosses y=2 at an interior point of this 120 m wall.
    assert.equal(points.length,0);generated+=diagnostics.generated;
  }
  assert.ok(generated>0,'visibility rejection must be exercised before counting survivors');
});

test('same settings repeat all truth and wire bits; longer runs preserve their common prefix', async () => {
  const first=await reference(),repeat=await generateScenario(input),longer=await generateScenario({...input,snapshots:5});
  bitEqual(measuredData(repeat),measuredData(first),'complete truth and wire must repeat');
  bitEqual({truth:longer.truth.slice(0,3),wire:longer.wire.slice(0,3)},measuredData(first),'future snapshots cannot change the common prefix');
});

test('standalone snapshots ignore call order and estimator-only settings', async () => {
  const scene=await reference(),base=normalizeInput(input);
  for (const t of [3,1,2,1]) bitEqual(generateSnapshot(base,scene.spans,t),{truth:scene.truth[t-1],wire:scene.wire[t-1]},`snapshot ${t} cannot inherit another snapshot's RNG state`);
  const changed=await generateScenario({...input,grid:200,band:'full',perimeter:'ramanujan'});
  bitEqual(measuredData(changed),measuredData(scene),'grid, band and perimeter cannot affect truth-side measurements');
});

test('zero roughness and zero intensity create no diffuse path, pre-thinning draw, or RNG consumption', async () => {
  const spans=createWalls(),poses=truePoses(1),noDraw={poisson(){assert.fail('zero intensity cannot draw a Poisson count');},uniform(){assert.fail('zero intensity cannot draw a location');}};
  for (const [roughness,lambda0] of [[0,10],[2,0]]) {
    const profile=diffuseProfile(spans,poses[0],poses[1],radians(roughness),lambda0,.02),diagnostics={generated:99};
    assert.deepEqual(profile.cells,[]);assert.deepEqual(profile.lambdaTotal,[0,0]);
    assert.deepEqual(sampleDiffuse(spans,poses[0],poses[1],profile,noDraw,diagnostics),[]);
    assert.equal(diagnostics.generated,0,'zero total must overwrite a stale diagnostic');
    const scene=await generateScenario({...input,snapshots:2,roughness,lambda0});
    for (const snapshot of scene.truth) for (let c=0;c<snapshot.configs.length;c++) {
      const config=snapshot.configs[c];
      assert.deepEqual(config.diffuse,[]);assert.deepEqual(config.lambdaTotal,[0,0]);
      assert.deepEqual(config.diffuseSampling,{beforeThinning:[0,0],afterThinning:[0,0]});
      assert.equal(config.generated.diffuse,0);
      assert.equal(scene.wire[snapshot.t-1].configs[c].paths.length,config.specular.length);
    }
  }
});
