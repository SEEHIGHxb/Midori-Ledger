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
