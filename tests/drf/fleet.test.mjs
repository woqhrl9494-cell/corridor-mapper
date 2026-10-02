import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario, generateSnapshot, normalizeInput, truePoses } from '../../drf/scenario.mjs';
import { createWalls, evaluate } from '../../drf/wall.mjs';
import { createGrid, createField } from '../../drf/field.mjs';

test('vehicle limits and fixed trajectories support 2–20 vehicles without moving the common prefix',()=>{
  for (let vehicles=2;vehicles<=20;vehicles++) assert.equal(normalizeInput({vehicles}).vehicles,vehicles);
  assert.equal(normalizeInput({vehicles:'20'}).vehicles,20);
  for (const vehicles of [-1,0,1,2.5,20.5,21,NaN,Infinity,'twenty'])
    assert.throws(()=>normalizeInput({vehicles}),/vehicles|trajectories/);
  const spans=createWalls();
  for (let t=1;t<=60;t++) {
    const fleet=truePoses(t,20);
    assert.equal(fleet.length,20);
    const legacy=[4,7,10].map((x0,v)=>{
      const x=x0+.75*t;
      return [x,15+2*Math.sin(2*Math.PI*x/30+v+1)];
    });
    assert.deepEqual(fleet.slice(0,3),legacy,'Original three trajectories must retain their exact numbers');
    for (const count of [2,5,19]) assert.deepEqual(truePoses(t,count),fleet.slice(0,count));
    for (const [x,y] of fleet) {
      assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=60);
      const wallY=wall=>{
        const span=spans.find(s=>s.wall===wall&&x>=s.C[0][0]&&x<=s.C[0][0]+s.h);
        assert.ok(span,'Every supported position must lie on a wall span x interval');
        return evaluate(span,(x-span.C[0][0])/span.h).s[1];
      };
      assert.ok(y>wallY(0)&&y<wallY(1),'True vehicles must remain inside the reference walls');
    }
  }
});

test('actual twenty-vehicle snapshot has 190 pairs, shares poses, preserves old pair measurements and reaches the field',async()=>{
  const input={snapshots:1,grid:100,seed:1},fleet=await generateScenario({...input,vehicles:20});
  const truth=fleet.truth[0],wire=fleet.wire[0],ids=new Set(),poses=new Map();
  assert.equal(truth.p.length,20);assert.equal(truth.poseNoise.length,20);
  assert.equal(truth.configs.length,190);assert.equal(wire.configs.length,190);
  for (const [k,config] of wire.configs.entries()) {
    const {i,j,pHat_i,pHat_j,Sigma_i,Sigma_j,paths}=config;
    assert.ok(Number.isInteger(i)&&Number.isInteger(j)&&i>=1&&i<j&&j<=20);
    assert.ok(!ids.has(`${i}:${j}`),'Bistatic pairs must be unique');ids.add(`${i}:${j}`);
    assert.equal(truth.configs[k].i,i);assert.equal(truth.configs[k].j,j);
    for (const [id,pose,covariance] of [[i,pHat_i,Sigma_i],[j,pHat_j,Sigma_j]]) {
      assert.equal(pose.length,2);assert.ok(pose.every(Number.isFinite));
      assert.equal(covariance.length,3);assert.ok(covariance.every(Number.isFinite));
      if (poses.has(id)) assert.deepEqual(pose,poses.get(id),'One noisy pose per vehicle must be reused by every pair');
      else poses.set(id,pose);
    }
    assert.ok(paths.every(p=>Number.isFinite(p.dHat)&&p.sigmaD===fleet.input.sigmaD));
  }
  assert.equal(ids.size,190);assert.equal(poses.size,20);
  const longer=generateSnapshot(normalizeInput({...fleet.input,snapshots:60}),fleet.spans,1);
  assert.deepEqual(longer,{truth,wire},'Requested future snapshots must not change the twenty-vehicle first snapshot');
  for (const vehicles of [3,5]) {
    const smaller=await generateScenario({...input,vehicles}),prefix=configs=>configs.filter(c=>c.j<=vehicles);
    assert.deepEqual(truth.p.slice(0,vehicles),smaller.truth[0].p);
    assert.deepEqual(truth.poseNoise.slice(0,vehicles),smaller.truth[0].poseNoise);
    assert.deepEqual(prefix(truth.configs),smaller.truth[0].configs,'Changing fleet size must not change common pair truth');
    assert.deepEqual(prefix(wire.configs),smaller.wire[0].configs,'Changing fleet size must not change common pair wire');
  }
  const frame=createField(createGrid(100,100)).step(wire);
  assert.equal(frame.t,1);assert.equal(frame.Dbar.length,10000);assert.equal(frame.betaHat.length,10000);
  assert.ok(frame.Dbar.every(v=>Number.isFinite(v)&&v>=0));
  assert.ok(frame.betaHat.every(v=>Number.isFinite(v)&&v>=0&&v<=1+1e-7));
  assert.ok(frame.Q>0);assert.equal(frame.Q,frame.admitted);
  assert.equal(frame.admitted+frame.rejected,wire.configs.reduce((n,c)=>n+c.paths.length,0));
});
