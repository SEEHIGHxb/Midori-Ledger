/**
 * Midori — Premium Finance Ledger App
 * sync.js: ZenSync cloud pairing, QR scanning & sync status UI.
 */

// --- Cloud account (Supabase) ----------------------------------------------
// Sign-in decides which row on the server belongs to this user. It is NOT what
// keeps the ledger private — that is the AES key behind the pairing code, which
// never leaves the device. Both are required for sync to work.

function signInToCloud() {
  signInWithGoogle();
}

function signOutOfCloud() {
  if (!confirm('Sign out of the cloud account? Your ledger stays on this device, but syncing will stop until you sign in again.')) {
    return;
  }
  signOutFromSupabase().then(() => {
    renderCloudAccountUI();
    renderAllViews();
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

  status.innerText = signedIn ? 'Signed in' : 'Not signed in';
  status.style.color = signedIn ? 'var(--green-mint)' : '';
  signInBtn.style.display = signedIn ? 'none' : 'inline-flex';
  signOutBtn.style.display = signedIn ? 'inline-flex' : 'none';

  if (!hint) return;
  if (window.location.protocol === 'file:') {
    // Google cannot redirect back to a file:// page, so sign-in genuinely
    // cannot work here. Saying so is better than a button that dead-ends.
    hint.innerText = 'Cloud sync needs the hosted version of Midori. Open the app from its web address to sign in.';
    signInBtn.disabled = true;
  } else {
    hint.innerText = signedIn
      ? 'Your ledger is encrypted on this device before upload — the server never holds the key.'
      : 'Sign in to store your encrypted ledger. Your data is encrypted on this device first — the server never holds the key.';
    signInBtn.disabled = false;
  }
}

function enableZenSync() {
  if (typeof isSignedInToSupabase === 'function' && !isSignedInToSupabase()) {
    // Enabling sync without an account would queue pushes that every attempt
    // rejects, and the only symptom would be a permanently amber status dot.
    alert('Sign in to your cloud account first — that is what tells the server which ledger is yours.');
    return;
  }
  if (confirm('Enable secure Cloud Sync? A private Sync Key will be generated for pairing.')) {
    const creds = generateSyncCredentials();
    updatePreference('syncId', creds.syncId);
    updatePreference('syncKey', creds.syncKey);
    updatePreference('syncEnabled', true);
    
    pushStateToCloud().then(success => {
      if (success) {
        alert('ZenSync activated! A pairing QR code has been created in Settings.');
      } else {
        alert('ZenSync activated locally, but failed to upload initial cloud backup. The app will retry in the background.');
      }
      renderAllViews();
    });
  }
}

function disableZenSync() {
  if (confirm('CAUTION: Disable Cloud Sync? Your data remains local on this device, but multi-device synchronization will stop.')) {
    updatePreference('syncEnabled', false);
    updatePreference('syncId', null);
    updatePreference('syncKey', null);
    updatePreference('lastSyncedAt', 0);
    renderAllViews();
  }
}

function openPairingModal() {
  document.getElementById('pairingCode').value = '';
  openModal('modalPairing');
}

function copySyncField(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value)
      .then(() => {
        alert('Sync credentials copied to clipboard!');
      })
      .catch(err => {
        console.error('Copy failed:', err);
      });
  }
}

let syncKeyVisible = false;
function toggleSyncKeyVisibility() {
  const keyInput = document.getElementById('sync-key-display');
  const toggleBtn = document.getElementById('btn-toggle-sync-key-visibility');
  if (keyInput && toggleBtn) {
    syncKeyVisible = !syncKeyVisible;
    keyInput.type = syncKeyVisible ? 'text' : 'password';
    toggleBtn.innerText = syncKeyVisible ? 'Hide' : 'Show';
  }
}

