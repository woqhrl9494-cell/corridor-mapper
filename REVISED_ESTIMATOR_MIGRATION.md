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
- `revised_wall_estimator.test.js`: specification, evidence-dominance, normal NMS, oracle-field isolation을 포함한 18개 deterministic validation
- `wall_metrics.js`: arc-length GT sampling, observed-region mask, boundary F1/CA-MSD/CA-HD95 evaluator
- `wall_metrics.test.js`: sampling, coverage, tolerance, false-positive metric validation
- `data_leakage_audit.test.js`: estimator whitelist, evaluator 실행 순서, 독립 module 격리 정적 감사
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
| 15 double bounce ablation | PASS | OFF phantom 324/precision 0.318/recall 1.0, ON phantom 316/precision 0.301/recall 1.0 |
| 16 evidence dominance | PASS | diffuse self-ridge 153 -> 0, strong wall ridge 52/52 retained |
| 17 normal NMS | PASS | finite-width ridge 274 -> 137 cells, maximum cells/column 2 -> 1 |
| 18 oracle-field isolation | PASS | 임의 `hit`, GT label, future field 추가 전후 mode/evidence/ridge 동일 |

Test 15에서 visibility의 phantom은 8개 감소했지만 precision도 감소했다. 따라서 기본값을 OFF로 유지하며 유의미한 효과를 주장하지 않는다.

Browser integration:

- 배포본 기반 `index.html`, 1440 x 900 viewport, revised 4 steps: admitted/rejected 215/0, modes/cells 412/285, confirmed 342, update/extraction 42.8 ms
- revised/legacy 전환, step 실행, console warning/error 0건
- B/C heatmap과 ground-truth wall overlay의 좌표 일치 시각 확인

## F. 남은 제한

- 공개 저장소 `woqhrl9494-cell/corridor-mapper`의 기존 `main` commit `59f7226`을 기준으로 revised estimator를 이식했고, evidence-dominance correction을 commit `9b585a0`으로 push했다. GitHub Pages build 성공과 live/local SHA-256 일치를 확인했다: `index.html` `49f8579a...f806`, `revised_wall_estimator.js` `36f3e4ee...bb65`.
- 실제 browser run의 DPR은 1이었다. DPR 2에서 문제가 생기는 코드 경로는 physical backing-store와 logical overlay transform을 통일해 제거했지만, 실제 MacBook Retina 화면에서의 최종 육안 검증은 수행하지 못했다.
- 현재 web simulator는 corridor/torus만 UI로 노출한다. single wall/corner/branch/double-bounce는 deterministic test fixture에 구현되어 있으며 UI scenario로 추가하지 않았다.
- visibility ray integral은 cellSize/2 이하 midpoint quadrature이다. exact DDA 경계 교차식은 아니지만 실제 segment length를 적분하며 endpoint cell을 제외한다.

## G. Analytic-ridge correction

원인: seed별 국소 Gaussian 장의 ridge를 그대로 합집합하면, 타원 내부의 단일 모드도 자기 평균에서 `D=0`, `R=1`, 음의 정상곡률을 만족해 자명한 self-ridge가 된다. Evidence E에는 실제 벽의 강한 띠가 보이지만 최종 mask가 내부 self-ridge 수천 개로 채워져 벽이 묻혔다.

수정: 기존 analytic `E,C,R,D` 조건을 유지하고 다음 current-snapshot evidence-dominance gate를 추가했다.

`T_E = max(tau_E, tau_E,dom * Q_q({E(x) > 0}))`, `q=0.99`, `tau_E,dom=0.70`

최종 ridge는 기존 조건과 `E >= T_E`를 모두 만족해야 한다. `Q_0.99`는 최대값 한 점보다 안정적이며 estimator의 현재 causal state만 사용한다. GT 좌표와 미래 snapshot은 threshold 계산에 들어가지 않는다. 양의 evidence 정렬 때문에 추출당 시간복잡도 `O(G^2 log G)`와 `O(G^2)` 임시 메모리가 추가된다. 현재 병목은 여전히 seed-neighbor analytic field evaluation이다.

Evidence gate 뒤에 추정 normal 방향 3-cell NMS를 추가했다. 후보 셀과 양쪽 normal 이웃을 비교해 `E`가 큰 셀, `D`가 작은 셀, raster index가 작은 셀 순으로 하나만 남긴다. 이 단계는 출력 mask만 얇게 만들며 mode state를 변경하지 않는다. 입력은 현재 snapshot의 `E`, `D`, normal뿐이며 GT와 미래 snapshot을 사용하지 않는다. 시간복잡도와 추가 메모리는 모두 `O(G^2)`이다.

초기 evidence가 충분히 형성되기 전에 0.70 계수를 적용하면 recall이 감소하므로 snapshot 60까지 0.60을 사용하고 snapshot 120까지 0.70으로 선형 증가하는 고정 causal schedule을 적용했다. schedule 입력은 현재 snapshot index뿐이다. GT coverage, metric, 미래 관측을 사용하지 않는다.

