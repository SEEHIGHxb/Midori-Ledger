/**
 * Phase 2 tests for the hand-rolled ML toolkit in js/ml-core.js: standardisation,
 * ridge regression recovering a linear signal, the MLP beating ridge on a
 * nonlinear interaction (the whole reason to have it), the leakage-free
 * walk-forward splits, the error metrics, and reproducible training.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

// Deterministic (x0, x1) -> y data using the sandbox's seeded PRNG.
function makeData(s, n, fn, seed) {
  const rnd = s.mulberry32(seed);
  const X = [];
  const y = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * 4 - 2;
    const b = rnd() * 4 - 2;
    X.push([a, b]);
    y.push(fn(a, b));
  }
  return { X, y };
}

test('mlStandardizeFit/Apply centre and scale each column', () => {
  const s = createSandbox();
  const X = [[0, 10], [2, 20], [4, 30]];
  const fit = s.mlStandardizeFit(X);
  assert.ok(Math.abs(fit.mean[0] - 2) < 1e-12);
  assert.ok(Math.abs(fit.mean[1] - 20) < 1e-12);
  const applied = s.mlStandardizeApply(X, fit);
  const col0 = applied.map((r) => r[0]);
  assert.ok(Math.abs(col0[0] + col0[1] + col0[2]) < 1e-9); // centred -> sums to ~0
});

test('mlTrainRidge recovers a known linear relationship on held-out data', () => {
  const s = createSandbox();
  const { X, y } = makeData(s, 120, (a, b) => 3 * a - 2 * b + 5, 11);
  const model = s.mlTrainRidge(X.slice(0, 100), y.slice(0, 100), { l2: 0.01, lr: 0.1, epochs: 2000 });
  const preds = X.slice(100).map((x) => s.mlPredictRidge(model, x));
  assert.ok(s.mlMae(y.slice(100), preds) < 1.0);
});

test('mlTrainMLP beats ridge on a nonlinear interaction target', () => {
  const s = createSandbox();
  const { X, y } = makeData(s, 160, (a, b) => a * b, 21); // product: not linearly separable
  const Xtr = X.slice(0, 130);
  const ytr = y.slice(0, 130);
  const Xte = X.slice(130);
  const yte = y.slice(130);

  const ridge = s.mlTrainRidge(Xtr, ytr, { l2: 0.01, epochs: 1500 });
  const mlp = s.mlTrainMLP(Xtr, ytr, { hidden: 8, epochs: 2000, lr: 0.05, seed: 5 });
  const ridgeMae = s.mlMae(yte, Xte.map((x) => s.mlPredictRidge(ridge, x)));
  const mlpMae = s.mlMae(yte, Xte.map((x) => s.mlPredictMLP(mlp, x)));

  assert.ok(Number.isFinite(mlpMae) && Number.isFinite(ridgeMae));
  assert.ok(mlpMae < ridgeMae, `mlp (${mlpMae.toFixed(3)}) should beat ridge (${ridgeMae.toFixed(3)})`);
});

test('mlExpandingSplits never lets a test index precede a train index (no leakage)', () => {
  const s = createSandbox();
  const splits = s.mlExpandingSplits(20, 4);
  assert.ok(splits.length >= 2);
  splits.forEach((sp) => {
    assert.ok(Math.max(...sp.trainIdx) < Math.min(...sp.testIdx));
  });
});

test('mlMae and mlRmse compute known values', () => {
  const s = createSandbox();
  assert.strictEqual(s.mlMae([1, 2, 3], [1, 2, 3]), 0);
  assert.ok(Math.abs(s.mlMae([0, 0], [1, 3]) - 2) < 1e-12);
  assert.ok(Math.abs(s.mlRmse([0, 0], [3, 4]) - Math.sqrt(12.5)) < 1e-12);
});

test('mlTrainMLP is reproducible for a fixed seed', () => {
  const s = createSandbox();
  const { X, y } = makeData(s, 40, (a, b) => a + b, 3);
  const m1 = s.mlTrainMLP(X, y, { seed: 77, epochs: 150 });
  const m2 = s.mlTrainMLP(X, y, { seed: 77, epochs: 150 });
  assert.strictEqual(s.mlPredictMLP(m1, [1, 1]), s.mlPredictMLP(m2, [1, 1]));
});
