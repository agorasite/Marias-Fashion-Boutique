// Task 18 Part 2 — deferred fixes, each pinned by a test written before the fix.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { ACTIVE, watch, settle, go, open, seedShopper, adminOn } = require('./support/qa');

const ROOT = path.join(__dirname, '../..');
const CARD = '.product-card[data-product-id]';

// ------------------------------------------------------------------ (a) account tab strip
for (const width of [320, 390]) {
  test(`account tabs fit without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, '#/');
    await seedShopper(page);
    await go(page, '#/account');
    const r = await page.evaluate(() => {
      const ul = document.querySelector('.acct-nav ul');
      const box = ul.getBoundingClientRect();
      const tabs = [...ul.querySelectorAll('a')].map((a) => {
        const b = a.getBoundingClientRect();
        const label = a.querySelector('span');
        return { text: a.textContent.trim(), inside: b.left >= box.left - 0.5 && b.right <= box.right + 0.5, clipped: label.scrollWidth > label.clientWidth + 1, h: b.height, w: b.width };
      });
      return { scroll: ul.scrollWidth - ul.clientWidth, tabs, page: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(r.scroll).toBeLessThanOrEqual(0);
    expect(r.page).toBeLessThanOrEqual(0);
    for (const t of r.tabs) {
      expect(t.inside, t.text).toBe(true);
      expect(t.clipped, t.text).toBe(false);
      expect(t.h, t.text).toBeGreaterThanOrEqual(44);
    }
    expect(r.tabs.map((t) => t.text)).toContain('Προφίλ');
  });
}

// ------------------------------------------------------------------ (b) catalog races and URL hygiene
test('catalog: a pending search debounce never fires after navigating away', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '#/catalog');
  await page.locator('#catalogSearch').pressSequentially('φορ');
  await page.evaluate(() => { location.hash = '#/cart'; });
  await settle(page);
  await page.clock.runFor(2000);
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.locator('[data-page="cart"], #app [data-route="/cart"]').first()).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(3);
});

test('catalog: «load more» during an in-flight refresh keeps the refreshed, correctly sorted list', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '#/catalog');
  await expect(page.locator(CARD)).toHaveCount(12);
  await page.evaluate(() => {
    const sel = document.querySelector('[data-sort]');
    sel.value = 'price-asc';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-load-more]').click(); // same tick: the refresh is still in flight
  });
  await expect(page.locator('[data-grid]')).not.toHaveAttribute('aria-busy', 'true');
  await expect.poll(async () => {
    const ps = await page.$$eval(CARD, (els) => els.map((e) => Number(e.dataset.price)));
    const ids = await page.$$eval(CARD, (els) => els.map((e) => e.dataset.productId));
    const sorted = ps.every((v, i) => i === 0 || ps[i - 1] <= v);
    return { sorted, unique: new Set(ids).size === ids.length, first: ps[0] };
  }).toEqual({ sorted: true, unique: true, first: Math.min(...ACTIVE.map((p) => p.priceCents)) });
  const shown = await page.locator(CARD).count();
  await expect(page.locator('[data-shown]')).toHaveText(`Εμφάνιση ${shown} από ${ACTIVE.length}`);
});

test('catalog: invalid sub/page values are normalised in the URL', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '#/catalog/women?sub=nope&page=abc');
  await expect(page).toHaveURL(/#\/catalog\/women$/);
  await open(page, '#/catalog?page=-3');
  await expect(page).toHaveURL(/#\/catalog$/);
  await open(page, '#/catalog?page=99');
  const last = Math.ceil(ACTIVE.length / 12);
  await expect(page).toHaveURL(new RegExp(`#/catalog\\?page=${last}$`));
  await expect(page.locator(CARD)).toHaveCount(ACTIVE.length);
});

