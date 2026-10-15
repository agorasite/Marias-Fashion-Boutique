import { tx, reqP } from './db.js';
import { STORE_DEFS } from './schema.js';

const load = async (name) => {
  const res = await fetch(new URL(`../../data/${name}.json`, import.meta.url));
  if (!res.ok) throw new Error(`Failed to load ${name}.json`);
  return res.json();
};

async function loadSeedData() {
  const [meta, prod] = await Promise.all([load('catalog-meta'), load('products')]);
  return { meta, products: prod.products || [] };
}

function writeSeed(t, { meta, products }) {
  const put = (store, v) => t.objectStore(store).put(v);
  meta.categories.forEach((c) => put('categories', c));
  meta.coupons.forEach((c) => put('coupons', c));
  for (const p of products) {
    const { variants = [], ...rest } = p;
    put('products', rest);
    variants.forEach((v) => put('variants', { ...v, productId: p.id }));
  }
  put('settings', { key: 'store', ...meta.settings });
  for (const [key, value] of Object.entries(meta.content || {})) put('content', { key, ...value });
  put('settings', { key: 'seeded', seededAt: new Date().toISOString() });
}

const isSeeded = (t) => reqP(t.objectStore('settings').get('seeded')).then(Boolean);

export async function ensureSeeded() {
  if (await tx(['settings'], 'readonly', isSeeded)) return false;
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
