# MySleepCoach 정적 브라우저 모드 설정

이 `docs/` 폴더는 Flask/Python 서버 없이 브라우저에서 직접 Google Health API를 읽도록 준비되어 있습니다.

## OAuth Web Client ID

Google Cloud에서 **OAuth 2.0 Web application Client ID**를 사용합니다. Client ID는 공개 식별자이므로 정적 프론트엔드에 둘 수 있지만, **client secret / refresh token / PAT / API key는 절대 넣지 않습니다.**

`docs/config.js`에는 기존 Google Cloud 프로젝트의 공개 웹 클라이언트 ID가 설정되어 있습니다:

```js
GOOGLE_CLIENT_ID: "69163544650-j1vj5lnvm2co197pfg4sn1k7prfltcs8.apps.googleusercontent.com"
```

## Authorized JavaScript origin

OAuth 클라이언트의 **Authorized JavaScript origins**에 `https://box195.github.io`를 등록했습니다.

GitHub Pages 예시:

```text
https://<github-user>.github.io
```

origin에는 저장소 경로(`/MySleepCoach/`)를 붙이지 않습니다. 로컬 시험은 `file://` 대신 HTTP origin(예: `http://localhost:8000`)을 사용하고 그 origin도 별도로 등록합니다.

GitHub Pages 설정과 저장소 공개 범위는 별도로 관리합니다.

## 요청 scope

항상 요청:

```text
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
```

두 번째 권한은 일일 HRV와 안정시 심박수에 사용합니다. 사용자가 이를 허용하지 않으면 수면만 동기화하고 컨디션 점수는 자료 부족으로 표시합니다. 새 권한을 처음 요청할 때 Google 동의 화면이 나올 수 있습니다.

`FETCH_STEPS: true`이면 추가 요청:

```text
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
```

사용 endpoint:

```text
GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile
GET https://health.googleapis.com/v4/users/me/dataTypes/daily-heart-rate-variability/dataPoints:reconcile
GET https://health.googleapis.com/v4/users/me/dataTypes/daily-resting-heart-rate/dataPoints:reconcile
GET https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:reconcile (선택)
```

`nextPageToken`이 존재하는 동안 `pageToken`으로 다음 페이지를 계속 조회합니다. `reconcile` 요청이 실패하면 일반 `dataPoints` 목록으로 한 번 재시도하고, 화면에서는 같은 날짜의 주 수면을 우선 선택합니다.

## 사용자 동작과 저장 정책

페이지를 연 뒤 **동기화** 버튼을 누릅니다. Google Identity Services 토큰 팝업에서 계정을 선택/승인하면 그때 받은 단기 access token으로 Health API를 호출합니다.

- refresh token을 브라우저에 저장하지 않습니다.
- access token을 `localStorage`, `sessionStorage`, 쿠키, 파일, Git 저장소에 저장하지 않습니다.
- Health 원본은 브라우저 저장소에 저장하지 않습니다. 화면에 표시할 계산 결과는 해당 기기의 `localStorage`에 마지막 동기화본으로 저장합니다.
- 새로고침·재방문 때 마지막 동기화 화면이 바로 보입니다. 최신 데이터를 받으려면 **동기화**를 누르세요. 브라우저 데이터 삭제, 비공개 모드, 다른 기기에서는 저장 화면이 공유되지 않습니다.
- Google은 승인된 권한을 계정에 기억할 수 있지만, 짧게 유효한 access token은 매 동기화 때 새로 발급됩니다. 계정 로그인 상태나 새 권한 요청에 따라 Google 화면이 다시 나타날 수 있습니다.
- 이 기기를 함께 쓰는 사람이 있다면 브라우저의 사이트 데이터에서 `box195.github.io`의 저장 데이터를 삭제하세요.

## 정적 모드에서 비활성화된 기능

Gemini AI 코칭과 카카오 알림은 서버 비밀키/토큰이 필요한 기능이라 정적 모드에서는 호출하지 않고 화면에 비활성 상태를 표시합니다.

수면효율은 Google Health의 `sleep.summary.minutesAsleep / sleep.summary.minutesInSleepPeriod`를 우선 사용합니다. 수면·컨디션 점수는 Google/Fitbit의 공식 점수가 아니라 앱의 **추정치**입니다. HRV나 안정시 심박수의 개인 기준선이 부족하면 컨디션 점수를 표시하지 않습니다. 이전의 가상 Whoop Strain 값은 제거했습니다.

## 호스팅 상태

`docs/`는 상대 경로 자산을 사용합니다. GitHub Pages 주소는 `https://box195.github.io/MySleepCoach/`입니다.

## 참고 문서

- [Google Identity Services 토큰 모델](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Health 수면 데이터와 효율](https://developers.google.com/health/data-types/sleep)
- [Google Health 데이터 포인트 구조](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints)
- [Reconcile API](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/reconcile)
