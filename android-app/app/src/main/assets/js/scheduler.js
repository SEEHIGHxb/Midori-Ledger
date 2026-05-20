/**
 * Midori — Premium Finance Ledger App
 * scheduler.js: Recurrence Processor & Simulated Date Engine
 */

// Helper to compute next date based on frequency
function getNextOccurrenceDate(dateStr, frequency) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  
  if (frequency === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (frequency === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().split('T')[0];
}

// Check and process scheduled transactions that became due
function processSchedules(targetDateStr) {
  let stateChanged = false;
  
  const schedules = MidoriState.schedules;
  
  schedules.forEach(schedule => {
    if (!schedule.active) return;
    
    let nextDue = schedule.nextDueDate;
    // Process all occurrences until nextDue is strictly after the targetDateStr
    while (nextDue <= targetDateStr) {
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
      
      // Update wallet balance directly, converting if currency differs
      if (wallet) {
        const amountInWalletCurrency = convertAmount(newTx.amount, newTx.currency, wallet.currency);
        if (schedule.type === 'income') {
          wallet.balance += amountInWalletCurrency;
        } else {
          wallet.balance -= amountInWalletCurrency;
        }
      }
      
      // 2. Advance schedule nextDueDate
      nextDue = getNextOccurrenceDate(nextDue, schedule.frequency);
      schedule.nextDueDate = nextDue;
      
      stateChanged = true;
    }
  });

  if (stateChanged) {
    saveState();
  }
}

// Fast-forward simulated date
function fastForwardDate(daysToAdvance) {
  const current = new Date(MidoriState.virtualDate);
  current.setDate(current.getDate() + Number(daysToAdvance));
  
  const newDateStr = current.toISOString().split('T')[0];
  
  MidoriState.virtualDate = newDateStr;
  saveState();
  
  processSchedules(newDateStr);
}

// Reset virtual date back to current local date
function resetToRealDate() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  
  MidoriState.virtualDate = dateStr;
  saveState();
  processSchedules(dateStr);
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
    
    let checkDate = schedule.nextDueDate;
    const baseWallet = MidoriState.wallets.find(w => w.id === schedule.walletId);
    const schedCurrency = schedule.currency || (baseWallet ? baseWallet.currency : MidoriState.preferences.baseCurrency);
    
    while (checkDate <= endLimitStr) {
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
      
      checkDate = getNextOccurrenceDate(checkDate, schedule.frequency);
    }
  });

  forecast.events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return forecast;
}
