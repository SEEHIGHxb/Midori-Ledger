const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

function baseState(overrides) {
  return Object.assign({
    wallets: [],
    categories: [],
    transactions: [],
    schedules: [],
    preferences: { theme: 'dark', baseCurrency: 'THB', autoSyncDeviceDate: false, syncEnabled: false, syncId: null, syncKey: null, lastSyncedAt: 0 },
    virtualDate: '2026-06-24',
    updatedAt: 0,
    fxRatesCache: null,
  }, overrides);
}

test('getNextOccurrenceDate advances by the given frequency', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-06-24', 'daily'), '2026-06-25');
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-06-24', 'weekly'), '2026-07-01');
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-06-24', 'monthly'), '2026-07-24');
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-06-24', 'yearly'), '2027-06-24');
});

test('getNextOccurrenceDate rolls into the next month when the day overflows', () => {
  const sandbox = createSandbox();
  // Jan 31 + 1 month -> Feb 2026 only has 28 days, so it overflows to Mar 3.
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-01-31', 'monthly'), '2026-03-03');
});

test('getNextOccurrenceDate returns the input unchanged for an unparseable date', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.getNextOccurrenceDate('not-a-date', 'daily'), 'not-a-date');
});

test('processSchedules creates exactly one due transaction and advances nextDueDate', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    schedules: [{
      id: 'sched1', title: 'Rent', active: true, frequency: 'monthly',
      nextDueDate: '2026-06-01', walletId: 'w1', categoryId: 'cat1',
      currency: 'JPY', amount: 100, type: 'expense', endDate: null,
    }],
  }));

  sandbox.processSchedules('2026-06-15');

  const state = sandbox.__getState();
  assert.strictEqual(state.transactions.length, 1);
  assert.strictEqual(state.transactions[0].date, '2026-06-01');
  assert.strictEqual(state.transactions[0].amount, 100);
  assert.strictEqual(state.transactions[0].scheduledId, 'sched1');
  assert.strictEqual(state.schedules[0].nextDueDate, '2026-07-01');
  assert.strictEqual(state.schedules[0].active, true);
});

test('processSchedules generates every occurrence due up to the target date', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    schedules: [{
      id: 'sched1', title: 'Daily coffee', active: true, frequency: 'daily',
      nextDueDate: '2026-06-24', walletId: 'w1', categoryId: 'cat1',
      currency: 'JPY', amount: 5, type: 'expense', endDate: null,
    }],
  }));

  sandbox.processSchedules('2026-06-27');

  const state = sandbox.__getState();
  const dates = state.transactions.map((tx) => tx.date).sort();
  assert.deepStrictEqual(dates, ['2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27']);
  assert.strictEqual(state.schedules[0].nextDueDate, '2026-06-28');
});

test('processSchedules deactivates a schedule once its endDate is passed', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    schedules: [{
      id: 'sched1', title: 'Limited offer', active: true, frequency: 'daily',
      nextDueDate: '2026-06-24', walletId: 'w1', categoryId: 'cat1',
      currency: 'JPY', amount: 5, type: 'expense', endDate: '2026-06-25',
    }],
  }));

  sandbox.processSchedules('2026-06-30');

  const state = sandbox.__getState();
  assert.strictEqual(state.transactions.length, 2);
  assert.strictEqual(state.schedules[0].active, false);
});

test('processSchedules ignores inactive schedules', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    schedules: [{
      id: 'sched1', title: 'Paused', active: false, frequency: 'daily',
      nextDueDate: '2026-06-01', walletId: 'w1', categoryId: 'cat1',
      currency: 'JPY', amount: 5, type: 'expense', endDate: null,
    }],
  }));

  sandbox.processSchedules('2026-06-30');

  assert.strictEqual(sandbox.__getState().transactions.length, 0);
});
