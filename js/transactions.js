/**
 * Midori — Premium Finance Ledger App
 * transactions.js: Ledger rendering, transaction create/edit/delete CRUD.
 */

const LEDGER_PAGE_SIZES = [20, 50, 100];
const DEFAULT_LEDGER_PAGE_SIZE = 50;

// Rows-per-page lives in its own localStorage key rather than in
// MidoriState.preferences for two reasons: preferences are part of the synced,
// encrypted payload, so changing a display setting would bump updatedAt and
// push the entire ledger to the cloud; and the right value genuinely differs
// per device — 20 suits a phone, 100 suits a desktop — so syncing it would
// make two paired devices fight over the setting.
const LEDGER_PAGE_SIZE_STORAGE_KEY = 'midori_ledger_page_size';

let ledgerPage = 1;
let ledgerPageSize = readStoredLedgerPageSize();

function readStoredLedgerPageSize() {
  try {
    const stored = Number(localStorage.getItem(LEDGER_PAGE_SIZE_STORAGE_KEY));
    // Whitelist rather than a range check: a stored value of 5000 would
    // otherwise be honoured and reintroduce the very render cost pagination
    // exists to avoid.
    return LEDGER_PAGE_SIZES.includes(stored) ? stored : DEFAULT_LEDGER_PAGE_SIZE;
  } catch (e) {
    // localStorage access throws outright in some private-browsing modes. A
    // display preference is never worth breaking the ledger over.
    console.warn('Could not read stored ledger page size:', e);
    return DEFAULT_LEDGER_PAGE_SIZE;
  }
}

function setLedgerPageSize(value) {
  const size = Number(value);
  if (!LEDGER_PAGE_SIZES.includes(size)) return;
  ledgerPageSize = size;
  try {
    localStorage.setItem(LEDGER_PAGE_SIZE_STORAGE_KEY, String(size));
  } catch (e) {
    console.warn('Could not persist ledger page size:', e);
  }
  // Back to page 1: the row at the top of page 3 at 20/page sits somewhere
  // entirely different at 100/page, so keeping the number lands the user in an
  // arbitrary spot rather than near where they were.
  ledgerPage = 1;
  renderLedger();
}

function changeLedgerPage(delta) {
  ledgerPage += delta;
  renderLedger();
}

// Any filter change must send the user back to page 1: narrowing 900
// transactions down to 4 while sitting on page 6 would otherwise render an
// empty table even though there are matches.
function resetLedgerPageAndRender() {
  ledgerPage = 1;
  renderLedger();
}

