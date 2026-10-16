import { tx, reqP } from './db.js';
import { STORE_DEFS } from './schema.js';
import { CONTENT_KEYS, planContentMigration } from './services/content-rules.js';

const load = async (name) => {
  const res = await fetch(new URL(`../../data/${name}.json`, import.meta.url));
  if (!res.ok) throw new Error(`Failed to load ${name}.json`);
  return res.json();
};

async function loadSeedData() {
  const [meta, prod, content, rev] = await Promise.all([load('catalog-meta'), load('products'), load('content'), load('reviews')]);
  return { meta, products: prod.products || [], content, reviews: rev.reviews || [] };
}

function writeSeed(t, { meta, products, content, reviews = [] }) {
  const put = (store, v) => t.objectStore(store).put(v);
  meta.categories.forEach((c) => put('categories', c));
  meta.coupons.forEach((c) => put('coupons', c));
  for (const p of products) {
    const { variants = [], ...rest } = p;
    put('products', rest);
    variants.forEach((v) => put('variants', { ...v, productId: p.id }));
  }
  reviews.forEach((r) => put('reviews', r));
  put('settings', { key: 'store', ...meta.settings });
  // One document per content key (data/content.json is the single source).
  for (const key of CONTENT_KEYS) put('content', { ...content[key], key });
  put('settings', { key: 'seeded', seededAt: new Date().toISOString() });
}

const isSeeded = (t) => reqP(t.objectStore('settings').get('seeded')).then(Boolean);

export async function ensureSeeded() {
  if (await tx(['settings'], 'readonly', isSeeded)) {
    await migrateContent();
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
