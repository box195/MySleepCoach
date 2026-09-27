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
assert.strictEqual(api.parseSleepSessions([{
  sleep: { interval: { startTime: "2026-09-24T14:00:00Z", endTime: "2026-09-24T22:00:00Z" } }
}]).length, 0, "a session without asleep minutes must not become zero-efficiency sleep");

const metrics = api.calculateMetrics(sleep, [], hrv, rhr, 8);
assert.strictEqual(metrics.all_history.length, 4);
assert.strictEqual(metrics.today.sleep_efficiency, 92);
assert.strictEqual(metrics.today.hrv_ms, 45);
assert.strictEqual(metrics.today.resting_hr_bpm, 58);
assert(metrics.today.readiness_source.includes("HRV"));
assert(Number.isFinite(metrics.today.resting_hr_baseline_bpm));
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
