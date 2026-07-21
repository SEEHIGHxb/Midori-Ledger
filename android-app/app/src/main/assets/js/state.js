/**
 * Midori — Premium Finance Ledger App
 * state.js: State Management & Database Operations
 */

// Custom Icon SVG paths (leaf, wage/briefcase, chart, food, groceries, home, car, entertainment, shopping)
const SVG_ICONS = {
  leaf: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22C2 22 8 20 12 16C16 12 22 6 22 6C22 6 16 6 12 10C8 14 2 22 2 22Z"></path><path d="M12 2C12 2 13 8 10 11C7 14 2 15 2 15"></path></svg>`,
  briefcase: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
  trendUp: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,
  utensils: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 1 6 8a6 6 0 0 1 12 0Z"></path><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="10" x2="12" y2="22"></line><line x1="9" y1="12" x2="15" y2="12"></line></svg>`,
  shoppingCart: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`,
  home: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
  car: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
  film: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`,
  shoppingBag: `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`
};

// Supported Currencies — rates below are the offline fallback table, used
// when the live FX fetch fails or the device is offline. See refreshFxRates().
const CURRENCIES = {
  USD: { symbol: '$', name: 'US Dollar', rate: 1.00 },
  THB: { symbol: '฿', name: 'Thai Baht', rate: 36.50 },
  EUR: { symbol: '€', name: 'Euro', rate: 0.92 },
  CNY: { symbol: '¥', name: 'Chinese Yuan', rate: 7.24 },
  JPY: { symbol: '¥', name: 'Japanese Yen', rate: 156.20 }
};

const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // refresh at most once a day

// Apply a {CODE: rate} map (relative to USD) onto the in-memory CURRENCIES table
function applyFxRates(rates) {
  Object.keys(CURRENCIES).forEach(code => {
    if (code === 'USD') return; // USD is always the 1.00 base
    if (rates && rates[code] !== undefined && Number.isFinite(rates[code])) {
      CURRENCIES[code].rate = rates[code];
    }
  });
}

// Fetch live FX rates, falling back to the cached or hardcoded rates when
// offline/unreachable. Safe to call on every app load — it self-throttles.
async function refreshFxRates() {
  const cache = MidoriState.fxRatesCache;
  const now = Date.now();

  if (cache && cache.rates && (now - cache.fetchedAt) < FX_REFRESH_INTERVAL_MS) {
    applyFxRates(cache.rates);
    return;
  }

  try {
    const response = await fetch(FX_API_URL);
    if (!response.ok) throw new Error(`FX fetch failed with status ${response.status}`);
    const data = await response.json();
    if (!data || !data.rates) throw new Error('FX response missing rates field');

    const rates = {};
    Object.keys(CURRENCIES).forEach(code => {
      if (data.rates[code] !== undefined) rates[code] = data.rates[code];
    });

    applyFxRates(rates);
    MidoriState.fxRatesCache = { rates, fetchedAt: now };
    saveState();
  } catch (e) {
    console.warn('Could not refresh live FX rates; using cached/fallback rates instead.', e);
    if (cache && cache.rates) {
      applyFxRates(cache.rates);
    }
    // else: hardcoded fallback rates in CURRENCIES remain in effect untouched
  }
}

// Helper for dynamic local device date
function getDeviceTodayDateStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// State Object Definition
let MidoriState = {
  wallets: [],
  categories: [],
  transactions: [],
  schedules: [],
  preferences: {
    theme: 'dark',
    baseCurrency: 'THB',
    autoSyncDeviceDate: true,
    syncEnabled: false,
    syncId: null,
    syncKey: null,
    lastSyncedAt: 0,
    cloudRevision: 0
  },
  virtualDate: '2026-05-20',
  updatedAt: 0,
  fxRatesCache: null,
  // id -> epoch ms of deletion. Carried in the synced payload so other devices
  // learn about deletions they never saw. See js/merge.js.
  deletions: {}
};

const LOCAL_STORAGE_KEY = 'midori_ledger_state';

// Static Currency converter
function convertAmount(amount, from, to) {
  if (from === to) return amount;
  const usdAmount = amount / CURRENCIES[from].rate;
  return usdAmount * CURRENCIES[to].rate;
}

// Resolve the currency a transaction is actually denominated in.
// A transaction may be recorded in a currency other than its wallet's (e.g. a
// USD hotel bill paid from a JPY account), so tx.currency always wins when set.
// EVERY analytics/aggregation path must go through this helper — reading
// wallet.currency directly silently mis-converts foreign-currency transactions
// (a USD 100 expense on a JPY wallet was counted as JPY 100, a 156x
// understatement, while the ledger row and wallet balance showed it correctly).
function getTxCurrency(tx, fallbackCurrency) {
  if (tx && tx.currency) return tx.currency;
  const wallet = tx ? MidoriState.wallets.find(w => w.id === tx.walletId) : null;
  return wallet ? wallet.currency : fallbackCurrency;
}