// ------------------------------------------------------------------ (c) quick view
test('quick view: shared size labels/money, accessible fallback tile, closes on browser Back', async ({ page }) => {
  const problems = watch(page, { allowImageFailures: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '#/');
  await go(page, '#/catalog/accessories');
  await page.route('**/assets/images/products/**', (r) => r.fulfill({ status: 404, body: '' }));
  const card = page.locator(CARD).first();
  const name = await card.locator('.product-card-title a').textContent();
  await card.locator('[data-quick]').click();
  const dlg = page.locator('[data-quick-view]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.product-card-fallback[role="img"]')).toHaveAttribute('aria-label', name.trim());
  await expect(dlg.locator('.qv-sizes')).toContainText('Μία διάσταση');
  await expect(dlg.locator('.price').first()).toHaveText(await card.locator('.product-card-price .price').first().textContent());
  await page.goBack();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  expect(problems).toEqual([]);
});

// ------------------------------------------------------------------ (d) data: combat boots duplicate photo
test('combat boots keep one photo; the mirrored duplicate is gone everywhere', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const boots = JSON.parse(read('data/products.json')).products.find((p) => p.id === 's-combat-boots-black');
  expect(boots.images).toEqual(['assets/images/products/s-combat-boots-black-1.webp']);
  for (const f of ['data/products.json', 'tools/seed-parts/shoes.json', 'tools/image-manifest.json', 'assets/images/credits.json', 'data/content.json', 'data/sample-data.json']) {
    if (fs.existsSync(path.join(ROOT, f))) expect(read(f), f).not.toContain('s-combat-boots-black-2');
  }
  expect(fs.existsSync(path.join(ROOT, 'assets/images/products/s-combat-boots-black-2.webp'))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, 'assets/images/products/s-combat-boots-black-2-sm.webp'))).toBe(false);
});

