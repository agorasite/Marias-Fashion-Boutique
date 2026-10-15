const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/products.json'), 'utf8')).products;
const active = seed.filter((p) => p.status !== 'archived');

const CARD = '.product-card[data-product-id]';
const SIDEBAR = '#filtersSidebar';
const OFFCANVAS = '#filtersOffcanvas';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function open(page, hash = '#/catalog') {
  await page.goto(`/${hash}`);
  await expect(page.locator(CARD).first()).toBeVisible();
}

const ids = (page) => page.$$eval(CARD, (els) => els.map((e) => e.dataset.productId));
const prices = (page) => page.$$eval(CARD, (els) => els.map((e) => Number(e.dataset.price)));
const priceTexts = (page) => page.$$eval(`${CARD} .product-card-price .price > span:first-child`, (els) => els.map((e) => e.textContent));
const parseEuro = (t) => Math.round(parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.')) * 100);

const expectedIds = (pred) => active.filter(pred).map((p) => p.id).sort();
const hasVariant = (p, fn) => p.variants.some(fn);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('category nav from header, subcategory pills and breadcrumbs', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await expect(page.locator('h1')).toHaveText('Όλα τα προϊόντα');
  await page.locator('.header-nav a[href="#/catalog/women"]').click();
  await expect(page).toHaveURL(/#\/catalog\/women$/);
  await expect(page.locator('h1')).toHaveText('Γυναικεία');
  await expect.poll(async () => (await ids(page)).sort()).toEqual(expectedIds((p) => p.categoryId === 'women'));
  await page.locator('.catalog-pill', { hasText: 'Φορέματα' }).click();
  await expect(page).toHaveURL(/#\/catalog\/women\?sub=dresses$/);
  await expect.poll(async () => (await ids(page)).sort()).toEqual(expectedIds((p) => p.subcategoryId === 'dresses'));
  await expect(page.locator('[data-chips] .filter-chip', { hasText: 'Φορέματα' })).toHaveCount(1);
  await expect(page.locator('.breadcrumb')).toContainText('Γυναικεία');
  expect(errors).toEqual([]);
});

test('instant search "φορεμα" finds dresses (accent-insensitive)', async ({ page }) => {
  await open(page);
  await page.locator('#catalogSearch').fill('φορεμα');
  await expect(page.locator('[data-count]')).not.toHaveText(/^39 /);
  const got = await ids(page);
  expect(got.length).toBeGreaterThanOrEqual(4);
  for (const id of seed.filter((p) => p.subcategoryId === 'dresses').map((p) => p.id)) expect(got).toContain(id);
  await expect(page).toHaveURL(/q=%CF%86%CE%BF%CF%81%CE%B5%CE%BC%CE%B1|q=φορεμα/);
  await expect(page.locator('[data-count]')).toContainText(`${got.length} προϊόντα`);
});

test('price range filter', async ({ page }) => {
  await open(page);
  const side = page.locator(SIDEBAR);
  await side.locator('[data-f-min]').fill('90');
  await side.locator('[data-f-max]').fill('130');
  await side.locator('[data-f-max]').press('Tab');
  await expect.poll(async () => (await ids(page)).sort()).toEqual(expectedIds((p) => p.priceCents >= 9000 && p.priceCents <= 13000));
  const ps = await prices(page);
  expect(ps.length).toBeGreaterThan(0);
  for (const p of ps) { expect(p).toBeGreaterThanOrEqual(9000); expect(p).toBeLessThanOrEqual(13000); }
  await expect(page).toHaveURL(/min=90/);
  await expect(page).toHaveURL(/max=130/);
  await expect(page.locator('[data-chips] .filter-chip').first()).toContainText('Τιμή');
});

test('size, color, brand and availability filters match the data', async ({ page }) => {
  await open(page, '#/catalog/women');
  const side = page.locator(SIDEBAR);
  await side.locator('[data-f-size="M"]').click();
  await expect.poll(async () => (await ids(page)).sort()).toEqual(expectedIds((p) => p.categoryId === 'women' && hasVariant(p, (v) => v.size === 'M')));
  // size + color: same variant
  const colorsM = [...new Set(active.filter((p) => p.categoryId === 'women').flatMap((p) => p.variants.filter((v) => v.size === 'M').map((v) => v.color)))];
  const color = colorsM[0];
  await side.locator(`[data-f-color="${color}"]`).click();
  await expect.poll(async () => (await ids(page)).sort()).toEqual(
    expectedIds((p) => p.categoryId === 'women' && hasVariant(p, (v) => v.size === 'M' && v.color === color)),
  );
  // brand
  await page.getByRole('button', { name: 'Καθαρισμός όλων' }).click();
  const brand = active.find((p) => p.categoryId === 'women').brand;
  await side.locator(`[data-f-brand="${brand}"]`).check();
  await expect.poll(async () => (await ids(page)).sort()).toEqual(expectedIds((p) => p.categoryId === 'women' && p.brand === brand));
  await expect(page).toHaveURL(/brand=/);
  // availability
  await page.locator('[data-chips] .filter-chip', { hasText: 'Μάρκα' }).click();
  await expect(side.locator('[data-f-brand]').first()).not.toBeChecked();
  await side.locator('[data-f-stock]').check();
  await expect.poll(async () => (await ids(page)).sort()).toEqual(
    expectedIds((p) => p.categoryId === 'women' && hasVariant(p, (v) => v.stock > 0)),
  );
  await expect(page).toHaveURL(/stock=1/);
});

test('accessories show «Μία διάσταση» for the ONE size', async ({ page }) => {
  await open(page, '#/catalog/accessories');
  await expect(page.locator(`${SIDEBAR} [data-f-size="ONE"]`)).toHaveText('Μία διάσταση');
  await page.locator(`${SIDEBAR} [data-f-size="ONE"]`).click();
  await expect.poll(async () => (await ids(page)).length).toBeGreaterThan(0);
});

test('mobile offcanvas filters at 390px', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '#/catalog/shoes');
  await expect(page.locator(SIDEBAR)).toBeHidden();
  await page.locator('[data-open-filters]').click();
  const oc = page.locator(OFFCANVAS);
  await expect(oc).toBeVisible();
  await oc.locator('[data-f-size="42"]').click();
  await oc.locator('[data-f-stock]').check();
  await oc.getByRole('button', { name: 'Εμφάνιση', exact: true }).click();
  await expect(oc).toBeHidden();
  const want = expectedIds((p) => p.categoryId === 'shoes' && hasVariant(p, (v) => v.size === '42' && v.stock > 0));
  await expect.poll(async () => (await ids(page)).sort()).toEqual(want);
  await expect(page.locator('[data-filter-count]')).toHaveText('2');
  await expect(page).toHaveURL(/size=42/);
  expect(errors).toEqual([]);
});

