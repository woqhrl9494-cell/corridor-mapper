/** Evaluation only, called after inference. Never imported by an estimator worker.
 * O(W(R+P)) time, O(W+R+P) storage for W wall, R truth and P output points.
 * Same frozen definitions: observed wall radius .12 m, coverage tolerance .2 m.
 */
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
export function observedRegion(evaluation) {
  const hits = evaluation.truth.map((t) => t.hit);
  return evaluation.wall.filter((p) => hits.some((q) => d2(p, q) <= 0.12 ** 2));
}
export function evaluatePoints(
  predictions,
  evaluation,
  region = observedRegion(evaluation),
) {
  const truth = new Map(evaluation.truth.map((t) => [t.key, t]));
  const valid = predictions.filter((p) => p.valid && truth.has(p.key));
  let contact = 0,
    normal = 0;
  for (const p of valid) {
    const t = truth.get(p.key);
    contact += d2(p.x, t.hit);
    const dot = Math.abs(p.normal[0] * t.normal[0] + p.normal[1] * t.normal[1]);
    normal +=
      ((Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI) ** 2;
  }
  return {
    count: valid.length,
    requested: predictions.length,
    contact_rmse_m: valid.length ? Math.sqrt(contact / valid.length) : null,
    normal_rmse_deg: valid.length ? Math.sqrt(normal / valid.length) : null,
    observed_coverage: region.length
      ? region.filter((q) => valid.some((p) => d2(p.x, q) <= 0.2 ** 2)).length /
        region.length
      : 0,
  };
}
export function evaluateResult(result, evaluation) {
  const region = observedRegion(evaluation);
  return {
    surf: evaluatePoints(result.predictions, evaluation, region),
    cross: evaluatePoints(result.cross.predictions, evaluation, region),
  };
}
