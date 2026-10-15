const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog-meta.json'), 'utf8'));
const S = meta.settings;
const THRESHOLD = S.freeShippingThresholdCents;

const ok = (p) => p.status !== 'archived';
const stocked = (p, min = 1) => p.variants.find((v) => v.stock >= min);
// distinct products for each scenario
const cheap = products.find((p) => ok(p) && p.priceCents < 3000 && stocked(p));
const midA = products.find((p) => ok(p) && p.priceCents >= 3000 && p.priceCents < THRESHOLD && stocked(p) && p !== cheap);
const midB = products.find((p) => ok(p) && p.priceCents >= 3000 && p.priceCents < THRESHOLD && stocked(p) && p !== cheap && p !== midA);
const big = products.find((p) => ok(p) && p.priceCents >= THRESHOLD && stocked(p, 3));
const sale = products.find((p) => ok(p) && p.compareAtCents && stocked(p));
const oneSize = products.find((p) => ok(p) && p.variants.some((v) => v.size === 'ONE' && v.stock > 0));
// product with two variants where the second has less stock than the first line quantity
let pairProduct; let pairFrom; let pairTo; let pairQty;
for (const p of products) {
  if (!ok(p)) continue;
  for (const a of p.variants) {
    for (const b of p.variants) {
      if (a !== b && a.stock >= 3 && b.stock >= 1 && b.stock < Math.min(a.stock, 5) && !pairProduct) {
        pairProduct = p; pairFrom = a; pairTo = b; pairQty = Math.min(a.stock, 5);
      }
    }
  }
}
const sizeLabel = (s) => (s === 'ONE' ? 'Μία διάσταση' : s);

