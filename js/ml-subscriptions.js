/**
 * Midori — Premium Finance Ledger App
 * ml-subscriptions.js: periodicity mining that finds recurring charges the user
 * pays by hand (Netflix, rent, gym…) but has NOT yet set up as a schedule, and
 * turns each into a ready-to-add schedule suggestion.
 *
 * This is the precondition feeder for the forecast backbone: once a recurring
 * charge becomes a schedule, get30DayForecast() projects it deterministically
 * and it drops out of the discretionary residual the model has to guess. Better
 * schedules -> sharper forecast.
 *
 * Pure logic only — no DOM — so every function is unit tested in the vm sandbox
 * (tests/ml-subscriptions.test.js). Depends on globals: isDiscretionaryExpense,
 * mlTxBase, mlDaysBetween, meanStd (ml-features.js), getTxCurrency (state.js),
 * getNextOccurrenceDate (scheduler.js).
 */

// Only cadences the recurrence engine can actually advance (scheduler.js
// VALID_FREQUENCIES). A ~14-day (bi-weekly) charge has no representation there,
// so it is deliberately NOT surfaced — suggesting a schedule the engine cannot
// step would either misfire or, worse, loop. period is the ideal gap in days;
// [min,max] is the tolerance band a real charge's gaps must mostly fall inside.
const ML_SUB_CADENCES = [
  { frequency: 'weekly', period: 7, min: 6, max: 8 },
  { frequency: 'monthly', period: 30.44, min: 26, max: 35 },
  { frequency: 'yearly', period: 365.25, min: 350, max: 380 },
];

// Detection thresholds. Tuned to be quiet: a false "we found a subscription"
// that turns out to be ordinary variable spend erodes trust faster than a
// missed one, so the bar is deliberately conservative.
const ML_SUB_MIN_OCCURRENCES = 3;   // < 3 points cannot establish a cadence
const ML_SUB_MIN_CONFIDENCE = 0.5;  // below this, stay silent
const ML_SUB_MAX_AMOUNT_CV = 0.35;  // subscriptions barely vary in amount
const ML_SUB_MIN_GAP_FRACTION = 0.5; // majority of gaps must sit in the band

// Merchant grouping key: strip digits (invoice numbers, month suffixes) and
// punctuation, keep letters (including Thai) and single spaces, lowercase. So
// "Netflix #4021" and "netflix" collapse to the same recurring merchant, while
// genuinely different payees stay apart.
function normalizeMerchantKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z฀-๿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function medianOf(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Most frequent value in a list (ties broken by first-seen). Used to pick the
// wallet/category/currency the suggested schedule should inherit.
function modeOf(values) {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  values.forEach((v) => {
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestCount) {
      bestCount = n;
      best = v;
    }
  });
  return best;
}

// Match a median gap to a cadence, or null if it lands between the supported
// ones (e.g. bi-weekly) — the caller drops those rather than guess.
function matchCadence(medianGap) {
  return ML_SUB_CADENCES.find((c) => medianGap >= c.min && medianGap <= c.max) || null;
}

// Roll a schedule's next due date forward from its last seen charge to the
// first occurrence strictly after referenceDate, using the SAME arithmetic the
// engine uses (getNextOccurrenceDate), so the suggested date matches what the
// schedule will actually generate. The 600-step guard mirrors scheduler.js's
// runaway backstop — far beyond any real horizon.
function projectNextDueDate(lastDateStr, frequency, referenceDateStr) {
  const anchorDay = new Date(String(lastDateStr).slice(0, 10) + 'T00:00:00Z').getUTCDate();
  let next = lastDateStr;
  let guard = 0;
  while (next <= referenceDateStr && guard++ < 600) {
    const advanced = getNextOccurrenceDate(next, frequency, anchorDay);
    if (advanced === next) break; // non-advancing frequency; give up rather than loop
    next = advanced;
  }
  return next;
}

