const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

test('validateAmount accepts positive finite numbers and numeric strings', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.validateAmount(100), true);
  assert.strictEqual(sandbox.validateAmount('100'), true);
  assert.strictEqual(sandbox.validateAmount('0.01'), true);
});

test('validateAmount rejects zero, negatives, NaN and non-numeric input', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.validateAmount(0), false);
  assert.strictEqual(sandbox.validateAmount('0'), false);
  assert.strictEqual(sandbox.validateAmount(-5), false);
  assert.strictEqual(sandbox.validateAmount('abc'), false);
  assert.strictEqual(sandbox.validateAmount(''), false);
  assert.strictEqual(sandbox.validateAmount(Infinity), false);
});

test('validateRequiredText accepts non-empty strings after trimming', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.validateRequiredText('Groceries'), true);
  assert.strictEqual(sandbox.validateRequiredText('  Rent  '), true);
});

test('validateRequiredText rejects empty, whitespace-only, or non-string input', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.validateRequiredText(''), false);
  assert.strictEqual(sandbox.validateRequiredText('   '), false);
  assert.strictEqual(sandbox.validateRequiredText(123), false);
  assert.strictEqual(sandbox.validateRequiredText(null), false);
  assert.strictEqual(sandbox.validateRequiredText(undefined), false);
});

function validBackup() {
  return {
    wallets: [{ id: 'w1', name: 'Cash', currency: 'JPY' }],
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    transactions: [{ id: 't1', title: 'Lunch', amount: 10, type: 'expense', walletId: 'w1', date: '2026-01-01' }],
    schedules: [{ id: 's1', title: 'Rent', amount: 100, type: 'expense', walletId: 'w1', frequency: 'monthly', startDate: '2026-01-01', nextDueDate: '2026-02-01' }],
  };
}

test('isValidStateShape accepts a well-formed backup', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.isValidStateShape(validBackup()), true);
});

test('isValidStateShape rejects a schedule missing nextDueDate', () => {
  const sandbox = createSandbox();
  const backup = validBackup();
  delete backup.schedules[0].nextDueDate;
  assert.strictEqual(sandbox.isValidStateShape(backup), false);
});

test('isValidStateShape rejects non-array fields and missing required item fields', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.isValidStateShape({ ...validBackup(), wallets: 'not-an-array' }), false);
  const missingWalletField = validBackup();
  delete missingWalletField.wallets[0].currency;
  assert.strictEqual(sandbox.isValidStateShape(missingWalletField), false);
});