function renderLedger() {
  const tbody = document.getElementById('ledgerTableBody');
  const emptyState = document.getElementById('ledgerEmptyState');
  const pagination = document.getElementById('ledgerPagination');
  if (!tbody) return;

  tbody.innerHTML = '';

  // Get search criteria
  const searchVal = document.getElementById('filterSearch').value.toLowerCase();
  const filterWalletId = document.getElementById('filterWallet').value;
  const filterTagId = document.getElementById('filterTag').value;
  const filterType = document.getElementById('filterType').value;

  // Filter
  const filtered = MidoriState.transactions.filter(tx => {
    if (tx.scheduledId && tx.date > MidoriState.virtualDate) return false; // Strict time-travel rollback filter!
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
    if (pagination) pagination.style.display = 'none';
    return;
  } else {
    emptyState.style.display = 'none';
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ledgerPageSize));
  // Clamping here rather than at the call sites covers every way the page can
  // fall out of range at once: deleting the last row on the final page, a
  // filter narrowing the result set, or a cloud sync replacing the ledger
  // wholesale. Without it the table renders empty while matches exist.
  if (ledgerPage > totalPages) ledgerPage = totalPages;
  if (ledgerPage < 1) ledgerPage = 1;

  const startIndex = (ledgerPage - 1) * ledgerPageSize;
  const pageTransactions = filtered.slice(startIndex, startIndex + ledgerPageSize);

  // Look-ups built once instead of a linear scan per row. Minor next to the
  // batching below, but it turns the per-row cost from O(wallets + categories)
  // into O(1) and costs nothing to keep correct.
  const walletsById = new Map(MidoriState.wallets.map(w => [w.id, w]));
  const categoriesById = new Map(MidoriState.categories.map(c => [c.id, c]));

  // Rows are accumulated here and inserted in ONE call after the loop, rather
  // than one insertAdjacentHTML per row.
  //
  // This mattered far more before pagination, when renderLedger measured 362ms
  // of a 350ms full re-render at 5,000 transactions — essentially the entire
  // cost of every state change in the app. Now that at most 100 rows are ever
  // built the win is small in absolute terms, but the page size is the user's
  // choice and the batching costs nothing to keep.
  const rows = [];

  pageTransactions.forEach(tx => {
    const wallet = walletsById.get(tx.walletId);
    const toWallet = tx.toWalletId ? walletsById.get(tx.toWalletId) : null;
    const category = categoriesById.get(tx.categoryId);

    const walletName = escapeHtml(wallet ? wallet.name : 'Unknown Wallet');
    const walletCurrency = escapeHtml(wallet ? wallet.currency : 'USD');
    const toWalletName = escapeHtml(toWallet ? toWallet.name : 'Unknown Wallet');
    const catName = escapeHtml(category ? category.name : 'Uncategorized');
    const catColor = escapeHtml(category ? category.color : '#8ba88f');
    const walletColor = escapeHtml(wallet ? wallet.color : 'transparent');
    const toWalletColor = escapeHtml(toWallet ? toWallet.color : 'transparent');
    // Icon key indexes a fixed lookup table, so the resulting SVG is trusted markup.
    const catIcon = category ? category.icon : 'leaf';
    const catIconSvg = SVG_ICONS[catIcon] || SVG_ICONS.leaf;

    const formattedAmount = formatCurrency(tx.amount, tx.currency || walletCurrency);
    
    let categoryHTML = '';
    let walletHTML = '';
    let amountHTML = '';

    if (tx.type === 'transfer') {
      categoryHTML = `
        <span class="badge-tag" style="background: rgba(255,255,255,0.02); border: 1px dashed var(--border-color);">
          <span style="display:inline-flex; width:14px; height:14px; color:var(--green-mint);">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M17 1l4 4-4 4M21 5H9a5 5 0 0 0-5 5v3m7 10l-4-4 4-4M3 19h12a5 5 0 0 0 5-5v-3"/></svg>
          </span>
          <span>Transfer</span>
        </span>
      `;
      walletHTML = `
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
          <span class="badge-wallet" style="border-left: 3px solid ${walletColor};">
            ${walletName}
          </span>
          <span style="opacity: 0.5; font-size:10px;">➔</span>
          <span class="badge-wallet" style="border-left: 3px solid ${toWalletColor};">
            ${toWalletName}
          </span>
        </div>
      `;
      amountHTML = `
        <td class="tx-amount-cell" data-label="Amount" style="color: var(--text-muted); font-weight: 500; font-family:'Outfit'; text-align:right;">
          ➔ ${formattedAmount}
        </td>
      `;
    } else {
      const isIncome = tx.type === 'income';
      categoryHTML = `
        <span class="badge-tag">
          <span style="display:inline-flex; width:14px; height:14px; color:${catColor};">${catIconSvg}</span>
          <span>${catName}</span>
        </span>
      `;
      walletHTML = `
        <span class="badge-wallet" style="border-left: 3px solid ${walletColor};">
          ${walletName} <span style="font-size:9px; opacity:0.6; margin-left:4px;">${walletCurrency}</span>
        </span>
      `;
      amountHTML = `
        <td class="tx-amount-cell ${isIncome ? 'amount-income' : 'amount-expense'}" data-label="Amount">
          ${isIncome ? '+' : '-'}${formattedAmount}
        </td>
      `;
    }

    const rowHTML = `
      <tr>
        <td data-label="Date" style="font-weight:600; font-family:'Outfit'; white-space:nowrap;">${formatDisplayDate(tx.date)}</td>
        <td data-label="Transaction">
          <div class="tx-title-cell">
            <span class="tx-title-main">${escapeHtml(tx.title)}</span>
            ${tx.note ? `<span class="tx-title-note">${escapeHtml(tx.note)}</span>` : ''}
          </div>
        </td>
        <td data-label="Category Tag">
          ${categoryHTML}
        </td>
        <td data-label="Wallet">
          ${walletHTML}
        </td>
        ${amountHTML}
        <td data-label="">
          <div style="display:flex; gap:6px; justify-content:center;">
            <button class="btn-icon-secondary" data-action="openEditTransactionModal" data-arg="${escapeHtml(tx.id)}" title="Edit record" style="background:none; border:none; color:var(--text-muted); cursor:pointer; display:inline-flex; align-items:center; padding:4px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path></svg>
            </button>
            <button class="btn-icon-danger" data-action="triggerTransactionDelete" data-arg="${escapeHtml(tx.id)}" title="Delete record" style="background:none; border:none; color:var(--autumn-terracotta); cursor:pointer; display:inline-flex; align-items:center; padding:4px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
    rows.push(rowHTML);
  });

  tbody.insertAdjacentHTML('beforeend', rows.join(''));

  renderLedgerPagination(filtered.length, totalPages, startIndex, pageTransactions.length);
}

function renderLedgerPagination(totalCount, totalPages, startIndex, pageCount) {
  const pagination = document.getElementById('ledgerPagination');
  if (!pagination) return;

  pagination.style.display = 'flex';

  const sizeSelect = document.getElementById('ledgerPageSize');
  // Kept in step with the module variable rather than trusted as the source of
  // truth: the stored preference is applied at startup before this select has
  // been touched, and a re-render must not silently adopt whatever the markup
  // happens to have selected.
  if (sizeSelect && Number(sizeSelect.value) !== ledgerPageSize) {
    sizeSelect.value = String(ledgerPageSize);
  }

  const status = document.getElementById('ledgerPageStatus');
  if (status) {
    const firstShown = startIndex + 1;
    const lastShown = startIndex + pageCount;
    status.innerText = `${firstShown}–${lastShown} of ${totalCount}  ·  Page ${ledgerPage} of ${totalPages}`;
  }

  // Disabling rather than hiding: buttons that vanish at the ends make the bar
  // reflow and shift the other control under the user's cursor mid-click.
  const prevBtn = document.getElementById('ledgerPrevPage');
  const nextBtn = document.getElementById('ledgerNextPage');
  if (prevBtn) prevBtn.disabled = ledgerPage <= 1;
  if (nextBtn) nextBtn.disabled = ledgerPage >= totalPages;
}

function triggerTransactionDelete(id) {
  if (confirm('Delete this ledger transaction? This will adjust your wallet balance backwards.')) {
    deleteTransaction(id);
  }
}

/**
 * Scheduled Recurring Transactions Tab
 */
function syncTransactionCategoryOptions() {
  const type = document.getElementById('txType').value;
  const select = document.getElementById('txCategory');
  select.innerHTML = '';

  MidoriState.categories
    .filter(c => c.type === type)
    .forEach(c => {
      select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`);
    });
}

