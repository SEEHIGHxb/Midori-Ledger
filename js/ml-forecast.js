/**
 * Midori — Premium Finance Ledger App
 * ml-forecast.js: on-device cash-flow projection.
 *
 * Phase 1 baseline: the deterministic backbone (scheduled income/expense from
 * get30DayForecast) plus a learned-from-history discretionary daily-spend
 * estimate, combined into a projected balance path with an uncertainty band.
 * Pure logic (no DOM/Chart) — tested in tests/ml-forecast.test.js.
 *
 * trainDiscretionaryModel() is the seam a real learned model replaces in Phase 2:
 * everything downstream only needs predictDiscretionaryForDay(model, date).
 *
 * Depends on: state.js (MidoriState, convertAmount, CURRENCIES), scheduler.js
 * (get30DayForecast), ml-features.js (series/audit/date helpers, meanStd).
 */

// History window the baseline learns from. 90 days is enough to estimate a
// stable weekday pattern without letting a spending habit from six months ago
// dominate today's rate.
const ML_FORECAST_LOOKBACK_DAYS = 90;

// Net scheduled cash flow per day over the horizon, bucketed from the schedule
// expansion the app already computes (get30DayForecast). Income counts +,
// expense counts -. Returns a Map keyed by 'YYYY-MM-DD'.
function getScheduledDailyTimeline(days) {
  const forecast = get30DayForecast(days);
  const byDay = new Map();
  forecast.events.forEach((evt) => {
    const day = String(evt.date).slice(0, 10);
    const signed = evt.type === 'income' ? evt.amountInBase : -evt.amountInBase;
    byDay.set(day, (byDay.get(day) || 0) + signed);
  });
  return byDay;
}

// Current net worth in base currency — the starting point of the projection.
function getCurrentNetWorth() {
  const baseCurrency = MidoriState.preferences.baseCurrency;
  return (MidoriState.wallets || []).reduce(
    (sum, w) => sum + convertAmount(w.balance, w.currency, baseCurrency),
    0
  );
}

// Feature vector for a calendar date: a weekday one-hot (which lets even a linear
// model learn an arbitrary per-weekday level, so ridge strictly subsumes the
// seasonal baseline), a trend term in months since the training anchor (it
// extrapolates cleanly into the forecast horizon), and a cyclic day-of-month
// pair for within-month structure. Everything a future date needs is derivable
// from the date alone — no lag features, which would require recursively feeding
// predictions back and compounding error over the horizon.
function mlDateFeatures(dateStr, anchorDateStr) {
  const feat = new Array(7).fill(0);
  feat[mlDayOfWeek(dateStr)] = 1;
  const trend = mlDaysBetween(anchorDateStr, dateStr) / 30;
  const dom = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z').getUTCDate();
  feat.push(trend, Math.sin((2 * Math.PI * dom) / 30.44), Math.cos((2 * Math.PI * dom) / 30.44));
  return feat;
}

// Seasonal-mean baseline (the Phase 1 model): per-weekday mean/std with a flat
// overall fallback for weekdays with too few samples. It is both the low-data
// model and the benchmark every learned model has to beat.
function buildSeasonalBaseline(series, audit) {
  const overall = meanStd(series.map((d) => d.amount));
  const byDow = Array.from({ length: 7 }, () => []);
  series.forEach((d) => byDow[mlDayOfWeek(d.date)].push(d.amount));
  const dow = byDow.map((vals) => (vals.length >= 3 ? meanStd(vals) : overall));
  return {
    type: 'seasonal',
    overall,
    dow,
    useSeasonality: audit.sufficiency === ML_SUFFICIENCY.GOOD,
    sufficiency: audit.sufficiency,
    trainedDays: series.length,
  };
}

// The three competing estimators, each a {name, train, predict}. seasonal is the
// per-weekday mean; ridge and mlp come from ml-core. Keeping them behind a
// uniform interface lets selectDiscretionaryModel score them all in one CV loop.
function makeDiscretionaryCandidates(seed) {
  return [
    {
      name: 'seasonal',
      train: (Xtr, ytr, dowTr) => {
        const byDow = Array.from({ length: 7 }, () => []);
        ytr.forEach((v, i) => byDow[dowTr[i]].push(v));
        const overall = meanStd(ytr).mean;
        return { means: byDow.map((vals) => (vals.length ? meanStd(vals).mean : overall)), overall };
      },
      predict: (m, x, dow) => (m.means[dow] != null ? m.means[dow] : m.overall),
    },
    { name: 'ridge', train: (Xtr, ytr) => mlTrainRidge(Xtr, ytr), predict: (m, x) => mlPredictRidge(m, x) },
    { name: 'mlp', train: (Xtr, ytr) => mlTrainMLP(Xtr, ytr, { seed }), predict: (m, x) => mlPredictMLP(m, x) },
  ];
}

