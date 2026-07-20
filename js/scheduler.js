/**
 * Midori — Premium Finance Ledger App
 * scheduler.js: Recurrence Processor & Simulated Date Engine
 */

// The only recurrence frequencies the engine can advance. Anything else makes
// getNextOccurrenceDate() a fixed point (it returns its input unchanged), which
// turns every `while (nextDue <= target)` loop below into an infinite loop that
// pushes transactions until the tab runs out of memory. Values reach us not
// only from the <select> but from imported backups and cloud pulls, so they
// must be treated as untrusted.
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

function isValidFrequency(frequency) {
  return VALID_FREQUENCIES.indexOf(frequency) !== -1;
}

// Runaway backstop for the occurrence loops. Far above any realistic ledger
// (27+ years of daily recurrence) so it never trips in normal use — it exists
// only so an unforeseen non-advancing case degrades into a logged error rather
// than a frozen tab.
const MAX_OCCURRENCES_PER_RUN = 10000;

function daysInUTCMonth(year, monthIndex) {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// The day-of-month a schedule's occurrences should land on. startDate is the
// user's stated intent; nextDueDate is the fallback for rows written before
// this mattered, so an already-drifted schedule keeps its current day rather
// than silently jumping to a different one.
function getScheduleAnchorDay(schedule) {
  const source = schedule && (schedule.startDate || schedule.nextDueDate);
  if (!source) return null;
  const d = new Date(source);
  return isNaN(d.getTime()) ? null : d.getUTCDate();
}

// Helper to compute next date based on frequency.
//
// Monthly and yearly recurrence anchors on anchorDay and clamps to the last
// day of a short month instead of spilling into the next one. Plain
// setUTCMonth(+1) arithmetic sends Jan 31 to Mar 3, and because each step
// reads the *previous* result rather than the original day, that drift is
// permanent: rent due on the 31st migrates to the 3rd and never comes back.
// Anchored, it goes Jan 31 -> Feb 28 -> Mar 31, which is what every calendar
// and billing system does. Callers that have the schedule should pass
// getScheduleAnchorDay(schedule); omitting it falls back to the day in
// dateStr, preserving the old single-argument behaviour.
function getNextOccurrenceDate(dateStr, frequency, anchorDay) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  if (frequency === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (frequency === 'monthly' || frequency === 'yearly') {
    const parsedAnchor = Number(anchorDay);
    const day = Number.isInteger(parsedAnchor) && parsedAnchor >= 1 && parsedAnchor <= 31
      ? parsedAnchor
      : d.getUTCDate();
    // Land on the 1st before shifting: from Jan 31, setUTCMonth(+1) would
    // already have overflowed into March and we would clamp the wrong month.
    d.setUTCDate(1);
    if (frequency === 'monthly') {
      d.setUTCMonth(d.getUTCMonth() + 1);
    } else {
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    }
    d.setUTCDate(Math.min(day, daysInUTCMonth(d.getUTCFullYear(), d.getUTCMonth())));
  }
  return d.toISOString().split('T')[0];
}

// Check and process scheduled transactions that became due
function processSchedules(targetDateStr) {
  let stateChanged = false;
  
  const schedules = MidoriState.schedules;
  
  schedules.forEach(schedule => {
    if (!schedule.active) return;

    // Reject unusable recurrence data up front rather than looping on it.
    if (!isValidFrequency(schedule.frequency)) {
      console.error(`Schedule "${schedule.title}" has an unsupported frequency "${schedule.frequency}"; deactivating it instead of processing.`);
      schedule.active = false;
      stateChanged = true;
      return;
    }

    let nextDue = schedule.nextDueDate;
    const anchorDay = getScheduleAnchorDay(schedule);
    let iterations = 0;
    // Process all occurrences until nextDue is strictly after the targetDateStr
    while (nextDue <= targetDateStr) {
      if (schedule.endDate && nextDue > schedule.endDate) {
        schedule.active = false;
        stateChanged = true;
        break;
      }

      if (++iterations > MAX_OCCURRENCES_PER_RUN) {
        console.error(`Schedule "${schedule.title}" exceeded ${MAX_OCCURRENCES_PER_RUN} occurrences in one run; deactivating to protect the app.`);
        schedule.active = false;
        stateChanged = true;
        break;
      }

      console.log(`Processing schedule "${schedule.title}" due on ${nextDue}`);
      
      // 1. Create a transaction instance (uses schedule.currency if defined, otherwise defaults to wallet currency)
      const wallet = MidoriState.wallets.find(w => w.id === schedule.walletId);
      const schedCurrency = schedule.currency || (wallet ? wallet.currency : 'JPY');
      
      const newTx = {
        title: `${schedule.title} 🍃`,
        amount: Number(schedule.amount),
        type: schedule.type,
        walletId: schedule.walletId,
        categoryId: schedule.categoryId,
        currency: schedCurrency,
        date: nextDue,
        note: `Scheduled ${schedule.frequency} occurrence. Generated automatically.`,
        scheduledId: schedule.id
      };
      
      newTx.id = generateUUID();
      MidoriState.transactions.push(newTx);
      
      // 2. Advance schedule nextDueDate.
      // The date MUST move strictly forward; if it ever fails to, stop rather
      // than spin (e.g. an unparseable startDate returns itself unchanged).
      const advanced = getNextOccurrenceDate(nextDue, schedule.frequency, anchorDay);
      if (advanced <= nextDue) {
        console.error(`Schedule "${schedule.title}" failed to advance past ${nextDue}; deactivating it.`);
        schedule.active = false;
        stateChanged = true;
        break;
      }
      nextDue = advanced;
      schedule.nextDueDate = nextDue;

      stateChanged = true;
    }
  });

  if (stateChanged) {
    recalculateWalletBalances();
  }
}

// Centralized handler to update the virtual date and cleanly handle rollbacks
function updateVirtualDate(newDateStr) {
  const oldDateStr = MidoriState.virtualDate;
  
  // 1. Set the new virtual date
  MidoriState.virtualDate = newDateStr;
  
  // 2. If rolling back (new date is earlier than old date), delete future schedule-created transactions
  if (newDateStr < oldDateStr) {
    MidoriState.transactions = MidoriState.transactions.filter(tx => {
      // Remove any transaction generated by a schedule whose date is in the future relative to the new date
      if (tx.scheduledId && tx.date > newDateStr) {
        return false;
      }
      return true;
    });
    
    // Recalculate nextDueDate for all schedules back to the new date
    MidoriState.schedules.forEach(schedule => {
      if (!isValidFrequency(schedule.frequency)) {
        console.error(`Schedule "${schedule.title}" has an unsupported frequency "${schedule.frequency}"; skipping rollback recalculation.`);
        schedule.active = false;
        return;
      }
      let nextDue = schedule.startDate;
      const anchorDay = getScheduleAnchorDay(schedule);
      let iterations = 0;
      while (nextDue <= newDateStr) {
        if (schedule.endDate && nextDue > schedule.endDate) {
          break;
        }
        const advanced = getNextOccurrenceDate(nextDue, schedule.frequency, anchorDay);
        if (advanced <= nextDue || ++iterations > MAX_OCCURRENCES_PER_RUN) {
          console.error(`Schedule "${schedule.title}" failed to advance past ${nextDue} during rollback; leaving it here.`);
          break;
        }
        nextDue = advanced;
      }
      schedule.nextDueDate = nextDue;
      // Reactivate if it was expired but is now active in this rolled back date
      if (schedule.endDate && nextDue <= schedule.endDate) {
        schedule.active = true;
      }
    });
  }
  
  // 3. Save state to localStorage
  saveState();
  
  // 4. Process forward schedules (if traveling forward or just to generate any due transactions on the target date)
  processSchedules(newDateStr);
  
  // 5. Centralized replay calculation
  recalculateWalletBalances();
  
  // 6. Refresh the full user interface
  if (typeof renderAllViews === 'function') {
    renderAllViews();
  }
}

// Fast-forward simulated date
function fastForwardDate(daysToAdvance) {
  const current = new Date(MidoriState.virtualDate);
  current.setDate(current.getDate() + Number(daysToAdvance));
  const newDateStr = current.toISOString().split('T')[0];
  updateVirtualDate(newDateStr);
}

// Reset virtual date back to current local date
function resetToRealDate() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  updateVirtualDate(dateStr);
}