function handleTxTypeChange() {
  const type = document.getElementById('txType').value;
  const toWalletGroup = document.getElementById('txToWalletGroup');
  const toWalletSelect = document.getElementById('txToWallet');
  const categoryGroup = document.getElementById('txCategoryGroup');
  const categorySelect = document.getElementById('txCategory');
  const walletLabel = document.getElementById('txWalletLabel');
  
  if (type === 'transfer') {
    if (walletLabel) walletLabel.innerText = 'From Wallet';
    if (toWalletGroup) toWalletGroup.style.display = 'block';
    if (toWalletSelect) toWalletSelect.required = true;
    if (categoryGroup) categoryGroup.style.display = 'none';
    if (categorySelect) categorySelect.required = false;
  } else {
    if (walletLabel) walletLabel.innerText = 'From Wallet';
    if (toWalletGroup) toWalletGroup.style.display = 'none';
    if (toWalletSelect) toWalletSelect.required = false;
    if (categoryGroup) categoryGroup.style.display = 'block';
    if (categorySelect) categorySelect.required = true;
    
    // Sync regular categories for expense/income
    syncTransactionCategoryOptions();
  }
}

function syncTransactionCurrencyDefault() {
  const walletId = document.getElementById('txWallet').value;
  const wallet = MidoriState.wallets.find(w => w.id === walletId);
  if (wallet) {
    document.getElementById('txCurrency').value = wallet.currency;
  }
}

function submitTransactionForm(e) {
  e.preventDefault();
  clearFormError('transactionForm');

  const type = document.getElementById('txType').value;
  const titleValue = document.getElementById('txTitle').value;
  const amountValue = document.getElementById('txAmount').value;
  if (!validateRequiredText(titleValue)) {
    return showFormError('transactionForm', 'Title is required.');
  }
  if (!validateAmount(amountValue)) {
    return showFormError('transactionForm', 'Amount must be a positive number.');
  }

  const tx = {
    title: titleValue.trim(),
    amount: Number(amountValue),
    type: type,
    walletId: document.getElementById('txWallet').value,
    toWalletId: type === 'transfer' ? document.getElementById('txToWallet').value : null,
    categoryId: type === 'transfer' ? null : document.getElementById('txCategory').value,
    currency: document.getElementById('txCurrency').value,
    date: document.getElementById('txDate').value,
    note: document.getElementById('txNote').value,
    scheduledId: null
  };

  addTransaction(tx);
  
  // Reset form and close
  document.getElementById('transactionForm').reset();
  
  // Reset fields to default visibility states
  const toWalletGroup = document.getElementById('txToWalletGroup');
  if (toWalletGroup) toWalletGroup.style.display = 'none';
  const categoryGroup = document.getElementById('txCategoryGroup');
  if (categoryGroup) categoryGroup.style.display = 'block';
  const walletLabel = document.getElementById('txWalletLabel');
  if (walletLabel) walletLabel.innerText = 'From Wallet';
  
  closeModal('modalTransaction');
}

