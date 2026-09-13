# 🌙 핏빗 에어 & 구글 헬스 AI 수면 코치 (MySleepCoach)

사용자의 **Google Fitbit Air** 기기에서 측정한 수면 및 바이탈 데이터를 **Google Health API**를 통해 실시간으로 가져와, **수면 부채(Sleep Debt)** 및 **신체 컨디션 점수**를 정밀 계산하고, **Gemini 3.6 Flash**가 작성한 맞춤 브리핑을 **카카오톡(나에게 보내기)**으로 매일 발송해 주는 자동화 시스템입니다.

---

## 🚀 주요 기능
- **실제 핏빗 에어 원천 데이터 분석**: 총 수면 시간, 수면 효율, 수면 단계(깊은 수면, 렘 수면, 얕은 수면, 각성 시간)
- **정밀 수면 부채(Sleep Debt) 계산**: 최근 14일간 목표 수면(기본 8시간) 대비 부족한 누적 피로 시간 산출
- **신체 컨디션 점수(0~100점)**: 수면 품질, 수면 효율, 수면 부채 감점을 반영한 당일 에너지 회복 지수
- **최신 Gemini 3.6 Flash AI 코칭**: 당일 수면 상태에 맞는 오후 파워냅, 카페인 조절, 취침 루틴 맞춤 코칭
- **카카오톡 자동 전송**: 스마트폰 카카오톡으로 매일 실시간 알림 수신

---

## 💻 로컬에서 즉시 실행하기
폴더 내의 `수면브리핑_실행.bat` 파일을 더블클릭하면 5초 만에 최신 수면 데이터를 분석하여 카카오톡으로 전송합니다.

```bash
python sleep_coach.py morning   # 아침 브리핑
python sleep_coach.py evening   # 저녁 브리핑
```

---

## ☁️ GitHub Actions 클라우드 자동화 (서버 비용 0원)
깃허브 비공개 저장소(Private Repo)에 이 폴더를 올리고, 아래 5개 시크릿을 등록하면 **매일 아침 7시 30분 / 저녁 9시 30분에 알아서 자동 발송**됩니다.

### GitHub Repository Secrets 등록 항목 (Settings > Secrets and variables > Actions):
1. `GOOGLE_CLIENT_ID`
2. `GOOGLE_CLIENT_SECRET`
3. `GOOGLE_REFRESH_TOKEN`
4. `KAKAO_REST_API_KEY`
5. `KAKAO_REFRESH_TOKEN`
6. `GEMINI_API_KEY`
*(값들은 현재 폴더의 `config.json` 안에 모두 안전하게 저장되어 있습니다.)*
