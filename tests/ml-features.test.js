/**
 * Phase 0 feature-layer tests: the pure functions in js/ml-features.js the
 * cash-flow model is built on — deterministic RNG, UTC date math, the
 * discretionary-spend definition and daily series (incl. the future-leak guard),
 * the data-sufficiency gate, and the synthetic ledger generator.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

test('mulberry32 is deterministic per seed and varies across seeds', () => {
  const s = createSandbox();
  const a = s.mulberry32(42);
  const b = s.mulberry32(42);
  const c = s.mulberry32(43);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB);
  assert.notDeepStrictEqual(seqA, [c(), c(), c()]);
  seqA.forEach((v) => assert.ok(v >= 0 && v < 1));
});

test('UTC date helpers step and diff calendar days independent of timezone', () => {
  const s = createSandbox();
  assert.strictEqual(s.mlAddDays('2026-05-20', 5), '2026-05-25');
  assert.strictEqual(s.mlAddDays('2026-05-31', 1), '2026-06-01');
  assert.strictEqual(s.mlAddDays('2026-05-20', -1), '2026-05-19');
  assert.strictEqual(s.mlDaysBetween('2026-05-20', '2026-05-25'), 5);
  // 1970-01-01 (the Unix epoch) is a Thursday -> getUTCDay 4.
  assert.strictEqual(s.mlDayOfWeek('1970-01-01'), 4);
});

test('isDiscretionaryExpense counts only manual expenses', () => {
  const s = createSandbox();
  assert.strictEqual(s.isDiscretionaryExpense({ type: 'expense', scheduledId: null }), true);
  assert.strictEqual(s.isDiscretionaryExpense({ type: 'expense', scheduledId: 's1' }), false);
  assert.strictEqual(s.isDiscretionaryExpense({ type: 'income', scheduledId: null }), false);
  assert.strictEqual(s.isDiscretionaryExpense({ type: 'transfer', scheduledId: null }), false);
  assert.strictEqual(s.isDiscretionaryExpense(null), false);
});

test('getDiscretionaryDailySeries buckets by day, fills gaps, and never looks into the future', () => {
  const s = createSandbox();
  const txns = [
    { type: 'expense', scheduledId: null, currency: 'THB', amount: 100, date: '2026-05-18' },
    { type: 'expense', scheduledId: null, currency: 'THB', amount: 50, date: '2026-05-18' }, // same day sums
    { type: 'expense', scheduledId: null, currency: 'THB', amount: 999, date: '2026-05-21' }, // future -> excluded
    { type: 'income', scheduledId: null, currency: 'THB', amount: 777, date: '2026-05-19' }, // income -> excluded
    { type: 'expense', scheduledId: 's1', currency: 'THB', amount: 300, date: '2026-05-19' }, // scheduled -> excluded
  ];
  const series = s.getDiscretionaryDailySeries(txns, 'THB', '2026-05-20', 3); // 05-18, 05-19, 05-20
  assert.strictEqual(series.length, 3);
  // Array.from rebuilds the array in the test realm; a sandbox-realm array would
  // fail deepStrictEqual's prototype-identity check even when structurally equal.
  assert.deepStrictEqual(Array.from(series, (d) => d.date), ['2026-05-18', '2026-05-19', '2026-05-20']);
  assert.strictEqual(series[0].amount, 150); // 100 + 50
  assert.strictEqual(series[1].amount, 0); // income & scheduled both excluded
  assert.strictEqual(series[2].amount, 0); // gap filled with 0
});

test('meanStd computes mean and population standard deviation', () => {
  const s = createSandbox();
  const empty = s.meanStd([]);
  assert.strictEqual(empty.mean, 0);
  assert.strictEqual(empty.std, 0);
  const r = s.meanStd([2, 4, 6]);
  assert.strictEqual(r.mean, 4);
  assert.ok(Math.abs(r.std - Math.sqrt(8 / 3)) < 1e-9);
});

test('data sufficiency escalates none -> minimal -> good with more history', () => {
  const s = createSandbox();
  assert.strictEqual(s.assessDataSufficiency({ discretionaryTxCount: 3, distinctSpendDays: 2, spanDays: 10 }), 'none');
  assert.strictEqual(s.assessDataSufficiency({ discretionaryTxCount: 20, distinctSpendDays: 15, spanDays: 30 }), 'minimal');
  assert.strictEqual(s.assessDataSufficiency({ discretionaryTxCount: 200, distinctSpendDays: 80, spanDays: 120 }), 'good');
});

test('auditLedgerData summarises an empty ledger as insufficient', () => {
  const s = createSandbox();
  const audit = s.auditLedgerData({ transactions: [], schedules: [], preferences: { baseCurrency: 'THB' } });
  assert.strictEqual(audit.txCount, 0);
  assert.strictEqual(audit.spanDays, 0);
  assert.strictEqual(audit.sufficiency, 'none');
});

test('generateSyntheticLedger is deterministic and produces a well-formed, sufficient ledger', () => {
  const s = createSandbox();
  const a = s.generateSyntheticLedger({ months: 6, seed: 7, endDate: '2026-05-20', baseCurrency: 'THB' });
  const b = s.generateSyntheticLedger({ months: 6, seed: 7, endDate: '2026-05-20', baseCurrency: 'THB' });
  assert.strictEqual(a.transactions.length, b.transactions.length);
  assert.strictEqual(a.transactions[0].amount, b.transactions[0].amount);
  assert.ok(a.wallets.length >= 1 && a.categories.length >= 1 && a.schedules.length >= 1);
  a.transactions.forEach((tx) => {
    assert.ok(tx.currency && /^\d{4}-\d{2}-\d{2}$/.test(tx.date));
    assert.strictEqual(tx.scheduledId, null);
  });
  assert.strictEqual(s.auditLedgerData(a).sufficiency, 'good');
});
