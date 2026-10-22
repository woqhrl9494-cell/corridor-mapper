/** Both methods consume identical causal wire; the display field is independent.
 * Fixed development thresholds from dev_lock.json (2026-10-20), not selected
 * using this scene. No LTT-certified threshold exists for either method.
 */
import { PSPT } from './pspt.mjs';
import { Baseline } from './baseline.mjs';
export const METHOD_PROTOCOL = Object.freeze({
  guarded: { name:'Guarded PSPT', threshold:6.4615384615384635, score:'current four-hypothesis marginal log-odds', grid:[100,100], calibrated:false },
  baseline: { name:'Fixed-fragment B', threshold:12, score:'maximum qualified Gaussian log-score through the current snapshot', grid:[100,100], calibrated:false },
});
const logadd = (a,b) => Math.max(a,b)+Math.log1p(Math.exp(-Math.abs(a-b)));
export function selectGuarded(estimator,rows=estimator.report()) {
  const groups=new Map(estimator.groups.map(g=>[g.gid,g]));
  return rows.map(r=>{
    const g=groups.get(r.gid),k=r.side,selectionLogit=logadd(g.L[k+1],g.L[3])-logadd(g.L[0],g.L[2-k]);
    const eligible=g.nobs>0 && g.qualified_active[k]>=2 && g.qualified_matched[k]>=2;
    return {...r,selectionLogit,eligible,originalStatus:r.status,
      status:eligible && selectionLogit>=METHOD_PROTOCOL.guarded.threshold ? 'supported' : r.status==='contradicted' ? 'contradicted' : 'pending'};
  });
}
export class MethodComparison {
  constructor(options={}) {this.guarded=new PSPT();this.baseline=new Baseline(options);}
  step(wire) {
    let start=performance.now();const guarded=selectGuarded(this.guarded,this.guarded.step(wire)),guardedMs=performance.now()-start;
    start=performance.now();const baseline=this.baseline.step(wire),baselineMs=performance.now()-start;
    return {guarded:{candidates:guarded,ms:guardedMs},baseline:{candidates:baseline,ms:baselineMs}};
  }
}
