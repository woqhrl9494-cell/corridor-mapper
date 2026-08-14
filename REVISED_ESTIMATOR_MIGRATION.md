# Revised wall estimator migration report

## A. 기존 구조

- `index.html`: 배포 저장소 `main`의 기존 A–E simulator를 기준으로 환경/trajectory 생성, Fermat 기반 synthetic reflection measurement, Grid Direct baseline, legacy ellipsoidal GM, raster derivative/score, evaluation metric을 포함
- `corridor_mapper_claude_gm.html`: 동일 revised module을 사용하는 로컬 확장 UI
- `simulatePair`: 실제 wall segment와 reflection point를 사용해 synthetic range를 생성하는 simulation-only 경계
- `makeEllipseComponents`, `applyWallGMUpdate`: path-level spread, forgetting, visitation normalization, tangent state, Gaussian merge를 포함한 legacy estimator
- `computeDensity`, `computeCoherence`, `buildPaperWallScoreMap`: raster smoothing, finite difference gradient/Hessian, global product score를 포함한 legacy terminal pipeline
- `render`, `renderAnalysis`, `updateWallMetrics`: estimator output 표시와 ground-truth evaluation

## B. Migration table

| Legacy component | Status | Revised replacement |
| --- | --- | --- |
| path-level sensitivity/spread coefficients | revised 경로에서 제거 | sample-wise residual Jacobian과 normal variance |
| soft feasibility/geometric clipping | revised 경로에서 제거 | `d > rho` nominal ellipse admission, rejected-path counter |
| uniform-angle ellipse samples | revised 경로에서 제거 | cumulative arc-length lookup/interpolation |
| carried tangent/covariance-derived normal | revised 경로에서 제거 | analytic ellipse normal, additive axial moment `O` |
| global GM merge | legacy option에만 유지 | per-cell kernel-to-mode assignment |
| fading/pruning by weight | legacy option에만 유지 | confirmed mode 무감쇠, stale unconfirmed mode 제거 |
| visitation normalization | legacy option에만 유지 | terminal amplitude `W/H` |
| global component cap | legacy option에만 유지 | `K_mode` per-cell deterministic capacity |
| `g A Psi / max` score | legacy option에만 유지 | mode-wise dimensionless `E, C, R, D` gates |
| Gaussian smoothing/finite difference Hessian | legacy option에만 유지 | continuous Gaussian analytic gradient/Hessian |
| single global dominant normal | revised 경로에서 제거 | stored seed mode별 compatible-neighbor query |
| simulator reflection point input | revised estimator에서 차단 | position/covariance/range/std만 전달 |

## C. 변경 파일

- `revised_wall_estimator.js`: revised causal estimator, local mode state, optional previous-snapshot visibility, analytic extraction, diagnostics
- `revised_wall_estimator.test.js`: specification과 evidence-dominance 회귀를 포함한 16개 deterministic validation
- `index.html`: 공개 GitHub Pages 저장소의 기존 `index.html`을 기준으로 revised estimator 기본 결선, legacy 선택 옵션, A–E 패널 유지, DPR-safe B/C rendering
- `corridor_mapper_claude_gm.html`: revised estimator 기본 결선, legacy 선택 옵션, diagnostics UI, DPR-safe canvas rendering
- `REVISED_ESTIMATOR_MIGRATION.md`: 구조, 수식 대응, 검증 결과, 남은 제한 기록

## D. 수식과 구현 대응

- nominal admission/ellipse/arc sampling: `_sampleEllipse`
- sample-wise `e_i`, `e_j`, `g`, analytic `n`, `t`: `_sampleEllipse`
- independent pose/range covariance propagation과 `sigma_perp`: `_sampleEllipse`
- `P = sigma_parallel^2 tt^T + sigma_perp^2 nn^T`: `_sampleEllipse`
- sufficient statistics `(W,H,s,Q,O,t_last)`: `_newMode`, `_addKernel`
- axial gate/Bhattacharyya assignment: `_assignKernel`
- per-cell score `zeta=(W/H) C min(1,H/H_conf)`: `_capacityScore`
- mode-specific continuous field/analytic derivatives: `evaluateModeField`
- dimensionless `E,C,R,D`와 continuous seed extraction: `extractGrid`
- previous-snapshot-only visibility: `_buildOcclusionMap`, `_rayOpticalDepth`

현재 simulator의 pose error는 vehicle별 independent isotropic covariance로 가정한다. `SigmaIJ`가 입력되면 2x2 cross-covariance 항을 포함한다. 전체 joint `Sigma_z` 입력 형식은 현재 UI에 존재하지 않는다.

## E. Validation report

실행 명령: `node revised_wall_estimator.test.js`

