/**
 * Midori — Premium Finance Ledger App
 * ml-core.js: a small, dependency-free machine-learning toolkit — feature
 * standardisation, ridge regression and a one-hidden-layer MLP (both trained by
 * gradient descent / backprop), error metrics, and leakage-free walk-forward
 * splits. ml-forecast.js uses these to fit and select the discretionary-spend
 * model on the user's own data.
 *
 * Pure numeric logic (no DOM, no network) — every function is unit tested in the
 * vm sandbox (tests/ml-core.test.js). Uses mulberry32 and meanStd from
 * ml-features.js at runtime, so that file must load first.
 */

// Fit per-column mean/std for standardisation; std is clamped away from 0 so a
// constant feature (e.g. a one-hot weekday absent from a fold) never divides by
// zero and simply contributes nothing after centring.
function mlStandardizeFit(X) {
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  X.forEach((row) => row.forEach((v, j) => (mean[j] += v)));
  for (let j = 0; j < d; j++) mean[j] /= X.length;
  X.forEach((row) => row.forEach((v, j) => (std[j] += (v - mean[j]) * (v - mean[j]))));
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / X.length);
  return { mean, std };
}

function mlStandardizeRow(row, s) {
  return row.map((v, j) => (v - s.mean[j]) / (s.std[j] < 1e-9 ? 1 : s.std[j]));
}

function mlStandardizeApply(X, s) {
  return X.map((row) => mlStandardizeRow(row, s));
}

// Ridge (L2-regularised linear) regression by batch gradient descent. Features
// and target are standardised so a single learning rate behaves across columns;
// the scalers are stored so mlPredictRidge can invert them. Weights start at 0 —
// the objective is convex, so ridge needs no random seed and is deterministic.
function mlTrainRidge(X, y, options) {
  const opts = options || {};
  const l2 = opts.l2 != null ? opts.l2 : 0.1;
  const lr = opts.lr != null ? opts.lr : 0.1;
  const epochs = opts.epochs != null ? opts.epochs : 500;
  const n = X.length;
  const d = X[0].length;

  const xs = mlStandardizeFit(X);
  const Xs = mlStandardizeApply(X, xs);
  const ys = meanStd(y);
  const yStd = ys.std < 1e-9 ? 1 : ys.std;
  const yn = y.map((v) => (v - ys.mean) / yStd);

  const w = new Array(d).fill(0);
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let pred = b;
      for (let j = 0; j < d; j++) pred += w[j] * Xs[i][j];
      const err = pred - yn[i];
      for (let j = 0; j < d; j++) gw[j] += err * Xs[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b, xs, yMean: ys.mean, yStd };
}

function mlPredictRidge(model, x) {
  const xn = mlStandardizeRow(x, model.xs);
  let pred = model.b;
  for (let j = 0; j < xn.length; j++) pred += model.w[j] * xn[j];
  return pred * model.yStd + model.yMean;
}

// One-hidden-layer MLP (tanh activation, linear output) trained by full-batch
// backprop on standardised data. Weights are initialised from the seeded PRNG so
// training is reproducible — the reason ml-features.js uses mulberry32 rather
// than crypto. The 2/n factor of the MSE gradient is folded into the learning
// rate.
function mlTrainMLP(X, y, options) {
  const opts = options || {};
  const hidden = opts.hidden || 6;
  const lr = opts.lr != null ? opts.lr : 0.05;
  const epochs = opts.epochs != null ? opts.epochs : 600;
  const l2 = opts.l2 != null ? opts.l2 : 0.001;
  const seed = opts.seed != null ? opts.seed : 12345;
  const n = X.length;
  const d = X[0].length;

  const xs = mlStandardizeFit(X);
  const Xs = mlStandardizeApply(X, xs);
  const ys = meanStd(y);
  const yStd = ys.std < 1e-9 ? 1 : ys.std;
  const yn = y.map((v) => (v - ys.mean) / yStd);

  const rand = mulberry32(seed);
  const scale = 1 / Math.sqrt(d);
  const W1 = Array.from({ length: hidden }, () => Array.from({ length: d }, () => (rand() * 2 - 1) * scale));
  const b1 = new Array(hidden).fill(0);
  const W2 = Array.from({ length: hidden }, () => (rand() * 2 - 1) * scale);
  let b2 = 0;

  for (let e = 0; e < epochs; e++) {
    const gW1 = Array.from({ length: hidden }, () => new Array(d).fill(0));
    const gb1 = new Array(hidden).fill(0);
    const gW2 = new Array(hidden).fill(0);
    let gb2 = 0;

    for (let i = 0; i < n; i++) {
      const h = new Array(hidden);
      let pred = b2;
      for (let k = 0; k < hidden; k++) {
        let s = b1[k];
        for (let j = 0; j < d; j++) s += W1[k][j] * Xs[i][j];
        h[k] = Math.tanh(s);
        pred += W2[k] * h[k];
      }
      const err = pred - yn[i];
      gb2 += err;
      for (let k = 0; k < hidden; k++) {
        gW2[k] += err * h[k];
        const dh = err * W2[k] * (1 - h[k] * h[k]); // tanh'
        gb1[k] += dh;
        for (let j = 0; j < d; j++) gW1[k][j] += dh * Xs[i][j];
      }
    }

    b2 -= lr * (gb2 / n);
    for (let k = 0; k < hidden; k++) {
      W2[k] -= lr * (gW2[k] / n + l2 * W2[k]);
      b1[k] -= lr * (gb1[k] / n);
      for (let j = 0; j < d; j++) W1[k][j] -= lr * (gW1[k][j] / n + l2 * W1[k][j]);
    }
  }
  return { W1, b1, W2, b2, xs, yMean: ys.mean, yStd, hidden };
}

function mlPredictMLP(model, x) {
  const xn = mlStandardizeRow(x, model.xs);
  let pred = model.b2;
  for (let k = 0; k < model.hidden; k++) {
    let s = model.b1[k];
    for (let j = 0; j < xn.length; j++) s += model.W1[k][j] * xn[j];
    pred += model.W2[k] * Math.tanh(s);
  }
  return pred * model.yStd + model.yMean;
}

// --- Metrics ----------------------------------------------------------------
function mlMae(yTrue, yPred) {
  if (!yTrue.length) return 0;
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) s += Math.abs(yTrue[i] - yPred[i]);
  return s / yTrue.length;
}

function mlRmse(yTrue, yPred) {
  if (!yTrue.length) return 0;
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const e = yTrue[i] - yPred[i];
    s += e * e;
  }
  return Math.sqrt(s / yTrue.length);
}

// Expanding-window (walk-forward) splits for time-ordered data: fold f trains on
// [0, cut_f) and tests on the block immediately after. Every test index is
// strictly greater than every train index in its fold, so no future information
// can leak into training — the invariant a random k-fold split violates on a
// time series, silently inflating accuracy.
function mlExpandingSplits(n, folds) {
  const k = Math.max(1, folds || 4);
  const minTrain = Math.max(7, Math.floor(n * 0.4));
  const testSize = Math.max(1, Math.floor((n - minTrain) / k));
  const splits = [];
  let start = minTrain;
  while (start < n && splits.length < k) {
    const end = Math.min(n, start + testSize);
    const trainIdx = [];
    for (let i = 0; i < start; i++) trainIdx.push(i);
    const testIdx = [];
    for (let i = start; i < end; i++) testIdx.push(i);
    if (testIdx.length) splits.push({ trainIdx, testIdx });
    start = end;
  }
  return splits;
}
