const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const requests = [];
const context = {
  window: {},
  document: { getElementById: () => null },
  console, URL, Intl, Date, Math, Number, Object, Array, Promise,
  fetch: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 9, day: 27 } }, steps: { countSum: '8421' } }
    ] }) };
  }
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/health-static.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/wearables.js', 'utf8'), context);

const appModule = context.window.MySleepCoachStatic;
const api = appModule.__test;
const spec = type => appModule.wearableCatalog.find(item => item.type === type);
assert(appModule.wearableCatalog.length >= 30, 'wearable catalog should cover more than core sleep metrics');

const range = api.makeRange(30, '2026-09-27');
assert.strictEqual(range.startDate, '2026-08-29');
assert.strictEqual(range.endDate, '2026-09-28');
assert(api.filterFor(spec('daily-heart-rate-variability'), range).includes('daily_heart_rate_variability.date'));
assert(api.filterFor(spec('sleep'), range).includes('sleep.interval.civil_end_time'));

const rows = api.rollupRows(spec('active-zone-minutes'), [{
  civilStartTime: { date: { year: 2026, month: 9, day: 27 } },
  activeZoneMinutes: { sumInFatBurnHeartZone: '12', sumInCardioHeartZone: '8', sumInPeakHeartZone: '4' }
}]);
assert.strictEqual(rows[0].value, 24);

const hrv = api.dailyRows(spec('daily-heart-rate-variability'), [{
  dailyHeartRateVariability: {
    date: { year: 2026, month: 9, day: 27 }, averageHeartRateVariabilityMilliseconds: 38.4
  }
}]);
assert.strictEqual(hrv[0].value, 38.4);

const weight = api.sampleRows(spec('weight'), [{
  weight: { sampleTime: { physicalTime: '2026-09-25T16:30:00Z' }, weightGrams: 71000 }
}]);
assert.strictEqual(weight[0].date, '2026-09-26', 'physical sample must use Korean civil date');
assert.strictEqual(weight[0].value, 71);

const empty = api.stateFromFetch(spec('daily-respiratory-rate'), { items: [
  { dailyRespiratoryRate: { date: { year: 2026, month: 9, day: 27 } } }
], pageCount: 1 }, range);
assert.strictEqual(empty.status, 'no_data', 'unmapped values must not count as observed data');

(async () => {
  const result = await api.fetchDailyRollup('synthetic-token', spec('steps'), range);
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(requests[0].body.pageSize, 30, 'page size must respect Google rollup duration limit');
  assert.strictEqual(requests[0].body.range.start.date.year, 2026);
  console.log('PASS wearable catalog synthetic audit');
})().catch(error => { console.error(error); process.exitCode = 1; });
