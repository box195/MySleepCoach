import os
import sys
import json
import urllib.parse
import urllib.request
import datetime

# 한글 콘솔 출력 인코딩 설정
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

def refresh_google_token(cfg):
    """구글 헬스 리프레시 토큰으로 새로운 액세스 토큰 발급"""
    try:
        url = "https://oauth2.googleapis.com/token"
        data = urllib.parse.urlencode({
            "client_id": cfg["google"]["client_id"],
            "client_secret": cfg["google"]["client_secret"],
            "refresh_token": cfg["google"]["refresh_token"],
            "grant_type": "refresh_token"
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        res = urllib.request.urlopen(req)
        res_data = json.loads(res.read().decode("utf-8"))
        cfg["google"]["access_token"] = res_data["access_token"]
        save_config(cfg)
        return res_data["access_token"]
    except Exception as e:
        print(f"구글 토큰 갱신 에러: {e}")
        return cfg["google"].get("access_token", "")

def refresh_kakao_token(cfg):
    """카카오 리프레시 토큰으로 새로운 액세스 토큰 발급"""
    try:
        url = "https://kauth.kakao.com/oauth/token"
        data_dict = {
            "grant_type": "refresh_token",
            "client_id": cfg["kakao"]["rest_api_key"],
            "refresh_token": cfg["kakao"]["refresh_token"]
        }
        if cfg["kakao"].get("client_secret"):
            data_dict["client_secret"] = cfg["kakao"]["client_secret"]

        data = urllib.parse.urlencode(data_dict).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        res = urllib.request.urlopen(req)
        res_data = json.loads(res.read().decode("utf-8"))
        cfg["kakao"]["access_token"] = res_data["access_token"]
        if "refresh_token" in res_data:
            cfg["kakao"]["refresh_token"] = res_data["refresh_token"]
        save_config(cfg)
        return res_data["access_token"]
    except Exception as e:
        print(f"카카오 토큰 갱신 에러: {e}")
        return cfg["kakao"].get("access_token", "")

def fetch_sleep_data(google_token):
    """Google Health API에서 수면 데이터 포인트 가져오기"""
    url = "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {google_token}",
        "Content-Type": "application/json"
    })

    try:
        res = urllib.request.urlopen(req)
        data = json.loads(res.read().decode("utf-8"))
        return data.get("dataPoints", [])
    except urllib.error.HTTPError as e:
        print(f"구글 헬스 API 호출 에러 ({e.code}): {e.read().decode('utf-8')}")
        return []
    except Exception as e:
        print(f"수면 데이터 가져오기 실패: {e}")
        return []

def parse_iso(dt_str):
    return datetime.datetime.fromisoformat(dt_str.replace("Z", "+00:00"))

