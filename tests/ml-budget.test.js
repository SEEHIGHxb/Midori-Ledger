/**
 * Phase 4 tests: budget-overrun forecasting in js/ml-budget.js — the month
 * period math, per-category schedule expansion, and the projected-total
 * classification. A deterministic minimal ledger (sufficiency 'none' so the
 * learned model contributes nothing) pins the exact projected numbers; the
 * synthetic ledger covers the 'good'-data path and sorting.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

// A ledger with one budgeted category, 3 discretionary charges (600 total this
// month) and one monthly expense schedule (500) due in the remaining window.
// 3 charges < 8 => sufficiency 'none', so remainingDiscretionary is 0 and the
// projected total is fully determined: 600 spent + 500 scheduled = 1100.
function minimalLedger() {
  const mkTx = (id, date) => ({
    id, title: 'Stream', amount: 200, type: 'expense', walletId: 'w1',
    categoryId: 'c_x', currency: 'THB', date, scheduledId: null, updatedAt: 0,
  });
  return {
    wallets: [{ id: 'w1', name: 'Cash', currency: 'THB', openingBalance: 0, balance: 0 }],
    categories: [{ id: 'c_x', name: 'Streaming', type: 'expense', includeInBudget: true, budget: 1000, yearlyBudget: null, color: '#abc' }],
    transactions: [mkTx('t1', '2026-05-05'), mkTx('t2', '2026-05-10'), mkTx('t3', '2026-05-15')],
    schedules: [{ id: 's_x', title: 'Streaming', amount: 500, type: 'expense', walletId: 'w1', categoryId: 'c_x', currency: 'THB', frequency: 'monthly', active: true, nextDueDate: '2026-05-25', startDate: '2026-05-25', endDate: null }],
    preferences: { baseCurrency: 'THB' },
    virtualDate: '2026-05-20',
    deletions: {},
  };
}

test('mlCurrentMonthPeriod finds the month end and days remaining', () => {
  const s = createSandbox();
  assert.deepStrictEqual(
    { e: s.mlCurrentMonthPeriod('2026-05-20').endStr, d: s.mlCurrentMonthPeriod('2026-05-20').daysLeft },
    { e: '2026-05-31', d: 11 }
  );
  assert.strictEqual(s.mlCurrentMonthPeriod('2026-02-10').endStr, '2026-02-28'); // non-leap
  assert.strictEqual(s.mlCurrentMonthPeriod('2024-02-10').endStr, '2024-02-29'); // leap
  assert.strictEqual(s.mlCurrentMonthPeriod('2026-05-31').daysLeft, 0); // last day of month
});

test('getRemainingScheduledCategorySpend sums only that category\'s future expense occurrences', () => {
  const s = createSandbox();
  s.__setState(minimalLedger());
  assert.strictEqual(s.getRemainingScheduledCategorySpend('c_x', '2026-05-20', '2026-05-31', 'THB'), 500);
  assert.strictEqual(s.getRemainingScheduledCategorySpend('c_other', '2026-05-20', '2026-05-31', 'THB'), 0);
  // An already-past occurrence window contributes nothing (nothing due before the 20th here).
  assert.strictEqual(s.getRemainingScheduledCategorySpend('c_x', '2026-05-25', '2026-05-31', 'THB'), 0);
});

test('forecastBudgets projects spent + scheduled and classifies a projected overrun', () => {
  const s = createSandbox();
  s.__setState(minimalLedger());
  const result = s.forecastBudgets();
  assert.strictEqual(result.sufficiency, 'none'); // model contributes nothing
  assert.strictEqual(result.daysLeft, 11);
  assert.strictEqual(result.monthEnd, '2026-05-31');

  const item = result.items.find((i) => i.categoryId === 'c_x');
  assert.strictEqual(item.spent, 600);
  assert.strictEqual(item.remainingDiscretionary, 0);
  assert.strictEqual(item.remainingScheduled, 500);
  assert.strictEqual(item.projected, 1100);
  assert.strictEqual(item.currentPct, 60);   // under the cap right now
  assert.strictEqual(item.projectedPct, 110); // but forecast to cross it
  assert.strictEqual(item.overBy, 100);
  assert.strictEqual(item.status, 'projected_over');
});

test('forecastBudgets returns no items when no category has a monthly budget', () => {
  const s = createSandbox();
  const state = minimalLedger();
  state.categories[0].includeInBudget = false;
  s.__setState(state);
  assert.strictEqual(s.forecastBudgets().items.length, 0);
});

test('forecastBudgets flags an already-exceeded budget and sorts it first', () => {
  const s = createSandbox();
  const state = s.generateSyntheticLedger({ months: 6, seed: 7, endDate: '2026-05-20', baseCurrency: 'THB' });
  state.categories.find((c) => c.id === 'c_transport').budget = 10; // any spend blows this
  s.__setState(state);

  const result = s.forecastBudgets();
  assert.strictEqual(result.sufficiency, 'good');
  const transport = result.items.find((i) => i.categoryId === 'c_transport');
  assert.strictEqual(transport.status, 'exceeded');
  assert.strictEqual(result.items[0].status, 'exceeded'); // most severe sorts to the top
});

test('forecastBudgets leaves a comfortably-funded category safe, and projects at least what is spent', () => {
  const s = createSandbox();
  const state = s.generateSyntheticLedger({ months: 6, seed: 7, endDate: '2026-05-20', baseCurrency: 'THB' });
  state.categories.find((c) => c.id === 'c_food').budget = 100000000; // unreachable
  s.__setState(state);

  const result = s.forecastBudgets();
  const food = result.items.find((i) => i.categoryId === 'c_food');
  assert.strictEqual(food.status, 'safe');
  // Projection is never below money already spent (remaining terms are >= 0).
  result.items.forEach((i) => assert.ok(i.projected >= i.spent));
});
