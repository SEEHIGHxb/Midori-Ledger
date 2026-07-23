/**
 * Midori — Premium Finance Ledger
 * supabase-sync.js: Google sign-in and the encrypted-ledger transport.
 *
 * Why raw fetch instead of the supabase-js client:
 * Runaway imports supabase-js from a CDN, which Midori cannot do. The CSP here
 * omits 'unsafe-inline' and forbids remote scripts, every asset is vendored so
 * the app works offline, and index.html must still run from file:// inside the
 * Android WebView. The REST and auth endpoints are plain HTTP, so the whole
 * client is a few fetch calls and no dependency.
 *
 * What crosses the wire:
 * Only ciphertext. The ledger is encrypted with AES-GCM (encryptData in
 * state.js) before it reaches any function here, so the server stores bytes it
 * cannot read. Signing in identifies WHOSE row it is; it is not what keeps the
 * contents private.
 *
 * This file owns transport only. js/sync.js keeps the pairing/status UI.
 */

const SUPABASE_SESSION_KEY = 'midori_supabase_session';

// Refresh this far ahead of actual expiry. A sync that begins with 30 seconds
// left on the clock would otherwise take a 401 halfway through and surface as
// an unexplained network failure.
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

function readSupabaseSession() {
  try {
    const raw = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.access_token || !session.refresh_token) return null;
    return session;
  } catch (e) {
    // Corrupt JSON must not brick startup; treat it as signed out.
    console.warn('Discarding unreadable Supabase session:', e);
    return null;
  }
}

function writeSupabaseSession(session) {
  try {
    localStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.error('Could not persist Supabase session:', e);
  }
}

function clearSupabaseSession() {
  try {
    localStorage.removeItem(SUPABASE_SESSION_KEY);
  } catch (e) {
    console.warn('Could not clear Supabase session:', e);
  }
}

function isSignedInToSupabase() {
  return readSupabaseSession() !== null;
}

/**
 * Decodes the payload of a Supabase access token (a JWT) WITHOUT verifying its
 * signature. That is intentional and safe here: the token is one this device
 * received from Supabase and stored itself, and it is only read to pull out the
 * stable per-account identifier below. It is never used as a trust decision —
 * the server re-verifies the signature on every request, so a forged token
 * would simply be rejected there.
 */
function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(atob(b64));
  } catch (e) {
    return null;
  }
}

/**
 * The signed-in user's stable Supabase id (the JWT `sub`, a UUID). Identical on
 * every device the same Google account signs into, which is exactly why sync no
 * longer needs a separately-shared pairing key: this id is what both devices
 * derive their encryption key from (see deriveSyncCredentialsFromUserId in
 * state.js). Returns null when signed out or the token is unreadable.
 */
function getSupabaseUserId() {
  const session = readSupabaseSession();
  if (!session) return null;
  const payload = decodeJwtPayload(session.access_token);
  return (payload && payload.sub) ? payload.sub : null;
}

/**
 * The signed-in user's email, for display only ("Signed in as …"). Null if the
 * token carries no email claim or the user is signed out.
 */
function getSupabaseUserEmail() {
  const session = readSupabaseSession();
  if (!session) return null;
  const payload = decodeJwtPayload(session.access_token);
  return (payload && payload.email) ? payload.email : null;
}

/**
 * Where Google should send the browser back to. Explicitly origin + pathname
 * with no query or hash: reusing location.href would append a second copy of
 * the OAuth fragment on every repeat sign-in, and Supabase requires an exact
 * match against the project's Redirect URLs allow-list.
 */
function getAuthRedirectTarget() {
  return window.location.origin + window.location.pathname;
}

/**
 * True when running inside the Midori Android wrapper. The wrapper appends a
 * marker to the WebView user-agent (see MainActivity). Detection is via the UA
 * rather than a JavaScript bridge on purpose: the WebView now loads remote
 * content, and an injected bridge object would be callable by any script on the
 * page. A UA string it can only read is a smaller surface.
 */
