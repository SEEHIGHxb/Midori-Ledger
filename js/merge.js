/**
 * Midori — Premium Finance Ledger
 * merge.js: three-way-ish merge of two ledger states.
 *
 * Why this exists:
 * Sync used to be last-writer-wins over the WHOLE state — whichever device
 * pushed most recently replaced everything. Add a coffee on your phone and rent
 * on your laptop, and one of them was silently gone. This merges per record
 * instead, so both survive.
 *
 * The three rules, in order of precedence:
 *  1. A record deleted on one device stays deleted on the other. This needs
 *     TOMBSTONES: without a record of the deletion, the other device still has
 *     the row, a union sees it as "present on one side" and helpfully restores
 *     it. Deleting a transaction on your phone would resurrect it on the next
 *     laptop sync, forever.
 *  2. An edit that happened AFTER a delete wins over the delete. Rare, but the
 *     alternative silently discards deliberate work.
 *  3. Otherwise the copy with the newer per-record updatedAt wins.
 *
 * Note that per-record updatedAt IS compared here, even though whole-state
 * Date.now() comparison was removed from the sync path as unreliable. The
 * difference: revision (server-side, monotonic) decides WHETHER to merge, and
 * is authoritative. These timestamps only pick a winner between two versions of
 * the same record once merging is already happening — the blast radius of clock
 * skew is one field of one record, not the entire ledger.
 *
 * Pure functions only: no DOM, no network, no MidoriState. Everything here is
 * a function of its arguments, which is what makes it testable.
 */

// Collections merged by id. Wallet BALANCES are deliberately not merged —
// they are derived, and recalculateWalletBalances() recomputes them from the
// merged transactions afterwards. Merging a derived total would double-count.
const MERGEABLE_COLLECTIONS = ['wallets', 'categories', 'transactions', 'schedules'];

// How long a tombstone is kept. Tombstones cannot accumulate forever — every
// delete you ever make would otherwise ride along in every sync payload — but
// pruning one is what allows a resurrection: a device that has been offline
// longer than this still holds the record, sees no tombstone, and re-adds it.
// 90 days is well past any normal offline stretch for a phone.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Merges two tombstone maps ({ id: deletedAt }), keeping the earliest deletion
 * for any id present in both, and dropping anything past the TTL.
 *
 * Earliest rather than latest: the timestamp answers "when was this deleted",
 * and the first device to delete it is the one that answers correctly. Taking
 * the later one would let a slow-clocked device push the tombstone past a
 * legitimate edit and win rule 2 when it should not.
 */
function mergeDeletions(localDeletions, remoteDeletions, now) {
  const cutoff = now - TOMBSTONE_TTL_MS;
  const merged = {};

  const absorb = (source) => {
    if (!source) return;
    Object.keys(source).forEach((id) => {
      const deletedAt = Number(source[id]) || 0;
      if (deletedAt < cutoff) return; // expired
      if (merged[id] === undefined || deletedAt < merged[id]) {
        merged[id] = deletedAt;
      }
    });
  };

  absorb(localDeletions);
  absorb(remoteDeletions);
  return merged;
}

function indexById(records) {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (record && record.id) map.set(record.id, record);
  });
  return map;
}

/**
 * Picks the surviving version of one record.
 * Returns null when the record should not exist in the merged state.
 */
function resolveRecord(localRecord, remoteRecord, deletedAt) {
  // Records written before this version have no updatedAt. Treating that as 0
  // means any touched copy beats an untouched one, which is the right call:
  // the only edit either side can prove is the one that carries a timestamp.
  const localAt = localRecord ? Number(localRecord.updatedAt) || 0 : -1;
  const remoteAt = remoteRecord ? Number(remoteRecord.updatedAt) || 0 : -1;

  if (deletedAt !== undefined) {
    // Rule 2: an edit strictly newer than the deletion resurrects the record.
    const newestEdit = Math.max(localAt, remoteAt);
    if (newestEdit <= deletedAt) return null; // Rule 1: stays deleted.
  }

  if (!localRecord) return remoteRecord;
  if (!remoteRecord) return localRecord;

  // Rule 3. Ties go to local: with equal timestamps there is no evidence either
  // way, and preferring the copy already on this device avoids a visible edit
  // flipping back and forth on screen mid-sync.
  return remoteAt > localAt ? remoteRecord : localRecord;
}

function mergeCollection(localRecords, remoteRecords, deletions) {
  const localById = indexById(localRecords);
  const remoteById = indexById(remoteRecords);

  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  const merged = [];

  allIds.forEach((id) => {
    const survivor = resolveRecord(localById.get(id), remoteById.get(id), deletions[id]);
    if (survivor) merged.push(survivor);
  });

  return merged;
}

/**
 * Merges preferences, preferring the newer side but never touching this
 * device's own sync credentials.
 *
 * syncId/syncKey are the AES-GCM inputs. The remote payload was just decrypted
 * with the LOCAL pair, so the local pair is by definition the working one —
 * overwriting it with a value from inside the ciphertext could hand the device
 * a key that cannot open its own next pull. lastSyncedAt is likewise per-device.
 */
function mergePreferences(localPrefs, remotePrefs, preferRemote) {
  const local = localPrefs || {};
  const remote = remotePrefs || {};
  const base = preferRemote ? { ...local, ...remote } : { ...remote, ...local };

  return {
    ...base,
    syncEnabled: local.syncEnabled,
    syncId: local.syncId,
    syncKey: local.syncKey,
    lastSyncedAt: local.lastSyncedAt
  };
}

/**
 * Merges a decrypted remote ledger into the local one and returns a NEW state.
 * Neither argument is mutated — callers assign the result.
 *
 * `now` is injected rather than read from Date.now() so tests can pin it.
 */
function mergeLedgerStates(localState, remoteState, now) {
  const timestamp = now === undefined ? Date.now() : now;
  const local = localState || {};
  const remote = remoteState || {};

  const deletions = mergeDeletions(local.deletions, remote.deletions, timestamp);

  const merged = {
    ...local,
    deletions
  };

  MERGEABLE_COLLECTIONS.forEach((collection) => {
    merged[collection] = mergeCollection(local[collection], remote[collection], deletions);
  });

  // Whole-state scalars have no per-record identity to merge on, so they fall
  // back to newest-wins. updatedAt is only trusted for these — never for the
  // records above, and never to decide whether the merge happens at all.
  const remoteIsNewer = (Number(remote.updatedAt) || 0) > (Number(local.updatedAt) || 0);

  merged.preferences = mergePreferences(local.preferences, remote.preferences, remoteIsNewer);
  if (remoteIsNewer) {
    if (remote.virtualDate) merged.virtualDate = remote.virtualDate;
    if (remote.fxRatesCache) merged.fxRatesCache = remote.fxRatesCache;
  }
  merged.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0);

  return merged;
}

// Node's test runner loads this file directly; the browser loads it as a plain
// <script> where `module` is undefined. Same guard style as the rest of the app.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mergeLedgerStates,
    mergeDeletions,
    mergeCollection,
    resolveRecord,
    TOMBSTONE_TTL_MS,
    MERGEABLE_COLLECTIONS
  };
}
