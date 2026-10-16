const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const sample = JSON.parse(fs.readFileSync(path.join(root, 'data/sample-data.json'), 'utf8'));
const stocked = (p, min = 1) => p.variants.find((v) => v.stock >= min);
const prod = products.find((p) => p.status !== 'archived' && p.priceCents >= 3000 && stocked(p, 6));

const GATE = '[data-admin-gate]';
const OVERVIEW = '[data-admin-view="overview"]';
const EMAIL = 'admin@elan.demo';
const PASSWORD = 'demo1234';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const money = (c) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100);
const nbsp = (s) => s.replace(/\s/g, ' ');

async function openGate(page, hash = '#/admin') {
  await page.goto(`/${hash}`);
  await expect(page.locator(GATE)).toBeVisible();
}
async function login(page) {
  await page.fill('#ag-email', EMAIL);
  await page.fill('#ag-password', PASSWORD);
  await page.locator('[data-gate-submit]').click();
}
async function enter(page, hash = '#/admin') {
  await openGate(page, hash);
  await login(page);
  await expect(page.locator('[data-admin-shell]')).toBeVisible();
}
async function overviewReady(page) {
  await expect(page.locator(OVERVIEW)).toHaveAttribute('data-ready', 'true');
}
const statValue = async (page, key) => Number(await page.locator(`[data-stat="${key}"]`).getAttribute('data-value'));
const readStats = async (page) => {
  const out = {};
  for (const k of ['totalOrders', 'revenueCents', 'pending', 'completed', 'activeProducts', 'lowStockProducts', 'customers']) out[k] = await statValue(page, k);
  return out;
};

/** Independent recomputation from IndexedDB (does not import the app's stats service). */
async function expectedFromDb(page) {
  const db = await page.evaluate(async () => {
    const m = await import('/assets/js/db.js');
    return { orders: await m.getAll('orders'), products: await m.getAll('products'), variants: await m.getAll('variants'), customers: await m.getAll('customers') };
  });
  const counted = db.orders.filter((o) => o.fulfillmentStatus !== 'cancelled' && o.fulfillmentStatus !== 'returned');
  const active = db.products.filter((p) => p.status !== 'archived');
  const stock = (id) => db.variants.filter((v) => v.productId === id).reduce((s, v) => s + v.stock, 0);
  return {
    db,
    stats: {
      totalOrders: db.orders.length,
      revenueCents: counted.reduce((s, o) => s + o.totals.totalCents, 0),
      pending: db.orders.filter((o) => o.fulfillmentStatus === 'pending').length,
      completed: db.orders.filter((o) => o.fulfillmentStatus === 'delivered').length,
      activeProducts: active.length,
      lowStockProducts: active.filter((p) => stock(p.id) <= 5).length,
      customers: db.customers.length,
    },
  };
}

async function place(page, { pay = 'cod' } = {}) {
  const sku = stocked(prod, 6).sku;
  return page.evaluate(async (a) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    await cart.addLine(a.sku, 1);
    return co.placeOrder({
      form: { firstName: 'Ρένα', lastName: 'Αδμίν', email: 'rena.admin.test@example.gr', phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: a.pay, requestId: `r-${Math.random()}`,
    });
  }, { sku, pay });
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

test('fixtures', () => { expect(prod).toBeTruthy(); });

test('gate shows the demo credentials and the not-real-authentication disclaimer', async ({ page }) => {
  const errors = trackErrors(page);
  await openGate(page);
  await expect(page.locator(`${GATE} h1`)).toContainText('Είσοδος διαχειριστή');
  await expect(page.locator(GATE)).toContainText('ΜΟΝΟ DEMO, ΟΧΙ ΠΡΑΓΜΑΤΙΚΗ ΤΑΥΤΟΠΟΙΗΣΗ');
  await expect(page.locator('[data-gate-disclaimer]')).toContainText('δεν είναι ασφαλής');
  await expect(page.locator('[data-gate-disclaimer]')).toContainText('τοπικά σε αυτόν τον περιηγητή');
  await expect(page.locator('[data-demo-email]')).toHaveText(EMAIL);
  await expect(page.locator('[data-demo-password]')).toHaveText(PASSWORD);
  await expect(page.locator('[data-demo-badge]')).toBeVisible();
  // storefront chrome is hidden on admin routes, the demo strip stays
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('.demo-strip')).toBeVisible();
  // one-click fill
  await page.locator('[data-gate-fill]').click();
  await expect(page.locator('#ag-email')).toHaveValue(EMAIL);
  await expect(page.locator('#ag-password')).toHaveValue(PASSWORD);
  expect(errors).toEqual([]);
});

