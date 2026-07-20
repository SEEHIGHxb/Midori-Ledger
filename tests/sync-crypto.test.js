/**
 * Tests for the ZenSync crypto layer.
 *
 * Two regressions are pinned here:
 *  1. Sync credentials must come from a CSPRNG. generateSyncCredentials()
 *     previously used Math.random(), whose state is recoverable from output —
 *     and that value is the sole input to the AES-GCM key.
 *  2. Payloads written before the PBKDF2 upgrade (unversioned "iv:ct") must
 *     still decrypt, so upgrading the app cannot strand a synced ledger.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./helpers/sandbox');

const KEY = 'msk_' + 'a'.repeat(32);
const SALT = 'mds_testsalt';
const PLAINTEXT = JSON.stringify({ wallets: [], transactions: [{ id: 't1', amount: 1234.5 }] });

test('encryptData -> decryptData round-trips at v2', async () => {
  const sandbox = createSandbox();
  const payload = await sandbox.encryptData(PLAINTEXT, KEY, SALT);
  assert.ok(payload.startsWith('v2:'), `expected a v2-tagged payload, got "${payload.slice(0, 8)}..."`);
  assert.strictEqual(await sandbox.decryptData(payload, KEY, SALT), PLAINTEXT);
});

test('decryptData rejects a payload encrypted under a different key', async () => {
  const sandbox = createSandbox();
  const payload = await sandbox.encryptData(PLAINTEXT, KEY, SALT);
  await assert.rejects(() => sandbox.decryptData(payload, 'msk_' + 'b'.repeat(32), SALT));
});

test('the syncId salt is bound into the key — a different salt cannot decrypt', async () => {
  const sandbox = createSandbox();
  const payload = await sandbox.encryptData(PLAINTEXT, KEY, SALT);
  await assert.rejects(() => sandbox.decryptData(payload, KEY, 'mds_othersalt'));
});

test('encryption is non-deterministic (fresh IV per call)', async () => {
  const sandbox = createSandbox();
  const a = await sandbox.encryptData(PLAINTEXT, KEY, SALT);
  const b = await sandbox.encryptData(PLAINTEXT, KEY, SALT);
  assert.notStrictEqual(a, b, 'identical ciphertexts imply a reused IV');
});

test('legacy unversioned payloads still decrypt after the PBKDF2 upgrade', async () => {
  const sandbox = createSandbox();

  // Reproduce exactly what the pre-v2 encryptData() wrote: unsalted SHA-256
  // key derivation, and an "ivBase64:ciphertextBase64" payload with no version tag.
  const encoder = new sandbox.TextEncoder();
  const hash = await sandbox.crypto.subtle.digest('SHA-256', encoder.encode(KEY));
  const legacyKey = await sandbox.crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const iv = sandbox.crypto.getRandomValues(new Uint8Array(12));
  const ct = await sandbox.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKey, encoder.encode(PLAINTEXT));

  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const legacyPayload = `${b64(iv)}:${b64(new Uint8Array(ct))}`;
  assert.ok(!legacyPayload.startsWith('v2:'));

  assert.strictEqual(await sandbox.decryptData(legacyPayload, KEY, SALT), PLAINTEXT);
});

test('decryptData rejects a structurally invalid payload', async () => {
  const sandbox = createSandbox();
  await assert.rejects(() => sandbox.decryptData('not-a-payload', KEY, SALT), /Invalid encrypted payload/);
});

test('generateSyncCredentials returns correctly prefixed, high-entropy credentials', () => {
  const sandbox = createSandbox();
  const { syncId, syncKey } = sandbox.generateSyncCredentials();

  assert.ok(syncId.startsWith('mds_'), syncId);
  assert.ok(syncKey.startsWith('msk_'), 'sync key must keep the msk_ prefix pairing relies on');
  assert.strictEqual(syncKey.length, 4 + 32);
});

test('generateSyncCredentials never repeats across many draws', () => {
  const sandbox = createSandbox();
  const keys = new Set();
  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const { syncId, syncKey } = sandbox.generateSyncCredentials();
    keys.add(syncKey);
    ids.add(syncId);
  }
  assert.strictEqual(keys.size, 500, 'duplicate sync key generated');
  assert.strictEqual(ids.size, 500, 'duplicate sync id generated');
});

test('randomToken uses the whole alphabet without obvious bias', () => {
  const sandbox = createSandbox();
  const sample = sandbox.randomToken(20000);
  assert.strictEqual(sample.length, 20000);

  const seen = new Set(sample.split(''));
  // Rejection sampling should reach essentially every one of the 62 characters.
  assert.ok(seen.size >= 60, `only ${seen.size} distinct characters observed`);

  // No character should dominate; uniform expectation is 1/62 (~1.6%).
  const counts = {};
  for (const ch of sample) counts[ch] = (counts[ch] || 0) + 1;
  const maxShare = Math.max(...Object.values(counts)) / sample.length;
  assert.ok(maxShare < 0.03, `most common character took ${(maxShare * 100).toFixed(2)}% of the sample`);
});

test('generateUUID is unique across many draws', () => {
  const sandbox = createSandbox();
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(sandbox.generateUUID());
  assert.strictEqual(ids.size, 2000, 'generateUUID produced a collision');
});
