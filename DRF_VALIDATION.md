# EchoMap DRF 검증 기록

상태: 공개 벽 모델은 중심선과 독립 상하 요철의 2층 uniform cubic B-spline이다. 벽 구간과 계산 영역은 각각 [0,80] m, [0,80]×[−20,50] m이며 벽 구성은 양쪽 / 위쪽만 / 아래쪽만을 지원한다. 양쪽 구성은 최소 수직 폭 4 m, 모든 구성은 존재하는 벽에 대한 수직 차량 여유 1 m를 검사한다. 기본 및 최대 주행은 120회이며 명세 비교는 60회다. 아래 과거 160회 / 84/96 기록과 60 m 벽의 80회 검증은 당시 조건의 기록이다. 새 벽 모델의 성능 검증으로 적용하지 않는다. 양쪽 벽 평가의 기존 y=15 m 분할은 크게 굽은 벽에서 부정확할 수 있다. 한쪽 벽의 추정 정확도와 원본 MATLAB/Octave 전체 구현 parity는 여전히 미검증이다.

## 2026-10-02 80 m 벽, 120회 주행과 벽 구성 선택

상단 RAW의 기본 x 범위는 −10–90 m이다. 기본 보기, 전체 보기, 처음으로와 축소 하한은 이 범위를 사용하며 x/y 등척을 유지한다. 벽의 전체 높이를 담을 공간이 부족하면 카드 크기를 바꾸지 않고 plot 폭을 줄인다. 하단 두 필드와 산란 profile은 전체 벽 구간 0–80 m를 표시한다. 차량이나 벽 후보점이 화면 밖에 나가도 camera가 자동으로 이동하거나 축소되지 않는다.

기본 및 최대 snapshot 수는 120으로 늘렸으며 이동량 0.75 m/snapshot은 유지한다. 요청한 미래 snapshot 수에 맞춰 과거 궤적을 다시 늘이거나 압축하지 않는다. 고정 20대/120회 내부 궤적을 기준으로 벽의 차량 여유를 검사한다. 기본 120회 뒤 20대의 실제 x 범위는 91–104 m이며 열린 출구 x=80 m를 통과한다. 출구 밖에서는 중심선 끝의 접선 방향으로 계속 주행한다. 명세 비교 Sweep은 60회로 유지하며 물리적 시간 간격과 실제 속도를 별도로 정하지 않았다.

화면의 장면 표기는 벽 모델로 교체했다. 모델은 2층 B-spline으로 고정 표시하고, 벽 구성에서 양쪽 / 위쪽만 / 아래쪽만을 선택한다. 한쪽 구성은 존재하는 벽만 생성, 반사, 산란과 가시성 판정에 사용한다. 없는 벽은 통로 폭 및 차량 여유 검사에 포함하지 않는다. 아래/위 벽의 논리 ID 0/1과 RNG 주소는 유지하며 scene / wallSide는 wire에 포함하지 않는다. 같은 seed와 attempt에서 선택한 벽의 중심선 및 요철 계수 주소는 유지하지만, 벽 구성별 기각 조건이 달라 채택 attempt는 달라질 수 있다. 기존 순차 noise stream의 모든 경로 잡음이 구성 간 같다고 보장하지 않는다. 생성기의 실제 벽 정보는 truth 쪽과 사후 평가에만 사용한다.

한쪽 벽에서도 기존 y=15 m 분할의 두 영역에서 추출한 후보를 모두 유지한다. 존재하지 않는 벽 쪽에 나온 후보를 실제 벽 정보로 미리 지우지 않는다. 한쪽 구성의 중앙 오차 / P95 / off-wall은 전체 추출 후보와 존재하는 실제 벽의 최근접 거리를 사후 평가하며, 양쪽 구성의 기존 열별 오차와 정의가 다르다. 관측 열에서 후보가 없으면 Infinity 실패를 유지한다. CA 거리와 F1의 실제 벽 표본 및 관측 mask는 존재하는 벽만 포함하므로 없는 벽 쪽의 불필요한 후보는 오탐으로 반영된다. 관측 열과 signed offset 진단은 기존 x=10–50 m 구간을 유지한다. 이 진단만으로 80 m 전체 벽의 관측률을 판정하지 않는다. 두 구성의 지표를 같은 정의의 공정 비교로 해석하지 않는다. 기존 y=15 m 분할의 추출 한계는 남아 있으며 실제 벽은 후보 생성이나 Field 누적에 들어가지 않는다.

새로고침할 때 Web Crypto로 uint32 seed를 한 번 생성하고 입력칸과 URL에 함께 반영한다. URL에 남은 seed와 우연히 같으면 다음 uint32 값으로 바꾼다. 직접 seed를 입력한 뒤 실행하면 입력한 값을 그대로 사용한다. 같은 실험의 재현은 기록된 seed의 수동 입력과 동일한 나머지 설정을 사용한다. URL 열기나 새로고침 자체를 고정 seed 재현 절차로 해석하지 않는다.

[layered80-validation.json](tests/drf/layered80-validation.json)은 최종 통합 source의 양쪽 벽 80 m / 120회 재실행을 기록한다. Node v26.7.0 / darwin arm64, seed 1, 150×150 격자에서 3대60회 Q=2348, 3대120회 Q=3866, 20대120회 Q=269374를 확인했다. 각각의 실행 시간은 0.901 s, 1.745 s, 95.082 s였다. 20대120회의 측정 생성은 58.259 s, field p50/p95=264.711/418.176 ms였다. 채택 조건의 seed 0–1999에서는 2,000개 벽이 2,000번 시도로 통과했고 640,000개 표본의 2차 미분 표준편차는 0.0589366755 m⁻¹이었다. 보고서의 수치 source 10개 SHA가 현재 파일과 일치하며 실행 전후 source가 같았다. 이 전체 120회 보고서는 wallSide=both 조건이며 한쪽 구성의 전체 주행 수치나 정확도를 검증하지 않는다. Browser Worker의 시간과 RAM, 실제 file:// 화면 검증으로 확대하지 않는다.

최종 통합 뒤 `npm test`는 135/135 통과, 실패 0, 22.358 s였다. 벽 구성별 생성, 반복 및 측정 정보 경계, 단위 검사와 한쪽 구성의 초기 2 snapshots 연결을 포함한다. 전체 120회 수치 보고서의 양쪽 벽 범위와 구분한다.

한쪽 벽 평가 변경의 관련 자동 검사는 `node --test tests/drf/one-wall-evaluation.test.mjs tests/drf/integration.test.mjs tests/drf/integrity.test.mjs` 16/16 통과다. 실제 벽이 y=15 m 분할선을 넘는 조건, 반대 영역의 오탐 후보 보존, 관측 열의 누락 실패, 미래 truth 접근 차단과 양쪽 구성의 기존 평가기 전체 반환값 일치를 확인했다. 이 검사는 평가 연결과 회귀 검사이며 한쪽 벽의 추정 정확도나 공개 브라우저 실행 검증이 아니다.

## 2026-10-02 독립 요철 2층 B-spline 검증, 이전 60 m / 80회 조건

이 절의 [layered-validation.json](tests/drf/layered-validation.json)은 60 m 벽 / 80회 주행 당시의 코드 SHA, 입력, 환경과 제한을 기록한다. 당시 재현 명령은 `node --test tests/drf/two-layer-wall.test.mjs tests/drf/layered-scenario.test.mjs`와 `node tests/drf/run-layered.mjs`이다. 현재 같은 명령을 실행하면 80 m / 120회 및 선택한 벽 구성의 조건을 사용하므로 이 절의 수치와 직접 비교하지 않는다. 과거 160회 JSON은 변경하지 않았다.