def calculate_sleep_metrics(data_points, target_hours=8.0):
    """
    핏빗 수면 데이터 분석 및 수면 부채 계산
    - 실제 수면 시간, 수면 효율, 수면 단계 (깊은/렘/얕은/깬시간)
    - 최근 14일 누적 수면 부채
    - 신체 컨디션 점수 (0~100)
    """
    if not data_points:
        return {
            "today_sleep_hours": 7.0,
            "today_deep_hours": 1.2,
            "today_rem_hours": 1.5,
            "today_light_hours": 4.3,
            "today_awake_hours": 0.8,
            "sleep_efficiency": 88,
            "condition_score": 80,
            "daily_debt_hours": max(0.0, target_hours - 7.0),
            "cumulative_debt_hours": 1.5,
            "device_name": "Google Fitbit",
            "is_real_data": False
        }

    parsed_days = []

    for pt in data_points:
        sl = pt.get("sleep", {})
        itv = sl.get("interval", {})
        st_str = itv.get("startTime")
        et_str = itv.get("endTime")
        if not (st_str and et_str):
            continue

        st = parse_iso(st_str)
        et = parse_iso(et_str)
        bed_min = (et - st).total_seconds() / 60.0

        stage_dur = {}
        for stg in sl.get("stages", []):
            sst = parse_iso(stg["startTime"])
            set_ = parse_iso(stg["endTime"])
            t = stg.get("type", "UNKNOWN")
            stage_dur[t] = stage_dur.get(t, 0.0) + (set_ - sst).total_seconds() / 60.0

        awake_min = stage_dur.get("AWAKE", 0.0)
        asleep_min = max(0.0, bed_min - awake_min)
        deep_min = stage_dur.get("DEEP", 0.0)
        rem_min = stage_dur.get("REM", 0.0)
        light_min = stage_dur.get("LIGHT", 0.0)

        eff = round((asleep_min / bed_min * 100), 1) if bed_min > 0 else 85.0

        # KST 날짜 변환
        kst_dt = st.astimezone(datetime.timezone(datetime.timedelta(hours=9)))

        device = pt.get("dataSource", {}).get("device", {}).get("displayName", "Fitbit Air")

        parsed_days.append({
            "date": kst_dt.strftime("%Y-%m-%d"),
            "asleep_hours": asleep_min / 60.0,
            "bed_hours": bed_min / 60.0,
            "deep_hours": deep_min / 60.0,
            "rem_hours": rem_min / 60.0,
            "light_hours": light_min / 60.0,
            "awake_hours": awake_min / 60.0,
            "efficiency": eff,
            "device": device
        })

    # 날짜순 정렬 (가장 최근이 맨 뒤)
    parsed_days.sort(key=lambda x: x["date"])

    # 가장 최근 수면 (오늘 또는 어젯밤)
    latest = parsed_days[-1]

    # 최근 7일 및 14일 수면 통계
    recent_7 = parsed_days[-7:]
    recent_14 = parsed_days[-14:]

    avg_7d_sleep = sum(d["asleep_hours"] for d in recent_7) / max(1, len(recent_7))

    cumulative_debt = 0.0
    for day in recent_14:
        diff = target_hours - day["asleep_hours"]
        if diff > 0:
            cumulative_debt += diff

    today_sleep = latest["asleep_hours"]
    daily_balance = today_sleep - target_hours  # 양수면 충족, 음수면 부족

    # 수면 부채 상태 등급 판정
    if cumulative_debt >= 8.0:
        debt_status = "🔴 위험 (피로 누적 심함)"
    elif cumulative_debt >= 4.0:
        debt_status = "🟡 주의 (만성 피로 주의)"
    else:
        debt_status = "🟢 양호 (충분한 회복 상태)"

    # 신체 컨디션 점수 산출
    time_score = min(40.0, (today_sleep / target_hours) * 40.0)
    eff_score = min(30.0, (latest["efficiency"] / 100.0) * 30.0)
    quality_ratio = (latest["deep_hours"] + latest["rem_hours"]) / max(1.0, today_sleep)
    quality_score = min(30.0, quality_ratio * 60.0)
    debt_penalty = min(20.0, cumulative_debt * 2.0)

    condition_score = int(max(40.0, min(100.0, time_score + eff_score + quality_score - debt_penalty)))

    def to_hm(hrs, show_sign=False):
        abs_h = abs(hrs)
        h = int(abs_h)
        m = int(round((abs_h - h) * 60))
        if show_sign:
            sign = "-" if hrs < 0 else "+" if hrs > 0 else ""
            return f"{sign}{h}시간 {m}분" if sign else f"{h}시간 {m}분"
        return f"{h}시간 {m}분"

    return {
        "today_sleep_hm": to_hm(today_sleep),
        "today_sleep_hours": round(today_sleep, 1),
        "daily_balance_hm": to_hm(daily_balance, show_sign=True),
        "target_sleep_hm": to_hm(target_hours),
        "avg_7d_sleep_hm": to_hm(avg_7d_sleep),
        "cumulative_debt_hm": to_hm(cumulative_debt),
        "cumulative_debt_hours": round(cumulative_debt, 1),
        "debt_status": debt_status,
        "deep_hm": to_hm(latest["deep_hours"]),
        "rem_hm": to_hm(latest["rem_hours"]),
        "light_hm": to_hm(latest["light_hours"]),
        "awake_hm": to_hm(latest["awake_hours"]),
        "sleep_efficiency": int(latest["efficiency"]),
        "condition_score": condition_score,
        "days_tracked": len(recent_14),
        "device_name": latest["device"],
        "is_real_data": True
    }