test('wrong credentials are rejected with an error and no session', async ({ page }) => {
  await openGate(page);
  await page.fill('#ag-email', EMAIL);
  await page.fill('#ag-password', 'wrong');
  await page.locator('[data-gate-submit]').click();
  await expect(page.locator('[data-gate-error]')).toBeVisible();
  await expect(page.locator('[data-gate-error]')).toContainText('Λάθος');
  await expect(page.locator(GATE)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('adminSession'))).toBeNull();
  await page.fill('#ag-email', 'someone@else.gr');
  await page.fill('#ag-password', PASSWORD);
  await page.locator('[data-gate-submit]').click();
  await expect(page.locator('[data-gate-error]')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('adminSession'))).toBeNull();
});

test('correct credentials continue to the requested admin route; reload keeps the session; a new context needs login', async ({ page, browser }) => {
  await enter(page, '#/admin/customers');
  await expect(page).toHaveURL(/#\/admin\/customers$/);
  await expect(page.locator('[data-admin-view="placeholder"]')).toBeVisible();
  await expect(page.locator('[data-admin-view="placeholder"]')).toContainText('Σύντομα διαθέσιμο');
  expect(await page.evaluate(() => sessionStorage.getItem('adminSession'))).toBe('1');
  await page.reload();
  await expect(page.locator('[data-admin-view="placeholder"]')).toBeVisible();
  await expect(page.locator(GATE)).toHaveCount(0);

  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const p2 = await ctx.newPage();
  await p2.goto('/#/admin/customers');
  await expect(p2.locator(GATE)).toBeVisible();
  await expect(p2.locator('[data-admin-shell]')).toHaveCount(0);
  await ctx.close();
});

test('any admin URL without a session shows the gate; logout clears the session', async ({ page }) => {
  for (const hash of ['#/admin/anything', '#/admin/orders/ELAN-20260101-AAAA', '#/admin/products']) {
    await page.goto(`/${hash}`);
    await expect(page.locator(GATE), hash).toBeVisible();
  }
  await login(page);
  await expect(page.locator('[data-admin-view="placeholder"]')).toBeVisible();
  await page.goto('/#/admin/anything');
  await expect(page.locator('[data-admin-view="not-found"]')).toBeVisible();
  await expect(page.locator('[data-admin-shell]')).toBeVisible();
  await page.locator('[data-admin-topbar] [data-admin-logout]').click();
  await expect(page.locator(GATE)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('adminSession'))).toBeNull();
  await page.goto('/#/admin/products');
  await expect(page.locator(GATE)).toBeVisible();
});

