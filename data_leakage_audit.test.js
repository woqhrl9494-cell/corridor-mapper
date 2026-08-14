'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('./index.html', 'utf8');
const estimatorSource = fs.readFileSync('./revised_wall_estimator.js', 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const sanitizer = functionBody(html, 'sanitizeEstimatorMeasurements');
const revisedAdapter = functionBody(html, 'updateRevisedEstimator');
const gridKernelBuilder = functionBody(html, 'makeEllipseComponents');
const simStep = functionBody(html, 'simStep');

for (const [name, body] of [
  ['sanitizeEstimatorMeasurements', sanitizer],
  ['updateRevisedEstimator', revisedAdapter],
  ['makeEllipseComponents', gridKernelBuilder],
]) {
  assert.doesNotMatch(body, /\bhit\b|\btopWall\b|\bbotWall\b|metricObservedMask|_cachedGTWallPts/, `${name} contains evaluator-only input`);
}

assert.match(sanitizer, /tx:\{x:meas\.tx\.x,y:meas\.tx\.y\}/);
assert.match(sanitizer, /rx:\{x:meas\.rx\.x,y:meas\.rx\.y\}/);
assert.match(sanitizer, /r:meas\.r/);
assert.match(revisedAdapter, /d:meas\.r/);
assert.match(simStep, /const estimatorMeas=sanitizeEstimatorMeasurements\(allMeas\)/);
assert.match(simStep, /updateRevisedEstimator\(estimatorMeas,shouldExtract\)/);
assert.doesNotMatch(simStep, /updateRevisedEstimator\(allMeas/);
assert.ok(simStep.indexOf('updateMetricObservation(allMeas)') > simStep.indexOf('updateRevisedEstimator(estimatorMeas,shouldExtract)'),
  'GT evaluator must run after estimator update');

// The standalone estimator must not know simulator GT/evaluator identifiers.
assert.doesNotMatch(estimatorSource, /\btopWall\b|\bbotWall\b|metricObservedMask|_cachedGTWallPts|\bfutureHit\b/);

console.log(JSON.stringify({
  summary: { passed: 1, failed: 0, total: 1 },
  checked: ['whitelist', 'Grid input', 'Revised input', 'execution order', 'standalone estimator isolation'],
}, null, 2));