// Forecast future schedules for the next 30 days
function get30DayForecast() {
  const forecast = {
    totalIncome: 0,
    totalExpense: 0,
    events: []
  };

  const virtualDateStr = MidoriState.virtualDate;
  const endLimitDate = new Date(virtualDateStr);
  endLimitDate.setDate(endLimitDate.getDate() + 30);
  const endLimitStr = endLimitDate.toISOString().split('T')[0];

  MidoriState.schedules.forEach(schedule => {
    if (!schedule.active) return;
    if (!isValidFrequency(schedule.frequency)) return; // never forecast an unadvanceable schedule

    let checkDate = schedule.nextDueDate;
    const anchorDay = getScheduleAnchorDay(schedule);
    let iterations = 0;
    const baseWallet = MidoriState.wallets.find(w => w.id === schedule.walletId);
    const schedCurrency = schedule.currency || (baseWallet ? baseWallet.currency : MidoriState.preferences.baseCurrency);

    while (checkDate <= endLimitStr) {
      if (schedule.endDate && checkDate > schedule.endDate) {
        break;
      }
      if (++iterations > MAX_OCCURRENCES_PER_RUN) break;

      // Convert schedule amount to standard base currency
      const amountInBase = convertAmount(schedule.amount, schedCurrency, MidoriState.preferences.baseCurrency);
      
      if (schedule.type === 'income') {
        forecast.totalIncome += amountInBase;
      } else {
        forecast.totalExpense += amountInBase;
      }
      
      forecast.events.push({
        title: schedule.title,
        amount: schedule.amount,
        currency: schedCurrency,
        amountInBase: amountInBase,
        type: schedule.type,
        date: checkDate,
        walletName: baseWallet ? baseWallet.name : 'Unknown'
      });
      
      checkDate = getNextOccurrenceDate(checkDate, schedule.frequency, anchorDay);
    }
  });

  forecast.events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return forecast;
}
