/**
 * Regression tests for getTxCurrency().
 *
 * The dashboard, budget and tag aggregations used to read wallet.currency
 * directly, ignoring tx.currency. A USD 100 expense recorded against a JPY
 * wallet was therefore counted as JPY 100 in every analytic — a 156x
 * understatement — while the ledger row and wallet balance showed it correctly.
 * These tests pin the single resolution helper all those paths now share.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

function sandboxWithWallets() {
  const sandbox = createSandbox();
  sandbox.__setState({
    wallets: [
      { id: 'w_jpy', name: 'JP Bank', currency: 'JPY', openingBalance: 0, balance: 0, color: '#000' },
      { id: 'w_thb', name: 'SCB', currency: 'THB', openingBalance: 0, balance: 0, color: '#000' },
    ],
    categories: [],
    transactions: [],
    schedules: [],
    preferences: { theme: 'dark', baseCurrency: 'JPY', autoSyncDeviceDate: false, syncEnabled: false, syncId: null, syncKey: null, lastSyncedAt: 0 },
    virtualDate: '2026-05-20',
    updatedAt: 0,
    fxRatesCache: null,
  });
  return sandbox;
}

test('getTxCurrency prefers the transaction currency over the wallet currency', () => {
  const sandbox = sandboxWithWallets();
  const tx = { amount: 100, walletId: 'w_jpy', currency: 'USD' };
  assert.strictEqual(sandbox.getTxCurrency(tx, 'JPY'), 'USD');
});

test('getTxCurrency falls back to the wallet currency when the tx has none', () => {
  const sandbox = sandboxWithWallets();
  const tx = { amount: 100, walletId: 'w_thb' };
  assert.strictEqual(sandbox.getTxCurrency(tx, 'JPY'), 'THB');
});

test('getTxCurrency falls back to the supplied base currency for an unknown wallet', () => {
  const sandbox = sandboxWithWallets();
  const tx = { amount: 100, walletId: 'w_deleted' };
  assert.strictEqual(sandbox.getTxCurrency(tx, 'EUR'), 'EUR');
});

test('a foreign-currency tx converts to the same figure the balance engine uses', () => {
  const sandbox = sandboxWithWallets();
  const state = sandbox.__getState();
  state.transactions = [{
    id: 't1', title: 'Hotel abroad', amount: 100, type: 'expense',
    walletId: 'w_jpy', categoryId: null, currency: 'USD',
    date: '2026-05-10', note: '', scheduledId: null,
  }];
  sandbox.__setState(state);

  // What the balance engine deducts from the wallet.
  sandbox.recalculateWalletBalances();
  const deducted = -sandbox.__getState().wallets.find(w => w.id === 'w_jpy').balance;

  // What every analytics path now computes.
  const tx = sandbox.__getState().transactions[0];
  const analytic = sandbox.convertAmount(tx.amount, sandbox.getTxCurrency(tx, 'JPY'), 'JPY');

  assert.ok(Math.abs(analytic - deducted) < 1e-6,
    `analytics (${analytic}) must agree with the balance engine (${deducted})`);
  // And it must NOT be the old buggy value of a bare 100.
  assert.notStrictEqual(Math.round(analytic), 100);
});