test('sort orders verified from the DOM', async ({ page }) => {
  await open(page);
  const sel = page.locator('[data-sort]');
  await sel.selectOption('price-asc');
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect.poll(async () => {
    const ps = (await priceTexts(page)).map(parseEuro);
    return ps.length > 0 && ps.every((v, i) => i === 0 || ps[i - 1] <= v);
  }).toBe(true);
  const asc = (await priceTexts(page)).map(parseEuro);
  expect(asc[0]).toBe(Math.min(...active.map((p) => p.priceCents)));
  await sel.selectOption('price-desc');
  await expect.poll(async () => {
    const ps = (await priceTexts(page)).map(parseEuro);
    return ps.length > 0 && ps.every((v, i) => i === 0 || ps[i - 1] >= v);
  }).toBe(true);
  const desc = (await priceTexts(page)).map(parseEuro);
  expect(desc[0]).toBe(Math.max(...active.map((p) => p.priceCents)));
  await sel.selectOption('popular');
  await expect.poll(async () => (await ids(page))[0]).toBe([...active].sort((a, b) => b.popularity - a.popularity)[0].id);
});

test('load more increases the card count until everything is shown', async ({ page }) => {
  await open(page);
  await expect(page.locator(CARD)).toHaveCount(12);
  await page.getByRole('button', { name: 'Φόρτωσε περισσότερα' }).click();
  await expect(page.locator(CARD)).toHaveCount(24);
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole('button', { name: 'Φόρτωσε περισσότερα' }).click();
  await page.getByRole('button', { name: 'Φόρτωσε περισσότερα' }).click();
  await expect(page.locator(CARD)).toHaveCount(active.length);
  await expect(page.getByRole('button', { name: 'Φόρτωσε περισσότερα' })).toBeHidden();
  // reload restores the same number of cards
  await page.reload();
  await expect(page.locator(CARD)).toHaveCount(active.length);
});

