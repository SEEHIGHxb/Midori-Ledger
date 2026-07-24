/**
 * Midori — Premium Finance Ledger App
 * insights.js: the Insights tab UI. For now it surfaces recurring-charge
 * suggestions from ml-subscriptions.js and lets the user promote one to a real
 * schedule in a click. Budget-overrun and anomaly cards (Phases 4–5) will land
 * on this same tab.
 */

// The last rendered suggestion list, so the [data-action] click handler can
// resolve a card's `key` back to its full candidate without re-mining. Rebuilt
// on every renderSubscriptionSuggestions() call, so it never goes stale.
let lastDetectedSubscriptions = [];

function renderInsights() {
  renderSubscriptionSuggestions();
  renderBudgetForecast();
}

function renderSubscriptionSuggestions() {
  const container = document.getElementById('subscriptionsContainer');
  if (!container) return;

  let detected = [];
  try {
    detected = detectSubscriptions(MidoriState);
  } catch (err) {
    // Detection must never take the tab down; an empty list is a safe fallback.
    console.error('[Midori] Subscription detection failed:', err);
  }
  lastDetectedSubscriptions = detected;

  container.innerHTML = '';

  if (!detected.length) {
    container.innerHTML = `
      <div class="empty-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>No recurring charges detected yet. As you log day-to-day spending, Midori will spot subscriptions you pay by hand and offer to schedule them here.</span>
      </div>
    `;
    return;
  }

  detected.forEach((c) => {
    const confidencePct = Math.round(c.confidence * 100);
    const itemHTML = `
      <div class="schedule-item" style="border-left: 4px solid var(--green-mint);">
        <div class="schedule-meta">
          <span class="sched-frequency-badge">${escapeHtml(c.frequency)}</span>
          <div class="sched-details">
            <span class="sched-title">${escapeHtml(c.title)}</span>
            <span class="sched-sub">
              Seen <b>${c.occurrences}×</b> • about every <b>${c.intervalDays} days</b> • next ~<b>${formatDisplayDate(c.nextDueDate)}</b>
            </span>
            <span class="sched-sub" style="font-size:10px; margin-top:2px;">
              Match confidence: <b>${escapeHtml(c.confidenceLabel)}</b> (${confidencePct}%)
            </span>
          </div>
        </div>
        <div class="sched-finances">
          <span class="sched-amount amount-expense">-${formatCurrency(c.amount, c.currency)}</span>
          <button class="btn-secondary" data-action="addDetectedSubscription" data-arg="${escapeHtml(c.key)}" style="padding:6px 12px; font-size:12px;">
            Add as schedule
          </button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', itemHTML);
  });
}

// Promote a detected recurring charge to a real recurrence schedule. Reuses the
// same addSchedule + processSchedules path as the manual "Add Recurring
// Schedule" form, so the new schedule behaves identically and — because it now
// matches an active schedule's title — drops out of the next detection pass.
function addDetectedSubscription(key) {
  const c = lastDetectedSubscriptions.find((x) => x.key === key);
  if (!c) return;

  const summary = `${c.title} — ${formatCurrency(c.amount, c.currency)} ${c.frequency}`;
  if (!confirm(`Create a recurring schedule?\n\n${summary}\nStarting ${formatDisplayDate(c.nextDueDate)}.\n\nYou can edit or remove it anytime on the Schedules tab.`)) {
    return;
  }

  addSchedule({
    title: c.title,
    amount: c.amount,
    type: 'expense',
    walletId: c.walletId,
    categoryId: c.categoryId,
    currency: c.currency,
    frequency: c.frequency,
    startDate: c.nextDueDate,
    nextDueDate: c.nextDueDate,
    endDate: null,
  });

  // Back-fill any occurrences already due as of the simulated date, exactly as
  // the manual schedule form does.
  processSchedules(MidoriState.virtualDate);

  // Refresh everything: the schedule now appears on its tab and this suggestion
  // disappears from Insights.
  renderAllViews();
  if (typeof showToast === 'function') {
    showToast(`Added “${c.title}” to your schedules.`);
  }
}

// --- Budget-overrun forecast (Phase 4) --------------------------------------
// Per-tier bar styling + human label. Only non-'safe' tiers ever reach the UI.
const BUDGET_STATUS_UI = {
  exceeded: { cls: 'status-danger', label: 'Over budget' },
  projected_over: { cls: 'status-danger', label: 'On track to exceed' },
  approaching: { cls: 'status-warn', label: 'Approaching limit' },
};

function renderBudgetForecast() {
  const container = document.getElementById('budgetForecastContainer');
  if (!container) return;

  let result = { items: [] };
  try {
    result = forecastBudgets();
  } catch (err) {
    console.error('[Midori] Budget forecast failed:', err);
  }
  container.innerHTML = '';

  const baseCurrency = MidoriState.preferences.baseCurrency;

  if (!result.items.length) {
    container.innerHTML = `
      <div class="empty-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
        <span>No monthly category budgets set. Add a monthly limit to a tag on the Budgets tab and Midori will forecast overruns here.</span>
      </div>
    `;
    return;
  }

  const alerts = result.items.filter((i) => i.status !== 'safe');
  if (!alerts.length) {
    const n = result.items.length;
    container.innerHTML = `<div class="metric-desc" style="padding:10px 0;">All ${n} budgeted ${n === 1 ? 'category is' : 'categories are'} on track for this month. 🌱</div>`;
    return;
  }

  const monthEndLabel = escapeHtml(formatDisplayDate(result.monthEnd));
  alerts.forEach((it) => {
    const ui = BUDGET_STATUS_UI[it.status];
    const barPct = Math.min(100, it.projectedPct);
    const overLine = it.overBy > 0
      ? `Projected <b>${formatCurrency(it.overBy, baseCurrency)}</b> over by ${monthEndLabel}`
      : `Projected <b>${it.projectedPct}%</b> of limit by ${monthEndLabel}`;

    const html = `
      <div style="background:rgba(139,168,143,0.03); border:1px solid var(--border-color); border-radius:12px; padding:12px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:13px;">
          <span style="font-weight:600; display:flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background-color:${escapeHtml(it.color || '#8ba88f')};"></span>
            ${escapeHtml(it.name)}
          </span>
          <span style="font-weight:700; font-family:'Outfit';">
            ${formatCurrency(it.spent, baseCurrency)} / ${formatCurrency(it.budget, baseCurrency)}
          </span>
        </div>
        <div class="budget-progress-bar">
          <div class="budget-progress-fill ${ui.cls}" style="width:${barPct}%"></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); margin-top:4px;">
          <span>${overLine} • ${it.daysLeft} days left</span>
          <span class="${ui.cls}" style="font-weight:600;">${escapeHtml(ui.label)}</span>
        </div>
        <div style="text-align:right; margin-top:8px;">
          <button class="btn-secondary" data-action="openEditBudgetModal" data-arg="${escapeHtml(it.categoryId)}" style="padding:5px 10px; font-size:11px;">
            Adjust budget
          </button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}
