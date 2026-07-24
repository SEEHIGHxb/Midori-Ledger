/**
 * Midori — Premium Finance Ledger App
 * ml-budget.js: budget-overrun forecasting. For each monthly-budgeted category
 * it projects the END-OF-MONTH total and flags the ones on track to blow their
 * limit — the forward-looking companion to the Budgets tab's current-utilization
 * bars.
 *
 * Reuses BOTH forecast backbones, which is the point of the whole design:
 *   projected = spent-so-far
 *             + remaining DISCRETIONARY  (the Phase-2 learned daily model,
 *               allocated to the category by its share of discretionary spend)
 *             + remaining SCHEDULED       (deterministic expansion of the
 *               category's own active schedules over the rest of the month)
 *
 * Pure logic (no DOM) — tested in tests/ml-budget.test.js. Depends on globals:
 * isDiscretionaryExpense, mlTxBase, mlAddDays, mlDaysBetween, auditLedgerData,
 * ML_SUFFICIENCY (ml-features.js); trainDiscretionaryModel,
 * predictDiscretionaryForDay, ML_FORECAST_LOOKBACK_DAYS (ml-forecast.js);
 * convertAmount (state.js); isValidFrequency, getScheduleAnchorDay,
 * getNextOccurrenceDate (scheduler.js).
 */

// Alert tiers, most severe first. `exceeded` is already over the cap;
// `projected_over` is under now but forecast to cross it before month-end;
// `approaching` is forecast to land in the 80–100% band; `safe` is everything
// else. Ordering is used to sort the surfaced alerts.
const ML_BUDGET_STATUS_ORDER = { exceeded: 0, projected_over: 1, approaching: 2, safe: 3 };
const ML_BUDGET_APPROACHING_PCT = 80;

function mlPad2(n) {
  return String(n).padStart(2, '0');
}

// The current calendar month's last day and how many days remain strictly after
// the simulated date. Parsed straight from the 'YYYY-MM-DD' string (not via a
// local Date) so it never drifts a day across time zones.
function mlCurrentMonthPeriod(virtualDateStr) {
  const iso = String(virtualDateStr).slice(0, 10);
  const [y, m] = iso.split('-').map(Number); // m is 1-based
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const endStr = `${y}-${mlPad2(m)}-${mlPad2(lastDay)}`;
  return { endStr, daysLeft: Math.max(0, mlDaysBetween(iso, endStr)), daysInMonth: lastDay };
}

// Each category's share of total discretionary spend over the model's history
// window — how the total discretionary forecast is split across categories.
// Returns { totals: Map(categoryId -> baseSum), total }.
function getCategoryDiscretionaryShares(baseCurrency, endDateStr, lookbackDays) {
  const startStr = mlAddDays(endDateStr, -(lookbackDays - 1));
  const totals = new Map();
  let total = 0;
  (MidoriState.transactions || []).forEach((tx) => {
    if (!isDiscretionaryExpense(tx)) return;
    const day = String(tx.date).slice(0, 10);
    if (day < startStr || day > endDateStr) return;
    const base = mlTxBase(tx, baseCurrency);
    totals.set(tx.categoryId, (totals.get(tx.categoryId) || 0) + base);
    total += base;
  });
  return { totals, total };
}

// Sum of a category's active expense-schedule occurrences that fall strictly
// after fromExclusive and up to toInclusive, in base currency. These are the
// deterministic recurring charges not yet turned into transactions. Occurrence
// stepping mirrors scheduler.js exactly (getNextOccurrenceDate + anchor day),
// with the same runaway guard.
function getRemainingScheduledCategorySpend(categoryId, fromExclusive, toInclusive, baseCurrency) {
  let sum = 0;
  (MidoriState.schedules || []).forEach((sched) => {
    if (!sched || !sched.active || sched.type !== 'expense') return;
    if (sched.categoryId !== categoryId) return;
    if (!isValidFrequency(sched.frequency)) return;

    const anchorDay = getScheduleAnchorDay(sched);
    const currency = sched.currency || baseCurrency;
    let due = String(sched.nextDueDate).slice(0, 10);
    let guard = 0;

    // Skip occurrences already due as of fromExclusive (those are — or will be —
    // transactions already counted in spent-so-far).
    while (due <= fromExclusive && guard++ < 600) {
      const adv = getNextOccurrenceDate(due, sched.frequency, anchorDay);
      if (adv === due) return; // non-advancing frequency; bail rather than loop
      due = adv;
    }

    guard = 0;
    while (due <= toInclusive && guard++ < 600) {
      if (sched.endDate && due > sched.endDate) break;
      sum += convertAmount(sched.amount, currency, baseCurrency);
      const adv = getNextOccurrenceDate(due, sched.frequency, anchorDay);
      if (adv === due) break;
      due = adv;
    }
  });
  return sum;
}