// Format amount nicely with symbols
function formatCurrency(amount, currencyCode) {
  const meta = CURRENCIES[currencyCode] || CURRENCIES.USD;
  const decimals = (currencyCode === 'JPY') ? 0 : 2;
  return meta.symbol + Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// Escape a value for safe interpolation into an HTML template string.
//
// Every renderer builds markup with template literals + insertAdjacentHTML, so
// any field that originates from user input, an imported backup, or a cloud
// pull MUST pass through here. Without it, a transaction titled
// `<img src=x onerror=...>` executes on render with full access to the ledger
// and the sync key in localStorage.
//
// Escaping both quote styles makes this safe inside quoted attribute values
// (e.g. style="color: ${escapeHtml(color)}") as well as in element text.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Deep copy helpers
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Cryptographically secure random token.
// Uses rejection sampling (discarding bytes >= 248) so every character in
// TOKEN_ALPHABET is equally likely — a plain `byte % 62` would over-represent
// the first 8 characters and shrink the effective key space.
// Note: crypto.getRandomValues is available in insecure contexts too (unlike
// crypto.subtle), so this works under file:// in the Android wrapper.
function randomToken(length) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('A secure random source (crypto.getRandomValues) is unavailable in this browser.');
  }
  const limit = 256 - (256 % TOKEN_ALPHABET.length); // 248 for a 62-char alphabet
  const buffer = new Uint8Array(length * 2);
  let out = '';
  while (out.length < length) {
    cryptoObj.getRandomValues(buffer);
    for (let i = 0; i < buffer.length && out.length < length; i++) {
      if (buffer[i] < limit) out += TOKEN_ALPHABET.charAt(buffer[i] % TOKEN_ALPHABET.length);
    }
  }
  return out;
}

// Generate collision-resistant record IDs.
// Previously Math.random().toString(36).substr(2, 9) — only ~46 bits from a
// non-cryptographic PRNG, which risked collisions across synced devices.
function generateUUID() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return 'midori_' + cryptoObj.randomUUID().replace(/-/g, '');
  }
  return 'midori_' + randomToken(32);
}

// --- Sync bookkeeping -------------------------------------------------------
// Every record carries its own updatedAt, and every deletion leaves a tombstone
// in MidoriState.deletions. Both exist purely so mergeLedgerStates() (js/merge.js)
// can reconcile two devices without losing work. See that file for the rules.
//
// The cost of forgetting to call these is silent and delayed: an untouched edit
// loses to the other device's older copy, and an untombstoned delete comes back
// on the next sync. Any new mutator must call them too.

function touchRecord(record) {
  if (record) record.updatedAt = Date.now();
  return record;
}

function touchRecords(records) {
  (records || []).forEach(touchRecord);
}

// Tombstone one or more ids. Accepts an array so cascading deletes (a wallet
// taking its transactions and schedules with it) record every removed id —
// tombstoning only the wallet would let the other device restore its orphans.
function recordDeletion(idOrIds) {
  if (!MidoriState.deletions) MidoriState.deletions = {};
  const now = Date.now();
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  ids.forEach((id) => {
    if (id) MidoriState.deletions[id] = now;
  });
}

// Drop tombstones past their TTL so the map cannot grow without bound on a
// device that deletes a lot and rarely syncs. Merging prunes as well; this
// covers the local-only case. TOMBSTONE_TTL_MS comes from js/merge.js.
function pruneExpiredDeletions() {
  if (!MidoriState.deletions) return;
  const ttl = (typeof TOMBSTONE_TTL_MS === 'number') ? TOMBSTONE_TTL_MS : (90 * 24 * 60 * 60 * 1000);
  const cutoff = Date.now() - ttl;
  Object.keys(MidoriState.deletions).forEach((id) => {
    if ((Number(MidoriState.deletions[id]) || 0) < cutoff) {
      delete MidoriState.deletions[id];
    }
  });
}

// Form input validators (shared by all add/edit form handlers in app.js)
function validateAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function validateRequiredText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Clean up any orphaned future transactions (from deleted schedules)
function cleanupOrphanedFutureTransactions() {
  if (!MidoriState.schedules || !MidoriState.transactions) return;
  const activeScheduleIds = new Set(MidoriState.schedules.map(s => s.id));
  let changed = false;
  
  MidoriState.transactions = MidoriState.transactions.filter(tx => {
    // If a transaction has a scheduledId that is not in the active schedules
    // and its date is in the future relative to the virtualDate, prune it.
    if (tx.scheduledId && !activeScheduleIds.has(tx.scheduledId)) {
      if (tx.date > MidoriState.virtualDate) {
        console.log(`Pruning orphaned future transaction: "${tx.title}" on ${tx.date}`);
        // Tombstoned like any other delete. This runs after a merge too, where
        // the orphan may have just arrived from the other device — without a
        // tombstone it would be pruned here and re-delivered on every sync.
        recordDeletion(tx.id);
        changed = true;
        return false;
      }
    }
    return true;
  });

  if (changed) {
    saveState();
  }
}