function isAndroidWrapper() {
  return typeof navigator !== 'undefined'
    && typeof navigator.userAgent === 'string'
    && navigator.userAgent.indexOf('MidoriAndroid') !== -1;
}

/**
 * The bridge page Supabase redirects to after auth INSIDE the Android wrapper.
 * Resolved relative to the current page so it is correct whatever the GitHub
 * Pages base path is. It runs in the Custom Tab (real Chrome) and forwards the
 * result to the app over the com.midori.ledger:// deep link — the WebView can
 * neither complete Google OAuth nor read the Custom Tab's URL, so the round
 * trip has to come back through a link the app registers.
 */
function getAndroidAuthCallbackUrl() {
  return new URL('auth-callback.html', window.location.href).href;
}

function signInWithGoogle() {
  if (!isAndroidWrapper() && window.location.protocol === 'file:') {
    // Fail loudly rather than bounce the user to Google and back to a page
    // that cannot receive the token. The Android wrapper loads the hosted URL
    // for exactly this reason, so it never hits this branch.
    alert('Cloud sync needs the hosted version of Midori. Open the app from its web address rather than a local file, then sign in.');
    return;
  }

  // In the wrapper the token must return via the deep-link bridge page; on the
  // web it returns to this page and lands in the URL fragment.
  const redirectTo = isAndroidWrapper() ? getAndroidAuthCallbackUrl() : getAuthRedirectTarget();
  const url = `${SUPABASE_URL}/auth/v1/authorize`
    + `?provider=google`
    + `&redirect_to=${encodeURIComponent(redirectTo)}`;

  // On the web this navigates the page to Supabase. In the wrapper the native
  // WebViewClient recognises this exact authorize URL and diverts it into a
  // Custom Tab instead, because Google refuses OAuth inside a WebView.
  window.location.href = url;
}

