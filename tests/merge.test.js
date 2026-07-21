/**
 * Tests for the ledger merge.
 *
 * The regression that motivated all of this: sync replaced the entire state
 * with whichever device pushed last, so a transaction added on one device was
 * silently destroyed by an unrelated edit on another. The first test pins that.
 *
 * The rest pin the tombstone rules, because a merge WITHOUT tombstones fixes
 * the data-loss bug by introducing a quieter one — deleted transactions coming
 * back from the dead on the next sync.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeLedgerStates,
  mergeDeletions,
  resolveRecord,
  TOMBSTONE_TTL_MS
} = require('../js/merge');

const NOW = 1753056000000; // 2025-07-21T00:00:00Z — pinned so TTL maths is stable
const MINUTE = 60 * 1000;

function tx(id, amount, updatedAt) {
  return { id, amount, updatedAt, date: '2026-07-21', walletId: 'w1' };
}

function stateWith(overrides) {
  return {
    wallets: [],
    categories: [],
    transactions: [],
    schedules: [],
    deletions: {},
    preferences: { syncId: 'mds_local', syncKey: 'msk_local', syncEnabled: true, lastSyncedAt: 5 },
    updatedAt: NOW,
    ...overrides
  };
}

const ids = (records) => records.map((r) => r.id).sort();

test('concurrent additions on two devices both survive', () => {
  const phone = stateWith({ transactions: [tx('shared', 10, NOW), tx('coffee', 4, NOW + MINUTE)] });
  const laptop = stateWith({ transactions: [tx('shared', 10, NOW), tx('rent', 900, NOW + MINUTE)] });

  const merged = mergeLedgerStates(phone, laptop, NOW + 2 * MINUTE);

  assert.deepStrictEqual(ids(merged.transactions), ['coffee', 'rent', 'shared']);
});

test('the newer edit of the same record wins', () => {
  const local = stateWith({ transactions: [tx('t1', 10, NOW)] });
  const remote = stateWith({ transactions: [tx('t1', 99, NOW + MINUTE)] });

  const merged = mergeLedgerStates(local, remote, NOW + 2 * MINUTE);

  assert.strictEqual(merged.transactions.length, 1);
  assert.strictEqual(merged.transactions[0].amount, 99);
});

test('a record deleted here is not resurrected by a device that still has it', () => {
  const local = stateWith({ transactions: [], deletions: { t1: NOW + MINUTE } });
  const remote = stateWith({ transactions: [tx('t1', 10, NOW)] });

  const merged = mergeLedgerStates(local, remote, NOW + 2 * MINUTE);

  assert.deepStrictEqual(merged.transactions, [], 'deleted transaction came back');
});

test('a record deleted remotely is removed locally', () => {
  const local = stateWith({ transactions: [tx('t1', 10, NOW)] });
  const remote = stateWith({ transactions: [], deletions: { t1: NOW + MINUTE } });

  const merged = mergeLedgerStates(local, remote, NOW + 2 * MINUTE);

  assert.deepStrictEqual(merged.transactions, []);
});

test('an edit made after the delete resurrects the record', () => {
  const local = stateWith({ transactions: [tx('t1', 42, NOW + 5 * MINUTE)] });
  const remote = stateWith({ transactions: [], deletions: { t1: NOW + MINUTE } });

  const merged = mergeLedgerStates(local, remote, NOW + 6 * MINUTE);

  assert.strictEqual(merged.transactions.length, 1);
  assert.strictEqual(merged.transactions[0].amount, 42);
});

test('tombstones survive the round trip so a third device also honours them', () => {
  const local = stateWith({ transactions: [], deletions: { t1: NOW } });
  const remote = stateWith({ transactions: [tx('t1', 10, NOW - MINUTE)] });

  const merged = mergeLedgerStates(local, remote, NOW + MINUTE);

  assert.strictEqual(merged.deletions.t1, NOW, 'tombstone must be carried into the merged state');
});

test('tombstones older than the TTL are pruned', () => {
  const stale = NOW - TOMBSTONE_TTL_MS - MINUTE;
  const merged = mergeDeletions({ old: stale, recent: NOW }, {}, NOW);

  assert.strictEqual(merged.old, undefined);
  assert.strictEqual(merged.recent, NOW);
});

test('the earliest deletion time wins when both devices deleted the same record', () => {
  const merged = mergeDeletions({ t1: NOW + MINUTE }, { t1: NOW }, NOW + MINUTE);
  assert.strictEqual(merged.t1, NOW);
});

test('deleting on one device does not disturb unrelated records', () => {
  const local = stateWith({ transactions: [tx('keep', 1, NOW)], deletions: { drop: NOW } });
  const remote = stateWith({ transactions: [tx('keep', 1, NOW), tx('drop', 2, NOW - MINUTE)] });

  const merged = mergeLedgerStates(local, remote, NOW + MINUTE);

  assert.deepStrictEqual(ids(merged.transactions), ['keep']);
});

test('all four collections merge, not just transactions', () => {
  const local = stateWith({
    wallets: [{ id: 'w1', name: 'Cash', updatedAt: NOW }],
    categories: [{ id: 'c1', name: 'Food', updatedAt: NOW }],
    schedules: [{ id: 's1', name: 'Rent', updatedAt: NOW }]
  });
  const remote = stateWith({
    wallets: [{ id: 'w2', name: 'Bank', updatedAt: NOW }],
    categories: [{ id: 'c2', name: 'Travel', updatedAt: NOW }],
    schedules: [{ id: 's2', name: 'Gym', updatedAt: NOW }]
  });

  const merged = mergeLedgerStates(local, remote, NOW + MINUTE);

  assert.deepStrictEqual(ids(merged.wallets), ['w1', 'w2']);
  assert.deepStrictEqual(ids(merged.categories), ['c1', 'c2']);
  assert.deepStrictEqual(ids(merged.schedules), ['s1', 's2']);
});

test('this device keeps its own sync credentials', () => {
  const local = stateWith({ updatedAt: NOW });
  const remote = stateWith({
    updatedAt: NOW + MINUTE, // newer, so it wins every other preference
    preferences: { syncId: 'mds_other', syncKey: 'msk_other', syncEnabled: false, lastSyncedAt: 999, theme: 'light' }
  });

  const merged = mergeLedgerStates(local, remote, NOW + 2 * MINUTE);

  assert.strictEqual(merged.preferences.syncKey, 'msk_local', 'a foreign key would break the next decrypt');
  assert.strictEqual(merged.preferences.syncId, 'mds_local');
  assert.strictEqual(merged.preferences.syncEnabled, true);
  assert.strictEqual(merged.preferences.theme, 'light', 'non-credential preferences should still sync');
});

test('neither input state is mutated', () => {
  const local = stateWith({ transactions: [tx('a', 1, NOW)] });
  const remote = stateWith({ transactions: [tx('b', 2, NOW)] });
  const localBefore = JSON.stringify(local);
  const remoteBefore = JSON.stringify(remote);

  mergeLedgerStates(local, remote, NOW + MINUTE);

  assert.strictEqual(JSON.stringify(local), localBefore);
  assert.strictEqual(JSON.stringify(remote), remoteBefore);
});

test('legacy records without updatedAt are kept, and a timestamped edit beats them', () => {
  const local = stateWith({ transactions: [{ id: 't1', amount: 10 }, { id: 'legacy', amount: 3 }] });
  const remote = stateWith({ transactions: [tx('t1', 77, NOW)] });

  const merged = mergeLedgerStates(local, remote, NOW + MINUTE);

  assert.deepStrictEqual(ids(merged.transactions), ['legacy', 't1']);
  assert.strictEqual(merged.transactions.find((t) => t.id === 't1').amount, 77);
});

test('merging is idempotent — re-merging the result changes nothing', () => {
  const local = stateWith({ transactions: [tx('a', 1, NOW)], deletions: { gone: NOW } });
  const remote = stateWith({ transactions: [tx('b', 2, NOW), tx('gone', 9, NOW - MINUTE)] });

  const once = mergeLedgerStates(local, remote, NOW + MINUTE);
  const twice = mergeLedgerStates(once, remote, NOW + MINUTE);

  assert.deepStrictEqual(ids(twice.transactions), ids(once.transactions));
  assert.deepStrictEqual(twice.deletions, once.deletions);
});

test('a first sync against an empty cloud keeps every local record', () => {
  const local = stateWith({ transactions: [tx('a', 1, NOW), tx('b', 2, NOW)] });

  const merged = mergeLedgerStates(local, null, NOW + MINUTE);

  assert.deepStrictEqual(ids(merged.transactions), ['a', 'b']);
});

test('resolveRecord returns null only when the delete actually wins', () => {
  const older = { id: 'x', updatedAt: NOW - MINUTE };
  const newer = { id: 'x', updatedAt: NOW + MINUTE };

  assert.strictEqual(resolveRecord(older, null, NOW), null);
  assert.strictEqual(resolveRecord(newer, null, NOW), newer);
  assert.strictEqual(resolveRecord(older, null, undefined), older);
});