const parseEuro = (t) => Math.round(parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.')) * 100);
const cartBadge = (page) => page.locator('.header-end [data-badge="cart"]');
const wishBadge = (page) => page.locator('.header-end [data-badge="wishlist"]');

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function pricing() {
  return import(pathToFileURL(path.join(root, 'assets/js/services/pricing.js')).href);
}

async function openCart(page) {
  await page.goto('/#/cart');
  await expect(page.locator('h1')).toHaveText('Καλάθι αγορών');
  await expect(page.locator('[data-cart-body]')).not.toHaveAttribute('aria-busy', 'true');
}
async function addSku(page, sku, qty = 1) {
  return page.evaluate(async ([s, q]) => {
    const m = await import('/assets/js/services/cart.js');
    const r = await m.addLine(s, q);
    return { ok: r.ok, reason: r.reason };
  }, [sku, qty]);
}
async function dbPatch(page, store, key, patch) {
  await page.evaluate(async ([st, k, pt]) => {
    const db = await import('/assets/js/db.js');
    const rec = await db.get(st, k);
    await db.put(st, { ...rec, ...pt });
  }, [store, key, patch]);
}
async function dbGet(page, store, key) {
  return page.evaluate(async ([st, k]) => (await import('/assets/js/db.js')).get(st, k), [store, key]);
}
const line = (page, sku) => page.locator(`.cart-line[data-sku="${sku}"]`);
const total = (page) => page.locator('[data-sum-total]');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('fixtures exist', () => {
  for (const x of [cheap, midA, midB, big, sale, oneSize, pairProduct]) expect(x).toBeTruthy();
});

test('add from PDP then cart shows line with price, size and colour', async ({ page }) => {
  const errors = trackErrors(page);
  const v = big.variants.find((x) => x.stock >= 3);
  await page.goto(`/#/product/${big.slug}?color=${encodeURIComponent(v.color)}&size=${encodeURIComponent(v.size)}`);
  await expect(page.locator('[data-page="product"] h1')).toBeVisible();
  await page.locator('[data-add]').click();
  await expect(cartBadge(page)).toHaveText('1');
  await page.locator('.header-end a[href="#/cart"]').click();
  await expect(page.locator('h1')).toHaveText('Καλάθι αγορών');
  const row = line(page, v.sku);
  await expect(row).toBeVisible();
  await expect(row).toContainText(big.name);
  await expect(row.locator('[data-color]')).toHaveText(v.color);
  await expect(row.locator('[data-size]')).toHaveText(sizeLabel(v.size));
  expect(parseEuro(await row.locator('[data-unit]').innerText())).toBe(big.priceCents);
  expect(parseEuro(await row.locator('[data-line-total]').innerText())).toBe(big.priceCents);
  expect(parseEuro(await page.locator('[data-sum-subtotal]').innerText())).toBe(big.priceCents);
  await expect(page.locator('[data-continue]')).toHaveAttribute('href', '#/catalog');
  await expect(page.locator('a[data-checkout]')).toHaveAttribute('href', '#/checkout');
  expect(errors).toEqual([]);
});

test('ONE size is shown as "Μία διάσταση"', async ({ page }) => {
  const v = oneSize.variants.find((x) => x.size === 'ONE' && x.stock > 0);
  await openCart(page);
  await addSku(page, v.sku);
  await page.reload();
  await expect(line(page, v.sku).locator('[data-size]')).toHaveText('Μία διάσταση');
});

test('quantity cannot exceed stock; same SKU merges', async ({ page }) => {
  const v = pairProduct.variants.find((x) => x.sku === pairTo.sku);
  const stock = v.stock;
  await openCart(page);
  expect((await addSku(page, v.sku, 1)).ok).toBe(true);
  expect((await addSku(page, v.sku, 1)).ok || stock < 2).toBeTruthy();
  const expectQty = Math.min(2, stock);
  await page.reload();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(line(page, v.sku).locator('[data-qty-input]')).toHaveValue(String(expectQty));
  // push to the cap through the UI
  const row = line(page, v.sku);
  for (let q = expectQty + 1; q <= stock; q += 1) {
    await row.locator('[data-qty-plus]').click();
    await expect(row.locator('[data-qty-input]')).toHaveValue(String(q));
  }
  await expect(row.locator('[data-qty-input]')).toHaveValue(String(stock));
  await expect(row.locator('[data-qty-plus]')).toBeDisabled();
  await expect(row.locator('[data-line-msg]')).toContainText(String(stock));
  // typing a larger number is clamped
  await row.locator('[data-qty-input]').fill('99');
  await row.locator('[data-qty-input]').blur();
  await expect(row.locator('[data-qty-input]')).toHaveValue(String(stock));
  await expect(cartBadge(page)).toHaveText(String(stock));
});

test('cart and header badge persist across reload', async ({ page }) => {
  await openCart(page);
  const v = big.variants.find((x) => x.stock >= 3);
  await addSku(page, v.sku, 2);
  await page.reload();
  await expect(line(page, v.sku).locator('[data-qty-input]')).toHaveValue('2');
  await expect(cartBadge(page)).toHaveText('2');
  await page.goto('/#/');
  await page.reload();
  await expect(cartBadge(page)).toHaveText('2');
});

test('change variant keeps qty clipped to new stock', async ({ page }) => {
  await openCart(page);
  await addSku(page, pairFrom.sku, pairQty);
  await page.reload();
  const row = line(page, pairFrom.sku);
  await expect(row.locator('[data-qty-input]')).toHaveValue(String(pairQty));
  await row.locator('[data-change-variant]').click();
  await row.locator(`[data-pick-sku="${pairTo.sku}"]`).click();
  const moved = line(page, pairTo.sku);
  await expect(moved).toBeVisible();
  await expect(line(page, pairFrom.sku)).toHaveCount(0);
  await expect(moved.locator('[data-qty-input]')).toHaveValue(String(Math.min(pairQty, pairTo.stock)));
  await expect(moved.locator('[data-color]')).toHaveText(pairTo.color);
  await expect(moved.locator('[data-size]')).toHaveText(sizeLabel(pairTo.size));
});

test('changing to a variant already in the cart merges lines', async ({ page }) => {
  await openCart(page);
  await addSku(page, pairFrom.sku, 1);
  await addSku(page, pairTo.sku, 1);
  await page.reload();
  await expect(page.locator('.cart-line')).toHaveCount(2);
  await line(page, pairFrom.sku).locator('[data-change-variant]').click();
  await line(page, pairFrom.sku).locator(`[data-pick-sku="${pairTo.sku}"]`).click();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(line(page, pairTo.sku).locator('[data-qty-input]')).toHaveValue(String(Math.min(2, pairTo.stock)));
});

test('remove line and empty state', async ({ page }) => {
  await openCart(page);
  await addSku(page, big.variants.find((x) => x.stock >= 3).sku);
  await page.reload();
  await page.locator('[data-remove]').click();
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-empty] a[href="#/catalog"]')).toBeVisible();
  await expect(cartBadge(page)).toBeHidden();
});

test('empty cart shows CTA', async ({ page }) => {
  await openCart(page);
  await expect(page.locator('[data-empty]')).toContainText('άδειο');
  await page.locator('[data-empty] a').click();
  await expect(page.locator('h1')).toHaveText('Όλα τα προϊόντα');
});

