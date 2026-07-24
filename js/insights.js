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