// Period-to-date spend per category for the simulated month, base currency.
// Deliberately mirrors renderBudgets(): match the month by 'YYYY-MM' prefix
// (time-zone independent) and drop future-dated scheduled rows, so the "spent"
// shown here equals the Budgets tab to the currency unit.
function getMonthlySpendByCategory(baseCurrency, virtualDateStr) {
  const ym = String(virtualDateStr).slice(0, 7);
  const byCat = new Map();
  (MidoriState.transactions || []).forEach((tx) => {
    if (tx.type !== 'expense') return;
    if (tx.scheduledId && tx.date > virtualDateStr) return; // time-travel rollback filter
    if (String(tx.date).slice(0, 7) !== ym) return;
    byCat.set(tx.categoryId, (byCat.get(tx.categoryId) || 0) + mlTxBase(tx, baseCurrency));
  });
  return byCat;
}

// Forecast every monthly-budgeted expense category to month-end and classify it.
// Returns { sufficiency, virtualDate, monthEnd, daysLeft, items[] } where each
// item is schedule/UI-ready. Categories without a positive monthly budget are
// excluded (matching the dashboard's budget alerts).
function forecastBudgets(options) {
  const opts = options || {};
  const state = MidoriState;
  const baseCurrency = (state.preferences && state.preferences.baseCurrency) || 'THB';
  const virtualDate = String(state.virtualDate).slice(0, 10);
  const audit = auditLedgerData(state);
  const { endStr: monthEnd, daysLeft } = mlCurrentMonthPeriod(virtualDate);

  const budgetedCats = (state.categories || []).filter(
    (c) => c && c.type === 'expense' && c.includeInBudget && c.budget > 0
  );
  if (!budgetedCats.length) {
    return { sufficiency: audit.sufficiency, virtualDate, monthEnd, daysLeft, items: [] };
  }

  const spentByCat = getMonthlySpendByCategory(baseCurrency, virtualDate);
  const shares = getCategoryDiscretionaryShares(baseCurrency, virtualDate, ML_FORECAST_LOOKBACK_DAYS);

  // The remaining-discretionary total for the rest of the month, from the learned
  // daily model — computed once and then split per category by its share. Below
  // 'good' sufficiency the model is unreliable, so we contribute no discretionary
  // projection rather than guess (scheduled + spent still drive the forecast).
  let remainingDiscretionaryTotal = 0;
  if (audit.sufficiency !== ML_SUFFICIENCY.NONE && daysLeft > 0) {
    const model = trainDiscretionaryModel({ lookbackDays: opts.lookbackDays });
    for (let i = 1; i <= daysLeft; i++) {
      remainingDiscretionaryTotal += predictDiscretionaryForDay(model, mlAddDays(virtualDate, i)).mean;
    }
  }

  const items = budgetedCats.map((cat) => {
    const spent = spentByCat.get(cat.id) || 0;
    const share = shares.total > 0 ? (shares.totals.get(cat.id) || 0) / shares.total : 0;
    const remainingDiscretionary = remainingDiscretionaryTotal * share;
    const remainingScheduled = getRemainingScheduledCategorySpend(cat.id, virtualDate, monthEnd, baseCurrency);
    const projected = spent + remainingDiscretionary + remainingScheduled;

    const currentPct = (spent / cat.budget) * 100;
    const projectedPct = (projected / cat.budget) * 100;
    let status = 'safe';
    if (currentPct >= 100) status = 'exceeded';
    else if (projectedPct >= 100) status = 'projected_over';
    else if (projectedPct >= ML_BUDGET_APPROACHING_PCT) status = 'approaching';

    return {
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      budget: cat.budget,
      spent: Math.round(spent),
      projected: Math.round(projected),
      remainingDiscretionary: Math.round(remainingDiscretionary),
      remainingScheduled: Math.round(remainingScheduled),
      currentPct: Math.round(currentPct),
      projectedPct: Math.round(projectedPct),
      overBy: Math.round(Math.max(0, projected - cat.budget)),
      daysLeft,
      status,
    };
  });

  items.sort(
    (a, b) => ML_BUDGET_STATUS_ORDER[a.status] - ML_BUDGET_STATUS_ORDER[b.status] || b.projectedPct - a.projectedPct
  );

  return { sufficiency: audit.sufficiency, virtualDate, monthEnd, daysLeft, items };
}