function submitPairingForm(e) {
  e.preventDefault();
  const pairingCode = document.getElementById('pairingCode').value.trim();
  const parts = pairingCode.split('|');
  
  if (parts.length !== 2) {
    alert('Invalid Pairing Code format. Please enter a valid pairing string matching the "mds_xxx|msk_yyy" format.');
    return;
  }
  
  const syncId = parts[0].trim();
  const syncKey = parts[1].trim();
  
  if (!syncId.startsWith('mds_') || !syncKey.startsWith('msk_')) {
    alert('Invalid credentials structure. Sync ID must start with "mds_" and Sync Key must start with "msk_".');
    return;
  }
  
  if (confirm('Link this device? Your current local data will be replaced by the synced cloud data. Proceed?')) {
    stopQRScanner();
    closeModal('modalPairing');
    
    MidoriState.preferences.syncId = syncId;
    MidoriState.preferences.syncKey = syncKey;
    MidoriState.preferences.syncEnabled = true;
    MidoriState.preferences.lastSyncedAt = 0;
    
    pullStateFromCloud().then(success => {
      if (success) {
        updatePreference('syncId', syncId);
        updatePreference('syncKey', syncKey);
        updatePreference('syncEnabled', true);
        alert('Device successfully linked! Your ledger has been synchronized.');
        applyTheme(MidoriState.preferences.theme);
        document.getElementById('baseCurrencySelect').value = MidoriState.preferences.baseCurrency;
        renderAllViews();
      } else {
        MidoriState.preferences.syncEnabled = false;
        MidoriState.preferences.syncId = null;
        MidoriState.preferences.syncKey = null;
        alert('Failed to pull sync data. Please check your Pairing Code and internet connection.');
        renderAllViews();
      }
    });
  }
}

function forceSyncPush() {
  pushStateToCloud().then(success => {
    if (success) {
      alert('Local database exported successfully to the cloud.');
      renderAllViews();
    } else {
      alert('Failed to export data to cloud. Please check connection.');
    }
  });
}

function forceSyncPull() {
  if (confirm('Import data from cloud? This will overwrite your local state with the cloud state. Proceed?')) {
    const tempLastSynced = MidoriState.preferences.lastSyncedAt;
    MidoriState.updatedAt = 0; 
    
    pullStateFromCloud().then(success => {
      if (success) {
        alert('Data successfully imported from the cloud.');
        applyTheme(MidoriState.preferences.theme);
        document.getElementById('baseCurrencySelect').value = MidoriState.preferences.baseCurrency;
        renderAllViews();
      } else {
        MidoriState.preferences.lastSyncedAt = tempLastSynced;
        alert('Failed to import data from the cloud. Please check connection.');
      }
    });
  }
}

// Client-Side Camera-Based QR Code Scanning Loop
let qrVideoTrack = null;
let qrScanRequestFrame = null;

function startQRScanner() {
  const container = document.getElementById('qr-reader-container');
  const video = document.getElementById('qr-video');
  const scanBtn = document.getElementById('btn-scan-qr');
  if (!container || !video) return;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      if (scanBtn) scanBtn.style.display = 'none';
      container.style.display = 'block';
      video.srcObject = stream;
      video.setAttribute('playsinline', true);
      video.play();
      qrVideoTrack = stream.getVideoTracks()[0];
      qrScanRequestFrame = requestAnimationFrame(scanQRCodeFrame);
    })
    .catch(err => {
      console.error('Camera access failed:', err);
      alert('Could not access camera. Please paste your Pairing Code manually instead.');
    });
}

function stopQRScanner() {
  const container = document.getElementById('qr-reader-container');
  const video = document.getElementById('qr-video');
  const scanBtn = document.getElementById('btn-scan-qr');
  
  if (qrScanRequestFrame) {
    cancelAnimationFrame(qrScanRequestFrame);
    qrScanRequestFrame = null;
  }
  
  if (qrVideoTrack) {
    qrVideoTrack.stop();
    qrVideoTrack = null;
  }
  
  if (video) {
    video.srcObject = null;
  }
  
  if (container) {
    container.style.display = 'none';
  }
  
  if (scanBtn) {
    scanBtn.style.display = 'inline-flex';
  }
}

