# EchoMap DRF 검증 기록

상태: truth-side 진단과 근 보호, 캐시 URL 수정 후에도 Phase 3 통계 수용 기준 12개가 미충족이었다. 사용자는 이전의 같은 수용 실패 상태를 확인한 뒤 기존 GitHub Pages 배포를 승인했다. model8 배포 당시 자동 검사 113/113과 현재 수치 source SHA에 연결된 160회 통계를 확인했다. 현재 차량 수를 2–20대로 확장했으며 기본 3대 160회 통계의 수치 결과를 유지한다. 원본 MATLAB/Octave 세 파일과 메인 알고리즘이 제공되지 않아 전체 구현 parity는 미검증이다.

## 변경과 재현 조건

- 기준 저장소 commit: `751f34e3d8d7ee1317554672152d6a2563ce2e0c`, 작업 branch: `feat/drf-lab`.
- SURF 홈 유지, `drf.html` 별도 추가. 승인된 기존 변경은 nav 링크와 글자/컨트롤/표시 여백/문자 대비이다. 기존 알고리즘과 나머지 44개 보호 파일의 SHA-256은 유지한다.
- 사용자 요청에 따라 첫 화면의 정보량을 늘렸다. 참고 HTML 배치에 맞추어 데스크톱 설정 글자와 축은 14 px 이상, 일반 입력과 실행 버튼 높이는 28–36 px이다. 폭 1680 px 이상의 화면에서는 사이드바를 456 px에서 342 px로 줄이고 설정 라벨과 입력, 지표와 수치를 같은 행에 표시한다. 사후 평가 라벨은 13 px이며 한 줄로 표시한다. 상단 RAW와 하단 행의 비율은 1.3:1에서 1.9:1로 바꿨다. 모바일 DOM 글자는 16 px 이상, 버튼 높이는 44 px 이상이다.
- 밝은 clay 스타일의 표면과 컨트롤, 흰 plot 배경 및 내부 격자를 적용했다. RAW는 등척을 유지하며 panel 크기를 표시할 metre 범위에 맞춘다. 하단 두 필드에도 기본 등척을 적용하며 선택 가능한 채움 방식을 유지한다. 화면의 도구명은 DRF 시뮬레이터, 소속 표기는 한양대학교 WSL이다.
- 새 런타임 의존성 없음. Node 표준 라이브러리와 기존 브라우저 API 사용.
- `file://` 실행을 위한 classic bundle 추가. 기존 esbuild로 동일한 앱과 scenario/field/eval/sweep Worker를 묶고, Worker는 4종의 classic Blob script로 실행한다. provenance와 참조 fixtures JSON도 bundle에 포함하므로 로컬 파일에서 module import나 JSON fetch에 의존하지 않는다.
- 새 truth-side 명세에 맞춰 벽별 thinning 전/후 diffuse 개수를 진단 기록에 추가했다. 기존 `generated.diffuse`는 thinning 후, resolution 병합 전 합계로 유지한다. Newton의 불안정 이동과 최종 Fermat 잔차를 검사하고 near-multiple 근 개수를 미확정으로 보고한다. 이 truth-side 변경은 model8에 적용했다. 직전 UI 변경에서는 Field/evaluator 누적식과 수치 소스 11개를 수정하지 않았다. 이번 차량 확장은 scenario의 궤적과 입력 범위, sweep의 cache URL을 변경했으며 Field/evaluator 누적식은 유지한다.

