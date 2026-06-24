/**
 * Midori — Premium Finance Ledger App
 * wallets.js: Wallet rendering, create/edit/delete CRUD.
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

  const baseCurrency = MidoriState.preferences.baseCurrency;

  MidoriState.wallets.forEach((wallet, index) => {
    const cardGradientIdx = (index % 3) + 1; // rotation of beautiful gradients
    const convertedBalance = convertAmount(wallet.balance, wallet.currency, baseCurrency);
    const formattedBaseBalance = formatCurrency(convertedBalance, baseCurrency);
    const formattedNativeBalance = formatCurrency(wallet.balance, wallet.currency);
    
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
        <div class="wallet-balance-display">${formattedBaseBalance}</div>
        <div class="wallet-card-footer">
          <span>Native: ${formattedNativeBalance}</span>
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

function submitWalletForm(e) {
  e.preventDefault();
  clearFormError('walletForm');

  const nameValue = document.getElementById('walletName').value;
  if (!validateRequiredText(nameValue)) {
    return showFormError('walletForm', 'Wallet name is required.');
  }

  const openingBalance = Number(document.getElementById('walletBalance').value) || 0;
  const wallet = {
    name: nameValue.trim(),
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
  clearFormError('editWalletForm');

  const nameValue = document.getElementById('editWalletName').value;
  if (!validateRequiredText(nameValue)) {
    return showFormError('editWalletForm', 'Wallet name is required.');
  }

  const id = document.getElementById('editWalletId').value;
  const openingBalance = Number(document.getElementById('editWalletBalance').value) || 0;

  const updatedFields = {
    name: nameValue.trim(),
    currency: document.getElementById('editWalletCurrency').value,
    type: document.getElementById('editWalletType').value,
    openingBalance: openingBalance,
    color: selectedEditWalletColor
  };

  updateWallet(id, updatedFields);
  recalculateWalletBalances();
  closeModal('modalEditWallet');
}

