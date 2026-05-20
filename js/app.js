/**
 * Midori — Premium Finance Ledger App
 * app.js: DOM Binding, UI Controllers & Aggregate Metric Analytics
 */

// UI State cache
let activeTab = 'dashboard';
let selectedWalletColor = '#2d5a27';
let selectedCategoryColor = '#5a7d5b';
let selectedEditWalletColor = '#2d5a27';

// On page load initialization
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial State Load
  if (MidoriState.wallets.length === 0) {
    // Generate dummy data on absolute fresh start so the user has immediate visual enjoyment
    generateMatchaDummyData();
  }
  
  // 2. Set base inputs and indicators
  document.getElementById('baseCurrencySelect').value = MidoriState.preferences.baseCurrency;
  setVirtualDateInputDefaults();
  
  // 3. Register Global Event Listeners
  window.addEventListener('midoriStateChanged', handleStateChange);
  
  // 4. Set theme on load
  applyTheme(MidoriState.preferences.theme);
  
  // 5. Initialize Navigation
  setupNavigation();
  
  // 6. Setup Form Color Pickers
  setupFormColorPickers();
  
  // 7. Initial render
  renderAllViews();
  
  // 8. Auto-load dropdown option lists
  syncTransactionCategoryOptions();
  syncScheduleCategoryOptions();
  populateDropdowns();
});

// Sync time inputs
function setVirtualDateInputDefaults() {
  document.getElementById('txDate').value = MidoriState.virtualDate;
  document.getElementById('schedStartDate').value = MidoriState.virtualDate;
}

// Global state modification handler
function handleStateChange() {
  renderAllViews();
}

function renderAllViews() {
  // Display virtual date in header
  document.getElementById('virtualDateDisplay').innerText = MidoriState.virtualDate;
  
  // Re-run aggregate analytics & redraw graphs
  renderDashboardMetrics();
  updateCharts();
  
  // Render active tab elements
  renderWallets();
  renderBudgets();
  renderTags();
  renderLedger();
  renderSchedules();
  
  // Update form selector details
  syncTransactionCategoryOptions();
  syncScheduleCategoryOptions();
  populateDropdowns();
}

/**
 * Navigation & Tab Swapping
 */
function setupNavigation() {
  const links = document.querySelectorAll('.nav-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('data-tab');
      
      // Update UI active links
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      // Swap content tabs
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
      });
      document.getElementById(`tab-${target}`).classList.add('active');
      
      activeTab = target;
      
      // Trigger chart refresh if returning to dashboard
      if (target === 'dashboard') {
        setTimeout(updateCharts, 50);
      }
    });
  });

  // Theme switch click
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const currentTheme = MidoriState.preferences.theme;
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    updatePreference('theme', newTheme);
    applyTheme(newTheme);
    updateCharts();
  });
}

function applyTheme(theme) {
  const body = document.body;
  const toggleBtnText = document.getElementById('themeToggleText');
  const toggleBtnIcon = document.getElementById('themeToggleIcon');
  
  const moonIcon = `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  const sunIcon = `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;

  if (theme === 'light') {
    body.classList.add('light-theme');
    toggleBtnText.innerText = 'Light Mode';
    toggleBtnIcon.innerHTML = sunIcon;
  } else {
    body.classList.remove('light-theme');
    toggleBtnText.innerText = 'Dark Mode';
    toggleBtnIcon.innerHTML = moonIcon;
  }
}

