const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const context = {
  window: {},
  console,
  URL,
  Intl,
  Date,
  Math,
  Number,
  Object,
  Array,
  Promise,
  setTimeout,
  clearTimeout
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync("docs/health-static.js", "utf8"), context);

const api = context.window.MySleepCoachStatic.__test;
assert(api, "test API missing");

function gdate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day } };
}

function sleepPoint(date, start, end, minutesInSleepPeriod, minutesAsleep, opts = {}) {
  return {
    name: opts.name || `${date}-${start}`,
    sleep: {
      type: opts.type || "STAGES",
      interval: {
        startTime: start,
        endTime: end,
        civilEndTime: gdate(date)
      },
      summary: {
        minutesInSleepPeriod,
        minutesAsleep,
        minutesAwake: minutesInSleepPeriod - minutesAsleep,
        stagesSummary: opts.stagesSummary || [
          { type: "LIGHT", minutes: Math.max(0, minutesAsleep - 150) },
          { type: "DEEP", minutes: 90 },
          { type: "REM", minutes: 60 },
          { type: "AWAKE", minutes: minutesInSleepPeriod - minutesAsleep }
        ]
      },
      metadata: { nap: Boolean(opts.nap), processed: true },
      stages: []
    },
    dataSource: { device: { displayName: "Synthetic" } }
  };
}

const sleep = [
  sleepPoint("2026-09-21", "2026-09-20T14:00:00Z", "2026-09-20T22:00:00Z", 480, 420),
  sleepPoint("2026-09-21", "2026-09-21T04:00:00Z", "2026-09-21T05:00:00Z", 60, 55, { nap: true, name: "nap" }),
  sleepPoint("2026-09-22", "2026-09-21T14:30:00Z", "2026-09-21T22:30:00Z", 480, 390, {
    type: "CLASSIC",
    stagesSummary: [
      { type: "ASLEEP", minutes: 390 },
      { type: "AWAKE", minutes: 30 },
      { type: "RESTLESS", minutes: 60 }
    ]
  }),
  sleepPoint("2026-09-23", "2026-09-22T14:00:00Z", "2026-09-22T22:00:00Z", 480, 430),
  sleepPoint("2026-09-24", "2026-09-23T14:00:00Z", "2026-09-23T22:00:00Z", 480, 440)
];

const hrv = ["2026-09-21","2026-09-22","2026-09-23","2026-09-24"].map((date, i) => ({
  dailyHeartRateVariability: {
    date: gdate(date),
    averageHeartRateVariabilityMilliseconds: [40, 42, 41, 45][i]
  }
}));

const rhr = ["2026-09-21","2026-09-22","2026-09-23","2026-09-24"].map((date, i) => ({
  dailyRestingHeartRate: {
    date: gdate(date),
    beatsPerMinute: String([60, 61, 59, 58][i])
  }
}));

const parsed = api.parseSleepSessions(sleep);
assert.strictEqual(parsed.length, 4, "nap should not create a second primary day");
assert.strictEqual(parsed[0].asleep_minutes, 420);
assert.strictEqual(parsed[0].efficiency, 88, "420/480 must be 88%, not 98-99%");
assert.strictEqual(parsed[1].asleep_minutes, 390, "CLASSIC summary.minutesAsleep must be used");
assert.strictEqual(parsed[1].efficiency, 81);
assert.strictEqual(parsed[1].deep_pct, null, "CLASSIC data must not fabricate deep sleep");
const inconsistent = api.parseSleepSessions([sleepPoint(
  "2026-09-25", "2026-09-24T14:00:00Z", "2026-09-24T22:00:00Z", 480, 420,
  { stagesSummary: [
    { type: "LIGHT", minutes: 630 }, { type: "DEEP", minutes: 90 }, { type: "REM", minutes: 60 }
  ] }
)])[0];
assert.strictEqual(inconsistent.light_pct, null, "impossible stage totals must not be presented as percentages");
assert(inconsistent.stage_data_warning);
assert.strictEqual(api.parseSleepSessions([{
  sleep: { interval: { startTime: "2026-09-24T14:00:00Z", endTime: "2026-09-24T22:00:00Z" } }
}]).length, 0, "a session without asleep minutes must not become zero-efficiency sleep");

const metrics = api.calculateMetrics(sleep, [], hrv, rhr, 8);
assert.strictEqual(metrics.all_history.length, 4);
assert.strictEqual(metrics.today.sleep_efficiency, 92);
const equalDuration = { ...parsed[0], asleep_hours: 7, awake_hours: 0.2, restless_minutes: 0, awake_segments: 1 };
const disrupted = { ...equalDuration, awake_hours: 0.8, restless_minutes: 25, awake_segments: 6 };
assert(api.sleepScoreEstimate(disrupted, 8, []) < api.sleepScoreEstimate(equalDuration, 8, []),
  "sleep score must reflect awakenings and restlessness beyond duration");
