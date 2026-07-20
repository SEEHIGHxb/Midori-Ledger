/**
 * Midori — Premium Finance Ledger App
 * charts.js: Chart.js Management & Theme-Responsive Visualizations
 */

let trendChartInstance = null;
let expenseDonutInstance = null;
let incomeDonutInstance = null;

// Get color variables depending on light/dark mode
function getThemeColors() {
  const isDark = MidoriState.preferences.theme === 'dark';
  return {
    text: isDark ? '#b5cbb7' : '#2d5a27',
    grid: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
    tooltipBg: isDark ? 'rgba(20, 30, 20, 0.85)' : 'rgba(240, 245, 240, 0.95)',
    tooltipText: isDark ? '#e2ebd5' : '#1e381b',
    incomeColor: '#4d9c4e', // Mossy green
    incomeGrad: isDark ? 'rgba(77, 156, 78, 0.2)' : 'rgba(77, 156, 78, 0.1)',
    expenseColor: '#e07a5f', // Terracotta autumn color
    expenseGrad: isDark ? 'rgba(224, 122, 95, 0.2)' : 'rgba(224, 122, 95, 0.1)'
  };
}

// Format months array helper for the last 6 months
function getLast6MonthsLabels() {
  const months = [];
  const virtualDate = new Date(MidoriState.virtualDate);
  
  for (let i = 5; i >= 0; i--) {
    const d = new Date(virtualDate);
    d.setMonth(d.getMonth() - i);
    const monthName = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    months.push({
      label: `${monthName} ${year}`,
      month: d.getMonth(),
      year: d.getFullYear()
    });
  }
  return months;
}

// Build and Update All Charts
function updateCharts() {
  const isChartJsLoaded = typeof Chart !== 'undefined';
  if (!isChartJsLoaded) {
    console.warn('Chart.js is not loaded yet.');
    return;
  }

  const baseCurrency = MidoriState.preferences.baseCurrency;
  const themeColors = getThemeColors();
  
  renderTrendChart(themeColors, baseCurrency);
  renderExpenseDonut(themeColors, baseCurrency);
  renderIncomeDonut(themeColors, baseCurrency);
}

// 1. Line Chart: 6-Month Cash Flow Trend
function renderTrendChart(colors, baseCurrency) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const monthInfo = getLast6MonthsLabels();
  
  const incomeData = new Array(6).fill(0);
  const expenseData = new Array(6).fill(0);

  // Distribute transactions to corresponding month indices
  MidoriState.transactions.forEach(tx => {
    if (tx.scheduledId && tx.date > MidoriState.virtualDate) return;
    const txDate = new Date(tx.date);
    const txMonth = txDate.getMonth();
    const txYear = txDate.getFullYear();
    
    const mIndex = monthInfo.findIndex(m => m.month === txMonth && m.year === txYear);
    if (mIndex !== -1) {
      const converted = convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
      
      if (tx.type === 'income') {
        incomeData[mIndex] += converted;
      } else if (tx.type === 'expense') {
        expenseData[mIndex] += converted;
      }
    }
  });

  const labels = monthInfo.map(m => m.label);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: `Income (${baseCurrency})`,
          data: incomeData,
          borderColor: colors.incomeColor,
          backgroundColor: colors.incomeGrad,
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointBackgroundColor: colors.incomeColor,
          pointBorderColor: 'transparent',
          pointHoverRadius: 7
        },
        {
          label: `Expense (${baseCurrency})`,
          data: expenseData,
          borderColor: colors.expenseColor,
          backgroundColor: colors.expenseGrad,
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointBackgroundColor: colors.expenseColor,
          pointBorderColor: 'transparent',
          pointHoverRadius: 7
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: colors.text, font: { family: 'Outfit, sans-serif', size: 12 } }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          borderColor: 'rgba(90, 125, 91, 0.2)',
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label.split(' ')[0]}: ${formatCurrency(context.raw, baseCurrency)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: colors.grid },
          ticks: { color: colors.text, font: { family: 'Outfit, sans-serif' } }
        },
        y: {
          grid: { color: colors.grid },
          ticks: {
            color: colors.text,
            font: { family: 'Outfit, sans-serif' },
            callback: function(value) {
              return CURRENCIES[baseCurrency].symbol + Number(value).toLocaleString();
            }
          }
        }
      }
    }
  });
}

// 2. Donut Chart: Expense Breakdown
function renderExpenseDonut(colors, baseCurrency) {
  const canvas = document.getElementById('expenseDonut');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  
  const categoryTotals = {};
  
  MidoriState.categories.forEach(cat => {
    if (cat.type === 'expense') {
      categoryTotals[cat.id] = {
        name: cat.name,
        color: cat.color,
        amount: 0
      };
    }
  });

  MidoriState.transactions.forEach(tx => {
    if (tx.scheduledId && tx.date > MidoriState.virtualDate) return;
    if (tx.type === 'expense' && categoryTotals[tx.categoryId]) {
      const converted = convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
      categoryTotals[tx.categoryId].amount += converted;
    }
  });

  const activeData = Object.values(categoryTotals).filter(item => item.amount > 0);
  
  const labels = activeData.map(d => d.name);
  const data = activeData.map(d => d.amount);
  const bgColors = activeData.map(d => d.color);

  if (expenseDonutInstance) {
    expenseDonutInstance.destroy();
  }

  if (data.length === 0) {
    renderEmptyDonut(ctx, 'No Expenses Logged', colors);
    return;
  }

  expenseDonutInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: colors.text, font: { family: 'Outfit, sans-serif', size: 11 } }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((val / total) * 100).toFixed(1);
              return ` Spent: ${formatCurrency(val, baseCurrency)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// 3. Donut Chart: Income Breakdown
function renderIncomeDonut(colors, baseCurrency) {
  const canvas = document.getElementById('incomeDonut');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  
  const categoryTotals = {};
  
  MidoriState.categories.forEach(cat => {
    if (cat.type === 'income') {
      categoryTotals[cat.id] = {
        name: cat.name,
        color: cat.color,
        amount: 0
      };
    }
  });

  MidoriState.transactions.forEach(tx => {
    if (tx.scheduledId && tx.date > MidoriState.virtualDate) return;
    if (tx.type === 'income' && categoryTotals[tx.categoryId]) {
      const converted = convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
      categoryTotals[tx.categoryId].amount += converted;
    }
  });

  const activeData = Object.values(categoryTotals).filter(item => item.amount > 0);
  
  const labels = activeData.map(d => d.name);
  const data = activeData.map(d => d.amount);
  const bgColors = activeData.map(d => d.color);

  if (incomeDonutInstance) {
    incomeDonutInstance.destroy();
  }

  if (data.length === 0) {
    renderEmptyDonut(ctx, 'No Income Logged', colors);
    return;
  }

  incomeDonutInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: colors.text, font: { family: 'Outfit, sans-serif', size: 11 } }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((val / total) * 100).toFixed(1);
              return ` Earned: ${formatCurrency(val, baseCurrency)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

function renderEmptyDonut(ctx, message, colors) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const cx = ctx.canvas.width / 2;
  const cy = ctx.canvas.height / 2;
  
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 4;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  
  ctx.fillStyle = colors.text;
  ctx.font = '12px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, cx, cy);
}
