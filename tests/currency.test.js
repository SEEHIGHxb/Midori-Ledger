const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

test('convertAmount returns the same amount when currencies match', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.convertAmount(100, 'USD', 'USD'), 100);
});

test('convertAmount converts via the USD-relative rate table', () => {
  const sandbox = createSandbox();
  const currencies = sandbox.__getCurrencies();
  const expected = (100 / currencies.USD.rate) * currencies.THB.rate;
  assert.strictEqual(sandbox.convertAmount(100, 'USD', 'THB'), expected);
});

test('convertAmount round-trips between two non-USD currencies', () => {
  const sandbox = createSandbox();
  const converted = sandbox.convertAmount(1000, 'JPY', 'EUR');
  const roundTripped = sandbox.convertAmount(converted, 'EUR', 'JPY');
  assert.ok(Math.abs(roundTripped - 1000) < 1e-9);
});

test('formatCurrency uses 2 decimal places and the currency symbol by default', () => {
  const sandbox = createSandbox();
  const expected = '$' + Number(1234.5).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  assert.strictEqual(sandbox.formatCurrency(1234.5, 'USD'), expected);
});

test('formatCurrency uses 0 decimal places for JPY', () => {
  const sandbox = createSandbox();
  const expected = '¥' + Number(1500).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  assert.strictEqual(sandbox.formatCurrency(1500, 'JPY'), expected);
});

test('formatCurrency falls back to USD for an unknown currency code', () => {
  const sandbox = createSandbox();
  const expected = '$' + Number(10).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  assert.strictEqual(sandbox.formatCurrency(10, 'XXX'), expected);
});