| Test | Result | Numerical result |
| --- | --- | --- |
| 1 nominal admission | PASS | admitted 1, rejected 2, rejected sample 0 |
| 2 uncertainty monotonicity | PASS | normal variance 0.0163 -> range 0.0566, pose 0.0610 |
| 3 zero-noise PD | PASS | minimum determinant 0.00360 |
| 4 arc coverage ripple | PASS | peak-to-peak ripple 2.88% |
| 5 visibility-off mass | PASS | path mass 1.000000000000 |
| 6 persistence counting | PASS | 50 kernels/snapshot, H=2 after two snapshots |
| 7 state bound | PASS | 200 snapshots, 1,314 modes <= 712 cells x 3 |
| 8 analytic derivatives | PASS | maximum relative error 1.34e-7 |
| 9 single wall | PASS | 52/52 ridge points near wall |
| 10 two parallel walls | PASS | wall recall 1.0, two ridge clusters |
| 11 corner | PASS | K=1: one mode, K=2: two modes |
| 12 branch | PASS | three local orientations retained |
| 13 dwell-time bias | PASS | raw mass ratio 5.0, `W/H` ratio 1.0 |
| 14 visibility causality | PASS | first-snapshot visibility 1.0, next 0.9896 |
| 15 double bounce ablation | PASS | OFF phantom 364/precision 0.322/recall 1.0, ON phantom 363/precision 0.320/recall 1.0 |
| 16 evidence dominance | PASS | diffuse self-ridge 153 -> 0, strong wall ridge 52/52 retained |

Test 15에서 visibility의 phantom 감소는 1개뿐이고 precision은 감소했다. 따라서 기본값을 OFF로 유지하며 유의미한 효과를 주장하지 않는다.

Browser integration:

- 배포본 기반 `index.html`, 1440 x 900 viewport, revised 4 steps: admitted/rejected 215/0, modes/cells 412/285, confirmed 342, update/extraction 42.8 ms
- revised/legacy 전환, step 실행, console warning/error 0건
- B/C heatmap과 ground-truth wall overlay의 좌표 일치 시각 확인

## F. 남은 제한

- 공개 저장소 `woqhrl9494-cell/corridor-mapper`의 기존 `main` commit `59f7226`을 기준으로 수정하고 commit `4e00707`로 push했다. GitHub Pages build 성공과 live/local `index.html`, `revised_wall_estimator.js` SHA-256 일치를 확인했다.
- 실제 browser run의 DPR은 1이었다. DPR 2에서 문제가 생기는 코드 경로는 physical backing-store와 logical overlay transform을 통일해 제거했지만, 실제 MacBook Retina 화면에서의 최종 육안 검증은 수행하지 못했다.
- 현재 web simulator는 corridor/torus만 UI로 노출한다. single wall/corner/branch/double-bounce는 deterministic test fixture에 구현되어 있으며 UI scenario로 추가하지 않았다.
- visibility ray integral은 cellSize/2 이하 midpoint quadrature이다. exact DDA 경계 교차식은 아니지만 실제 segment length를 적분하며 endpoint cell을 제외한다.

## G. Local analytic-ridge correction

원인: seed별 국소 Gaussian 장의 ridge를 그대로 합집합하면, 타원 내부의 단일 모드도 자기 평균에서 `D=0`, `R=1`, 음의 정상곡률을 만족해 자명한 self-ridge가 된다. Evidence E에는 실제 벽의 강한 띠가 보이지만 최종 mask가 내부 self-ridge 수천 개로 채워져 벽이 묻혔다.

수정: 기존 analytic `E,C,R,D` 조건을 유지하고 다음 current-snapshot evidence-dominance gate를 추가했다.

`T_E = max(tau_E, tau_E,dom * Q_q({E(x) > 0}))`, `q=0.99`, `tau_E,dom=0.60`

최종 ridge는 기존 조건과 `E >= T_E`를 모두 만족해야 한다. `Q_0.99`는 최대값 한 점보다 안정적이며 estimator의 현재 causal state만 사용한다. GT 좌표와 미래 snapshot은 threshold 계산에 들어가지 않는다. 양의 evidence 정렬 때문에 추출당 시간복잡도 `O(G^2 log G)`와 `O(G^2)` 임시 메모리가 추가된다. 현재 병목은 여전히 seed-neighbor analytic field evaluation이다.

브라우저 검증, Grid G=150:

- corridor seed 42, 57 steps: wall cells 5,501 -> 320, precision 0.203 -> 0.997, recall 0.480 -> 0.290, F1 0.285 -> 0.449
- corridor seed 42, 120 steps: precision 0.995, recall 0.550, F1 0.708, extraction/update 250.7 ms
- torus, 120 steps: precision 0.948, recall 0.568, F1 0.711, extraction/update 251.7 ms
- console warning/error 0건

동일 입력, 동일 `G=150`, 120-step held-out 비교:

| Scenario | Seed | Grid Direct F1 | Revised F1 | Grid Direct recall | Revised recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| corridor | 7 | 0.677 | 0.710 | 0.512 | 0.553 |
| corridor | 19 | 0.692 | 0.727 | 0.535 | 0.595 |
| corridor | 73 | 0.696 | 0.733 | 0.533 | 0.587 |
| torus | 7 | 0.583 | 0.717 | 0.438 | 0.578 |
| torus | 73 | 0.612 | 0.732 | 0.467 | 0.600 |

5개 held-out run 모두 Revised F1과 recall이 Grid Direct보다 높았다. 이는 시험한 조건의 재현 결과이며 모든 가능한 seed/noise/geometry에 대한 수학적 우월성 보장은 아니다. 성능 비교와 threshold 선택에 사용한 GT는 estimator 입력에 전달되지 않는다.

57-step recall 감소는 아직 관측하지 않은 전체 GT 벽까지 recall denominator에 포함하는 metric 영향과 강한 evidence가 형성되기 전의 warm-up 영향이 함께 있다. 동일 시점 Grid Direct recall은 0.272이며 revised recall 0.290보다 낮다.
