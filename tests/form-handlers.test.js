const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFormSandbox } = require('./helpers/form-sandbox');

function fakeEvent() {
  return { preventDefault: () => {} };
}

function seedScheduleState(sandbox) {
  const state = {
    wallets: [{ id: 'w1', name: 'Cash', currency: 'JPY', balance: 0, openingBalance: 0 }],
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    transactions: [],
    schedules: [{
      id: 's1',
      title: 'Rent',
      amount: 1000,
      type: 'expense',
      walletId: 'w1',
      categoryId: 'c1',
      frequency: 'monthly',
      startDate: '2026-01-01',
      nextDueDate: '2026-05-01',
      endDate: null,
      active: true,
    }],
    virtualDate: '2026-06-24',
    preferences: { baseCurrency: 'JPY' },
  };
  sandbox.__setState(state);
  return state;
}

function fillScheduleEditForm(sandbox, overrides) {
  const fields = {
    editSchedId: 's1',
    editSchedTitle: 'Rent',
    editSchedAmount: '1000',
    editSchedType: 'expense',
    editSchedWallet: 'w1',
    editSchedCategory: 'c1',
    editSchedFrequency: 'monthly',
    editSchedStartDate: '2026-01-01',
    editSchedEndDate: '',
    ...overrides,
  };
  Object.entries(fields).forEach(([id, value]) => {
    sandbox.document.getElementById(id).value = value;
  });
}

test('editing a schedule without changing startDate preserves nextDueDate', () => {
  const { sandbox } = createFormSandbox();
  seedScheduleState(sandbox);
  fillScheduleEditForm(sandbox, { editSchedTitle: 'Rent (renamed)' });

  sandbox.submitEditScheduleForm(fakeEvent());

  const updated = sandbox.__getState().schedules.find((s) => s.id === 's1');
  assert.strictEqual(updated.title, 'Rent (renamed)');
  assert.strictEqual(updated.nextDueDate, '2026-05-01');
});

test('editing a schedule with a changed startDate resets nextDueDate to match', () => {
  const { sandbox } = createFormSandbox();
  seedScheduleState(sandbox);
  fillScheduleEditForm(sandbox, { editSchedStartDate: '2026-07-01' });

  sandbox.submitEditScheduleForm(fakeEvent());

  const updated = sandbox.__getState().schedules.find((s) => s.id === 's1');
  assert.strictEqual(updated.startDate, '2026-07-01');
  assert.strictEqual(updated.nextDueDate, '2026-07-01');
});

function seedWalletState(sandbox, walletOverrides) {
  const state = {
    wallets: [{ id: 'w1', name: 'Legacy Wallet', currency: 'JPY', balance: 99999, ...walletOverrides }],
    categories: [],
    transactions: [],
    schedules: [],
    virtualDate: '2026-06-24',
    preferences: { baseCurrency: 'JPY' },
  };
  sandbox.__setState(state);
  return state;
}

test('opening the edit modal for a wallet missing openingBalance defaults the field to 0, not the live balance', () => {
  const { sandbox } = createFormSandbox();
  seedWalletState(sandbox, { openingBalance: undefined });

  sandbox.openEditWalletModal('w1');

  assert.strictEqual(sandbox.document.getElementById('editWalletBalance').value, 0);
});

test('opening the edit modal for a wallet with an explicit openingBalance uses that value', () => {
  const { sandbox } = createFormSandbox();
  seedWalletState(sandbox, { openingBalance: 500 });

  sandbox.openEditWalletModal('w1');

  assert.strictEqual(sandbox.document.getElementById('editWalletBalance').value, 500);
});

test('changing a wallet currency on edit converts openingBalance into the new currency', () => {
  const { sandbox } = createFormSandbox();
  seedWalletState(sandbox, { openingBalance: 100000 });

  sandbox.document.getElementById('editWalletId').value = 'w1';
  sandbox.document.getElementById('editWalletName').value = 'Legacy Wallet';
  sandbox.document.getElementById('editWalletType').value = 'cash';
  sandbox.document.getElementById('editWalletCurrency').value = 'USD';
  sandbox.document.getElementById('editWalletBalance').value = '100000';

  sandbox.submitEditWalletForm(fakeEvent());

  const updated = sandbox.__getState().wallets.find((w) => w.id === 'w1');
  const expected = sandbox.convertAmount(100000, 'JPY', 'USD');
  assert.strictEqual(updated.currency, 'USD');
  assert.strictEqual(updated.openingBalance, expected);
  assert.notStrictEqual(updated.openingBalance, 100000);
});

test('editing a wallet without changing currency leaves openingBalance unconverted', () => {
  const { sandbox } = createFormSandbox();
  seedWalletState(sandbox, { openingBalance: 500, currency: 'USD' });

  sandbox.document.getElementById('editWalletId').value = 'w1';
  sandbox.document.getElementById('editWalletName').value = 'Legacy Wallet';
  sandbox.document.getElementById('editWalletType').value = 'cash';
  sandbox.document.getElementById('editWalletCurrency').value = 'USD';
  sandbox.document.getElementById('editWalletBalance').value = '750';

  sandbox.submitEditWalletForm(fakeEvent());

  const updated = sandbox.__getState().wallets.find((w) => w.id === 'w1');
  assert.strictEqual(updated.openingBalance, 750);
});

test('reopening a modal hides a stale form-error left over from a previous attempt', () => {
  const { sandbox } = createFormSandbox();
  seedScheduleState(sandbox);

  const modal = sandbox.document.getElementById('modalEditSchedule');
  const errorEl = sandbox.document.createElement('p');
  errorEl.className = 'form-error';
  errorEl.style.display = 'block';
  modal.appendChild(errorEl);

  sandbox.openModal('modalEditSchedule');

  assert.strictEqual(errorEl.style.display, 'none');
});