- 자동 검사 130/130 통과, 실패 0, 6.726530459 s. 마지막 CSS 여백 조정은 별도 표시/배포 검사로 확인한다.
- 기각 전 2,000 seed, 480,000 표본에서 std(y'')=0.0590893834 m⁻¹, 예측 0.0588960949와 0.328% 차이. 곡률 RMS=0.0516353493 m⁻¹. 독립 위/아래 요철, full support, C2 연속성, exact cubic extrema/최소 폭, 중심차분, RNG 주소를 검사했다.
- 독립 SciPy 1.18.0 BSpline 비교는 363,852 scalar를 검사했다. 값 최대 차이 8.88e−15 m, 1차 8.88e−16, 2차 1.11e−16 m⁻¹, 3차 1.39e−17 m⁻². 이 결과는 벽 basis/합성/span parity이며 원본 전체 MATLAB 구현 parity가 아니다.
- 승인 조건으로 채택한 seed 0–1999의 2,000개 벽은 2,000번 시도로 모두 통과했다. 범위 밖 seed나 변경한 기하 설정의 기각률까지 0이라고 주장하지 않는다. sigmaDGeometry=2 / seed1은 첫 3회가 폭/차량 여유 위반으로 기각되고 attempt3을 채택한다. sigmaM=12 / seed1은 영역 위반 attempt0을 기각하고 attempt1을 채택한다. 재시도는 최대 256회다.
- 고정 20대/80회 내부 궤적 envelope, V/T/잡음/격자 변경에 대한 동일 벽, noisy wire 화이트리스트, 1/2 snapshot 측정의 반복/prefix/paired RNG, x>60 접선 연장을 검사했다.
- 새 seed1/t1의 3개 차량 쌍에서 독립 unsquared Fermat bracket과 가시 근 수가 각각 2개로 같았다. 최대 abs(sin delta)=3.81e−16, unresolved/nearMultiple=0, 내부법선 곡률 부호가 일치했다. 임의 near-caustic 근의 개수/잔차를 이 값으로 보장하지 않는다. 기존 정반사/Poisson/visibility 회귀 검사도 보존한다.
- 새 seed1 / 150×150의 전체 field 연결: 3대60회 Q=2348, 3대80회 Q=2798, 20대80회 Q=194540이며 최종 두 필드는 모두 유한했다. 20대80회 Node 실행은 48.614 s, 측정 생성 29.134 s, field p50/p95=222.552/288.432 ms였다. Node 측정이며 browser Worker 전체 RAM/실시간 장비 성능은 측정하지 않았다.

기존 field/wire core SHA는 그대로다. 새 고정 domain은 [0,60,−20,50] m로 전달하며 실제 벽 bounds로 추정 격자를 조정하지 않는다. 기각 조건의 여유는 수직 y 방향이며 Euclidean 최단거리 보장이 아니다. 기존 평가기의 y=15 m 분할은 새 seed1의 크게 굽은 벽에서 누락 후보와 Infinity P95를 발생시킨다. 이를 제거하거나 성공 평균에서 빼지 않았다. 현재 지표를 새 모델의 정확도 검증으로 주장하지 않는다. 출구 밖 외면 반사의 곡률 진단은 기존 차량 쪽 법선 규약을 유지한다.

HTTP 실제 화면에서 3대80회 Q=2798, Float32 SHA `c440d958289c1ffb54b7179df8c1d83b680159d1e8144f86f15cdc4262a15d14`가 Node와 같았다. 실행 전후와 실제 벽 표시 전환에서 세 camera가 같았고 확대 후 처음으로는 현재 시점/Q/field를 유지했다. 실제 file:// UI는 도구 접근 제한으로 미검증이며 classic bundle Worker의 module parity를 자동 검사했다.

## 변경과 재현 조건

- 기준 저장소 commit: `751f34e3d8d7ee1317554672152d6a2563ce2e0c`, 작업 branch: `feat/drf-lab`.
- 최초에는 SURF 홈을 유지하고 `drf.html`을 별도로 추가했다. 현재 공개 배포는 DRF만 포함하며 아래 DRF 전용 배포 기록을 따른다. 승인된 기존 변경은 nav 링크와 글자/컨트롤/표시 여백/문자 대비이다. 기존 알고리즘과 나머지 44개 보호 파일의 SHA-256은 유지한다.
- 사용자 요청에 따라 첫 화면의 정보량을 늘렸다. 폭 1680 px 이상의 화면에서 342 px 사이드바는 설정만 표시하고, 상단 RAW 오른쪽 300 px 성능창에 Q, 채택/거부 수, path 구성, 평가 6지표와 계산 시간을 배치한다. 하단 세 그래프는 전체 폭에 맞춘다. 상하 행 비율은 1.9:1이며 성능창의 지표 라벨은 한 줄이다. 모바일 DOM 글자는 16 px 이상, 버튼 높이는 44 px 이상이다.
- 밝은 clay 스타일의 표면과 컨트롤, 흰 plot 배경 및 내부 격자를 적용했다. RAW는 등척을 유지하며 상단 x=−10–90 m와 정적 벽의 전체 y 범위를 담도록 plot 크기를 정한다. 하단 두 필드에도 기본 등척을 적용하며 선택 가능한 채움 방식을 유지한다. 화면의 도구명은 DRF 시뮬레이터, 소속 표기는 한양대학교 WSL이다.
- 새 런타임 의존성 없음. Node 표준 라이브러리와 기존 브라우저 API 사용.
- `file://` 실행을 위한 classic bundle 추가. 기존 esbuild로 동일한 앱과 scenario/field/eval/sweep Worker를 묶고, Worker는 4종의 classic Blob script로 실행한다. provenance와 참조 fixtures JSON도 bundle에 포함하므로 로컬 파일에서 module import나 JSON fetch에 의존하지 않는다.
- 새 truth-side 명세에 맞춰 벽별 thinning 전/후 diffuse 개수를 진단 기록에 추가했다. 기존 `generated.diffuse`는 thinning 후, resolution 병합 전 합계로 유지한다. Newton의 불안정 이동과 최종 Fermat 잔차를 검사하고 near-multiple 근 개수를 미확정으로 보고한다. 이 truth-side 변경은 model8에 적용했다. 현재 주행은 0.75 m/snapshot을 유지하고 기본/최대 snapshot 수 120, 공개 벽 길이 80 m를 사용한다. 한쪽 벽 구성은 실제 존재하는 span만 생성기에 전달하며 Field 누적식과 wire의 측정 정보 경계는 유지한다.

```sh
npm run build:drf-offline
npm test
node tests/drf/run-reference.mjs --seed-count 10 --workers 3
node tests/drf/run-endpoint.mjs
python3 -m http.server 8871 --bind 127.0.0.1
```

HTTP(S)에서는 기존 module 앱과 module Worker를 사용하고, `file://`에서는 `drf/offline.bundle.js`를 classic script로 선택한다. 브라우저 보안 설정이나 별도 서버 실행을 변경하지 않는다. bundle의 원본 파일 SHA-256 22개를 자동 검사해 오래된 생성물을 검출하므로 앱이나 렌더를 수정한 뒤에는 `npm run build:drf-offline`로 재생성한다.

`http://127.0.0.1:8871/drf.html`은 기존 module 경로를 확인하는 로컬 주소다. `tests/drf/browser-check.html`의 검사 버튼은 실제 Worker와 Node의 Float32 바이트 및 summary를 비교한다. classic bundle도 HTTP 검사용 harness에서 실행해 기본 결과를 확인했다. 실제 `file://` 화면은 CUA 도구의 프로토콜 접근 제한으로 미검증이며 사용자 확인 대기 상태다. protocol 선택 자동 검사와 HTTP harness 실행을 실제 파일 화면 검증으로 판정하지 않는다.

