# TSRI-S 접점 추정 시뮬레이터

기존 EchoMap의 동굴, 차량 이동, 반사 거리 생성기를 유지하고 추정 부분을 교체했다. 세 방법은 같은 시간창, 관측값, 초기 후보, 고정 오차공분산으로 같은 최소제곱 문제를 푼다. 지도는 격자나 spline 대신 위치, 법선, 공분산을 가진 surfel 목록이다.

## 비교하는 방법

| 방법 | 변수 | 실제 구현 |
|---|---|---|
| LM | 위치 2개, 거리 보정계수 1개 | 열 크기를 정규화한 Levenberg–Marquardt, 증강 행렬 QR |
| Trust-region GN | 같은 3개 | Powell Dogleg, Gauss–Newton / Cauchy 경로, 실제 감소량 대 예측 감소량으로 반경 조정 |
| Variable projection + LM | 위치 2개 | 선형 보정계수를 정확히 제거한 뒤 축소 목적함수를 LM으로 최적화 |

LM도 trust-region 관점으로 해석할 수 있다. 여기서 두 번째 방법은 LM과 구별되는 **Dogleg** 구현을 뜻한다. Variable projection도 별개의 관측모형이 아니다. 같은 목적함수에서 선형 변수를 제거하는 방법이다. 같은 최소점에 도달하면 잔차와 위치는 같아야 한다. 계산 시간과 초기값에 따른 수렴 차이를 함께 평가한다.

