import { createPSPTEvaluator } from './pspt-evaluate.mjs';
import { diffuseProfile } from './diffuse.mjs';
let evaluator, scenario;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') { scenario = data.scenario; evaluator = createPSPTEvaluator(scenario, data.grid); self.postMessage({ type: 'initialized', requestId: data.requestId }); }
    if (data.type === 'evaluate') self.postMessage({ type: 'evaluation', requestId: data.requestId, evaluation: evaluator.step(data.frame) });
    if (data.type === 'profile') {
      const snapshot = scenario.truth[data.t - 1], config = snapshot.configs[data.configIndex];
      const profile = diffuseProfile(scenario.spans, snapshot.p[config.i - 1], snapshot.p[config.j - 1], scenario.input.roughness * Math.PI / 180, scenario.input.lambda0, scenario.input.cellStep);
      self.postMessage({ type: 'profile', requestId: data.requestId, profile });
    }
  } catch (error) { self.postMessage({ type: 'error', requestId: data.requestId, message: error.message }); }
};