// Fit and pick the discretionary-spend model by walk-forward cross-validation.
// A learned model is only chosen when it beats the seasonal baseline's CV error
// by a clear margin (1%); otherwise the simpler, more robust baseline wins — the
// fancy model does not get to win by a rounding error. The returned object
// carries a `cv` report so the UI can show accuracy vs the baseline.
function selectDiscretionaryModel(series, options) {
  const opts = options || {};
  const seed = opts.seed != null ? opts.seed : 12345;
  const anchorDate = series[0].date;
  const X = series.map((d) => mlDateFeatures(d.date, anchorDate));
  const y = series.map((d) => d.amount);
  const dow = series.map((d) => mlDayOfWeek(d.date));

  const splits = mlExpandingSplits(series.length, 4);
  const candidates = makeDiscretionaryCandidates(seed);

  const results = candidates.map((c) => {
    const preds = [];
    const actuals = [];
    splits.forEach((sp) => {
      const model = c.train(sp.trainIdx.map((i) => X[i]), sp.trainIdx.map((i) => y[i]), sp.trainIdx.map((i) => dow[i]));
      sp.testIdx.forEach((i) => {
        preds.push(Math.max(0, c.predict(model, X[i], dow[i])));
        actuals.push(y[i]);
      });
    });
    return { name: c.name, mae: mlMae(actuals, preds), rmse: mlRmse(actuals, preds) };
  });

  const baselineMae = results.find((r) => r.name === 'seasonal').mae;
  let best = results.reduce((a, b) => (b.mae < a.mae ? b : a));
  if (best.name !== 'seasonal' && best.mae > baselineMae * 0.99) {
    best = results.find((r) => r.name === 'seasonal');
  }
  const cv = { winner: best.name, baselineMae, results };

  if (best.name === 'seasonal') {
    const baseline = buildSeasonalBaseline(series, { sufficiency: ML_SUFFICIENCY.GOOD });
    baseline.cv = cv;
    return baseline;
  }

  // Retrain the winner on the full window for deployment, and measure its
  // in-sample residual spread to size the projection's uncertainty band.
  const winner = candidates.find((c) => c.name === best.name);
  const params = winner.train(X, y, dow);
  const residuals = X.map((x, i) => y[i] - winner.predict(params, x, dow[i]));
  return {
    type: best.name,
    params,
    anchorDate,
    residualStd: meanStd(residuals).std,
    sufficiency: ML_SUFFICIENCY.GOOD,
    trainedDays: series.length,
    cv,
  };
}

// Fit the discretionary model for the current ledger. Below 'good' sufficiency
// walk-forward CV is unreliable, so the robust seasonal-mean baseline is used
// rather than overfitting a learned model to a handful of days; at 'good' the
// CV picks the best of seasonal / ridge / MLP.
function trainDiscretionaryModel(options) {
  const opts = options || {};
  const baseCurrency = MidoriState.preferences.baseCurrency;
  const endDate = MidoriState.virtualDate;
  const lookback = opts.lookbackDays || ML_FORECAST_LOOKBACK_DAYS;
  const series = getDiscretionaryDailySeries(MidoriState.transactions, baseCurrency, endDate, lookback);
  const audit = auditLedgerData(MidoriState);

  if (audit.sufficiency !== ML_SUFFICIENCY.GOOD) {
    return buildSeasonalBaseline(series, audit);
  }
  return selectDiscretionaryModel(series, { seed: opts.seed });
}

// Predicted discretionary spend for one calendar day: {mean, std}. A learned
// model is evaluated through its date-features; the seasonal baseline reads its
// weekday (or overall) bucket. Spend can't be negative, so the mean is clamped.
function predictDiscretionaryForDay(model, dateStr) {
  if (model.type === 'ridge' || model.type === 'mlp') {
    const x = mlDateFeatures(dateStr, model.anchorDate);
    const raw = model.type === 'ridge' ? mlPredictRidge(model.params, x) : mlPredictMLP(model.params, x);
    return { mean: Math.max(0, raw), std: model.residualStd };
  }
  if (model.useSeasonality) return model.dow[mlDayOfWeek(dateStr)];
  return model.overall;
}

// Full projection over `days`. Each future day carries the balance forward with
// scheduled net flow minus predicted discretionary spend. The band widens with
// the square root of accumulated daily variance (an independent-day
// approximation) at ~80% (z = 1.28). Returns { sufficiency, audit, startBalance,
// points: [{date, balance, lower, upper}] }; points is empty when there is too
// little data to say anything.
function projectBalance(days, options) {
  const opts = options || {};
  const horizon = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  const audit = auditLedgerData(MidoriState);
  const startBalance = getCurrentNetWorth();

  if (audit.sufficiency === ML_SUFFICIENCY.NONE) {
    return { sufficiency: ML_SUFFICIENCY.NONE, audit, startBalance: Math.round(startBalance), points: [] };
  }

  const scheduled = getScheduledDailyTimeline(horizon);
  const model = trainDiscretionaryModel({ lookbackDays: opts.lookbackDays });
  const startStr = MidoriState.virtualDate;

  let balance = startBalance;
  let variance = 0;
  const points = [];
  for (let i = 1; i <= horizon; i++) {
    const day = mlAddDays(startStr, i);
    const spend = predictDiscretionaryForDay(model, day);
    balance += (scheduled.get(day) || 0) - spend.mean;
    variance += spend.std * spend.std;
    const band = 1.28 * Math.sqrt(variance);
    points.push({
      date: day,
      balance: Math.round(balance),
      lower: Math.round(balance - band),
      upper: Math.round(balance + band),
    });
  }

  return {
    sufficiency: audit.sufficiency,
    audit,
    model,
    startBalance: Math.round(startBalance),
    points,
  };
}