assert.strictEqual(metrics.metric_methodology.sleep_score.includes("Google/Fitbit/Apple 공식 점수가 아닙니다"), true);
assert.strictEqual(metrics.today.hrv_ms, 45);
assert.strictEqual(metrics.today.resting_hr_bpm, 58);
assert.strictEqual(metrics.today.condition_score, null, "four days are insufficient for a personal baseline");
const eightDays = Array.from({ length: 8 }, (_, index) => {
  const day = String(21 + index).padStart(2, "0");
  const prior = String(20 + index).padStart(2, "0");
  return sleepPoint(`2026-09-${day}`, `2026-09-${prior}T14:00:00Z`, `2026-09-${prior}T22:00:00Z`, 480, 430);
});
const eightHrv = eightDays.map((_, index) => ({ dailyHeartRateVariability: {
  date: gdate(`2026-09-${String(21 + index).padStart(2, "0")}`),
  averageHeartRateVariabilityMilliseconds: 40 + index
} }));
const eightRhr = eightDays.map((_, index) => ({ dailyRestingHeartRate: {
  date: gdate(`2026-09-${String(21 + index).padStart(2, "0")}`), beatsPerMinute: String(60 - index / 2)
} }));
const mature = api.calculateMetrics(eightDays, [], eightHrv, eightRhr, 8);
assert(Number.isFinite(mature.today.condition_score), "readiness estimate should appear after seven prior nights");
assert(mature.today.readiness_source.includes("HRV"));
assert(Number.isFinite(mature.today.resting_hr_baseline_bpm));
assert.strictEqual(metrics.metric_methodology.native_scores_available, false);
assert.strictEqual(metrics.metric_methodology.raw_records_persisted, false);
assert(!("day_strain" in metrics.today), "fabricated strain must not exist");
assert.strictEqual(metrics.all_history[0].condition_score, null, "no biometric baseline means no readiness score");
assert.strictEqual(api.calculateMetrics(sleep, [], [], [], 8).today.condition_score, null,
  "missing biometrics must not be mislabeled as condition");

(async () => {
  const calls = [];
  const pages = [
    { dataPoints: [{ name: "p1" }], nextPageToken: "next" },
    { dataPoints: [{ name: "p2" }] }
  ];
  let idx = 0;
  context.fetch = async url => {
    calls.push(url);
    const body = pages[idx++];
    return { ok: true, json: async () => body };
  };
  const out = await api.fetchAllDataPoints("synthetic-token", "sleep", true);
  assert.deepStrictEqual(Array.from(out, p => p.name), ["p1", "p2"]);
  assert.strictEqual(calls.length, 2);
  assert(calls[0].includes("dataPoints:reconcile"));
  assert(calls[1].includes("pageToken=next"));

  const fallbackCalls = [];
  context.fetch = async url => {
    fallbackCalls.push(url);
    if (url.includes("dataPoints:reconcile")) throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => ({ dataPoints: [{ name: "fallback" }] }) };
  };
  const fallback = await api.fetchAllDataPoints("synthetic-token", "sleep", true);
  assert.strictEqual(fallback[0].name, "fallback");
  assert.strictEqual(fallbackCalls.length, 2, "reconcile failure should retry ordinary list once");

  context.window.MY_SLEEP_COACH_CONFIG = { GOOGLE_CLIENT_ID: "synthetic-client", FETCH_STEPS: false };
  const grantedScopes = new Set([context.window.MySleepCoachStatic.scopes.sleep]);
  context.google = context.window.google = {
    accounts: { oauth2: {
      hasGrantedAllScopes: (_response, scope) => grantedScopes.has(scope),
      initTokenClient: options => ({
        requestAccessToken: () => options.callback({ access_token: "synthetic-token" })
      })
    } }
  };
  const syncCalls = [];
  context.fetch = async url => {
    syncCalls.push(url);
    return { ok: true, json: async () => ({ dataPoints: sleep }) };
  };
  const sleepOnly = await context.window.MySleepCoachStatic.sync();
  assert.strictEqual(syncCalls.length, 1, "denied metric scope must not fail sleep synchronization");
  assert.strictEqual(sleepOnly.today.condition_score, null);
  assert(sleepOnly.metric_methodology.health_metrics_warning.includes("권한"));
  console.log("PASS health-static synthetic audit");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