/**
 * Aggregate Analytics: Dashboard Tab
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
    const txDate = new Date(tx.date);
    if (txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear) {
      // Find wallet currency
      const wallet = MidoriState.wallets.find(w => w.id === tx.walletId);
      const currency = wallet ? wallet.currency : baseCurrency;
      const converted = convertAmount(tx.amount, currency, baseCurrency);

      if (tx.type === 'income') {
        monthlyIncome += converted;
      } else {
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

  // Get active budgets
  const budgetedCats = MidoriState.categories.filter(c => c.type === 'expense' && c.budget > 0);
  
  if (budgetedCats.length === 0) {
    container.innerHTML = `<div class="metric-desc" style="padding:10px 0;">No category budgets are set. Create a monthly limit tag in the Budgets tab!</div>`;
    return;
  }

  // Sum spending for each budget tag in current month
  let renderedAlertsCount = 0;
  budgetedCats.forEach(cat => {
    let spent = 0;
    
    MidoriState.transactions.forEach(tx => {
      if (tx.type === 'expense' && tx.categoryId === cat.id) {
        const txDate = new Date(tx.date);
        if (txDate.getMonth() === month && txDate.getFullYear() === year) {
          const wallet = MidoriState.wallets.find(w => w.id === tx.walletId);
          const currency = wallet ? wallet.currency : baseCurrency;
          spent += convertAmount(tx.amount, currency, baseCurrency);
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
      alertMsg = 'EXCEEDED';
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
            <span style="width:8px; height:8px; border-radius:50%; background-color:${cat.color};"></span>
            ${cat.name}
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
          <span style="font-weight:600;">${evt.title}</span>
          <span style="font-size:10px; color:var(--text-muted);">From ${evt.walletName} • Due ${dateFormatted}</span>
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
function renderWallets() {
  const container = document.getElementById('walletsContainer');
  if (!container) return;
  container.innerHTML = '';

  if (MidoriState.wallets.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
        <span>No wallets are created yet. Click "Add New Wallet" to begin!</span>
      </div>
    `;
    return;
  }

  MidoriState.wallets.forEach((wallet, index) => {
    const cardGradientIdx = (index % 3) + 1; // rotation of beautiful gradients
    const formattedBalance = formatCurrency(wallet.balance, wallet.currency);
    
    // Simple mock credit card numbers for aesthetic realism
    const maskedCardNo = `**** **** **** ${1024 + index * 12}`;

    const cardHTML = `
      <div class="wallet-card" style="background: linear-gradient(135deg, ${wallet.color} 0%, rgba(20,40,20,0.85) 100%);">
        <div class="wallet-card-header">
          <div>
            <div class="wallet-name-label">${wallet.name}</div>
            <div style="font-size: 10px; opacity:0.6; margin-top:2px;">${maskedCardNo}</div>
          </div>
          <span class="wallet-type-badge">${wallet.type}</span>
        </div>
        <div class="wallet-balance-display">${formattedBalance}</div>
        <div class="wallet-card-footer">
          <span>Currency: ${wallet.currency}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="wallet-edit-btn" onclick="openEditWalletModal('${wallet.id}')" title="Edit Wallet" style="background:none; border:none; color:white; opacity:0.8; cursor:pointer; display:inline-flex; align-items:center; padding:4px; transition: opacity 0.2s;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path></svg>
            </button>
            <button class="wallet-delete-btn" onclick="triggerWalletDelete('${wallet.id}')" title="Delete Wallet">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', cardHTML);
  });
}

function triggerWalletDelete(id) {
  if (confirm('Are you sure you want to delete this wallet? All associated transaction histories will be lost!')) {
    deleteWallet(id);
  }
}

function renderBudgets() {
  const container = document.getElementById('budgetsContainer');
  if (!container) return;
  container.innerHTML = '';

  const baseCurrency = MidoriState.preferences.baseCurrency;
  const vDate = new Date(MidoriState.virtualDate);
  const month = vDate.getMonth();
  const year = vDate.getFullYear();

  const budgetedCats = MidoriState.categories.filter(c => c.type === 'expense' && c.budget > 0);

  if (budgetedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
        <span>No budgets set yet. To set a budget, create or edit a category tag with a limit in the Category Tags tab!</span>
      </div>
    `;
    return;
  }

  budgetedCats.forEach(cat => {
    let spent = 0;
    MidoriState.transactions.forEach(tx => {
      if (tx.categoryId === cat.id && tx.type === 'expense') {
        const txDate = new Date(tx.date);
        if (txDate.getMonth() === month && txDate.getFullYear() === year) {
          const wallet = MidoriState.wallets.find(w => w.id === tx.walletId);
          const currency = wallet ? wallet.currency : baseCurrency;
          spent += convertAmount(tx.amount, currency, baseCurrency);
        }
      }
    });

    const budgetLimit = cat.budget;
    const ratio = (spent / budgetLimit) * 100;
    
    let statusClass = 'status-safe';
    let warningText = 'Budget Normal';
    
    if (ratio >= 100) {
      statusClass = 'status-danger';
      warningText = 'EXCEEDED!';
    } else if (ratio >= 80) {
      statusClass = 'status-danger';
      warningText = 'Caution (Over 80%)';
    } else if (ratio >= 60) {
      statusClass = 'status-warn';
      warningText = 'Approaching Warning';
    }

    const iconSvg = SVG_ICONS[cat.icon] || SVG_ICONS.leaf;

    const html = `
      <div class="budget-card">
        <div class="budget-info">
          <div class="budget-tag-pill">
            <div class="tag-icon-wrap" style="background-color: ${cat.color};">
              ${iconSvg}
            </div>
            <div>
              <div style="font-weight:700;">${cat.name}</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">${cat.type}</div>
            </div>
          </div>
          <div class="budget-limits-numbers">
            <div class="budget-spent">${formatCurrency(spent, baseCurrency)}</div>
            <div class="budget-max">Limit: ${formatCurrency(budgetLimit, baseCurrency)}</div>
          </div>
        </div>
        
        <div class="budget-progress-container">
          <div class="budget-progress-bar">
            <div class="budget-progress-fill ${statusClass}" style="width: ${Math.min(100, ratio)}%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-top:2px;">
            <span>${ratio.toFixed(0)}% utilized</span>
            <span class="${statusClass}" style="font-weight:600;">${warningText}</span>
          </div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; font-size:12px;">
          <span style="color:var(--text-muted);">ID: ${cat.id.split('_')[1] || cat.id}</span>
          <button class="wallet-delete-btn" onclick="triggerCategoryDelete('${cat.id}')" title="Delete Tag" style="color:var(--text-muted);">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

function renderTags() {
  const container = document.getElementById('tagsContainer');
  if (!container) return;
  container.innerHTML = '';

  const baseCurrency = MidoriState.preferences.baseCurrency;
  const vDate = new Date(MidoriState.virtualDate);
  const month = vDate.getMonth();
  const year = vDate.getFullYear();

  if (MidoriState.categories.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
        <span>No category tags created yet. Click "Create New Tag" to begin!</span>
      </div>
    `;
    return;
  }

  MidoriState.categories.forEach(cat => {
    let spent = 0;
    MidoriState.transactions.forEach(tx => {
      if (tx.categoryId === cat.id) {
        const txDate = new Date(tx.date);
        if (txDate.getMonth() === month && txDate.getFullYear() === year) {
          const wallet = MidoriState.wallets.find(w => w.id === tx.walletId);
          const currency = wallet ? wallet.currency : baseCurrency;
          spent += convertAmount(tx.amount, currency, baseCurrency);
        }
      }
    });

    const isExpense = cat.type === 'expense';
    const hasBudget = isExpense && cat.budget > 0;
    const iconSvg = SVG_ICONS[cat.icon] || SVG_ICONS.leaf;

    const html = `
      <div class="budget-card">
        <div class="budget-info">
          <div class="budget-tag-pill">
            <div class="tag-icon-wrap" style="background-color: ${cat.color};">
              ${iconSvg}
            </div>
            <div>
              <div style="font-weight:700;">${cat.name}</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">${cat.type}</div>
            </div>
          </div>
          <div class="budget-limits-numbers">
            <div class="budget-spent">${formatCurrency(spent, baseCurrency)}</div>
            <div class="budget-max">
              ${hasBudget ? `Budget: ${formatCurrency(cat.budget, baseCurrency)}` : (isExpense ? 'No Limit Set' : 'Monthly Income')}
            </div>
          </div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; font-size:12px; margin-top: 10px;">
          <span style="color:var(--text-muted);">ID: ${cat.id.split('_')[1] || cat.id}</span>
          <button class="wallet-delete-btn" onclick="triggerCategoryDelete('${cat.id}')" title="Delete Tag" style="color:var(--text-muted);">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

function triggerCategoryDelete(id) {
  if (confirm('Delete this Category Tag? Active transactions linked to it will lose category bindings.')) {
    deleteCategory(id);
  }
}

/**
 * Ledger History Tab Rendering
 */