test('seeded dashboard is populated on first launch and equals values recomputed from IndexedDB', async ({ page }) => {
  const errors = trackErrors(page);
  await enter(page);
  await overviewReady(page);
  const shown = await readStats(page);
  const { db, stats } = await expectedFromDb(page);
  expect(shown).toEqual(stats);
  expect(db.orders.length).toBe(sample.orders.length);
  expect(db.customers.length).toBe(sample.customers.length);
  for (const v of Object.values(shown)) expect(v).toBeGreaterThan(0);
  // visible formatted revenue matches
  expect(nbsp(await page.locator('[data-stat="revenueCents"]').innerText())).toBe(nbsp(money(stats.revenueCents)));
  // status distribution
  for (const s of ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']) {
    const n = db.orders.filter((o) => o.fulfillmentStatus === s).length;
    expect(Number(await page.locator(`[data-status-count="${s}"]`).getAttribute('data-value')), s).toBe(n);
  }
  // recent orders: newest 8, newest first
  const newest = db.orders.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8).map((o) => o.id);
  const rows = page.locator('[data-recent-order]');
  await expect(rows).toHaveCount(8);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-recent-order')))).toEqual(newest);
  await expect(rows.first()).toContainText(/Παραλήφθηκε|Επιβεβαιώθηκε|Σε προετοιμασία|Απεστάλη|Παραδόθηκε|Ακυρώθηκε|Επιστράφηκε/);
  await expect(rows.first()).toContainText(/Εκκρεμεί πληρωμή|Προσομοίωση: πληρώθηκε|Επιστροφή χρημάτων/);
  // chart with accessible name and a data table; sales total over 30 days
  const svg = page.locator('[data-sales-chart] svg[role="img"]');
  await expect(svg).toHaveCount(1);
  expect(await svg.getAttribute('aria-label')).toMatch(/30 ημέρες/);
  await expect(page.locator('[data-sales-table] tbody tr')).toHaveCount(30);
  const recentSales = await page.locator('[data-sales-table] tbody tr').count();
  expect(recentSales).toBe(30);
  // top products and low stock are populated
  await expect(page.locator('[data-top-product]')).toHaveCount(5);
  await expect(page.locator('[data-low-stock-item]')).toHaveCount(stats.lowStockProducts);
  await expect(page.locator('[data-low-stock-item] a[href="#/admin/products"]').first()).toBeVisible();
  await expect(page.locator('[data-demo-badge]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a storefront order increases total orders, pending and revenue; cancelling it removes it from revenue', async ({ page }) => {
  await enter(page);
  await overviewReady(page);
  const before = await readStats(page);
  const order = await place(page);
  await page.reload();
  await overviewReady(page);
  const after = await readStats(page);
  expect(after.totalOrders).toBe(before.totalOrders + 1);
  expect(after.pending).toBe(before.pending + 1);
  expect(after.revenueCents).toBe(before.revenueCents + order.totals.totalCents);
  expect(after.customers).toBe(before.customers + 1);
  await expect(page.locator('[data-recent-order]').first()).toHaveAttribute('data-recent-order', order.id);

  await page.evaluate(async (id) => {
    const m = await import('/assets/js/db.js');
    await m.put('orders', { ...(await m.get('orders', id)), fulfillmentStatus: 'cancelled' });
  }, order.id);
  await page.reload();
  await overviewReady(page);
  const cancelled = await readStats(page);
  expect(cancelled.totalOrders).toBe(after.totalOrders);
  expect(cancelled.revenueCents).toBe(before.revenueCents);
  expect(cancelled.pending).toBe(before.pending);
  expect(cancelled).toEqual((await expectedFromDb(page)).stats);
});

test('recent-order links open an admin view (not a 404)', async ({ page }) => {
  await enter(page);
  await overviewReady(page);
  const link = page.locator('[data-recent-order] a[href^="#/admin/orders/"]').first();
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[/#]/g, '\\$&')}$`));
  await expect(page.locator('[data-admin-view="placeholder"]')).toBeVisible();
  await expect(page.locator('[data-page="not-found"]')).toHaveCount(0);
  await expect(page.locator('[data-admin-view="placeholder"]')).toContainText(href.split('/').pop());
});

test('390px: sidebar is an offcanvas that opens, closes and closes on Escape; nav works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await overviewReady(page);
  const sidebar = page.locator('#adminSidebar');
  await expect(sidebar).toBeHidden();
  const toggle = page.locator('[data-admin-menu-toggle]');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('a[href="#/admin/orders"]')).toBeVisible();
  await page.locator('#adminSidebar [data-bs-dismiss="offcanvas"]').click();
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#adminSidebar'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await sidebar.locator('a[href="#/admin/orders"]').click();
  await expect(page).toHaveURL(/#\/admin\/orders$/);
  await expect(page.locator('[data-admin-view="placeholder"]')).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expect(page.locator('.offcanvas-backdrop')).toHaveCount(0);
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
  await expect(page.locator('[data-demo-badge]')).toBeVisible();
});

test('desktop: sidebar is always visible with every section; all nav targets resolve to admin views', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  const sidebar = page.locator('#adminSidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.locator('[data-admin-menu-toggle]')).toBeHidden();
  const hrefs = await sidebar.locator('nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['#/admin', '#/admin/products', '#/admin/orders', '#/admin/customers', '#/admin/promotions', '#/admin/content', '#/admin/settings', '#/admin/backup']);
  await expect(sidebar.locator('nav a[href="#/admin"]')).toHaveAttribute('aria-current', 'page');
  for (const h of hrefs.slice(1)) {
    await sidebar.locator(`nav a[href="${h}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${h.replace(/[/#]/g, '\\$&')}$`));
    await expect(page.locator('[data-admin-view="placeholder"]'), h).toBeVisible();
    await expect(sidebar.locator(`nav a[href="${h}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await expect(page.locator('[data-view-store]').first()).toHaveAttribute('href', '#/');
});

test('no horizontal overflow on gate and overview at 320/390/768/1440', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/');
    await page.evaluate(() => sessionStorage.removeItem('adminSession'));
    await openGate(page);
    expect(await overflow(page), `gate ${width}`).toBeLessThanOrEqual(0);
    await login(page);
    await overviewReady(page);
    expect(await overflow(page), `overview ${width}`).toBeLessThanOrEqual(0);
  }
});

test('empty store: overview shows empty states without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await enter(page);
  await overviewReady(page);
  await page.evaluate(async () => {
    const m = await import('/assets/js/db.js');
    await m.tx(['orders', 'customers'], 'readwrite', (t) => { t.objectStore('orders').clear(); t.objectStore('customers').clear(); });
  });
  await page.reload();
  await overviewReady(page);
  expect(await statValue(page, 'totalOrders')).toBe(0);
  expect(await statValue(page, 'revenueCents')).toBe(0);
  await expect(page.locator('[data-recent-empty]')).toBeVisible();
  await expect(page.locator('[data-top-empty]')).toBeVisible();
  await expect(page.locator('[data-sales-chart] svg[role="img"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
