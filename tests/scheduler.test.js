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

test('getNextOccurrenceDate clamps to the last day of a short month', () => {
  const sandbox = createSandbox();
  // Previously this overflowed to 2026-03-03: Feb 2026 has 28 days, and
  // setUTCMonth(+1) rolls the surplus into the following month.
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-01-30', 'monthly', 30), '2026-02-28');
  assert.strictEqual(sandbox.getNextOccurrenceDate('2028-01-31', 'monthly', 31), '2028-02-29', 'leap year');
});

test('getNextOccurrenceDate returns to the anchor day after a short month', () => {
  const sandbox = createSandbox();
  // The bug that mattered was not the single hop but the drift: without an
  // anchor each step reads the previous result, so "the 31st" became "the 3rd"
  // permanently. Walking a full year must keep landing on the anchor.
  const anchor = 31;
  let date = '2026-01-31';
  const days = [];
  for (let i = 0; i < 12; i++) {
    date = sandbox.getNextOccurrenceDate(date, 'monthly', anchor);
    days.push(Number(date.split('-')[2]));
  }

  assert.deepStrictEqual(days, [28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31]);
  assert.strictEqual(date, '2027-01-31', 'a year of hops must return to the 31st');
});

test('getNextOccurrenceDate clamps a Feb 29 yearly schedule to Feb 28', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.getNextOccurrenceDate('2028-02-29', 'yearly', 29), '2029-02-28');
});

test('getNextOccurrenceDate falls back to the date it was given without an anchor', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-06-24', 'monthly'), '2026-07-24');
  // No anchor and a short target month: clamp against the date's own day.
  assert.strictEqual(sandbox.getNextOccurrenceDate('2026-01-31', 'monthly'), '2026-02-28');
});

test('getScheduleAnchorDay prefers startDate and tolerates junk', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.getScheduleAnchorDay({ startDate: '2026-01-31', nextDueDate: '2026-03-03' }), 31);
  assert.strictEqual(sandbox.getScheduleAnchorDay({ nextDueDate: '2026-03-03' }), 3, 'falls back to nextDueDate');
  assert.strictEqual(sandbox.getScheduleAnchorDay({ startDate: 'not-a-date' }), null);
  assert.strictEqual(sandbox.getScheduleAnchorDay({}), null);
  assert.strictEqual(sandbox.getScheduleAnchorDay(null), null);
});

test('processSchedules keeps a month-end schedule on its anchor day', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    virtualDate: '2026-01-31',
    schedules: [{
      id: 'sched31', title: 'Rent', active: true, frequency: 'monthly',
      startDate: '2026-01-31', nextDueDate: '2026-01-31', walletId: 'w1',
      categoryId: 'cat1', currency: 'JPY', amount: 100, type: 'expense', endDate: null,
    }],
  }));

  sandbox.processSchedules('2026-04-30');

  const state = sandbox.__getState();
  const dates = state.transactions.map(t => t.date);
  // Before the fix: 2026-01-31, 2026-03-03, 2026-04-03 — one occurrence lost
  // in February and the due day drifted for good.
  assert.deepStrictEqual(dates, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.strictEqual(state.schedules[0].nextDueDate, '2026-05-31');
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