## 수치 및 정보 경계 검사

- MATLAB R2025b batch의 `spline(x,y)`와 기준 두 벽의 local power basis 계수를 직접 비교했다. 최대 절대 계수 오차는 아래 벽 1.1102230246251565e-16, 위 벽 7.6327832942979512e-17이었다. 같은 길이의 x/y 입력에 not-a-knot 경계조건을 쓰는 [MathWorks spline 문서](https://www.mathworks.com/help/matlab/ref/spline.html)를 확인했다. 이 검사는 벽 계수 비교이며 원본 전체 .m 구현의 parity가 아니다.
- 이전 닫힌 24-control B-spline, 자체 seed의 300개 내부 Tx/Rx 쌍 검사: 독립 물리 잔차 bracket과 근 1824/1824개 일치. 최대 u 오차 6.11e-15, 최대 abs(sin δ) 4.03e-16. 원본 Octave의 쌍 목록이 없어 제공된 2040개 근과 직접 대조하지 않았다. 임의 ill-conditioned root의 정확도나 완전한 개수를 이 결과로 보장하지 않는다.
- 고정 cell midpoint는 임의 정반사근과 정확히 겹치지 않는다. 평평한 벽 거울상 해의 연속 sinδ와 cell step 0.04/0.02/0.01 m에서 최근접 midpoint 거리의 반 cell 경계를 구분해 검사했다. Grid 정렬에 따라 이 거리는 단조 감소하지 않을 수 있다. w는 facet slope의 선택 가중치이며 확률이나 정규화 pdf가 아니다.
- Float64 visibility의 특정 1e−15 m gap 검사에서는 다항식 근의 roundoff 불확실성으로 실제 교차 없이 보수적으로 차단했다. Near-multiple cluster는 unresolved 진단에 더하며 완전한 근 개수나 임의 작은 gap의 정확한 판정을 보장하지 않는다.
- AGM E(m), 경로별 DRF, A factorization, 3/4/5σ 절단 오차 경계, Float64 상태와 Float32 전송, 과거 scalar prefix hover 일치 검사.
- 현재 시점 뒤의 wire와 모든 truth를 오염시켜도 완료 prefix 필드가 byte 동일. whitelist 외 getter를 읽지 않으며 field Worker에는 wall/scenario/evaluator import가 없다.
- 동일 seed의 위치 오차와 정반사 표준 잡음을 σ_d 및 거칠기 조건 간 공유한다. GT 변경은 평가에만 영향을 준다.
- RNG 주소의 차량 ID는 기존 1,2,3을 유지한다. 주소 직렬화와 FNV mixer, Box–Muller spare, 정반사/아래 벽 diffuse/위 벽 diffuse의 noise 소비 순서는 [DRF_METHOD.md](DRF_METHOD.md)의 재현 규약을 따른다. grid/band/perimeter는 생성식에 사용하지 않고 seed와 진단량은 wire에 포함하지 않는다.
- `diffuseSampling.beforeThinning`과 `afterThinning`은 각각 아래/위 벽의 개수 배열이다. ΣΛ와 Poisson 평균/분산을 비교할 때는 beforeThinning을 사용한다. 예를 들어 seed 1, roughness 20°, t=57, pair (1,3), 위 벽의 ΣΛ=83.04223891984988에서 Poisson draw 90개 중 89개가 thinning을 통과했다. 병합 후 `truth.diffuse.length`와 이 수들을 혼용하지 않는다.
- 관측 열의 누락 출력은 Infinity 실패, off-wall 실패로 포함한다. seed 집계는 finite 수/failed/missing을 별도로 보존하고 실패를 정상 평균에서 제거하지 않는다.

## 160회 통계 재현

환경: v26.7.0, darwin arm64, 3 workers. 각 조건은 명시적 60 snapshots, 150 × 150 격자, seed 1–10이다. model8의 2026-10-02T02:14:22.179Z 실행은 완료 160/160, 실행 오류 0, 전체 48.057688 s이며 이전 실행과 수치가 같았다. 기본/최대 snapshot 수를 80으로 확장한 현재 source의 2026-10-02T05:39:32.596Z 재실행도 완료 160/160, 실행 오류 0, sourcesStable=true, 47.503462416 s이다. 이전 160개 input/summary/final, aggregate/comparisons/failures가 모두 정확히 같고 실행 전후 수치 source 11개의 SHA는 현재 파일과 일치한다. 해당 실행의 wall/scenario/sweep 원본은 tests/drf/legacy-source에 정확한 바이트로 보존했다. 아래 수치 표는 이전 벽의 60 snapshot 조건을 유지하며 ±는 seed 간 표본 표준편차다. 이 결과를 80 snapshot 통계로 해석하지 않는다.

중앙 절대오차 16조건, diffuse 수, 중복 비율, 관측 열 비율, 거칠기 2°의 Theorem 2 평균/중앙은 통과했다. **전체 판정 84/96 통과, 12개 실패**다. 참고 수치는 제공 문서의 3-seed 값이며 원본 집계 정의는 아직 확인하지 못했다.

| σ [deg] | σ_d [m] | 중앙 오차 [m] | P95 [m] | off-wall [%] | 실패한 참조 기준 |
|---:|---:|---:|---:|---:|---|
| 0 | 0.05 | 0.127 ± 0.005 | 0.458 ± 0.116 | 4.84 ± 1.36 | p95, offwall |
| 0 | 0.1 | 0.138 ± 0.008 | 0.417 ± 0.123 | 4.15 ± 1.58 | 없음 |
| 0 | 0.2 | 0.174 ± 0.011 | 0.492 ± 0.071 | 4.73 ± 1.34 | offwall |
| 0 | 0.3 | 0.225 ± 0.015 | 0.595 ± 0.089 | 7.13 ± 1.55 | 없음 |
| 2 | 0.05 | 0.127 ± 0.008 | 0.960 ± 0.109 | 13.94 ± 2.09 | offwall |
| 2 | 0.1 | 0.135 ± 0.007 | 0.890 ± 0.087 | 12.13 ± 1.89 | 없음 |
| 2 | 0.2 | 0.168 ± 0.007 | 0.837 ± 0.055 | 11.06 ± 0.96 | offwall |
| 2 | 0.3 | 0.214 ± 0.009 | 0.788 ± 0.080 | 10.11 ± 1.64 | 없음 |
| 5 | 0.05 | 0.104 ± 0.005 | 0.753 ± 0.119 | 8.56 ± 1.88 | offwall |
| 5 | 0.1 | 0.113 ± 0.005 | 0.698 ± 0.130 | 7.87 ± 1.80 | p95, offwall |
| 5 | 0.2 | 0.144 ± 0.004 | 0.552 ± 0.130 | 5.69 ± 1.76 | offwall |
| 5 | 0.3 | 0.187 ± 0.005 | 0.628 ± 0.127 | 6.22 ± 1.30 | offwall |
| 10 | 0.05 | 0.075 ± 0.005 | 0.624 ± 0.166 | 7.02 ± 2.27 | 없음 |
| 10 | 0.1 | 0.081 ± 0.005 | 0.613 ± 0.157 | 6.54 ± 1.94 | 없음 |
| 10 | 0.2 | 0.106 ± 0.005 | 0.483 ± 0.188 | 4.84 ± 1.90 | 없음 |
| 10 | 0.3 | 0.147 ± 0.007 | 0.500 ± 0.168 | 4.41 ± 2.07 | p95, offwall |

참조 수용 구간은 중앙 오차 ±0.015 m, P95와 off-wall 상대 ±30%, diffuse 수 상대 ±3%, 중복 비율 ±0.03, 관측 비율 0.94±0.02, 거칠기 2° Theorem 평균 1±0.05/중앙 0.43±0.04다. 수용 실패에 맞추어 수식, threshold, 표본 선택 또는 추출기를 바꾸지 않았다.

| σ [deg] | σ_d [m] | 항목 | JS 평균 | 참조 | 수용 하한 | 수용 상한 |
|---:|---:|---|---:|---:|---:|---:|
| 0 | 0.05 | p95 | 0.458134 | 0.349000 | 0.244300 | 0.453700 |
| 0 | 0.05 | offwall | 0.048404 | 0.035000 | 0.024500 | 0.045500 |
| 0 | 0.2 | offwall | 0.047340 | 0.034000 | 0.023800 | 0.044200 |
| 2 | 0.05 | offwall | 0.139362 | 0.096000 | 0.067200 | 0.124800 |
| 2 | 0.2 | offwall | 0.110638 | 0.074000 | 0.051800 | 0.096200 |
| 5 | 0.05 | offwall | 0.085638 | 0.064000 | 0.044800 | 0.083200 |
| 5 | 0.1 | p95 | 0.698025 | 0.536000 | 0.375200 | 0.696800 |
| 5 | 0.1 | offwall | 0.078723 | 0.060000 | 0.042000 | 0.078000 |
| 5 | 0.2 | offwall | 0.056915 | 0.041000 | 0.028700 | 0.053300 |
| 5 | 0.3 | offwall | 0.062234 | 0.046000 | 0.032200 | 0.059800 |
| 10 | 0.3 | p95 | 0.499864 | 0.338000 | 0.236600 | 0.439400 |
| 10 | 0.3 | offwall | 0.044149 | 0.018000 | 0.012600 | 0.023400 |

상세 input/summary/timing, 최종 D̄/β̂ 체크섬, Q, 실행 전후 source SHA는 [validation-results.json](tests/drf/validation-results.json)에 저장했다. 참조 수용 실패는 CLI 종료 상태 2이며 실행 오류/소스 변경은 1이다. 작은 seed smoke 실행은 수용 통과로 인정하지 않는다.

## 해석과 미완료 항목

- Outer-Peak은 아래/위 반평면을 사용하는 corridor prior 평가 대용점이다. 최종 wall extractor의 성능으로 주장하지 않는다. offset은 참 벽 ±1.5 m 창 안의 필드 peak에서 참 y를 뺀 값의 평균이다. 제공 +0.139 m의 집계 정의를 모르는 상태에서 중앙값으로 바꾸지 않았다.
- Theorem 2 비율은 같은 벽의 최근접 정반사점을 사용하며 정의된 x gate를 적용한다. 국소 근사 가정의 유효 범위와 원본 최근접 정의 대조가 남았다.
- MATLAB R2025b batch에서 `spline` 계수 비교는 수행했다. 미제공 원본 .m 세 파일과 메인 알고리즘 실행, 전체 MATLAB/Octave parity 대조는 수행하지 않았다.
- 물리 dt, 안테나/거리 보정, 가시성 외 실제 수신 검출 확률, amplitude 및 하드웨어 지연 모델은 없다. 웹 수치 재현이 실제 레이더의 검증을 대신하지 않는다.
- 배포 대상은 기존 Pages의 `main:/`이다. 홈은 SURF를 유지하고 DRF는 `https://woqhrl9494-cell.github.io/corridor-mapper/drf.html`이다. 배포 완료는 Pages의 built 상태와 배포 commit 일치, 공개 자산 SHA-256 일치, 공개 화면에서 기본 실행을 확인한 뒤 판정한다.
- 실제 `file://` 파일 화면의 실행 버튼과 Blob Worker는 사용자 확인 대기다. HTTP classic bundle 실행 및 자동 검사까지 확인했으며 파일 프로토콜의 실제 표시와 실행은 아직 확인하지 않았다.

## 브라우저와 내보내기

- 이전 실제 scenario/field/eval/sweep Worker와 Node 대조: 짧은 3 snapshot / 100² 세 조건과 60 snapshot / 150² 네 조건, 총 7조건의 D̄/β̂ 바이트 및 Q/개수는 정확히 같다. Float64 평가 summary는 10⁻¹²×max(1, |참조값|) 허용오차로 비교했고 Theorem 평균 두 조건에서 최대 1.33e-15 차이를 기록했다. [검사 기록](tests/drf/browser-parity-result.json).
- model8 배포 당시 HTTP module의 실제 기본 60 snapshot 실행은 Q=2904, D̄/β̂ Float32 SHA=991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926이며 브라우저 경고/오류 0이었다. 실제 JSON 다운로드의 첫 configuration에 `diffuseSampling.beforeThinning=[62,58]`, `afterThinning=[62,58]`을 확인했다. 앱뿐 아니라 Worker와 변경 module의 import URL에도 같은 버전을 사용해 이전 캐시의 진단 없는 truth가 재사용되는 문제를 수정했다.
- 같은 코드/설정과 JS engine/libm에서의 truth/wire bit 재실행과 서로 다른 engine의 비교를 구분한다. 실제 같은 브라우저의 기본 60 snapshot 재실행 두 JSON의 measurement/truth는 정확히 같았다. HTTP export와 Node 대조에서는 수치 요소 256개에 차이가 있었으며 최대 절대 차이 7.105427357601002e-15, 최대 상대 차이 4.756225964505287e-16이었다. Shape와 비수치 값은 모두 같았다. 기본 D̄/β̂ Float32 hash는 991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926로 같았다. Cross-engine truth/wire 전체를 bit 동일하다고 보고하지 않는다.
- 단일 실행, 한 step, 계속 실행, 완료 snapshot slider, 과거 prefix 조회, 표시값/색 범위/레이어/확대/전체 보기, 진단 선택, 취소 및 재설정 확인.
- 1440 × 900와 390 × 844 화면 확인. 모바일 document 폭 초과 0, 보이는 DOM 글자 최소16 px. DPR1/2에서 Canvas 실제 픽셀 크기 배수 일치. light/dark 화면 기록 보관.
- 이전 구현의 실제 JSON 다운로드는 완료된 6 snapshots만 포함하고 wire에 oracle 필드가 없었다. CSV는 header+6행이었다. 2026-10-01 표시 버전의 실제 D̄ PNG 다운로드는 1138 × 1060 px, pHYs 11811 px/m = 299.9994 dpi였다. 저장된 이미지를 열어 D̄와 1/m² 단위, snapshot 60, linear 색 매핑, 평가용 점선 설명 및 `Axes: independent x/y scale` 문구를 확인했다. 이 크기는 현재 clay/등척 RAW 화면의 새 다운로드 크기로 판정하지 않는다. 현재 PNG 렌더도 선택한 필드의 표시 영역을 저장하며 필드별 파일명을 사용한다. 필드 등척 선택 시에는 `Axes: equal metres`로 표시한다.
- 외부 다운로드 이벤트 도구는 타임아웃했으나 실제 파일이 Downloads에 저장된 것을 파싱해 검증했다. PNG 그림은 선택 snapshot이며 JSON/CSV는 완료된 전체 기록이다.

model8 배포 당시 자동 검사는 113/113 통과(16.108287 s), 실패 0이었다. 기존 105개 검사에 near-caustic Newton 1개와 truth model 7개를 추가했다. 실제 flat/curved profile 각각 1,200 seed의 thinning 전 Poisson 평균/분산, flat categorical CDF, 벽 곡선 위 표본과 두 leg, 차폐 전 생성 수 보존, 재실행/prefix/call-order/추정기 설정 불변성, 0 roughness/intensity의 난수 미소비를 확인했다. Offline 생성물의 22개 원본 SHA, HTML의 file/HTTP script 선택, Blob URL 재사용과 해제, 4종 Worker의 classic 파싱을 검사했고 실제 classic scenario Worker 2 snapshot truth/wire도 module 실행과 정확히 같았다. Field의 Float32 일치, RAW 등척과 크기, 그래프 격자, PNG 표시축 및 수동 camera, 44개 보호 파일과 최종 160회 수치 소스 SHA 검사도 통과했다. 이 자동 검사와 Node VM의 classic 실행을 실제 file 화면 실행으로 판정하지 않는다.

이전 검사에서는 legacy DOM smoke 8개가 통과했다(uiErrors=[]). jsdom 파일 읽기 문제는 기존 버전을 임시 폴더에서 로드해 검사했으며 저장소 의존성은 변경하지 않았다. UI의 별도 네 seed run summary는 중앙 오차/P95/off-wall 및 나머지 값이 Node와 같고 Theorem 평균만 최대1.33e-15 차이였다. Sweep 즉시 취소는0/4, 단일 취소는 완료1 snapshot만 보존, 두 noise=0 입력은 실행을 차단했다.

UI 추가 조작 결과는 [ui-validation.json](tests/drf/ui-validation.json)과 실행 출력으로 보충한다. 방법/단위/복잡도는 [DRF_METHOD.md](DRF_METHOD.md)에 기록한다.

## 참고 HTML 배치 적용

사용자가 제공한 corridor_mapper.html의 밝은 배경과 배치를 바탕으로 clay 스타일을 적용했다. 왼쪽에는 설정만, 상단 행에는 측정 타원/차량 궤적과 우측 성능창을 표시한다. Q, 채택/거부 수, path 구성, 평가 6지표와 계산 시간은 성능창으로 옮겼다. 하단 D̄, β̂, 시간별 평가 지표는 그 아래 전체 폭에 맞추어 각각 표시한다. 산란/필드 세부 설정과 표시/레이어는 기본으로 펼쳐 둔다. 큰 데스크톱에서는 설정 라벨과 입력을 같은 행에 표시하고 평가 라벨은 한 줄로 유지한다. 작은 화면에서는 설정과 추가 실험을 스크롤로 접근하고 모바일은 세로로 배치한다.

상단 자동 보기는 명시적으로 켠 평가용 참벽의 범위 또는 공개 60 × 30 m 영역에서 시작한다. 차량 표시를 켠 RAW는 현재 wire와 선택 시점까지의 과거 측정 pHat 범위를 합쳐 출구를 지난 차량도 표시한다. 미래 관측과 숨겨진 참 위치는 사용하지 않는다. 하단 필드와 계산 격자는 전체 x=0–60 m를 유지하며 차량 주변 24 × 24 m 확대는 기본 화면에서 제거했다. 휠과 드래그는 수동 보기를 유지하고 기본 보기 복원은 같은 인과적 표시 범위를 다시 계산한다. Camera는 추정기 입력과 수치 평가에 영향을 주지 않는다.

RAW는 항상 x/y의 1 m 길이를 같게 표시한다. 공개 영역이나 명시적으로 켠 참벽 범위의 가로세로 비율과 사용할 수 있는 행 높이에 맞추어 panel 자체의 폭과 canvas 높이를 조절한다. RAW 제목과 조작 버튼은 두 행으로 고정해 줄바꿈에 따른 크기 피드백을 줄였다. 이 과정에서 측정 좌표나 추정 수치를 변경하지 않는다.

`필드 채움`과 `필드 등척` 선택은 하단 D̄/β̂에만 적용한다. 선택 가능한 `필드 채움`은 x/y 축에 독립 배율을 사용하므로 수치 좌표와 m 단위는 같아도 화면의 x/y 1 m 길이는 다를 수 있다. 기본 `필드 등척`은 두 방향의 1 m 길이를 같게 표시한다. 필드 표시축을 바꿔도 수동으로 확대한 RAW camera는 유지된다. hover 역변환과 확대/이동은 각 그래프의 실제 표시 배율을 사용하며 추정 알고리즘에 전달하지 않는다.

RAW, D̄/β̂, 시간별 평가, Sweep, 히스토그램, profile 및 산점도에 내부 격자를 표시한다. 거리 지도 x/y 격자와 profile x 격자는 10 m 간격이며 확대 시에도 물리 간격은 유지한다. 시간별 평가와 분석 그래프의 plot 여백도 줄였다. D̄는 밝은 warm 순차색, β̂는 밝은 blue 순차색이며 정확히 0인 셀은 투명하다. Canvas와 dashboard 크기를 관찰하고 metricChart도 별도로 관찰해 크기 변경 후 다시 그린다.

확대 버튼 옆의 `처음으로`는 세 지도의 확대와 이동만 기본 보기로 복원한다. 현재 snapshot, 기록, 설정과 실행/일시정지/재생 상태를 그대로 유지한다. 축소 버튼과 마우스 휠은 현재 plot 크기와 표시 범위의 기본 배율 아래로 축소하지 않는다. 그 하한에서 휠로 다시 축소하면 해당 지도의 기본 중심과 배율을 복원한다. 하단 Dbar와 betaHat의 확대, 축소, 처음으로 버튼은 각 지도만 조작한다. 현재 snapshot과 계산 기록은 유지한다. 이전의 첫 snapshot 선택과 일시정지 동작은 사용자가 명확히 한 camera-only 요구에 맞춰 제거했다. 이전 버튼 검사 기록은 당시 동작의 기록이며 현재 동작을 뜻하지 않는다.

직전 clay/RAW 표시 버전의 HTTP module 기본 60 snapshot 실행은 Q=2904, 정반사 369 / diffuse 2535, D̄/β̂ Float32 SHA-256 991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926로 이전 버전과 같았다. 당시 브라우저 경고/오류 기록은 비어 있었으며 `처음으로` 실제 클릭 후 1/60, 전체 기록 보존과 자동 camera 복원을 확인했다. 첫 실행 전에는 평가용 참벽만 미리 표시하며 가짜 필드나 측정값을 생성하지 않는다. 새 truth-side 변경 후 브라우저 확인과는 구분한다.

2026-10-01의 이전 classic bundle HTTP harness도 같은 기본 필드 SHA와 Q를 확인했고, classic Sweep은 60 snapshots / 150² 격자, σ_d=0.1 m, 거칠기 2°, seed=1의 단일 조건이 1/1 완료되었다. 표시값은 중앙 오차 0.140 m, P95 0.829 m, off-wall 11.2%였다. 직전 clay 버전 생성물은 source 22개로 빌드하고 VM 검사로 확인했다. 이전 classic 브라우저 실행 증거는 [density-validation.json](tests/drf/density-validation.json)의 `previousLayoutEvidence.previousClassicRuntimeEvidence`로 분리했으며 `file://` 화면 검증은 남아 있다.

### 이전 표시 버전의 측정 기록

이전 schema 4 표시 버전의 실제 1920 × 930과 1920 × 1080에서 사이드바 폭은 456 px이며 측정한 입력/선택/실행 버튼 28개가 모두 첫 화면에 보였다. clientHeight와 scrollHeight는 각각 876/876 px와 1026/1026 px로 추가 사이드바 스크롤이 없었다. 사후 평가 라벨 6개는 14 px, 높이 16.797 px, line-height 16.8 px로 한 줄이며 clientWidth와 scrollWidth가 같아 잘림이 없었다. 네 canvas도 모두 첫 화면에 보였다. 1440 × 900과 1366 × 768에서는 네 canvas가 모두 보이고 펼친 전체 설정은 사이드바 스크롤로 접근한다.

이전 schema 4 표시 버전의 RAW canvas CSS 크기와 실제 plot 영역은 다음과 같다. panel은 제목과 테두리를 포함하고 canvas와 크기가 다르다.

- 1920 × 930: canvas 949.656 × 351.375 px, plot 890 × 289 px, x/y 14.238124 px/m. panel 951.656 × 418.875 px.
- 1920 × 1080: canvas 1210.297 × 436.156 px, plot 1150 × 374 px, x/y 18.425807 px/m. panel 1212.297 × 503.656 px.
- 1440 × 900: canvas 897.484 × 334.406 px, plot 837 × 272 px, x/y 13.400587 px/m.
- 1366 × 768: canvas 668.109 × 259.797 px, plot 608 × 198 px, x/y 9.743590 px/m.
- 390 × 844: canvas 364 × 160.875 px, plot 304 × 99 px, x/y 4.871795 px/m. 모바일 document 가로 넘침 0, DOM 글자 16 px 이상과 일반 컨트롤 44 px 이상 유지.

이전 schema 4 검사에서 1920 × 930으로 새로 열었을 때와 모바일로 줄였다가 돌아왔을 때의 RAW panel 폭은 모두 951.656 px로 같았다. 그 크기별 범위, 설정 가시성, 라벨 잘림 및 재크기 조정 결과는 [density-validation.json](tests/drf/density-validation.json)의 `previousLayoutEvidence`에 이전 schema 4로 보존했다. 숨겨진 GT가 camera에 영향을 주지 않는지, 0값 투명도, 선택 지표의 큰 그래프, 두 표시축의 좌표 왕복, RAW 등척과 panel 크기, 내부 격자, PNG의 필드/단위/표시축 문구를 자동 검사했다. 이전 UI 변경에서는 수치/평가 모듈과 44개 보호 파일을 수정하지 않았다. 이 기록은 현재 축소 사이드바와 전체 필드 보기의 새 치수를 의미하지 않는다. Clay UI는 유지한다. CSS/모듈 URL의 버전을 바꾸어 이전 렌더의 캐시 재사용을 막는다.

### 이전 schema 5 표시와 버튼 검사

[density-validation.json](tests/drf/density-validation.json)의 schema 5는 이전 실제 HTTP 화면 검사이며 schema 4 전체는 `previousLayoutEvidence`에 보존한다. 당시 1920 × 930과 1920 × 1080에서 사이드바는 342 px이고 clientHeight/scrollHeight는 각각 876/876 px, 1026/1026 px이었다. 설정 컨트롤 28개와 네 canvas가 모두 첫 화면에 보였다. 설정 글자는 최소 14 px, 컨트롤 높이는 최소 28 px이었다. 사후 평가 라벨 6개는 13 px, 높이 15.59375 px, line-height 15.6 px로 한 줄이며 잘림이 없었다. 당시 모바일 390 × 844의 document 가로 넘침은 0, DOM 글자는 최소 16 px, 컨트롤 높이는 최소 44 px이었다.

- 1920 × 930: RAW panel 1156.8125 × 485.625 px, canvas 1154.8125 × 418.125 px, plot 1095 × 356 px, x/y 동일 17.5390038034 px/m.
- 1920 × 1080: RAW panel 1458.953125 × 583.90625 px, canvas 1456.953125 × 516.40625 px, plot 1397 × 454 px, x/y 동일 22.367156535811 px/m.
- 1920 × 930의 Dbar: canvas 505.65625 × 199.765625 px, plot 398 × 138 px, x/y 동일 6.3782051282 px/m. 기본 보기의 x 범위는 여백 포함 −1.2–61.2 m이다.

이전 schema 5 HTTP 기본 60 snapshot 실행은 Q=2904이며 Dbar/β̂ Float32 SHA-256은 991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926로 기존 결과와 같았다. 실행 전 `처음으로` 실제 클릭은 확대된 RAW camera를 기본 배율로 복원하고 snapshot 0 / 60과 설정을 유지했다. 실행 후 실제 클릭은 선택 1, slider max=60과 세 지도 자동 보기를 유지했다. 이는 HTTP 검사이며 실제 file 화면 검증으로 확대하지 않는다.

직전 표시 수정 후 자동 검사는 113/113 통과, 실패 0, 14.65061275 s였다. VM 회귀 검사에는 기록 없는 idle/측정 준비 중 버튼 활성화와 세 camera 복원, 설정/기록/worker/실행 상태 보존, 처리 중 결과 도착 뒤 첫 snapshot 선택 유지가 포함된다. Offline 22개 source bundle과 classic Blob Worker, 44개 보호 파일, 기존 160회 보고서의 수치 source SHA 검사도 통과했다. 직전 표시 수정에서는 수치 소스 11개의 SHA가 그대로여서 160회를 다시 실행하지 않았다. 이번 차량 확장은 다음 별도 기록을 따른다. 참조 수용 기준의 12개 미충족도 유지한다.

## 이전 차량 2–20대 확장

기존 3대 제한을 확장하고 실제 20대 궤적과 190쌍을 생성한다. 기존 1–3번 궤적과 공통 쌍의 RNG 주소를 보존한다. 추가 차량은 고정 x0∈[1,14] m 슬롯을 사용하며 60개 시점에서 벽 내부에 머문다. 차량의 차폭과 접속 스케줄은 모델에 포함하지 않는다.

[fleet-validation.json](tests/drf/fleet-validation.json)의 이전 Node 20대 전체 실행은 60/60, 187,631개 경로, 모든 field 값 유한, 최종 SHA `3b3897843980dd07c6ac99c0a407ec0677f1750f73328fde6703c7d132c6c254`를 확인했다. 단일 seed 완료 검사이며 20대 성능의 모집단 통계가 아니다. 계산 시간과 단일 process의 표본 메모리는 HTTP 화면 및 Worker 메모리와 구분한다.

기본 3대 160회 통계도 새 source로 다시 실행했다. 46.974087 s, 실행 오류 0, sourcesStable=true이며 이전 160개의 input/summary/final과 aggregate/comparisons/failures는 정확히 같다. 참조 수용 조건은 84/96 통과, 기존 12개 미충족이다.

타원 표시량은 최대 600개로 제한하며 원본 wire와 추정 경로는 모두 유지한다. 표시 수와 측정 수를 RAW 제목에 표시한다. 20대 차량점과 궤적을 유지하고 번호는 plot 안에만 배치한다. 이는 큰 차량 수의 Canvas 표시 비용과 번호 잘림을 해결하는 표시 변경이다.

차량 확장 후 `npm test`는 115/115 통과, 실패 0, 18.282778 s였다. 실제 20대 생성기 연결 검사와 표시 600개 상한, 전 차량점 유지, 번호 bbox/차량점 겹침과 plot 경계 검사가 포함된다.

차량 확장 수정 당시 HTTP module 화면에서 차량 20대, 60/60, Q=187631과 같은 최종 필드 SHA를 확인했다. 1920×930 content viewport에서 사이드바는 342 px, clientHeight/scrollHeight=876/876 px이고 28개 설정 컨트롤과 네 canvas가 모두 첫 화면에 보였다. 마지막 시점의 측정 4326개 중 타원 541개가 표시됐다. 생성 중 취소는 기록 0개와 실행 가능 상태로 돌아갔고, 완료 후 `처음으로`는 1/60을 선택하며 60개 기록을 유지했다. Console warning/error는 0개였다. 20대 수치 폭으로 하단 설명이 5 px 잘린 문제는 desktop section 상하 여백 2→1 px로 해결했다. 이 마지막 CSS/cache/bundle 수정 후 관련 7개 표시·버튼·offline 검사는 모두 통과했다. 실제 file 화면 검증으로 확대하지 않는다.

## 이전 보기 초기화와 축소 하한 수정

`처음으로`에서 첫 snapshot 선택, 재생 정지와 실행 일시정지를 제거했다. 세 지도의 camera 복원만 수행하므로 현재 시점과 기록, 입력, worker와 실행/재생 상태를 유지한다. 기본 배율은 현재 plot 크기와 표시 범위의 CSS px/m로 계산하며 버튼과 휠에서 두 축 모두 그 배율보다 작아지지 않게 제한한다. 화면 크기나 표시 범위 변경 때도 하한을 갱신한다. 이동 중심과 확대 anchor를 보존한다.

자동 검사 115/115 통과, 실패 0, 11.806166 s였다. VM에서 기록 없는 idle/준비 중과 done/paused/running/cancelled, 재생 rAF와 진행 중 field 요청 상태 보존을 확인했다. 실제 RAW/등척 Dbar/채움 betaHat 객체에서는 축소 버튼, 휠, 이동, 양방향 화면 크기 변경과 표시 범위 변경을 검사했다.

HTTP 실제 화면에서 기본 60 snapshot의 Q=2904와 최종 Float32 SHA는 그대로였다. 세 지도를 확대하고 이동한 뒤 `처음으로`를 눌렀을 때 60/60과 상태, 기록 및 수치는 그대로이고 세 camera가 기본 보기로 복원됐다. 59/60을 따로 선택한 검사도 그 시점을 유지했다. 반복 축소 버튼과 세 지도의 휠 축소는 초기 배율에서 멈췄다. Console warning/error는 0개였다. 상세 기록은 [view-reset-validation.json](tests/drf/view-reset-validation.json)이다.

수치 source 11개와 기존 160회 reference 보고서의 SHA가 일치하므로 수치 실험은 다시 실행하지 않았다. 기존 참조 수용 조건 12개 미충족도 그대로이다. offline 22개 source bundle을 다시 생성하고 검사했으며 실제 file 화면 검증으로 확대하지 않는다.

## 2026-10-02 주행 연장과 성능창 이동

기본/최대 snapshot 수를 80으로 늘렸다. 차량은 원래 0.75 m/snapshot 식을 계속 사용하며 벽 길이, 계산 영역과 산란/누적식은 유지한다. x=60 m는 닫힌 끝벽이 없는 열린 출구이며 20대의 t=80 참 x 범위는 61–74 m이다. 이동량을 실제 속도로 해석할 물리 dt는 없다. 두 Float32 field history는 기본 80×150²에서 14.4 MB, 최대 80×200²에서 25.6 MB이며 T*G 상한은 3.2×10⁶이다. Truth/wire와 Worker 복사본 비용은 이 값에 포함하지 않는다.

[endpoint-validation.json](tests/drf/endpoint-validation.json)은 2/3대와 seed 1–5의 10개 paired 조건을 기록한다. 같은 80개 wire를 순서대로 누적하고 60/80번째 결과를 비교한다. x=55–60 m의 벽별 51표본에 현재까지의 hit가 1 m 이내로 들어온 비율은 양벽 모두 0%에서 100%로 증가했다. 기본 3대/seed 1의 끝단 아래/위 벽 proxy P95는 5.852/5.174 m에서 0.0589/0.1354 m로 감소했다. 반면 내부 x=10–50 m P95는 0.829에서 0.937 m로 증가했고 2대의 끝단 proxy에는 모호성이 남는다. 관측률 개선을 전체 정확도나 최종 추출기 성능 개선으로 주장하지 않는다. 누락 proxy는 문자열 `Infinity`로 보존한다. GT와 이 진단은 평가에만 사용한다.

독립 60/80 생성의 첫 60개 truth/wire가 같고, 60번째 field SHA는 기존 `991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926`와 같다. 미래 truth를 추가해도 실제 60번째 frame의 평가 출력 전체는 같았다. 현재 80번째 기본 Node/HTTP 결과는 Q=3609, Float32 field SHA `99ed8989b86da39ddd824608f05bf6178ca2efc06b07e50de69b858246755049`로 일치한다.

현재 전체 `npm test`는 117/117 통과, 실패 0, 17.856888625 s이다. 명시적 60 snapshot 조건의 160회 재실행은 47.503462416 s, 완료 160/160, 실행 오류 0, sourcesStable=true이며 기존 input/summary/final/aggregate/comparisons/failures를 모두 유지했다. 수용 조건 84/96 통과와 12개 미충족은 그대로이며 80 snapshot의 새 통계 수용 판정을 의미하지 않는다.

작은 그래프 틀의 첫 페인트는 RAW가 CSS 초기 크기에서 최종 등척 크기로 조정되기 전에 보이던 화면이다. `#mapCanvas[data-view]` 준비 전 dashboard의 그래프 틀을 숨겨 최종 camera와 표시 크기 계산 뒤 공개한다. 우측 성능창의 실행 상태와 측정 생성 시간은 로딩/오류 안내를 위해 계속 표시한다. RAW 자동 범위에는 현재/과거 측정 pHat만 합치며 미래는 제외한다. 기본 축소 하한에서 휠 축소를 하면 해당 지도만 기본 보기로 돌아가고, 하단 Dbar/β̂의 −/＋/처음으로는 각 지도를 독립 조작하며 snapshot과 기록을 유지한다.

상단 행의 RAW 오른쪽에 300 px 성능창을 배치하고 왼쪽은 설정만 남겼다. 하단 세 그래프는 전체 폭에 맞춘다. 실제 HTTP 1920×930에서 성능창 clientHeight/scrollHeight는 484/484 px, 사이드바는 876/876 px이고 평가 라벨의 두 줄 표시가 없었다. 실제 기본 80/80 실행, 하단 독립 조작과 휠 하한 복원의 상태 보존, 모바일 버튼 44 px 및 콘솔 경고/오류 0개는 [view-controls-validation.json](tests/drf/view-controls-validation.json)의 `finalEndpointAndPerformanceLayout`에 기록했다. 같은 파일의 초기 116개 검사와 이전 배치 기록은 당시 증거로 유지한다. 이 기록은 로컬 HTTP/Node 검증이며 공개 배포 완료와 실제 file 화면 실행의 검증은 별도로 판정한다.

## 그래프 간격 고정

카드 크기를 축척에 맞춰 줄이던 RAW renderer의 style 변경을 제거하고 CSS가 프레임 전체를 채우도록 수정했다. x/y 등척은 카드 내부 camera에서 유지한다. 상단 RAW/성능창과 하단 세 그래프의 양끝과 바닥을 맞추고, 카드와 진단 그래프 사이의 상하좌우 간격은 10 px이다.

`npm test`는 116/116 통과, 실패 0, 3.691665959 s이며 크기 helper 삭제로 이전 단위 검사 1개를 제거했다. 실제 renderer 검사는 프레임과 본문 style 불변성을 포함한다. 마지막 CSS 변경 뒤 표시 검사 3개도 통과했다. [uniform-spacing-validation.json](tests/drf/uniform-spacing-validation.json)은 실행 전/80회 완료/확대와 1920×930, 1920×1080, 1440×900 및 모바일 세로 배치의 실제 10 px 간격을 기록한다. HTTP 80회 완료의 Q=3609와 최종 필드 SHA는 유지됐고 수치 source 11개도 같은 기존 160회 보고서 SHA를 유지하므로 160회를 다시 실행하지 않았다.

## 기존 60회 링크의 전체 주행 수정

기본값 변경 뒤에도 URL hash의 명시적 60회가 복원되어 전체 실행이 t=60에 끝났다. 차량 10대의 마지막 x는 46–55 m로 첨부 화면과 일치한다. 이제 전체 실행의 prepare는 입력 검증 후 최소 80회로 맞추고 폼과 hash, scenario worker에 같은 입력을 전달한다. 한 step·계속 실행·Sweep의 지정 횟수와 수치 생성기는 변경하지 않는다. 주행 길이는 고정 운행 계획이며 GT나 미래 관측으로 선택하지 않는다.

실제 app prepare를 실행하는 회귀 검사에서 복원 60회→전체 실행 80회와 폼/hash/생성 입력 일치, 한 step의 60회 유지, 기존 80회 유지가 통과했다. 전체 npm test는 117/117, 실패 0, 19.467629791 s이다. offline bundle을 22개 source로 다시 빌드했고 수치 source 11개의 SHA는 이전 끝단/160회 검증과 같아 160회를 반복하지 않았다.

로컬 HTTP에서 10대·60회 hash를 불러온 뒤 실행을 눌러 설정/hash가 80으로 바뀌고 80/80이 완료됐다. Q=59285와 field SHA e8240c1f9f0165ac07d8caf8996eb249f17f302acd5230e0f122d652483c1862는 별도 Node 실행과 같다. t=80의 참 차량 x는 [64,67,70,61,61.8125,62.625,63.4375,64.25,65.0625,65.875] m이다. 같은 80회 누적의 t=60/80을 평가한 단일 seed 끝단 진단은 양벽 마지막 5 m 관측률 0→100%, 아래/위 proxy P95 6.151/5.499→0.0873/0.0354 m였다. GT는 사후 평가에만 사용하며 이 한 조건을 전체 정확도나 최종 추출기 성능으로 일반화하지 않는다.

## 레이어 표시와 지도 배율 분리

참 벽 체크가 renderer의 자동 카메라 초기화와 bounds 선택에 동시에 사용되어 해제할 때 벽 bbox에서 전체 계산 domain으로 범위가 바뀌었다. 실행 전에는 previewWalls도 빈 배열로 바뀌었다. 이제 scene:seed에 해당하는 표시용 장면 extent를 캐시에 유지하고, 카메라 범위와 축소 하한은 참 벽/차량 표시 여부와 무관하게 계산한다. 실제 벽 점선과 차량·궤적 그리기는 각 체크를 따른다. RAW pose 범위는 현재 및 과거 noisy poses만 사용한다. scene geometry는 표시 범위에만 쓰며 추정 grid/worker 입력/누적식은 변경하지 않는다.

현재 npm test는 118/118, 실패 0, 25.002200459 s이다. 실행 전 장면 캐시, 세 지도의 자동/수동·이동·리사이즈·기본 배율/초기화 보존과 현재 시점 제한을 실제 app/renderer 검사에 포함했다. 현재 22 source offline bundle의 VM/Blob 검사도 통과했다. 로컬 HTTP에서 10대의 60회 저장 링크를 실행해 80/80, Q=59285와 동일 field SHA를 확인했다. 실행 전/후 참 벽 토글, 세 지도의 수동 확대 중 참 벽·차량 토글, 참 벽 해제 상태의 처음으로가 같은 camera를 유지/복원했다. 수치 source 11개는 변경되지 않았다. 실제 file 화면 검증으로 확대하지 않는다.

## 화면 용어 정리

대용점 표기를 벽 후보점으로 변경하고 누적 필드의 바깥쪽 봉우리에서 선택한 평가용 후보임을 설명했다. 참 벽은 실제 벽으로 표시하며 시뮬레이션이 생성한 실제 위치라는 설명을 붙였다. 당시 장면 선택은 Reference corridor / Random corridor로 표시했다. 현재 공개 화면은 벽 모델을 2층 B-spline으로 고정 표시하고 벽 구성만 양쪽 / 위쪽만 / 아래쪽만 선택한다. 생성 중 안내와 미리보기도 벽 모델로 표기한다. JSON 키 proxy와 내부 scene 키는 유지하며 과거 reference/random 값은 기존 재현 자료용으로 보존한다.

용어 수정 뒤 실제 HTML 선택/현재 22-source offline bundle·classic Blob worker·DOM·renderer 관련 검사 5/5가 통과했다(512.599 ms). 직전 로직 회귀 검사 118/118 결과와 구분하며 수치 source 11개는 계속 같다.

## 한글 단어 단위 줄바꿈

본문에 word-break:keep-all과 overflow-wrap:normal을 적용하고 상태·조회·지표·provenance의 anywhere 줄바꿈을 제거했다. 코드 문자열은 별도 anywhere를 유지한다. 당시 장면 선택은 좁은 입력칸에 맞춰 Reference / Random으로 짧게 표시하고 title에 전체 corridor 이름을 유지했다. 현재 공개 화면은 벽 모델 고정 표시와 별도의 벽 구성 선택을 사용한다. 일반 설명의 corridor 표기는 같다. 변경 뒤 표시·offline 관련 5/5 검사가 통과했다(466.007541 ms). 로컬 HTTP 1920×930 및 390×844의 설정 안내·설명 대화창·상태·조회 문구에서 computed word-break=keep-all, overflow-wrap=normal을 확인했고 문단 및 대화창 scrollWidth/clientWidth가 같았다. 이는 CSS/폭 검사이며 모든 단어의 문자별 줄 위치를 자동 비교한 결과는 아니다.


## 2026-10-02 DRF 전용 공개 배포와 고정 지도 시점

공개 artifact는 `build-pages.mjs`의 runtime allowlist 24개만 포함한다. HTML은 `drf.html` 하나이며 루트 index, 이전 비교판, SURF 앱과 테스트 화면은 포함하지 않는다. README 자동 변환을 포함하는 기존 branch-root Pages 대신 `.github/workflows/pages.yml`에서 이 artifact를 배포한다. 기존 연구 소스와 44개 보호 파일은 저장소에 유지한다.

세 공간 지도는 정적 벽 extent 또는 사용자가 선택한 전체 domain으로 기본 범위를 계산한다. 현재/과거 차량 위치와 벽 후보점을 bounds에 합치던 코드와 frame/wire 변경 때 자동 camera를 지우던 코드를 제거했다. 차량이 오른쪽으로 화면 밖에 나가도 시점과 배율은 유지되며, 화면 밖의 그리기는 기존 canvas clip을 따른다. 수동 확대와 이동, 기본 축소 하한, 처음으로와 화면 크기 변경의 등척 동작은 유지한다. 추정기 입력, 차량 주행식과 수치 source는 변경하지 않았다. 이전 기록의 RAW 차량 범위 자동 확장은 현재 동작에 적용되지 않는다.

`npm test` 119/119, 실패 0, 17.140796625 s. RAW, Dbar, betaHat에 120–150 m 차량과 [300,400] 후보점 및 미래 기록을 전달해도 camera, 표시 범위와 축소 하한이 변하지 않는지 검사했다. 확대 상태 유지와 기본 보기 복귀, layer toggle, pan/resize와 입력 불변도 검사했다. 배포 검사는 HTML 진입점 하나와 runtime 의존성의 완전성 및 원본 byte 일치를 확인한다. 현재 offline bundle의 22개 source SHA와 VM/Blob Worker 및 동결된 estimator hash 검사도 통과했다.
