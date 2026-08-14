# Prompt for explaining the revised wall-detection algorithm

아래 내용을 기준으로 기존 Grid Direct 방식과 Revised 방식의 차이, 변경 이유, 수학적 의미, 구현상 제한을 분석해 설명하라. 코드를 보지 않고 추측하지 말고, 제공된 파일과 수식을 근거로 답하라.

## 역할

당신은 bistatic radar mapping, statistical signal processing, online mixture estimation을 검토하는 연구자다. 설명은 논문 review에 대응할 수 있도록 다음을 분리한다.

1. estimator 입력과 simulation-only ground truth
2. persistent state update와 terminal wall extraction
3. causal processing과 data leakage 방지
4. detection accuracy와 computation latency의 구분
5. 검증된 결과와 아직 검증되지 않은 주장

## 제공 파일

- `index.html`: simulator, Grid Direct baseline, estimator/evaluator input boundary, UI, runtime measurement
- `revised_wall_estimator.js`: Revised local-mode estimator와 analytic ridge extraction
- `wall_metrics.js`: observed-boundary evaluation
- `revised_wall_estimator.test.js`: estimator 회귀시험
- `wall_metrics.test.js`: metric 회귀시험
- `data_leakage_audit.test.js`: GT와 future field 격리 감사
- `REVISED_ESTIMATOR_MIGRATION.md`: migration과 browser benchmark 기록

## Revised estimator 입력

각 snapshot에서 estimator가 받는 측정은 송수신 위치, 위치 covariance, noisy bistatic range와 range standard deviation뿐이다.

```text
{i, j, m, pI, pJ, SigmaI, SigmaJ, d, sigmaD, SigmaIJ?}
```

Simulator가 GT wall로 생성한 exact reflection point `hit`, wall ID, GT polyline은 estimator 입력에 포함되지 않는다. `index.html`의 `sanitizeEstimatorMeasurements`가 `tx`, `rx`, `r`, pair/sample index만 whitelist한다. 평가용 observed mask 갱신은 Grid와 Revised estimator update가 끝난 뒤 실행된다.

## Persistent local-mode update

1. Noisy bistatic range로 정의되는 ellipse를 cumulative arc-length lookup으로 sampling한다.
2. 각 sample에서 range residual Jacobian과 analytic ellipse normal/tangent를 계산한다.
3. Pose/range uncertainty를 propagation해 anisotropic kernel covariance를 구성한다.
4. Spatial cell 안에서 axial normal alignment와 Bhattacharyya distance를 모두 만족하는 mode에 kernel을 할당한다.
5. Mode state는 sufficient statistics `(W,H,s,Q,O,lastSupportedSnapshot)`으로 유지한다.
6. 같은 snapshot의 반복 sample은 persistence `H`를 한 번만 증가시킨다.
7. Cell당 mode 수는 deterministic score로 `K_mode` 이하로 제한한다.
8. Confirmed mode는 단순 fading으로 제거하지 않고, 오래된 unconfirmed mode만 제거한다.

Persistent state bound는 occupied cell 수를 `B`라 할 때 `O(B K_mode)`이다.

## Analytic field and ridge gates

Compatible neighboring modes의 Gaussian mixture field `g(x)`, gradient, Hessian을 closed form으로 계산한다. Dominant axial normal을 `n`, normal variance를 `sigma_perp^2`, normal curvature magnitude를 `A=max(0,-n^T Hessian(g)n)`라 한다.

```text
E = 2*pi*sqrt(det(P))*g
C = (lambda_1(M)-lambda_2(M))/(lambda_1(M)+lambda_2(M)+eps)
R = sigma_perp^2*A/(g+eps)
D = sigma_perp*abs(n^T grad(g))/(g+eps)
```

기본 analytic ridge 후보는 다음을 만족한다.

```text
E >= tau_E
C >= tau_C
R >= tau_R
D <= tau_D
n^T Hessian(g) n < 0
```

## Evidence-dominance gate

단일 Gaussian mode는 자기 평균에서 `D=0`, `R=1`, negative normal curvature를 만족하므로 ellipse 내부의 약한 mode도 trivial self-ridge가 될 수 있다. 이를 막기 위해 현재 extraction의 positive Evidence 분포만 사용한다.

```text
E_ref = Q_0.99({E(x) > 0})
T_E   = max(tau_E, alpha(t)*E_ref)
```

`alpha(t)`는 고정 causal schedule이다.

