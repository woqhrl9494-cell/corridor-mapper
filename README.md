# EchoMap — SURF 곡면 추정 실험실

[시뮬레이터](https://woqhrl9494-cell.github.io/corridor-mapper/) / [이전 Corridor/Torus 비교판](https://woqhrl9494-cell.github.io/corridor-mapper/legacy.html)

기본 페이지는 동결된 SURF와 CROSS를 같은 12초 거리 기록으로 비교한다. 단일 원호 또는 사인 벽, 차량 4/5대, 거리 잡음 0/1/5 cm, 위치 오차 0 m의 기존 개발 조건을 제공한다. 이전 LM/TR-GN/VP 비교판은 `legacy.html`에서 보존한다.

## 실행

```sh
npm ci
npm run build
python3 -m http.server 8891 --bind 127.0.0.1
```

`http://127.0.0.1:8891/`을 연다. 초기 화면은 **저장된 개발 결과**이며, 실행 버튼을 누르면 해당 브라우저에서 관측 생성과 추정을 다시 수행한다. Python/NumPy는 Pyodide 314.0.6으로 module Web Worker 안에서 실행한다. 첫 실행에는 jsDelivr의 계산 엔진 다운로드가 필요하다. HTML을 `file://`로 직접 여는 방식은 지원하지 않는다. 기본 배포에는 빌드된 bundle도 포함된다.

## 동결된 방법

- `surf/core/surface.py`는 B4 준비 완료본과 byte 단위로 동일하다. augmented QR 풀이와 추정 곡면의 최종 reflection/visibility 검사를 포함한다.
- 원시 거리 MSE + 기존 곡률 penalty. degree `{2,4,6,8}`, regularization `{0,1e-5}`. 기존 1초 시간 block validation, 관측 기반 chart와 초기값, 모호성 판정을 유지한다.
- C와 CROSS의 두 함수 본문 및 필요한 모듈을 보존하고 Node 파일 입출력 부분만 browser bundle entry에서 분리한다. CROSS의 `0.3 mm + 3σ` 규칙은 동일하다.
- SURF_ENV_E0 점 교체 보정은 웹 기본 경로에 없다. 동결 기록에는 과거 ablation 정의가 보존되어 있으나 이 페이지에서 실행하지 않는다.
- 동결 source hash: `e91f329b82dd13134e85d3a1773feb48b52b50da74fe774cbde3cb531df0d7ca`.
- 실행 core SHA-256: `a9b5520c95b696620852ae5acd0e651a9dc1d950d920a6d778a6b3970e594792`.

`surf/core/browser_bridge.py`는 진행률과 결과 직렬화만 추가한다. solver의 결과를 재선택하거나 접점을 이동하지 않는다. 두 가설이 남으면 `AMBIGUOUS` 곡면들을 보여주고 단일 접점을 출력하지 않는다.

## 정보 경계와 표시

관측 생성 worker → 화면의 원시 기록 → **명시적 관측 필드만 복사** → 추정 worker → 최종 출력 → 참값 평가 순서다. 추정 worker에는 참 벽, 참 접점, 벽 모양, seed, 평가 자료를 보내지 않는다. 대상 ID의 seed 문자열은 추적용 이름이며 모델 계산에 쓰지 않는다. 전체 관측창의 위치는 알려진 공변량으로 사용하지만 validation 거리값은 training 초기 높이에 쓰지 않는다.

이 페이지는 **12초 batch reconstruction**이다. 결과 사용 가능 시점은 12초 기록이 준비된 뒤의 계산 완료 시점이다. 재생 막대는 차량 기록만 재생하며 추정 곡면/접점을 온라인 출력으로 표시하지 않는다. 두 방법 모두 같은 기록과 요청 목록을 사용한다.

지도는 x/y의 1 m를 같은 픽셀 길이로 그린다. 자동 범위에는 표시한 참 벽, 가설, 접점, 차량 궤적, 선택한 C/CROSS 자료를 모두 포함한다. 지도 범위는 역산에 들어가지 않는다. 확대/이동 시 자동 범위를 해제하고 전체 보기로 복구한다.

coverage는 모든 참 접점에서 0.12 m 이내인 참 벽 표본 중 **선택된 요청 접점**에서 0.2 m 이내인 비율이다. 촘촘히 그린 추정 곡면 표본은 coverage 계산에 포함하지 않는다. 곡면 전체 선은 모형의 외삽을 포함하며 관측하지 않은 벽까지 복원했다는 의미가 아니다.

JSON은 `input`, `measurement`, `result`, `Intended Point`를 분리한다. CSV는 미출력 요청도 남긴다. PNG는 현재 지도의 300 dpi 이미지와 물리 해상도 metadata를 저장한다.

## 검증

```sh
npm test                  # legacy + SURF adapter, 60 tests
npm run test:legacy-dom    # old UI handlers with jsdom
```

브라우저에서 `/tests/surf/browser-check.html`의 Run browser parity를 누르면 원호, 5 cm 잡음 사인, 정확 대칭의 **기존 개발 자료 3개**를 실제 WASM으로 계산한다. ID/status/branch/degree/λ는 exact, 좌표/coefficients/곡면은 1e-6 m, 법선 성분은 1e-7, cost는 1e-10 + 1e-7 relative로 비교한다. 기존 numerical tolerance를 변경하지 않는다.

개발 기록 25개는 관측, 위치, 요청 시각, 참값, 벽 표본의 해시가 기존 B0–B3 원자료와 일치해야 한다. TEST-ID seed는 UI 생성기에서 거부한다. B4의 TEST-ID 600개는 실행하지 않았다.

[웹 변경과 검증 기록](SURF_WEB_VALIDATION.md), [동결 프로토콜](surf/core/B4_frozen_protocol.json), [이전 문서](LEGACY_README.md).

## 계산 범위

SURF는 모델 8종에 두 초기면을 적용하고 최종 두 가설을 재적합한다. N개 관측, G개 root scan 구간, D개 coefficients, I번 반복에서 주 비용은 O(18 I N G D), 작업 배열은 O(N G + N D + 127 N)이다. 현재 최대 N=2400, G=256, D=9이며 worker에서 실행하여 지도 조작과 분리한다. 브라우저/기기에 따라 시간과 메모리 사용량은 달라진다.

현재 검증 범위는 단일 그래프 곡면, 단일 정반사, 정확한 위치다. 다중 벽, 비그래프 폐곡선, 실제 센서 위치 bias, 통신 지연을 검증한 것으로 해석하지 않는다. 최종 가시성 검사는 열린 경로당 127개 표본이며 연속 곡면의 완전한 가시성 증명은 아니다. 무잡음 원호도 유한 차수 다항 곡면의 근사 오차 때문에 수치 오차 0을 보장하지 않는다.