```sh
npm run build:drf-offline
npm test
node tests/drf/run-reference.mjs --seed-count 10 --workers 3
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

환경: v26.7.0, darwin arm64, 3 workers. 각 조건은 60 snapshots, 150 × 150 격자, seed 1–10. Truth-side 진단과 근 보호, 캐시 URL 수정 후 2026-10-02T02:14:22.179Z 실행은 완료 160/160, 실행 오류 0, 실행 중 소스 변경 없음, 전체 48.057688 s였다. 이전 49.790 s 실행의 160개 input/summary/final 체크섬, aggregate와 실패 행이 모두 정확히 같았다. 수치 소스 11개의 실행 전후 SHA가 현재 파일과 일치한다. 아래 수치 표는 그대로 유지하며 ±는 seed 간 표본 표준편차다.

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

사용자가 제공한 corridor_mapper.html의 밝은 배경과 배치를 바탕으로 clay 스타일을 적용했다. 왼쪽에는 설정과 수치, 상단에는 측정 타원과 차량 궤적을 표시한다. 하단에는 D̄, β̂, 선택한 시간별 평가 지표를 각각 표시한다. 산란/필드 세부 설정과 표시/레이어는 기본으로 펼쳐 둔다. 큰 데스크톱에서는 입력 라벨과 값, 지표 라벨과 수치를 같은 행에 표시해 모든 설정을 볼 수 있게 했다. 작은 화면에서는 설정과 추가 실험을 스크롤로 접근하고 모바일은 세로로 배치한다.

상단 자동 보기는 명시적으로 켠 평가용 참벽의 범위 또는 공개 60 × 30 m 영역을 사용한다. 하단 필드도 전체 x=0–60 m를 표시한다. 평가용 참벽 표시를 켜면 그 범위에 자동으로 맞추고, 끄면 공개 계산 영역을 사용한다. 차량 주변 24 × 24 m 확대는 기본 화면에서 제거했다. 이후 관측은 보기에 사용하지 않는다. 휠과 드래그는 수동 보기를 유지하며 전체 보기는 공개 계산 영역으로 돌아간다. 계산 격자, 수치 필드와 평가값은 변경하지 않았다.

RAW는 항상 x/y의 1 m 길이를 같게 표시한다. 공개 영역이나 명시적으로 켠 참벽 범위의 가로세로 비율과 사용할 수 있는 행 높이에 맞추어 panel 자체의 폭과 canvas 높이를 조절한다. RAW 제목과 조작 버튼은 두 행으로 고정해 줄바꿈에 따른 크기 피드백을 줄였다. 이 과정에서 측정 좌표나 추정 수치를 변경하지 않는다.

`필드 채움`과 `필드 등척` 선택은 하단 D̄/β̂에만 적용한다. 선택 가능한 `필드 채움`은 x/y 축에 독립 배율을 사용하므로 수치 좌표와 m 단위는 같아도 화면의 x/y 1 m 길이는 다를 수 있다. 기본 `필드 등척`은 두 방향의 1 m 길이를 같게 표시한다. 필드 표시축을 바꿔도 수동으로 확대한 RAW camera는 유지된다. hover 역변환과 확대/이동은 각 그래프의 실제 표시 배율을 사용하며 추정 알고리즘에 전달하지 않는다.

RAW, D̄/β̂, 시간별 평가, Sweep, 히스토그램, profile 및 산점도에 내부 격자를 표시한다. 거리 지도 x/y 격자와 profile x 격자는 10 m 간격이며 확대 시에도 물리 간격은 유지한다. 시간별 평가와 분석 그래프의 plot 여백도 줄였다. D̄는 밝은 warm 순차색, β̂는 밝은 blue 순차색이며 정확히 0인 셀은 투명하다. Canvas와 dashboard 크기를 관찰하고 metricChart도 별도로 관찰해 크기 변경 후 다시 그린다.

확대 버튼 옆의 `처음으로`는 세 지도의 확대와 이동만 기본 보기로 복원한다. 현재 snapshot, 기록, 설정과 실행/일시정지/재생 상태를 그대로 유지한다. 축소 버튼과 마우스 휠은 기본 보기의 배율 아래로 축소하지 않는다. 이전의 첫 snapshot 선택과 일시정지 동작은 사용자가 명확히 한 camera-only 요구에 맞춰 제거했다. 이전 버튼 검사 기록은 당시 동작의 기록이며 현재 동작을 뜻하지 않는다.

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

[density-validation.json](tests/drf/density-validation.json)의 schema 5는 실제 HTTP 화면 검사이며 이전 schema 4 전체는 `previousLayoutEvidence`에 보존한다. 현재 1920 × 930과 1920 × 1080에서 사이드바는 342 px이고 clientHeight/scrollHeight는 각각 876/876 px, 1026/1026 px이다. 설정 컨트롤 28개와 네 canvas가 모두 첫 화면에 보였다. 설정 글자는 최소 14 px, 컨트롤 높이는 최소 28 px이다. 사후 평가 라벨 6개는 13 px, 높이 15.59375 px, line-height 15.6 px로 한 줄이며 잘림이 없었다. 모바일 390 × 844의 document 가로 넘침은 0, DOM 글자는 최소 16 px, 컨트롤 높이는 최소 44 px이다.

- 1920 × 930: RAW panel 1156.8125 × 485.625 px, canvas 1154.8125 × 418.125 px, plot 1095 × 356 px, x/y 동일 17.5390038034 px/m.
- 1920 × 1080: RAW panel 1458.953125 × 583.90625 px, canvas 1456.953125 × 516.40625 px, plot 1397 × 454 px, x/y 동일 22.367156535811 px/m.
- 1920 × 930의 Dbar: canvas 505.65625 × 199.765625 px, plot 398 × 138 px, x/y 동일 6.3782051282 px/m. 기본 보기의 x 범위는 여백 포함 −1.2–61.2 m이다.

이전 schema 5 HTTP 기본 60 snapshot 실행은 Q=2904이며 Dbar/β̂ Float32 SHA-256은 991070913d2413f391b6d6417326dd9764053ce1111bb0061874050ea524c926로 기존 결과와 같았다. 실행 전 `처음으로` 실제 클릭은 확대된 RAW camera를 기본 배율로 복원하고 snapshot 0 / 60과 설정을 유지했다. 실행 후 실제 클릭은 선택 1, slider max=60과 세 지도 자동 보기를 유지했다. 이는 HTTP 검사이며 실제 file 화면 검증으로 확대하지 않는다.

직전 표시 수정 후 자동 검사는 113/113 통과, 실패 0, 14.65061275 s였다. VM 회귀 검사에는 기록 없는 idle/측정 준비 중 버튼 활성화와 세 camera 복원, 설정/기록/worker/실행 상태 보존, 처리 중 결과 도착 뒤 첫 snapshot 선택 유지가 포함된다. Offline 22개 source bundle과 classic Blob Worker, 44개 보호 파일, 기존 160회 보고서의 수치 source SHA 검사도 통과했다. 직전 표시 수정에서는 수치 소스 11개의 SHA가 그대로여서 160회를 다시 실행하지 않았다. 이번 차량 확장은 다음 별도 기록을 따른다. 참조 수용 기준의 12개 미충족도 유지한다.

## 차량 2–20대 확장

기존 3대 제한을 확장하고 실제 20대 궤적과 190쌍을 생성한다. 기존 1–3번 궤적과 공통 쌍의 RNG 주소를 보존한다. 추가 차량은 고정 x0∈[1,14] m 슬롯을 사용하며 60개 시점에서 벽 내부에 머문다. 차량의 차폭과 접속 스케줄은 모델에 포함하지 않는다.

[fleet-validation.json](tests/drf/fleet-validation.json)의 Node 기본 20대 전체 실행은 60/60, 187,631개 경로, 모든 field 값 유한, 최종 SHA `3b3897843980dd07c6ac99c0a407ec0677f1750f73328fde6703c7d132c6c254`를 확인했다. 단일 seed 완료 검사이며 20대 성능의 모집단 통계가 아니다. 계산 시간과 단일 process의 표본 메모리는 HTTP 화면 및 Worker 메모리와 구분한다.

기본 3대 160회 통계도 새 source로 다시 실행했다. 46.974087 s, 실행 오류 0, sourcesStable=true이며 이전 160개의 input/summary/final과 aggregate/comparisons/failures는 정확히 같다. 참조 수용 조건은 84/96 통과, 기존 12개 미충족이다.

타원 표시량은 최대 600개로 제한하며 원본 wire와 추정 경로는 모두 유지한다. 표시 수와 측정 수를 RAW 제목에 표시한다. 20대 차량점과 궤적을 유지하고 번호는 plot 안에만 배치한다. 이는 큰 차량 수의 Canvas 표시 비용과 번호 잘림을 해결하는 표시 변경이다.

차량 확장 후 `npm test`는 115/115 통과, 실패 0, 18.282778 s였다. 실제 20대 생성기 연결 검사와 표시 600개 상한, 전 차량점 유지, 번호 bbox/차량점 겹침과 plot 경계 검사가 포함된다.

차량 확장 수정 당시 HTTP module 화면에서 차량 20대, 60/60, Q=187631과 같은 최종 필드 SHA를 확인했다. 1920×930 content viewport에서 사이드바는 342 px, clientHeight/scrollHeight=876/876 px이고 28개 설정 컨트롤과 네 canvas가 모두 첫 화면에 보였다. 마지막 시점의 측정 4326개 중 타원 541개가 표시됐다. 생성 중 취소는 기록 0개와 실행 가능 상태로 돌아갔고, 완료 후 `처음으로`는 1/60을 선택하며 60개 기록을 유지했다. Console warning/error는 0개였다. 20대 수치 폭으로 하단 설명이 5 px 잘린 문제는 desktop section 상하 여백 2→1 px로 해결했다. 이 마지막 CSS/cache/bundle 수정 후 관련 7개 표시·버튼·offline 검사는 모두 통과했다. 실제 file 화면 검증으로 확대하지 않는다.

## 보기 초기화와 축소 하한 수정

`처음으로`에서 첫 snapshot 선택, 재생 정지와 실행 일시정지를 제거했다. 세 지도의 camera 복원만 수행하므로 현재 시점과 기록, 입력, worker와 실행/재생 상태를 유지한다. 기본 배율은 현재 plot 크기와 표시 범위의 CSS px/m로 계산하며 버튼과 휠에서 두 축 모두 그 배율보다 작아지지 않게 제한한다. 화면 크기나 표시 범위 변경 때도 하한을 갱신한다. 이동 중심과 확대 anchor를 보존한다.

자동 검사 115/115 통과, 실패 0, 11.806166 s였다. VM에서 기록 없는 idle/준비 중과 done/paused/running/cancelled, 재생 rAF와 진행 중 field 요청 상태 보존을 확인했다. 실제 RAW/등척 Dbar/채움 betaHat 객체에서는 축소 버튼, 휠, 이동, 양방향 화면 크기 변경과 표시 범위 변경을 검사했다.

HTTP 실제 화면에서 기본 60 snapshot의 Q=2904와 최종 Float32 SHA는 그대로였다. 세 지도를 확대하고 이동한 뒤 `처음으로`를 눌렀을 때 60/60과 상태, 기록 및 수치는 그대로이고 세 camera가 기본 보기로 복원됐다. 59/60을 따로 선택한 검사도 그 시점을 유지했다. 반복 축소 버튼과 세 지도의 휠 축소는 초기 배율에서 멈췄다. Console warning/error는 0개였다. 상세 기록은 [view-reset-validation.json](tests/drf/view-reset-validation.json)이다.

수치 source 11개와 기존 160회 reference 보고서의 SHA가 일치하므로 수치 실험은 다시 실행하지 않았다. 기존 참조 수용 조건 12개 미충족도 그대로이다. offline 22개 source bundle을 다시 생성하고 검사했으며 실제 file 화면 검증으로 확대하지 않는다.
