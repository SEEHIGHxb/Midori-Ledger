/**
 * Tests for the account-derived sync model, which replaced the shared pairing
 * key. Signing in with Google is now the entire setup: both devices derive the
 * SAME encryption credentials from the account's stable Supabase user id, so
 * either can read the other's ledger with nothing copied between them.
 *
 * What is pinned here:
 *  - the identity helpers decode the user id/email from the session JWT;
 *  - deriveSyncCredentialsFromUserId is deterministic per account;
 *  - activate/deactivate flip the sync preferences correctly;
 *  - two devices under one account round-trip an encrypted ledger (the whole
 *    point — no pairing);
 *  - a ledger written under the OLD random pairing key is NOT readable with the
 *    account key, which is exactly the case tryDecryptEnvelopeToState handles by
 *    discarding the unreadable blob rather than erroring forever.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSandbox } = require('./helpers/sandbox');

const USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const USER_ID_NORMALIZED = 'a1b2c3d4e5f67890abcdef0123456789';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// decodeJwtPayload only reads the middle segment, so the header/signature can be
// any placeholder here.
function makeJwt(payload) {
  return 'header.' + b64url(payload) + '.signature';
}

// Loads supabase-config.js + supabase-sync.js into a vm holding a given stored
// session, and exposes the identity helpers under test.
function loadIdentityModule(session) {
  const store = new Map();
  if (session) store.set('midori_supabase_session', JSON.stringify(session));

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    navigator: { userAgent: 'node-test' },
    location: { href: 'https://seehighxb.github.io/Midori-Ledger/', origin: 'https://seehighxb.github.io', pathname: '/Midori-Ledger/', protocol: 'https:', hash: '', search: '' },
    history: { replaceState() {} },
    alert() {},
    fetch: () => Promise.reject(new Error('no network in test')),
    atob, btoa, URL, URLSearchParams, Date,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-config.js'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-sync.js'), 'utf8');
  vm.runInContext(cfg, sandbox, { filename: 'supabase-config.js' });
  vm.runInContext(sync, sandbox, { filename: 'supabase-sync.js' });
  vm.runInContext(
    `globalThis.__getUserId = getSupabaseUserId;
     globalThis.__getEmail = getSupabaseUserEmail;`,
    sandbox,
    { filename: 'test-exposers.js' }
  );
  return sandbox;
}

test('getSupabaseUserId / getSupabaseUserEmail decode them from the session JWT', () => {
  const jwt = makeJwt({ sub: USER_ID, email: 'jojo@example.com' });
  const s = loadIdentityModule({ access_token: jwt, refresh_token: 'r', expires_at: Date.now() + 3600000 });
  assert.strictEqual(s.__getUserId(), USER_ID);
  assert.strictEqual(s.__getEmail(), 'jojo@example.com');
});

test('the identity helpers return null when signed out or the token is malformed', () => {
  assert.strictEqual(loadIdentityModule(null).__getUserId(), null);
  const bad = loadIdentityModule({ access_token: 'not-a-jwt', refresh_token: 'r', expires_at: Date.now() + 1000 });
  assert.strictEqual(bad.__getUserId(), null);
  assert.strictEqual(bad.__getEmail(), null);
});

test('deriveSyncCredentialsFromUserId is deterministic and identical per account', () => {
  const s = createSandbox();
  const a = s.deriveSyncCredentialsFromUserId(USER_ID);
  const b = s.deriveSyncCredentialsFromUserId(USER_ID);

  assert.deepStrictEqual(Object.keys(a).sort(), ['syncId', 'syncKey']);
  assert.strictEqual(a.syncId, b.syncId);
  assert.strictEqual(a.syncKey, b.syncKey);
  // The dashes in the UUID are stripped; the key is namespaced away from the
  // legacy 'msk_' + token pairing keys.
  assert.strictEqual(a.syncId, 'mds_' + USER_ID_NORMALIZED);
  assert.strictEqual(a.syncKey, 'msk_acct_' + USER_ID_NORMALIZED);
  assert.strictEqual(s.deriveSyncCredentialsFromUserId(null), null);
  assert.strictEqual(s.deriveSyncCredentialsFromUserId(''), null);
});

test('activateSyncForCurrentUser derives and enables sync for the signed-in account', () => {
  const s = createSandbox();
  vm.runInContext(
    `var __signedIn = true; var __userId = '${USER_ID}';
     function isSignedInToSupabase() { return __signedIn; }
     function getSupabaseUserId() { return __userId; }`,
    s
  );

  assert.strictEqual(s.activateSyncForCurrentUser(), true);
  const prefs = s.__getState().preferences;
  assert.strictEqual(prefs.syncEnabled, true);
  assert.strictEqual(prefs.syncId, 'mds_' + USER_ID_NORMALIZED);
  assert.strictEqual(prefs.syncKey, 'msk_acct_' + USER_ID_NORMALIZED);

  s.deactivateSync();
  const cleared = s.__getState().preferences;
  assert.strictEqual(cleared.syncEnabled, false);
  assert.strictEqual(cleared.syncId, null);
  assert.strictEqual(cleared.syncKey, null);
  assert.strictEqual(cleared.lastSyncedAt, 0);
});

test('activateSyncForCurrentUser is a no-op when signed out', () => {
  const s = createSandbox();
  vm.runInContext(
    `function isSignedInToSupabase() { return false; }
     function getSupabaseUserId() { return null; }`,
    s
  );
  assert.strictEqual(s.activateSyncForCurrentUser(), false);
  assert.strictEqual(s.__getState().preferences.syncEnabled, false);
});

test('two devices under one account read each other\'s ledger with no pairing step', async () => {
  const deviceA = createSandbox();
  const deviceB = createSandbox();

  const credsA = deviceA.deriveSyncCredentialsFromUserId(USER_ID);
  const plaintext = JSON.stringify({ from: 'device A', wallets: 3 });
  const envelope = await deviceA.encryptData(plaintext, credsA.syncKey, credsA.syncId);

  // Device B has never spoken to device A. It derives the SAME credentials from
  // the same account id, which is the entire mechanism.
  const credsB = deviceB.deriveSyncCredentialsFromUserId(USER_ID);
  const decrypted = await deviceB.decryptData(envelope, credsB.syncKey, credsB.syncId);
  assert.strictEqual(decrypted, plaintext);
});

test('a ledger written under the old pairing key is unreadable with the account key', async () => {
  const s = createSandbox();

  // Simulates a backup left in the cloud from before the switch to account keys.
  const oldPairing = { syncKey: 'msk_' + 'z'.repeat(32), syncId: 'mds_oldrandomsalt' };
  const envelope = await s.encryptData(JSON.stringify({ old: true }), oldPairing.syncKey, oldPairing.syncId);

  const account = s.deriveSyncCredentialsFromUserId(USER_ID);
  // AES-GCM authentication fails with the wrong key — decryptData rejects, which
  // is why the sync path routes this through tryDecryptEnvelopeToState (returns
  // null) and replaces the blob with local data instead of looping on an error.
  await assert.rejects(() => s.decryptData(envelope, account.syncKey, account.syncId));
});
