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

// "Train" the discretionary model. For the Phase 1 baseline this fits a mean and
// spread of daily spend over the lookback window, plus a per-weekday mean/std
// when there is enough history to estimate seasonality (sufficiency 'good').
// The returned object is the model's parameters — the same shape a learned model
// will produce so predictDiscretionaryForDay() never has to change.
function trainDiscretionaryModel(options) {
  const opts = options || {};
  const baseCurrency = MidoriState.preferences.baseCurrency;
  const endDate = MidoriState.virtualDate;
  const lookback = opts.lookbackDays || ML_FORECAST_LOOKBACK_DAYS;

  const series = getDiscretionaryDailySeries(MidoriState.transactions, baseCurrency, endDate, lookback);
  const overall = meanStd(series.map((d) => d.amount));

  const byDow = Array.from({ length: 7 }, () => []);
  series.forEach((d) => {
    byDow[mlDayOfWeek(d.date)].push(d.amount);
  });

  const audit = auditLedgerData(MidoriState);
  const useSeasonality = audit.sufficiency === ML_SUFFICIENCY.GOOD;
  // Fall back to the overall estimate for any weekday with too few samples to
  // be meaningful on its own.
  const dow = byDow.map((vals) => (vals.length >= 3 ? meanStd(vals) : overall));

  return {
    overall,
    dow,
    useSeasonality,
    sufficiency: audit.sufficiency,
    lookbackDays: lookback,
    trainedDays: series.length,
  };
}

// Predicted discretionary spend for one calendar day: {mean, std}.
function predictDiscretionaryForDay(model, dateStr) {
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
