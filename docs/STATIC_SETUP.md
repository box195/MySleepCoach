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
```

`FETCH_STEPS: true`이면 추가 요청:

```text
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
```

사용 endpoint:

```text
GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints
GET https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints
```

`nextPageToken`이 존재하는 동안 `pageToken`으로 다음 페이지를 계속 조회합니다.

## 사용자 동작과 저장 정책

페이지를 연 뒤 **동기화** 버튼을 누릅니다. Google Identity Services 토큰 팝업에서 계정을 선택/승인하면 그때 받은 단기 access token으로 Health API를 호출합니다.

- refresh token을 브라우저에 저장하지 않습니다.
- access token을 `localStorage`, `sessionStorage`, 쿠키, 파일, Git 저장소에 저장하지 않습니다.
- Health 원본과 계산 결과도 브라우저 저장소에 저장하지 않습니다.
- 새로고침하면 메모리 데이터가 사라지므로 다시 **동기화**를 눌러야 합니다.

## 정적 모드에서 비활성화된 기능

Gemini AI 코칭과 카카오 알림은 서버 비밀키/토큰이 필요한 기능이라 정적 모드에서는 호출하지 않고 화면에 비활성 상태를 표시합니다.

Strain은 실제 Whoop 센서 값이 아니라 기존 수면 계산식의 **추정 지표**입니다. 기존 코드의 고정 최신값 `15.8`은 제거했습니다. steps를 허용하면 최신 수면 날짜의 실제 step 합계는 가져오지만 현재 대시보드의 Strain 자체를 실제 Whoop 값으로 취급하지 않습니다.

## 호스팅 상태

`docs/`는 상대 경로 자산을 사용하도록 준비했습니다. 현재 private 저장소의 GitHub Pages 사용 가능 여부는 계정/플랜 설정에 따르며, 이번 변경에서는 visibility나 Pages 설정을 건드리지 않았습니다.
