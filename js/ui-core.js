/**
 * Midori — Premium Finance Ledger App
 * ui-core.js: Navigation, theme, modals, color pickers, time-travel &
 * settings actions, plus the page-load bootstrap sequence.
 */

// UI State cache
let activeTab = 'dashboard';
let selectedWalletColor = '#2d5a27';
let selectedCategoryColor = '#5a7d5b';
let selectedEditWalletColor = '#2d5a27';
let selectedEditCategoryColor = '#5a7d5b';

// Inline form-error display (used by submit handlers instead of alert())
function showFormError(formId, message) {
  const form = document.getElementById(formId);
  if (!form) return;
  let errorEl = form.querySelector('.form-error');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'form-error';
    form.insertBefore(errorEl, form.firstChild);
  }
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function clearFormError(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  const errorEl = form.querySelector('.form-error');
  if (errorEl) errorEl.style.display = 'none';
}

// Non-blocking toast banner (used for storage warnings, etc.)
function showToast(message, durationMs = 6000) {
  let toast = document.getElementById('midoriToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'midoriToast';
    toast.className = 'midori-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), durationMs);
}

window.addEventListener('midoriStorageQuotaExceeded', () => {
  showToast('Storage is full — your latest change was not saved. Please export a backup and free up space.', 8000);
});

function renderFxRatesUpdatedLabel() {
  const label = document.getElementById('fxRatesUpdatedLabel');
  if (!label) return;
  const cache = MidoriState.fxRatesCache;
  if (!cache || !cache.fetchedAt) {
    label.textContent = 'Rates: offline default';
    return;
  }
  const date = new Date(cache.fetchedAt);
  label.textContent = `Rates updated ${date.toLocaleDateString()}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parts[2];
  const monthNum = parseInt(parts[1], 10);
  const year = parts[0];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[monthNum - 1] || parts[1];
  return `${day} ${monthName} ${year}`; // e.g. 20 May 2026
}

// On page load initialization
document.addEventListener('DOMContentLoaded', () => {
  // 0. Finish any Google sign-in that is mid-flight. Google redirects back with
  //    the tokens in the URL fragment, so this MUST run before anything asks
  //    whether the user is signed in — the cloud pull in step 1 does exactly
  //    that, and would give up as "not signed in" on the very load that just
  //    completed the sign-in.
  if (typeof captureSupabaseAuthRedirect === 'function') {
    captureSupabaseAuthRedirect();
  }

  // 0b. If a Google session is present (a returning user, or one who just came
  //     back from the sign-in redirect above), derive this account's sync
  //     credentials and turn sync on. Signing in is the whole setup now, so
  //     this is what makes the rest of startup treat the user as synced.
  const isSyncSignedIn = typeof isSignedInToSupabase === 'function' && isSignedInToSupabase();
  if (isSyncSignedIn && typeof activateSyncForCurrentUser === 'function') {
    activateSyncForCurrentUser();
  }

  // 1. Initial State Load
  if (MidoriState.wallets.length === 0) {
    if (isSyncSignedIn && MidoriState.preferences.syncEnabled) {
      // A signed-in user on an empty (new) device: pull their real ledger
      // rather than seeding sample data that would then merge into it.
      pullStateFromCloud();
    } else {
      if (MidoriState.preferences.autoSyncDeviceDate) {
        MidoriState.virtualDate = getDeviceTodayDateStr();
      }
      // Generate dummy data on a fresh start so the user has something to see.
      generateMatchaDummyData();
    }
  } else {
    // Check auto sync of device date on load
    if (MidoriState.preferences.autoSyncDeviceDate) {
      const todayStr = getDeviceTodayDateStr();
      if (todayStr > MidoriState.virtualDate) {
        console.log(`Auto-advancing virtual date from ${MidoriState.virtualDate} to today (${todayStr})`);
        updateVirtualDate(todayStr);
      }
    }

    // Initial cloud pull on startup for a signed-in, synced user.
    if (MidoriState.preferences.syncEnabled) {
      pullStateFromCloud();
    }
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
  setupDelegatedActions();
  setupDeclaredHandlers();
  setupModalKeyboard();

  // 6. Setup Form Color Pickers
  setupFormColorPickers();
  
  // 7. Initial render
  renderAllViews();
  renderFxRatesUpdatedLabel();
  renderCloudAccountUI();

  // 7b. Refresh live FX rates in the background (falls back to cached/hardcoded rates if offline)
  refreshFxRates().then(() => {
    renderAllViews();
    renderFxRatesUpdatedLabel();
  });

  // 8. Auto-load dropdown option lists
  syncTransactionCategoryOptions();
  syncScheduleCategoryOptions();
  populateDropdowns();

  // 9. Interactive clickable date input
  const headerDatePicker = document.getElementById('headerDatePicker');
  if (headerDatePicker) {
    headerDatePicker.addEventListener('change', (e) => {
      const newDate = e.target.value;
      if (newDate) {
        updateVirtualDate(newDate);
      }
    });
  }

  // 10. Background ZenSync Polling & Tab-Focus Auto-Sync
  window.addEventListener('focus', () => {
    if (MidoriState.preferences.syncEnabled && typeof pullStateFromCloud === 'function') {
      console.log('ZenSync: Tab focused, pulling cloud updates...');
      pullStateFromCloud();
    }
  });

  setInterval(() => {
    if (MidoriState.preferences.syncEnabled && typeof pullStateFromCloud === 'function') {
      console.log('ZenSync: Background sync polling...');
      pullStateFromCloud();
    }
  }, 60000); // Poll every 60 seconds
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
  document.getElementById('virtualDateDisplay').innerText = formatDisplayDate(MidoriState.virtualDate);
  const headerDatePicker = document.getElementById('headerDatePicker');
  if (headerDatePicker) {
    headerDatePicker.value = MidoriState.virtualDate;
  }
  
  // Re-run aggregate analytics & redraw graphs
  renderDashboardMetrics();
  updateCharts();
  
  // Render active tab elements
  renderWallets();
  renderBudgets();
  renderTags();
  renderLedger();
  renderSchedules();
  renderInsights();

  // Update form selector details
  syncTransactionCategoryOptions();
  syncScheduleCategoryOptions();
  populateDropdowns();
  
  // Refresh ZenSync Status
  if (typeof window.updateSyncUI === 'function') {
    window.updateSyncUI();
  }
}

/**
 * Navigation & Tab Swapping
 */
function setupNavigation() {
  const links = document.querySelectorAll('.nav-link');
  const asideElement = document.querySelector('aside');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

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
      
      // Close mobile navigation drawer if open
      if (asideElement) asideElement.classList.remove('active');
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');
      
      // Trigger chart refresh if returning to dashboard
      if (target === 'dashboard') {
        setTimeout(updateCharts, 50);
      }
    });
  });

  // Mobile Sidebar Toggle Triggers
  const mobileToggle = document.getElementById('mobileMenuToggle');
  const mobileClose = document.getElementById('mobileMenuClose');

  if (mobileToggle && asideElement && sidebarOverlay) {
    mobileToggle.addEventListener('click', () => {
      asideElement.classList.add('active');
      sidebarOverlay.classList.add('active');
    });
  }

  if (mobileClose && asideElement && sidebarOverlay) {
    mobileClose.addEventListener('click', () => {
      asideElement.classList.remove('active');
      sidebarOverlay.classList.remove('active');
    });
  }

  if (sidebarOverlay && asideElement) {
    sidebarOverlay.addEventListener('click', () => {
      asideElement.classList.remove('active');
      sidebarOverlay.classList.remove('active');
    });
  }

  // Theme switch click
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const currentTheme = MidoriState.preferences.theme;
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    updatePreference('theme', newTheme);
    applyTheme(newTheme);
    updateCharts();
  });
}

// Dispatch table for [data-action] elements, replacing former inline onclick= handlers
const DATA_ACTION_HANDLERS = {
  goToSettingsTab: () => document.querySelector('[data-tab="settings"]').click(),
  triggerYearTravel: (arg) => triggerYearTravel(Number(arg)),
  triggerMonthTravel: (arg) => triggerMonthTravel(Number(arg)),
  resetToCurrentDate: () => resetToCurrentDate(),
  openModal: (arg) => openModal(arg),
  closeModal: (arg) => closeModal(arg),
  signInToCloud: () => signInToCloud(),
  signOutOfCloud: () => signOutOfCloud(),
  syncNow: () => syncNow(),
  triggerStateExport: () => triggerStateExport(),
  clickImportFileInput: () => document.getElementById('importFileInput').click(),
  triggerStateReset: () => triggerStateReset(),
  ledgerPrevPage: () => changeLedgerPage(-1),
  ledgerNextPage: () => changeLedgerPage(1),
  // Row-level actions on dynamically rendered lists. These were inline
  // onclick="fn('id')" attributes built by string interpolation, which both
  // widened the XSS surface and blocked a Content-Security-Policy without
  // 'unsafe-inline'. The record id now travels as a plain data-arg value.
  openEditTransactionModal: (arg) => openEditTransactionModal(arg),
  triggerTransactionDelete: (arg) => triggerTransactionDelete(arg),
  openEditWalletModal: (arg) => openEditWalletModal(arg),
  triggerWalletDelete: (arg) => triggerWalletDelete(arg),
  openEditBudgetModal: (arg) => openEditBudgetModal(arg),
  openEditCategoryModal: (arg) => openEditCategoryModal(arg),
  triggerCategoryDelete: (arg) => triggerCategoryDelete(arg),
  toggleScheduleActive: (arg) => toggleScheduleActive(arg),
  openEditScheduleModal: (arg) => openEditScheduleModal(arg),
  triggerScheduleDelete: (arg) => triggerScheduleDelete(arg),
  addDetectedSubscription: (arg) => addDetectedSubscription(arg),
};

function setupDelegatedActions() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const handler = DATA_ACTION_HANDLERS[target.getAttribute('data-action')];
    if (handler) handler(target.getAttribute('data-arg'));
  });
}

// Non-click handlers, wired here for the same reason as DATA_ACTION_HANDLERS:
// the CSP omits 'unsafe-inline' from script-src, so the browser refuses to
// compile ANY inline handler attribute. That is not limited to onclick —
// onsubmit, onchange and oninput are blocked identically, and they fail
// silently: the attribute stays visible in the HTML while the corresponding
// property is null, so every form and filter looks wired and does nothing.
// These cannot go through data-action because they are not clicks, and
// several need the element's own value.
const INLINE_EVENT_BINDINGS = [
  ['baseCurrencySelect', 'change', (el) => changeBaseCurrency(el.value)],
  ['budgetPeriodSelect', 'change', (el) => switchBudgetPeriod(el.value)],
  // These reset to page 1 rather than calling renderLedger directly: narrowing
  // the results while on a later page would otherwise leave the user staring
  // at an empty table with matches sitting on page 1.
  ['filterSearch', 'input', () => resetLedgerPageAndRender()],
  ['filterWallet', 'change', () => resetLedgerPageAndRender()],
  ['filterTag', 'change', () => resetLedgerPageAndRender()],
  ['filterType', 'change', () => resetLedgerPageAndRender()],
  ['ledgerPageSize', 'change', (el) => setLedgerPageSize(el.value)],
  ['sync-auto-device-date', 'change', (el) => toggleAutoDeviceDate(el.checked)],
  ['importFileInput', 'change', (el, event) => triggerStateImport(event)],

  ['transactionForm', 'submit', (el, event) => submitTransactionForm(event)],
  ['txType', 'change', () => handleTxTypeChange()],
  ['txWallet', 'change', () => syncTransactionCurrencyDefault()],

  ['walletForm', 'submit', (el, event) => submitWalletForm(event)],
  ['editWalletForm', 'submit', (el, event) => submitEditWalletForm(event)],

  ['categoryForm', 'submit', (el, event) => submitCategoryForm(event)],
  ['catType', 'change', () => syncCategoryFormBudgetState()],

  ['scheduleForm', 'submit', (el, event) => submitScheduleForm(event)],
  ['schedType', 'change', () => syncScheduleCategoryOptions()],

  ['editCategoryForm', 'submit', (el, event) => submitEditCategoryForm(event)],
  ['editCatType', 'change', () => syncEditCategoryFormBudgetState()],

  ['editTransactionForm', 'submit', (el, event) => submitEditTransactionForm(event)],
  ['editTxType', 'change', () => handleEditTxTypeChange()],
  ['editTxWallet', 'change', () => syncEditTransactionCurrencyDefault()],

  ['editScheduleForm', 'submit', (el, event) => submitEditScheduleForm(event)],
  ['editSchedType', 'change', () => syncEditScheduleCategoryOptions()],

  ['editBudgetForm', 'submit', (el, event) => submitEditBudgetForm(event)],
];

function setupDeclaredHandlers() {
  INLINE_EVENT_BINDINGS.forEach(([id, type, handler]) => {
    const el = document.getElementById(id);
    if (!el) {
      // Loud on purpose: a missing id here means a control is inert, which is
      // exactly the failure mode this table exists to prevent.
      console.error(`[Midori] Cannot bind ${type}: no element #${id}.`);
      return;
    }
    el.addEventListener(type, (event) => handler(el, event));
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
function populateDropdowns() {
  const txWallet = document.getElementById('txWallet');
  const txToWallet = document.getElementById('txToWallet');
  const filterWallet = document.getElementById('filterWallet');
  const schedWallet = document.getElementById('schedWallet');
  
  const wallets = MidoriState.wallets;
  
  // Save current values if any to preserve selections during rapid loads
  const valTxW = txWallet.value;
  const valTxToW = txToWallet ? txToWallet.value : '';
  const valFilW = filterWallet.value;
  const valSchW = schedWallet.value;

  // Clear options except defaults
  txWallet.innerHTML = '';
  if (txToWallet) txToWallet.innerHTML = '';
  schedWallet.innerHTML = '';
  
  filterWallet.innerHTML = '<option value="all">All Wallets</option>';

  wallets.forEach(w => {
    const opt = `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`;
    txWallet.insertAdjacentHTML('beforeend', opt);
    if (txToWallet) txToWallet.insertAdjacentHTML('beforeend', opt);
    schedWallet.insertAdjacentHTML('beforeend', opt);
    filterWallet.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`);
  });

  // Restore values
  if (valTxW) txWallet.value = valTxW;
  if (valTxToW && txToWallet) txToWallet.value = valTxToW;
  if (valFilW) filterWallet.value = valFilW;
  if (valSchW) schedWallet.value = valSchW;

  // Render tag filter options
  const filterTag = document.getElementById('filterTag');
  const valFilT = filterTag.value;
  
  filterTag.innerHTML = '<option value="all">All Categories</option>';
  MidoriState.categories.forEach(c => {
    filterTag.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`);
  });
  if (valFilT) filterTag.value = valFilT;
}

