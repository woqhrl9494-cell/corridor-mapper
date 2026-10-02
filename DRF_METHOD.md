# EchoMap DRF 시뮬레이터 방법과 재현 조건

DRF 시뮬레이터는 simulator, estimator, evaluator를 분리한 브라우저 실험 도구이다. 화면의 소속 표기는 한양대학교 WSL이다. 추정기는 측정 range와 추정 차량 위치만으로 Direct Residual Field를 누적한다. `wall-shape-model-free`는 추정기가 벽 모양을 입력받지 않는다는 뜻이다. Simulator의 cubic spline 벽과 평가용 corridor prior까지 모델이 없다는 뜻으로 확장하지 않는다.

권위 문서로 지정된 `메인 알고리즘`과 `bspline_specular.m`, `smoke_spline_field.m`, `sweep_spline_field.m` 원본은 제공되지 않았다. 현재 구현 근거는 사용자 첨부의 식, 숫자 fixture와 truth-side 생성기 명세이다. MATLAB R2025b의 `spline` 계수는 직접 비교했지만 원본 전체 구현과의 parity는 미검증이다.

## Input, Output, 좌표와 배열

기준 장면은 world coordinate system의 `[0,60] × [0,30]` m 영역이다. 아래 벽 knot 높이는 `[8,6,9,7.5,10,8,7]`, 위 벽은 `[22,24,21,23.5,20,22.5,23]`, knot x는 `0:10:60` m이다. `notAKnot`은 cubic interpolating spline이며 B-spline 근사가 아니다. 같은 길이의 x/y 입력에 not-a-knot 경계조건을 쓰는 [MATLAB spline 문서](https://www.mathworks.com/help/matlab/ref/spline.html)에 따른다. 랜덤 장면은 이 knot 높이를 seed로 ±0.5 m 이내에서 변경하는 탐색용 장면이며 참조 통계 비교 대상에서 제외한다.

차량 ID v=1,2,3의 참 위치는 x=4,7,10 m에서 출발해 snapshot마다 0.75 m씩 증가한다. y는 `15 + 2 sin(2πx/30 + v)` m이다. 새 명세의 0-based 궤적 인덱스에 1을 더한 ID이며 RNG와 wire에서도 이 ID를 유지한다. 기본 입력은 차량 3대, snapshot 80개, isotropic 위치 표준편차 0.1 m, range 표준편차 0.1 m, roughness 2°, intensity 10/m, 목표 cell 길이 0.02 m, resolution 0 m, specular true, seed 1이다. 기준 추정기 설정은 격자 150×150, band 4, exact perimeter이다. grid/band/perimeter는 입력 envelope에 보관하지만 벽과 측정 생성식에는 사용하지 않는다. UI가 허용하는 범위는 차량 2–20대, snapshot 1–80개, 격자 100/150/200이다. 전체 실행은 기존 링크의 짧은 설정도 최소 80회로 연장하고 폼·URL·생성 입력을 같은 값으로 저장한다. 한 step과 그 실행의 계속 실행은 지정한 횟수를 유지한다. 기존 160회 참조 통계는 비교 조건을 유지하기 위해 명시적으로 60 snapshots를 사용한다.

추가 차량 ID v=4,…,20은 x0=1+13(v−4)/16 m에서 출발하고 같은 0.75 m/snapshot 이동식과 y 식을 사용한다. 고정 슬롯을 쓰므로 차량 수나 전체 snapshot 수를 바꿔도 공통 차량의 궤적과 RNG 주소는 바뀌지 않는다. t=1,…,60에서 모든 참 위치가 corridor 내부에 머문다. 이후에는 x=60 m에서 끝나는 유한 벽의 열린 출구를 통과하며 닫힌 끝벽이나 벽 외삽은 추가하지 않는다. t=80의 기본 3대 x는 64/67/70 m, 20대 x 범위는 61–74 m이다. 기존 60개 시점의 truth/wire prefix와 필드는 유지한다. 이들은 점 차량이며 실제 차량의 차폭, 충돌 회피와 무선 접속 스케줄을 모사하지 않는다. 160회 참조 통계는 기본 3대 조건이며 20대 단일 실행을 그 통계와 혼용하지 않는다.
입력 제한은 위치/range 표준편차 각각 0–2 m, roughness 0–20°, intensity 0–30/m, cell step 0.005–0.2 m, resolution ablation 0–2 m, seed uint32이다. 두 표준편차를 동시에 0으로 만들 수 없다. 실제 cell의 양의 residual variance 조건은 field가 추가로 검사한다.

- 위치와 산란점: 길이 2의 `[x,y]`, 단위 m.
- Pose covariance: `[xx,xy,yy]`, 대칭 2×2 행렬 `[[xx,xy],[xy,yy]]`의 압축 표현, 단위 m², positive semidefinite 조건.
- Range와 표준편차: `dHat`, `sigmaD`, 단위 m. Roughness는 계산 시 rad, UI 입력과 표시는 deg.
- 곡률 κell, κΓ, Δκ는 1/m, Theorem 2 scale varsigma는 m, ratio z는 무차원.
- Spline span: `C`는 4×2 power basis 계수이며 `s(u)=[1,u,u²,u³] C`. u는 무차원이다. `evaluate`는 `s`, `t=s′(u)`, `dd=s″(u)`를 반환한다. Span 번호는 1부터, 벽 번호는 아래 0과 위 1부터 시작한다.
- Grid: x/y는 길이 nx/ny의 Float64Array, flattened index는 `iy*nx+ix`, y 증가 순서. 기준 cell center는 x=`(ix+0.5)*0.4`, y=`(iy+0.5)*0.2` m.
- 누적 D/A는 길이 G=`nx*ny`의 Float64Array. 화면 전송 Dbar/β̂는 같은 길이의 Float32Array. D, A, Dbar와 prefactor α의 단위는 1/m²이며 β̂는 무차원 비율이다. β̂를 확률, posterior, occupancy로 해석하지 않는다.
- Field 출력: `{t,Dbar,betaHat,Q,admitted,rejected,epsilonA,ms}`. `Q`, 채택 수, 거부 수는 실행 시작 이후 누적 정수이다. 시간 측정 `ms`는 실행 시간이며 물리적 snapshot 간격이 아니다.

## 정보 경계와 인과성

`scenario.worker`가 truth와 measurement wire를 만들어 Main에 반환한다. `field.worker` 초기화에는 격자와 band/perimeter만, 각 step에는 현재 wire만 전달한다. `eval.worker`는 별도로 전체 truth-side scenario를 받고 현재 field 출력의 t까지 평가한다. UI의 참값 표시와 평가는 추정기 입력에 연결되지 않는다. 추정기에 벽, 참 위치, 산란점, path 라벨, w, N, roughness, intensity, Δκ, seed를 전달하지 않는다.

```text
wire = {
  t,
  configs: [{
    i, j,
    pHat_i: [x,y], pHat_j: [x,y],
    Sigma_i: [xx,xy,yy], Sigma_j: [xx,xy,yy],
    paths: [{dHat,sigmaD}]
  }]
}
```

`makeWire`는 위 속성만 복사하고, 다른 속성은 읽지 않는다. 유효하지 않은 차원, 비유한 수, indefinite covariance를 거부한다. `createField.step`도 이 경계를 다시 적용한다. Field는 `t=1,2,...`를 한 번씩 순서대로 처리한다. 잘못된 snapshot에서 예외가 발생하면 이전 D/A, Q, t를 유지한다. 미래 wire를 변경하거나 NaN으로 오염시켜도 처리한 prefix의 출력은 바뀌지 않아야 한다.

Simulator가 전체 시나리오를 먼저 생성해도 field에는 현재 snapshot 하나씩만 전달된다. Evaluator의 truth cursor도 현재 field의 t까지만 이동한다. GT는 평가 열과 오차 계산에만 사용하며 admission, band, kernel, proxy threshold를 GT로 조정하지 않는다.

과거 hover는 Float32 Dbar/β̂에서 D/A를 역산하지 않는다. 별도 field worker가 해당 시점까지의 measurement prefix를 1-cell Float64 field로 재생한다. β̂에는 원래 전체 격자의 `epsilonA`를 사용한다. 입력은 격자 index, 수치 설정, measurement prefix와 추정기 출력 `epsilonA`이며 truth나 미래 snapshot을 포함하지 않는다.

## 첨부 F번호와 코드 대응

첨부에 실제로 정의된 번호 F10–F41을 사용한다. 별도 F1–F18 식은 제공되지 않았다.

1. **F10–F11, admission:** `createField.step`, `pathFieldPoint`. 추정 초점 거리 ρ̂를 계산하고 `dHat≤ρ̂`를 거부한다. b_min gate는 없다. Q에는 채택된 path만 포함한다.
2. **F16–F22, 타원 둘레:** `ellipsePerimeter`, `ellipticE`. `a=dHat/2`, `m=(ρ̂/dHat)²`, `P=4aE(m)`. E의 입력은 modulus가 아닌 parameter m이며 AGM으로 계산한다.
3. **F23, 비교 옵션:** `ellipsePerimeter(...,'ramanujan')`. Ramanujan 근사이며 기본은 `exact`이다.
4. **F24–F33, path field:** `geometry`, `pathFieldPoint`, `createField.step`. Residual, 위치오차 전파, gradient, Gaussian kernel, prefactor를 계산한다.
5. **F36–F38, 누적:** `createField.step`. 현재 snapshot의 deltaD/deltaA를 먼저 계산하고 유효성이 확인된 뒤 D/A와 Q에 반영한다.
6. **F39–F40, readout:** `createField.readout`, `createField.inspect`. Dbar와 β̂를 계산한다. 초기 또는 A=0인 cell의 β̂는 0이다.
7. **F41, configuration factorization:** `createField.step`. Configuration 안의 모든 path에 동일 sigmaD를 요구한다. 이 조건을 위반하면 예외를 발생시킨다.

Grid cell x에서 추정 초점 i,j까지 거리는 rᵢ,rⱼ이고, guard가 적용된 방향은 `eᵢ=(x−pHat_i)/max(rᵢ,1e−9 m)`이다. Focal guard는 나눗셈에만 적용하며 range나 model noise를 추가하지 않는다.

$$
\rho_q(x)=r_i+r_j,\qquad r_q(x)=\rho_q(x)-\hat d_q,\qquad g_q=e_i+e_j.
$$

$$
\sigma_{r,q}^2=\sigma_{d,q}^2+e_i^T\Sigma_i e_i+e_j^T\Sigma_j e_j,
\qquad
K_q=\exp\left[-\frac{r_q^2}{2\sigma_{r,q}^2}\right].
$$

$$
\alpha_q=\frac{\lVert g_q\rVert}{P_q\sqrt{2\pi}\sigma_{r,q}},
\qquad u_q=\alpha_qK_q,
\qquad D_t=D_{t-1}+\sum_{q\in\mathcal Q_t}u_q,
\qquad A_t=A_{t-1}+\sum_{q\in\mathcal Q_t}\alpha_q.
$$

$$
Q_t=Q_{t-1}+\#\mathcal Q_t,\quad
\bar D_t=\frac{D_t}{\max(Q_t,1)},\quad
\epsilon_A=10^{-12}\max_x A_t(x),\quad
\hat\beta_t=\frac{D_t}{A_t+\epsilon_A}.
$$

`𝒬_t`는 현재 snapshot에서 채택한 path 집합이다. 마지막 비율의 분모가 0이면 구현은 0을 반환한다. 수치 Gaussian은 underflow로 K=0이 될 수 있으므로 계산 assertion은 `0≤K≤1`이다. 모든 cell에서 residual variance가 유한하고 양수여야 한다. 전체 noise를 0으로 만든 설정은 이 kernel에 정의되지 않는다. Wire는 차량 간 cross-covariance를 지원하지 않으며 기준 simulator의 위치오차는 차량과 snapshot마다 독립이다.

동일 sigmaD 조건에서 configuration의 `ρ(x)`, `g(x)`, `σr(x)`는 path와 독립이다. `A(x)=f(x) Σq(1/Pq)`, `f=norm(g)/(sqrt(2π) σr)`로 계산하고 A는 full field에 누적한다. D는 range 순으로 정렬한 path 중 `abs(r)≤cB σr`에 해당하는 path만 갱신한다. cB는 3/4/5/full 중 수치 설정이며 물리 상수가 아니다. 동일 A에 대한 full/truncated β̂ 차이의 이론 상한은 `exp(−cB²/2)`이다. `1/Pq`를 정확한 unit mass라고 설명하지 않는다.

이 추정기는 최적화 objective나 벽 fitting을 풀지 않는다. Tangency weighting, forgetting, snapshot당 1/M 보정, 양의 model-noise 항, Gaussian train 대체는 사용하지 않는다.

## Spline, 정반사와 가시성

`notAKnot`/`graphSpans`가 기준 graph wall을 만들고 `bsplineSpans`는 uniform cubic B-spline의 `C=M Q`를 제공한다. 일반 닫힌 동굴 UI와 그 장면의 extractor 검증은 구현 범위에 포함되지 않는다. Span AABB는 Bezier control point convex hull로 계산한다.

`specularPolynomial`은 참 위치 pT,pR와 span 접선 v로 `a=s−pT`, `b=s−pR`를 정의하고 다음 Fermat's principle 조건의 다항식을 만든다.

$$
P_k(u)=(v\cdot a)(v\times b)+(v\cdot b)(v\times a).
$$

다항식 차수는 일반 cubic parametric span에서 최대 9, graph wall에서 최대 8이다. `rootInfo`는 power basis를 Bernstein basis로 바꾸고 de Casteljau subdivision으로 단순근을 분리한다. Bisection/Newton과 `refineSpecularRoot`의 unsquared Fermat residual을 함께 사용한다. Newton은 최대 5회이며 곡률/range 항의 상쇄로 미분값이 Float64 floor 이하이거나, 후보가 [0,1] 밖으로 나가거나, 정규화 잔차가 이전 값과 floor 중 큰 값보다 나빠지면 중단한다. 최종 정규화 Fermat 잔차 `abs(v dot g)/(norm(v)*norm(g))`가 `64*Number.EPSILON`보다 크거나 유한하지 않으면 그 점은 방출하지 않고 `unresolved`를 증가시킨다. g는 두 leg 단위벡터의 합이다. Companion eigenvalue나 imaginary threshold는 사용하지 않는다.

중근은 derivative stationary point와 Float64 roundoff에 따른 불확실성 구간을 사용해 처리한다. `nearMultiple`, `unresolved`, `degenerateSpans`를 보고하며 near-multiple cluster도 unresolved 진단에 더한다. 이 진단을 정확한 누락근 개수로 해석하지 않는다. 기준 장면 regular root에서 측정한 1e−15 수준 잔차를 임의 장면과 ill-conditioned root의 보편적 정확도로 주장하지 않는다. 공유 경계점은 중복 제거하고 마지막 열린 graph span의 u=1 끝점은 포함한다. 이는 첨부의 모든 span `[0,1)` 표기와 마지막 `[50,60]` 표기를 일관되게 처리하기 위한 endpoint convention이다.

`specularPoints`는 `(v×a)(v×b)>0`인 same-side 근만 남기고 두 차량 leg 모두의 visibility를 검사한다. `visible`은 line/span 교차의 cubic 근을 구하고 leg parameter `λ∈(1e−9,1−1e−7)`에 교차가 있으면 차단한다. Collinear overlap도 차단한다. 진단의 `cosθ=norm(a/ra+b/rb)/2`, `κell=cosθ(1/ra+1/rb)/2`, `Δκ=κell−κΓ`에서 κΓ는 벽이 차량 쪽으로 휠 때 양수이다. Δκ의 부호를 보존한다.

Visibility는 Float64 판정이며 임의로 작은 gap을 정확히 구분하지 못한다. 특정 1e−15 m gap 검사에서는 다항식 근의 roundoff 불확실성으로 실제 교차 없이 보수적으로 차단했다. 이 범위의 visibility를 exact geometry 보장으로 표시하지 않는다.

## Diffuse cell과 난수

`diffuseProfile`은 각 cell의 midpoint에서 facet tangent mismatch를 계산한다. uT,uR은 모두 산란점에서 차량 쪽으로 향하는 단위벡터이다. 따라서 `uR−uT`가 정반사에서 접선 방향이며 합 벡터를 그대로 접선으로 쓰지 않는다. 두 방향이 거의 같으면 `facetSinDelta`가 수학적으로 동등한 `sign(cross(uT,uR))*perp(uT+uR)` 표현을 사용해 cancellation을 줄인다. 정의되지 않은 방향이나 유한하지 않은 tan²δ의 intensity는 0이다.

$$
w_n=\exp\left[-\frac{\tan^2\delta_n}{2\sigma^2}\right],\quad
\Delta s_n=\lVert s'(u_n)\rVert\Delta u_n,\quad
\Lambda_n=\lambda_0w_n\Delta s_n.
$$

λ₀의 단위는 1/m, Λ는 Poisson 평균인 무차원 수이다. w는 facet slope tanδ에 대한 Gaussian 형태의 선택 가중치이며 정규화된 pdf, 확률, posterior 또는 occupancy가 아니다. 실행은 Simpson 호길이 표의 역보간으로 cell 경계를 만들고 midpoint speed로 Δs를 가중한다. Cell 기하는 configuration 간 재사용하고 w/Λ는 참 위치에 따라 매번 계산한다. 이는 연속 intensity의 cell quadrature 근사이다. Cell 안의 u는 균일하게 샘플링하고 점은 벽 곡선 위에 놓으며 법선 방향 변위는 없다. ΣΛ 숫자 fixture는 별도로 `partition='x'`, Δx=0.02 m를 사용한다. 두 partition의 숫자를 bit 동일하다고 요구하지 않는다.

정반사근은 연속 u에서 정의되므로 고정 cell midpoint가 임의의 근과 정확히 겹친다고 요구하지 않는다. 평평한 벽의 거울상 해와 연속 근의 sinδ를 비교하고, cell step 0.04/0.02/0.01 m에서 근과 최근접 midpoint의 거리가 반 cell 이내인지 확인한다. Grid 정렬 위치에 따라 이 거리는 단조 감소하지 않을 수 있다. 고정 cell에서 sinδ=0인 표본을 반드시 찾는 검사는 사용하지 않는다.

`sampleDiffuse`는 벽마다 전달된 cell들의 합 Λ로 `N~Poisson(ΣΛ)`를 뽑고, 누적 intensity 이분탐색으로 cell을 선택한 뒤 cell 내 u를 뽑는다. Mean이 30을 넘으면 평균 30 이하인 독립 Poisson 변수들의 합을 사용한다. Same-side와 visibility로 thinning한다. σ=0 또는 λ₀=0이면 diffuse를 만들지 않는다. 유한한 Bernoulli 시도를 Poisson으로 부르지 않는다. Snapshot마다 별도 stream을 사용하며 시간 결합은 없다.

선택적 `diagnostics.generated`는 thinning 전 Poisson draw를 기록한다. Truth configuration의 `diffuseSampling.beforeThinning`과 `afterThinning`은 각각 `[아래 벽 수, 위 벽 수]`이다. 기존 `generated.diffuse`는 thinning 후, resolution 병합 전 두 벽 합계라는 의미를 유지한다. `truth.diffuse.length`는 병합까지 적용한 최종 diffuse 수이다. Poisson 평균/분산을 ΣΛ와 비교할 때는 `beforeThinning`을 사용한다. 진단 기록은 난수를 추가로 소비하지 않으며 wire에 복사하지 않는다.

`createRng`는 seed와 stream 주소로 초기화하는 xoshiro128**이다. 주소는 `JSON.stringify([seed,...parts])`로 직렬화하고 각 문자의 UTF-16 code unit에 FNV-1a를 적용한다. 초기값은 2166136261, 곱셈 상수는 16777619이며 모든 연산은 uint32이다. 네 state word는 해시에 차례로 `0x9e3779b9`를 더한 뒤 xor-shift와 `0x21f0aaad`, `0x735a2d97` 곱셈을 적용해 만든다. 정확한 shift 순서는 `rng.mjs`의 재현 규약이다. Uniform은 `(output+0.5)/2^32`로 열린 구간 (0,1)에 있고, Box–Muller normal은 cos 값을 먼저 반환한 뒤 sin 값을 다음 호출까지 보관한다. Stream 주소는 다음과 같다.

- 위치: `(seed,'pose',t,v)`, 차량 ID v=1,…,V, V≤20. 기존 세 차량의 주소는 유지한다.
- 정반사 표준잡음: `(seed,'specNoise',t,i,j)`.
- Diffuse 생성: `(seed,'diffuse',t,i,j,wall)`, 벽마다 독립.
- Diffuse range 표준잡음: `(seed,'diffNoise',t,i,j)`.
- Wire 순서 섞기: `(seed,'shuffle',t,i,j)`.
- 탐색용 랜덤 벽: `(seed,'wall')`.

Configuration은 `1≤i<j≤V`를 i, j 오름차순으로 순회한다. 기본 3대에서는 `(1,2),(1,3),(2,3)` 순서이고 monostatic은 없다. 20대에서는 snapshot마다 190쌍이다. 정반사점은 span 순회와 근의 u 순서, diffuse 점은 아래 벽에서 위 벽 순서이며 각 벽 내부에서는 Poisson draw의 생성 순서를 유지한다. 정반사와 diffuse를 이 순서로 연결하고 각 유형의 noise stream에서 z를 배정한다. Range는 모두 참 위치로 계산하고 σd는 모든 path 유형에 동일하게 적용한다. 랜덤 벽 stream은 각 knot에서 아래/위 높이 잡음을 번갈아 소비한다.

같은 seed에서 σ 또는 σd를 바꿔도 pose 표준잡음과 정반사 표준잡음은 동일하다. Path resolution ablation은 기본 OFF이며, ON일 때 noise-free range를 stable sort한 뒤 직전에 채택한 range와 εres 미만인 path를 버린다. 채택점에는 병합 전에 배정한 z를 그대로 사용한다. 마지막 Fisher–Yates shuffle로 wire의 path 순서를 섞고 label을 제거한다. 이 ablation을 실제 레이더 MPC 분해능 검증으로 해석하지 않는다.

Bit 단위 재실행은 같은 코드와 설정, 같은 JS engine/libm 조건에서 확인한다. 실제 같은 브라우저의 기본 60 snapshot 두 실행은 measurement와 truth가 정확히 같았다. 서로 다른 engine의 sin/log 등 구현은 Float64 끝자리 차이를 낼 수 있다. HTTP 다운로드와 Node의 truth/wire 대조에서는 수치 요소 256개가 달랐고 최대 절대 차이 7.105427357601002e−15, 최대 상대 차이 4.756225964505287e−16이었다. Shape와 비수치 값은 모두 같았다. 이를 모든 브라우저에서 truth/wire의 bit 동일성이 보장된다는 주장으로 바꾸지 않는다. 해당 기본 실행의 최종 Dbar/β̂ Float32 SHA는 동일했다.

참조 sweep은 모든 조건에 같은 grid, seed 목록, admission, band와 perimeter 설정을 적용한다. Simulator 조건만 바꿔 동일 추정기를 비교한다. Perimeter 근사나 resolution ablation을 켠 결과는 기본 참조 결과와 분리한다.

## 평가용 proxy와 진단

`outerPeak`는 y<15 / y≥15의 각 반쪽 열에서 최대값의 0.5 이상인 local maximum 중 가장 바깥 것을 고른다. 인접한 두 값보다 크거나 같고, 적어도 하나보다 엄격히 커야 한다. 3점 포물선 보간 displacement를 ±0.5 cell로 제한한다. 이는 **corridor prior를 사용하는 평가용 proxy이며 최종 extractor는 미확정**이다. 이 prior는 estimator 누적식에는 들어가지 않는다.

평가 열은 x∈[10,50] m이고, t까지 같은 벽의 정반사점 x가 ±0.4 m 이내에 생긴 열이다. 아래/위 벽을 별도로 집계한다. Proxy 절대 y 오차의 중앙값, 정렬 후 `ceil(0.95*n)`번째 P95, 오차>0.5 m 비율을 계산한다. 관측된 열에 proxy가 없으면 Infinity 오차와 failure로 기록해 성공 표본에서 제외하는 방식으로 성능을 높이지 않는다.

`offset`은 참 벽 y의 ±1.5 m 창 안에서 Dbar의 격자 열 최대값을 고른 signed y offset의 **평균**이다. 아래 벽의 y 증가와 위 벽의 y 감소가 안쪽 양수이다. 이 peak에는 proxy의 포물선 보간을 적용하지 않는다. 제공 참조 +0.139 m의 집계 원본은 확인되지 않았다. Seed 1, σ0°, σd=0.1 m에서 같은 188열의 평균은 +0.233710 m, 중앙은 +0.141950 m였으며, 참조에 맞추기 위해 평균을 중앙값으로 바꾸지 않았다.

`wall_metrics.js`의 GT arc samples는 0.2 m 간격이다. 현재까지의 정반사와 diffuse hit에서 거리 1.0 m 이내인 GT를 observed mask로 누적한다. Boundary tolerance는 0.4 m이다. Precision은 모든 prediction→전체 GT, recall은 observed GT→prediction으로 계산한다. CA-MSD는 두 directed mean의 평균, CA-HD95는 두 directed P95의 최댓값이다. 서로 다른 GT support를 쓰므로 표준 ASSD/HD95와 구분한다. 이 mask와 specular-observed 열은 서로 다른 평가 정의이다.

Theorem 2 진단은 같은 벽의 가장 가까운 정반사점을 Euclidean 거리로 짝짓고, `abs(x−x*)≤4σ/abs(Δκ)`를 통과한 diffuse 표본에서 다음 signed 비율을 계산한다.

$$
\varsigma=\frac{\cos\theta\,\sigma^2}{\Delta\kappa},\qquad
z=\frac{\rho-\rho^*}{\varsigma}.
$$

`abs(Δκ)≤1e−9` 또는 `abs(varsigma)≤1e−15`인 비율은 계산하지 않는다. 음수 Δκ를 일괄 제거하거나 분모만 절댓값으로 바꾸지 않는다. 비율의 χ²₁ 평균 1과 중앙 약 0.455는 국소 quadratic/linear 근사의 진단 기준이며 유한 roughness, 경계, 여러 root가 가까운 구간에서 정확한 분포를 보장하지 않는다. 제공 수용 기준은 σ2°에서 평균 `1±0.05`, 중앙 `0.43±0.04`이다.

Diffuse count 예측은 정반사점마다 `λ₀ sqrt(2π) σ / abs(Δκ)`를 합한다. Fold 예측은 기준 isotropic 잡음에서 `0.765 sqrt(2) σr / (2 cosθ)`를 사용한다. Visibility, 유한 벽 길이, 겹치는 국소 구간의 효과를 없앤 정확한 count/offset 식으로 해석하지 않는다.

## 계산량, 메모리와 실험 범위

C는 snapshot당 차량 pair 수, G는 grid cell 수, P는 configuration당 path 수, B는 band 안의 grid/path 방문 수이다. Field의 snapshot 계산량은 `O(C*(P log P + G log P) + B)`, scratch 메모리는 `O(G+P)`이다. D/A와 transactional deltaD/deltaA 네 Float64Array를 유지한다. Full mode에서는 B가 `C*G*P`까지 증가한다.

Simulator는 configuration마다 M개 quadrature cell과 방출 표본을 처리한다. S개 wall span과 root 비용 R을 두면 최악 visibility 비용은 path당 `O(SR)`, categorical 선택은 `O(log M)`이다. Poisson sampling 비용은 기대 방출 수에 비례한다. Root degree는 9 이하이나 ill-conditioned/multiple roots의 처리 시간과 정확도는 별도 진단 대상이다. Not-a-knot dense solve는 `O(K³)`이며 기준 K=7이다.

단일 실행에서 두 Float32 field history의 비용은 `8*T*G` bytes이다. 기본 80×150²에서는 14.4 MB, 최대 지원 80×200²에서는 25.6 MB이다. 기존 60×150²의 10.8 MB와 비교하면 field history만 33.3% 증가한다. 이는 전체 RAM 사용량이 아니다. Truth/wire는 `O(T*C*P)`, evaluator의 모든 누적 ratio history를 보관하면 최악 `O(T²*C*P)`, proxy/observed history와 worker 복사본도 추가된다. 현재 입력 범위에서는 T*G≤3.2×10⁶이므로 첨부의 5×10⁶ keyframe 조건에 도달하지 않는다. 범위 확장 시 keyframe 저장이나 메모리 제한을 먼저 구현해야 한다.

`runExperiment`는 field frame history를 보관하지 않는다. Browser sweep pool은 기본 `hardwareConcurrency−1`개 worker를 사용하며 실행 중 cancellation은 worker를 종료한다. Worker가 보낸 final 두 field는 pool의 완료 record에서 제거하고 scalar summary만 보관한다. 따라서 UI의 완료 job 보관 비용은 `O(J)`이며 J는 완료한 job 수이다. 개별 worker 실행의 임시 field와 truth 비용은 별도로 남는다. Node runner도 final field를 SHA-256으로 축약하고 scalar summary만 저장한다. 실제 메모리와 실행 속도는 장면, path 수, worker 수, 기기에서 측정해야 한다.

Snapshot index와 0.75 m/snapshot은 물리적 Δt를 지정하지 않는다. 레이더 carrier/bandwidth, 동기화, clock drift, 차량 간 상관 위치오차, 검출 누락, latency, 실제 MPC resolution과 hardware calibration은 검증하지 않았다. 이 도구의 simulator 일치를 실제 장비 성능으로 주장하지 않는다.

## 화면과 기본 보기

데스크톱 사이드바는 342 px로 설정만 표시한다. 상단 행은 RAW와 우측 성능창으로 구성하고, 성능창은 화면 폭에 따라 240–300 px이다. 현재 Q, 채택/거부 수, path 구성, 평가 6지표와 계산 시간을 성능창에서 함께 표시한다. 하단 Dbar, β̂와 시간별 평가 그래프는 그 아래 전체 폭에 맞추며 상하 행 비율은 1.9:1이다. RAW의 x/y 1 m는 같은 화면 길이이다. 하단 두 필드도 기본 등척이며 전체 x=0–60 m를 표시한다. 평가용 참벽 표시를 켜면 그 벽 범위, 끄면 공개 계산 영역 [0,60] × [0,30] m를 자동 보기의 시작 범위로 사용한다. 차량 표시를 켠 RAW는 선택 시점까지의 측정 pHat 범위를 합쳐 출구를 지난 차량도 표시한다. 미래 관측이나 숨겨진 truth 위치는 이 범위 확장에 사용하지 않는다. 표시용 참벽과 camera는 추정기 입력에 연결되지 않는다. 선택 가능한 `필드 채움`은 하단 필드의 x/y 화면 배율을 독립적으로 사용한다. 거리 지도 x/y 격자와 profile x 격자는 10 m 간격이며 휠 확대에도 물리 간격은 유지한다.

최초 CSS 크기와 RAW의 최종 등척 크기 사이에서 작은 그래프 틀이 잠깐 보이는 것을 막기 위해 `#mapCanvas[data-view]`가 준비될 때까지 dashboard의 그래프 틀을 숨긴다. 우측 성능창의 실행 상태와 측정 생성 시간은 로딩/오류 안내를 위해 계속 표시한다. 첫 camera와 표시 크기를 계산한 뒤 그래프 행을 공개하며 초기화 중 가짜 필드나 관측은 만들지 않는다.

`처음으로`는 실행 전에도 활성화하며 세 지도의 확대와 이동만 기본 보기로 복원한다. 선택 snapshot, 누적 기록, 설정, 실행/일시정지 상태, 재생과 진행 중 worker를 그대로 유지한다. 진행 중인 계산은 원래의 live-follow 설정대로 계속된다. 축소 버튼과 마우스 휠은 현재 plot 크기와 표시 범위의 기본 배율 아래로 축소하지 않는다. 그 하한에서 휠로 다시 축소하면 해당 지도의 기본 중심과 배율을 복원한다. 하단 Dbar와 betaHat의 확대, 축소, 처음으로 버튼은 각 지도만 조작한다. 현재 snapshot과 계산 기록은 유지한다.

## 검증과 내보내기

```bash
npm run build:drf-offline
npm test
npm run test:legacy-dom
node tests/drf/run-reference.mjs --seed-count 10 --workers 3
node tests/drf/run-endpoint.mjs
python3 -m http.server 8871 --bind 127.0.0.1
```

HTTP(S)는 module 앱/Worker를 사용하고 `file://`은 `drf/offline.bundle.js`의 classic 앱과 4종 Blob Worker를 선택한다. JSON metadata를 bundle에 포함하고 원본 22개 파일 SHA로 오래된 생성물을 검출한다. 실제 file 화면의 실행은 도구의 프로토콜 제한으로 미검증이며 HTTP classic harness 결과와 구분한다.

`numeric.test.mjs`는 spline/span fixture, 평평한 벽 적분과 derivative, t=30 네 가시 정반사점, 중근과 경계근, Poisson/normal/categorical 검사를 포함한다. 이전 닫힌 24-control spline의 자체 seed 내부 300쌍 검사는 독립 physical-residual bracket의 1824/1824근과 일치했다. 최대 u 차이는 6.11×10⁻¹⁵, 최대 `abs(sinδ)`는 4.03×10⁻¹⁶이었다. 제공 Octave의 2040근 검사와 같은 pair 표본이라는 주장은 하지 않는다. Field 검사는 scalar fixture, AGM, factorized A, band bound, causal prefix, oracle getter 격리와 prefix hover를 포함한다.

model8 배포 당시 자동 검사는 113/113 통과, 실패 0, 실행 시간 16.108287 s였다. `truth-model.test.mjs`의 7개 검사는 실제 flat/curved profile의 thinning 전 Poisson 평균/분산, categorical CDF, 곡선 위 점과 same-side/visibility, 차폐 전 생성 수 보존, 재실행/prefix/call-order/추정기 설정 불변성, 0 roughness/intensity의 난수 미소비를 포함한다. Near-caustic Newton 검사 1개를 추가했으며 classic Blob scenario Worker의 2 snapshot truth/wire도 module 경로와 정확히 같았다.

model8의 truth-side 진단과 근 보호, module/Worker 캐시 URL 수정 후 160회, 10-seed 실행은 완료 160/160, 오류 0, **96개 수용 조건 중 84개 통과, 12개 실패**였다. 이전 보고서와 160개 run의 input/summary/final 체크섬 및 aggregate/실패 행이 정확히 같았다. 중앙 절대오차, diffuse 수, 중복 비율, observed 비율과 σ2° Theorem 2 기준은 통과했지만 P95 3조건과 off-wall 9조건이 실패했다. 전체 reference acceptance는 실패이다. 최종 기록은 2026-10-02T02:14:22.179Z, 실행 시간 48.057688 s이며 수치 소스 11개의 실행 전후 SHA가 당시 파일과 같았다. 생성기 source가 바뀌면 같은 난수 소비와 기존 수치의 보존 여부를 회귀 검사하고 160회 실행을 다시 수행한다.

Runner는 browser sweep과 같은 `runExperiment`/`aggregateRuns`를 사용한다. Seed별 통계의 평균과 sample SD를 계산하며, 표준편차를 confidence interval로 부르지 않는다. 원본 참조 3-seed 집계 상세는 미확인이다. Runner 종료 상태는 실행/소스 오류 1, seed≥10에서 참조 수용 실패 2이다. 작은 `--seed-count` 실행은 smoke이며 통계 수용 검증으로 보고하지 않는다.

`drf/provenance.json`은 기준 Git commit, field/wire source hash와 core 묶음 hash를 기록한다. 배포 여부는 별도 증거로 확인한다. JSON은 input, measurement, result, evaluation, truth를 분리한다. CSV는 snapshot별 지표를 기록한다. PNG 버튼은 선택한 필드를 CSS 크기의 300/96 배로 다시 그린 뒤 `surf/exports.mjs`의 `png300dpi`를 적용한다. PNG의 pHYs 목표는 11811 px/m이며 metadata가 선명한 label이나 모든 chart의 내보내기를 자동 보장하지 않는다. 현재 clay UI는 Dbar의 warm 순차색과 β̂의 blue 순차색, 흰 plot 배경과 RAW/하단 필드의 기본 등척을 유지한다. 읽을 수 있는 label, 선 굵기, 선택한 표시축과 ±1 SD error bar는 실제 화면과 저장본에서 검사한다.

직전 표시 수정 후 자동 검사는 113/113 통과, 실패 0, 14.65061275 s였다. 실행 전/측정 준비 중 `처음으로`의 camera 복원과 설정/기록/worker 보존, 처리 중 결과 도착 뒤 첫 snapshot 선택 유지도 VM 회귀 검사에 포함한다. 수치 소스 11개의 SHA가 기존 160회 통계 보고서와 일치하므로 그 표시 수정에서는 160회를 다시 실행하지 않았다. 원본 22개 offline bundle과 44개 보호 파일 검사도 통과했다. 이전 schema 5 실제 화면 기록은 [density-validation.json](tests/drf/density-validation.json)의 schema 5이며, 이전 schema 4는 `previousLayoutEvidence`에 보존한다.

## 이전 20대 규모 확장 검증

차량 수 입력은 정수 2–20을 허용한다. 실제 생성기와 field 연결을 검사하는 `node --test tests/drf/fleet.test.mjs`는 190개 유일 차량 쌍, 쌍 간 공유 pHat, 기존 3대/5대 공통 쌍의 truth와 wire 일치, 미래 snapshot 설정 독립성과 유한 필드를 확인한다.

이전 20대, 60 snapshot, 150×150, seed 1의 Node 전체 실행은 187,631개 경로를 모두 채택했다. 생성 17.186 s, 전체 31.949 s, field snapshot p50/p95 217.028/232.608 ms였다. 모든 frame과 evaluation을 보존한 단일 Node process의 snapshot별 표본 RSS 최대값은 330,694,656 byte였다. 이는 browser Worker 복제 메모리나 정확한 process 최대 RSS를 측정한 값이 아니다. 최종 필드 SHA는 `3b3897843980dd07c6ac99c0a407ec0677f1750f73328fde6703c7d132c6c254`이다. 조건과 결과는 [fleet-validation.json](tests/drf/fleet-validation.json)에 기록한다.

새 생성기 source로 기본 3대 160회를 다시 실행했다. 완료 160/160, 실행 오류 0, 46.974087 s이며 기존 160개 input/summary/final 체크섬, aggregate와 실패 행이 정확히 같았다. 84/96 수용 조건 통과와 12개 미충족은 유지된다. 새 report의 실행 전후 수치 source SHA가 일치한다.

RAW 타원은 전체 측정 중 일정 stride로 최대 600개만 그린다. 현재 표시 개수와 전체 측정 개수를 제목에 구분한다. wire, 누적 field, evaluator와 JSON/CSV의 경로를 줄이지 않는다. 차량점과 궤적은 전부 유지하고 번호만 plot 내부의 빈 공간에 배치하며 자리가 없으면 번호를 생략한다.

차량 확장 후 `npm test`는 115/115 통과, 실패 0, 18.282778 s였다. 실제 20대 생성기 연결 검사와 표시 600개 상한, 전 차량점 유지, 번호 bbox/차량점 겹침과 plot 경계 검사가 포함된다.

차량 확장 수정 당시 HTTP module 화면에서 차량 20대, 60/60, Q=187631과 같은 최종 필드 SHA를 확인했다. 1920×930 content viewport에서 사이드바는 342 px, clientHeight/scrollHeight=876/876 px이고 28개 설정 컨트롤과 네 canvas가 모두 첫 화면에 보였다. 마지막 시점의 측정 4326개 중 타원 541개가 표시됐다. 생성 중 취소는 기록 0개와 실행 가능 상태로 돌아갔고, 완료 후 `처음으로`는 1/60을 선택하며 60개 기록을 유지했다. Console warning/error는 0개였다. 20대 수치 폭으로 하단 설명이 5 px 잘린 문제는 desktop section 상하 여백 2→1 px로 해결했다. 이 마지막 CSS/cache/bundle 수정 후 관련 7개 표시·버튼·offline 검사는 모두 통과했다. 실제 file 화면 검증으로 확대하지 않는다.

## 이전 보기 초기화와 축소 하한 수정

`처음으로`에서 첫 snapshot 선택, 재생 정지와 실행 일시정지를 제거했다. 세 지도의 camera 복원만 수행하므로 현재 시점과 기록, 입력, worker와 실행/재생 상태를 유지한다. 기본 배율은 현재 plot 크기와 표시 범위의 CSS px/m로 계산하며 버튼과 휠에서 두 축 모두 그 배율보다 작아지지 않게 제한한다. 화면 크기나 표시 범위 변경 때도 하한을 갱신한다. 이동 중심과 확대 anchor를 보존한다.

자동 검사 115/115 통과, 실패 0, 11.806166 s였다. VM에서 기록 없는 idle/준비 중과 done/paused/running/cancelled, 재생 rAF와 진행 중 field 요청 상태 보존을 확인했다. 실제 RAW/등척 Dbar/채움 betaHat 객체에서는 축소 버튼, 휠, 이동, 양방향 화면 크기 변경과 표시 범위 변경을 검사했다.

HTTP 실제 화면에서 기본 60 snapshot의 Q=2904와 최종 Float32 SHA는 그대로였다. 세 지도를 확대하고 이동한 뒤 `처음으로`를 눌렀을 때 60/60과 상태, 기록 및 수치는 그대로이고 세 camera가 기본 보기로 복원됐다. 59/60을 따로 선택한 검사도 그 시점을 유지했다. 반복 축소 버튼과 세 지도의 휠 축소는 초기 배율에서 멈췄다. Console warning/error는 0개였다. 상세 기록은 [view-reset-validation.json](tests/drf/view-reset-validation.json)이다.

수치 source 11개와 기존 160회 reference 보고서의 SHA가 일치하므로 수치 실험은 다시 실행하지 않았다. 기존 참조 수용 조건 12개 미충족도 그대로이다. offline 22개 source bundle을 다시 생성하고 검사했으며 실제 file 화면 검증으로 확대하지 않는다.

## 2026-10-02 주행 연장과 화면 조작 검증

기본/최대 snapshot 수를 80으로 늘리고 원래 0.75 m/snapshot 궤적, 벽 길이와 누적식을 유지했다. [run-endpoint.mjs](tests/drf/run-endpoint.mjs)는 2/3대와 seed 1–5의 10개 조건을 같은 80개 measurement wire로 인과적으로 누적하며 60번째와 80번째 결과를 비교한다. 끝단 x=55–60 m의 벽별 51개 평가 표본에서 현재까지 방출된 hit와 1 m 이내인 비율을 관측률로 정의한다. Proxy 오차는 해당 구간의 격자 13열에서 절대 y 오차로 측정하고 0.4 m 기준 recall을 함께 기록한다. 추출 누락은 Infinity 실패로 보존한다. 모든 GT, 관측 mask와 끝단 진단은 평가에만 사용한다.

[endpoint-validation.json](tests/drf/endpoint-validation.json)의 10개 조건에서 양벽 끝단 관측률은 0%에서 100%로 증가했다. 기본 3대/seed 1의 아래/위 벽 proxy P95는 5.852/5.174 m에서 0.0589/0.1354 m로 감소했고, Q는 2904에서 3609로 증가했다. 같은 조건의 내부 x=10–50 m P95는 0.829에서 0.937 m로 증가했다. 2대에서는 관측률 100%에도 proxy 모호성이 남으므로 전체 정확도 개선이나 최종 wall extractor 성능을 주장하지 않는다. 독립 60/80 생성의 첫 60개 truth/wire와 기존 최종 필드 SHA가 같고, 미래 truth 추가가 실제 60번째 평가 출력에 영향을 주지 않는 것도 검사했다.

주행 연장과 성능창 이동 당시 `npm test`는 117/117 통과, 실패 0, 17.856888625 s이다. 새 source로 명시적 60 snapshot 조건의 160회 참조 실험도 다시 실행했다. 완료 160/160, 실행 오류 0, sourcesStable=true, 47.503462416 s이며 이전 input/summary/final, aggregate와 comparisons가 모두 같다. 참조 수용 조건은 84/96 통과, 기존 12개 미충족을 유지한다. 현재 보고서는 [validation-results.json](tests/drf/validation-results.json)이다.

HTTP 1920×930 화면 검사에서 우측 성능창의 clientHeight/scrollHeight는 484/484 px, 설정 사이드바는 876/876 px이고 평가 라벨은 한 줄이다. 기본 80/80 실행의 Q=3609와 Float32 field SHA `99ed8989b86da39ddd824608f05bf6178ca2efc06b07e50de69b858246755049`는 Node와 일치했다. 휠 축소 하한에서 해당 지도 기본 보기로 복원하고 하단 지도별 −/＋/처음으로가 현재 snapshot과 기록을 유지한다. [view-controls-validation.json](tests/drf/view-controls-validation.json)의 `finalEndpointAndPerformanceLayout`에 최종 117개 검사와 새 성능창 검사를 기록했으며 초기 116개 검사와 이전 배치 증거는 따로 유지한다. 이 절은 로컬 HTTP/Node 검증이며 공개 배포 완료나 실제 file 화면 실행을 의미하지 않는다.

## 그래프 간격 고정

RAW가 물리적 종횡비에 맞춰 바깥 카드까지 줄이던 크기 조정식을 제거했다. CSS grid가 카드의 전체 크기를 정하고 등척 camera는 그 내부에서만 계산한다. 상단 RAW와 성능창의 바닥/양끝을 하단 세 그래프에 맞추고 가로/세로 카드 간격을 모두 10 px로 유지한다. 진단 그래프 사이도 10 px이다.

이 수정 후 `npm test`는 116/116 통과, 실패 0, 3.691665959 s였다. 제거한 크기 helper의 단위 검사 1개를 삭제하고 실제 renderer 검사에서 카드/본문 style을 변경하지 않는지 확인한다. 마지막 CSS 간격 변경 뒤 관련 표시 검사 3개도 통과했다. HTTP의 실행 전/80회 완료/확대 상태와 1920×930, 1920×1080, 1440×900, 모바일 세로 배치에서 간격 10 px를 확인했다. 실제 80회 필드와 Q는 이전 결과와 같고 추정기 source 11개는 변경하지 않았다. [uniform-spacing-validation.json](tests/drf/uniform-spacing-validation.json)에 로컬 증거를 기록한다.

표시 레이어 체크는 그리기만 제어한다. 장면의 표시 extent와 RAW의 현재/과거 noisy pose 범위는 체크와 무관하게 camera 및 기본 축소 하한에 사용하며 추정기 입력에는 포함하지 않는다. 따라서 참 벽을 숨기거나 차량·궤적을 숨겨도 확대/이동 상태가 바뀌지 않는다.

화면의 벽 후보점은 누적 필드의 바깥쪽 봉우리에서 선택한 벽 위치 후보이며 corridor 가정을 사용한다. 사후 평가용 Outer-Peak의 JSON 키 proxy와 수치 처리는 유지한다.
화면의 실제 벽은 시뮬레이션 생성기가 만든 벽의 실제 위치이며 사후 평가/표시용이다. 벽 후보점과 구분한다.
장면 선택칸은 Reference / Random으로 표기하고 전체 이름은 Reference corridor / Random corridor이다. 일반 한글 문장은 단어 단위로 줄바꿈한다.