function scanQRCodeFrame() {
  const video = document.getElementById('qr-video');
  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (typeof jsQR !== 'undefined') {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      
      if (code) {
        const qrText = code.data.trim();
        console.log('QR Code scanned:', qrText);
        if (qrText.includes('|')) {
          document.getElementById('pairingCode').value = qrText;
          stopQRScanner();
          const form = document.getElementById('pairingForm');
          if (form) {
            form.dispatchEvent(new Event('submit', { cancelable: true }));
          }
          return;
        }
      }
    }
  }
  qrScanRequestFrame = requestAnimationFrame(scanQRCodeFrame);
}

// Render ZenSync configuration UI and QR pairing canvas dynamically
window.updateSyncUI = function(status) {
  const syncEnabled = MidoriState.preferences.syncEnabled;
  const syncId = MidoriState.preferences.syncId;
  const syncKey = MidoriState.preferences.syncKey;
  const lastSynced = MidoriState.preferences.lastSyncedAt;
  
  const disabledView = document.getElementById('zensync-disabled-view');
  const enabledView = document.getElementById('zensync-enabled-view');
  const headerStatus = document.getElementById('zensync-header-status');
  
  if (!disabledView || !enabledView) return;
  
  if (syncEnabled && syncId && syncKey) {
    disabledView.style.display = 'none';
    enabledView.style.display = 'block';
    if (headerStatus) headerStatus.style.display = 'flex';
    
    // Populate form fields
    const idInput = document.getElementById('sync-id-display');
    const keyInput = document.getElementById('sync-key-display');
    if (idInput) idInput.value = syncId;
    if (keyInput) keyInput.value = syncKey;
    
    // Update last sync time display
    const lastSyncedText = document.getElementById('sync-last-time');
    if (lastSyncedText) {
      if (lastSynced > 0) {
        const date = new Date(lastSynced);
        lastSyncedText.innerText = `Synced at: ${date.toLocaleTimeString()}`;
      } else {
        lastSyncedText.innerText = 'Never synced';
      }
    }
    
    // Set dynamic sync status state
    let currentStatus = status;
    if (!currentStatus) {
      currentStatus = 'synced'; // default active state
    }
    
    const statusLabel = document.getElementById('sync-status-label');
    const headerDot = document.getElementById('zensync-header-dot');
    const headerText = document.getElementById('zensync-header-text');
    
    if (currentStatus === 'syncing') {
      if (statusLabel) {
        statusLabel.innerText = 'Syncing...';
        statusLabel.style.color = 'var(--autumn-terracotta)';
      }
      if (headerDot) {
        headerDot.style.background = '#e69c24'; // Warm gold
        headerDot.style.animation = 'pulse 0.8s infinite';
      }
      if (headerText) headerText.innerText = 'Syncing...';
    } else if (currentStatus === 'error') {
      if (statusLabel) {
        statusLabel.innerText = 'Sync Error';
        statusLabel.style.color = '#bf4343'; // Error red
      }
      if (headerDot) {
        headerDot.style.background = '#bf4343'; // Error red
        headerDot.style.animation = 'none';
      }
      if (headerText) headerText.innerText = 'Sync Error';
    } else { // synced
      if (statusLabel) {
        statusLabel.innerText = 'Active';
        statusLabel.style.color = 'var(--green-mint)';
      }
      if (headerDot) {
        headerDot.style.background = 'var(--green-mint)';
        headerDot.style.animation = 'sync-pulse 2s infinite ease-in-out';
      }
      if (headerText) headerText.innerText = 'Synced';
    }
    
    // Draw beautiful pairing QR Code canvas
    const canvas = document.getElementById('sync-qrcode-canvas');
    if (canvas && typeof QRCode !== 'undefined') {
      const pairingText = `${syncId}|${syncKey}`;
      QRCode.toCanvas(canvas, pairingText, {
        width: 160,
        margin: 1,
        color: {
          dark: '#1e381b',  // Matcha forest green theme
          light: '#ffffff' // Crisp white background
        }
      }, function (error) {
        if (error) console.error('Failed to render pairing QR Code:', error);
      });
    }
  } else {
    disabledView.style.display = 'block';
    enabledView.style.display = 'none';
    if (headerStatus) headerStatus.style.display = 'none';
  }
};
