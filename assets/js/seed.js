import { tx, reqP } from './db.js';
import { STORE_DEFS } from './schema.js';
import { CONTENT_KEYS, planContentMigration } from './services/content-rules.js';
import { shiftSampleData, withCouponUsage } from './services/sample-data.js';

const load = async (name) => {
  const res = await fetch(new URL(`../../data/${name}.json`, import.meta.url));
  if (!res.ok) throw new Error(`Failed to load ${name}.json`);
  return res.json();
};

/** Optional seed file: null instead of a fatal error when it is missing or malformed. */
const optional = (name) => load(name).catch((e) => { console.warn(`Optional seed file ${name}.json skipped`, e); return null; });

async function loadSeedData() {
  const [meta, prod, content, rev, sampleRaw] = await Promise.all([
    load('catalog-meta'), load('products'), load('content'), load('reviews'), optional('sample-data'),
  ]);
  // Sample customers / historical orders, re-dated to the install day (see services/sample-data.js).
  // sample-data.json is optional: when it cannot be loaded the shop is seeded without it.
  let sample = null;
  try { sample = sampleRaw ? shiftSampleData(sampleRaw, new Date()) : null; } catch (e) { console.warn('Sample data skipped', e); }
  return { meta, products: prod.products || [], content, reviews: rev.reviews || [], sample };
}

/**
 * Pure: the records of every store for a fresh install, as { [storeName]: record[] } (every store present,
 * empty arrays allowed). Shared by the seed transaction and the Node tests (backup fixture). No DB, no DOM.
 * `sample` is the ALREADY re-dated sample dataset (shiftSampleData) or null.
 */
export function buildSeedStores({ meta, products, content, reviews = [], sample = null }, { now = new Date() } = {}) {
  const out = Object.fromEntries(Object.keys(STORE_DEFS).map((s) => [s, []]));
  out.categories.push(...meta.categories);
  out.coupons.push(...withCouponUsage(meta.coupons, sample ? sample.couponUsage : {}));
  for (const p of products) {
    const { variants = [], ...rest } = p;
    out.products.push(rest);
    variants.forEach((v) => out.variants.push({ ...v, productId: p.id }));
  }
  out.reviews.push(...reviews);
  // Historical orders do not touch variant stock: products.json holds the CURRENT stock.
  if (sample) {
    out.customers.push(...sample.customers);
    out.orders.push(...sample.orders);
  }
  out.settings.push({ key: 'store', ...meta.settings });
  // One document per content key (data/content.json is the single source).
  for (const key of CONTENT_KEYS) out.content.push({ ...content[key], key });
  out.settings.push({ key: 'seeded', seededAt: now.toISOString() });
  return out;
}

function writeSeed(t, data) {
  for (const [store, records] of Object.entries(buildSeedStores(data))) {
    const os = t.objectStore(store);
    records.forEach((r) => os.put(r));
  }
}

const isSeeded = (t) => reqP(t.objectStore('settings').get('seeded')).then(Boolean);

export async function ensureSeeded() {
  if (await tx(['settings'], 'readonly', isSeeded)) {
    // Best-effort data migration: a failure (e.g. content.json unreachable) must not block an already seeded shop.
    try { await migrateContent(); } catch (e) { console.warn('Content migration skipped', e); }
    return false;
  }
  const data = await loadSeedData();
  return tx(Object.keys(STORE_DEFS), 'readwrite', async (t) => {
    if (await isSeeded(t)) return false; // another tab won the race
    writeSeed(t, data);
    return true;
  });
}

export async function resetToSeed() {
  const data = await loadSeedData();
  await tx(Object.keys(STORE_DEFS), 'readwrite', async (t) => {
    Object.keys(STORE_DEFS).forEach((s) => t.objectStore(s).clear());
    writeSeed(t, data);
  });
  // After the commit: open admin/storefront views that cache settings or content can refresh.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('settings:changed'));
    window.dispatchEvent(new CustomEvent('content:changed', { detail: { key: null } }));
  }
}

/**
 * Data migration (no schema bump) for databases seeded before the unified content model:
 * drops the legacy `editorial` record and replaces malformed/missing content documents with
 * the defaults. Valid documents (including admin edits) are never touched.
 */
export async function migrateContent() {
  const records = await tx(['content'], 'readonly', (t) => reqP(t.objectStore('content').getAll()));
  const stub = Object.fromEntries(CONTENT_KEYS.map((k) => [k, {}]));
  const probe = planContentMigration(records, stub);
  if (!probe.deletes.length && !probe.puts.length) return 0;
  const defaults = await load('content');
  return tx(['content'], 'readwrite', async (t) => {
    const store = t.objectStore('content');
    const plan = planContentMigration(await reqP(store.getAll()), defaults);
    plan.deletes.forEach((k) => store.delete(k));
    plan.puts.forEach((r) => store.put(r));
    return plan.deletes.length + plan.puts.length;
  });
}
