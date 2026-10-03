import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {runExperiment} from '../../drf/sweep.mjs';
import {generateScenario} from '../../drf/scenario.mjs';
import {createGrid,createField} from '../../drf/field.mjs';
import {createEvaluator} from '../../drf/evaluate.mjs';
const fixture=JSON.parse(readFileSync(new URL('./browser-fixtures.json',import.meta.url)));
const hash=arrays=>{const h=createHash('sha256');for(const a of arrays) h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');};
// Historical fixtures describe the original Outer-Peak diagnostic, not PSPT.
// Preserve every stored value while testing that the shared field stays unchanged.
async function runHistoricalBaseline(input) {
  const scene=await generateScenario(input),grid=createGrid(scene.input.grid,scene.input.grid,scene.domain),
    field=createField(grid,{band:scene.input.band,perimeter:scene.input.perimeter}),evaluator=createEvaluator(scene,grid);
  let frame,evaluation;
  for (const wire of scene.wire) {frame=field.step(wire);evaluation=evaluator.step(frame);}
  const d=evaluation.diagnostics;
  return {final:frame,summary:{medianError:evaluation.medianError,p95:evaluation.p95,offwall:evaluation.offwall,
    offset:evaluation.offset,f1:evaluation.f1,caMsd:evaluation.caMsd,caHd95:evaluation.caHd95,
    observedFraction:evaluation.observedFraction,missing:evaluation.missing,
    diffusePerConfig:d.diffusePerConfig,duplicateFraction:d.duplicateFraction,theoremMean:d.theoremMean,
    theoremMedian:d.theoremMedian,theoremN:d.ratios.length,theoremNegative:d.theoremNegative,
    Q:frame.Q,admitted:frame.admitted,rejected:frame.rejected}};
}
for (const c of fixture.cases) test(`historical DRF browser fixture remains reproducible: ${c.id}`,async () => {
  const result=await runHistoricalBaseline(c.input);
  assert.equal(hash([result.final.Dbar]),c.expected.Dbar);
  assert.equal(hash([result.final.betaHat]),c.expected.betaHat);
  assert.equal(hash([result.final.Dbar,result.final.betaHat]),c.expected.combined);
  let strictEqual=true,maxAbsError=0;const differences=[];
  for (const [key,reference] of Object.entries(c.expected.summary)) {
    const actual=result.summary[key];
    if (Object.is(actual,reference)) continue;
    strictEqual=false;
    if (fixture.comparison.exactSummaryKeys.includes(key) || !Number.isFinite(actual) || !Number.isFinite(reference)) assert.equal(actual,reference,`${c.id}: exact ${key}`);
    const absoluteError=Math.abs(actual-reference),tolerance=fixture.comparison.summaryTolerance*Math.max(1,Math.abs(reference));
    maxAbsError=Math.max(maxAbsError,absoluteError);differences.push({key,actual,reference,absoluteError,tolerance});
    assert.ok(absoluteError<=tolerance,`${c.id}: ${key}: ${absoluteError} > ${tolerance}`);
  }
  console.log(JSON.stringify({id:c.id,fieldsStrictEqual:true,strictEqual,maxAbsError,differences}));
});
test('production PSPT preserves the historical field bytes without substituting its metrics',async()=>{
  const c=fixture.cases.find(c=>c.input.snapshots===3&&c.input.roughness>0),result=await runExperiment(c.input);
  assert.equal(result.method,'guarded45');
  assert.equal(hash([result.final.Dbar,result.final.betaHat]),c.expected.combined);
  assert.ok(Object.hasOwn(result.summary,'firstSupportPrecision'));
  assert.equal(result.summary.caMsd,null,'The old metric is diagnostic only under PSPT');
});
test('actual browser comparison permits Float64 roundoff and rejects count changes',()=>{
  const html=readFileSync(new URL('./browser-check.html',import.meta.url),'utf8'),start=html.indexOf('function compareSummary('),end=html.indexOf('button.onclick=',start);
  assert.ok(start>=0 && end>start);const context=vm.createContext({});vm.runInContext(html.slice(start,end),context);
  const reference={theoremMean:1.117256737223717,Q:100},a={...reference,theoremMean:1.1172567372237157},c=fixture.comparison;
  const roundoff=context.compareSummary(a,reference,c);assert.equal(roundoff.passed,true);assert.equal(roundoff.strictEqual,false);assert.ok(roundoff.maxAbsError>0&&roundoff.maxAbsError<2e-15);
  assert.equal(context.compareSummary({...reference,theoremMean:reference.theoremMean+1e-8},reference,c).passed,false);
  assert.equal(context.compareSummary({...reference,Q:101},reference,c).passed,false);
  assert.equal(context.compareSummary({theoremMean:0},{theoremMean:null},c).passed,false);
});