// Load state from local storage or set defaults
function loadState() {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (data) {
    try {
      MidoriState = JSON.parse(data);
      // Ensure all required fields exist
      if (!MidoriState.wallets) MidoriState.wallets = [];
      if (!MidoriState.categories) MidoriState.categories = [];
      if (!MidoriState.transactions) MidoriState.transactions = [];
      if (!MidoriState.schedules) MidoriState.schedules = [];
      
      if (!MidoriState.preferences) {
        MidoriState.preferences = {
          theme: 'dark',
          baseCurrency: 'THB',
          autoSyncDeviceDate: true,
          syncEnabled: false,
          syncId: null,
          syncKey: null,
          lastSyncedAt: 0,
          cloudRevision: 0
        };
      } else {
        if (MidoriState.preferences.autoSyncDeviceDate === undefined) MidoriState.preferences.autoSyncDeviceDate = true;
        if (MidoriState.preferences.syncEnabled === undefined) MidoriState.preferences.syncEnabled = false;
        if (MidoriState.preferences.syncId === undefined) MidoriState.preferences.syncId = null;
        if (MidoriState.preferences.syncKey === undefined) MidoriState.preferences.syncKey = null;
        if (MidoriState.preferences.lastSyncedAt === undefined) MidoriState.preferences.lastSyncedAt = 0;
        // 0 means "this device has never seen a server revision". It can never
        // match a real one (Postgres starts them at 1), so the first push after
        // an upgrade is reported as a conflict and merges rather than clobbers.
        if (MidoriState.preferences.cloudRevision === undefined) MidoriState.preferences.cloudRevision = 0;
      }
      
      // Clean up legacy non-UUID/non-mds syncId
      if (MidoriState.preferences.syncId && 
          !MidoriState.preferences.syncId.startsWith('mds_') && 
          !MidoriState.preferences.syncId.includes('-')) {
        console.log(`Pruning legacy non-UUID syncId: ${MidoriState.preferences.syncId}`);
        MidoriState.preferences.syncId = null;
        MidoriState.preferences.syncEnabled = false;
        MidoriState.preferences.syncKey = null;
        MidoriState.preferences.lastSyncedAt = 0;
      }
      
      if (!MidoriState.virtualDate) {
        MidoriState.virtualDate = MidoriState.preferences.autoSyncDeviceDate ? getDeviceTodayDateStr() : '2026-05-20';
      }
      if (!MidoriState.updatedAt) {
        MidoriState.updatedAt = Date.now();
      }
      if (MidoriState.fxRatesCache === undefined) {
        MidoriState.fxRatesCache = null;
      }
      // Ledgers saved before per-record sync metadata existed have no tombstone
      // map. An empty one is correct: nothing has been deleted since the upgrade,
      // and records with no updatedAt are handled as legacy by the merge.
      if (!MidoriState.deletions || typeof MidoriState.deletions !== 'object') {
        MidoriState.deletions = {};
      }
      pruneExpiredDeletions();

      // Clean up legacy orphaned future transactions
      cleanupOrphanedFutureTransactions();
    } catch (e) {
      console.error('Failed to parse Midori state, resetting to default.', e);
      resetToDefaultState();
    }
  } else {
    resetToDefaultState();
  }
}

// Save state to local storage
function saveState() {
  MidoriState.updatedAt = Date.now();
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(MidoriState));
  } catch (e) {
    console.error('Failed to persist Midori state to localStorage.', e);
    window.dispatchEvent(new CustomEvent('midoriStorageQuotaExceeded'));
    // Still notify UI to reflect in-memory state, but skip cloud sync of unsaved data
    window.dispatchEvent(new CustomEvent('midoriStateChanged'));
    return;
  }
  // Dispatch custom event to trigger UI updates
  window.dispatchEvent(new CustomEvent('midoriStateChanged'));

  // Trigger background auto sync push if enabled
  triggerAutoSyncPush();
}

// Reset state to default settings
function resetToDefaultState() {
  const today = getDeviceTodayDateStr();
  MidoriState = {
    wallets: [],
    categories: [],
    transactions: [],
    schedules: [],
    preferences: {
      theme: 'dark',
      baseCurrency: 'THB',
      autoSyncDeviceDate: true,
      syncEnabled: false,
      syncId: null,
      syncKey: null,
      lastSyncedAt: 0,
      cloudRevision: 0
    },
    virtualDate: today,
    updatedAt: Date.now(),
    deletions: {}
  };
  
  // Set default categories
  MidoriState.categories = [
    { id: 'cat_salary', name: 'Salary', type: 'income', color: '#2d5a27', icon: 'leaf', budget: null, yearlyBudget: null, includeInBudget: false },
    { id: 'cat_freelance', name: 'Freelance', type: 'income', color: '#8ba88f', icon: 'briefcase', budget: null, yearlyBudget: null, includeInBudget: false },
    { id: 'cat_investment', name: 'Investments', type: 'income', color: '#a2a86c', icon: 'trendUp', budget: null, yearlyBudget: null, includeInBudget: false },
    
    { id: 'cat_food', name: 'Food', type: 'expense', color: '#5a7d5b', icon: 'utensils', budget: 50000, yearlyBudget: 600000, includeInBudget: true },
    { id: 'cat_groceries', name: 'Groceries', type: 'expense', color: '#8bb38f', icon: 'shoppingCart', budget: 20000, yearlyBudget: 240000, includeInBudget: true },
    { id: 'cat_rent', name: 'Rent', type: 'expense', color: '#5e665c', icon: 'home', budget: 120000, yearlyBudget: 1440000, includeInBudget: true },
    { id: 'cat_transport', name: 'Transport', type: 'expense', color: '#40563f', icon: 'car', budget: 15000, yearlyBudget: 180000, includeInBudget: true },
    { id: 'cat_entertainment', name: 'Entertainment', type: 'expense', color: '#cfa87b', icon: 'film', budget: 30000, yearlyBudget: 360000, includeInBudget: true },
    { id: 'cat_shopping', name: 'Shopping', type: 'expense', color: '#aabfa9', icon: 'shoppingBag', budget: 40000, yearlyBudget: 480000, includeInBudget: true }
  ];

  // Set default Wallets
  MidoriState.wallets = [
    { id: 'w_cash', name: 'Pocket Cash', balance: 15000, currency: 'JPY', type: 'Cash', color: '#5a7d5b', openingBalance: 10000 },
    { id: 'w_bank', name: 'Sumitomo Mitsui Bank', balance: 350000, currency: 'JPY', type: 'Debit Card', color: '#2d5a27', openingBalance: 280000 },
    { id: 'w_thai', name: 'SCB Bank', balance: 45000, currency: 'THB', type: 'Savings', color: '#8ba88f', openingBalance: 30000 }
  ];

  saveState();
}