function renderLedger() {
  const tbody = document.getElementById('ledgerTableBody');
  const emptyState = document.getElementById('ledgerEmptyState');
  if (!tbody) return;
  
  tbody.innerHTML = '';

  // Get search criteria
  const searchVal = document.getElementById('filterSearch').value.toLowerCase();
  const filterWalletId = document.getElementById('filterWallet').value;
  const filterTagId = document.getElementById('filterTag').value;
  const filterType = document.getElementById('filterType').value;

  // Filter
  const filtered = MidoriState.transactions.filter(tx => {
    const matchesSearch = tx.title.toLowerCase().includes(searchVal) || (tx.note && tx.note.toLowerCase().includes(searchVal));
    const matchesWallet = filterWalletId === 'all' || tx.walletId === filterWalletId;
    const matchesTag = filterTagId === 'all' || tx.categoryId === filterTagId;
    const matchesType = filterType === 'all' || tx.type === filterType;
    return matchesSearch && matchesWallet && matchesTag && matchesType;
  });

  // Sort descending by date
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    return;
  } else {
    emptyState.style.display = 'none';
  }

  filtered.forEach(tx => {
    const wallet = MidoriState.wallets.find(w => w.id === tx.walletId);
    const category = MidoriState.categories.find(c => c.id === tx.categoryId);

    const walletName = wallet ? wallet.name : 'Unknown Wallet';
    const walletCurrency = wallet ? wallet.currency : 'USD';
    const catName = category ? category.name : 'Uncategorized';
    const catColor = category ? category.color : '#8ba88f';
    const catIcon = category ? category.icon : 'leaf';
    const catIconSvg = SVG_ICONS[catIcon] || SVG_ICONS.leaf;

    const formattedAmount = formatCurrency(tx.amount, tx.currency || walletCurrency);
    const isIncome = tx.type === 'income';

    const rowHTML = `
      <tr>
        <td style="font-weight:600; font-family:'Outfit'; white-space:nowrap;">${tx.date}</td>
        <td>
          <div class="tx-title-cell">
            <span class="tx-title-main">${tx.title}</span>
            ${tx.note ? `<span class="tx-title-note">${tx.note}</span>` : ''}
          </div>
        </td>
        <td>
          <span class="badge-tag">
            <span style="display:inline-flex; width:14px; height:14px; color:${catColor};">${catIconSvg}</span>
            <span>${catName}</span>
          </span>
        </td>
        <td>
          <span class="badge-wallet" style="border-left: 3px solid ${wallet ? wallet.color : 'transparent'};">
            ${walletName} <span style="font-size:9px; opacity:0.6; margin-left:4px;">${walletCurrency}</span>
          </span>
        </td>
        <td class="tx-amount-cell ${isIncome ? 'amount-income' : 'amount-expense'}">
          ${isIncome ? '+' : '-'}${formattedAmount}
        </td>
        <td>
          <button class="btn-icon-danger" onclick="triggerTransactionDelete('${tx.id}')" title="Delete record">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', rowHTML);
  });
}

function triggerTransactionDelete(id) {
  if (confirm('Delete this ledger transaction? This will adjust your wallet balance backwards.')) {
    deleteTransaction(id);
  }
}

/**
 * Scheduled Recurring Transactions Tab
 */
function renderSchedules() {
  const container = document.getElementById('schedulesContainer');
  if (!container) return;
  container.innerHTML = '';

  if (MidoriState.schedules.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>No recurring schedules set up yet. Establish schedules to auto-deposit or pay over time!</span>
      </div>
    `;
    return;
  }

  MidoriState.schedules.forEach(sched => {
    const wallet = MidoriState.wallets.find(w => w.id === sched.walletId);
    const category = MidoriState.categories.find(c => c.id === sched.categoryId);

    const walletName = wallet ? wallet.name : 'Unknown';
    const currency = wallet ? wallet.currency : 'JPY';
    const catName = category ? category.name : 'Uncategorized';
    
    const formattedAmount = formatCurrency(sched.amount, currency);
    const isIncome = sched.type === 'income';

    const itemHTML = `
      <div class="schedule-item" style="border-left: 4px solid ${sched.active ? 'var(--green-matcha)' : 'var(--border-color)'};">
        <div class="schedule-meta">
          <span class="sched-frequency-badge">${sched.frequency}</span>
          <div class="sched-details">
            <span class="sched-title">${sched.title}</span>
            <span class="sched-sub">
              Pay Wallet: <b>${walletName}</b> • Tag: <b>${catName}</b>
            </span>
            <span class="sched-sub" style="font-size:10px; margin-top:2px;">
              Started: ${sched.startDate} • <b>Next Auto-Occurrence: ${sched.nextDueDate}</b>
            </span>
          </div>
        </div>
        <div class="sched-finances">
          <span class="sched-amount ${isIncome ? 'amount-income' : 'amount-expense'}">
            ${isIncome ? '+' : '-'}${formattedAmount}
          </span>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="btn-secondary" onclick="toggleScheduleActive('${sched.id}')" style="padding:6px 12px; font-size:12px;">
              ${sched.active ? 'Pause' : 'Resume'}
            </button>
            <button class="btn-icon-danger" onclick="triggerScheduleDelete('${sched.id}')">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', itemHTML);
  });
}

function toggleScheduleActive(id) {
  const sched = MidoriState.schedules.find(s => s.id === id);
  if (sched) {
    updateSchedule(id, { active: !sched.active });
  }
}

function triggerScheduleDelete(id) {
  if (confirm('Permanently cancel this recurring scheduled template? Future occurrences will stop executing.')) {
    deleteSchedule(id);
  }
}

/**
 * Dropdowns Sync Helpers
 */
function populateDropdowns() {
  const txWallet = document.getElementById('txWallet');
  const filterWallet = document.getElementById('filterWallet');
  const schedWallet = document.getElementById('schedWallet');
  
  const wallets = MidoriState.wallets;
  
  // Save current values if any to preserve selections during rapid loads
  const valTxW = txWallet.value;
  const valFilW = filterWallet.value;
  const valSchW = schedWallet.value;

  // Clear options except defaults
  txWallet.innerHTML = '';
  schedWallet.innerHTML = '';
  
  filterWallet.innerHTML = '<option value="all">All Wallets</option>';

  wallets.forEach(w => {
    const opt = `<option value="${w.id}">${w.name} (${w.currency})</option>`;
    txWallet.insertAdjacentHTML('beforeend', opt);
    schedWallet.insertAdjacentHTML('beforeend', opt);
    filterWallet.insertAdjacentHTML('beforeend', `<option value="${w.id}">${w.name}</option>`);
  });

  // Restore values
  if (valTxW) txWallet.value = valTxW;
  if (valFilW) filterWallet.value = valFilW;
  if (valSchW) schedWallet.value = valSchW;

  // Render tag filter options
  const filterTag = document.getElementById('filterTag');
  const valFilT = filterTag.value;
  
  filterTag.innerHTML = '<option value="all">All Categories</option>';
  MidoriState.categories.forEach(c => {
    filterTag.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.name}</option>`);
  });
  if (valFilT) filterTag.value = valFilT;
}

