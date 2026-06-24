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

test('cleanupOrphanedFutureTransactions removes only future transactions whose schedule no longer exists', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    schedules: [{ id: 's1' }],
    transactions: [
      { id: 't1', title: 'Kept: schedule still active', scheduledId: 's1', date: '2026-07-01' },
      { id: 't2', title: 'Removed: orphaned future transaction', scheduledId: 's2', date: '2026-07-01' },
      { id: 't3', title: 'Kept: orphaned but in the past', scheduledId: 's2', date: '2026-01-01' },
      { id: 't4', title: 'Kept: not from a schedule', scheduledId: null, date: '2026-07-01' },
    ],
  }));

  sandbox.cleanupOrphanedFutureTransactions();

  const remainingIds = sandbox.__getState().transactions.map((tx) => tx.id);
  assert.deepStrictEqual(remainingIds.sort(), ['t1', 't3', 't4']);
});

test('cleanupOrphanedFutureTransactions is a no-op when nothing is orphaned', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState({
    schedules: [{ id: 's1' }],
    transactions: [{ id: 't1', title: 'Active schedule', scheduledId: 's1', date: '2026-07-01' }],
  }));

  sandbox.cleanupOrphanedFutureTransactions();

  assert.strictEqual(sandbox.__getState().transactions.length, 1);
});
