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

test('trainDiscretionaryModel learns weekday seasonality from enough history', () => {
  const s = createSandbox();
  withSynthetic(s);
  const model = s.trainDiscretionaryModel({});
  assert.strictEqual(model.sufficiency, 'good');
  assert.strictEqual(model.useSeasonality, true);
  assert.strictEqual(model.dow.length, 7);
  assert.ok(model.overall.mean > 0);
  // The generator makes Fridays (weekday 5) the biggest spend day and Sundays
  // (weekday 0) the smallest, so the learned weekday means must reflect that.
  assert.ok(model.dow[5].mean > model.dow[0].mean);
});

test('predictDiscretionaryForDay returns that day\'s weekday bucket when seasonality is on', () => {
  const s = createSandbox();
  withSynthetic(s);
  const model = s.trainDiscretionaryModel({});
  const day = '2026-05-22';
  assert.deepStrictEqual(s.predictDiscretionaryForDay(model, day), model.dow[s.mlDayOfWeek(day)]);
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