// Clear Database completely to an absolute blank slate
function clearDatabase() {
  MidoriState = {
    wallets: [],
    categories: [],
    transactions: [],
    schedules: [],
    preferences: {
      theme: 'dark',
      baseCurrency: 'THB',
      autoSyncDeviceDate: true,
      syncEnabled: false,
      syncId: null,
      syncKey: null,
      lastSyncedAt: 0,
      cloudRevision: 0
    },
    virtualDate: getDeviceTodayDateStr(),
    updatedAt: Date.now()
  };
  saveState();
}

// Generate beautiful green dummy data with high visual fidelity
function generateMatchaDummyData() {
  resetToDefaultState();
  
  const currentDate = new Date(MidoriState.virtualDate);
  const transactions = [];
  
  // Set up transactions going back 40 days
  const baseDate = new Date(currentDate);
  baseDate.setDate(baseDate.getDate() - 40);
  
  const tags = {
    salary: 'cat_salary',
    freelance: 'cat_freelance',
    investment: 'cat_investment',
    food: 'cat_food',
    groceries: 'cat_groceries',
    rent: 'cat_rent',
    transport: 'cat_transport',
    entertainment: 'cat_entertainment',
    shopping: 'cat_shopping'
  };

  // 1. Regular Monthly Income
  const lastMonthSalaryDate = new Date(baseDate);
  lastMonthSalaryDate.setDate(25);
  transactions.push({
    id: generateUUID(),
    title: 'Monthly Salary',
    amount: 320000,
    type: 'income',
    walletId: 'w_bank',
    categoryId: tags.salary,
    date: lastMonthSalaryDate.toISOString().split('T')[0],
    note: 'Sumitomo bank monthly salary deposit',
    scheduledId: null
  });

  const lastMonthFreelance = new Date(baseDate);
  lastMonthFreelance.setDate(28);
  transactions.push({
    id: generateUUID(),
    title: 'Web Dev Freelance',
    amount: 85000,
    type: 'income',
    walletId: 'w_bank',
    categoryId: tags.freelance,
    date: lastMonthFreelance.toISOString().split('T')[0],
    note: 'Responsive landing page design',
    scheduledId: null
  });

  // 2. Regular Rent payment
  const lastMonthRent = new Date(baseDate);
  lastMonthRent.setDate(27);
  transactions.push({
    id: generateUUID(),
    title: 'Appartment Rent',
    amount: 110000,
    type: 'expense',
    walletId: 'w_bank',
    categoryId: tags.rent,
    date: lastMonthRent.toISOString().split('T')[0],
    note: 'Automatic rent transfer',
    scheduledId: null
  });

  // 3. SCB Bank Deposits
  const scbSalary = new Date(baseDate);
  scbSalary.setDate(30);
  transactions.push({
    id: generateUUID(),
    title: 'Freelance Design Project',
    amount: 12000,
    type: 'income',
    walletId: 'w_thai',
    categoryId: tags.freelance,
    date: scbSalary.toISOString().split('T')[0],
    note: 'Logo design for international client',
    scheduledId: null
  });

  // 4. Spread out dining, shopping, groceries, transport transactions
  const foodDescriptions = [
    { title: 'Ichiran Ramen', amount: 1250, wallet: 'w_cash' },
    { title: '7-Eleven Snacks', amount: 780, wallet: 'w_cash' },
    { title: 'Starbucks Matcha Latte', amount: 650, wallet: 'w_bank' },
    { title: 'Sushiro Lunch', amount: 2400, wallet: 'w_bank' },
    { title: 'Yakitori Dinner', amount: 4800, wallet: 'w_cash' },
    { title: 'FamilyMart Coffee', amount: 220, wallet: 'w_cash' }
  ];

  const groceryDescriptions = [
    { title: 'Aeon Supermarket', amount: 5600, wallet: 'w_bank' },
    { title: 'Life Grocery Store', amount: 3200, wallet: 'w_cash' },
    { title: 'Don Quijote', amount: 8900, wallet: 'w_bank' }
  ];

  const transportDescriptions = [
    { title: 'Suica Recharge', amount: 2000, wallet: 'w_cash' },
    { title: 'Taxi Ride', amount: 1800, wallet: 'w_bank' },
    { title: 'Subway Ticket', amount: 340, wallet: 'w_cash' }
  ];

  const shoppingDescriptions = [
    { title: 'UNIQLO Linen Shirt', amount: 3990, wallet: 'w_bank' },
    { title: 'MUJI Storage Boxes', amount: 2200, wallet: 'w_cash' },
    { title: 'BookOff Manga Purchase', amount: 1500, wallet: 'w_cash' }
  ];

  const entertainmentDescriptions = [
    { title: 'Toho Cinema Ticket', amount: 1900, wallet: 'w_bank' },
    { title: 'Nintendo eShop Game', amount: 6800, wallet: 'w_bank' },
    { title: 'Exhibition Entry Fee', amount: 1200, wallet: 'w_cash' }
  ];

  // Distribute dining/shopping transactions randomly over the past 40 days
  let tempDate = new Date(baseDate);
  let trIndex = 0;
  while (tempDate <= currentDate) {
    const day = tempDate.getDate();
    // Every 2 days, let's add a food expense
    if (day % 2 === 0) {
      const desc = foodDescriptions[trIndex % foodDescriptions.length];
      transactions.push({
        id: generateUUID(),
        title: desc.title,
        amount: desc.amount + (day * 10),
        type: 'expense',
        walletId: desc.wallet,
        categoryId: tags.food,
        date: tempDate.toISOString().split('T')[0],
        note: 'Outing expense',
        scheduledId: null
      });
    }

    // Every 5 days, groceries
    if (day % 5 === 0) {
      const desc = groceryDescriptions[trIndex % groceryDescriptions.length];
      transactions.push({
        id: generateUUID(),
        title: desc.title,
        amount: desc.amount,
        type: 'expense',
        walletId: desc.wallet,
        categoryId: tags.groceries,
        date: tempDate.toISOString().split('T')[0],
        note: 'Weekly essentials',
        scheduledId: null
      });
    }

    // Every 6 days, transport
    if (day % 6 === 0) {
      const desc = transportDescriptions[trIndex % transportDescriptions.length];
      transactions.push({
        id: generateUUID(),
        title: desc.title,
        amount: desc.amount,
        type: 'expense',
        walletId: desc.wallet,
        categoryId: tags.transport,
        date: tempDate.toISOString().split('T')[0],
        note: 'Commute',
        scheduledId: null
      });
    }

    // Every 8 days, shopping
    if (day % 8 === 0) {
      const desc = shoppingDescriptions[trIndex % shoppingDescriptions.length];
      transactions.push({
        id: generateUUID(),
        title: desc.title,
        amount: desc.amount,
        type: 'expense',
        walletId: desc.wallet,
        categoryId: tags.shopping,
        date: tempDate.toISOString().split('T')[0],
        note: 'Apparel & tools',
        scheduledId: null
      });
    }

    // Every 12 days, entertainment
    if (day % 12 === 0) {
      const desc = entertainmentDescriptions[trIndex % entertainmentDescriptions.length];
      transactions.push({
        id: generateUUID(),
        title: desc.title,
        amount: desc.amount,
        type: 'expense',
        walletId: desc.wallet,
        categoryId: tags.entertainment,
        date: tempDate.toISOString().split('T')[0],
        note: 'Leisure',
        scheduledId: null
      });
    }

    trIndex++;
    tempDate.setDate(tempDate.getDate() + 1);
  }

  // Set schedules
  const schedules = [
    {
      id: 'sch_netflix',
      title: 'Netflix Standard Plan',
      amount: 1490,
      type: 'expense',
      walletId: 'w_bank',
      categoryId: tags.entertainment,
      frequency: 'monthly',
      startDate: '2026-05-01',
      nextDueDate: '2026-06-01',
      active: true
    },
    {
      id: 'sch_spotify',
      title: 'Spotify Premium Family',
      amount: 1680,
      type: 'expense',
      walletId: 'w_bank',
      categoryId: tags.entertainment,
      frequency: 'monthly',
      startDate: '2026-05-05',
      nextDueDate: '2026-06-05',
      active: true
    },
    {
      id: 'sch_gym',
      title: 'Gym Membership',
      amount: 8800,
      type: 'expense',
      walletId: 'w_bank',
      categoryId: tags.transport,
      frequency: 'monthly',
      startDate: '2026-05-10',
      nextDueDate: '2026-06-10',
      active: true
    },
    {
      id: 'sch_savings_trans',
      title: 'Auto Saving Transfer',
      amount: 30000,
      type: 'expense',
      walletId: 'w_bank',
      categoryId: tags.investment,
      frequency: 'monthly',
      startDate: '2026-05-25',
      nextDueDate: '2026-05-25',
      active: true
    }
  ];

  MidoriState.transactions = transactions;
  MidoriState.schedules = schedules;
  
  recalculateWalletBalances();
}