// Sync Form Category Option Lists based on type (Income vs Expense)
function syncTransactionCategoryOptions() {
  const type = document.getElementById('txType').value;
  const select = document.getElementById('txCategory');
  select.innerHTML = '';

  MidoriState.categories
    .filter(c => c.type === type)
    .forEach(c => {
      select.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.name}</option>`);
    });
}

function syncScheduleCategoryOptions() {
  const type = document.getElementById('schedType').value;
  const select = document.getElementById('schedCategory');
  select.innerHTML = '';

  MidoriState.categories
    .filter(c => c.type === type)
    .forEach(c => {
      select.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.name}</option>`);
    });
}

/**
 * Modals & Color Picker UI Hooks
 */
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
  // Reset date input inside modal to match Virtual System Date automatically!
  setVirtualDateInputDefaults();
  if (modalId === 'modalTransaction') {
    syncTransactionCurrencyDefault();
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function syncTransactionCurrencyDefault() {
  const walletId = document.getElementById('txWallet').value;
  const wallet = MidoriState.wallets.find(w => w.id === walletId);
  if (wallet) {
    document.getElementById('txCurrency').value = wallet.currency;
  }
}

function setupFormColorPickers() {
  // Wallet Color Picker setup
  const walletColorChips = document.querySelectorAll('#walletColorPicker .color-option');
  walletColorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      walletColorChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedWalletColor = chip.getAttribute('data-color');
    });
  });

  // Edit Wallet Color Picker setup
  const editWalletColorChips = document.querySelectorAll('#editWalletColorPicker .color-option');
  editWalletColorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      editWalletColorChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedEditWalletColor = chip.getAttribute('data-color');
    });
  });

  // Category Color Picker setup
  const catColorChips = document.querySelectorAll('#catColorPicker .color-option');
  catColorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      catColorChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedCategoryColor = chip.getAttribute('data-color');
    });
  });
}

