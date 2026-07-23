/**
 * Midori — Premium Finance Ledger App
 * sync.js: Cloud sync UI — Google account status and manual sync control.
 *
 * Setup is now a single Google sign-in. The encryption key is derived from the
 * signed-in account (see deriveSyncCredentialsFromUserId in state.js), so there
 * is nothing to pair: the Sync Key/ID fields, the pairing modal, the QR code
 * and the camera scanner that used to live in this file are gone with it.
 */

// --- Cloud account (Supabase) ----------------------------------------------

function signInToCloud() {
  // Redirects the page to Google (web) or diverts into a Custom Tab (Android).
  // Sync is activated when the tokens come back — see activateSyncForCurrentUser
  // in the startup path and __midoriHandleAuthFragment.
  signInWithGoogle();
}

function signOutOfCloud() {
  if (!confirm('Sign out of your cloud account? Your ledger stays on this device, but it will stop syncing until you sign in again.')) {
    return;
  }
  signOutFromSupabase().then(() => {
    if (typeof deactivateSync === 'function') deactivateSync();
    renderCloudAccountUI();
    renderAllViews();
  });
}

// Manual "Sync now". pullStateFromCloud merges the cloud ledger into local and
// pushes the result back, so this single call covers both directions.
function syncNow() {
  if (typeof isSignedInToSupabase === 'function' && !isSignedInToSupabase()) {
    alert('Sign in with Google first — that is what turns on syncing.');
    return;
  }
  pullStateFromCloud().then((ok) => {
    if (ok) {
      // A pull can carry a different theme or base currency in from another
      // device; reflect those now rather than waiting for the next reload.
      if (typeof applyTheme === 'function') applyTheme(MidoriState.preferences.theme);
      const currencySelect = document.getElementById('baseCurrencySelect');
      if (currencySelect) currencySelect.value = MidoriState.preferences.baseCurrency;
      renderAllViews();
    } else {
      alert('Could not sync just now. Check your connection and that you are still signed in.');
    }
  });
}

// Reflects sign-in state in Settings. Called on load and after sign-in/out.
function renderCloudAccountUI() {
  const status = document.getElementById('supabase-account-status');
  const hint = document.getElementById('supabase-account-hint');
  const signInBtn = document.getElementById('btn-supabase-signin');
  const signOutBtn = document.getElementById('btn-supabase-signout');
  if (!status || !signInBtn || !signOutBtn) return;

  const signedIn = typeof isSignedInToSupabase === 'function' && isSignedInToSupabase();
  const email = signedIn && typeof getSupabaseUserEmail === 'function' ? getSupabaseUserEmail() : null;

  status.innerText = signedIn ? (email ? 'Signed in as ' + email : 'Signed in') : 'Not signed in';
  status.style.color = signedIn ? 'var(--green-mint)' : '';
  signInBtn.style.display = signedIn ? 'none' : 'inline-flex';
  signOutBtn.style.display = signedIn ? 'inline-flex' : 'none';

  if (hint) {
    if (window.location.protocol === 'file:') {
      // Google cannot redirect back to a file:// page, so sign-in genuinely
      // cannot work here. Saying so beats a button that dead-ends.
      hint.innerText = 'Cloud sync needs the hosted version of Midori. Open the app from its web address to sign in.';
      signInBtn.disabled = true;
    } else {
      hint.innerText = signedIn
        ? 'Your ledger syncs automatically to every device signed into this Google account. It is encrypted, and only you can read it.'
        : 'Sign in with Google to back up and sync your ledger across devices. Nothing else to set up — no keys or codes to copy.';
      signInBtn.disabled = false;
    }
  }

  // Keep the status block (activity dot, last-synced line) in step with sign-in.
  if (typeof window.updateSyncUI === 'function') window.updateSyncUI();
}

// Renders the compact sync-status block shown when signed in: an activity dot,
// a status word, and the last-synced time. `status` is 'syncing' | 'error' |
// 'synced' (the default). Called by updateSyncStatusIndicator in state.js as a
// push/pull progresses, and by renderCloudAccountUI on sign-in changes.
window.updateSyncUI = function (status) {
  const signedIn = typeof isSignedInToSupabase === 'function' && isSignedInToSupabase();

  const enabledView = document.getElementById('zensync-enabled-view');
  const headerStatus = document.getElementById('zensync-header-status');
  if (enabledView) enabledView.style.display = signedIn ? 'block' : 'none';
  if (headerStatus) headerStatus.style.display = signedIn ? 'flex' : 'none';
  if (!signedIn) return;

  const lastSynced = MidoriState.preferences.lastSyncedAt;
  const lastSyncedText = document.getElementById('sync-last-time');
  if (lastSyncedText) {
    lastSyncedText.innerText = lastSynced > 0
      ? 'Last synced ' + new Date(lastSynced).toLocaleTimeString()
      : 'Not synced yet';
  }

  const currentStatus = status || 'synced';
  const statusLabel = document.getElementById('sync-status-label');
  const headerDot = document.getElementById('zensync-header-dot');
  const headerText = document.getElementById('zensync-header-text');

  if (currentStatus === 'syncing') {
    if (statusLabel) { statusLabel.innerText = 'Syncing…'; statusLabel.style.color = 'var(--autumn-terracotta)'; }
    if (headerDot) { headerDot.style.background = '#e69c24'; headerDot.style.animation = 'pulse 0.8s infinite'; }
    if (headerText) headerText.innerText = 'Syncing…';
  } else if (currentStatus === 'error') {
    if (statusLabel) { statusLabel.innerText = 'Sync error'; statusLabel.style.color = '#bf4343'; }
    if (headerDot) { headerDot.style.background = '#bf4343'; headerDot.style.animation = 'none'; }
    if (headerText) headerText.innerText = 'Sync error';
  } else {
    if (statusLabel) { statusLabel.innerText = 'Active'; statusLabel.style.color = 'var(--green-mint)'; }
    if (headerDot) { headerDot.style.background = 'var(--green-mint)'; headerDot.style.animation = 'sync-pulse 2s infinite ease-in-out'; }
    if (headerText) headerText.innerText = 'Synced';
  }
};