// Recalculate all wallet balances based on loaded transactions, converting currencies dynamically!
function recalculateWalletBalances() {
  MidoriState.wallets.forEach(wallet => {
    wallet.balance = Number(wallet.openingBalance) || 0;
  });

  const sorted = [...MidoriState.transactions]
    .filter(tx => tx.date <= MidoriState.virtualDate)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  
  sorted.forEach(tx => {
    // 1. Process From Wallet (deduction for 'expense' and 'transfer', addition for 'income')
    const wallet = MidoriState.wallets.find(w => w.id === tx.walletId);
    if (wallet) {
      const txCurrency = tx.currency || wallet.currency;
      const amountInWalletCurrency = convertAmount(tx.amount, txCurrency, wallet.currency);
      if (tx.type === 'income') {
        wallet.balance += amountInWalletCurrency;
      } else {
        wallet.balance -= amountInWalletCurrency;
      }
    }

    // 2. Process To Wallet (addition only for 'transfer')
    if (tx.type === 'transfer' && tx.toWalletId) {
      const toWallet = MidoriState.wallets.find(w => w.id === tx.toWalletId);
      if (toWallet) {
        const txCurrency = tx.currency || toWallet.currency;
        const amountInToWalletCurrency = convertAmount(tx.amount, txCurrency, toWallet.currency);
        toWallet.balance += amountInToWalletCurrency;
      }
    }
  });

  saveState();
}

/**
 * CRUD Methods
 */

// Wallets
function addWallet(wallet) {
  wallet.id = generateUUID();
  wallet.balance = Number(wallet.balance) || 0;
  touchRecord(wallet);
  MidoriState.wallets.push(wallet);
  saveState();
}

function updateWallet(walletId, updatedFields) {
  const index = MidoriState.wallets.findIndex(w => w.id === walletId);
  if (index !== -1) {
    MidoriState.wallets[index] = touchRecord({ ...MidoriState.wallets[index], ...updatedFields });
    saveState();
  }
}

