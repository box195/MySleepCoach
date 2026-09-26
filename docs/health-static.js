/**
 * Static Google Health client for MySleepCoach.
 * Access tokens live only in this page's JavaScript memory.
 * No token, health record, or derived health data is persisted.
 */
(() => {
  "use strict";

  const HEALTH_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
  const SLEEP_SCOPE = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
  const ACTIVITY_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
  const KST_ZONE = "Asia/Seoul";

  function cfg() {
    return window.MY_SLEEP_COACH_CONFIG || {};
  }

  function assertReady() {
    const c = cfg();
    if (!window.google?.accounts?.oauth2) {
      throw new Error("Google Identity Services를 불러오지 못했습니다.");
    }
    if (!c.GOOGLE_CLIENT_ID || c.GOOGLE_CLIENT_ID.startsWith("YOUR_")) {
      throw new Error("docs/config.js에 Google OAuth Web Client ID를 설정하세요.");
    }
    return c;
  }

  function requestAccessToken() {
    const c = assertReady();
    const scopes = [SLEEP_SCOPE];
    if (c.FETCH_STEPS) scopes.push(ACTIVITY_SCOPE);
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: c.GOOGLE_CLIENT_ID,
        scope: scopes.join(" "),
        callback: response => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error));
          } else if (!response?.access_token) {
            reject(new Error("Google 액세스 토큰을 받지 못했습니다."));
          } else {
            resolve(response.access_token);
          }
        },
        error_callback: () => reject(new Error("Google 로그인 창을 완료하지 못했습니다."))
      });
      client.requestAccessToken();
    });
  }

  async function fetchAllDataPoints(accessToken, dataType) {
    const points = [];
    let pageToken = "";
    do {
      const url = new URL(`${HEALTH_BASE}/${encodeURIComponent(dataType)}/dataPoints`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        let message = `${dataType} 조회 실패 (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error?.message) message += `: ${body.error.message}`;
        } catch (_) {}
        throw new Error(message);
      }
      const body = await response.json();
      if (Array.isArray(body.dataPoints)) points.push(...body.dataPoints);
      pageToken = body.nextPageToken || "";
    } while (pageToken);
    return points;
  }

  const round = (v, d = 2) => {
    const f = 10 ** d;
    return Math.round((v + Number.EPSILON) * f) / f;
  };

  function toHm(hours, showSign = false) {
    const abs = Math.abs(hours);
    let h = Math.floor(abs);
    let m = Math.round((abs - h) * 60);
    if (m === 60) { h += 1; m = 0; }
    const sign = showSign ? (hours < 0 ? "-" : hours > 0 ? "+" : "") : "";
    return `${sign}${h}시간 ${m}분`;
  }

  function kstParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: KST_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    return Object.fromEntries(parts.map(p => [p.type, p.value]));
  }

  function formatKstDate(date) {
    const p = kstParts(date);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function formatKstTime(date) {
    const p = kstParts(date);
    return `${p.hour}:${p.minute}`;
  }

  function kstMinutes(date) {
    const p = kstParts(date);
    return Number(p.hour) * 60 + Number(p.minute);
  }

  function addHoursLabel(date, hours) {
    return formatKstTime(new Date(date.getTime() + hours * 3600000));
  }

  function strainGuide(conditionScore) {
    if (conditionScore >= 80) {
      return { targetMin: 14, targetMax: 17.5, target: "14.0 ~ 17.5",
        zone: "고강도 활동 적합 (Estimated)",
        rec: "수면 기반 회복 추정치가 높습니다. Strain은 실제 Whoop 값이 아니라 참고용 추정치입니다." };
    }
    if (conditionScore >= 65) {
      return { targetMin: 10, targetMax: 14, target: "10.0 ~ 14.0",
        zone: "중강도 활동 (Estimated)",
        rec: "수면 부채가 일부 남아 있습니다. Strain은 실제 센서 부하가 아닌 수면 기반 참고용 추정치입니다." };
    }
    return { targetMin: 6, targetMax: 9.5, target: "6.0 ~ 9.5",
      zone: "회복 우선 (Estimated)",
      rec: "수면 기반 회복 추정치가 낮습니다. Strain은 실제 센서 부하가 아닌 참고용 추정치입니다." };
  }

  function sumStepsForDate(stepPoints, dateString) {
    let total = 0;
    let found = false;
    for (const point of stepPoints || []) {
      const payload = point?.steps;
      if (!payload || typeof payload.steps !== "number") continue;
      const interval = payload.interval || {};
      const timeText = interval.startTime || interval.endTime;
      if (!timeText) continue;
      const when = new Date(timeText);
      if (Number.isNaN(when.getTime())) continue;
      if (formatKstDate(when) === dateString) {
        total += payload.steps;
        found = true;
      }
    }
    return found ? total : null;
  }

  function calculateMetrics(sleepPoints, stepPoints, targetHours = 8) {
    const sessions = [];

    for (const point of sleepPoints || []) {
      const sleep = point?.sleep || {};
      const interval = sleep.interval || {};
      if (!interval.startTime || !interval.endTime) continue;
      const start = new Date(interval.startTime);
      const end = new Date(interval.endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      const bedMinutes = Math.max(1, (end - start) / 60000);
      const stageDuration = {};
      const hypnogram = [];
      for (const stage of sleep.stages || []) {
        if (!stage.startTime || !stage.endTime) continue;
        const s = new Date(stage.startTime);
        const e = new Date(stage.endTime);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
        const type = stage.type || "UNKNOWN";
        const duration = Math.max(0.1, (e - s) / 60000);
        stageDuration[type] = (stageDuration[type] || 0) + duration;
        hypnogram.push({
          type,
          start_time: formatKstTime(s),
          end_time: formatKstTime(e),
          start_min_offset: round((s - start) / 60000, 1),
          dur_min: round(duration, 1)
        });
      }

      const awakeMinutes = stageDuration.AWAKE || 0;
      const asleepMinutes = Math.max(0, bedMinutes - awakeMinutes);
      const deepMinutes = stageDuration.DEEP || 0;
      const remMinutes = stageDuration.REM || 0;
      const lightMinutes = stageDuration.LIGHT || 0;
      const efficiencyFloat = round((asleepMinutes / bedMinutes) * 100, 1);
      const asleepHours = asleepMinutes / 60;
      const deepRatio = deepMinutes / Math.max(1, asleepMinutes);
      const remRatio = remMinutes / Math.max(1, asleepMinutes);
      const qualityFactor = 1 + 0.25 * deepRatio + 0.15 * remRatio - 0.2 * (awakeMinutes / bedMinutes);
      const effectiveSleepHours = Math.max(0, asleepHours * (efficiencyFloat / 100) * qualityFactor);

      sessions.push({
        start, end,
        date: formatKstDate(end),
        bed_time: formatKstTime(start),
        wake_time: formatKstTime(end),
        bed_hours: round(bedMinutes / 60),
        asleep_hours: round(asleepHours),
        asleep_hm: toHm(asleepHours),
        effective_sleep_hours: round(effectiveSleepHours),
        deep_hours: round(deepMinutes / 60),
        deep_hm: toHm(deepMinutes / 60),
        deep_pct: Math.round((deepMinutes / Math.max(1, asleepMinutes)) * 100),
        rem_hours: round(remMinutes / 60),
        rem_hm: toHm(remMinutes / 60),
        rem_pct: Math.round((remMinutes / Math.max(1, asleepMinutes)) * 100),
        light_hours: round(lightMinutes / 60),
        light_hm: toHm(lightMinutes / 60),
        light_pct: Math.round((lightMinutes / Math.max(1, asleepMinutes)) * 100),
        awake_hours: round(awakeMinutes / 60),
        awake_hm: toHm(awakeMinutes / 60),
        awake_pct: Math.round((awakeMinutes / Math.max(1, bedMinutes)) * 100),
        efficiency: Math.trunc(efficiencyFloat),
        device: point?.dataSource?.device?.displayName || "Google Health",
        hypnogram
      });
    }

    sessions.sort((a, b) => a.start - b.start);
    if (!sessions.length) throw new Error("Google Health에서 수면 기록을 찾지 못했습니다.");

    sessions.forEach((day, index) => {
      const window = sessions.slice(Math.max(0, index - 13), index + 1).reverse();
      let weightedDeficit = 0, weightSum = 0;
      window.forEach((pastDay, d) => {
        const deficit = Math.max(0, targetHours - pastDay.effective_sleep_hours);
        const weight = Math.exp(-0.15 * d);
        weightedDeficit += deficit * weight;
        weightSum += weight;
      });
      const expDebt = (weightedDeficit / Math.max(0.001, weightSum)) * (1 + Math.min(13, index) * 0.15);
      day.exponential_debt_hours = round(expDebt);
      day.exponential_debt_hm = toHm(day.exponential_debt_hours);
      day.daily_balance_hours = round(day.asleep_hours - targetHours);
      day.daily_balance_hm = toHm(day.daily_balance_hours, true);

      const timeScore = Math.min(40, (day.asleep_hours / targetHours) * 40);
      const efficiencyScore = Math.min(30, (day.efficiency / 100) * 30);
      const deepRemRatio = (day.deep_hours + day.rem_hours) / Math.max(1, day.asleep_hours);
      const qualityScore = Math.min(30, deepRemRatio * 65);
      const debtPenalty = Math.min(20, day.exponential_debt_hours * 2.2);
      day.condition_score = Math.trunc(Math.max(40, Math.min(100, timeScore + efficiencyScore + qualityScore - debtPenalty)));
    });

    const latest = sessions[sessions.length - 1];
    const debt = latest.exponential_debt_hours;
    let debtStatus = "최적 (낮은 수면 부채)", debtBadgeClass = "success";
    if (debt >= 6) { debtStatus = "고위험 (누적 수면 부채)"; debtBadgeClass = "danger"; }
    else if (debt >= 3) { debtStatus = "주의 (수면 부채 증가)"; debtBadgeClass = "warning"; }

    const circadianWindows = [
      { id: "inertia", name: "수면 관성 구간",
        time_range: `${formatKstTime(latest.end)} ~ ${addHoursLabel(latest.end, 1.5)}`,
        icon: "☀️", level: "low", status_text: "몸 깨우기",
        desc: "기상 직후에는 각성도가 천천히 올라오는 구간입니다." },
      { id: "peak_1", name: "오전 집중 피크",
        time_range: `${addHoursLabel(latest.end, 2.5)} ~ ${addHoursLabel(latest.end, 5.5)}`,
        icon: "⚡", level: "high", status_text: "집중도 상승",
        desc: "기상 후 첫 집중 업무를 배치하기 좋은 참고 구간입니다." },
      { id: "dip", name: "오후 각성 저하 구간",
        time_range: `${addHoursLabel(latest.end, 7)} ~ ${addHoursLabel(latest.end, 9)}`,
        icon: "🌤️", level: "dip", status_text: "졸림 주의",
        desc: `현재 수면 부채 추정치는 ${toHm(debt)}입니다.` },
      { id: "peak_2", name: "두 번째 활동 피크",
        time_range: `${addHoursLabel(latest.end, 11)} ~ ${addHoursLabel(latest.end, 13.5)}`,
        icon: "🏃", level: "medium-high", status_text: "활동 적합",
        desc: "저녁 전 활동이나 운동 시간을 잡을 때 참고할 수 있습니다." },
      { id: "wind_down", name: "취침 준비 구간",
        time_range: `${addHoursLabel(latest.end, 15)} ~ ${addHoursLabel(latest.end, 17)}`,
        icon: "🌙", level: "relax", status_text: "수면 준비",
        desc: "취침 전 밝은 빛과 강한 자극을 줄이는 시간으로 활용하세요." }
    ];

    const recent30 = sessions.slice(-30);
    const wakeMinutes = recent30.map(s => kstMinutes(s.end));
    const midpointMinutes = recent30.map(s => {
      const p = kstParts(s.start);
      const h = Number(p.hour);
      const bed = (h < 12 ? h : h - 24) * 60 + Number(p.minute);
      return (bed + kstMinutes(s.end)) / 2;
    });
    const meanWake = wakeMinutes.reduce((a, b) => a + b, 0) / wakeMinutes.length;
    const variance = wakeMinutes.reduce((sum, v) => sum + (v - meanWake) ** 2, 0) / wakeMinutes.length;
    const stdWake = Math.sqrt(variance);
    const consistencyScore = Math.trunc(Math.max(40, Math.min(100, 100 - stdWake * 0.7)));
    const consistencyLabel = consistencyScore >= 85 ? "매우 규칙적" : consistencyScore >= 70 ? "보통" : "불규칙";
    const avgMidpoint = midpointMinutes.reduce((a, b) => a + b, 0) / midpointMinutes.length;
    const chronotype = avgMidpoint <= 180
      ? { name: "아침형 경향", desc: "최근 수면 중간시각이 비교적 이른 편입니다." }
      : avgMidpoint <= 230
        ? { name: "중간형 경향", desc: "최근 수면 중간시각이 일반적인 범위에 가깝습니다." }
        : { name: "저녁형 경향", desc: "최근 수면 중간시각이 비교적 늦은 편입니다." };

    const history = sessions.map(session => {
      const guide = strainGuide(session.condition_score);
      const seed = [...session.date].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      const varianceOffset = ((seed % 10) - 4.5) * 0.4;
      const base = 10.5 + (session.condition_score - 60) * 0.12 + (session.asleep_hours - 7) * 0.4;
      const estimatedStrain = round(Math.min(20.5, Math.max(6, base + varianceOffset)), 1);
      const balanceState = estimatedStrain > guide.targetMax ? "추정 과부하 주의"
        : estimatedStrain < guide.targetMin ? "추정 활동 여유" : "추정 적정 범위";
      const balanceClass = estimatedStrain > guide.targetMax ? "danger"
        : estimatedStrain < guide.targetMin ? "info" : "success";
      return {
        date: session.date, bed_time: session.bed_time, wake_time: session.wake_time,
        asleep_hours: session.asleep_hours, asleep_hm: session.asleep_hm,
        bed_hours: session.bed_hours, effective_sleep_hours: session.effective_sleep_hours, deep_hours: session.deep_hours, deep_hm: session.deep_hm,
        deep_pct: session.deep_pct, rem_hours: session.rem_hours, rem_hm: session.rem_hm,
        rem_pct: session.rem_pct, light_hours: session.light_hours, light_hm: session.light_hm,
        light_pct: session.light_pct, awake_hours: session.awake_hours, awake_hm: session.awake_hm,
        efficiency: session.efficiency, exponential_debt_hours: session.exponential_debt_hours,
        exponential_debt_hm: session.exponential_debt_hm, daily_balance_hours: session.daily_balance_hours,
        daily_balance_hm: session.daily_balance_hm, condition_score: session.condition_score,
        day_strain: estimatedStrain, strain_target: guide.target, strain_zone: guide.zone,
        balance_state: balanceState, balance_class: balanceClass, strain_rec: guide.rec,
        device: session.device
      };
    });

    const latestHistory = history[history.length - 1];
    const latestGuide = strainGuide(latest.condition_score);
    const avg = list => list.reduce((sum, d) => sum + d.asleep_hours, 0) / list.length;
    const latestSteps = sumStepsForDate(stepPoints, latest.date);

    return {
      today: {
        date: latest.date, bed_time: latest.bed_time, wake_time: latest.wake_time,
        today_sleep_hm: toHm(latest.asleep_hours), today_sleep_hours: latest.asleep_hours,
        daily_balance_hm: latest.daily_balance_hm, target_sleep_hm: toHm(targetHours),
        target_sleep_hours: targetHours, avg_7d_sleep_hm: toHm(avg(sessions.slice(-7))),
        avg_14d_sleep_hm: toHm(avg(sessions.slice(-14))), avg_all_sleep_hm: toHm(avg(sessions)),
        total_recorded_days: sessions.length, exponential_debt_hm: toHm(debt),
        exponential_debt_hours: debt, debt_status: debtStatus, debt_badge_class: debtBadgeClass,
        condition_score: latest.condition_score, day_strain: latestHistory.day_strain,
        strain_target: latestHistory.strain_target, strain_zone: latestHistory.strain_zone,
        balance_state: latestHistory.balance_state, balance_class: latestHistory.balance_class,
        strain_rec: latestHistory.strain_rec, deep_hm: latest.deep_hm, deep_hours: latest.deep_hours,
        deep_pct: latest.deep_pct, rem_hm: latest.rem_hm, rem_hours: latest.rem_hours,
        rem_pct: latest.rem_pct, light_hm: latest.light_hm, light_hours: latest.light_hours,
        light_pct: latest.light_pct, awake_hm: latest.awake_hm, awake_hours: latest.awake_hours,
        awake_pct: latest.awake_pct, sleep_efficiency: latest.efficiency,
        device_name: latest.device, hypnogram: latest.hypnogram
      },
      circadian_windows: circadianWindows,
      chronotype,
      consistency: { score: consistencyScore, label: consistencyLabel, std_minutes: round(stdWake, 1) },
      all_history: history,
      activity: {
        steps: latestSteps, step_goal: 10000, calories: null, active_minutes: null,
        strain_score: latestHistory.day_strain, strain_target: latestGuide.target,
        strain_rec: latestGuide.rec
      },
      ai_briefing: null,
      static_mode: {
        gemini_available: false, kakao_available: false,
        note: "브라우저 정적 모드에서는 서버 비밀키가 필요한 Gemini AI 코칭과 카카오 알림을 사용하지 않습니다."
      }
    };
  }

  async function sync() {
    const c = assertReady();
    const accessToken = await requestAccessToken();
    const sleepPoints = await fetchAllDataPoints(accessToken, "sleep");
    const stepPoints = c.FETCH_STEPS ? await fetchAllDataPoints(accessToken, "steps") : [];
    return calculateMetrics(sleepPoints, stepPoints, Number(c.TARGET_SLEEP_HOURS) || 8);
  }

  window.MySleepCoachStatic = Object.freeze({
    sync,
    scopes: Object.freeze({ sleep: SLEEP_SCOPE, activity: ACTIVITY_SCOPE })
  });
})();
