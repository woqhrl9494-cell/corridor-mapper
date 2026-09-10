/** Explicit wire boundary: truth, scene shape, seeds and evaluation never cross. */
export function estimatorInput(raw, targets) {
  const cutoff = Number(raw.cutoff_s);
  if (!Number.isFinite(cutoff) || cutoff !== 12)
    throw Error("12초 관측 기록이 필요합니다.");
  const records = raw.records
    .filter((r) => r.t <= cutoff)
    .map((r) => ({
      key: r.key,
      i: r.i,
      j: r.j,
      t: r.t,
      r: r.r,
      sigma: r.sigma,
      tx: { x: r.tx.x, y: r.tx.y },
      rx: { x: r.rx.x, y: r.rx.y },
    }));
  if (
    !records.length ||
    records.some(
      (r) => ![r.t, r.r, r.tx.x, r.tx.y, r.rx.x, r.rx.y].every(Number.isFinite),
    )
  )
    throw Error("유효하지 않은 관측값입니다.");
  return {
    raw: {
      records,
      range_sigma_m: raw.range_sigma_m,
      cutoff_s: cutoff,
      dt_s: 0.05,
      pairs: raw.pairs.map((p) => [...p]),
    },
    targets: targets
      .filter((t) => t.source_available_at_s <= cutoff)
      .map((t) => ({
        target_id: t.target_id,
        measurement_id: t.measurement_id,
        key: t.key,
        pair: [...t.pair],
        center_frame: t.center_frame,
        time_s: t.time_s,
        window_end_frame: t.window_end_frame,
        source_available_at_s: t.source_available_at_s,
        information_cutoff_s: cutoff,
      })),
  };
}
