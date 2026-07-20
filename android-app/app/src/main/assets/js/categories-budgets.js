/**
 * Midori — Premium Finance Ledger App
 * categories-budgets.js: Category/tag rendering, budget periods & CRUD.
 */

let budgetPeriod = 'monthly';

function switchBudgetPeriod(period) {
  budgetPeriod = period;
  renderBudgets();
}

function renderBudgets() {
  const container = document.getElementById('budgetsContainer');
  if (!container) return;
  container.innerHTML = '';

  const baseCurrency = MidoriState.preferences.baseCurrency;
  const vDate = new Date(MidoriState.virtualDate);
  const month = vDate.getMonth();
  const year = vDate.getFullYear();

  // Show all expense categories that are marked included in budget panel
  const budgetedCats = MidoriState.categories.filter(c => c.type === 'expense' && c.includeInBudget);

  if (budgetedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
        <span>No budgets set yet. To set a budget, edit category tag limits below or check "Include in Budgets Panel" when creating/editing tags!</span>
      </div>
    `;
    return;
  }

  budgetedCats.forEach(cat => {
    let spent = 0;
    MidoriState.transactions.forEach(tx => {
      if (tx.scheduledId && tx.date > MidoriState.virtualDate) return; // Strict time-travel rollback filter!
      if (tx.categoryId === cat.id && tx.type === 'expense') {
        const txDate = new Date(tx.date);
        const inPeriod = budgetPeriod === 'monthly'
          ? (txDate.getMonth() === month && txDate.getFullYear() === year)
          : (txDate.getFullYear() === year);
        if (inPeriod) {
          spent += convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
        }
      }
    });

    const budgetLimit = budgetPeriod === 'monthly' ? cat.budget : cat.yearlyBudget;
    const ratio = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
    
    let statusClass = 'status-safe';
    let warningText = 'Budget Normal';
    
    if (budgetLimit > 0) {
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
    } else {
      warningText = 'No Limit Set';
    }

    const iconSvg = SVG_ICONS[cat.icon] || SVG_ICONS.leaf;
    const limitDisplay = budgetLimit > 0 ? formatCurrency(budgetLimit, baseCurrency) : 'Not Set';
    const periodLabel = budgetPeriod === 'monthly' ? 'Monthly' : 'Yearly';

    const html = `
      <div class="budget-card">
        <div class="budget-info">
          <div class="budget-tag-pill">
            <div class="tag-icon-wrap" style="background-color: ${escapeHtml(cat.color)};">
              ${iconSvg}
            </div>
            <div>
              <div style="font-weight:700;">${escapeHtml(cat.name)}</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">${escapeHtml(cat.type)}</div>
            </div>
          </div>
          <div class="budget-limits-numbers">
            <div class="budget-spent">${formatCurrency(spent, baseCurrency)}</div>
            <div class="budget-max">${periodLabel} Limit: ${limitDisplay}</div>
          </div>
        </div>
        
        <div class="budget-progress-container">
          <div class="budget-progress-bar">
            <div class="budget-progress-fill ${statusClass}" style="width: ${budgetLimit > 0 ? Math.min(100, ratio) : 0}%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-top:2px;">
            <span>${budgetLimit > 0 ? `${ratio.toFixed(0)}% utilized` : 'No limits assigned'}</span>
            <span class="${statusClass}" style="font-weight:600;">${warningText}</span>
          </div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; font-size:12px;">
          <span style="color:var(--text-muted);">ID: ${escapeHtml(cat.id.split('_')[1] || cat.id)}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="wallet-edit-btn" data-action="openEditBudgetModal" data-arg="${escapeHtml(cat.id)}" title="Edit Budget Limits" style="color:var(--text-muted); background:none; border:none; cursor:pointer; display:inline-flex; align-items:center; padding:2px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
            </button>
            <button class="wallet-delete-btn" data-action="triggerCategoryDelete" data-arg="${escapeHtml(cat.id)}" title="Delete Tag" style="color:var(--text-muted); background:none; border:none; cursor:pointer; display:inline-flex; align-items:center; padding:2px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

function openEditBudgetModal(categoryId) {
  const cat = MidoriState.categories.find(c => c.id === categoryId);
  if (!cat) return;

  document.getElementById('editBudgetCategoryId').value = cat.id;
  document.getElementById('editBudgetCategoryLabel').innerText = `Category: ${cat.name}`;
  document.getElementById('editBudgetMonthly').value = cat.budget !== null ? cat.budget : '';
  document.getElementById('editBudgetYearly').value = cat.yearlyBudget !== null ? cat.yearlyBudget : '';

  openModal('modalEditBudget');
}

function submitEditBudgetForm(e) {
  e.preventDefault();

  const id = document.getElementById('editBudgetCategoryId').value;
  const monthlyVal = document.getElementById('editBudgetMonthly').value;
  const yearlyVal = document.getElementById('editBudgetYearly').value;

  const updatedFields = {
    budget: monthlyVal ? Number(monthlyVal) : null,
    yearlyBudget: yearlyVal ? Number(yearlyVal) : null
  };

  updateCategory(id, updatedFields);
  closeModal('modalEditBudget');
  renderAllViews();
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
      if (tx.scheduledId && tx.date > MidoriState.virtualDate) return; // Strict time-travel rollback filter!
      if (tx.categoryId === cat.id) {
        const txDate = new Date(tx.date);
        if (txDate.getMonth() === month && txDate.getFullYear() === year) {
          spent += convertAmount(tx.amount, getTxCurrency(tx, baseCurrency), baseCurrency);
        }
      }
    });

    const isExpense = cat.type === 'expense';
    const includedInBudget = cat.includeInBudget;
    const iconSvg = SVG_ICONS[cat.icon] || SVG_ICONS.leaf;

    const html = `
      <div class="budget-card">
        <div class="budget-info">
          <div class="budget-tag-pill">
            <div class="tag-icon-wrap" style="background-color: ${escapeHtml(cat.color)};">
              ${iconSvg}
            </div>
            <div>
              <div style="font-weight:700;">${escapeHtml(cat.name)}</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">${escapeHtml(cat.type)}</div>
            </div>
          </div>
          <div class="budget-limits-numbers">
            <div class="budget-spent">${formatCurrency(spent, baseCurrency)}</div>
            <div class="budget-max">
              ${isExpense ? (includedInBudget ? 'Budget Included: Yes' : 'Budget Included: No') : 'Monthly Income'}
            </div>
          </div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; font-size:12px; margin-top: 10px;">
          <span style="color:var(--text-muted);">ID: ${escapeHtml(cat.id.split('_')[1] || cat.id)}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="wallet-edit-btn" data-action="openEditCategoryModal" data-arg="${escapeHtml(cat.id)}" title="Edit Tag" style="color:var(--text-muted); background:none; border:none; cursor:pointer; display:inline-flex; align-items:center; padding:2px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path></svg>
            </button>
            <button class="wallet-delete-btn" data-action="triggerCategoryDelete" data-arg="${escapeHtml(cat.id)}" title="Delete Tag" style="color:var(--text-muted); background:none; border:none; cursor:pointer; display:inline-flex; align-items:center; padding:2px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
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
function syncCategoryFormBudgetState() {
  const type = document.getElementById('catType').value;
  const checkboxContainer = document.getElementById('catIncludeInBudget').closest('.input-group');
  if (type === 'income') {
    checkboxContainer.style.display = 'none';
    document.getElementById('catIncludeInBudget').checked = false;
  } else {
    checkboxContainer.style.display = 'block';
  }
}

/**
 * Form Submittals & Database Hooks
 */
function openEditCategoryModal(categoryId) {
  const cat = MidoriState.categories.find(c => c.id === categoryId);
  if (!cat) return;

  document.getElementById('editCategoryId').value = cat.id;
  document.getElementById('editCatName').value = cat.name;
  document.getElementById('editCatType').value = cat.type;
  document.getElementById('editCatIcon').value = cat.icon;
  document.getElementById('editCatIncludeInBudget').checked = !!cat.includeInBudget;

  syncEditCategoryFormBudgetState();

  selectedEditCategoryColor = cat.color || '#5a7d5b';
  const chips = document.querySelectorAll('#editCatColorPicker .color-option');
  chips.forEach(chip => {
    if (chip.getAttribute('data-color') === selectedEditCategoryColor) {
      chip.classList.add('selected');
    } else {
      chip.classList.remove('selected');
    }
  });

  openModal('modalEditCategory');
}

function syncEditCategoryFormBudgetState() {
  const type = document.getElementById('editCatType').value;
  const checkboxContainer = document.getElementById('editCatIncludeInBudget').closest('.input-group');
  if (type === 'income') {
    checkboxContainer.style.display = 'none';
    document.getElementById('editCatIncludeInBudget').checked = false;
  } else {
    checkboxContainer.style.display = 'block';
  }
}

function submitEditCategoryForm(e) {
  e.preventDefault();
  clearFormError('editCategoryForm');

  const nameValue = document.getElementById('editCatName').value;
  if (!validateRequiredText(nameValue)) {
    return showFormError('editCategoryForm', 'Category name is required.');
  }

  const id = document.getElementById('editCategoryId').value;
  const updatedFields = {
    name: nameValue.trim(),
    type: document.getElementById('editCatType').value,
    icon: document.getElementById('editCatIcon').value,
    color: selectedEditCategoryColor,
    includeInBudget: document.getElementById('editCatIncludeInBudget').checked
  };

  updateCategory(id, updatedFields);
  closeModal('modalEditCategory');
}

function submitCategoryForm(e) {
  e.preventDefault();
  clearFormError('categoryForm');

  const nameValue = document.getElementById('catName').value;
  if (!validateRequiredText(nameValue)) {
    return showFormError('categoryForm', 'Category name is required.');
  }

  const category = {
    name: nameValue.trim(),
    type: document.getElementById('catType').value,
    icon: document.getElementById('catIcon').value,
    color: selectedCategoryColor,
    includeInBudget: document.getElementById('catIncludeInBudget').checked,
    budget: null,
    yearlyBudget: null
  };

  addCategory(category);
  
  document.getElementById('categoryForm').reset();
  closeModal('modalCategory');
}

