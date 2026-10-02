import { generateScenario } from './scenario.mjs?v=20261002-layered28';
self.onmessage = async ({ data }) => {
  if (data.type !== 'generate') return;
  try {
    const scenario = await generateScenario(data.input, (t, total) => self.postMessage({ type: 'progress', t, total }));
    self.postMessage({ type: 'scenario', requestId: data.requestId, scenario });
  } catch (error) { self.postMessage({ type: 'error', requestId: data.requestId, message: error.message }); }
};