function openEditTransactionModal(txId) {
  const tx = MidoriState.transactions.find(t => t.id === txId);
  if (!tx) return;

  document.getElementById('editTxId').value = tx.id;
  document.getElementById('editTxTitle').value = tx.title;
  document.getElementById('editTxAmount').value = tx.amount;
  document.getElementById('editTxType').value = tx.type;
  document.getElementById('editTxDate').value = tx.date;
  document.getElementById('editTxNote').value = tx.note || '';

  // Populate wallets dropdowns inside the edit modal
  const editTxWallet = document.getElementById('editTxWallet');
  const editTxToWallet = document.getElementById('editTxToWallet');
  
  editTxWallet.innerHTML = '';
  if (editTxToWallet) editTxToWallet.innerHTML = '';
  
  MidoriState.wallets.forEach(w => {
    const opt = `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)} (${escapeHtml(w.currency)})</option>`;
    editTxWallet.insertAdjacentHTML('beforeend', opt);
    if (editTxToWallet) editTxToWallet.insertAdjacentHTML('beforeend', opt);
  });
  
  editTxWallet.value = tx.walletId;
  if (tx.toWalletId && editTxToWallet) {
    editTxToWallet.value = tx.toWalletId;
  }

  // Adjust display and validations
  handleEditTxTypeChange();
  
  if (tx.type !== 'transfer') {
    document.getElementById('editTxCategory').value = tx.categoryId;
  }

  // Sync transaction currency
  document.getElementById('editTxCurrency').value = tx.currency || (MidoriState.wallets.find(w => w.id === tx.walletId)?.currency || 'USD');

  openModal('modalEditTransaction');
}

function syncEditTransactionCategoryOptions() {
  const type = document.getElementById('editTxType').value;
  const select = document.getElementById('editTxCategory');
  select.innerHTML = '';

  MidoriState.categories
    .filter(c => c.type === type)
    .forEach(c => {
      select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`);
    });
}

function handleEditTxTypeChange() {
  const type = document.getElementById('editTxType').value;
  const toWalletGroup = document.getElementById('editTxToWalletGroup');
  const toWalletSelect = document.getElementById('editTxToWallet');
  const categoryGroup = document.getElementById('editTxCategoryGroup');
  const categorySelect = document.getElementById('editTxCategory');
  const walletLabel = document.getElementById('editTxWalletLabel');
  
  if (type === 'transfer') {
    if (walletLabel) walletLabel.innerText = 'From Wallet';
    if (toWalletGroup) toWalletGroup.style.display = 'block';
    if (toWalletSelect) toWalletSelect.required = true;
    if (categoryGroup) categoryGroup.style.display = 'none';
    if (categorySelect) categorySelect.required = false;
  } else {
    if (walletLabel) walletLabel.innerText = 'From Wallet';
    if (toWalletGroup) toWalletGroup.style.display = 'none';
    if (toWalletSelect) toWalletSelect.required = false;
    if (categoryGroup) categoryGroup.style.display = 'block';
    if (categorySelect) categorySelect.required = true;
    
    // Sync regular categories for expense/income
    syncEditTransactionCategoryOptions();
  }
}

function syncEditTransactionCurrencyDefault() {
  const walletId = document.getElementById('editTxWallet').value;
  const wallet = MidoriState.wallets.find(w => w.id === walletId);
  if (wallet) {
    document.getElementById('editTxCurrency').value = wallet.currency;
  }
}

function submitEditTransactionForm(e) {
  e.preventDefault();
  clearFormError('editTransactionForm');

  const titleValue = document.getElementById('editTxTitle').value;
  const amountValue = document.getElementById('editTxAmount').value;
  if (!validateRequiredText(titleValue)) {
    return showFormError('editTransactionForm', 'Title is required.');
  }
  if (!validateAmount(amountValue)) {
    return showFormError('editTransactionForm', 'Amount must be a positive number.');
  }

  const id = document.getElementById('editTxId').value;
  const type = document.getElementById('editTxType').value;
  const updatedFields = {
    title: titleValue.trim(),
    amount: Number(amountValue),
    type: type,
    walletId: document.getElementById('editTxWallet').value,
    toWalletId: type === 'transfer' ? document.getElementById('editTxToWallet').value : null,
    categoryId: type === 'transfer' ? null : document.getElementById('editTxCategory').value,
    currency: document.getElementById('editTxCurrency').value,
    date: document.getElementById('editTxDate').value,
    note: document.getElementById('editTxNote').value,
    scheduledId: null
  };

  updateTransaction(id, updatedFields);
  closeModal('modalEditTransaction');
}

