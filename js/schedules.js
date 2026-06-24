/**
 * Midori — Premium Finance Ledger App
 * schedules.js: Recurring schedule rendering, create/edit/delete CRUD.
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

    const isExpired = sched.endDate && (sched.nextDueDate > sched.endDate);
    const nextOccurrenceText = isExpired ? '<span style="color:var(--autumn-terracotta);">Ended (Expired)</span>' : formatDisplayDate(sched.nextDueDate);
    const endDateText = sched.endDate ? ` • Ends: ${formatDisplayDate(sched.endDate)}` : '';

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
              Started: ${formatDisplayDate(sched.startDate)}${endDateText} • <b>Next Auto-Occurrence: ${nextOccurrenceText}</b>
            </span>
          </div>
        </div>
        <div class="sched-finances">
          <span class="sched-amount ${isIncome ? 'amount-income' : 'amount-expense'}">
            ${isIncome ? '+' : '-'}${formattedAmount}
          </span>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="btn-secondary" onclick="toggleScheduleActive('${sched.id}')" style="padding:6px 12px; font-size:12px;" ${isExpired ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
              ${sched.active ? 'Pause' : 'Resume'}
            </button>
            <button class="btn-secondary" onclick="openEditScheduleModal('${sched.id}')" title="Edit Schedule" style="padding:6px; display:inline-flex; align-items:center; justify-content:center;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path></svg>
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
function openEditScheduleModal(schedId) {
  const sched = MidoriState.schedules.find(s => s.id === schedId);
  if (!sched) return;

  document.getElementById('editSchedId').value = sched.id;
  document.getElementById('editSchedTitle').value = sched.title;
  document.getElementById('editSchedAmount').value = sched.amount;
  document.getElementById('editSchedType').value = sched.type;
  document.getElementById('editSchedFrequency').value = sched.frequency;
  document.getElementById('editSchedStartDate').value = sched.startDate;
  document.getElementById('editSchedEndDate').value = sched.endDate || '';

  // Populate wallets dropdown
  const editSchedWallet = document.getElementById('editSchedWallet');
  editSchedWallet.innerHTML = '';
  MidoriState.wallets.forEach(w => {
    editSchedWallet.insertAdjacentHTML('beforeend', `<option value="${w.id}">${w.name} (${w.currency})</option>`);
  });
  editSchedWallet.value = sched.walletId;

  // Populate category tags
  syncEditScheduleCategoryOptions();
  document.getElementById('editSchedCategory').value = sched.categoryId;

  openModal('modalEditSchedule');
}

function syncEditScheduleCategoryOptions() {
  const type = document.getElementById('editSchedType').value;
  const select = document.getElementById('editSchedCategory');
  select.innerHTML = '';

  MidoriState.categories
    .filter(c => c.type === type)
    .forEach(c => {
      select.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.name}</option>`);
    });
}

function submitEditScheduleForm(e) {
  e.preventDefault();
  clearFormError('editScheduleForm');

  const titleValue = document.getElementById('editSchedTitle').value;
  const amountValue = document.getElementById('editSchedAmount').value;
  if (!validateRequiredText(titleValue)) {
    return showFormError('editScheduleForm', 'Title is required.');
  }
  if (!validateAmount(amountValue)) {
    return showFormError('editScheduleForm', 'Amount must be a positive number.');
  }

  const id = document.getElementById('editSchedId').value;
  const updatedFields = {
    title: titleValue.trim(),
    amount: Number(amountValue),
    type: document.getElementById('editSchedType').value,
    walletId: document.getElementById('editSchedWallet').value,
    categoryId: document.getElementById('editSchedCategory').value,
    frequency: document.getElementById('editSchedFrequency').value,
    startDate: document.getElementById('editSchedStartDate').value,
    nextDueDate: document.getElementById('editSchedStartDate').value,
    endDate: document.getElementById('editSchedEndDate').value || null
  };

  updateSchedule(id, updatedFields);
  closeModal('modalEditSchedule');
}

function submitScheduleForm(e) {
  e.preventDefault();
  clearFormError('scheduleForm');

  const titleValue = document.getElementById('schedTitle').value;
  const amountValue = document.getElementById('schedAmount').value;
  if (!validateRequiredText(titleValue)) {
    return showFormError('scheduleForm', 'Title is required.');
  }
  if (!validateAmount(amountValue)) {
    return showFormError('scheduleForm', 'Amount must be a positive number.');
  }

  const schedule = {
    title: titleValue.trim(),
    amount: Number(amountValue),
    type: document.getElementById('schedType').value,
    walletId: document.getElementById('schedWallet').value,
    categoryId: document.getElementById('schedCategory').value,
    frequency: document.getElementById('schedFrequency').value,
    startDate: document.getElementById('schedStartDate').value,
    nextDueDate: document.getElementById('schedStartDate').value,
    endDate: document.getElementById('schedEndDate').value || null
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