/**
 * Dialog focus management.
 *
 * These modals are plain divs, so nothing gives them dialog behaviour for free.
 * Before this, focus stayed on whatever button opened the modal, Tab walked
 * straight out of the dialog into the page behind it, and there was no way to
 * dismiss one from the keyboard at all. A native <dialog> supplies all of this,
 * but converting 10 modals would change their stacking and backdrop styling, so
 * the behaviour is reimplemented over the existing markup instead.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Where focus goes when the dialog closes, so keyboard users land back on the
// control they opened it from rather than at the top of the document.
let modalReturnFocusTo = null;

function getVisibleFocusable(container) {
  // These forms show and hide whole rows by transaction type, and a hidden
  // row's inputs must not become tab stops inside the trap.
  //
  // getClientRects() alone is not sufficient: it is empty for display:none but
  // NOT for visibility:hidden, which still generates layout boxes while being
  // unfocusable. Measured on the closed overlays, getClientRects() called 72 of
  // 80 unfocusable controls "visible". The app only ever hides rows with
  // display:none, so that gap is latent rather than live — but a trap whose
  // first/last element cannot take focus breaks the wrap silently, so both
  // checks are applied. checkVisibility is recent, hence the feature test:
  // older Android WebViews fall back to the getClientRects result.
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getClientRects().length === 0) return false;
    return typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true })
      : true;
  });
}

function getTopmostOpenModal() {
  const open = document.querySelectorAll('.modal-overlay.active');
  return open.length ? open[open.length - 1] : null;
}

// Sync Form Category Option Lists based on type (Income vs Expense)
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  modalReturnFocusTo = document.activeElement;
  modal.classList.add('active');
  // Clear any leftover validation error from a previous, abandoned attempt
  // at this same form so it doesn't appear to apply to the new attempt.
  modal.querySelectorAll('.form-error').forEach((errorEl) => {
    errorEl.style.display = 'none';
  });
  // Reset date input inside modal to match Virtual System Date automatically!
  setVirtualDateInputDefaults();
  if (modalId === 'modalTransaction') {
    syncTransactionCurrencyDefault();
  }

  // Focus the dialog itself rather than its first field: that announces the
  // title to a screen reader without popping the on-screen keyboard open on
  // every modal, which on a phone-sized ledger covers the form being filled.
  const dialog = modal.querySelector('[role="dialog"]') || modal;
  dialog.setAttribute('tabindex', '-1');
  // focus() is a no-op while the overlay is still visibility:hidden, and .active
  // was only added this tick, so the new style has to land first. Reading
  // offsetHeight forces that flush synchronously.
  //
  // requestAnimationFrame would be the obvious way to wait, and it is wrong
  // here: rAF does not fire while the document is hidden, so a modal opened in
  // a backgrounded tab never received focus at all. Measured directly — with
  // visibilityState 'hidden', the rAF version left focus on the opener button.
  void modal.offsetHeight;
  dialog.focus();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  if (modalReturnFocusTo && typeof modalReturnFocusTo.focus === 'function') {
    modalReturnFocusTo.focus();
  }
  modalReturnFocusTo = null;
}

function setupModalKeyboard() {
  document.addEventListener('keydown', (event) => {
    const modal = getTopmostOpenModal();
    if (!modal) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(modal.id);
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getVisibleFocusable(modal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Wrap at both ends.
    //
    // The container case matters and is easy to miss: openModal focuses the
    // dialog element itself, which is inside the modal but is not `first`, so a
    // naive check matches neither branch, skips preventDefault, and lets the
    // browser's own shift+Tab carry focus backwards out of the dialog — from
    // the very position every dialog starts in. Synthetic KeyboardEvents do not
    // move focus, so a scripted test reports this as passing; it has to be
    // exercised with a real keypress.
    const dialogEl = modal.querySelector('[role="dialog"]');
    const atStart = document.activeElement === first
      || document.activeElement === dialogEl
      || !modal.contains(document.activeElement);

    if (event.shiftKey && atStart) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
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

  // Edit Category Color Picker setup
  const editCatColorChips = document.querySelectorAll('#editCatColorPicker .color-option');
  editCatColorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      editCatColorChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedEditCategoryColor = chip.getAttribute('data-color');
    });
  });
}

// Hide budget checkbox container if creating an Income Tag
function triggerTimeTravel(days) {
  fastForwardDate(days); // calling scheduler method
}

function triggerMonthTravel(months) {
  const current = new Date(MidoriState.virtualDate);
  current.setMonth(current.getMonth() + months);
  const newDateStr = current.toISOString().split('T')[0];
  updateVirtualDate(newDateStr);
}

function triggerYearTravel(years) {
  const current = new Date(MidoriState.virtualDate);
  current.setFullYear(current.getFullYear() + years);
  const newDateStr = current.toISOString().split('T')[0];
  updateVirtualDate(newDateStr);
}

function resetToCurrentDate() {
  const todayStr = getDeviceTodayDateStr();
  updateVirtualDate(todayStr);
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

// ZenSync UI Action Triggers
function toggleAutoDeviceDate(checked) {
  updatePreference('autoSyncDeviceDate', !!checked);
}

