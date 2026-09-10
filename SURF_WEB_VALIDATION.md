# SURF 웹 시뮬레이터 변경과 검증

2026-09-10. 대상: 기존 corridor-mapper GitHub Pages. B4 TEST-ID 실행 없음.

## 변경 diff

| 파일 | 변경 |
|---|---|
| `index.html`, `surf/style.css` | 원호/사인 SURF 화면, soft raised/inset 제어부, 평면 지도, 모바일 배치 |
| `legacy.html` | 배포 전 index.html의 byte 동일 사본, 기존 Corridor/Torus 및 3종 풀이기 유지 |
| `surf/app.mjs`, `map.mjs` | 실행/취소/차량 재생/레이어, 동일 metre 비율, 자동 범위, 확대/이동 |
| `surf/core/surface.py` | 동결 core를 수정 없이 복사 |
| `surf/core/browser_bridge.py`, `engine.worker.mjs` | Python/NumPy worker 실행, 해시 검사, 진행률/직렬화 |
| `surf/scenario.mjs`, `scenario.worker.mjs`, `environment.js` | 기존 물리 생성식과 개발 조건을 웹에서 실행 |
| `surf/vendor/`, `cross.bundle.mjs` | 동일 C/CROSS 함수의 browser packaging |
| `surf/observations.mjs` | 참값/미래 자료가 계산 입력으로 넘어가지 않는 필드 경계 |
| `surf/metrics.mjs`, `exports.mjs` | 사후 평가와 input/measurement/result/Intended Point 내보내기 |
| `tests/surf/` | 원자료 동일성, 관측 경계, 좌표 변환, 평가, 브라우저 수치 재현 검사 |
| `tests/jsdom_smoke.js` | 기존 UI 검사의 대상 파일만 legacy.html로 변경 |

기존 목적함수, damping, degree/λ 후보, validation, 초기값, search range, ambiguity rule, CROSS threshold, 평가 기준을 변경하지 않았다. `SURF_ENV_E0`는 기본 경로에서 실행하지 않는다. 보존된 프로토콜의 ablation 정의를 삭제하거나 E1을 탐색하지 않았다.

## 수정 이유와 한계

기존 공개 페이지는 TSRI-S의 독립 접점 3종 풀이 비교판이었다. 동결 SURF는 관측된 여러 차량쌍의 원시 거리로 하나의 공유 graph curve를 적합한다. 이를 JS의 비슷한 모델로 교체하면 solver 및 branch 선택이 달라질 수 있어 동일 Python core를 사용했다. SURF가 지원하지 않는 Corridor/Torus를 지원하는 것처럼 표시하지 않고 이전 페이지에 보존했다.

거리/차량/추정 자료는 m, 시간은 s, Python 계산은 float64다. 변환과 평가 자료는 solver와 분리했다. 미래 관측/참값 getter를 예외로 오염시켜도 wire 생성 결과가 변하지 않는 검사를 포함한다. 이 결과는 12초 batch이고 온라인 회수 결과가 아니다.

가시성은 추정 곡면에 대한 127개 표본 검사다. 관측 구간 밖의 그려진 곡면은 모형 외삽일 수 있다. 단일 무잡음 원호의 0.443 mm 오차를 완전한 무오차 복원으로 보고하지 않는다.

## 실제 UI에서 계산한 개발 사례

아래는 저장된 예시 표시가 아닌 실행 버튼으로 계산한 결과다. 시간은 엔진 다운로드를 제외한다. 독립 test-set 성능 주장이 아니다.

| 사례 | SURF 접점 RMSE | 법선 RMSE | coverage | 채택 / 요청 | degree / λ | 상태 | SURF 시간 |
|---|---:|---:|---:|---:|---|---|---:|
| 원호 / 5대 / 무잡음 / 3311001 | 0.443 mm | 0.0030° | 91.8% | 220/220 | 4 / 1e-5 | UNIQUE | 29.47 s |
| 사인 / 5대 / σ=5 cm / 3311001 | 15.980 mm | 0.1150° | 91.0% | 220/220 | 6 / 1e-5 | UNIQUE | 21.52 s |
| 원호 / 정확 대칭 / 92004 | 미출력 | 미출력 | 0% | 0/220 | 6 / 0 | AMBIGUOUS, 2개 가설 | 13.83 s |

동일 원호 관측의 CROSS는 0.816 mm, 214/220개, coverage 85.2%, 0.33 s였다. 동일 잡음 사인의 CROSS는 95.109 mm, 211/220개, coverage 84.1%, 0.34 s였다. SURF와 CROSS는 계산량이 다르므로 같은 시간이라고 주장하지 않는다.

## 검증 절차

- Node: 60/60 통과. 기존 알고리즘 검사와 추가 adapter 검사를 포함.
- 개발 원자료: 25/25 사례에서 거리, 위치, 요청, 참 접점, 벽 표본 hash 일치.
- frozen core/protocol/environment byte hash 일치.
- UI: 실제 실행, 조건 변경 시 이전 결과 제거, 취소, 차량 재생, 후보/곡면 표시, 확대/전체 보기, 정확 대칭, 390×844 반응형 확인.
- 데스크톱 및 모바일 viewport에서 x/y metre당 픽셀 길이 동일, 문서 가로 넘침 없음. 실제 휴대전화 계산 속도를 측정한 것은 아님.
- 다운로드 실제 파일: JSON 차량 좌표 1200개/거리 2400개, SURF 220행. CSV는 SURF/CROSS 총 440행. PNG 2575×1588 px, pHYs 11811 px/m = 299.9994 dpi.
- 브라우저 JS error/warn 없음(검사한 실행과 내보내기).

## Native / WASM 최종 수치 재현

3/3 통과. 원호 4대 무잡음, 사인 5대 5 cm 잡음, 정확 대칭 기존 개발 기록을 재계산했다. Python native NumPy와 Pyodide 314.0.6 / NumPy 2.4.6 사이 결과다.

| 항목 | 최대 절대 차이 | 사전에 고정된 허용오차 |
|---|---:|---:|
| 유효 접점 좌표 성분 (SURF/CROSS) | 7.6384e-13 m | 1e-6 m |
| 최종 곡면 좌표 성분 | 1.6343e-13 m | 1e-6 m |
| 선택 가설 coefficients | 4.7570e-14 | 1e-6 |
| 법선 성분 | 2.1039e-14 | 1e-7 |
| 선택 가설 cost 항목 | 1.2435e-14 | 1e-10 + 1e-7 relative |

ID/status/선택 branch/degree/λ/출력 개수는 exact comparison 통과. 동일 가설의 가시성 검사 모두 통과, 추가 기각 0개. 정확 대칭의 두 대안 곡면도 유지됐다. 최종 JSON 증거는 `tests/surf/browser-parity-result.json`에 있다. 검사 과정에서 chart의 문자열 설명은 exact, 숫자는 numerical tolerance로 비교하도록 test type 처리를 수정했다. 알고리즘이나 허용오차를 변경하지 않았다.

기존 화면 DOM 통합 검사 8/8 통과(40 step, Torus, 산란 처리, reset, export 포함). 별도 실제 브라우저에서도 legacy.html의 초기 화면과 Step ×20을 확인했다.

배포 방식은 기존 GitHub Pages의 main 루트 설정을 유지한다. 공개 페이지의 추가 실측 결과는 배포 후 기록한다.