// Hide budget limits if creating an Income Tag
function syncCategoryFormBudgetState() {
  const type = document.getElementById('catType').value;
  const group = document.getElementById('categoryBudgetGroup');
  if (type === 'income') {
    group.style.display = 'none';
    document.getElementById('catBudget').value = '';
  } else {
    group.style.display = 'flex';
  }
}

/**
 * Form Submittals & Database Hooks
 */
function submitTransactionForm(e) {
  e.preventDefault();
  
  const tx = {
    title: document.getElementById('txTitle').value,
    amount: Number(document.getElementById('txAmount').value),
    type: document.getElementById('txType').value,
    walletId: document.getElementById('txWallet').value,
    categoryId: document.getElementById('txCategory').value,
    currency: document.getElementById('txCurrency').value,
    date: document.getElementById('txDate').value,
    note: document.getElementById('txNote').value,
    scheduledId: null
  };

  addTransaction(tx);
  
  // Reset form and close
  document.getElementById('transactionForm').reset();
  closeModal('modalTransaction');
}

function submitWalletForm(e) {
  e.preventDefault();
  
  const openingBalance = Number(document.getElementById('walletBalance').value) || 0;
  const wallet = {
    name: document.getElementById('walletName').value,
    currency: document.getElementById('walletCurrency').value,
    type: document.getElementById('walletType').value,
    openingBalance: openingBalance,
    balance: openingBalance,
    color: selectedWalletColor
  };

  addWallet(wallet);
  
  // Re-sync starting balances
  recalculateWalletBalances();
  
  document.getElementById('walletForm').reset();
  closeModal('modalWallet');
}

