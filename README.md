# MySleepCoach

개인용 수면 대시보드입니다. Flask 서버가 로그인, 건강 데이터 조회, 수동 동기화를 처리합니다. 기존 GitHub Pages 정적 사이트는 이 서버 구조를 실행할 수 없습니다.

## 동작 방식

- 앱에서 **동기화**를 누르면 인증된 `POST /api/sync`가 기존 `sleep_coach.py` 파이프라인을 실행합니다.
- 동기화 상태는 화면에 표시됩니다. 완료되면 대시보드 데이터를 다시 읽습니다.
- 건강 데이터는 `private_data/data.json`에 저장하고 `/api/data`에서 로그인한 사용자에게만 제공합니다.
- 웹 동기화는 카카오 알림을 보내지 않습니다.
- GitHub Actions의 예약 실행은 제거했습니다. 수동 실행용 `workflow_dispatch`만 남아 있습니다.

## 서버 배포

휴대폰 등 외부에서 쓰려면 HTTPS를 제공하는 Python 웹 호스팅에 이 저장소를 배포해야 합니다. 예를 들어 Render Web Service 한 개를 사용할 수 있습니다.

- Python: 3.11 이상
- Build: `pip install -r requirements.txt`
- Start: `gunicorn --workers 1 --threads 4 --timeout 180 server:app`
- Health check: `/healthz`

동기화 상태가 서버 메모리에 있으므로 worker는 1개로 둡니다. 호스팅 서비스의 임시 파일 시스템은 재시작이나 재배포 때 초기화될 수 있습니다. 장기간 기록을 안정적으로 보존하려면 영속 스토리지를 붙여야 합니다.

### 서버 환경변수

필수:

- `APP_PASSWORD`: 앱 로그인용 길고 고유한 비밀번호
- `FLASK_SECRET_KEY`: 별도로 생성한 긴 난수
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- `GEMINI_API_KEY`

필요할 때 설정:

- `GEMINI_MODEL`, `TARGET_SLEEP_HOURS`
- `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REFRESH_TOKEN`: 수동 CLI에서 카카오 알림을 사용할 때
- `PORT`: 호스팅 서비스가 지정하는 포트
- `SESSION_COOKIE_SECURE`: 기본값은 `1`이며 HTTPS용입니다. 로컬 HTTP 실험에서만 `0`으로 설정합니다.

모든 비밀값은 호스팅 서비스의 Secret 또는 Environment 설정에 넣으세요. 브라우저 코드나 Git에 넣으면 안 됩니다. 로컬 `config.json`은 기존 CLI 용도로 유지되며 Git에서 제외됩니다.

## 공개 사이트에서 전환하는 순서

1. GitHub 저장소의 `Settings > Pages`에서 기존 Pages 배포를 끕니다. 기존 Pages URL에서 건강 데이터가 더 이상 제공되지 않는지 확인합니다.
2. 과거 공개 저장소에 올라간 `docs/data.json`은 Git 기록에 남을 수 있습니다. 저장소를 비공개로 바꾸고, 이미 노출된 데이터와 인증정보의 처리 필요성을 검토합니다.
3. 변경 코드를 저장소에 반영합니다. `private_data/`, `config.json`, `.env*`는 반영하지 않습니다.
4. Python 웹 서비스를 배포하고 위 환경변수를 서버에 설정합니다. HTTPS 주소에서 로그인과 동기화를 확인합니다.
5. 이 앱은 개인 GitHub Pages의 비공개 사이트로 운영할 수 없습니다. 저장소 비공개 여부와 별개로, 외부 접속은 인증을 지원하는 웹 호스팅에서 처리합니다.

현재 작업은 로컬 코드 변경까지입니다. GitHub Pages 비활성화, 저장소 공개 범위 변경, 푸시, 배포, 자격증명 교체는 아직 수행되지 않았습니다.

## 로컬 사용

의존성을 설치하고 `APP_PASSWORD`와 `FLASK_SECRET_KEY`를 설정한 뒤 `python server.py`를 실행합니다. 로컬 HTTP에서 테스트할 때만 `SESSION_COOKIE_SECURE=0`으로 설정합니다. 주소는 `http://127.0.0.1:8000`입니다.

기존 CLI는 `python sleep_coach.py morning` 또는 `python sleep_coach.py evening`으로 실행할 수 있습니다.
