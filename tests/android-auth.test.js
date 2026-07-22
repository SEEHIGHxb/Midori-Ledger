/**
 * Tests for the parts of the Android sign-in bridge that are pure JavaScript:
 * fragment parsing/session storage, wrapper detection, and redirect-target
 * selection.
 *
 * The native pieces (Custom Tab launch, deep-link intent, evaluateJavascript
 * injection) cannot be exercised here — they need a device. What CAN be pinned
 * is that a fragment handed in by MainActivity is stored identically to one
 * that arrives in the page URL on the web, and that the wrapper is detected
 * only by its user-agent marker. Those are the parts most likely to regress.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Builds a fresh sandbox with just enough browser surface for supabase-sync.js,
// letting each test set navigator.userAgent and location independently.
function loadSyncModule({ userAgent = 'Mozilla/5.0', href = 'https://seehighxb.github.io/Midori-Ledger/' } = {}) {
  const store = new Map();
  const alerts = [];

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    navigator: { userAgent },
    location: { href, origin: 'https://seehighxb.github.io', pathname: '/Midori-Ledger/', hash: '', search: '', protocol: 'https:' },
    history: { replaceState() {} },
    alert: (m) => alerts.push(m),
    fetch: () => Promise.reject(new Error('no network in test')),
    URL,
    URLSearchParams,
    Date,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-config.js'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-sync.js'), 'utf8');
  vm.runInContext(cfg, sandbox, { filename: 'supabase-config.js' });
  vm.runInContext(sync, sandbox, { filename: 'supabase-sync.js' });

  // Expose the file-scope functions the tests need (they are declared with
  // `function`, so they are context globals but not sandbox-object properties
  // until named here).
  vm.runInContext(
    `globalThis.__isAndroidWrapper = isAndroidWrapper;
     globalThis.__applyAuthFragment = applyAuthFragment;
     globalThis.__getAndroidAuthCallbackUrl = getAndroidAuthCallbackUrl;
     globalThis.__isSignedIn = isSignedInToSupabase;`,
    sandbox,
    { filename: 'test-exposers.js' }
  );

  return { sandbox, store, alerts };
}

const SUCCESS_FRAGMENT =
  'access_token=eyJhbGciOi.abc.def&refresh_token=v1r3fr3sh&expires_in=3600&token_type=bearer';

test('a fragment from the Android deep link stores a session', () => {
  const { sandbox, store } = loadSyncModule();
  const ok = sandbox.__applyAuthFragment(SUCCESS_FRAGMENT);

  assert.strictEqual(ok, true);
  assert.strictEqual(sandbox.__isSignedIn(), true);

  const session = JSON.parse(store.get('midori_supabase_session'));
  assert.strictEqual(session.access_token, 'eyJhbGciOi.abc.def');
  assert.strictEqual(session.refresh_token, 'v1r3fr3sh');
  assert.ok(session.expires_at > Date.now(), 'expiry must be a future epoch-ms timestamp');
});

test('the native path and the web hash path store an identical session', () => {
  // Native: MainActivity hands the raw fragment straight to applyAuthFragment.
  const native = loadSyncModule();
  native.sandbox.__applyAuthFragment(SUCCESS_FRAGMENT);

  // Web: the same fragment sits in location.hash and is captured on load.
  const web = loadSyncModule({ href: 'https://seehighxb.github.io/Midori-Ledger/#' + SUCCESS_FRAGMENT });
  web.sandbox.location.hash = '#' + SUCCESS_FRAGMENT;
  vm.runInContext('captureSupabaseAuthRedirect();', web.sandbox, { filename: 'capture.js' });

  const a = JSON.parse(native.store.get('midori_supabase_session'));
  const b = JSON.parse(web.store.get('midori_supabase_session'));
  assert.strictEqual(a.access_token, b.access_token);
  assert.strictEqual(a.refresh_token, b.refresh_token);
});

test('expires_in seconds is converted to a millisecond expiry, not used raw', () => {
  const before = Date.now();
  const { sandbox, store } = loadSyncModule();
  sandbox.__applyAuthFragment('access_token=a&refresh_token=b&expires_in=3600');
  const session = JSON.parse(store.get('midori_supabase_session'));

  // 3600 seconds ~= 1 hour ahead. Treating it as ms would be ~3.6s ahead —
  // this asserts we are firmly in the hour range, not the seconds range.
  const aheadMs = session.expires_at - before;
  assert.ok(aheadMs > 59 * 60 * 1000 && aheadMs < 61 * 60 * 1000, `expected ~1h ahead, got ${aheadMs}ms`);
});

test('an error fragment stores no session and surfaces the reason', () => {
  const { sandbox, store, alerts } = loadSyncModule();
  const ok = sandbox.__applyAuthFragment('error=access_denied&error_description=User%20cancelled');

  assert.strictEqual(ok, false);
  assert.strictEqual(store.has('midori_supabase_session'), false);
  assert.ok(alerts.some((m) => m.includes('cancelled') || m.includes('User')), 'the failure reason should reach the user');
});

test('a fragment without both tokens is rejected', () => {
  const { sandbox, store } = loadSyncModule();
  assert.strictEqual(sandbox.__applyAuthFragment('access_token=only_access'), false);
  assert.strictEqual(store.has('midori_supabase_session'), false);
});

test('the wrapper is detected only by its user-agent marker', () => {
  const plain = loadSyncModule({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120' });
  assert.strictEqual(plain.sandbox.__isAndroidWrapper(), false, 'a normal Android browser is not the wrapper');

  const wrapper = loadSyncModule({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 MidoriAndroid/1.1' });
  assert.strictEqual(wrapper.sandbox.__isAndroidWrapper(), true);
});

test('the Android callback URL resolves against the page, respecting the Pages base path', () => {
  const { sandbox } = loadSyncModule({ href: 'https://seehighxb.github.io/Midori-Ledger/index.html' });
  assert.strictEqual(
    sandbox.__getAndroidAuthCallbackUrl(),
    'https://seehighxb.github.io/Midori-Ledger/auth-callback.html'
  );
});
