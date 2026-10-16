const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/products.json'), 'utf8')).products;

const run = (page, fn, arg) =>
  page.evaluate(async ([src, a]) => {
    const db = await import('/assets/js/db.js');
    const seed = await import('/assets/js/seed.js');
    const settings = await import('/assets/js/services/settings.js');
    // eslint-disable-next-line no-new-func
    return new Function('m', 'a', `return (${src})(m, a)`)({ db, seed, settings }, a);
  }, [fn.toString(), arg]);

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === 'agorasite-fashion1-v1');
  });
  // wait for seeding to complete
  await page.waitForFunction(async () => {
    const m = await import('/assets/js/db.js');
    const s = await m.get('settings', 'seeded');
    return !!s;
  });
}

test('first load seeds settings, categories, products and variants', async ({ page }) => {
  await ready(page);
  const r = await run(page, async (m) => ({
    settings: await m.settings.getSettings(),
    cats: (await m.db.getAll('categories')).length,
    products: (await m.db.getAll('products')).length,
    variants: await m.db.getAll('variants'),
    coupons: (await m.db.getAll('coupons')).length,
    product: (await m.db.getAll('products'))[0],
  }));
  expect(r.settings.storeName).toBe('ÉLAN Fashion Boutique');
  expect(r.settings.vatRate).toBe(0.24);
  expect(r.settings.seededAt).toBeTruthy();
  expect(r.cats).toBeGreaterThanOrEqual(15);
  expect(r.products).toBe(catalog.length);
  expect(r.variants.length).toBeGreaterThan(catalog.length);
  expect(r.variants.every((v) => v.productId)).toBe(true);
  expect(r.product.variants).toBeUndefined();
  expect(r.coupons).toBe(4);
});

test('every catalog product has its variants stored; one document per content key is seeded', async ({ page }) => {
  await ready(page);
  const r = await run(page, async (m) => ({
    products: await m.db.getAll('products'),
    variants: await m.db.getAll('variants'),
    content: await m.db.getAll('content'),
  }));
  expect(r.products.length).toBe(catalog.length);
  for (const p of catalog) {
    const stored = r.variants.filter((v) => v.productId === p.id).map((v) => v.sku).sort();
    expect(stored).toEqual(p.variants.map((v) => v.sku).sort());
  }
  expect(r.variants.length).toBe(catalog.reduce((n, p) => n + p.variants.length, 0));
  const byKey = Object.fromEntries(r.content.map((c) => [c.key, c]));
  expect(Object.keys(byKey).sort()).toEqual(['banners', 'collections', 'footer', 'hero', 'instagram', 'newsletter', 'promos']);
  expect(byKey.editorial).toBeUndefined();
  expect(byKey.hero.image).toBe('assets/images/content/hero-1.webp');
  expect(byKey.hero.title).toBeTruthy();
  expect(byKey.hero.focal).toBe('65% center');
  expect(byKey.collections.items).toHaveLength(4);
  expect(byKey.instagram.posts).toHaveLength(9);
  expect(byKey.instagram.mode).toBe('curated');
  expect(byKey.instagram.posts.every((x) => x.productIds.length > 0)).toBe(true);
});

test('settings persist across reload and seed does not re-run', async ({ page }) => {
  await ready(page);
  const before = await run(page, async (m) => (await m.settings.getSettings()).seededAt);
  await run(page, async (m) => { await m.settings.saveSettings({ courierCents: 555 }); });
  await page.reload();
  await ready(page);
  const after = await run(page, async (m) => m.settings.getSettings());
  expect(after.courierCents).toBe(555);
  expect(after.seededAt).toBe(before);
});

test('deleted seeded product stays deleted on reload; resetToSeed restores', async ({ page }) => {
  await ready(page);
  const id = await run(page, async (m) => {
    const p = (await m.db.getAll('products'))[0];
    await m.db.del('products', p.id);
    return p.id;
  });
  await page.reload();
  await ready(page);
  expect(await run(page, async (m, i) => (await m.db.get('products', i)) ?? null, id)).toBeNull();
  await run(page, async (m) => { await m.seed.resetToSeed(); });
  expect(await run(page, async (m, i) => (await m.db.get('products', i)).id, id)).toBe(id);
});

test('unavailable IndexedDB shows Greek error screen', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); }, configurable: true });
  });
  await page.goto('/');
  const body = page.locator('body');
  await expect(body).toContainText('Σφάλμα');
  await expect(page.locator('#app')).not.toBeEmpty();
});

test('first install seeds the sample customers/orders (re-dated, stock untouched); resetToSeed restores them', async ({ page }) => {
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/sample-data.json'), 'utf8'));
  await ready(page);
  const snap = () => run(page, async (m) => ({
    orders: await m.db.getAll('orders'),
    customers: await m.db.getAll('customers'),
    coupons: await m.db.getAll('coupons'),
    variants: await m.db.getAll('variants'),
  }));
  const r = await snap();
  expect(r.orders).toHaveLength(sample.orders.length);
  expect(r.customers).toHaveLength(sample.customers.length);
  expect(r.orders.every((o) => o.sample && o.demo)).toBe(true);
  const newest = r.orders.map((o) => o.createdAt).sort().pop();
  expect(new Date(newest).getTime()).toBeLessThanOrEqual(Date.now());
  expect(Date.now() - new Date(newest).getTime()).toBeLessThan(2 * 86400000); // re-dated to the install day
  for (const [code, n] of Object.entries(sample.couponUsage)) expect(r.coupons.find((c) => c.code === code).usedCount).toBe(n);
  const stock = Object.fromEntries(catalog.flatMap((p) => p.variants.map((v) => [v.sku, v.stock])));
  expect(r.variants.every((v) => v.stock === stock[v.sku])).toBe(true);
  await run(page, async (m) => { await m.db.tx(['orders', 'customers'], 'readwrite', (t) => { t.objectStore('orders').clear(); t.objectStore('customers').clear(); }); });
  await page.reload();
  await ready(page);
  expect((await snap()).orders).toHaveLength(0); // not re-seeded on reload
  await run(page, async (m) => { await m.seed.resetToSeed(); });
  const after = await snap();
  expect(after.orders).toHaveLength(sample.orders.length);
  expect(after.customers).toHaveLength(sample.customers.length);
});
