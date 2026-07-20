/**
 * Regression tests for scheduler loop safety and deletion cascades.
 *
 * Pinned here:
 *  1. An unadvanceable frequency (anything outside VALID_FREQUENCIES) used to
 *     make getNextOccurrenceDate a fixed point, so processSchedules looped
 *     forever pushing transactions — ~104MB in 5s before the process died.
 *  2. deleteWallet skipped recalculateWalletBalances and ignored toWalletId,
 *     so transfers into a deleted wallet silently destroyed money and other
 *     wallets kept stale balances until an unrelated action recalculated.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

function baseState() {
  return {
    wallets: [
      { id: 'wA', name: 'Wallet A', currency: 'JPY', openingBalance: 100000, balance: 0, color: '#000' },
      { id: 'wB', name: 'Wallet B', currency: 'JPY', openingBalance: 0, balance: 0, color: '#000' },
    ],
    categories: [
      { id: 'c1', name: 'Rent', type: 'expense', color: '#000', icon: 'home', budget: null, yearlyBudget: null, includeInBudget: true },
    ],
    transactions: [
      { id: 't1', title: 'A -> B transfer', amount: 50000, type: 'transfer',
        walletId: 'wA', toWalletId: 'wB', categoryId: null, currency: 'JPY',
        date: '2026-05-10', note: '', scheduledId: null },
    ],
    schedules: [
      { id: 's1', title: 'Rent from A', amount: 1000, type: 'expense', walletId: 'wA',
        categoryId: 'c1', frequency: 'monthly', startDate: '2026-05-01',
        nextDueDate: '2026-06-01', active: true },
    ],
    preferences: { theme: 'dark', baseCurrency: 'JPY', autoSyncDeviceDate: false, syncEnabled: false, syncId: null, syncKey: null, lastSyncedAt: 0 },
    virtualDate: '2026-05-20',
    updatedAt: 0,
    fxRatesCache: null,
  };
}

test('isValidFrequency accepts only the four advanceable frequencies', () => {
  const sandbox = createSandbox();
  ['daily', 'weekly', 'monthly', 'yearly'].forEach(f => assert.ok(sandbox.isValidFrequency(f), f));
  ['fortnightly', 'hourly', '', null, undefined, 'MONTHLY'].forEach(f =>
    assert.ok(!sandbox.isValidFrequency(f), `${String(f)} must be rejected`));
});

test('processSchedules terminates on an unadvanceable frequency instead of looping', () => {
  const sandbox = createSandbox();
  const state = baseState();
  state.schedules[0].frequency = 'fortnightly';
  state.schedules[0].nextDueDate = '2026-05-01';
  sandbox.__setState(state);

  // Before the fix this never returned.
  sandbox.processSchedules('2026-05-20');

  const after = sandbox.__getState();
  assert.strictEqual(after.schedules[0].active, false, 'the bad schedule must be deactivated');
  assert.ok(after.transactions.length < 10, `expected no transaction flood, got ${after.transactions.length}`);
});

test('a corrupted frequency is rejected at import instead of being stored', () => {
  const sandbox = createSandbox();
  const backup = baseState();
  backup.schedules[0].frequency = 'fortnightly';
  assert.strictEqual(sandbox.isValidStateShape(backup), false);
  assert.strictEqual(sandbox.importStateJSON(JSON.stringify(backup)), false);
});

test('a well-formed backup still imports', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.importStateJSON(JSON.stringify(baseState())), true);
});

test('get30DayForecast skips schedules it cannot advance', () => {
  const sandbox = createSandbox();
  const state = baseState();
  state.schedules[0].frequency = 'fortnightly';
  sandbox.__setState(state);

  // Compared by length, not deepStrictEqual: the array is constructed inside
  // the vm realm, so its prototype is not reference-equal to the host Array.
  const forecast = sandbox.get30DayForecast();
  assert.strictEqual(forecast.events.length, 0);
  assert.strictEqual(forecast.totalExpense, 0);
});

test('deleteWallet recalculates balances immediately', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState());
  sandbox.recalculateWalletBalances();

  sandbox.deleteWallet('wA');
  const bAfterDelete = sandbox.__getState().wallets.find(w => w.id === 'wB').balance;

  // A later, unrelated recalculation must not move the number.
  sandbox.recalculateWalletBalances();
  const bLater = sandbox.__getState().wallets.find(w => w.id === 'wB').balance;

  assert.strictEqual(bAfterDelete, bLater, 'balance changed on a later unrelated action');
  assert.strictEqual(bAfterDelete, 0, 'the transfer credit should be gone with its source wallet');
});

test('deleteWallet removes transfers pointing at the deleted wallet', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState());
  sandbox.recalculateWalletBalances();

  sandbox.deleteWallet('wB'); // the transfer DESTINATION

  const after = sandbox.__getState();
  assert.strictEqual(after.transactions.filter(t => t.toWalletId === 'wB').length, 0,
    'a transfer to a deleted wallet must not survive');
  // Wallet A keeps its full opening balance: the orphaned debit is gone too.
  assert.strictEqual(after.wallets.find(w => w.id === 'wA').balance, 100000,
    'money must not vanish when the transfer destination is deleted');
});

test('deleteWallet removes schedules that would fire into the deleted wallet', () => {
  const sandbox = createSandbox();
  sandbox.__setState(baseState());
  sandbox.deleteWallet('wA');
  assert.strictEqual(sandbox.__getState().schedules.filter(s => s.walletId === 'wA').length, 0);
});

test('deleteCategory clears dangling references and parks its schedules', () => {
  const sandbox = createSandbox();
  const state = baseState();
  state.transactions.push({
    id: 't2', title: 'Rent', amount: 1000, type: 'expense', walletId: 'wA',
    categoryId: 'c1', currency: 'JPY', date: '2026-05-11', note: '', scheduledId: null,
  });
  sandbox.__setState(state);

  sandbox.deleteCategory('c1');

  const after = sandbox.__getState();
  assert.strictEqual(after.transactions.find(t => t.id === 't2').categoryId, null,
    'transaction should become uncategorised, not keep a dead id');
  assert.strictEqual(after.schedules[0].categoryId, null);
  assert.strictEqual(after.schedules[0].active, false,
    'a schedule must not keep minting transactions for a deleted category');
});
