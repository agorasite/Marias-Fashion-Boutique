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
  let files;
  try {
    files = await Promise.all([load('catalog-meta'), load('products'), load('content'), load('reviews'), optional('sample-data')]);
  } catch (e) {
    // network/server problem, not a storage one: the start-up screen says so and offers a retry
    throw Object.assign(new Error('Seed data unavailable'), { code: 'seed-fetch', cause: e });
  }
  const [meta, prod, content, rev, sampleRaw] = files;
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
    try { await dropRemovedImages(); } catch (e) { console.warn('Image migration skipped', e); }
    try { await migrateDefaultBrand(); } catch (e) { console.warn('Brand migration skipped', e); }
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

/** Seed photos deleted from the repository after release, per product (Task 18: mirrored duplicate). */
export const REMOVED_IMAGES = { 's-combat-boots-black': ['assets/images/products/s-combat-boots-black-2.webp'] };

/** Remove deleted seed photos from products of databases seeded earlier (never leaves a product without images). */
export async function dropRemovedImages() {
  return tx(['products'], 'readwrite', async (t) => {
    const store = t.objectStore('products');
    let n = 0;
    for (const [id, gone] of Object.entries(REMOVED_IMAGES)) {
      const p = await reqP(store.get(id));
      if (!p || !Array.isArray(p.images)) continue;
      const kept = p.images.filter((src) => !gone.includes(src));
      if (kept.length && kept.length !== p.images.length) { store.put({ ...p, images: kept }); n += 1; }
    }
    return n;
  });
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

/**
 * Update only the original ÉLAN demo branding when an existing browser database is opened
 * using the Marias edition. Preserve custom store names, custom product brands and orders.
 * Do not change IDs or the IndexedDB name: customers and old order links must survive.
 * Idempotent and safe to call again after importing a legacy backup.
 */
export async function migrateDefaultBrand() {
  const names = ['settings', 'products', 'content', 'orders', 'coupons'];
  const fromOld = (s) => typeof s === 'string' ? s
    .replaceAll('ÉLAN Fashion Boutique', 'Marias Fashion Boutique')
    .replaceAll('ÉLAN Denim', 'Marias Denim')
    .replaceAll('ÉLAN', 'Marias')
    .replaceAll('elan.boutique', 'marias.boutique')
    .replaceAll('elan.example', 'marias.example') : s;
  const visit = (v) => {
    if (typeof v === 'string') return fromOld(v);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  };
  return tx(names, 'readwrite', async (t) => {
    const count = { changed: 0 };
    const update = (storeName, rec, next) => {
      if (JSON.stringify(rec) !== JSON.stringify(next)) { t.objectStore(storeName).put(next); count.changed++; }
    };
    const [settings, products, content, orders, coupons] = await Promise.all(names.map((n) => reqP(t.objectStore(n).getAll())));
    for (const row of settings) {
      if (row.key !== 'store') continue;
      const next = { ...row };
      if (row.storeName === 'ÉLAN Fashion Boutique') next.storeName = 'Marias Fashion Boutique';
      if (row.contact?.email === 'info@elan.example') next.contact = { ...row.contact, email: 'info@marias.example' };
      update('settings', row, next);
    }
    for (const row of products) {
      if (row.brand !== 'ÉLAN' && row.brand !== 'ÉLAN Denim') continue;
      update('products', row, { ...row, brand: fromOld(row.brand) });
    }
    // Content entries are admin-editable; change only original brand tokens, preserve all other copy.
    for (const row of content) update('content', row, visit(row));
    for (const row of orders) {
      const next = { ...row };
      if (row.couponCode === 'ELAN5') next.couponCode = 'MARIAS5';
      if (Array.isArray(row.lines)) next.lines = row.lines.map((line) => ({ ...line, brand: fromOld(line.brand) }));
      update('orders', row, next);
    }
    for (const row of coupons) {
      if (row.code !== 'ELAN5') continue;
      t.objectStore('coupons').delete(row.code);
      t.objectStore('coupons').put({ ...row, code: 'MARIAS5' });
      count.changed++;
    }
    return count.changed;
  });
}
