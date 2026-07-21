/**
 * Tests that every delete path records a tombstone, and every write path
 * stamps updatedAt.
 *
 * merge.js is correct in isolation (see merge.test.js) but it is only ever as
 * good as the bookkeeping feeding it. A mutator that forgets recordDeletion()
 * produces no error, no warning and no visible symptom — until the record
 * reappears on another device days later. These tests are the only thing that
 * catches that, so a new mutator should get a case here.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

function freshLedger() {
  const sandbox = createSandbox();
  const state = sandbox.__getState();
  state.wallets = [];
  state.categories = [];
  state.transactions = [];
  state.schedules = [];
  state.deletions = {};
  state.virtualDate = '2026-07-21';
  return sandbox;
}

const tombstoned = (sandbox) => Object.keys(sandbox.__getState().deletions).sort();

test('deleteTransaction tombstones the transaction', () => {
  const sandbox = freshLedger();
  sandbox.addWallet({ name: 'Cash', currency: 'THB', balance: 0 });
  const walletId = sandbox.__getState().wallets[0].id;

  sandbox.addTransaction({ title: 'Coffee', amount: 4, type: 'expense', walletId, date: '2026-07-20' });
  const txId = sandbox.__getState().transactions[0].id;

  sandbox.deleteTransaction(txId);

  assert.deepStrictEqual(tombstoned(sandbox), [txId]);
});

test('deleteWallet tombstones the wallet AND everything it cascades', () => {
  const sandbox = freshLedger();
  sandbox.addWallet({ name: 'Cash', currency: 'THB', balance: 0 });
  sandbox.addWallet({ name: 'Bank', currency: 'THB', balance: 0 });
  const [cash, bank] = sandbox.__getState().wallets.map((w) => w.id);

  sandbox.addTransaction({ title: 'Coffee', amount: 4, type: 'expense', walletId: cash, date: '2026-07-20' });
  // A transfer INTO the doomed wallet: cascaded on toWalletId, not walletId.
  sandbox.addTransaction({ title: 'Top up', amount: 50, type: 'transfer', walletId: bank, toWalletId: cash, date: '2026-07-20' });
  sandbox.addSchedule({ title: 'Rent', amount: 900, type: 'expense', walletId: cash, frequency: 'monthly', startDate: '2026-07-01', nextDueDate: '2026-08-01' });

  const cascadedIds = sandbox.__getState().transactions.map((t) => t.id)
    .concat(sandbox.__getState().schedules.map((s) => s.id));

  sandbox.deleteWallet(cash);

  assert.deepStrictEqual(tombstoned(sandbox), [cash].concat(cascadedIds).sort(),
    'an untombstoned cascade would be restored as orphans pointing at a dead wallet');
});

test('deleteSchedule tombstones future occurrences but never past history', () => {
  const sandbox = freshLedger();
  sandbox.addWallet({ name: 'Cash', currency: 'THB', balance: 0 });
  const walletId = sandbox.__getState().wallets[0].id;
  sandbox.addSchedule({ title: 'Rent', amount: 900, type: 'expense', walletId, frequency: 'monthly', startDate: '2026-07-01', nextDueDate: '2026-08-01' });
  const schedId = sandbox.__getState().schedules[0].id;

  sandbox.addTransaction({ title: 'Rent (past)', amount: 900, type: 'expense', walletId, date: '2026-07-01', scheduledId: schedId });
  sandbox.addTransaction({ title: 'Rent (future)', amount: 900, type: 'expense', walletId, date: '2026-08-01', scheduledId: schedId });
  const state = sandbox.__getState();
  const pastId = state.transactions.find((t) => t.date === '2026-07-01').id;
  const futureId = state.transactions.find((t) => t.date === '2026-08-01').id;

  sandbox.deleteSchedule(schedId);

  const stones = tombstoned(sandbox);
  assert.ok(stones.includes(schedId));
  assert.ok(stones.includes(futureId), 'the future occurrence was deleted, so it must be tombstoned');
  assert.ok(!stones.includes(pastId), 'past history survives locally — tombstoning it would erase it on other devices');
});

test('deleteCategory tombstones the category and touches the records it rewrites', () => {
  const sandbox = freshLedger();
  sandbox.addWallet({ name: 'Cash', currency: 'THB', balance: 0 });
  const walletId = sandbox.__getState().wallets[0].id;
  sandbox.addCategory({ name: 'Food', type: 'expense' });
  const catId = sandbox.__getState().categories[0].id;
  sandbox.addTransaction({ title: 'Lunch', amount: 12, type: 'expense', walletId, categoryId: catId, date: '2026-07-20' });

  const before = sandbox.__getState().transactions[0].updatedAt;
  sandbox.deleteCategory(catId);
  const after = sandbox.__getState().transactions[0];

  assert.deepStrictEqual(tombstoned(sandbox), [catId]);
  assert.strictEqual(after.categoryId, null);
  assert.ok(after.updatedAt >= before, 'the cleared categoryId is an edit and must be timestamped, or the stale copy wins the merge');
});

test('add and update stamp updatedAt on every collection', () => {
  const sandbox = freshLedger();

  sandbox.addWallet({ name: 'Cash', currency: 'THB', balance: 0 });
  sandbox.addCategory({ name: 'Food', type: 'expense' });
  const walletId = sandbox.__getState().wallets[0].id;
  sandbox.addTransaction({ title: 'Lunch', amount: 12, type: 'expense', walletId, date: '2026-07-20' });
  sandbox.addSchedule({ title: 'Rent', amount: 900, type: 'expense', walletId, frequency: 'monthly', startDate: '2026-07-01', nextDueDate: '2026-08-01' });

  const state = sandbox.__getState();
  ['wallets', 'categories', 'transactions', 'schedules'].forEach((collection) => {
    assert.ok(Number(state[collection][0].updatedAt) > 0, `${collection} records must carry updatedAt`);
  });

  const txId = state.transactions[0].id;
  const originalStamp = state.transactions[0].updatedAt;
  sandbox.updateTransaction(txId, { amount: 99 });
  const updated = sandbox.__getState().transactions[0];

  assert.strictEqual(updated.amount, 99);
  assert.ok(updated.updatedAt >= originalStamp, 'an untouched edit loses to the other device\'s older copy');
});

test('rolling the virtual date back tombstones the future occurrences it drops', () => {
  const sandbox = freshLedger();
  sandbox.addWallet({ name: 'Cash', currency: 'THB', balance: 0 });
  const walletId = sandbox.__getState().wallets[0].id;
  sandbox.addSchedule({ title: 'Rent', amount: 900, type: 'expense', walletId, frequency: 'monthly', startDate: '2026-07-01', nextDueDate: '2026-08-01' });
  const schedId = sandbox.__getState().schedules[0].id;

  sandbox.addTransaction({ title: 'Rent', amount: 900, type: 'expense', walletId, date: '2026-08-01', scheduledId: schedId });
  const futureId = sandbox.__getState().transactions[0].id;

  sandbox.updateVirtualDate('2026-07-01');

  assert.ok(tombstoned(sandbox).includes(futureId),
    'without this, rolling the date back on one device is undone by the next sync');
});

// deepStrictEqual against a literal {} fails here even when the value IS an
// empty object: state built inside the vm has that context's Object.prototype,
// and deepStrictEqual compares prototypes. Asserting on keys sidesteps the
// realm entirely.
test('a fresh ledger starts with an empty tombstone map', () => {
  const sandbox = createSandbox();
  assert.deepStrictEqual(Object.keys(sandbox.__getState().deletions), []);
});

test('a ledger saved before tombstones existed gains an empty map on load', () => {
  const sandbox = createSandbox();
  // A v1 payload: no deletions key, no per-record updatedAt.
  sandbox.localStorage.setItem('midori_ledger_state', JSON.stringify({
    wallets: [{ id: 'w1', name: 'Cash', currency: 'THB', balance: 0 }],
    categories: [],
    transactions: [{ id: 't1', title: 'Old', amount: 5, type: 'expense', walletId: 'w1', date: '2026-01-01' }],
    schedules: [],
    virtualDate: '2026-07-21',
    updatedAt: 1
  }));

  sandbox.loadState();
  const state = sandbox.__getState();

  assert.deepStrictEqual(Object.keys(state.deletions), []);
  assert.strictEqual(state.transactions.length, 1, 'upgrading must not drop existing records');
  assert.strictEqual(state.preferences.cloudRevision, 0, 'never-synced devices must start at revision 0');
});
