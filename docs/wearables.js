/**
 * MySleepCoach Google Health wearable data extension.
 *
 * This layer keeps OAuth tokens and raw Google Health records in memory only.
 * Only bounded, derived daily summaries are returned to the dashboard/cache.
 */
(() => {
  "use strict";

  const base = window.MySleepCoachStatic;
  if (!base) throw new Error("MySleepCoachStatic must load before wearables.js");

  const HEALTH_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
  const SCOPES = Object.freeze({
    sleep: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    health: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    activity: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly"
  });
  const MAX_SYNC_DAYS = 90;
  const DEFAULT_SYNC_DAYS = 30;
  const MAX_PAGES = 60;
  const ALL_SOURCES = "users/me/dataSourceFamilies/all-sources";

  const SPECS = Object.freeze([
    { type: "sleep", label: "수면", category: "sleep", scope: "sleep", method: "reconcile", record: "sleep", pageSize: 25 },
    { type: "daily-heart-rate-variability", label: "일일 HRV", category: "vitals", scope: "health", method: "reconcile", record: "daily", payload: "dailyHeartRateVariability" },
    { type: "heart-rate-variability", label: "HRV 샘플", category: "vitals", scope: "health", method: "reconcile", record: "sample", payload: "heartRateVariability" },
    { type: "daily-resting-heart-rate", label: "안정시 심박수", category: "vitals", scope: "health", method: "reconcile", record: "daily", payload: "dailyRestingHeartRate" },
    { type: "daily-heart-rate-zones", label: "심박 구간 기준", category: "vitals", scope: "health", method: "reconcile", record: "daily", payload: "dailyHeartRateZones" },
    { type: "heart-rate", label: "심박수", category: "vitals", scope: "health", method: "dailyRollUp", record: "rollup", maxDays: 14 },
    { type: "daily-respiratory-rate", label: "일일 호흡수", category: "vitals", scope: "health", method: "reconcile", record: "daily", payload: "dailyRespiratoryRate" },
    { type: "respiratory-rate-sleep-summary", label: "수면 호흡수", category: "vitals", scope: "health", method: "reconcile", record: "sample", payload: "respiratoryRateSleepSummary" },
    { type: "daily-oxygen-saturation", label: "일일 SpO₂", category: "vitals", scope: "health", method: "reconcile", record: "daily", payload: "dailyOxygenSaturation" },
    { type: "oxygen-saturation", label: "SpO₂ 샘플", category: "vitals", scope: "health", method: "reconcile", record: "sample", payload: "oxygenSaturation" },
    { type: "daily-sleep-temperature-derivations", label: "수면 온도", category: "vitals", scope: "health", method: "reconcile", record: "daily", payload: "dailySleepTemperatureDerivations" },
    { type: "core-body-temperature", label: "심부 체온", category: "vitals", scope: "health", method: "reconcile", record: "sample", payload: "coreBodyTemperature" },

    { type: "steps", label: "걸음 수", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup" },
    { type: "floors", label: "오른 층수", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup" },
    { type: "altitude", label: "고도 상승", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup" },
    { type: "active-zone-minutes", label: "심박 활동구간", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", payload: "activeZoneMinutes" },
    { type: "time-in-heart-rate-zone", label: "심박 구간별 시간", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", payload: "timeInHeartRateZone" },
    { type: "calories-in-heart-rate-zone", label: "심박 구간별 에너지", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", payload: "caloriesInHeartRateZone", maxDays: 14 },
    { type: "sedentary-period", label: "앉아 있는 시간", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", payload: "sedentaryPeriod" },
    { type: "swim-lengths-data", label: "수영 스트로크", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", payload: "swimLengthsData" },
    { type: "exercise", label: "운동 세션", category: "activity", scope: "activity", method: "reconcile", record: "exercise", pageSize: 25 },
    { type: "active-energy-burned", label: "활동 에너지", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup" },
    { type: "total-calories", label: "총 에너지", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", maxDays: 14 },
    { type: "active-minutes", label: "활동 시간", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup", maxDays: 14 },
    { type: "distance", label: "이동 거리", category: "activity", scope: "activity", method: "dailyRollUp", record: "rollup" },
    { type: "daily-vo2-max", label: "일일 심폐체력", category: "activity", scope: "activity", method: "reconcile", record: "daily", payload: "dailyVo2Max" },
    { type: "vo2-max", label: "최대산소섭취량", category: "activity", scope: "activity", method: "reconcile", record: "sample", payload: "vo2Max" },
    { type: "run-vo2-max", label: "달리기 심폐체력", category: "activity", scope: "activity", method: "reconcile", record: "sample", payload: "runVo2Max" },

    { type: "weight", label: "체중", category: "body", scope: "health", method: "reconcile", record: "sample", payload: "weight" },
    { type: "body-fat", label: "체지방률", category: "body", scope: "health", method: "reconcile", record: "sample", payload: "bodyFat" },
    { type: "height", label: "키", category: "body", scope: "health", method: "reconcile", record: "sample", payload: "height" }
  ]);

  const asNumber = value => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const round = (value, digits = 1) => {
    if (!Number.isFinite(value)) return null;
    const f = 10 ** digits;
    return Math.round((value + Number.EPSILON) * f) / f;
  };
  const pad = value => String(value).padStart(2, "0");

  function cfg() {
    return window.MY_SLEEP_COACH_CONFIG || {};
  }

  function dateStringUTC(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function addDays(dateString, delta) {
    const d = new Date(`${dateString}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return dateStringUTC(d);
  }

  function currentCivilDate() {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date());
      const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
      return `${obj.year}-${obj.month}-${obj.day}`;
    } catch (_) {
      return dateStringUTC(new Date());
    }
  }

  function boundedDays(value) {
    const parsed = Number(value);
    return Math.max(1, Math.min(MAX_SYNC_DAYS, Number.isFinite(parsed) ? Math.round(parsed) : DEFAULT_SYNC_DAYS));
  }

  function makeRange(days, today = currentCivilDate()) {
    const bounded = boundedDays(days);
    const endDate = addDays(today, 1);
    const startDate = addDays(endDate, -bounded);
    return {
      days: bounded,
      startDate,
      endDate,
      startPhysical: `${startDate}T00:00:00+09:00`,
      endPhysical: `${endDate}T00:00:00+09:00`
    };
  }

  function googleDate(value) {
    const d = value?.date || value;
    if (!d || !d.year || !d.month || !d.day) return null;
    return `${String(d.year).padStart(4, "0")}-${pad(d.month)}-${pad(d.day)}`;
  }

  function civilDateTimeDate(value) {
    return googleDate(value?.date || value);
  }

  function samplePhysicalTime(payload) {
    return payload?.sampleTime?.physicalTime || null;
  }

  function sampleDate(payload) {
    const civil = googleDate(payload?.sampleTime?.civilTime);
    if (civil) return civil;
    const physical = samplePhysicalTime(payload);
    if (!physical) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date(physical));
      const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${date.year}-${date.month}-${date.day}`;
    } catch (_) {
      return dateFromTime(physical);
    }
  }

  function dateFromTime(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
    return null;
  }

  function sourceLabel(point) {
    const source = point?.dataSource || {};
    const device = source?.device?.displayName;
    const platform = source?.platform;
    const method = source?.recordingMethod;
    return [device, platform, method].filter(Boolean).join(" · ") || "Google Health 통합값 (기기 미표시)";
  }

  function snake(type) {
    return type.replaceAll("-", "_");
  }

  function filterFor(spec, range) {
    const key = snake(spec.type);
    if (spec.record === "daily") {
      return `${key}.date >= "${range.startDate}" AND ${key}.date < "${range.endDate}"`;
    }
    if (spec.record === "sleep") {
      return `sleep.interval.civil_end_time >= "${range.startDate}" AND sleep.interval.civil_end_time < "${range.endDate}"`;
    }
    if (spec.record === "exercise") {
      return `exercise.interval.civil_start_time >= "${range.startDate}" AND exercise.interval.civil_start_time < "${range.endDate}"`;
    }
    if (spec.record === "sample") {
      return `${key}.sample_time.physical_time >= "${range.startPhysical}" AND ${key}.sample_time.physical_time < "${range.endPhysical}"`;
    }
    return null;
  }

  function civilDateObject(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return { date: { year, month, day } };
  }

  class HealthFetchError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = "HealthFetchError";
      this.status = status;
      this.body = body || null;
    }
  }

  async function readErrorBody(response) {
    try { return await response.json(); } catch (_) { return null; }
  }

  async function fetchListPages(accessToken, spec, range, reconcile = true) {
    const items = [];
    let pageToken = "";
    let pageCount = 0;
    let truncated = false;
    const method = reconcile ? "dataPoints:reconcile" : "dataPoints";
    do {
      const url = new URL(`${HEALTH_BASE}/${encodeURIComponent(spec.type)}/${method}`);
      const filter = filterFor(spec, range);
      if (filter) url.searchParams.set("filter", filter);
      url.searchParams.set("pageSize", String(spec.pageSize || (["sleep", "exercise"].includes(spec.type) ? 25 : 10000)));
      if (reconcile) url.searchParams.set("dataSourceFamily", ALL_SOURCES);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new HealthFetchError(body?.error?.message || `${spec.type} 조회 실패`, response.status, body);
      }
      const body = await response.json();
      if (Array.isArray(body.dataPoints)) items.push(...body.dataPoints);
      pageToken = body.nextPageToken || "";
      pageCount += 1;
      if (pageToken && pageCount >= MAX_PAGES) {
        truncated = true;
        break;
      }
    } while (pageToken);
    return { items, pageCount, truncated };
  }

  async function fetchListWithFallback(accessToken, spec, range) {
    if (spec.method !== "reconcile") return fetchListPages(accessToken, spec, range, false);
    try {
      return await fetchListPages(accessToken, spec, range, true);
    } catch (reconcileError) {
      try {
        return await fetchListPages(accessToken, spec, range, false);
      } catch (listError) {
        throw listError;
      }
    }
  }

  async function fetchDailyRollup(accessToken, spec, range) {
    const days = Math.min(range.days, spec.maxDays || 90);
    const limitedStart = addDays(range.endDate, -days);
    const rollRange = { ...range, days, startDate: limitedStart };
    const items = [];
    let pageToken = "";
    let pageCount = 0;
    let truncated = false;
    do {
      const url = `${HEALTH_BASE}/${encodeURIComponent(spec.type)}/dataPoints:dailyRollUp`;
      const body = {
        range: { start: civilDateObject(limitedStart), end: civilDateObject(range.endDate) },
        windowSizeDays: 1,
        // Google validates windowSizeDays * pageSize against the type's maximum
        // query duration (14 or 90 days), even when the requested range is short.
        pageSize: days,
        dataSourceFamily: ALL_SOURCES
      };
      if (pageToken) body.pageToken = pageToken;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        cache: "no-store"
      });
      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw new HealthFetchError(errorBody?.error?.message || `${spec.type} 일일 집계 실패`, response.status, errorBody);
      }
      const responseBody = await response.json();
      if (Array.isArray(responseBody.rollupDataPoints)) items.push(...responseBody.rollupDataPoints);
      pageToken = responseBody.nextPageToken || "";
      pageCount += 1;
      if (pageToken && pageCount >= MAX_PAGES) {
        truncated = true;
        break;
      }
    } while (pageToken);
    return { items, pageCount, truncated, range: rollRange };
  }

  function classifyError(error) {
    const status = error?.status;
    const text = `${error?.message || ""} ${JSON.stringify(error?.body || {})}`.toLowerCase();
    if (status === 401 || status === 403) return "permission";
    if (status === 404 || (status === 400 && /(unsupported|not supported|unknown data type)/.test(text))) return "unsupported";
    return "error";
  }

  async function requestWearableToken() {
    const c = cfg();
    if (!window.google?.accounts?.oauth2) throw new Error("Google Identity Services를 불러오지 못했습니다.");
    if (!c.GOOGLE_CLIENT_ID || c.GOOGLE_CLIENT_ID.startsWith("YOUR_")) {
      throw new Error("docs/config.js에 Google OAuth Web Client ID를 설정하세요.");
    }
    const requested = Object.values(SCOPES);
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: c.GOOGLE_CLIENT_ID,
        scope: requested.join(" "),
        include_granted_scopes: true,
        callback: response => {
          if (response?.error) return reject(new Error(response.error_description || response.error));
          if (!response?.access_token) return reject(new Error("Google 액세스 토큰을 받지 못했습니다."));
          const granted = scope => google.accounts.oauth2.hasGrantedAllScopes(response, scope);
          resolve({
            accessToken: response.access_token,
            grants: {
              sleep: granted(SCOPES.sleep),
              health: granted(SCOPES.health),
              activity: granted(SCOPES.activity)
            }
          });
        },
        error_callback: () => reject(new Error("Google 계정 인증을 완료하지 못했습니다."))
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  function aggregateByDate(points, payloadKey, valueFn) {
    const groups = new Map();
    for (const point of points || []) {
      const payload = point?.[payloadKey];
      if (!payload) continue;
      const date = googleDate(payload.date) || sampleDate(payload);
      const value = valueFn(payload, point);
      if (!date || value === null || value === undefined) continue;
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push({ value, source: sourceLabel(point) });
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, values }));
  }

  function averageNumbers(values) {
    const nums = values.map(v => asNumber(v)).filter(Number.isFinite);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  function dailyRows(spec, points) {
    const payload = spec.payload;
    const rows = [];
    for (const point of points || []) {
      const p = point?.[payload];
      if (!p) continue;
      const date = googleDate(p.date) || sampleDate(p);
      if (!date) continue;
      let value = null, display = "-", detail = "";
      switch (spec.type) {
        case "daily-heart-rate-variability":
          value = asNumber(p.averageHeartRateVariabilityMilliseconds);
          display = value === null ? "-" : `${round(value, 1)} ms (평균)`;
          detail = [
            asNumber(p.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds) === null ? null
              : `깊은 잠 RMSSD ${round(Number(p.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds), 1)} ms`,
            asNumber(p.nonRemHeartRateBeatsPerMinute) === null ? null
              : `비 REM 심박 ${round(Number(p.nonRemHeartRateBeatsPerMinute), 0)} bpm`,
            asNumber(p.entropy) === null ? null : `엔트로피 ${round(Number(p.entropy), 2)}`
          ].filter(Boolean).join(" · ");
          if (value === null && asNumber(p.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds) !== null) {
            value = asNumber(p.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds);
            display = `${round(value, 1)} ms (깊은 잠 RMSSD)`;
          }
          break;
        case "daily-resting-heart-rate":
          value = asNumber(p.beatsPerMinute);
          display = value === null ? "-" : `${round(value, 0)} bpm`;
          break;
        case "daily-heart-rate-zones": {
          const zones = Array.isArray(p.heartRateZones) ? p.heartRateZones : [];
          value = zones.length;
          display = `${zones.length}개 구간`;
          detail = zones.map(zone => `${zone.heartRateZoneType || "구간"} ${zone.minBeatsPerMinute || "?"}–${zone.maxBeatsPerMinute || "?"} bpm`).join(" · ");
          break;
        }
        case "daily-respiratory-rate":
          value = asNumber(p.breathsPerMinute);
          display = value === null ? "-" : `${round(value, 1)} 회/분`;
          break;
        case "daily-oxygen-saturation":
          value = asNumber(p.averagePercentage);
          display = value === null ? "-" : `${round(value, 1)}%`;
          detail = [p.lowerBoundPercentage, p.upperBoundPercentage].every(v => asNumber(v) !== null)
            ? `범위 ${round(Number(p.lowerBoundPercentage), 1)}–${round(Number(p.upperBoundPercentage), 1)}%` : "";
          if (asNumber(p.standardDeviationPercentage) !== null) detail += `${detail ? " · " : ""}표준편차 ${round(Number(p.standardDeviationPercentage), 1)}%p`;
          break;
        case "daily-sleep-temperature-derivations": {
          const nightly = asNumber(p.nightlyTemperatureCelsius);
          const baseline = asNumber(p.baselineTemperatureCelsius);
          const relative = asNumber(p.relativeNightlyStddev30dCelsius);
          value = nightly;
          display = nightly === null ? "-" : `${round(nightly, 2)} °C`;
          detail = [
            baseline === null ? null : `기준 ${round(baseline, 2)} °C`,
            relative === null ? null : `30일 상대 ${round(relative, 2)}`
          ].filter(Boolean).join(" · ");
          break;
        }
        case "daily-vo2-max":
          value = asNumber(p.vo2Max);
          display = value === null ? "-" : `${round(value, 1)} ml/kg/분`;
          detail = [p.cardioFitnessLevel, p.estimated ? "추정" : null].filter(Boolean).join(" · ");
          break;
      }
      if (value !== null || detail) rows.push({ date, value, display, detail, source: sourceLabel(point) });
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  function sampleRows(spec, points) {
    if (spec.type === "vo2-max" || spec.type === "run-vo2-max") {
      return (points || []).map(point => {
        const p = point?.[spec.payload];
        const value = asNumber(p?.[spec.payload]);
        const date = sampleDate(p);
        return date && value !== null ? {
          date, value, display: `${round(value, 1)} ml/kg/분`,
          detail: p.measurementMethod || "측정/추정값", source: sourceLabel(point)
        } : null;
      }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    }
    if (spec.type === "heart-rate-variability") {
      return aggregateByDate(points, spec.payload, p =>
        asNumber(p.rootMeanSquareOfSuccessiveDifferencesMilliseconds)
      ).map(group => {
        const vals = group.values.map(x => x.value);
        const value = averageNumbers(vals);
        return {
          date: group.date, value, display: value === null ? "-" : `${round(value, 1)} ms`,
          detail: `${vals.length}개 샘플 일평균 (RMSSD)`,
          source: [...new Set(group.values.map(x => x.source))].join(", ")
        };
      });
    }
    if (spec.type === "oxygen-saturation") {
      return aggregateByDate(points, spec.payload, p => asNumber(p.percentage)).map(group => {
        const vals = group.values.map(x => x.value);
        const value = averageNumbers(vals);
        return {
          date: group.date, value, display: value === null ? "-" : `${round(value, 1)}%`,
          detail: `${vals.length}개 샘플 일평균`,
          source: [...new Set(group.values.map(x => x.source))].join(", ")
        };
      });
    }
    if (spec.type === "respiratory-rate-sleep-summary") {
      return aggregateByDate(points, spec.payload, p =>
        asNumber(p?.fullSleepStats?.breathsPerMinute ?? p?.breathsPerMinute)
      ).map(group => {
        const value = averageNumbers(group.values.map(x => x.value));
        return {
          date: group.date, value, display: value === null ? "-" : `${round(value, 1)} 회/분`,
          detail: "수면 요약",
          source: [...new Set(group.values.map(x => x.source))].join(", ")
        };
      });
    }
    if (spec.type === "core-body-temperature") {
      return aggregateByDate(points, spec.payload, p => asNumber(p.temperatureCelsius)).map(group => {
        const value = averageNumbers(group.values.map(x => x.value));
        return {
          date: group.date, value, display: value === null ? "-" : `${round(value, 2)} °C`,
          detail: `${group.values.length}개 측정 일평균`,
          source: [...new Set(group.values.map(x => x.source))].join(", ")
        };
      });
    }

    const field = spec.type === "weight" ? "weightGrams" : spec.type === "body-fat" ? "percentage" : "heightMillimeters";
    const unit = spec.type === "weight" ? "kg" : spec.type === "body-fat" ? "%" : "cm";
    return (points || []).map(point => {
      const p = point?.[spec.payload];
      if (!p) return null;
      const raw = asNumber(p[field]);
      const value = raw === null ? null : spec.type === "weight" ? raw / 1000 : spec.type === "height" ? raw / 10 : raw;
      const date = sampleDate(p);
      return !date || value === null ? null : {
        date, value, display: `${round(value, 1)} ${unit}`, detail: "측정값", source: sourceLabel(point)
      };
    }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  }

  function rollupRows(spec, points) {
    const rows = [];
    for (const point of points || []) {
      const date = civilDateTimeDate(point.civilStartTime);
      if (!date) continue;
      const p = point[spec.payload || (
        spec.type === "heart-rate" ? "heartRate" :
        spec.type === "active-energy-burned" ? "activeEnergyBurned" :
        spec.type === "total-calories" ? "totalCalories" :
        spec.type === "active-minutes" ? "activeMinutes" :
        spec.type)];
      if (!p) continue;
      let value = null, display = "-", detail = "";
      if (spec.type === "heart-rate") {
        value = asNumber(p.beatsPerMinuteAvg);
        display = value === null ? "-" : `${round(value, 0)} bpm`;
        const min = asNumber(p.beatsPerMinuteMin), max = asNumber(p.beatsPerMinuteMax);
        detail = min !== null && max !== null ? `최저 ${round(min, 0)} · 최고 ${round(max, 0)} bpm` : "";
      } else if (spec.type === "steps") {
        value = asNumber(p.countSum);
        display = value === null ? "-" : `${Math.round(value).toLocaleString("ko-KR")} 걸음`;
      } else if (spec.type === "floors") {
        value = asNumber(p.countSum);
        display = value === null ? "-" : `${Math.round(value)}층`;
      } else if (spec.type === "altitude") {
        const mm = asNumber(p.gainMillimetersSum);
        value = mm === null ? null : mm / 1000;
        display = value === null ? "-" : `${round(value, 1)} m 상승`;
      } else if (spec.type === "active-zone-minutes") {
        const fat = asNumber(p.sumInFatBurnHeartZone);
        const cardio = asNumber(p.sumInCardioHeartZone);
        const peak = asNumber(p.sumInPeakHeartZone);
        value = [fat, cardio, peak].some(x => x !== null) ? (fat || 0) + (cardio || 0) + (peak || 0) : null;
        display = value === null ? "-" : `${Math.round(value)} 구간분`;
        detail = `지방연소 ${fat ?? "-"} · 유산소 ${cardio ?? "-"} · 최고 ${peak ?? "-"}`;
      } else if (spec.type === "sedentary-period") {
        const seconds = asNumber(String(p.durationSum || "").replace(/s$/, ""));
        value = seconds === null ? null : seconds / 3600;
        display = value === null ? "-" : `${round(value, 1)} 시간`;
      } else if (spec.type === "time-in-heart-rate-zone") {
        const zones = Array.isArray(p.timeInHeartRateZones) ? p.timeInHeartRateZones : [];
        const entries = zones.map(zone => ({
          name: zone.heartRateZone || "구간",
          minutes: asNumber(String(zone.duration || "").replace(/s$/, "")) / 60
        })).filter(zone => Number.isFinite(zone.minutes));
        value = entries.length ? entries.reduce((sum, zone) => sum + zone.minutes, 0) : null;
        display = value === null ? "-" : `${round(value, 0)} 분`;
        detail = entries.map(zone => `${zone.name} ${round(zone.minutes, 0)}분`).join(" · ");
      } else if (spec.type === "calories-in-heart-rate-zone") {
        const zones = Array.isArray(p.caloriesInHeartRateZones) ? p.caloriesInHeartRateZones : [];
        const entries = zones.map(zone => ({ name: zone.heartRateZone || "구간", kcal: asNumber(zone.kcal) }))
          .filter(zone => zone.kcal !== null);
        value = entries.length ? entries.reduce((sum, zone) => sum + zone.kcal, 0) : null;
        display = value === null ? "-" : `${round(value, 0)} kcal`;
        detail = entries.map(zone => `${zone.name} ${round(zone.kcal, 0)}kcal`).join(" · ");
      } else if (spec.type === "swim-lengths-data") {
        value = asNumber(p.strokeCountSum);
        display = value === null ? "-" : `${Math.round(value)} 스트로크`;
      } else if (spec.type === "active-energy-burned" || spec.type === "total-calories") {
        value = asNumber(p.kcalSum);
        display = value === null ? "-" : `${Math.round(value).toLocaleString("ko-KR")} kcal`;
      } else if (spec.type === "distance") {
        const mm = asNumber(p.millimetersSum);
        value = mm === null ? null : mm / 1_000_000;
        display = value === null ? "-" : `${round(value, 2)} km`;
      } else if (spec.type === "active-minutes") {
        const byLevel = Array.isArray(p.activeMinutesRollupByActivityLevel) ? p.activeMinutesRollupByActivityLevel : [];
        value = byLevel.reduce((sum, item) => sum + (asNumber(item.activeMinutesSum) || 0), 0);
        display = `${Math.round(value)} 분`;
        detail = byLevel.map(item => `${String(item.activityLevel || "").replace("ACTIVITY_LEVEL_", "")} ${asNumber(item.activeMinutesSum) || 0}분`).join(" · ");
      }
      if (value !== null || detail) rows.push({
        date, value, display, detail,
        source: "Google Health dailyRollUp · reconciled all sources"
      });
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  function exerciseRows(points) {
    return (points || []).map(point => {
      const e = point?.exercise;
      if (!e) return null;
      const start = e.interval?.civilStartTime || e.interval?.startTime;
      const date = dateFromTime(start) || googleDate(e.interval?.civilStartTime?.date);
      if (!date) return null;
      const m = e.metricsSummary || {};
      const detailParts = [];
      if (asNumber(m.steps) !== null) detailParts.push(`${Number(m.steps).toLocaleString("ko-KR")} 걸음`);
      if (asNumber(m.caloriesKcal) !== null) detailParts.push(`${round(Number(m.caloriesKcal), 0)} kcal`);
      if (asNumber(m.averageHeartRateBeatsPerMinute) !== null) detailParts.push(`평균 ${round(Number(m.averageHeartRateBeatsPerMinute), 0)} bpm`);
      return {
        date,
        value: null,
        display: e.displayName || String(e.exerciseType || "운동").replaceAll("_", " "),
        detail: detailParts.join(" · "),
        source: sourceLabel(point)
      };
    }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  }

  function sleepRows(points) {
    const sessions = base.__test?.parseSleepSessions ? base.__test.parseSleepSessions(points || []) : [];
    return sessions.map(s => ({
      date: s.date,
      value: s.asleep_hours,
      display: s.asleep_hm,
      detail: [
        `${s.bed_time}–${s.wake_time}`,
        `앱 계산 효율 ${Number.isFinite(s.efficiency) ? `${s.efficiency}%` : "-"}`,
        `깊은 잠 ${s.deep_hm} · REM ${s.rem_hm} · 깨어 있음 ${s.awake_hm}`,
        Number.isFinite(s.awake_segments) ? `깨어난 구간 ${s.awake_segments}회` : null,
        Number.isFinite(s.restless_minutes) && s.restless_minutes > 0 ? `뒤척임 ${round(s.restless_minutes, 0)}분` : null,
        Number.isFinite(s.minutes_to_fall_asleep) ? `잠들기까지 ${round(s.minutes_to_fall_asleep, 0)}분` : null
      ].filter(Boolean).join(" · "),
      source: s.device || "Google Health"
    }));
  }

  function stateFromFetch(spec, result, requestedRange) {
    const range = result.range || requestedRange;
    let rows;
    if (spec.record === "rollup") rows = rollupRows(spec, result.items);
    else if (spec.record === "daily") rows = dailyRows(spec, result.items);
    else if (spec.record === "sample") rows = sampleRows(spec, result.items);
    else if (spec.record === "exercise") rows = exerciseRows(result.items);
    else rows = sleepRows(result.items);
    const status = result.truncated ? "partial" : rows.length ? "ok" : "no_data";
    return {
      type: spec.type,
      label: spec.label,
      category: spec.category,
      scope: spec.scope,
      method: spec.method,
      status,
      count: rows.length,
      raw_count: result.items.length,
      page_count: result.pageCount,
      range: { start: range.startDate, end_exclusive: range.endDate, days: range.days },
      latest: rows.length ? rows[rows.length - 1] : null,
      history: rows.slice(-90),
      message: result.truncated ? `안전 제한(${MAX_PAGES}페이지)까지 조회되어 일부만 표시됩니다.` : ""
    };
  }

  function unavailableState(spec, status, range, message) {
    return {
      type: spec.type, label: spec.label, category: spec.category, scope: spec.scope,
      method: spec.method, status, count: 0, raw_count: 0, page_count: 0,
      range: { start: range.startDate, end_exclusive: range.endDate, days: Math.min(range.days, spec.maxDays || range.days) },
      latest: null, history: [], message: message || ""
    };
  }

  function latestHighlight(types, key, label) {
    const state = types[key];
    if (!state?.latest) return null;
    return {
      type: key,
      label,
      display: state.latest.display,
      detail: state.latest.detail || "",
      date: state.latest.date,
      source: state.latest.source || "Google Health"
    };
  }

  function buildHighlights(types) {
    return [
      latestHighlight(types, "daily-heart-rate-variability", "HRV"),
      latestHighlight(types, "daily-resting-heart-rate", "안정시 심박수"),
      latestHighlight(types, "heart-rate", "일일 심박수"),
      latestHighlight(types, "daily-oxygen-saturation", "SpO₂"),
      latestHighlight(types, "daily-respiratory-rate", "호흡수"),
      latestHighlight(types, "daily-sleep-temperature-derivations", "수면 온도"),
      latestHighlight(types, "steps", "걸음 수"),
      latestHighlight(types, "active-zone-minutes", "심박 활동구간"),
      latestHighlight(types, "active-energy-burned", "활동 에너지"),
      latestHighlight(types, "daily-vo2-max", "심폐체력"),
      latestHighlight(types, "weight", "체중")
    ].filter(Boolean);
  }

  async function fetchOne(accessToken, spec, range) {
    if (spec.method === "dailyRollUp") return fetchDailyRollup(accessToken, spec, range);
    return fetchListWithFallback(accessToken, spec, range);
  }

  async function sync(progress) {
    const notify = typeof progress === "function" ? progress : () => {};
    const rangeChoice = document.getElementById("wearable-range-select")?.value;
    const range = makeRange(rangeChoice ?? cfg().WEARABLE_SYNC_DAYS ?? cfg().SYNC_DAYS ?? DEFAULT_SYNC_DAYS);
    notify("Google 권한 확인 중…");
    const auth = await requestWearableToken();

    const states = {};
    const raw = {};
    let completed = 0;
    const runnable = SPECS.filter(spec => auth.grants[spec.scope]);
    for (const spec of SPECS) {
      if (!auth.grants[spec.scope]) {
        states[spec.type] = unavailableState(spec, "permission", range, `${spec.scope} 읽기 권한이 허용되지 않았습니다.`);
      }
    }

    let cursor = 0;
    async function worker() {
      while (cursor < runnable.length) {
        const index = cursor++;
        const spec = runnable[index];
        notify(`Google Health 동기화 ${completed + 1}/${runnable.length} · ${spec.label}`);
        try {
          const result = await fetchOne(auth.accessToken, spec, range);
          raw[spec.type] = result.items;
          states[spec.type] = stateFromFetch(spec, result, range);
        } catch (error) {
          states[spec.type] = unavailableState(spec, classifyError(error), range, error?.message || "조회 실패");
          raw[spec.type] = [];
        }
        completed += 1;
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, runnable.length)) }, () => worker()));

    if (!auth.grants.sleep) throw new Error("수면 읽기 권한이 필요합니다.");
    if (!raw.sleep?.length) {
      const sleepState = states.sleep;
      if (sleepState?.status === "error" || sleepState?.status === "unsupported") {
        throw new Error(`수면 데이터 조회 실패: ${sleepState.message || sleepState.status}`);
      }
      throw new Error(`선택한 ${range.days}일 범위에 Google Health 수면 기록이 없습니다.`);
    }

    notify("대시보드 계산 중…");
    const data = base.__test.calculateMetrics(
      raw.sleep,
      [],
      raw["daily-heart-rate-variability"] || [],
      raw["daily-resting-heart-rate"] || [],
      Number(cfg().TARGET_SLEEP_HOURS) || 8
    );

    const todaySteps = states.steps?.history?.find(row => row.date === data.today.date)?.value;
    if (Number.isFinite(todaySteps)) data.activity.steps = Math.round(todaySteps);

    data.wearables = {
      synced_at: new Date().toISOString(),
      range: { start: range.startDate, end_exclusive: range.endDate, days: range.days },
      grants: { sleep: auth.grants.sleep, health: auth.grants.health, activity: auth.grants.activity },
      scopes: SCOPES,
      categories: {
        sleep: ["sleep"],
        vitals: SPECS.filter(x => x.category === "vitals").map(x => x.type),
        activity: SPECS.filter(x => x.category === "activity").map(x => x.type),
        body: SPECS.filter(x => x.category === "body").map(x => x.type)
      },
      types: states,
      status_counts: Object.values(states).reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {}),
      notes: [
        "고빈도 심박수·걸음·에너지·활동시간·거리는 Google Health dailyRollUp으로 일별 집계합니다.",
        "heart-rate, active-minutes, total-calories dailyRollUp은 Google 제한에 따라 최대 14일입니다.",
        "원본 데이터와 OAuth 토큰은 저장하지 않고, 화면용 일별 요약만 기기 localStorage 캐시에 저장합니다."
      ]
    };
    data.today.wearable_highlights = buildHighlights(states);
    data.metric_methodology.sleep_efficiency =
      "화면의 효율은 API가 반환한 summary.minutesAsleep ÷ summary.minutesInSleepPeriod × 100으로 앱이 재계산한 값입니다. minutesInSleepPeriod는 bedtime~wake time의 단계 합계입니다. Google 문서의 공식 Sleep Efficiency는 total minutes asleep ÷ total minutes in bed이지만 내부 계산 시점이 최종 stage summary와 달라질 수 있어 동일한 공식 점수로 표시하지 않습니다.";
    data.metric_methodology.google_sleep_score =
      "Google Health의 Sleep Score는 수면 시간, sound sleep까지 걸린 시간, sound sleep, restlessness, full awakenings, interruptions 등을 사용합니다. API의 별도 공식 Sleep Score 데이터 타입/공개 가중식으로 취급하지 않으며 MySleepCoach 수면 점수 추정치와 구분합니다.";
    data.metric_methodology.raw_records_persisted = false;

    try {
      window.dispatchEvent(new CustomEvent("mysleepcoach:wearables", { detail: data }));
    } catch (_) {}
    notify("동기화 완료");
    return data;
  }

  window.MySleepCoachStatic = Object.freeze({
    ...base,
    sync,
    scopes: Object.freeze({ ...base.scopes, ...SCOPES }),
    wearableCatalog: SPECS,
    __test: Object.freeze({
      ...base.__test,
      boundedDays,
      makeRange,
      filterFor,
      rollupRows,
      dailyRows,
      sampleRows,
      exerciseRows,
      stateFromFetch,
      fetchDailyRollup,
      fetchListPages,
      classifyError
    })
  });
})();