test('invalid coupon messages', async ({ page }) => {
  await openCart(page);
  await addSku(page, cheap.variants.find((x) => x.stock > 0).sku);
  await page.reload();
  const apply = async (code) => {
    await page.locator('[data-coupon-input]').fill(code);
    await page.locator('[data-coupon-apply]').click();
  };
  await apply('NOPE123');
  await expect(page.locator('[data-coupon-msg]')).toContainText('Ο κωδικός δεν βρέθηκε');
  await apply('summer20');
  await expect(page.locator('[data-coupon-msg]')).toContainText('Ο κωδικός έχει λήξει');
  await apply('VIP15');
  await expect(page.locator('[data-coupon-msg]')).toContainText('δεν είναι ενεργός');
  await apply('WELCOME10');
  await expect(page.locator('[data-coupon-msg]')).toContainText('Ελάχιστη αξία παραγγελίας');
  await expect(page.locator('[data-coupon-msg]')).toContainText('30,00');
  expect((await dbGet(page, 'carts', 'local')).couponCode).toBeNull();
});

test('valid WELCOME10 reduces total by exactly 10% of subtotal', async ({ page }) => {
  const { quote } = await pricing();
  await openCart(page);
  const v = big.variants.find((x) => x.stock >= 3);
  await addSku(page, v.sku, 2);
  await page.reload();
  const sub = parseEuro(await page.locator('[data-sum-subtotal]').innerText());
  expect(sub).toBe(big.priceCents * 2);
  await page.locator('[data-coupon-input]').fill(' welcome10 ');
  await page.locator('[data-coupon-apply]').click();
  await expect(page.locator('[data-coupon-applied]')).toContainText('WELCOME10');
  const expected = quote({
    lines: [{ sku: v.sku, unitCents: big.priceCents, qty: 2 }],
    coupon: meta.coupons.find((c) => c.code === 'WELCOME10'),
    shipping: { method: 'courier' },
    payment: 'none',
    settings: S,
  });
  expect(expected.discountCents).toBe(Math.round(sub * 0.1));
  expect(parseEuro(await page.locator('[data-sum-discount]').innerText())).toBe(expected.discountCents);
  expect(parseEuro(await total(page).innerText())).toBe(expected.totalCents);
  await page.reload();
  await expect(page.locator('[data-coupon-applied]')).toContainText('WELCOME10');
  await page.locator('[data-coupon-remove]').click();
  await expect(page.locator('[data-coupon-input]')).toBeVisible();
  await expect(page.locator('[data-sum-discount]')).toHaveCount(0);
});

test('coupon that falls below its minimum shows a message and keeps the code', async ({ page }) => {
  await openCart(page);
  await addSku(page, midA.variants.find((x) => x.stock > 0).sku);
  await addSku(page, cheap.variants.find((x) => x.stock > 0).sku);
  await page.reload();
  await page.locator('[data-coupon-input]').fill('WELCOME10');
  await page.locator('[data-coupon-apply]').click();
  await expect(page.locator('[data-coupon-applied]')).toBeVisible();
  const midSku = midA.variants.find((x) => x.stock > 0).sku;
  await line(page, midSku).locator('[data-remove]').click();
  await expect(page.locator('[data-coupon-warning]')).toContainText('WELCOME10');
  await expect(page.locator('[data-coupon-warning]')).toContainText('Ελάχιστη αξία παραγγελίας');
  await expect(page.locator('[data-sum-discount]')).toHaveCount(0);
  expect((await dbGet(page, 'carts', 'local')).couponCode).toBe('WELCOME10');
});

test('free-shipping progress below and above the threshold', async ({ page }) => {
  const low = midA.variants.find((x) => x.stock > 0);
  await openCart(page);
  await addSku(page, low.sku);
  await page.reload();
  const pct = Math.floor((midA.priceCents / THRESHOLD) * 100);
  await expect(page.locator('[data-freeship-bar]')).toHaveAttribute('aria-valuenow', String(pct));
  const msg = await page.locator('[data-freeship-msg]').innerText();
  expect(msg).toContain('Σας λείπουν');
  expect(parseEuro(msg.replace('Σας λείπουν', '').replace('για δωρεάν μεταφορικά', ''))).toBe(THRESHOLD - midA.priceCents);
  expect(parseEuro(await page.locator('[data-sum-shipping]').innerText())).toBe(S.courierCents);
  // add enough to cross the threshold
  await addSku(page, midB.variants.find((x) => x.stock > 0).sku);
  await addSku(page, big.variants.find((x) => x.stock > 0).sku);
  await page.reload();
  await expect(page.locator('[data-freeship-msg]')).toContainText('Έχετε δωρεάν μεταφορικά');
  await expect(page.locator('[data-freeship-bar]')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('[data-sum-shipping]')).toHaveText('Δωρεάν');
});

