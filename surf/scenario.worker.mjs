import "./environment.js";
import { generateScenario } from "./scenario.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      scene: generateScenario(globalThis.SimpleCurveEnvironment, data.config),
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
