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
- `revised_wall_estimator.test.js`: specification의 15개 deterministic validation
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
| 15 double bounce ablation | PASS | OFF phantom 364/precision 0.323/recall 1.0, ON phantom 368/precision 0.317/recall 1.0 |

Test 15에서 visibility는 phantom을 줄이지 못했다. 따라서 specification에 따라 기본값을 OFF로 유지하며 효과를 주장하지 않는다.

Browser integration:

- 배포본 기반 `index.html`, 1440 x 900 viewport, revised 4 steps: admitted/rejected 215/0, modes/cells 412/285, confirmed 342, update/extraction 42.8 ms
- revised/legacy 전환, step 실행, console warning/error 0건
- B/C heatmap과 ground-truth wall overlay의 좌표 일치 시각 확인

## F. 남은 제한

- 공개 저장소 `woqhrl9494-cell/corridor-mapper`의 기존 `main` commit `59f7226`을 기준으로 수정하고 commit `4e00707`로 push했다. GitHub Pages build 성공과 live/local `index.html`, `revised_wall_estimator.js` SHA-256 일치를 확인했다.
- 실제 browser run의 DPR은 1이었다. DPR 2에서 문제가 생기는 코드 경로는 physical backing-store와 logical overlay transform을 통일해 제거했지만, 실제 MacBook Retina 화면에서의 최종 육안 검증은 수행하지 못했다.
- 현재 web simulator는 corridor/torus만 UI로 노출한다. single wall/corner/branch/double-bounce는 deterministic test fixture에 구현되어 있으며 UI scenario로 추가하지 않았다.
- visibility ray integral은 cellSize/2 이하 midpoint quadrature이다. exact DDA 경계 교차식은 아니지만 실제 segment length를 적분하며 endpoint cell을 제외한다.