test('quick view opens, links to the product page and closes with Escape', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  const card = page.locator(CARD).first();
  const slug = await card.getAttribute('data-slug');
  const btn = card.locator('[data-quick]');
  await btn.click();
  const dlg = page.locator('[data-quick-view]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('a[data-qv-link]')).toHaveAttribute('href', `#/product/${slug}`);
  await expect(dlg.locator('a[data-qv-link]')).toHaveText('Δες το προϊόν');
  await expect(dlg.locator('img')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-quick-view]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(btn).toBeFocused();
  expect(errors).toEqual([]);
});

test('wishlist heart dispatches wishlist:toggle and reflects wishlist:changed', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__toggles = [];
    window.addEventListener('wishlist:toggle', (e) => {
      window.__toggles.push(e.detail.productId);
      window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { productId: e.detail.productId, active: true } }));
    });
  });
  const card = page.locator(CARD).first();
  const id = await card.getAttribute('data-product-id');
  const heart = card.locator('[data-wish]');
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__toggles)).toEqual([id]);
});

test('heart does not throw without a wishlist listener', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await page.locator(`${CARD} [data-wish]`).first().click();
  await expect(page.locator(`${CARD} [data-wish]`).first()).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('empty state with reset button', async ({ page }) => {
  await open(page);
  await page.locator('#catalogSearch').fill('zzzzzqqq');
  await expect(page.locator('[data-empty-state]')).toBeVisible();
  await expect(page.locator('[data-empty-state]')).toContainText('Δεν βρέθηκαν προϊόντα');
  await expect(page.locator(CARD)).toHaveCount(0);
  await page.locator('[data-empty-state] [data-reset]').click();
  await expect(page.locator(CARD)).toHaveCount(12);
  await expect(page.locator('#catalogSearch')).toHaveValue('');
  await expect(page).toHaveURL(/#\/catalog$/);
});

test('filter state lives in the URL: reload and back/forward', async ({ page }) => {
  await open(page, '#/catalog/men');
  const side = page.locator(SIDEBAR);
  await side.locator('[data-f-size="L"]').click();
  await expect(page).toHaveURL(/size=L/);
  await page.locator('[data-sort]').selectOption('price-desc');
  await expect(page).toHaveURL(/sort=price-desc/);
  const after = await ids(page);
  await page.reload();
  await expect(page.locator(CARD).first()).toBeVisible();
  await expect(page.locator(`${SIDEBAR} [data-f-size="L"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-sort]')).toHaveValue('price-desc');
  expect(await ids(page)).toEqual(after);
  await page.goBack();
  await expect(page).toHaveURL(/size=L$/);
  await expect(page.locator('[data-sort]')).toHaveValue('newest');
  await expect(page.locator(`${SIDEBAR} [data-f-size="L"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/#\/catalog\/men$/);
  await expect(page.locator(`${SIDEBAR} [data-f-size="L"]`)).toHaveAttribute('aria-pressed', 'false');
  await page.goForward();
  await expect(page).toHaveURL(/size=L$/);
  await expect(page.locator(`${SIDEBAR} [data-f-size="L"]`)).toHaveAttribute('aria-pressed', 'true');
});

test('no horizontal overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const hash of ['#/catalog', '#/catalog/women?sub=dresses', '#/catalog?q=zzzz']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('#app h1')).toBeVisible();
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, hash).toBeLessThanOrEqual(0);
  }
});

test('product images load', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  const n = await page.locator(`${CARD} img`).count();
  expect(n).toBe(12);
  for (let i = 0; i < n; i += 1) {
    const img = page.locator(`${CARD} img`).nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  expect(await page.locator('.product-card-fallback').count()).toBe(0);
  expect(errors).toEqual([]);
});