function deleteWallet(walletId) {
  MidoriState.wallets = MidoriState.wallets.filter(w => w.id !== walletId);

  // Drop transactions on BOTH sides of the wallet. Filtering only on walletId
  // left transfers whose toWalletId pointed at the deleted wallet: the source
  // was still debited but nothing was credited, so the transferred amount
  // silently vanished from net worth.
  const removedTransactions = MidoriState.transactions.filter(
    t => t.walletId === walletId || t.toWalletId === walletId
  );
  MidoriState.transactions = MidoriState.transactions.filter(
    t => t.walletId !== walletId && t.toWalletId !== walletId
  );

  // Schedules pointing at a deleted wallet would keep generating transactions
  // into an account that no longer exists.
  const removedSchedules = MidoriState.schedules.filter(s => s.walletId === walletId);
  MidoriState.schedules = MidoriState.schedules.filter(s => s.walletId !== walletId);

  // The whole cascade is tombstoned, not just the wallet: another device still
  // holding those transactions and schedules would otherwise re-add them on the
  // next sync, leaving orphans pointing at a wallet that no longer exists.
  recordDeletion([walletId]
    .concat(removedTransactions.map(t => t.id))
    .concat(removedSchedules.map(s => s.id)));

  // Every other mutator recalculates; this one did not, so the remaining
  // wallets kept balances that included the now-deleted transactions until
  // some unrelated later action happened to trigger a recalculation.
  recalculateWalletBalances();
}

// Categories/Tags
function addCategory(category) {
  category.id = generateUUID();
  category.budget = category.budget ? Number(category.budget) : null;
  category.yearlyBudget = category.yearlyBudget ? Number(category.yearlyBudget) : (category.budget ? category.budget * 12 : null);
  category.includeInBudget = category.includeInBudget !== undefined ? !!category.includeInBudget : (category.type === 'expense');
  touchRecord(category);
  MidoriState.categories.push(category);
  saveState();
}

function updateCategory(categoryId, updatedFields) {
  const index = MidoriState.categories.findIndex(c => c.id === categoryId);
  if (index !== -1) {
    if (updatedFields.budget !== undefined) {
      updatedFields.budget = updatedFields.budget ? Number(updatedFields.budget) : null;
    }
    if (updatedFields.yearlyBudget !== undefined) {
      updatedFields.yearlyBudget = updatedFields.yearlyBudget ? Number(updatedFields.yearlyBudget) : null;
    }
    if (updatedFields.includeInBudget !== undefined) {
      updatedFields.includeInBudget = !!updatedFields.includeInBudget;
    }
    MidoriState.categories[index] = touchRecord({ ...MidoriState.categories[index], ...updatedFields });
    saveState();
  }
}

function deleteCategory(categoryId) {
  MidoriState.categories = MidoriState.categories.filter(c => c.id !== categoryId);

  // Clear dangling references rather than leaving ids that resolve to nothing.
  // Transaction history is preserved (it just becomes uncategorised), but
  // schedules are deactivated because they would otherwise keep minting new
  // transactions against a category the user deliberately removed.
  // These are edits, not deletions, so they are touched rather than tombstoned —
  // without that the other device's copy still carries the dead categoryId and,
  // being untouched-but-equal, could win the merge and restore the broken link.
  MidoriState.transactions.forEach(tx => {
    if (tx.categoryId === categoryId) {
      tx.categoryId = null;
      touchRecord(tx);
    }
  });
  MidoriState.schedules.forEach(schedule => {
    if (schedule.categoryId === categoryId) {
      schedule.categoryId = null;
      schedule.active = false;
      touchRecord(schedule);
    }
  });

  recordDeletion(categoryId);
  saveState();
}

// Transactions
function addTransaction(tx) {
  tx.id = generateUUID();
  tx.amount = Number(tx.amount);
  tx.date = tx.date || MidoriState.virtualDate;
  touchRecord(tx);
  MidoriState.transactions.push(tx);
  recalculateWalletBalances();
}

function deleteTransaction(txId) {
  const txIndex = MidoriState.transactions.findIndex(t => t.id === txId);
  if (txIndex !== -1) {
    MidoriState.transactions.splice(txIndex, 1);
    recordDeletion(txId);
    recalculateWalletBalances();
  }
}

function updateTransaction(txId, updatedFields) {
  const index = MidoriState.transactions.findIndex(t => t.id === txId);
  if (index !== -1) {
    if (updatedFields.amount !== undefined) {
      updatedFields.amount = Number(updatedFields.amount);
    }
    MidoriState.transactions[index] = touchRecord({ ...MidoriState.transactions[index], ...updatedFields });
    recalculateWalletBalances();
  }
}

// Schedules
function addSchedule(schedule) {
  schedule.id = generateUUID();
  schedule.amount = Number(schedule.amount);
  schedule.active = true;
  touchRecord(schedule);
  MidoriState.schedules.push(schedule);
  saveState();
}

function updateSchedule(schedId, updatedFields) {
  const index = MidoriState.schedules.findIndex(s => s.id === schedId);
  if (index !== -1) {
    MidoriState.schedules[index] = touchRecord({ ...MidoriState.schedules[index], ...updatedFields });
    saveState();
  }
}

function deleteSchedule(schedId) {
  MidoriState.schedules = MidoriState.schedules.filter(s => s.id !== schedId);
  // Delete only future occurrences of this schedule (relative to virtualDate) so past history is preserved!
  const removedTransactions = MidoriState.transactions.filter(
    t => t.scheduledId === schedId && t.date > MidoriState.virtualDate
  );
  MidoriState.transactions = MidoriState.transactions.filter(t => t.scheduledId !== schedId || t.date <= MidoriState.virtualDate);

  // Past occurrences are deliberately NOT tombstoned — they survive here, so
  // tombstoning them would delete real history off the user's other devices.
  recordDeletion([schedId].concat(removedTransactions.map(t => t.id)));
  saveState();
  recalculateWalletBalances();
}