참고: [Ceres의 비선형 최소제곱 풀이 설명](https://ceres-solver.readthedocs.io/latest/nnls_solving.html), [MathWorks의 separable least squares 설명](https://www.mathworks.com/content/dam/mathworks/mathworks-dot-com/moler/leastsquares.pdf). 구현은 이 저장소의 JavaScript 코드이며 Ceres나 MATLAB 실행 결과로 표시하지 않는다.

## 수식, 차원과 단위

입력은 같은 송수신쌍에서 얻은 n개의 `{t, r, tx, rx, sigma}` 기록이다. 위치와 거리는 m, 시간은 s, b₂는 m/s²이다. b₂는 곡률이 아니다. JavaScript Number의 배정밀도 실수를 사용한다.

\[
F(\mathbf x,t_k)=\|\mathbf x-\mathbf p_i(t_k)\|+\|\mathbf x-\mathbf p_j(t_k)\|,
\quad\min_{\mathbf x,b_2}\sum_k[\rho_k-F(\mathbf x,t_k)-b_2(t_k-t_0)^2]^2.
\]

OLS를 선택하면 위의 동일 가중치 문제를 그대로 푼다. GLS를 선택하면 고정한 R의 Cholesky 분해 R = LLᵀ를 사용한다. 공분산은 모든 방법과 초기 후보에 공통이다. 반복 중 후보 위치에 따라 R을 갱신하지 않는다.

\[
\tau_k=t_k-t_0,\quad h=\max_k|\tau_k|,\quad u_k=\tau_k/h,
\quad\beta=b_2h^2,
\quad\mathbf e=L^{-1}[\boldsymbol\rho-\mathbf F(\mathbf x)-\beta\mathbf u^2].
\]

시간 정규화는 단위를 정리하는 재파라미터화다. b₂에 물리적 상한을 가하거나 목적함수를 바꾸지 않는다. 해는 b₂ = β/h²로 복원한다.

공유 위치오차 모형은 차량마다 고정된 2차원 Gaussian bias이다. 관측 위치에 이 bias를 실제로 더하며, 같은 차량이 등장하는 시각과 차량쌍에서 같은 bias를 사용한다. 센서 위치의 참값은 추정기로 전달하지 않는다. 원래 사이트에서 위치 표준편차는 주로 추정기의 불확실성 설정이었다. 이번 구현에서는 공분산 검증을 위해 **위치 보고값에 공유 오차를 추가**했다. 물리적 차량 경로와 반사 거리 RNG는 그대로다.

\[
R=\operatorname{diag}(\sigma_k^2)+J_p\Sigma_pJ_p^\mathsf T,
\quad J_p\in\mathbb R^{n\times4},\quad\Sigma_p=\sigma_p^2I_4.
\]

Jₚ는 측정으로 만든 초기 후보 중 OLS profile 잔차가 가장 작은 후보에서 한 번 계산한다. 참 접점으로 계산하지 않는다. 0 잡음 설정에서 Cholesky 분해를 정의하기 위한 거리 분산 하한은 10⁻¹² m²이다. 이는 실제 센서 정확도 보장이 아니다.

Variable projection에서 a = L⁻¹u², d(x) = L⁻¹[ρ − F(x)]라 두면

\[
\hat\beta(\mathbf x)=\frac{\mathbf a^\mathsf T\mathbf d(\mathbf x)}{\mathbf a^\mathsf T\mathbf a},
\quad P=I-\frac{\mathbf a\mathbf a^\mathsf T}{\mathbf a^\mathsf T\mathbf a},
\quad\mathbf e_{\rm VP}=P\mathbf d(\mathbf x).
\]

R과 a가 고정이므로 투영된 Jacobian은 정확히 PG̃이며, G̃ = L⁻¹∂F/∂x이다. β를 뺀 채 원래 위치 Jacobian을 사용하는 근사는 하지 않는다. 모든 선형 풀이에는 재직교화한 column-pivoted QR을 사용한다. solver step에서 JᵀJ를 만들지 않는다.

## 초기화와 거리 연결

1. 한 프레임의 거리를 송수신쌍별로 정렬하고 0.25 m 이내 군집의 중앙 관측값을 대표로 사용한다. 단일 연결식으로 무한히 긴 군집을 만들지 않는다. MAD로 군집 산포를 반영하고, 경로 수의 제곱근으로 오차를 줄이지 않는다. 이 처리는 보정된 정반사 거리 추정기가 아니다.
2. 과거 최대 9개 기록의 거리 추세로 다음 값을 예측한다. 관측 위치 이동량과 거리 표준편차를 사용해 연결 후보를 제한한다. 한 track에서 최대 2개 연결을 분기하고, 차량쌍당 최대 8개 가설을 유지한다. 초과 가설을 제거한 개수를 표시한다. 완전한 전역 MHT 최적해라고 주장하지 않는다.
3. 창 내 거리의 2차 회귀로 중심 거리와 변화율을 구한다. 위치 기록도 같은 시간 기준으로 회귀한다. 중심 거리의 타원에서 시간 미분 조건의 근을 찾는다. 96개 각도 구간과 이분법을 사용하며, 공간 전체를 격자로 나누지 않는다. 잡음 때문에 근이 없으면 타원 위 미분 불일치의 국소 최소 후보를 남긴다. 최대 4개 후보에 모두 세 방법을 적용한다.
4. 거리 변화율은 초기화에만 사용한다. 같은 거리에서 구한 미분을 독립 관측으로 목적함수에 다시 넣지 않는다. 실제 반사점 ID나 벽 번호로 연결하지 않는다.

중앙값 군집화도 가까운 서로 다른 경로를 합칠 수 있다. 연결 가설의 제한도 올바른 가지를 제거할 수 있다. 그 영향을 잔차만으로 완전히 검출할 수 없으므로 출력률과 보류 원인을 함께 보고한다.

## 법선과 불확실성

중심 시각의 추정 접점에서 g = ∂F/∂x, n̂ = ±g/‖g‖을 계산한다. 자유공간 방향의 부호를 확정하지 않고 법선 방향의 부호를 무시한 각도 오차를 평가한다.

β를 포함한 공동 정보에서 Schur complement를 계산한다. G̃의 두 열을 a에 수직인 공간으로 투영한 A = PG̃에 대해 Cₓ = (AᵀA)⁻¹이다. GLS는 알려진 R의 크기를 사용하고, OLS는 잔차 분산 SSE/(n−3)을 곱한다. 불확실성은 국소 선형 근사다. 비선형 대안 해, 군집 선택, 연결 오류, 산란 편향과 시간 3차 이상 모형 오차를 보장하지 않는다.

표의 위치 조건수는 κ₂(A), 전체 조건수는 시간과 열 크기를 정규화한 3열 Jacobian의 κ₂이다. 원래 단위를 섞은 행렬의 조건수를 직접 비교하지 않는다.

채택 조건은 다음과 같다. 이 값들은 성능을 보장하는 물리적 상수가 아니라 고정된 reference 판정값이다.

- 수렴 조건 충족. 반복 상한 / 개선 정지는 성공과 구분
- 서로 0.5 m 이상 떨어진 대안 최소점의 잔차 차이가 충분함. Δχ² < 3.84인 경우 모호성 표시. 정확한 다봉 posterior 검정으로 해석하지 않음
- 위치 조건수 < 10⁴, 95% 오차 타원의 장반경 < 2 m
- GLS: SSE/(n−3) ≤ 1 + 3√[2/(n−3)]. OLS: 거리 RMSE < 3 max(σ_range, 0.01 m)
- 서로 비슷한 연관 가설이 유지되거나 산란 편향이 미보정이면 지도 채택 보류

식별되지 않는 점을 지도에 채택하지 않아도, 그 후보의 위치 오차와 수렴 결과는 비교에 포함한다. 초기화를 만들지 못한 창은 초기화 실패 수에 포함하며 지도 채택률의 분모에서 제외하지 않는다.

## 지연과 계산량

기존 시간 간격은 0.05 s이다. 창의 관측 수는 11 / 21 / 41 / 61개이며 균일한 기록에서는 중심 접점이 각각 0.25 / 0.50 / 1.00 / 1.50 s 늦게 출력된다. 누락이 있으면 실제 기록 시각으로 지연을 계산한다. 추정기가 받은 현재보다 나중인 관측은 오류로 처리한다.

창당 n개 기록, 변수 p = 2 또는 3, 초기 후보 K ≤ 4, 반복 I ≤ 60일 때 dense GLS 준비는 O(n³), 각 풀이기는 O(KI(n²p + np² + p³)), 작업 메모리는 O(n² + np)이다. OLS도 동일 whitening 경로를 사용해 공정한 reference를 유지한다. 정규화가 물리적 정보 부족을 해결하는 것은 아니다.

track 버퍼는 차량쌍 수에 비례한다. surfel 저장은 방법당 최대 12,000개, 보류 후보 표시는 방법당 최근 600개, CSV 창 기록은 최근 최대 30,000개 행이다. 넘치면 오래된 기록을 제거한다. 누적 요약 지표는 별도로 계산한다. surfel들을 독립 Gaussian으로 반복 융합하지 않는다.

화면 계산은 Web Worker에서 수행한다. HTML을 file://로 직접 여는 경우에는 동일 코드를 메인 스레드에서 작은 묶음으로 실행한다. 많은 차량을 사용할 때 기존 반사 경로 생성의 차량쌍 수 증가와 가시성 검사도 병목이 될 수 있다.

## 산란과 생성기 범위

기존 생성기는 다각선 벽, 상위 segment 후보, 근사 Fermat/정반사 판정과 가시성 검사를 사용한다. 인접 segment 전환은 매끄러운 벽을 가정한 TSRI의 3차 잔여항과 다른 오차를 만들 수 있다. 실제 UWB 파형, 대역폭에 따른 피크 검출, 다중경로 병합, 시계 동기, 안테나 응답은 구현하지 않았다.

산란 ON에서도 기존 생성기를 유지했다. 분리 거리의 중앙 대표값을 넣는 모드는 **편향 미보정 스트레스 시험**이며 확정 surfel 출력은 보류한다. 병합 / 미보정 모드는 그 값을 추정기로 보내지 않는다. 병합 파형의 물리적 생성기를 추가했다는 뜻이 아니다. 사용자가 정한 산란 전처리기가 마련되면 `preprocess()`의 출력 거리와 공분산을 교체해야 한다.

## 평가와 재현

접점 오차는 선택된 중심 관측의 simulator 정반사 기준점 대비 계산한다. 참 정상점은 추정 이후 평가에서만 접근한다. 법선 오차는 그 점이 속한 실제 벽 segment의 법선과 비교한다. 이는 기존 생성기가 근사적으로 구한 기준점에 대한 오차이며, 정확한 연속벽의 해에 대한 보장값은 아니다.

표에는 보류 포함 RMSE, 채택된 점만의 RMSE, 풀이 수렴률, 전체 창 대비 지도 채택률, 지도 precision / observed recall / F1을 함께 표시한다. 일부 후보만 선택한 결과를 전체 복원 성능으로 보고하지 않는다.

계산 시간에는 모든 초기 후보의 풀이와 품질 계산이 포함된다. 공통 거리 연결, 초기화, 공분산 준비, 평가와 화면 렌더링은 solver 시간에서 제외한다. 실행 순서를 창마다 회전한다. JIT, garbage collection과 다른 작업의 영향을 받으므로 시간 수치는 실행 환경과 함께 기록한다.

반복 비교는 seed를 공유한 paired 실험이다. 신뢰구간은 seed별 요약값에 대한 Student-t 95% 구간이다. 중첩된 시간창을 독립 표본처럼 세지 않는다. 현재 지도 실행과 별도로 수행하며 JSON으로 설정과 결과를 저장할 수 있다.

```sh
node --test tests/*.test.js
node diffuse_path.test.js
node wall_metrics.test.js
node data_leakage_audit.test.js
# jsdom가 설치된 환경에서:
node tests/jsdom_smoke.js
node tests/environment_compatibility.js
# 10 seeds × 2 geometries × 3 windows × 2 scattering states = 120 runs
node benchmark_tsri.js 10 100 tsri_validation.json
python3 -m http.server 8877 --bind 127.0.0.1
```

`tests/environment_compatibility.js`는 Git 원본 `5b03dc7`을 실제로 실행해 3개 조건, 15개 프레임의 벽 좌표, 차량 위치, 거리와 반사점, 산란 RNG 순서를 비교한다. jsdom 검증은 DOM과 이벤트 실행 검사이며 실제 브라우저의 레이아웃 검사를 대신하지 않는다.

수치 검증에는 analytic / projected Jacobian의 중앙차분 비교, 선형변수 제거의 정확성, QR, 알려진 합성해 복원, 시간 단위와 timestamp 불변성, rank deficiency, 공동 공분산의 Schur complement, 미래 관측 거부, oracle 필드 접근 차단, 세 방법의 같은 창 처리와 Worker의 반복 / 취소 / 내보내기가 포함된다.

수치 실험 원자료: [tsri_validation.json](tsri_validation.json). 해석: [TSRI_RESULTS.md](TSRI_RESULTS.md).
