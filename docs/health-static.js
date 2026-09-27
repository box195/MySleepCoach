/**
 * MySleepCoach browser-only Google Health client.
 *
 * Privacy:
 * - OAuth access tokens live in JavaScript memory only.
 * - Raw Google Health records are never persisted.
 * - The UI may persist only the derived dashboard snapshot on this device.
 */
(() => {
  "use strict";

  const HEALTH_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
  const SLEEP_SCOPE = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
  const ACTIVITY_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
  const HEALTH_METRICS_SCOPE = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
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
    const scopes = [SLEEP_SCOPE, HEALTH_METRICS_SCOPE];
    if (c.FETCH_STEPS) scopes.push(ACTIVITY_SCOPE);

    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: c.GOOGLE_CLIENT_ID,
        scope: scopes.join(" "),
        include_granted_scopes: true,
        callback: response => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error));
          } else if (!response?.access_token) {
            reject(new Error("Google 액세스 토큰을 받지 못했습니다."));
          } else {
            const granted = scope => google.accounts.oauth2.hasGrantedAllScopes(response, scope);
            if (!granted(SLEEP_SCOPE)) {
              reject(new Error("수면 데이터 읽기 권한이 필요합니다."));
              return;
            }
            resolve({
              accessToken: response.access_token,
              healthMetricsGranted: granted(HEALTH_METRICS_SCOPE),
              activityGranted: granted(ACTIVITY_SCOPE)
            });
          }
        },
        error_callback: () => reject(new Error("Google 계정 인증을 완료하지 못했습니다."))
      });

      // Do not force account selection or consent again. Google can still show UI
      // when its current session or the newly requested scopes require it.
      client.requestAccessToken({ prompt: "" });
    });
  }

  async function fetchPages(accessToken, dataType, reconcile) {
    const points = [];
    let pageToken = "";

    do {
      const method = reconcile ? "dataPoints:reconcile" : "dataPoints";
      const url = new URL(`${HEALTH_BASE}/${encodeURIComponent(dataType)}/${method}`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        },
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

  async function fetchAllDataPoints(accessToken, dataType, reconcile = true) {
    if (!reconcile) return fetchPages(accessToken, dataType, false);
    try {
      return await fetchPages(accessToken, dataType, true);
    } catch (reconcileError) {
      try {
        return await fetchPages(accessToken, dataType, false);
      } catch (listError) {
        throw new Error(`${dataType} 조회 실패: reconcile 및 일반 조회 모두 실패했습니다. ${listError.message}`);
      }
    }
  }

  const round = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function asNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toHm(hours, showSign = false) {
    if (!Number.isFinite(hours)) return "-";
    const abs = Math.abs(hours);
    let h = Math.floor(abs);
    let m = Math.round((abs - h) * 60);
    if (m === 60) {
      h += 1;
      m = 0;
    }
    const sign = showSign ? (hours < 0 ? "-" : hours > 0 ? "+" : "") : "";
    return `${sign}${h}시간 ${m}분`;
  }

  function kstParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: KST_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
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

  function dateFromGoogleDate(value) {
    const date = value?.date || value;
    const year = Number(date?.year);
    const month = Number(date?.month);
    const day = Number(date?.day);
    if (!year || !month || !day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function civilDate(interval, which, fallbackDate) {
    return dateFromGoogleDate(interval?.[which]?.date) || formatKstDate(fallbackDate);
  }

  function civilTime(interval, which, fallbackDate) {
    const time = interval?.[which]?.time;
    if (time && Number.isFinite(Number(time.hours))) {
      const h = String(Number(time.hours)).padStart(2, "0");
      const m = String(Number(time.minutes || 0)).padStart(2, "0");
      return `${h}:${m}`;
    }
    return formatKstTime(fallbackDate);
  }

  function normalizeStageType(value) {
    return String(value || "UNSPECIFIED")
      .replace(/^SLEEP_STAGE_TYPE_/, "")
      .replace(/^TYPE_/, "");
  }

  function stageMinutesFromSummary(summary) {
    const totals = {};
    for (const entry of summary?.stagesSummary || []) {
      const type = normalizeStageType(entry?.type);
      const minutes = asNumber(entry?.minutes);
      if (minutes !== null) totals[type] = (totals[type] || 0) + minutes;
    }
    return totals;
  }

  function parseSleepSessions(sleepPoints) {
    const parsed = [];

    for (const point of sleepPoints || []) {
      const sleep = point?.sleep || {};
      const interval = sleep.interval || {};
      if (!interval.startTime || !interval.endTime) continue;

      const start = new Date(interval.startTime);
      const end = new Date(interval.endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;

      const hypnogram = [];
      const stageTotalsFromSegments = {};
      for (const stage of sleep.stages || []) {
        if (!stage?.startTime || !stage?.endTime) continue;
        const s = new Date(stage.startTime);
        const e = new Date(stage.endTime);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) continue;

        const type = normalizeStageType(stage.type);
        const duration = (e - s) / 60000;
        stageTotalsFromSegments[type] = (stageTotalsFromSegments[type] || 0) + duration;
        hypnogram.push({
          type,
          start_time: formatKstTime(s),
          end_time: formatKstTime(e),
          start_min_offset: round((s - start) / 60000, 1),
          dur_min: round(duration, 1)
        });
      }

      const summary = sleep.summary || {};
      const summaryStageTotals = stageMinutesFromSummary(summary);
      const stageTotals = Object.keys(summaryStageTotals).length ? summaryStageTotals : stageTotalsFromSegments;
      const intervalMinutes = (end - start) / 60000;

      const minutesInSleepPeriod = asNumber(summary.minutesInSleepPeriod);
      const bedMinutes = minutesInSleepPeriod !== null && minutesInSleepPeriod > 0
        ? minutesInSleepPeriod
        : intervalMinutes;

      let asleepMinutes = asNumber(summary.minutesAsleep);
      if (asleepMinutes === null) {
        if (Object.keys(stageTotals).length) {
          if (sleep.type === "CLASSIC") {
            asleepMinutes = stageTotals.ASLEEP ?? null;
          } else {
            const staged = [stageTotals.LIGHT, stageTotals.REM, stageTotals.DEEP];
            asleepMinutes = staged.some(Number.isFinite)
              ? staged.reduce((sum, minutes) => sum + (minutes || 0), 0)
              : null;
          }
        }
      }

      let awakeMinutes = asNumber(summary.minutesAwake);
      if (awakeMinutes === null) {
        awakeMinutes = stageTotals.AWAKE || 0;
        if (sleep.type === "CLASSIC") awakeMinutes += stageTotals.RESTLESS || 0;
      }

      if (asleepMinutes === null) continue;
      asleepMinutes = clamp(asleepMinutes, 0, bedMinutes);
      const efficiency = bedMinutes > 0 ? Math.round((asleepMinutes / bedMinutes) * 100) : null;

      const deepMinutes = stageTotals.DEEP ?? null;
      const remMinutes = stageTotals.REM ?? null;
      const lightMinutes = stageTotals.LIGHT ?? null;
      const stagePct = minutes => Number.isFinite(minutes) && asleepMinutes > 0
        ? Math.round((minutes / asleepMinutes) * 100)
        : null;

      const date = civilDate(interval, "civilEndTime", end);
      parsed.push({
        id: point?.name || `${interval.startTime}|${interval.endTime}`,
        start,
        end,
        date,
        bed_time: civilTime(interval, "civilStartTime", start),
        wake_time: civilTime(interval, "civilEndTime", end),
        bed_minutes: round(bedMinutes, 1),
        bed_hours: round(bedMinutes / 60),
        asleep_minutes: round(asleepMinutes, 1),
        asleep_hours: round(asleepMinutes / 60),
        asleep_hm: toHm(asleepMinutes / 60),
        deep_hours: Number.isFinite(deepMinutes) ? round(deepMinutes / 60) : null,
        deep_hm: Number.isFinite(deepMinutes) ? toHm(deepMinutes / 60) : "-",
        deep_pct: stagePct(deepMinutes),
        rem_hours: Number.isFinite(remMinutes) ? round(remMinutes / 60) : null,
        rem_hm: Number.isFinite(remMinutes) ? toHm(remMinutes / 60) : "-",
        rem_pct: stagePct(remMinutes),
        light_hours: Number.isFinite(lightMinutes) ? round(lightMinutes / 60) : null,
        light_hm: Number.isFinite(lightMinutes) ? toHm(lightMinutes / 60) : "-",
        light_pct: stagePct(lightMinutes),
        awake_hours: round((awakeMinutes || 0) / 60),
        awake_hm: toHm((awakeMinutes || 0) / 60),
        awake_pct: bedMinutes > 0 ? Math.round(((awakeMinutes || 0) / bedMinutes) * 100) : null,
        efficiency,
        minutes_to_fall_asleep: asNumber(summary.minutesToFallAsleep),
        minutes_after_wakeup: asNumber(summary.minutesAfterWakeUp),
        is_nap: Boolean(sleep?.metadata?.nap),
        processing_complete: sleep?.metadata?.processed !== false,
        device: point?.dataSource?.device?.displayName || "Google Health",
        sleep_type: sleep.type || null,
        hypnogram
      });
    }

    // Reconcile resolves overlap across sources. A local day can still legitimately contain
    // a main sleep and naps; the dashboard uses one primary (longest non-nap) session per day.
    const perDay = new Map();
    for (const session of parsed) {
      const current = perDay.get(session.date);
      if (!current) {
        perDay.set(session.date, session);
        continue;
      }
      const currentPreferred = !current.is_nap;
      const candidatePreferred = !session.is_nap;
      if (
        (candidatePreferred && !currentPreferred) ||
        (candidatePreferred === currentPreferred && session.asleep_minutes > current.asleep_minutes)
      ) {
        perDay.set(session.date, session);
      }
    }

    return [...perDay.values()].sort((a, b) => a.start - b.start);
  }

  function dailyMetricMap(points, payloadKey, valueKey) {
    const map = new Map();
    for (const point of points || []) {
      const payload = point?.[payloadKey];
      if (!payload) continue;
      const date = dateFromGoogleDate(payload.date);
      const value = asNumber(payload[valueKey]);
      if (date && value !== null) map.set(date, value);
    }
    return map;
  }

  function sumStepsForDate(stepPoints, dateString) {
    let total = 0;
    let found = false;
    for (const point of stepPoints || []) {
      const payload = point?.steps;
      if (!payload) continue;
      const count = asNumber(payload.count ?? payload.steps);
      if (count === null) continue;
      const interval = payload.interval || {};
      const timeText = interval.startTime || interval.endTime;
      if (!timeText) continue;
      const when = new Date(timeText);
      if (Number.isNaN(when.getTime())) continue;
      if (formatKstDate(when) === dateString) {
        total += count;
        found = true;
      }
    }
    return found ? Math.round(total) : null;
  }

  function sleepScoreEstimate(day, targetHours) {
    const durationScore = clamp((day.asleep_hours / Math.max(0.1, targetHours)) * 100, 0, 100);
    if (!Number.isFinite(day.efficiency)) return Math.round(durationScore);
    return Math.round(durationScore * 0.65 + clamp(day.efficiency, 0, 100) * 0.35);
  }

  function baseline(values) {
    const valid = values.filter(Number.isFinite);
    if (valid.length < 3) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function readinessEstimate(day, priorDays) {
    const components = [
      { name: "sleep", weight: 0.60, score: day.sleep_score_estimate }
    ];

    const hrvBase = baseline(priorDays.slice(-14).map(d => d.hrv_ms));
    if (Number.isFinite(day.hrv_ms) && Number.isFinite(hrvBase) && hrvBase > 0) {
      const hrvScore = clamp(80 + ((day.hrv_ms / hrvBase) - 1) * 100, 40, 100);
      components.push({ name: "hrv", weight: 0.25, score: hrvScore });
      day.hrv_baseline_ms = round(hrvBase, 1);
    } else {
      day.hrv_baseline_ms = null;
    }

    const rhrBase = baseline(priorDays.slice(-14).map(d => d.resting_hr_bpm));
    if (Number.isFinite(day.resting_hr_bpm) && Number.isFinite(rhrBase) && rhrBase > 0) {
      const rhrScore = clamp(80 + ((rhrBase / day.resting_hr_bpm) - 1) * 100, 40, 100);
      components.push({ name: "rhr", weight: 0.15, score: rhrScore });
      day.resting_hr_baseline_bpm = round(rhrBase, 1);
    } else {
      day.resting_hr_baseline_bpm = null;
    }

    if (components.length === 1) {
      return { score: null, sourceLabel: "HRV·안정시 심박수 기준선 부족" };
    }

    const weightSum = components.reduce((sum, item) => sum + item.weight, 0);
    const score = Math.round(
      components.reduce((sum, item) => sum + item.score * item.weight, 0) / weightSum
    );
    const names = components.map(item => item.name);
    const sourceLabel =
      names.includes("hrv") && names.includes("rhr") ? "수면 + HRV + 안정시 심박수" :
      names.includes("hrv") ? "수면 + HRV" :
      names.includes("rhr") ? "수면 + 안정시 심박수" :
      "수면만 (HRV/RHR 기준선 부족)";

    return { score, sourceLabel };
  }

  function calculateMetrics(
    sleepPoints,
    stepPoints = [],
    hrvPoints = [],
    restingHrPoints = [],
    targetHours = 8
  ) {
    const sessions = parseSleepSessions(sleepPoints);
    if (!sessions.length) {
      throw new Error("Google Health에서 수면 기록을 찾지 못했습니다.");
    }

    const hrvMap = dailyMetricMap(
      hrvPoints,
      "dailyHeartRateVariability",
      "averageHeartRateVariabilityMilliseconds"
    );
    const restingHrMap = dailyMetricMap(
      restingHrPoints,
      "dailyRestingHeartRate",
      "beatsPerMinute"
    );

    sessions.forEach((day, index) => {
      day.hrv_ms = hrvMap.get(day.date) ?? null;
      day.resting_hr_bpm = restingHrMap.get(day.date) ?? null;
      day.sleep_score_estimate = sleepScoreEstimate(day, targetHours);

      const window = sessions.slice(Math.max(0, index - 13), index + 1).reverse();
      let weightedDeficit = 0;
      let weightSum = 0;
      window.forEach((pastDay, d) => {
        const deficit = Math.max(0, targetHours - pastDay.asleep_hours);
        const weight = Math.exp(-0.15 * d);
        weightedDeficit += deficit * weight;
        weightSum += weight;
      });
      day.exponential_debt_hours = round(weightedDeficit / Math.max(0.001, weightSum));
      day.exponential_debt_hm = toHm(day.exponential_debt_hours);
      day.daily_balance_hours = round(day.asleep_hours - targetHours);
      day.daily_balance_hm = toHm(day.daily_balance_hours, true);

      const readiness = readinessEstimate(day, sessions.slice(0, index));
      day.condition_score = readiness.score;
      day.readiness_source = readiness.sourceLabel;
    });

    const latest = sessions[sessions.length - 1];
    const debt = latest.exponential_debt_hours;
    let debtStatus = "낮음 (추정 수면 부족)";
    let debtBadgeClass = "success";
    if (debt >= 2) {
      debtStatus = "높음 (추정 수면 부족)";
      debtBadgeClass = "danger";
    } else if (debt >= 1) {
      debtStatus = "주의 (추정 수면 부족)";
      debtBadgeClass = "warning";
    }

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
    const consistencyScore = Math.trunc(clamp(100 - stdWake * 0.7, 40, 100));
    const consistencyLabel = consistencyScore >= 85 ? "매우 규칙적" : consistencyScore >= 70 ? "보통" : "불규칙";

    const avgMidpoint = midpointMinutes.reduce((a, b) => a + b, 0) / midpointMinutes.length;
    const chronotype = avgMidpoint <= 180
      ? { name: "아침형 경향", desc: "최근 수면 중간시간이 비교적 이른 편입니다." }
      : avgMidpoint <= 230
        ? { name: "중간형 경향", desc: "최근 수면 중간시간이 중간 범위입니다." }
        : { name: "저녁형 경향", desc: "최근 수면 중간시간이 비교적 늦은 편입니다." };

    const circadianWindows = [
      {
        id: "inertia",
        name: "기상 직후 적응",
        time_range: `${formatKstTime(latest.end)} ~ ${addHoursLabel(latest.end, 1.5)}`,
        icon: "🌌",
        level: "low",
        status_text: "저강도 구간",
        desc: "기상 직후에는 각성도가 천천히 올라갈 수 있습니다."
      },
      {
        id: "peak_1",
        name: "오전 집중 구간",
        time_range: `${addHoursLabel(latest.end, 2.5)} ~ ${addHoursLabel(latest.end, 5.5)}`,
        icon: "☀️",
        level: "high",
        status_text: "활동 구간",
        desc: "기상 후 첫 집중 작업을 배치하기 좋은 참고 구간입니다."
      },
      {
        id: "dip",
        name: "오후 저하 가능 구간",
        time_range: `${addHoursLabel(latest.end, 7)} ~ ${addHoursLabel(latest.end, 9)}`,
        icon: "🌌",
        level: "dip",
        status_text: "주의 구간",
        desc: `최근 추정 수면 부족은 ${toHm(debt)}입니다.`
      },
      {
        id: "peak_2",
        name: "저녁 활동 구간",
        time_range: `${addHoursLabel(latest.end, 11)} ~ ${addHoursLabel(latest.end, 13.5)}`,
        icon: "🌌",
        level: "medium-high",
        status_text: "활동 구간",
        desc: "개인차가 큰 참고용 시간 구간입니다."
      },
      {
        id: "wind_down",
        name: "취침 준비 구간",
        time_range: `${addHoursLabel(latest.end, 15)} ~ ${addHoursLabel(latest.end, 17)}`,
        icon: "🌙",
        level: "relax",
        status_text: "휴식 준비",
        desc: "취침 전에는 밝은 빛과 과도한 자극을 줄이는 데 활용할 수 있습니다."
      }
    ];

    const history = sessions.map(session => ({
      date: session.date,
      bed_time: session.bed_time,
      wake_time: session.wake_time,
      asleep_hours: session.asleep_hours,
      asleep_hm: session.asleep_hm,
      bed_hours: session.bed_hours,
      deep_hours: session.deep_hours,
      deep_hm: session.deep_hm,
      deep_pct: session.deep_pct,
      rem_hours: session.rem_hours,
      rem_hm: session.rem_hm,
      rem_pct: session.rem_pct,
      light_hours: session.light_hours,
      light_hm: session.light_hm,
      light_pct: session.light_pct,
      awake_hours: session.awake_hours,
      awake_hm: session.awake_hm,
      awake_pct: session.awake_pct,
      efficiency: session.efficiency,
      exponential_debt_hours: session.exponential_debt_hours,
      exponential_debt_hm: session.exponential_debt_hm,
      daily_balance_hours: session.daily_balance_hours,
      daily_balance_hm: session.daily_balance_hm,
      condition_score: session.condition_score,
      sleep_score_estimate: session.sleep_score_estimate,
      readiness_source: session.readiness_source,
      hrv_ms: session.hrv_ms,
      hrv_baseline_ms: session.hrv_baseline_ms,
      resting_hr_bpm: session.resting_hr_bpm,
      resting_hr_baseline_bpm: session.resting_hr_baseline_bpm,
      device: session.device
    }));

    const avgSleep = list => list.reduce((sum, d) => sum + d.asleep_hours, 0) / list.length;
    const latestSteps = sumStepsForDate(stepPoints, latest.date);

    return {
      today: {
        date: latest.date,
        bed_time: latest.bed_time,
        wake_time: latest.wake_time,
        today_sleep_hm: toHm(latest.asleep_hours),
        today_sleep_hours: latest.asleep_hours,
        daily_balance_hm: latest.daily_balance_hm,
        target_sleep_hm: toHm(targetHours),
        target_sleep_hours: targetHours,
        avg_7d_sleep_hm: toHm(avgSleep(sessions.slice(-7))),
        avg_14d_sleep_hm: toHm(avgSleep(sessions.slice(-14))),
        avg_all_sleep_hm: toHm(avgSleep(sessions)),
        total_recorded_days: sessions.length,
        exponential_debt_hm: toHm(debt),
        exponential_debt_hours: debt,
        debt_status: debtStatus,
        debt_badge_class: debtBadgeClass,
        condition_score: latest.condition_score,
        sleep_score_estimate: latest.sleep_score_estimate,
        readiness_source: latest.readiness_source,
        hrv_ms: latest.hrv_ms,
        hrv_baseline_ms: latest.hrv_baseline_ms,
        resting_hr_bpm: latest.resting_hr_bpm,
        resting_hr_baseline_bpm: latest.resting_hr_baseline_bpm,
        deep_hm: latest.deep_hm,
        deep_hours: latest.deep_hours,
        deep_pct: latest.deep_pct,
        rem_hm: latest.rem_hm,
        rem_hours: latest.rem_hours,
        rem_pct: latest.rem_pct,
        light_hm: latest.light_hm,
        light_hours: latest.light_hours,
        light_pct: latest.light_pct,
        awake_hm: latest.awake_hm,
        awake_hours: latest.awake_hours,
        awake_pct: latest.awake_pct,
        sleep_efficiency: latest.efficiency,
        device_name: latest.device,
        hypnogram: latest.hypnogram,
        metric_notice: "수면·컨디션 점수는 Google/Fitbit 공식 점수가 아니라 MySleepCoach의 투명한 추정치입니다."
      },
      circadian_windows: circadianWindows,
      chronotype,
      consistency: {
        score: consistencyScore,
        label: consistencyLabel,
        std_minutes: round(stdWake, 1)
      },
      all_history: history,
      activity: {
        steps: latestSteps,
        step_goal: 10000,
        calories: null,
        active_minutes: null
      },
      metric_methodology: {
        sleep_score: "추정치: 수면시간 목표 달성도 65% + Google Health summary 기반 수면효율 35%.",
        readiness_score: "추정치: 수면 점수 60%, 개인 14일 기준선 대비 HRV 25%, 안정시 심박수 15%. 사용 가능한 항목만 재가중합니다.",
        sleep_debt: "추정치: 최근 최대 14일의 목표 수면 대비 부족분을 지수 가중 평균합니다.",
        native_scores_available: false,
        raw_records_persisted: false
      },
      ai_briefing: null,
      static_mode: {
        gemini_available: false,
        kakao_available: false,
        note: "브라우저 직접 동기화 모드입니다. 액세스 토큰과 원본 건강 기록은 저장하지 않습니다."
      }
    };
  }

  async function sync() {
    const c = assertReady();
    const authorization = await requestAccessToken();
    const accessToken = authorization.accessToken;

    const sleepPoints = await fetchAllDataPoints(accessToken, "sleep", true);
    const optional = await Promise.allSettled([
      authorization.healthMetricsGranted
        ? fetchAllDataPoints(accessToken, "daily-heart-rate-variability", true)
        : Promise.resolve([]),
      authorization.healthMetricsGranted
        ? fetchAllDataPoints(accessToken, "daily-resting-heart-rate", true)
        : Promise.resolve([]),
      c.FETCH_STEPS && authorization.activityGranted
        ? fetchAllDataPoints(accessToken, "steps", true)
        : Promise.resolve([])
    ]);
    const [hrvResult, restingHrResult, stepsResult] = optional;
    const pointsOrEmpty = result => result.status === "fulfilled" ? result.value : [];

    const data = calculateMetrics(
      sleepPoints,
      pointsOrEmpty(stepsResult),
      pointsOrEmpty(hrvResult),
      pointsOrEmpty(restingHrResult),
      Number(c.TARGET_SLEEP_HOURS) || 8
    );
    if (!authorization.healthMetricsGranted) {
      data.metric_methodology.health_metrics_warning = "HRV·안정시 심박수 권한이 허용되지 않았습니다.";
    } else if (hrvResult.status === "rejected" || restingHrResult.status === "rejected") {
      data.metric_methodology.health_metrics_warning = "HRV 또는 안정시 심박수 조회에 실패했습니다. 수면 기록은 동기화됐습니다.";
    }
    return data;
  }

  window.MySleepCoachStatic = Object.freeze({
    sync,
    scopes: Object.freeze({
      sleep: SLEEP_SCOPE,
      activity: ACTIVITY_SCOPE,
      health_metrics: HEALTH_METRICS_SCOPE
    }),
    __test: Object.freeze({
      calculateMetrics,
      parseSleepSessions,
      sleepScoreEstimate,
      fetchAllDataPoints
    })
  });
})();