// Preferences
function updatePreference(key, value) {
  MidoriState.preferences[key] = value;
  saveState();
}

// Export Entire State
function exportStateJSON() {
  return JSON.stringify(MidoriState, null, 2);
}

// Validate the shape of a parsed backup before accepting it, so a malformed
// or hand-edited JSON file can't silently corrupt MidoriState.
function isValidStateShape(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;

  const arrayFields = ['wallets', 'categories', 'transactions', 'schedules'];
  for (const field of arrayFields) {
    if (!Array.isArray(parsed[field])) return false;
  }

  const hasRequiredFields = (item, fields) =>
    item && typeof item === 'object' && fields.every(f => item[f] !== undefined && item[f] !== null);

  const walletsValid = parsed.wallets.every(w => hasRequiredFields(w, ['id', 'name', 'currency']));
  const categoriesValid = parsed.categories.every(c => hasRequiredFields(c, ['id', 'name', 'type']));
  const transactionsValid = parsed.transactions.every(t => hasRequiredFields(t, ['id', 'title', 'amount', 'type', 'walletId', 'date']));
  // A schedule's frequency must be one the recurrence engine can actually
  // advance. Checking only that the field EXISTS let a hand-edited or corrupted
  // backup through with e.g. "fortnightly", which made every occurrence loop
  // spin forever and exhaust memory on the next date change.
  const schedulesValid = parsed.schedules.every(s =>
    hasRequiredFields(s, ['id', 'title', 'amount', 'type', 'walletId', 'frequency', 'startDate', 'nextDueDate']) &&
    (typeof isValidFrequency !== 'function' || isValidFrequency(s.frequency))
  );

  return walletsValid && categoriesValid && transactionsValid && schedulesValid;
}

// Import Entire State
function importStateJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    if (isValidStateShape(parsed)) {
      MidoriState = parsed;
      saveState();
      cleanupOrphanedFutureTransactions();
      recalculateWalletBalances();
      return true;
    }
    console.error('Import failed: backup file does not match the expected state shape.');
  } catch (e) {
    console.error('Import failed', e);
  }
  return false;
}

// Web Crypto AES-GCM Encrypted Cloud Sync (ZenSync) Engine

// OWASP-recommended floor for PBKDF2-HMAC-SHA256 (2023 guidance).
const PBKDF2_ITERATIONS = 310000;
const PAYLOAD_VERSION = 'v2';

// Stretch the sync key into an AES-GCM key.
// The salt is the syncId: it is unique per ledger and identical on every paired
// device, so both sides derive the same key without transporting extra state.
// A salt is public by design — its job is to stop precomputed/rainbow attacks
// being shared across users, not to be secret.
async function deriveKey(syncKeyStr, saltStr) {
  const encoder = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(syncKeyStr),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(String(saltStr || 'midori_default_salt')),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Pre-v2 derivation: a single unsalted SHA-256 pass. Retained ONLY so ledgers
// synced before the PBKDF2 upgrade can still be read; such payloads are
// transparently re-encrypted at v2 on the next push. Never used to encrypt.
async function deriveLegacyKey(syncKeyStr) {
  const encoder = new TextEncoder();
  const hash = await window.crypto.subtle.digest('SHA-256', encoder.encode(syncKeyStr));
  return await window.crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

function bytesToBase64(bytes) {
  let binary = '';
  // Chunked to avoid blowing the argument limit on large ledgers, which
  // String.fromCharCode(...bytes) would do with a RangeError.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptData(plaintextStr, syncKeyStr, saltStr) {
  const encoder = new TextEncoder();
  const aesKey = await deriveKey(syncKeyStr, saltStr);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    aesKey,
    encoder.encode(plaintextStr)
  );

  return `${PAYLOAD_VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertextBuffer))}`;
}

async function decryptData(encryptedPayload, syncKeyStr, saltStr) {
  const parts = String(encryptedPayload).split(':');

  let ivBase64;
  let ciphertextBase64;
  let aesKey;

  if (parts.length === 3 && parts[0] === PAYLOAD_VERSION) {
    ivBase64 = parts[1];
    ciphertextBase64 = parts[2];
    aesKey = await deriveKey(syncKeyStr, saltStr);
  } else if (parts.length === 2) {
    // Legacy unversioned payload written before the PBKDF2 upgrade.
    ivBase64 = parts[0];
    ciphertextBase64 = parts[1];
    aesKey = await deriveLegacyKey(syncKeyStr);
  } else {
    throw new Error('Invalid encrypted payload format.');
  }

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
    aesKey,
    base64ToBytes(ciphertextBase64)
  );

  return new TextDecoder().decode(decryptedBuffer);
}

function generateSecureSyncId() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return 'mds_' + cryptoObj.randomUUID().replace(/-/g, '');
  }
  return 'mds_' + randomToken(24);
}

// The sync key is the sole input to the AES-GCM key, so it MUST come from a
// CSPRNG. This previously used Math.random(), whose internal state is
// recoverable from observed output — meaning the "24 random characters" offered
// far less entropy than it appeared to, and every ZenSync payload was at risk.
function generateSyncCredentials() {
  return {
    syncId: generateSecureSyncId(),
    syncKey: 'msk_' + randomToken(32)
  };
}