test('courier / pickup toggle updates shipping and total', async ({ page }) => {
  await openCart(page);
  await addSku(page, midA.variants.find((x) => x.stock > 0).sku);
  await page.reload();
  const sub = midA.priceCents;
  expect(parseEuro(await total(page).innerText())).toBe(sub + S.courierCents);
  await page.locator('[data-ship="pickup"]').check();
  await expect(page.locator('[data-sum-shipping]')).toHaveText('Δωρεάν');
  expect(parseEuro(await total(page).innerText())).toBe(sub);
  await page.locator('[data-ship="courier"]').check();
  await expect(page.locator('[data-sum-shipping]')).not.toHaveText('Δωρεάν');
  expect(parseEuro(await page.locator('[data-sum-shipping]').innerText())).toBe(S.courierCents);
  expect(parseEuro(await total(page).innerText())).toBe(sub + S.courierCents);
  // VAT-included line is present
  await expect(page.locator('[data-sum-vat]')).toBeVisible();
});

test('stock lowered after adding shows a problem, blocks checkout, fix resolves it', async ({ page }) => {
  const v = big.variants.find((x) => x.stock >= 3);
  await openCart(page);
  await addSku(page, v.sku, 3);
  await dbPatch(page, 'variants', v.sku, { stock: 1 });
  await page.reload();
  const row = line(page, v.sku);
  await expect(row.locator('[data-problem="insufficient"]')).toBeVisible();
  await expect(page.locator('[data-cart-problems]')).toBeVisible();
  await expect(page.locator('[data-checkout]')).toBeDisabled();
  await expect(page.locator('[data-checkout-note]')).toBeVisible();
  await row.locator('[data-fix-qty]').click();
  await expect(row.locator('[data-qty-input]')).toHaveValue('1');
  await expect(row.locator('[data-problem]')).toHaveCount(0);
  await expect(page.locator('a[data-checkout]')).toBeVisible();
  await expect(page.locator('[data-cart-problems]')).toHaveCount(0);
});

test('out-of-stock line is flagged and removable', async ({ page }) => {
  const v = big.variants.find((x) => x.stock >= 1);
  await openCart(page);
  await addSku(page, v.sku, 1);
  await dbPatch(page, 'variants', v.sku, { stock: 0 });
  await page.reload();
  await expect(line(page, v.sku).locator('[data-problem="out-of-stock"]')).toBeVisible();
  await expect(page.locator('[data-checkout]')).toBeDisabled();
  await line(page, v.sku).locator('[data-remove]').click();
  await expect(page.locator('[data-empty]')).toBeVisible();
});

test('archived product line shows archived problem; addLine rejects archived', async ({ page }) => {
  const v = big.variants.find((x) => x.stock >= 1);
  await openCart(page);
  await addSku(page, v.sku, 1);
  await dbPatch(page, 'products', big.id, { status: 'archived' });
  await page.reload();
  await expect(line(page, v.sku).locator('[data-problem="archived"]')).toBeVisible();
  await expect(page.locator('[data-checkout]')).toBeDisabled();
  const r = await addSku(page, v.sku, 1);
  expect(r).toEqual({ ok: false, reason: 'archived' });
});

test('wishlist heart toggles, persists, badge and page list', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/#/catalog');
  const card = page.locator('.product-card[data-product-id]').first();
  await expect(card).toBeVisible();
  const id = await card.getAttribute('data-product-id');
  const heart = card.locator('[data-wish]');
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(wishBadge(page)).toHaveText('1');
  await page.reload();
  await expect(page.locator(`.product-card[data-product-id="${id}"] [data-wish]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(wishBadge(page)).toHaveText('1');
  await page.goto('/#/account/wishlist');
  await expect(page.locator('h1')).toHaveText('Αγαπημένα');
  const wcard = page.locator(`.product-card[data-product-id="${id}"]`);
  await expect(wcard).toBeVisible();
  await wcard.locator('[data-wish]').click();
  await expect(wcard).toHaveCount(0);
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-empty] a[href="#/catalog"]')).toBeVisible();
  await expect(wishBadge(page)).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-empty]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('no horizontal overflow at 390px with items and coupon, no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCart(page);
  await addSku(page, big.variants.find((x) => x.stock >= 3).sku, 2);
  await addSku(page, sale.variants.find((x) => x.stock > 0).sku, 1);
  await page.reload();
  for (const sel of ['[data-qty-plus]', '[data-qty-minus]', '[data-remove]', '[data-change-variant]', '[data-coupon-apply]']) {
    const b = await page.locator(sel).first().boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(43.5);
  }
  await page.locator('[data-coupon-input]').fill('WELCOME10');
  await page.locator('[data-coupon-apply]').click();
  await expect(page.locator('[data-coupon-applied]')).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
