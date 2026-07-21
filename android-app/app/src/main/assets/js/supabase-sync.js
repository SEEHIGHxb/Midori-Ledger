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
 * Where Google should send the browser back to. Explicitly origin + pathname
 * with no query or hash: reusing location.href would append a second copy of
 * the OAuth fragment on every repeat sign-in, and Supabase requires an exact
 * match against the project's Redirect URLs allow-list.
 */
function getAuthRedirectTarget() {
  return window.location.origin + window.location.pathname;
}

function signInWithGoogle() {
  if (window.location.protocol === 'file:') {
    // Fail loudly rather than bounce the user to Google and back to a page
    // that cannot receive the token. The Android wrapper loads the hosted URL
    // for exactly this reason.
    alert('Cloud sync needs the hosted version of Midori. Open the app from its web address rather than a local file, then sign in.');
    return;
  }
  const url = `${SUPABASE_URL}/auth/v1/authorize`
    + `?provider=google`
    + `&redirect_to=${encodeURIComponent(getAuthRedirectTarget())}`;
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
 * Reads the tokens Supabase appends to the URL fragment after Google sign-in.
 * Must run on every page load, before anything asks for a token.
 *
 * The fragment is used rather than a query string on purpose: browsers never
 * transmit it to the server, so the access token stays out of server logs and
 * out of the Referer header. It is stripped from the address bar immediately
 * below so it cannot linger in history or be copy-pasted out of the URL.
 *
 * Returns true if a session was captured on this load.
 */
function captureSupabaseAuthRedirect() {
  const hash = window.location.hash;
  if (!hash || hash.indexOf('access_token=') === -1) {
    // Supabase reports failures the same way, in the fragment. Ignoring them
    // silently would leave the user staring at a sign-in button that appears
    // to do nothing at all.
    if (hash && hash.indexOf('error=') !== -1) {
      const errParams = new URLSearchParams(hash.substring(1));
      const description = errParams.get('error_description') || errParams.get('error');
      console.error('Supabase sign-in failed:', description);
      alert('Sign-in failed: ' + (description || 'unknown error'));
      history.replaceState(null, '', getAuthRedirectTarget());
    }
    return false;
  }

  const params = new URLSearchParams(hash.substring(1));
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

  history.replaceState(null, '', getAuthRedirectTarget());
  return true;
}

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
