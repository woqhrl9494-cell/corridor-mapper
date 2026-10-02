# EchoMap DRF 시뮬레이터

[DRF 실행 화면](https://woqhrl9494-cell.github.io/corridor-mapper/drf.html)

한양대학교 WSL의 브라우저 실험 도구이다. 측정 생성, Direct Residual Field 누적과 참값 사후 평가를 분리한다. 차량 2–20대, 기본 전체 주행 80 snapshots를 지원한다. 기존 SURF 홈과 이전 비교판은 공개 배포에서 제거했다.

지도 기본 범위는 정적 벽 영역으로 고정한다. 차량과 벽 후보점이 화면 밖으로 나가도 자동으로 이동하거나 축소하지 않는다. 확대, 이동, 전체 보기와 처음으로는 화면 조작이며 계산 기록과 현재 snapshot을 유지한다.

## 실행과 검사

```sh
npm ci
npm run build:drf-offline
npm test
node build-pages.mjs
python3 -m http.server 8871 --bind 127.0.0.1 --directory _site
```

`http://127.0.0.1:8871/drf.html`을 연다. 로컬 원본 `drf.html`을 파일로 열 때는 생성된 classic bundle을 사용한다. 실제 파일 화면의 브라우저 검증과 bundle 자동 검사는 구분한다.

## 배포

`.github/workflows/pages.yml`은 `main`의 DRF runtime 24개만 GitHub Pages에 배포한다. HTML 진입점은 `drf.html` 하나이며 루트와 `index.html`, `legacy.html`은 배포하지 않는다. `surf/map.mjs`, `surf/exports.mjs`, `wall_metrics.js`는 DRF가 사용하는 공통 함수이다. 연구 소스와 기존 검증 자료는 저장소에 보존한다.

[방법과 재현 조건](DRF_METHOD.md), [검증 기록](DRF_VALIDATION.md)을 참고한다. 기존 160회 참조 통계의 수용 기준 12개 미충족과 원본 MATLAB 전체 parity 미검증 상태는 유지된다. 지도 표시 수정은 알고리즘 성능 개선을 의미하지 않는다.