let syncDebounceTimeout = null;

function triggerAutoSyncPush() {
  if (!canSync()) {
    return;
  }

  if (syncDebounceTimeout) {
    clearTimeout(syncDebounceTimeout);
  }
  
  syncDebounceTimeout = setTimeout(() => {
    pushStateToCloud();
  }, 2000);
}

// A push that loses the compare-and-swap merges and tries again. Bounded,
// because each retry is only useful if the OTHER device has stopped writing —
// an unbounded loop against a busy peer would spin forever.
const SYNC_PUSH_MAX_ATTEMPTS = 3;

// The server revision this device last successfully wrote or read. This, not a
// timestamp, is what decides whether a push is safe: it is assigned by Postgres
// and increments monotonically, so it cannot be skewed by a wrong device clock.
// The previous implementation compared Date.now() across devices, and a clock
// that was behind silently discarded the newer ledger.
function getCloudRevision() {
  return Number(MidoriState.preferences.cloudRevision) || 0;
}

function setCloudRevision(revision) {
  MidoriState.preferences.cloudRevision = Number(revision) || 0;
}

function canSync() {
  return !!(MidoriState.preferences.syncEnabled
    && MidoriState.preferences.syncKey
    && MidoriState.preferences.syncId
    && typeof isSignedInToSupabase === 'function'
    && isSignedInToSupabase());
}

async function decryptEnvelopeToState(encryptedData) {
  const decryptedJson = await decryptData(
    encryptedData,
    MidoriState.preferences.syncKey,
    MidoriState.preferences.syncId
  );
  const parsed = JSON.parse(decryptedJson);
  // The payload is authenticated by AES-GCM, so this is not a trust boundary —
  // it catches a ledger from an incompatible version, which would otherwise
  // merge into a state with missing collections and throw somewhere less obvious.
  if (!isValidStateShape(parsed)) {
    throw new Error('Cloud ledger has an unrecognised shape; refusing to merge it.');
  }
  return parsed;
}

/**
 * Merges a decrypted remote ledger into the live state and persists it.
 *
 * Writes to localStorage directly rather than through saveState(), because
 * saveState() schedules another auto-push — applying an incoming merge would
 * queue a push that queues a merge, and two devices left open would trade
 * writes indefinitely. The caller pushes once, explicitly, when it needs to.
 */
function applyRemoteState(remoteState) {
  MidoriState = mergeLedgerStates(MidoriState, remoteState, Date.now());

  cleanupOrphanedFutureTransactions();
  recalculateWalletBalances();

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(MidoriState));
  } catch (e) {
    console.error('Merged ledger could not be persisted locally.', e);
    window.dispatchEvent(new CustomEvent('midoriStorageQuotaExceeded'));
  }
  window.dispatchEvent(new CustomEvent('midoriStateChanged'));
}

async function pushStateToCloud() {
  if (!canSync()) return false;

  updateSyncStatusIndicator('syncing');

  try {
    for (let attempt = 1; attempt <= SYNC_PUSH_MAX_ATTEMPTS; attempt++) {
      const encrypted = await encryptData(
        JSON.stringify(MidoriState),
        MidoriState.preferences.syncKey,
        MidoriState.preferences.syncId
      );

      const result = await supabasePushEnvelope(
        encrypted,
        MidoriState.updatedAt || Date.now(),
        getCloudRevision()
      );

      if (result && result.status === 'conflict') {
        // Expected, not an error: another device wrote since this one last read.
        // The response carries that device's ledger, so merge it in and retry
        // against the revision it reported. Overwriting here is exactly the
        // data loss this whole mechanism exists to prevent.
        console.log(`Push conflicted at revision ${result.revision}; merging and retrying (attempt ${attempt}).`);
        if (result.encrypted_data) {
          applyRemoteState(await decryptEnvelopeToState(result.encrypted_data));
        }
        setCloudRevision(result.revision);
        continue;
      }

      setCloudRevision(result && result.revision);
      MidoriState.preferences.lastSyncedAt = Date.now();
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(MidoriState));
      updateSyncStatusIndicator('synced');
      return true;
    }

    // Losing the race this many times in a row means another device is writing
    // continuously. Local data is intact and the next push will try again;
    // reporting an error is honest about the ledger not being uploaded yet.
    console.warn(`Gave up pushing after ${SYNC_PUSH_MAX_ATTEMPTS} conflicting attempts.`);
    updateSyncStatusIndicator('error');
    return false;
  } catch (e) {
    console.error('Failed to push state to cloud:', e);
    updateSyncStatusIndicator('error');
    return false;
  }
}

async function pullStateFromCloud() {
  if (!canSync()) return false;

  updateSyncStatusIndicator('syncing');

  try {
    const envelope = await supabasePullEnvelope();

    if (!envelope) {
      // Nothing stored yet — this is the first device to sync this account.
      console.log('No ledger in the cloud yet; seeding it from this device.');
      return await pushStateToCloud();
    }

    applyRemoteState(await decryptEnvelopeToState(envelope.encrypted_data));
    setCloudRevision(envelope.revision);

    // Push straight back. The merge result almost always differs from what the
    // server holds — it now contains this device's records too — and leaving it
    // unpushed would mean the other device never learns about them.
    return await pushStateToCloud();
  } catch (e) {
    console.error('Failed to pull state from cloud:', e);
    updateSyncStatusIndicator('error');
    return false;
  }
}

function updateSyncStatusIndicator(status) {
  if (typeof window.updateSyncUI === 'function') {
    window.updateSyncUI(status);
  }
}

loadState();
