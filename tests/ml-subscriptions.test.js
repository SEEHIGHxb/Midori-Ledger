/**
 * Phase 3 tests: subscription auto-detect in js/ml-subscriptions.js. Crafted
 * ledgers stand in for real data — a clean monthly charge, a weekly one,
 * irregular variable spend that must NOT be flagged, and the guards around
 * occurrence count, existing schedules, and scheduled transactions.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

// A minimal ledger around a set of transactions.
function ledger(transactions, opts) {
  const o = opts || {};
  return {
    wallets: [{ id: 'w1', name: 'Cash', currency: 'THB', openingBalance: 0, balance: 0 }],
    categories: [{ id: 'c_fun', name: 'Fun', type: 'expense', includeInBudget: true }],
    transactions,
    schedules: o.schedules || [],
    preferences: { baseCurrency: 'THB' },
    virtualDate: o.virtualDate || '2026-05-20',
    deletions: {},
  };
}

// A discretionary (manual) expense on a given day.
function charge(title, amount, date, extra) {
  return Object.assign(
    {
      id: `${title}_${date}`,
      title,
      amount,
      type: 'expense',
      walletId: 'w1',
      categoryId: 'c_fun',
      currency: 'THB',
      date,
      scheduledId: null,
      updatedAt: 0,
    },
    extra || {}
  );
}

// Five monthly Netflix charges on the 15th, Jan–May 2026.
const NETFLIX_DATES = ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15'];

test('normalizeMerchantKey collapses invoice noise and case to one merchant', () => {
  const s = createSandbox();
  assert.strictEqual(s.normalizeMerchantKey('Netflix #4021'), 'netflix');
  assert.strictEqual(s.normalizeMerchantKey('  NETFLIX  '), 'netflix');
  assert.strictEqual(s.normalizeMerchantKey('Netflix #4021'), s.normalizeMerchantKey('netflix'));
});

test('detects a clean monthly subscription with the right cadence and amount', () => {
  const s = createSandbox();
  const txns = NETFLIX_DATES.map((d) => charge('Netflix', 349, d));
  const found = s.detectSubscriptions(ledger(txns));
  assert.strictEqual(found.length, 1);
  const c = found[0];
  assert.strictEqual(c.frequency, 'monthly');
  assert.strictEqual(c.amount, 349);
  assert.strictEqual(c.currency, 'THB');
  assert.strictEqual(c.walletId, 'w1');
  assert.strictEqual(c.categoryId, 'c_fun');
  assert.strictEqual(c.occurrences, 5);
  assert.strictEqual(c.confidenceLabel, 'high');
});

test('suggested next due date is the next cadence step after the simulated date', () => {
  const s = createSandbox();
  const txns = NETFLIX_DATES.map((d) => charge('Netflix', 349, d));
  const c = s.detectSubscriptions(ledger(txns, { virtualDate: '2026-05-20' }))[0];
  // Last charge 2026-05-15, virtualDate 2026-05-20 -> next monthly occurrence.
  assert.strictEqual(c.nextDueDate, '2026-06-15');
  assert.ok(c.nextDueDate > '2026-05-20');
});

test('detects a weekly cadence', () => {
  const s = createSandbox();
  const dates = ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-19'];
  const txns = dates.map((d) => charge('Gym Locker', 120, d));
  const c = s.detectSubscriptions(ledger(txns, { virtualDate: '2026-05-20' }))[0];
  assert.ok(c, 'expected a weekly candidate');
  assert.strictEqual(c.frequency, 'weekly');
});

test('does not flag irregular, variable everyday spending', () => {
  const s = createSandbox();
  // Wildly varying amounts on irregular days -> neither cadence nor amount holds.
  const txns = [
    charge('Street Food', 45, '2026-05-02'),
    charge('Street Food', 610, '2026-05-05'),
    charge('Street Food', 80, '2026-05-06'),
    charge('Street Food', 250, '2026-05-13'),
    charge('Street Food', 900, '2026-05-14'),
  ];
  const found = s.detectSubscriptions(ledger(txns));
  assert.strictEqual(found.length, 0);
});

test('needs at least three occurrences to claim a pattern', () => {
  const s = createSandbox();
  const txns = [charge('Netflix', 349, '2026-04-15'), charge('Netflix', 349, '2026-05-15')];
  assert.strictEqual(s.detectSubscriptions(ledger(txns)).length, 0);
});

test('does not re-suggest a merchant already covered by an active schedule', () => {
  const s = createSandbox();
  const txns = NETFLIX_DATES.map((d) => charge('Netflix', 349, d));
  const withSchedule = ledger(txns, {
    schedules: [{ id: 's1', title: 'Netflix', active: true, frequency: 'monthly' }],
  });
  assert.strictEqual(s.detectSubscriptions(withSchedule).length, 0);
});

test('ignores transactions that are already schedule-generated', () => {
  const s = createSandbox();
  // Same clean monthly pattern, but each charge carries a scheduledId -> not
  // discretionary, so it is invisible to detection (it is already recurring).
  const txns = NETFLIX_DATES.map((d) => charge('Netflix', 349, d, { scheduledId: 's1' }));
  assert.strictEqual(s.detectSubscriptions(ledger(txns)).length, 0);
});