```text
t <= 60:  alpha(t)=0.60
60<t<120: alpha(t)=0.60 + (t-60)*(0.10/60)
t >= 120: alpha(t)=0.70
```

초기에는 Evidence가 충분히 형성되지 않았으므로 낮은 계수로 recall을 보존하고, 이후 약한 self-ridge를 더 강하게 제거한다. Schedule은 현재 snapshot index만 사용하며 GT coverage, F1, future observation을 사용하지 않는다.

## One-cell normal NMS

Analytic `D` gate는 정확한 zero-level set이 아니라 finite band를 허용하므로 normal 방향으로 인접한 여러 raster cell이 통과할 수 있다. Evidence gate 뒤에 candidate와 `+n`, `-n` 방향의 한 셀 이웃을 비교한다.

우선순위는 다음과 같다.

1. 더 큰 `E`
2. 더 작은 `D`
3. 더 작은 deterministic raster index

이 NMS는 output mask만 얇게 하며 persistent mode state를 변경하지 않는다. 회귀시험에서 동일 synthetic band가 274개에서 137개로 감소했고 column 최대 두께가 2 cell에서 1 cell로 감소했다.

## Evaluation metrics

- GT wall을 0.2 m arc-length 간격으로 균일 sampling
- Simulation reflection hit 반경 1.0 m에 속한 GT만 observed GT로 누적
- Boundary tolerance는 0.4 m
- Precision은 모든 prediction에서 full GT까지의 거리로 계산
- Recall은 observed GT에서 prediction까지의 거리로 계산
- F1은 위 precision과 recall의 harmonic mean
- CA-MSD와 CA-HD95는 prediction-to-full-GT와 observed-GT-to-prediction directed distance를 결합한 coverage-aware metric

CA-MSD와 CA-HD95는 두 방향에서 동일 GT support를 사용하지 않으므로 표준 ASSD/HD95라고 부르지 않는다. Exact reflection hit은 evaluator 전용 oracle이며 실제 센서 입력으로 간주하지 않는다.

## Fairness and data leakage

- Grid와 Revised는 같은 noisy measurements, seed, grid resolution과 extraction cadence를 사용한다.
- 두 방법 모두 3 step마다 wall extraction과 metric update를 수행한다.
- Runtime은 rolling 120-step pipeline p50/p95로 표시한다.
- Reset은 seed와 environment parameter를 보존한다.
- Tuning seed는 42/7, parameter 동결 후 test seed는 31/87로 분리했다.
- Oracle field를 measurement에 추가해도 mode/evidence/ridge가 동일한 시험이 존재한다.

## Verified test result

`G=150`, 120 steps, gap 10 m, roughness 0.4, curvature 0.25, visibility OFF, 독립 seed 31/87의 네 test run 평균:

```text
Boundary F1: Grid 0.782, Revised 0.892
Precision:   Grid 0.945, Revised 0.951
Recall:      Grid 0.670, Revised 0.841
CA-MSD:      Grid 0.640 m, Revised 0.321 m
CA-HD95:     Grid 5.219 m, Revised 2.031 m
```

표본 수가 네 run뿐이므로 일반적 우월성을 주장할 수 없다. 다수 사전 등록 seed, paired confidence interval과 hardware-independent operation profiling이 추가로 필요하다.

## Computation limitation

Revised의 non-extraction update p50은 Grid보다 짧지만 analytic extraction p95는 약 200–273 ms로 Grid의 약 8–10 ms보다 크다. 현재 구현은 confirmed mode마다 raster analytic field를 반복 평가하고 positive Evidence quantile을 정렬하기 때문이다. 따라서 정확도 향상은 검증됐지만 전체 연산량 감소나 real-time latency 우위는 검증되지 않았다.

## 요구 출력

다음 순서로 답하라.

1. 기존 방식에서 바뀐 부분을 update, extraction, metric으로 나누어 설명
2. 각 변경의 수학적 필요성과 failure mode 설명
3. one-cell NMS가 두께를 줄이는 이유 설명
4. causal 입력 경계와 data leakage 감사
5. Grid Direct 대비 정확도, persistent memory, update latency, extraction latency 비교
6. 논문에서 주장 가능한 내용과 주장하면 안 되는 내용 분리
7. 추가 실험과 연산 최적화 제안

모든 설명에서 GT를 estimator 입력으로 사용하는 방식, future snapshot smoothing, test seed를 다시 tuning하는 방식은 제안하지 마라.
