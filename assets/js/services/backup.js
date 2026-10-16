// Backup service (Task 17): export every store, validated all-or-nothing import, confirmed demo reset.
// Pure rules (envelope, validation, file helpers) live in backup-rules.js; this module only touches
// IndexedDB and dispatches the window events open pages listen to.
//
// Safety model
// - exportAll reads ALL stores in ONE readonly transaction (a consistent snapshot).
// - importAll re-validates its argument (a previous validateImport result is never trusted), then clears
//   and refills every store in ONE readwrite transaction. Any failure (validation, a request error, a
//   thrown exception) aborts that transaction, so the existing data stays exactly as it was. Nothing but
//   IndexedDB requests happens inside the transaction.
// - resetDemo reuses seed.resetToSeed (one atomic wipe + reseed); no second copy of the seeding logic.
import { tx, reqP, DB_NAME, SCHEMA_VERSION } from '../db.js';
import { resetToSeed } from '../seed.js';
import { STORE_NAMES, buildBackup, validateImport, countsOf } from './backup-rules.js';
import { getActiveCustomerId, setActiveCustomerId } from './customers.js';

export * from './backup-rules.js';

/** Snapshot of every store: { [store]: record[] } read in one readonly transaction. */
async function readAllStores() {
  return tx(STORE_NAMES, 'readonly', async (t) => {
    const lists = await Promise.all(STORE_NAMES.map((s) => reqP(t.objectStore(s).getAll())));
    return Object.fromEntries(STORE_NAMES.map((s, i) => [s, lists[i]]));
  });
}

/** Current record count per store (one readonly transaction). */
export async function storeCounts() {
  return tx(STORE_NAMES, 'readonly', async (t) => {
    const counts = await Promise.all(STORE_NAMES.map((s) => reqP(t.objectStore(s).count())));
    return Object.fromEntries(STORE_NAMES.map((s, i) => [s, counts[i]]));
  });
}

/**
 * Every record of every store, as stored (data-URL images included as-is), in the backup envelope:
 * { format, schemaVersion, dbName, exportedAt, app, counts, stores }.
 */
export async function exportAll({ now = new Date() } = {}) {
  return buildBackup(await readAllStores(), { now, schemaVersion: SCHEMA_VERSION, dbName: DB_NAME });
}

/** Tell open pages that everything changed (after a commit, never inside a transaction). */
async function notifyEverythingChanged(stores, { settingsAndContent = true } = {}) {
  if (typeof window === 'undefined') return;
  const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const cart = (stores.carts || []).find((c) => c.id === 'local');
  const wish = (stores.wishlists || []).find((w) => w.id === 'local');
  emit('catalog:changed', { action: 'import' });
  emit('cart:changed', { count: cart && Array.isArray(cart.lines) ? cart.lines.reduce((n, l) => n + (Number(l.qty) || 0), 0) : 0 });
  try {
    // Bumps the wishlist version so stale in-memory views ignore older events.
    (await import('./wishlist.js')).notifyExternalChange(wish && Array.isArray(wish.productIds) ? [...wish.productIds] : []);
  } catch (e) { /* wishlist listeners are optional */ }
  emit('orders:changed', { action: 'import' });
  emit('coupons:changed', {});
  emit('customers:changed', {});
  if (settingsAndContent) {
    emit('content:changed', { key: null }); // null = every content key (same convention as resetToSeed)
    emit('settings:changed');
  }
}

/** Drop the active-customer preference when that customer no longer exists. */
function dropStaleActiveCustomer(customers) {
  const id = getActiveCustomerId();
  if (id && !(customers || []).some((c) => c.id === id)) setActiveCustomerId(null);
}

/**
 * Replace ALL data with the backup `obj`. Validates again (never trusts an earlier call) and throws
 * { code:'invalid', errors } when the backup is not acceptable. One readwrite transaction clears and
 * refills every store: on any failure it aborts and the existing data is untouched.
 * @returns {Promise<{counts:Object<string,number>, warnings:string[]}>}
 */
export async function importAll(obj, { now = new Date() } = {}) {
  const v = validateImport(obj, { now });
  if (!v.ok) throw Object.assign(new Error('Invalid backup'), { code: 'invalid', errors: v.errors });
  const data = v.normalized;
  await tx(STORE_NAMES, 'readwrite', async (t) => {
    for (const name of STORE_NAMES) t.objectStore(name).clear();
    for (const name of STORE_NAMES) {
      const store = t.objectStore(name);
      for (const rec of data[name]) store.put(rec);
    }
    // No await on anything else: the transaction commits when its requests are done; a failing request
    // (or a throw above) aborts the whole transaction.
  });
  // The data is committed from here on: a failure while refreshing views must not be reported as "nothing changed".
  try {
    dropStaleActiveCustomer(data.customers);
    await notifyEverythingChanged(data);
  } catch (e) {
    throw Object.assign(new Error('Import committed; view refresh failed'), { code: 'committed', counts: countsOf(data), cause: e });
  }
  return { counts: countsOf(data), warnings: v.warnings };
}

/**
 * Erase all local data and restore the original demo dataset (seed.resetToSeed, one transaction), then
 * notify open pages. Callers must have asked for an explicit confirmation first.
 */
export async function resetDemo() {
  await resetToSeed(); // dispatches settings:changed / content:changed itself
  const stores = await readAllStores();
  dropStaleActiveCustomer(stores.customers);
  await notifyEverythingChanged(stores, { settingsAndContent: false });
  return { counts: countsOf(stores) };
}