function openEditWalletModal(walletId) {
  const wallet = MidoriState.wallets.find(w => w.id === walletId);
  if (!wallet) return;

  document.getElementById('editWalletId').value = wallet.id;
  document.getElementById('editWalletName').value = wallet.name;
  document.getElementById('editWalletCurrency').value = wallet.currency;
  document.getElementById('editWalletType').value = wallet.type;
  document.getElementById('editWalletBalance').value = wallet.openingBalance !== undefined ? wallet.openingBalance : wallet.balance;

  selectedEditWalletColor = wallet.color || '#2d5a27';
  const chips = document.querySelectorAll('#editWalletColorPicker .color-option');
  chips.forEach(chip => {
    if (chip.getAttribute('data-color') === selectedEditWalletColor) {
      chip.classList.add('selected');
    } else {
      chip.classList.remove('selected');
    }
  });

  openModal('modalEditWallet');
}

function submitEditWalletForm(e) {
  e.preventDefault();

  const id = document.getElementById('editWalletId').value;
  const openingBalance = Number(document.getElementById('editWalletBalance').value) || 0;
  
  const updatedFields = {
    name: document.getElementById('editWalletName').value,
    currency: document.getElementById('editWalletCurrency').value,
    type: document.getElementById('editWalletType').value,
    openingBalance: openingBalance,
    color: selectedEditWalletColor
  };

  updateWallet(id, updatedFields);
  recalculateWalletBalances();
  closeModal('modalEditWallet');
}

