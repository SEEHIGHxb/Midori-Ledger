/**
 * Midori — Premium Finance Ledger App
 * dashboard.js: Dashboard metrics, budget alerts & forecast widget.
 */

function renderDashboardMetrics() {
  const baseCurrency = MidoriState.preferences.baseCurrency;
  
  // 1. Calculate Net Worth (Sum of all wallet balances converted to Base Currency)
  let totalNetWorth = 0;
  MidoriState.wallets.forEach(wallet => {
    totalNetWorth += convertAmount(wallet.balance, wallet.currency, baseCurrency);
  });
  document.getElementById('netWorthDisplay').innerText = formatCurrency(totalNetWorth, baseCurrency);

  // 2. Parse current month details
  const vDate = new Date(MidoriState.virtualDate);
  const currentMonth = vDate.getMonth();
  const currentYear = vDate.getFullYear();
  
  let monthlyIncome = 0;
  let monthlyExpense = 0;

  MidoriState.transactions.forEach(tx => {
    if (tx.scheduledId && tx.date > MidoriState.virtualDate) return; // Strict time-travel rollback filter!
    const txDate = new Date(tx.date);
    if (txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear) {
      // Honour the transaction's own currency when it differs from the wallet's
      const converted = convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);

      if (tx.type === 'income') {
        monthlyIncome += converted;
      } else if (tx.type === 'expense') {
        monthlyExpense += converted;
      }
    }
  });

  document.getElementById('monthlyIncomeDisplay').innerText = formatCurrency(monthlyIncome, baseCurrency);
  document.getElementById('monthlyExpenseDisplay').innerText = formatCurrency(monthlyExpense, baseCurrency);

  // 3. Compute Savings Rate
  let savingsRate = 0;
  if (monthlyIncome > 0) {
    const saved = monthlyIncome - monthlyExpense;
    savingsRate = Math.max(0, Math.min(100, Math.round((saved / monthlyIncome) * 100)));
  }
  
  document.getElementById('savingsRateDisplay').innerText = `${savingsRate}%`;
  
  const savingsProgress = document.getElementById('savingsRateProgress');
  savingsProgress.style.width = `${savingsRate}%`;

  // Set visual alert states for savings progress bar
  savingsProgress.className = 'metric-progress-fill'; // reset
  if (savingsRate >= 40) {
    savingsProgress.classList.add('status-safe');
  } else if (savingsRate >= 15) {
    savingsProgress.classList.add('status-warn');
  } else {
    savingsProgress.classList.add('status-danger');
  }

  // 4. Render Active Budgets Warnings on Dashboard
  renderDashboardBudgetAlerts(currentMonth, currentYear, baseCurrency);

  // 5. Render 30-Day Schedules Forecast on Dashboard
  renderDashboardForecast();
}
// Render Dashboard Budget Alerts
function renderDashboardBudgetAlerts(month, year, baseCurrency) {
  const container = document.getElementById('dashboardBudgetAlerts');
  if (!container) return;
  container.innerHTML = '';

  // Get active budgets that are included and have monthly budget limits
  const budgetedCats = MidoriState.categories.filter(c => c.type === 'expense' && c.includeInBudget && c.budget > 0);
  
  if (budgetedCats.length === 0) {
    container.innerHTML = `<div class="metric-desc" style="padding:10px 0;">No category budgets are set. Create a monthly limit tag in the Budgets tab!</div>`;
    return;
  }

  // Sum spending for each budget tag in current month
  let renderedAlertsCount = 0;
  budgetedCats.forEach(cat => {
    let spent = 0;
    
    MidoriState.transactions.forEach(tx => {
      if (tx.scheduledId && tx.date > MidoriState.virtualDate) return; // Strict time-travel rollback filter!
      if (tx.type === 'expense' && tx.categoryId === cat.id) {
        const txDate = new Date(tx.date);
        if (txDate.getMonth() === month && txDate.getFullYear() === year) {
          spent += convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
        }
      }
    });

    const budgetLimit = cat.budget;
    const ratio = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
    
    // Only display active budgets on dashboard
    renderedAlertsCount++;
    
    let statusClass = 'status-safe';
    let alertMsg = 'Budget Safe';
    
    if (ratio >= 100) {
      statusClass = 'status-danger';
      alertMsg = 'EXCEEDED!';
    } else if (ratio >= 80) {
      statusClass = 'status-danger';
      alertMsg = 'Warning (Near Cap)';
    } else if (ratio >= 60) {
      statusClass = 'status-warn';
      alertMsg = 'Moderate Usage';
    }

    const itemHTML = `
      <div style="background:rgba(139,168,143,0.03); border: 1px solid var(--border-color); border-radius:12px; padding:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:13px;">
          <span style="font-weight:600; display:flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background-color:${escapeHtml(cat.color)};"></span>
            ${escapeHtml(cat.name)}
          </span>
          <span style="font-weight:700; font-family:'Outfit'; text-align:right;">
            ${formatCurrency(spent, baseCurrency)} / ${formatCurrency(budgetLimit, baseCurrency)}
          </span>
        </div>
        <div class="budget-progress-bar">
          <div class="budget-progress-fill ${statusClass}" style="width: ${Math.min(100, ratio)}%"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-top:4px;">
          <span>${ratio.toFixed(0)}% Utilized</span>
          <span style="font-weight:600;" class="${statusClass}">${alertMsg}</span>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', itemHTML);
  });

  if (renderedAlertsCount === 0) {
    container.innerHTML = `<div class="metric-desc" style="padding:10px 0;">No active budget spending found for this virtual month.</div>`;
  }
}

// Render Dashboard Forecast Widget
function renderDashboardForecast() {
  const container = document.getElementById('dashboardForecastEvents');
  if (!container) return;
  container.innerHTML = '';

  const forecast = get30DayForecast();
  
  if (forecast.events.length === 0) {
    container.innerHTML = `<div class="metric-desc" style="padding:10px 0;">No active scheduled recurrences due in the next 30 days.</div>`;
    return;
  }

  // Display top 3 upcoming schedules
  const topEvents = forecast.events.slice(0, 3);
  topEvents.forEach(evt => {
    const amountStr = formatCurrency(evt.amount, evt.currency);
    const dateFormatted = new Date(evt.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    
    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(139,168,143,0.03); border: 1px solid var(--border-color); border-radius:12px; padding:10px 14px; font-size:13px;">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-weight:600;">${escapeHtml(evt.title)}</span>
          <span style="font-size:10px; color:var(--text-muted);">From ${escapeHtml(evt.walletName)} • Due ${escapeHtml(dateFormatted)}</span>
        </div>
        <div style="text-align:right;">
          <span class="tx-amount-cell ${evt.type === 'income' ? 'amount-income' : 'amount-expense'}">
            ${evt.type === 'income' ? '+' : '-'}${amountStr}
          </span>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

/**
 * Wallets Tab Rendering
 */
