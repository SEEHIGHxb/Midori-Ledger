/**
 * Midori — Premium Finance Ledger App
 * ml-features.js: data audit, feature engineering, and a synthetic ledger
 * generator that feed the on-device cash-flow model (see ml-forecast.js).
 *
 * Pure logic only — no DOM, no Chart.js — so every function here is unit tested
 * in the vm sandbox (tests/ml-features.test.js) exactly as the browser loads it.
 * Depends on state.js globals: MidoriState, convertAmount, getTxCurrency.
 */

// Seedable PRNG (mulberry32). crypto.getRandomValues — used elsewhere for record
// IDs and sync keys — is deliberately NOT reused here: the synthetic generator
// and (in Phase 2) model-weight initialisation must be reproducible so training
// and tests are deterministic. Same seed -> same stream, in the browser and node.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Date helpers (UTC, timezone-independent) -------------------------------
// tx.date and virtualDate are 'YYYY-MM-DD'. Day stepping is done in UTC so a
// test (or a user) in any timezone enumerates the same calendar days; doing it
// with local getDate()/setDate() would shift the window by a day either side of
// UTC and silently misalign transactions with their buckets.
function mlToDateStr(date) {
  return date.toISOString().slice(0, 10);
}
function mlAddDays(dateStr, n) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return mlToDateStr(d);
}
function mlDaysBetween(startStr, endStr) {
  const a = new Date(String(startStr).slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(String(endStr).slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}
function mlDayOfWeek(dateStr) {
  return new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z').getUTCDay();
}

// A transaction's value in the base currency, honouring its own currency (a USD
// bill paid from a THB wallet must not be counted as THB). Mirrors the rule in
// state.js getTxCurrency() that every analytics path is required to follow.
function mlTxBase(tx, baseCurrency) {
  return convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
}

// Discretionary = variable spend the user chose, i.e. an expense NOT generated
// by a schedule. Recurring outflows already live in schedules and are projected
// deterministically, so the model only has to learn this residual. Transfers
// move money between the user's own wallets and are never spending, so they are
// excluded here and throughout the feature layer.
function isDiscretionaryExpense(tx) {
  return !!tx && tx.type === 'expense' && !tx.scheduledId;
}

// Daily discretionary-spend series over the [endDate - lookbackDays + 1, endDate]
// window, base currency, with missing days filled as 0 so the series is a dense,
// evenly-spaced signal the model can index by weekday. Future-dated rows are
// never included — a leak of future data into training is the classic
// time-series bug this window guards against.
function getDiscretionaryDailySeries(transactions, baseCurrency, endDateStr, lookbackDays) {
  const totals = new Map();
  (transactions || []).forEach((tx) => {
    if (!isDiscretionaryExpense(tx)) return;
    const day = String(tx.date).slice(0, 10);
    if (day > endDateStr) return;
    totals.set(day, (totals.get(day) || 0) + mlTxBase(tx, baseCurrency));
  });

  const series = [];
  const startStr = mlAddDays(endDateStr, -(lookbackDays - 1));
  for (let i = 0; i < lookbackDays; i++) {
    const day = mlAddDays(startStr, i);
    series.push({ date: day, amount: totals.get(day) || 0 });
  }
  return series;
}

// Mean and population standard deviation of a numeric array.
function meanStd(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

// --- Data sufficiency -------------------------------------------------------
// Forecasting tiny ledgers produces confident nonsense, so the UI gates on this:
//   none    -> too little to say anything; show a "keep logging" hint
//   minimal -> enough for a flat average baseline
//   good    -> enough distinct days to estimate day-of-week seasonality
const ML_SUFFICIENCY = { NONE: 'none', MINIMAL: 'minimal', GOOD: 'good' };

function assessDataSufficiency(audit) {
  if (!audit || audit.discretionaryTxCount < 8 || audit.distinctSpendDays < 5) {
    return ML_SUFFICIENCY.NONE;
  }
  if (audit.distinctSpendDays >= 45 && audit.spanDays >= 60) {
    return ML_SUFFICIENCY.GOOD;
  }
  return ML_SUFFICIENCY.MINIMAL;
}

// Snapshot of how much the model has to work with. Drives both the sufficiency
// gate and the "trained on N days of data" line in the UI.
function auditLedgerData(state) {
  const s = state || MidoriState;
  const txns = s.transactions || [];
  let earliest = null;
  let latest = null;
  let discretionaryCount = 0;
  const spendDays = new Set();

  txns.forEach((tx) => {
    const day = String(tx.date).slice(0, 10);
    if (!earliest || day < earliest) earliest = day;
    if (!latest || day > latest) latest = day;
    if (isDiscretionaryExpense(tx)) {
      discretionaryCount++;
      spendDays.add(day);
    }
  });

  const spanDays = earliest && latest ? mlDaysBetween(earliest, latest) + 1 : 0;
  const audit = {
    txCount: txns.length,
    firstDate: earliest,
    lastDate: latest,
    spanDays,
    monthsOfHistory: spanDays > 0 ? Math.round((spanDays / 30.44) * 10) / 10 : 0,
    discretionaryTxCount: discretionaryCount,
    distinctSpendDays: spendDays.size,
    activeScheduleCount: (s.schedules || []).filter((x) => x && x.active).length,
  };
  audit.sufficiency = assessDataSufficiency(audit);
  return audit;
}

// --- Synthetic ledger -------------------------------------------------------
// A deterministic, realistic ledger for unit tests and a portfolio "demo mode":
// a monthly salary and rent (the deterministic backbone), plus daily
// discretionary spending with weekend seasonality, a mild upward trend, and
// seeded noise. Same seed -> byte-identical ledger every run.
function generateSyntheticLedger(options) {
  const opts = options || {};
  const months = opts.months || 6;
  const endDate = opts.endDate || '2026-05-20';
  const baseCurrency = opts.baseCurrency || 'THB';
  const rand = mulberry32(opts.seed || 42);

  const wallets = [
    { id: 'w_cash', name: 'Cash', currency: baseCurrency, openingBalance: 50000, balance: 50000 },
  ];
  const categories = [
    { id: 'c_salary', name: 'Salary', type: 'income', budget: null, yearlyBudget: null, includeInBudget: false },
    { id: 'c_food', name: 'Food', type: 'expense', budget: 15000, yearlyBudget: 180000, includeInBudget: true },
    { id: 'c_transport', name: 'Transport', type: 'expense', budget: 5000, yearlyBudget: 60000, includeInBudget: true },
    { id: 'c_fun', name: 'Entertainment', type: 'expense', budget: 8000, yearlyBudget: 96000, includeInBudget: true },
  ];
  const schedules = [
    { id: 's_salary', title: 'Salary', amount: 60000, type: 'income', walletId: 'w_cash', categoryId: 'c_salary', currency: baseCurrency, frequency: 'monthly', active: true, nextDueDate: mlAddDays(endDate, 5), startDate: null, endDate: null },
    { id: 's_rent', title: 'Rent', amount: 18000, type: 'expense', walletId: 'w_cash', categoryId: null, currency: baseCurrency, frequency: 'monthly', active: true, nextDueDate: mlAddDays(endDate, 8), startDate: null, endDate: null },
  ];

  const transactions = [];
  const totalDays = Math.round(months * 30.44);
  const startStr = mlAddDays(endDate, -(totalDays - 1));
  const dowMultiplier = [0.8, 0.9, 0.9, 1.0, 1.2, 1.6, 1.5]; // Sun..Sat — weekends spend more
  const expenseCats = ['c_food', 'c_transport', 'c_fun'];
  let counter = 0;

  for (let i = 0; i < totalDays; i++) {
    const day = mlAddDays(startStr, i);
    const dow = mlDayOfWeek(day);
    const trend = 1 + (i / totalDays) * 0.15; // ~15% drift across the window
    const purchases = 1 + Math.floor(rand() * 3);
    for (let p = 0; p < purchases; p++) {
      const amount = Math.round((150 + rand() * 450) * dowMultiplier[dow] * trend);
      transactions.push({
        id: 'tx_syn_' + counter++,
        title: 'Purchase',
        amount,
        type: 'expense',
        walletId: 'w_cash',
        toWalletId: null,
        categoryId: expenseCats[Math.floor(rand() * expenseCats.length)],
        currency: baseCurrency,
        date: day,
        note: 'synthetic',
        scheduledId: null,
        updatedAt: 0,
      });
    }
  }

  return {
    wallets,
    categories,
    transactions,
    schedules,
    preferences: {
      theme: 'dark',
      baseCurrency,
      autoSyncDeviceDate: false,
      syncEnabled: false,
      syncId: null,
      syncKey: null,
      lastSyncedAt: 0,
      cloudRevision: 0,
    },
    virtualDate: endDate,
    updatedAt: 0,
    fxRatesCache: null,
    deletions: {},
  };
}