// Analyse one merchant group. Returns a schedule-ready candidate, or null if the
// group is not convincingly a recurring subscription.
function analyzeRecurringGroup(group, baseCurrency, referenceDateStr) {
  // Collapse to one point per calendar day: a subscription hits once per period,
  // so same-day duplicates are summed rather than treated as a zero-gap cadence.
  const byDay = new Map();
  group.forEach((tx) => {
    const day = String(tx.date).slice(0, 10);
    const entry = byDay.get(day) || { native: 0, base: 0, txs: [] };
    entry.native += Number(tx.amount) || 0;
    entry.base += mlTxBase(tx, baseCurrency);
    entry.txs.push(tx);
    byDay.set(day, entry);
  });

  const days = Array.from(byDay.keys()).sort();
  if (days.length < ML_SUB_MIN_OCCURRENCES) return null;

  const gaps = [];
  for (let i = 1; i < days.length; i++) gaps.push(mlDaysBetween(days[i - 1], days[i]));
  const medianGap = medianOf(gaps);
  const cadence = matchCadence(medianGap);
  if (!cadence) return null;

  const gapsInBand = gaps.filter((g) => g >= cadence.min && g <= cadence.max).length;
  const gapFraction = gaps.length ? gapsInBand / gaps.length : 0;
  if (gapFraction < ML_SUB_MIN_GAP_FRACTION) return null;

  // Amount stability measured in base currency so a mixed-currency group is
  // still judged on real value. High variation -> ordinary variable spend, not
  // a subscription.
  const baseAmounts = days.map((d) => byDay.get(d).base);
  const stats = meanStd(baseAmounts);
  const amountCV = stats.mean > 0 ? stats.std / stats.mean : 1;
  if (amountCV > ML_SUB_MAX_AMOUNT_CV) return null;

  // Confidence blends the three signals; regularity weighs most because a stray
  // amount matters less than a broken cadence.
  const occurrenceScore = Math.min(1, (days.length - 2) / 4); // 3->0.25 … 6+->1
  const amountScore = Math.max(0, 1 - amountCV / ML_SUB_MAX_AMOUNT_CV);
  const confidence = 0.5 * gapFraction + 0.25 * occurrenceScore + 0.25 * amountScore;
  if (confidence < ML_SUB_MIN_CONFIDENCE) return null;

  // The suggested schedule inherits the group's dominant wallet/category/currency
  // and its typical (median) native charge.
  const allTxs = days.flatMap((d) => byDay.get(d).txs);
  const currency = modeOf(allTxs.map((tx) => getTxCurrency(tx, baseCurrency)));
  const nativeAmounts = days
    .filter((d) => byDay.get(d).txs.some((tx) => getTxCurrency(tx, baseCurrency) === currency))
    .map((d) => byDay.get(d).native);
  const lastDate = days[days.length - 1];

  return {
    title: allTxs[allTxs.length - 1].title, // most recent original title reads best
    frequency: cadence.frequency,
    amount: Math.round(medianOf(nativeAmounts.length ? nativeAmounts : baseAmounts)),
    currency,
    walletId: modeOf(allTxs.map((tx) => tx.walletId)),
    categoryId: modeOf(allTxs.map((tx) => tx.categoryId)),
    occurrences: days.length,
    firstDate: days[0],
    lastDate,
    intervalDays: Math.round(medianGap),
    nextDueDate: projectNextDueDate(lastDate, cadence.frequency, referenceDateStr),
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel: confidence >= 0.75 ? 'high' : 'medium',
  };
}

// Scan the ledger for recurring manual charges not already covered by a
// schedule. Returns candidates sorted most-confident first.
function detectSubscriptions(state, options) {
  const s = state || (typeof MidoriState !== 'undefined' ? MidoriState : null);
  if (!s) return [];
  const opts = options || {};
  const baseCurrency = (s.preferences && s.preferences.baseCurrency) || 'THB';
  const referenceDate = opts.referenceDate || s.virtualDate || '1970-01-01';
  const minConfidence = typeof opts.minConfidence === 'number' ? opts.minConfidence : ML_SUB_MIN_CONFIDENCE;

  // Don't re-suggest something the user already scheduled (match on merchant key
  // so "Netflix" the schedule silences "netflix #12" the charges).
  const scheduledKeys = new Set(
    (s.schedules || [])
      .filter((x) => x && x.active)
      .map((x) => normalizeMerchantKey(x.title))
      .filter(Boolean)
  );

  const groups = new Map();
  (s.transactions || []).forEach((tx) => {
    if (!isDiscretionaryExpense(tx)) return; // scheduled + income + transfers excluded
    const key = normalizeMerchantKey(tx.title);
    if (!key || scheduledKeys.has(key)) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  });

  const candidates = [];
  groups.forEach((group, key) => {
    const analysis = analyzeRecurringGroup(group, baseCurrency, referenceDate);
    if (analysis && analysis.confidence >= minConfidence) {
      candidates.push(Object.assign({ key }, analysis));
    }
  });

  candidates.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
  return candidates;
}
