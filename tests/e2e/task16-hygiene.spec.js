// Task 16 hygiene: coupon expiry preservation, coupons:changed after checkout, optional seed files.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const active = products.filter((p) => p.status !== 'archived');
const stocked = (p, min) => p.variants.find((v) => v.stock >= min && !v.archived);
const P = active.find((p) => p.priceCents >= 3500 && p.priceCents < 5800 && stocked(p, 3));
const SKU = stocked(P, 3).sku;

const dbGet = (page, store, key) => page.evaluate(async ([s, k]) => (await import('/assets/js/db.js')).get(s, k), [store, key]);
const dbAll = (page, store) => page.evaluate(async (s) => (await import('/assets/js/db.js')).getAll(s), store);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}

test('fixture exists', () => { expect(P).toBeTruthy(); });

test('saveCoupon without an expiresOn key keeps the stored expiry; an explicit empty value clears it', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const m = await import('/assets/js/services/coupons.js');
    const future = new Date(Date.now() + 40 * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    const on = `${future.getFullYear()}-${p(future.getMonth() + 1)}-${p(future.getDate())}`;
    const first = await m.saveCoupon({ code: 'KEEPEXP', type: 'percent', value: '10', expiresOn: on, active: true });
    const second = await m.saveCoupon({ editingCode: 'KEEPEXP', code: 'KEEPEXP', type: 'percent', value: '12', active: true });
    const third = await m.saveCoupon({ editingCode: 'KEEPEXP', code: 'KEEPEXP', type: 'percent', value: '12', expiresOn: '', active: true });
    return { first: first.expiresAt, second: second.expiresAt, secondValue: second.value, third: third.expiresAt };
  });
  expect(r.first).toBeTruthy();
  expect(r.second).toBe(r.first);
  expect(r.secondValue).toBe(12);
  expect(r.third).toBeNull();
});

test('an open promotions page updates its usage count after a checkout commits (coupons:changed)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.evaluate(async (sku) => {
    const cart = await import('/assets/js/services/cart.js');
    await cart.addLine(sku, 1);
    await cart.applyCoupon('WELCOME10');
  }, SKU);
  await page.goto('/#/admin/promotions');
  await expect(page.locator('[data-admin-view="promotions"]')).toHaveAttribute('data-ready', 'true');
  const row = page.locator('tr[data-coupon-code="WELCOME10"]');
  const used = Number(await row.getAttribute('data-used'));
  // the event fires only after the transaction commits
  const fired = await page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('coupons:changed', async (e) => {
      const { get } = await import('/assets/js/db.js');
      resolve({ code: e.detail.code, usedInDb: (await get('coupons', e.detail.code)).usedCount });
    }, { once: true });
    window.__placing = import('/assets/js/services/checkout.js').then((m) => m.placeOrder({
      form: {
        firstName: 'Νίκος', lastName: 'Γεωργίου', email: 'nikos@example.gr', phone: '2101234567', address: 'Σταδίου 5', city: 'Αθήνα', postalCode: '10562', region: 'Αττική', acceptTerms: true,
      },
      shippingMethod: 'courier', paymentMethod: 'cod', requestId: `hyg-${Math.random()}`,
    }));
  }));
  expect(fired.code).toBe('WELCOME10');
  expect(fired.usedInDb).toBe(used + 1);
  await expect(row).toHaveAttribute('data-used', String(used + 1));
  expect(errors).toEqual([]);
});

test('a missing sample-data.json seeds the shop without sample orders instead of the fatal DB error screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/data/sample-data.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/#/catalog');
  await expect(page.locator('[data-page="catalog"]')).toBeVisible();
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expect(page.getByText('Σφάλμα βάσης δεδομένων')).toHaveCount(0);
  expect((await dbAll(page, 'products')).length).toBeGreaterThan(30);
  expect(await dbAll(page, 'orders')).toEqual([]);
  expect(await dbAll(page, 'customers')).toEqual([]);
  expect((await dbGet(page, 'settings', 'seeded')).seededAt).toBeTruthy();
  expect((await dbGet(page, 'content', 'hero')).title).toBeTruthy();
  expect(errors).toEqual([]);
});

test('a failing content migration (content.json unreachable) does not block an already seeded shop', async ({ page }) => {
  await boot(page);
  // make one stored content document malformed so the migration wants to fetch the defaults
  await page.evaluate(async () => (await import('/assets/js/db.js')).put('content', { key: 'hero', title: 5 }));
  await page.route('**/data/content.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/#/catalog');
  await page.reload();
  await expect(page.locator('[data-page="catalog"]')).toBeVisible();
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expect(page.getByText('Σφάλμα βάσης δεδομένων')).toHaveCount(0);
  // once the file is reachable again the migration repairs the document
  await page.unroute('**/data/content.json');
  await page.reload();
  await expect.poll(async () => typeof (await dbGet(page, 'content', 'hero')).title).toBe('string');
});
