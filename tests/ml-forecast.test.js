/**
 * Phase 1 forecast tests: the baseline cash-flow model in js/ml-forecast.js —
 * scheduled-flow bucketing, net worth, the discretionary "training" step and its
 * weekday seasonality, and the projected balance path with its widening band.
 * The deterministic synthetic ledger stands in for real user data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

function withSynthetic(s, opts) {
  const state = s.generateSyntheticLedger(
    Object.assign({ months: 6, seed: 7, endDate: '2026-05-20', baseCurrency: 'THB' }, opts || {})
  );
  s.__setState(state);
  return state;
}

test('getScheduledDailyTimeline places salary and rent on their due days, signed', () => {
  const s = createSandbox();
  withSynthetic(s);
  const timeline = s.getScheduledDailyTimeline(30);
  assert.strictEqual(timeline.get('2026-05-25'), 60000); // salary, income -> +
  assert.strictEqual(timeline.get('2026-05-28'), -18000); // rent, expense -> -
});

test('getCurrentNetWorth sums wallet balances in base currency', () => {
  const s = createSandbox();
  withSynthetic(s);
  assert.strictEqual(s.getCurrentNetWorth(), 50000);
});

test('trainDiscretionaryModel selects a model by walk-forward CV on good data', () => {
  const s = createSandbox();
  withSynthetic(s);
  const model = s.trainDiscretionaryModel({});
  assert.strictEqual(model.sufficiency, 'good');
  assert.ok(['seasonal', 'ridge', 'mlp'].indexOf(model.type) !== -1);
  assert.ok(model.cv && model.cv.baselineMae > 0);
  assert.strictEqual(model.cv.winner, model.type);
  // The chosen model's CV error is never worse than the seasonal baseline; a
  // learned model only wins by beating it, so this holds for every outcome.
  const winner = model.cv.results.find((r) => r.name === model.type);
  assert.ok(winner.mae <= model.cv.baselineMae * 1.0001);
});

test('buildSeasonalBaseline captures the weekday spend pattern', () => {
  const s = createSandbox();
  const state = withSynthetic(s);
  const series = s.getDiscretionaryDailySeries(state.transactions, 'THB', state.virtualDate, 90);
  const baseline = s.buildSeasonalBaseline(series, { sufficiency: 'good' });
  assert.strictEqual(baseline.type, 'seasonal');
  assert.strictEqual(baseline.dow.length, 7);
  // Generator: Fridays (weekday 5) are the biggest spend day, Sundays (0) the smallest.
  assert.ok(baseline.dow[5].mean > baseline.dow[0].mean);
});

test('predictDiscretionaryForDay returns a non-negative spend estimate with a spread', () => {
  const s = createSandbox();
  withSynthetic(s);
  const model = s.trainDiscretionaryModel({});
  const p = s.predictDiscretionaryForDay(model, '2026-05-22');
  assert.ok(Number.isFinite(p.mean) && p.mean >= 0);
  assert.ok(Number.isFinite(p.std) && p.std >= 0);
});

test('projectBalance returns a dense path with a band that widens over time', () => {
  const s = createSandbox();
  withSynthetic(s);
  const result = s.projectBalance(30);
  assert.strictEqual(result.sufficiency, 'good');
  assert.strictEqual(result.points.length, 30);
  assert.strictEqual(result.startBalance, 50000);
  result.points.forEach((p) => {
    assert.ok(p.lower <= p.balance && p.balance <= p.upper);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.date));
  });
  const firstBand = result.points[0].upper - result.points[0].lower;
  const lastBand = result.points[29].upper - result.points[29].lower;
  assert.ok(lastBand >= firstBand);
});

test('projectBalance defaults to a 30-day horizon', () => {
  const s = createSandbox();
  withSynthetic(s);
  assert.strictEqual(s.projectBalance().points.length, 30);
});

test('projectBalance refuses to guess on an empty ledger', () => {
  const s = createSandbox();
  s.__setState({ wallets: [], transactions: [], schedules: [], preferences: { baseCurrency: 'THB' }, virtualDate: '2026-05-20' });
  const result = s.projectBalance(30);
  assert.strictEqual(result.sufficiency, 'none');
  assert.strictEqual(result.points.length, 0);
});

test('trainDiscretionaryModel falls back to the seasonal baseline on thin data', () => {
  const s = createSandbox();
  withSynthetic(s, { months: 1 }); // ~1 month -> 'minimal', too little for CV model selection
  const model = s.trainDiscretionaryModel({});
  assert.strictEqual(model.type, 'seasonal');
});