// ------------------------------------------------------------------ (e) hero image weight on phones
test('a 390px phone downloads the 1200w hero, not the 1920w original', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const heroes = [];
  page.on('request', (r) => { if (/content\/hero-1[^/]*\.webp/.test(r.url())) heroes.push(r.url().replace(/^.*\//, '')); });
  await open(page, '#/');
  await expect.poll(() => page.locator('.home-hero-img').evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  expect(heroes).toEqual(['hero-1-md.webp']);
  const bytes = fs.statSync(path.join(ROOT, 'assets/images/content/hero-1-md.webp')).size;
  expect(bytes).toBeLessThan(fs.statSync(path.join(ROOT, 'assets/images/content/hero-1.webp')).size * 0.6);
  // desktop still gets the full-size file
  const big = await page.context().newPage();
  await big.setViewportSize({ width: 1440, height: 900 });
  const seen = [];
  big.on('request', (r) => { if (/content\/hero-1[^/]*\.webp/.test(r.url())) seen.push(r.url().replace(/^.*\//, '')); });
  await big.goto('/#/');
  await expect.poll(() => big.locator('.home-hero-img').evaluate((i) => i.currentSrc.replace(/^.*\//, ''))).toBe('hero-1.webp');
  expect(seen).toContain('hero-1.webp');
  await big.close();
});

// ------------------------------------------------------------------ (f) mobile menu note
test('mobile menu note uses the shared free-shipping phrase', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '#/');
  await page.evaluate(async () => {
    const s = await import('/assets/js/services/settings.js');
    await s.saveSettings({ ...(await s.getSettings()), freeShippingThresholdCents: 4550 });
  });
  await open(page, '#/');
  const expected = await page.evaluate(async () => (await import('/assets/js/services/pricing.js')).freeShippingPhrase(4550));
  await expect(page.locator('#navOffcanvas .offcanvas-note')).toHaveText(expected);
});

// ------------------------------------------------------------------ (g) shop the look
test('opening a second «shop the look» disposes the first (no leftover backdrop or scroll lock)', async ({ page }) => {
  const problems = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '#/');
  const second = await page.evaluate(async () => {
    const m = await import('/assets/js/components/shop-the-look.js');
    const c = await import('/assets/js/services/content.js');
    const ig = await c.getContent('instagram');
    m.openShopTheLook(ig.posts[0]);
    m.openShopTheLook(ig.posts[1]); // while the first is still fading in
    return ig.posts[1].id;
  });
  await expect(page.locator(`#stl-${second}.show`)).toBeVisible();
  await expect(page.locator('[data-insta-modal]')).toHaveCount(1);
  await expect(page.locator('.modal-backdrop')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-insta-modal]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-insta-modal]')).toHaveCount(0);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  expect(problems).toEqual([]);
});

test('a dialog dismissed while still fading in closes and resolves (no stuck dialog)', async ({ page }) => {
  await open(page, '#/');
  const answer = await page.evaluate(async () => {
    const { confirmDialog } = await import('/assets/js/components/modals.js');
    const p = confirmDialog('Δοκιμή;');
    document.querySelector('.modal [data-bs-dismiss="modal"]').click(); // immediately, mid fade-in
    return p;
  });
  expect(answer).toBe(false);
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
});

// ------------------------------------------------------------------ (h) admin lists follow change events, no listener leaks
test('admin lists re-render on orders/customers/coupons/catalog changes and unsubscribe on leave', async ({ page }) => {
  await page.addInitScript(() => {
    const live = new Map();
    const add = window.addEventListener.bind(window);
    const rm = window.removeEventListener.bind(window);
    window.addEventListener = (t, fn, o) => { if (/:changed$/.test(t)) { if (!live.has(t)) live.set(t, new Set()); live.get(t).add(fn); } return add(t, fn, o); };
    window.removeEventListener = (t, fn, o) => { live.get(t)?.delete(fn); return rm(t, fn, o); };
    window.__listeners = (t) => live.get(t)?.size || 0;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '#/');
  const { orderId } = await seedShopper(page);
  await adminOn(page);
  const base = await page.evaluate(() => ['orders:changed', 'coupons:changed', 'catalog:changed', 'customers:changed'].map((t) => window.__listeners(t)));

  await go(page, '#/admin/orders');
  const row = page.locator(`tr[data-order-id="${orderId}"]`);
  await expect(row).toHaveAttribute('data-fulfillment', 'pending');
  await page.evaluate(async (id) => (await import('/assets/js/services/orders.js')).updateFulfillment(id, 'processing'), orderId);
  await expect(row).toHaveAttribute('data-fulfillment', 'processing');

  await go(page, '#/admin/customers');
  const before = Number(await page.locator('[data-count]').getAttribute('data-total'));
  await page.evaluate(async () => {
    const c = await import('/assets/js/services/customers.js');
    await c.createLocalProfile({ firstName: 'Νέος', lastName: 'Πελάτης', email: `new-${Date.now()}@example.gr`, phone: '6900000000' });
    window.dispatchEvent(new CustomEvent('customers:changed', { detail: {} }));
  });
  await expect(page.locator('[data-count]')).toHaveAttribute('data-total', String(before + 1));

  await go(page, '#/admin/products');
  const p = ACTIVE[3];
  const prow = page.locator(`tr[data-product-id="${p.id}"]`);
  await page.fill('#pl-q', p.slug);
  await expect(prow).toHaveAttribute('data-status', 'active');
  await page.evaluate(async (id) => (await import('/assets/js/services/product-admin.js')).archiveProduct(id), p.id);
  await expect(prow).toHaveAttribute('data-status', 'archived');

  // leave the admin: every list listener is gone (none added per visit either)
  for (const h of ['#/admin/orders', '#/admin/customers', '#/admin/promotions', '#/admin/products', '#/admin/orders', '#/']) await go(page, h);
  const after = await page.evaluate(() => ['orders:changed', 'coupons:changed', 'catalog:changed', 'customers:changed'].map((t) => window.__listeners(t)));
  expect(after).toEqual(base);
});

test('an already-seeded database drops the removed boots photo on the next load', async ({ page }) => {
  await open(page, '#/');
  await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    const p = await db.get('products', 's-combat-boots-black');
    await db.put('products', { ...p, images: [...p.images, 'assets/images/products/s-combat-boots-black-2.webp'] });
  });
  await page.reload();
  await settle(page);
  await expect.poll(() => page.evaluate(async () => (await (await import('/assets/js/db.js')).get('products', 's-combat-boots-black')).images))
    .toEqual(['assets/images/products/s-combat-boots-black-1.webp']);
});
