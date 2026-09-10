/** Physical simulation adapter. It never imports an inverse estimator.
 * SI units, 240 frames, 20 Hz; targets fixed before any observation is generated.
 */
export const MODES = ["arc", "sine", "symmetric"];
export function scenarioConfig(input = {}) {
  const mode = MODES.includes(input.mode) ? input.mode : "arc";
  const symmetric = mode === "symmetric";
  const config = {
    mode,
    shape: symmetric ? "arc" : mode,
    nBots: symmetric ? 5 : Number(input.nBots ?? 5),
    rangeSigma: symmetric ? 0 : Number(input.rangeSigma ?? 0),
    seed: symmetric ? 92004 : Number(input.seed ?? 3311001),
    poseSigma: 0,
    motion: symmetric ? "symmetric" : "diverse",
    dt: 0.05,
  };
  if (
    ![4, 5].includes(config.nBots) ||
    ![0, 0.01, 0.05].includes(config.rangeSigma) ||
    (!symmetric && ![3311001, 3311002].includes(config.seed))
  )
    throw Error("이 화면은 동결된 개발 조건만 지원합니다.");
  return config;
}
export function wallSamples(Env, c) {
  const dense = Array.from({ length: 10001 }, (_, i) => {
      const x = c.domain[0] + ((c.domain[1] - c.domain[0]) * i) / 10000;
      return [x, c.f(x)];
    }),
    s = [0];
  for (let i = 1; i < dense.length; i++)
    s.push(s.at(-1) + Env.dist(dense[i], dense[i - 1]));
  let j = 1;
  const n = Math.ceil(s.at(-1) / 0.02);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (s.at(-1) * i) / n;
    while (j < s.length - 1 && s[j] < t) j++;
    const u = (t - s[j - 1]) / (s[j] - s[j - 1]);
    return dense[j].map((v, k) => dense[j - 1][k] + u * (v - dense[j - 1][k]));
  });
}
export function generateScenario(Env, input) {
  const config = scenarioConfig(input),
    env = Env.create(config),
    run = `${config.shape}_${config.nBots}_${config.rangeSigma}_${config.seed}`,
    pairs = [];
  for (let i = 0; i < config.nBots; i++)
    for (let j = i + 1; j < config.nBots; j++) pairs.push([i, j]);
  const targets = [];
  for (let end = 30; end <= 240; end += 10)
    for (const pair of pairs) {
      const center = end - 10,
        key = `${center}:${pair[0]}:${pair[1]}`;
      targets.push({
        target_id: `${run}/target/${key}`,
        measurement_id: `${run}/range/${key}`,
        key,
        pair,
        center_frame: center,
        time_s: center * 0.05,
        window_end_frame: end,
        source_available_at_s: end * 0.05,
        information_cutoff_s: 12,
      });
    }
  const frames = Array.from({ length: 240 }, () => env.step()),
    records = frames.flatMap((f) => f.observations),
    truth = frames.flatMap((f) => f.evaluation.truth),
    counts = { missing: 0, multiple: 0 };
  for (const f of frames)
    for (const k of Object.keys(counts)) counts[k] += f.evaluation.counts[k];
  const poses = new Map();
  for (const r of records)
    for (const [id, p] of [
      [r.i, r.tx],
      [r.j, r.rx],
    ])
      poses.set(`${r.t}:${id}`, {
        record_id: `${run}/pose/${Math.round(r.t / 0.05)}:${id}`,
        vehicle_id: id,
        time_s: r.t,
        available_at_s: r.t,
        position_m: [p.x, p.y],
      });
  return {
    config,
    raw: {
      run_id: run,
      records,
      poses: [...poses.values()],
      range_sigma_m: config.rangeSigma,
      cutoff_s: 12,
      dt_s: 0.05,
      pairs,
      availability_provenance:
        "synchronous simulator measurement contract, not measured transport latency",
    },
    targets,
    evaluation: {
      truth,
      wall: wallSamples(Env, env.curve),
      generator_counts: counts,
    },
  };
}
