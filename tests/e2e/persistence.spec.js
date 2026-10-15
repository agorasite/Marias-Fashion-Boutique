const { test, expect } = require('@playwright/test');

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
  expect(r.products).toBe(3);
  expect(r.variants.length).toBeGreaterThan(3);
  expect(r.variants.every((v) => v.productId)).toBe(true);
  expect(r.product.variants).toBeUndefined();
  expect(r.coupons).toBe(4);
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