function signOutFromSupabase() {
  const session = readSupabaseSession();
  clearSupabaseSession();
  if (!session) return Promise.resolve();

  // Best-effort server-side revocation. The local session is dropped first and
  // unconditionally: if this request fails the user must still end up signed
  // out on this device, which is the part they can see and rely on.
  return fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`
    }
  }).catch((e) => console.warn('Server-side logout failed; local session already cleared:', e));
}

/**
 * Parses one OAuth result fragment ("access_token=...&refresh_token=...&..."
 * or "error=...&error_description=...") and stores the session on success.
 *
 * Shared by the web path (fragment in this page's URL) and the Android path
 * (fragment delivered by MainActivity from the deep link). Returns true only
 * when a usable session was written.
 */
function applyAuthFragment(fragment) {
  if (!fragment) return false;
  const params = new URLSearchParams(fragment);

  if (params.get('error') || params.get('error_description')) {
    // Supabase reports failures the same way. Surfacing it beats leaving the
    // user staring at a sign-in button that appears to do nothing.
    const description = params.get('error_description') || params.get('error');
    console.error('Supabase sign-in failed:', description);
    alert('Sign-in failed: ' + (description || 'unknown error'));
    return false;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return false;

  // expires_in is SECONDS; everything else here works in epoch milliseconds.
  // Mixing the two would make a dead token look valid for a further 20 minutes.
  const expiresInSeconds = Number(params.get('expires_in')) || 3600;

  writeSupabaseSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + expiresInSeconds * 1000
  });
  return true;
}

/**
 * Reads the tokens Supabase appends to the URL fragment after Google sign-in.
 * Must run on every page load, before anything asks for a token. This is the
 * WEB path; the Android wrapper never lands tokens in this page's URL (they
 * arrive via the deep link into __midoriHandleAuthFragment below).
 *
 * The fragment is used rather than a query string on purpose: browsers never
 * transmit it to the server, so the access token stays out of server logs and
 * out of the Referer header. It is stripped from the address bar immediately
 * afterwards so it cannot linger in history or be copy-pasted out of the URL.
 *
 * Returns true if a session was captured on this load.
 */
function captureSupabaseAuthRedirect() {
  const hash = window.location.hash;
  if (!hash) return false;

  const hasTokens = hash.indexOf('access_token=') !== -1;
  const hasError = hash.indexOf('error=') !== -1;
  if (!hasTokens && !hasError) return false;

  const applied = applyAuthFragment(hash.substring(1));
  // Strip the fragment either way, so a failed attempt's error params also
  // leave the address bar. Uses the page URL, never the deep-link target.
  history.replaceState(null, '', getAuthRedirectTarget());
  return applied;
}

/**
 * Android entry point. MainActivity calls this via evaluateJavascript after the
 * Custom Tab auth flow returns through the com.midori.ledger:// deep link,
 * passing the raw fragment it carried. This is native -> JS one-way injection;
 * there is no JavaScript interface exposed back to the WebView.
 */
window.__midoriHandleAuthFragment = function (fragment) {
  const applied = applyAuthFragment(fragment);
  // Signing in is now all it takes to sync: derive this account's encryption
  // credentials and turn sync on, then pull. Without this the tokens would be
  // stored but sync would stay dormant until the next reload.
  if (applied && typeof activateSyncForCurrentUser === 'function') {
    activateSyncForCurrentUser();
  }
  if (typeof renderCloudAccountUI === 'function') renderCloudAccountUI();
  if (applied
      && typeof MidoriState !== 'undefined'
      && MidoriState.preferences.syncEnabled
      && typeof pullStateFromCloud === 'function') {
    pullStateFromCloud();
  }
  return applied;
};

async function refreshSupabaseSession(session) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  if (!response.ok) {
    // A refused refresh means the token is revoked or lapsed — signed out
    // elsewhere, or away too long. Clearing the session is what makes the UI
    // offer sign-in again rather than retry a request that can never succeed.
    clearSupabaseSession();
    throw new Error(`Session refresh rejected (${response.status})`);
  }

  const data = await response.json();
  const refreshed = {
    access_token: data.access_token,
    // Supabase rotates refresh tokens: reusing the old one after a refresh
    // fails, so the response's token must replace it rather than be dropped.
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
  writeSupabaseSession(refreshed);
  return refreshed;
}

async function getValidAccessToken() {
  let session = readSupabaseSession();
  if (!session) return null;

  if (Date.now() >= (session.expires_at || 0) - TOKEN_REFRESH_MARGIN_MS) {
    session = await refreshSupabaseSession(session);
  }
  return session.access_token;
}

async function supabaseRequest(path, options = {}) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('Not signed in');

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Fetches this user's stored ledger row, or null if they have never pushed.
 *
 * No user_id filter is sent, deliberately: the RLS policy restricts the result
 * to auth.uid()'s own row, so the server decides ownership rather than the
 * client asking nicely. A client-side filter would be trivially removable and
 * would imply the data is protected by the query, which it is not.
 */
async function supabasePullEnvelope() {
  const rows = await supabaseRequest('/rest/v1/midori_sync?select=encrypted_data,client_updated_at,revision');
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

/**
 * Compare-and-swap push. Resolves to
 * { status, revision, encrypted_data, client_updated_at } where status is
 * 'created', 'ok', or 'conflict'.
 *
 * A 'conflict' is a normal outcome, not an error: another device wrote since
 * this one last pulled, and the result carries that device's data back so the
 * caller can merge instead of overwriting work it never saw.
 */
async function supabasePushEnvelope(encryptedData, clientUpdatedAt, expectedRevision) {
  const rows = await supabaseRequest('/rest/v1/rpc/midori_push', {
    method: 'POST',
    body: JSON.stringify({
      p_encrypted_data: encryptedData,
      p_client_updated_at: clientUpdatedAt,
      // 0 for a device that has never seen a row. It can never match a real
      // revision (the trigger starts them at 1), so a first push from a second
      // device is reported as a conflict and merges rather than clobbering.
      p_expected_revision: expectedRevision || 0
    })
  });
  // A set-returning plpgsql function comes back as an array of one row.
  return Array.isArray(rows) ? rows[0] : rows;
}