def generate_ai_briefing(metrics, gemini_key, model="models/gemini-3.6-flash", mode="morning"):
    """Gemini 3.6 Flash로 맞춤형 브리핑 문구 생성"""
    prompt = f"""
당신은 전용 AI 헬스 & 수면 코치입니다.
사용자의 {metrics['device_name']}에서 측정한 실제 수면 데이터를 바탕으로, 카카오톡 메시지에 최적화된 간결하면서도 핵심을 찌르는 {('아침 기상' if mode == 'morning' else '저녁 취침')} 브리핑을 작성해 주세요.

[측정 데이터 요약]
- 어젯밤 수면: {metrics['today_sleep_hm']} (기준 {metrics['target_sleep_hm']} 대비 {metrics['daily_balance_hm']})
- 수면 품질: 깊은 수면(근육/면역) {metrics['deep_hm']}, 렘 수면(뇌/기억) {metrics['rem_hm']}, 수면 효율 {metrics['sleep_efficiency']}%
- 현재 신체 컨디션 점수: {metrics['condition_score']}점 / 100점
- 최근 7일 일평균 수면: {metrics['avg_7d_sleep_hm']}
- 최근 14일 누적 수면 부채: {metrics['cumulative_debt_hm']} [{metrics['debt_status']}]

[작성 형식 및 가이드라인]
1. 제목: 간결한 이모지 제목
2. 💤 [수면 분석]
   - 총 수면: {metrics['today_sleep_hm']} (수면 효율 {metrics['sleep_efficiency']}%)
   - 단계: 깊은 수면 {metrics['deep_hm']} / 렘 수면 {metrics['rem_hm']}
3. 📉 [수면 부채 분석]
   - 어젯밤 밸런스: {metrics['daily_balance_hm']}
   - 7일 평균 수면: {metrics['avg_7d_sleep_hm']}
   - 14일 누적 부채: {metrics['cumulative_debt_hm']} ({metrics['debt_status']})
4. 🔋 [현재 몸 상태 & 실천 팁]
   - 현재 신체 컨디션 점수({metrics['condition_score']}점)와 누적 부채({metrics['cumulative_debt_hm']})를 바탕으로, 현재 몸 상태(근육 피로/뇌 피로)를 1줄로 요약.
   - 오늘 하루 에너지 관리 실천 팁(예: 오후 슬럼프 시간대 및 낮잠 여부, 밤 추천 취침 시각)을 2줄 내외로 제안.
5. 전체 길이는 모바일 카카오톡에서 한눈에 깔끔히 들어오도록 군더더기 없이 컴팩트하게 작성할 것.
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/{model}:generateContent?key={gemini_key}"
    req_body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}]
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=req_body, headers={"Content-Type": "application/json"})
        res = urllib.request.urlopen(req)
        data = json.loads(res.read().decode("utf-8"))
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        print(f"Gemini API 호출 실패: {e}")
        return (
            f"🌅 [굿모닝 수면 브리핑]\n\n"
            f"💤 수면 시간: {metrics['today_sleep_hours']}시간 (깊은수면 {metrics['today_deep_hours']}h, 렘 {metrics['today_rem_hours']}h)\n"
            f"🔋 신체 컨디션 점수: {metrics['condition_score']}점\n"
            f"📉 누적 수면 부채: {metrics['cumulative_debt_hours']}시간\n\n"
            f"💡 피로 회복을 위해 오늘 오후 15분 파워냅을 추천합니다!"
        )

def send_kakao_message(access_token, text):
    """카카오톡 '나에게 보내기' API로 메시지 전송"""
    url = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
    
    template = {
        "object_type": "text",
        "text": text,
        "link": {
            "web_url": "https://fitbit.com",
            "mobile_web_url": "https://fitbit.com"
        },
        "button_title": "핏빗 대시보드"
    }

    data = urllib.parse.urlencode({
        "template_object": json.dumps(template, ensure_ascii=False)
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/x-www-form-urlencoded"
    })

    try:
        res = urllib.request.urlopen(req)
        res_json = json.loads(res.read().decode("utf-8"))
        if res_json.get("result_code") == 0:
            print("[OK] 카카오톡 메시지가 성공적으로 전송되었습니다!")
            return True
        else:
            print(f"[실패] 카카오 응답: {res_json}")
            return False
    except urllib.error.HTTPError as e:
        print(f"카카오 API 호출 에러 ({e.code}): {e.read().decode('utf-8')}")
        return False
    except Exception as e:
        print(f"카카오 전송 중 에러 발생: {e}")
        return False

def run(mode="morning"):
    cfg = load_config()

    print("1. 구글 및 카카오 토큰 갱신 중...")
    google_token = refresh_google_token(cfg)
    kakao_token = refresh_kakao_token(cfg)

    print("2. Google Health API에서 핏빗 실제 수면 데이터 조회 중...")
    data_points = fetch_sleep_data(google_token)
    print(f"-> 총 {len(data_points)}개의 수면 데이터 수신 완료!")

    print("3. 수면 부채 및 컨디션 점수 계산 중...")
    target_hours = cfg.get("settings", {}).get("target_sleep_hours", 8.0)
    metrics = calculate_sleep_metrics(data_points, target_hours=target_hours)

    print("\n[분석 결과]")
    print(f"- 기기: {metrics['device_name']}")
    print(f"- 실 수면시간: {metrics['today_sleep_hm']} (깊은수면 {metrics['deep_hm']} / 렘 {metrics['rem_hm']})")
    print(f"- 수면 효율: {metrics['sleep_efficiency']}%")
    print(f"- 컨디션 점수: {metrics['condition_score']}점")
    print(f"- 최근 14일 누적 수면 부채: {metrics['cumulative_debt_hm']} ({metrics['debt_status']})")

    print("\n4. Gemini 3.6 Flash 맞춤 브리핑 생성 중...")
    gemini_key = cfg["gemini"]["api_key"]
    model = cfg["gemini"].get("model", "models/gemini-3.6-flash")
    briefing_text = generate_ai_briefing(metrics, gemini_key, model=model, mode=mode)
    print("\n--- [생성된 카톡 브리핑 내용] ---\n" + briefing_text + "\n--------------------------------\n")

    print("5. 카카오톡으로 브리핑 전송 중...")
    success = send_kakao_message(kakao_token, briefing_text)
    if success:
        print("🎉 축하합니다! 카카오톡으로 실시간 브리핑이 성공적으로 도착했습니다!")

if __name__ == "__main__":
    mode = "morning" if len(sys.argv) < 2 else sys.argv[1]
    run(mode=mode)