function submitCategoryForm(e) {
  e.preventDefault();
  
  const category = {
    name: document.getElementById('catName').value,
    type: document.getElementById('catType').value,
    icon: document.getElementById('catIcon').value,
    color: selectedCategoryColor,
    budget: document.getElementById('catBudget').value ? Number(document.getElementById('catBudget').value) : null
  };

  addCategory(category);
  
  document.getElementById('categoryForm').reset();
  closeModal('modalCategory');
}

function submitScheduleForm(e) {
  e.preventDefault();

  const schedule = {
    title: document.getElementById('schedTitle').value,
    amount: Number(document.getElementById('schedAmount').value),
    type: document.getElementById('schedType').value,
    walletId: document.getElementById('schedWallet').value,
    categoryId: document.getElementById('schedCategory').value,
    frequency: document.getElementById('schedFrequency').value,
    startDate: document.getElementById('schedStartDate').value,
    nextDueDate: document.getElementById('schedStartDate').value
  };

  addSchedule(schedule);
  
  // Fast process if schedules are back-dated
  processSchedules(MidoriState.virtualDate);

  document.getElementById('scheduleForm').reset();
  closeModal('modalSchedule');
}

/**
 * Top Header Actions: Time Travel & Currency Change
 */
function triggerTimeTravel(days) {
  fastForwardDate(days); // calling scheduler method
}

function changeBaseCurrency(newCurr) {
  updatePreference('baseCurrency', newCurr);
  renderAllViews();
}

/**
 * Settings Actions
 */
function loadMatchaMockData() {
  if (confirm('Populate with preloaded high fidelity transaction values? This resets any custom changes.')) {
    generateMatchaDummyData();
  }
}

function triggerStateExport() {
  const jsonStr = exportStateJSON();
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `midori_backup_${MidoriState.virtualDate}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function triggerStateImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const success = importStateJSON(e.target.result);
    if (success) {
      alert('Database restored successfully from backup.');
    } else {
      alert('Failed to parse backup JSON. Please check file structure.');
    }
  };
  reader.readAsText(file);
}

function triggerStateReset() {
  if (confirm('CAUTION: This will delete all wallets, budgets, schedules, and histories! Are you sure?')) {
    clearDatabase();
  }
}

function triggerDefaultReset() {
  if (confirm('Are you sure you want to restore all wallets, budgets, categories, and preferences to the standard factory default settings? Current custom data will be replaced.')) {
    resetToDefaultState();
    applyTheme(MidoriState.preferences.theme);
    document.getElementById('baseCurrencySelect').value = MidoriState.preferences.baseCurrency;
    renderAllViews();
    alert('App has been reset to standard default settings!');
  }
}