## H. Metric correction and fixed-condition validation

기존 metric의 전체 GT recall은 아직 센서가 보지 못한 벽까지 false negative로 계산했고, GT polyline vertex 밀도에 따라 가중치가 달라졌으며, 0.9 m tolerance는 `G=150`의 2~4 cell 오차를 정답 처리했다. Revised runtime에는 extraction을 포함하고 Grid runtime에는 제외하는 비대칭도 있었다.

수정 metric은 다음과 같다.

- GT를 0.2 m 간격의 arc length로 균일 sampling
- 현재까지 생성된 simulation reflection hit 반경 1.0 m를 observed GT로 정의
- 모든 prediction을 전체 GT와 비교해 precision 산출, observed GT만으로 recall 산출
- 주 metric은 tolerance 0.4 m의 boundary F1
- 거리 metric은 coverage-aware mean surface distance(CA-MSD)와 coverage-aware HD95(CA-HD95). prediction→전체 GT와 observed GT→prediction을 사용하므로 표준 ASSD/HD95로 부르지 않음
- 두 estimator 모두 3 step마다 extraction, rolling 120-step pipeline latency의 p50/p95 표시
- Reset은 seed와 환경 parameter를 보존해 같은 입력을 재실행

reflection hit와 GT는 evaluator에만 전달된다. `sanitizeEstimatorMeasurements`가 `tx`, `rx`, `r`, `i`, `j`, `m`만 whitelist하여 Grid와 Revised에 전달하고, evaluator는 두 estimator update가 끝난 뒤 실행된다. 따라서 evaluation oracle은 사용하지만 estimation leakage는 없다.

브라우저 고정 조건: `G=150`, 120 steps, gap 10 m, roughness 0.4, curvature 0.25, Torus radius 10 m, visibility OFF.

seed 42/7은 dominance 계수와 warm-up schedule 선택 과정에서 metric을 확인했으므로 tuning set으로 분류한다. 해당 수치는 최종 test 성능 주장에 사용하지 않는다. parameter를 동결한 뒤 미사용 seed 31/87을 test set으로 지정했다.

| Test scenario | Seed | F1 Grid/Revised | Precision Grid/Revised | Recall Grid/Revised | CA-MSD Grid/Revised (m) | CA-HD95 Grid/Revised (m) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Corridor | 31 | 0.884 / 0.890 | 1.000 / 0.945 | 0.792 / 0.842 | 0.423 / 0.340 | 3.715 / 2.485 |
| Corridor | 87 | 0.839 / 0.850 | 0.972 / 0.938 | 0.738 / 0.777 | 0.558 / 0.356 | 4.913 / 1.918 |
| Torus | 31 | 0.733 / 0.926 | 0.898 / 0.961 | 0.620 / 0.893 | 0.633 / 0.247 | 4.705 / 1.281 |
| Torus | 87 | 0.670 / 0.903 | 0.910 / 0.960 | 0.531 / 0.853 | 0.946 / 0.341 | 7.544 / 2.440 |
| Mean | - | 0.782 / 0.892 | 0.945 / 0.951 | 0.670 / 0.841 | 0.640 / 0.321 | 5.219 / 2.031 |

4개 독립 test run에서는 Revised F1과 recall이 모두 Grid보다 높았다. 다만 표본 수가 4개뿐이므로 일반적 우월성을 주장할 근거로는 부족하다. 논문 결과에는 사전 등록된 다수 seed의 paired bootstrap confidence interval과 seed별 paired difference를 추가해야 한다.

## I. Data-leakage audit

- synthetic data generation은 GT wall로 reflection range와 `hit`을 만든다. 이는 simulator의 generative model이며 estimator에는 noisy range만 전달한다.
- `sanitizeEstimatorMeasurements` 뒤의 estimator input에는 `tx`, `rx`, `r`, pair/sample index만 존재한다.
- Revised adapter는 다시 position covariance와 range standard deviation을 구성하며 `hit`, wall ID, GT polyline을 전달하지 않는다.
- dominance threshold는 현재 `E` quantile과 현재 snapshot index만 사용한다.
- normal NMS는 현재 `E`, `D`, normal과 deterministic raster index만 사용한다.
- observed mask, GT coverage, F1, CA-MSD, CA-HD95는 estimator update와 extraction 뒤 display/logging에만 사용한다.
- 임의 oracle field를 measurement에 추가한 회귀시험에서 mode, evidence, ridge output이 동일했다.
- seed 42/7은 tuning, seed 31/87은 동결 후 test로 분리했다.

현재 감사 범위에서는 estimation leakage와 future-data 참조를 발견하지 못했다. 다만 동일 개발자가 tuning/test 실험을 모두 수행했으므로 논문 제출 전에는 별도 seed manifest를 고정하고 test 결과를 한 번만 산출하는 절차가 필요하다.

이 절의 metric/NMS/Reset 수정은 현재 GitHub Pages release 대상에 포함한다. 공개 페이지의 build와 live asset 검증 결과는 배포 commit에서 확인한다.
