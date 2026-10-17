const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const active = products.filter((p) => p.status !== 'archived');
const stocked = (p, min) => p.variants.find((v) => v.stock >= min && !v.archived);
const [P1, P2] = active.filter((p) => stocked(p, 5)).slice(0, 2);
const SKU1 = stocked(P1, 5).sku;
const SKU2 = stocked(P2, 5).sku;
const PRICE1 = P1.priceCents;
const PRICE2 = P2.priceCents;

const VIEW = '[data-admin-view="promotions"]';
const MODAL = '[data-coupon-modal]';
const norm = (s) => String(s).replace(/\s/g, ' ');
const money = (c) => norm(new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100));
const comma = (cents) => (cents / 100).toFixed(2).replace('.', ',');

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const dbGet = (page, store, key) => page.evaluate(async ([s, k]) => (await import('/assets/js/db.js')).get(s, k), [store, key]);
const dbPut = (page, store, val) => page.evaluate(async ([s, v]) => (await import('/assets/js/db.js')).put(s, v), [store, val]);

async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}
async function openPromos(page) {
  await page.goto('/#/admin/promotions');
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-coupons-table]')).toBeVisible();
}
const row = (page, code) => page.locator(`tr[data-coupon-code="${code}"]`);
const field = (page, key) => page.locator(`${MODAL} [data-field="${key}"]`);

/** Open the dialog, fill it and press save. Resolves once the dialog is closed (valid) or still open (errors). */
async function fillCoupon(page, v, { edit = false } = {}) {
  if (!edit) await page.locator('[data-new-coupon]').first().click();
  await expect(page.locator(`${MODAL}.show`)).toBeVisible();
  // `.show` is set when the fade STARTS; at its end Bootstrap and the dialog move focus to the first field.
  // Typing before that would have the later focus move steal keystrokes, so wait for the settled focus.
  await expect.poll(() => page.evaluate((m) => !!document.activeElement?.matches(`${m} [data-field]`), MODAL)).toBe(true);
  if (v.code !== undefined) await field(page, 'code').fill(v.code);
  if (v.type !== undefined) await field(page, 'type').selectOption(v.type);
  if (v.value !== undefined) await field(page, 'value').fill(String(v.value));
  if (v.minSubtotal !== undefined) await field(page, 'minSubtotal').fill(String(v.minSubtotal));
  if (v.expiresOn !== undefined) await field(page, 'expiresOn').fill(v.expiresOn);
  if (v.maxUses !== undefined) await field(page, 'maxUses').fill(String(v.maxUses));
  if (v.active !== undefined) await field(page, 'active').setChecked(v.active);
}
async function saveCouponDialog(page) {
  await page.locator(`${MODAL} [data-save]`).click();
}
async function createCoupon(page, v) {
  await fillCoupon(page, v);
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(row(page, String(v.code).trim().toUpperCase())).toBeVisible();
}

async function addToCart(page, lines) {
  await page.evaluate(async (ls) => {
    const cart = await import('/assets/js/services/cart.js');
    for (const [sku, qty] of ls) await cart.addLine(sku, qty);
  }, lines);
}
async function openCart(page) {
  await page.goto('/#/cart');
  await expect(page.locator('h1')).toHaveText('Καλάθι αγορών');
  await expect(page.locator('[data-cart-body]')).not.toHaveAttribute('aria-busy', 'true');
}
async function applyInCart(page, code) {
  await page.locator('[data-coupon-input]').fill(code);
  await page.locator('[data-coupon-apply]').click();
}
let seq = 0;
async function checkoutWithCoupon(page, code, { lines = [[SKU1, 1]] } = {}) {
  seq += 1;
  return page.evaluate(async (a) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    for (const [sku, qty] of a.lines) await cart.addLine(sku, qty);
    const r = await cart.applyCoupon(a.code);
    if (!r.ok) return { couponRejected: r.reason };
    return co.placeOrder({
      form: { firstName: 'Κλαίρη', lastName: 'Κουπόνη', email: `clairy.${Date.now()}.${a.n}@example.gr`, phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'cod', requestId: `r-${Math.random()}`,
    });
  }, { lines, code, n: seq });
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

test('fixtures', () => {
  expect(SKU1).toBeTruthy();
  expect(SKU2).toBeTruthy();
  expect(P1.id).not.toBe(P2.id);
});

test('the promotions list shows the seeded coupons with discount, min spend, expiry, usage and status', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await expect(page.locator('[data-placeholder], .admin-soon')).toHaveCount(0);
  await expect(page.locator('[data-count]')).toHaveAttribute('data-total', '4');
  const w10 = row(page, 'WELCOME10');
  await expect(w10.locator('[data-cell="discount"]')).toContainText('10%');
  await expect(w10.locator('[data-cell="min"]')).toContainText(money(3000));
  await expect(w10.locator('[data-cell="expires"]')).toHaveText('Χωρίς λήξη');
  await expect(w10.locator('[data-cell="usage"]')).toHaveText(/^\d+ \/ ∞$/);
  await expect(w10).toHaveAttribute('data-status', 'active');
  await expect(row(page, 'MARIAS5').locator('[data-cell="discount"]')).toContainText(money(500));
  await expect(row(page, 'SUMMER20')).toHaveAttribute('data-status', 'expired');
  await expect(row(page, 'SUMMER20').locator('[data-status-badge]')).toHaveText('Έληξε');
  await expect(row(page, 'SUMMER20').locator('[data-cell="expires"] time')).toBeVisible();
  await expect(row(page, 'VIP15')).toHaveAttribute('data-status', 'inactive');
  await expect(row(page, 'VIP15').locator('[data-cell="usage"]')).toHaveText('0 / 50');
  await expect(row(page, 'VIP15').locator('[data-action="toggle"]')).toHaveAttribute('aria-checked', 'false');
  await expect(w10.locator('[data-action="toggle"]')).toHaveAttribute('aria-checked', 'true');
  // the stored usage from the sample orders is what the list shows
  const stored = await dbGet(page, 'coupons', 'WELCOME10');
  await expect(w10.locator('[data-cell="usage"]')).toHaveText(`${stored.usedCount} / ∞`);
  expect(errors).toEqual([]);
});

test('a percent coupon created in admin applies in the storefront cart with the exact discount (case-insensitive)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  // live preview on the sample cart of 100 € is computed by pricing
  await page.locator('[data-new-coupon]').first().click();
  await expect(page.locator(`${MODAL}.show`)).toBeVisible();
  await expect(field(page, 'code')).toBeFocused(); // the dialog has settled (see fillCoupon)
  await field(page, 'value').fill('17');
  await expect(page.locator(`${MODAL} [data-preview-discount]`)).toHaveText(money(1700));
  await expect(page.locator(`${MODAL} [data-preview]`)).toContainText('σε καλάθι');
  await field(page, 'type').selectOption('fixed');
  await field(page, 'value').fill('7,5');
  await expect(page.locator(`${MODAL} [data-preview-discount]`)).toHaveText(money(750));
  await field(page, 'type').selectOption('percent');
  await field(page, 'value').fill('17');
  await field(page, 'code').fill('  pct17 ');
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(page.locator('.toast-elan').last()).toContainText('PCT17');
  const r = row(page, 'PCT17');
  await expect(r.locator('[data-cell="discount"]')).toContainText('17%');
  await expect(r.locator('[data-cell="usage"]')).toHaveText('0 / ∞');
  await expect(r).toHaveAttribute('data-status', 'active');
  expect(await dbGet(page, 'coupons', 'PCT17')).toMatchObject({ code: 'PCT17', type: 'percent', value: 17, minSubtotalCents: 0, expiresAt: null, maxUses: null, usedCount: 0, active: true });

  await addToCart(page, [[SKU1, 2], [SKU2, 1]]);
  const sub = PRICE1 * 2 + PRICE2;
  const expected = Math.round((sub * 17) / 100); // independent of pricing.js
  await openCart(page);
  await applyInCart(page, 'pct17');
  await expect(page.locator('[data-coupon-applied]')).toContainText('PCT17');
  await expect(page.locator('[data-sum-subtotal]')).toHaveText(money(sub));
  await expect(page.locator('[data-sum-discount]')).toHaveText(`−${money(expected)}`);
  expect(errors).toEqual([]);
});

test('a fixed coupon typed with a comma decimal («7,50») is stored as 750 cents and discounts exactly 7,50 €', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await createCoupon(page, { code: 'FIX750', type: 'fixed', value: '7,50' });
  expect((await dbGet(page, 'coupons', 'FIX750')).value).toBe(750);
  await expect(row(page, 'FIX750').locator('[data-cell="discount"]')).toContainText(money(750));
  await createCoupon(page, { code: 'FIXDOT', type: 'fixed', value: '3.2', minSubtotal: '20,5' });
  expect(await dbGet(page, 'coupons', 'FIXDOT')).toMatchObject({ value: 320, minSubtotalCents: 2050 });
  await addToCart(page, [[SKU1, 1]]);
  await openCart(page);
  await applyInCart(page, 'FIX750');
  await expect(page.locator('[data-sum-discount]')).toHaveText(`−${money(750)}`);
  expect(errors).toEqual([]);
});

test('deactivating a coupon rejects it in the cart (existing Greek message); reactivating accepts it again', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await createCoupon(page, { code: 'TOGGLE5', type: 'percent', value: 5 });
  await addToCart(page, [[SKU1, 1]]);
  await openCart(page);
  await applyInCart(page, 'TOGGLE5');
  await expect(page.locator('[data-coupon-applied]')).toContainText('TOGGLE5');

  await openPromos(page);
  const sw = row(page, 'TOGGLE5').locator('[data-action="toggle"]');
  await sw.click();
  await expect(row(page, 'TOGGLE5')).toHaveAttribute('data-status', 'inactive');
  await expect(row(page, 'TOGGLE5').locator('[data-status-badge]')).toHaveText('Ανενεργό');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect((await dbGet(page, 'coupons', 'TOGGLE5')).active).toBe(false);

  // already applied in the cart: the warning shows and no discount is taken
  await openCart(page);
  await expect(page.locator('[data-coupon-warning]')).toContainText('Ο κωδικός δεν είναι ενεργός.');
  await expect(page.locator('[data-sum-discount]')).toHaveCount(0);
  await page.locator('[data-coupon-remove]').first().click();
  await expect(page.locator('[data-coupon-warning]')).toHaveCount(0);
  await applyInCart(page, 'TOGGLE5');
  await expect(page.locator('[data-coupon-msg]')).toContainText('Ο κωδικός δεν είναι ενεργός.');
  await expect(page.locator('[data-coupon-applied]')).toHaveCount(0);

  await openPromos(page);
  await row(page, 'TOGGLE5').locator('[data-action="toggle"]').click();
  await expect(row(page, 'TOGGLE5')).toHaveAttribute('data-status', 'active');
  await openCart(page);
  await applyInCart(page, 'TOGGLE5');
  await expect(page.locator('[data-coupon-applied]')).toContainText('TOGGLE5');
  expect(errors).toEqual([]);
});

test('editing the minimum spend is enforced in the cart: rejected below, accepted above', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await createCoupon(page, { code: 'MIN10', type: 'percent', value: 10 });
  const minCents = (Math.floor(PRICE1 / 100) + 1) * 100; // just above one unit of P1
  await row(page, 'MIN10').locator('[data-action="edit"]').click();
  await expect(field(page, 'code')).toHaveAttribute('readonly', '');
  await fillCoupon(page, { minSubtotal: comma(minCents) }, { edit: true });
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(row(page, 'MIN10').locator('[data-cell="min"]')).toContainText(money(minCents));
  expect((await dbGet(page, 'coupons', 'MIN10')).minSubtotalCents).toBe(minCents);

  await addToCart(page, [[SKU1, 1]]);
  await openCart(page);
  await applyInCart(page, 'MIN10');
  await expect(page.locator('[data-coupon-msg]')).toContainText(`Ελάχιστη αξία παραγγελίας ${money(minCents)}`);
  await expect(page.locator('[data-coupon-applied]')).toHaveCount(0);
  await addToCart(page, [[SKU1, 1]]);
  await openCart(page);
  await applyInCart(page, 'MIN10');
  await expect(page.locator('[data-coupon-applied]')).toContainText('MIN10');
  await expect(page.locator('[data-sum-discount]')).toHaveText(`−${money(Math.round((PRICE1 * 2 * 10) / 100))}`);
  expect(errors).toEqual([]);
});

test('expiry: a past date is rejected at creation; a future date is stored as end of day; SUMMER20 is expired and rejected in the cart', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await fillCoupon(page, { code: 'PASTONE', type: 'percent', value: 10, expiresOn: dayOffset(-1) });
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toBeVisible();
  const input = field(page, 'expiresOn');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(`${MODAL} [data-error-for="expiresOn"]`)).toContainText('παρελθόν');
  await expect(input).toBeFocused();
  expect(await dbGet(page, 'coupons', 'PASTONE')).toBeUndefined();
  // fix the date and save
  await input.fill(dayOffset(3));
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  const stored = await dbGet(page, 'coupons', 'PASTONE');
  const end = new Date(stored.expiresAt);
  expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59]);
  expect(ymd(end)).toBe(dayOffset(3));
  await expect(row(page, 'PASTONE').locator('[data-cell="expires"] time')).toBeVisible();
  // an expired coupon: seeded SUMMER20
  await expect(row(page, 'SUMMER20')).toHaveAttribute('data-status', 'expired');
  await addToCart(page, [[SKU1, 1]]);
  await openCart(page);
  await applyInCart(page, 'SUMMER20');
  await expect(page.locator('[data-coupon-msg]')).toContainText('Ο κωδικός έχει λήξει');
  await expect(page.locator('[data-coupon-applied]')).toHaveCount(0);
  // editing the expired coupon without touching its date keeps it saveable
  await openPromos(page);
  const summerBefore = await dbGet(page, 'coupons', 'SUMMER20');
  await row(page, 'SUMMER20').locator('[data-action="edit"]').click();
  await fillCoupon(page, { value: 25 }, { edit: true });
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  expect(await dbGet(page, 'coupons', 'SUMMER20')).toMatchObject({ value: 25, expiresAt: summerBefore.expiresAt });
  await expect(row(page, 'SUMMER20')).toHaveAttribute('data-status', 'expired');
  expect(errors).toEqual([]);
});

test('usage limit: one checkout uses the coupon up, the list shows it after reload, the second use is rejected', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  const before = (await dbGet(page, 'coupons', 'WELCOME10')).usedCount;
  await createCoupon(page, { code: 'ONCE1', type: 'percent', value: 10, maxUses: 1 });
  await expect(row(page, 'ONCE1').locator('[data-cell="usage"]')).toHaveText('0 / 1');

  const order = await checkoutWithCoupon(page, 'ONCE1', { lines: [[SKU1, 1]] });
  expect(order.couponCode).toBe('ONCE1');
  expect(order.totals.discountCents).toBe(Math.round(PRICE1 * 10 / 100));
  expect((await dbGet(page, 'coupons', 'ONCE1')).usedCount).toBe(1);

  await page.reload();
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  await expect(row(page, 'ONCE1').locator('[data-cell="usage"]')).toHaveText('1 / 1');
  await expect(row(page, 'ONCE1')).toHaveAttribute('data-status', 'exhausted');
  await expect(row(page, 'ONCE1').locator('[data-status-badge]')).toHaveText('Εξαντλήθηκε');

  await addToCart(page, [[SKU1, 1]]);
  await openCart(page);
  await applyInCart(page, 'ONCE1');
  await expect(page.locator('[data-coupon-msg]')).toContainText('εξαντλήσει τις διαθέσιμες χρήσεις');
  // an unrelated coupon is untouched
  expect((await dbGet(page, 'coupons', 'WELCOME10')).usedCount).toBe(before);

  // the limit can never go below the usage that already happened
  await openPromos(page);
  await row(page, 'ONCE1').locator('[data-action="edit"]').click();
  await fillCoupon(page, { maxUses: 0 }, { edit: true });
  await saveCouponDialog(page);
  await expect(page.locator(`${MODAL} [data-error-for="maxUses"]`)).not.toBeEmpty();
  await fillCoupon(page, { maxUses: 3 }, { edit: true });
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(row(page, 'ONCE1').locator('[data-cell="usage"]')).toHaveText('1 / 3');
  await expect(row(page, 'ONCE1')).toHaveAttribute('data-status', 'active');
  expect(errors).toEqual([]);
});

test('a limit of usedCount + 1 allows exactly one more checkout', async ({ page }) => {
  await boot(page);
  const w = await dbGet(page, 'coupons', 'MARIAS5');
  await openPromos(page);
  await row(page, 'MARIAS5').locator('[data-action="edit"]').click();
  await fillCoupon(page, { maxUses: w.usedCount + 1, minSubtotal: '' }, { edit: true });
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(row(page, 'MARIAS5').locator('[data-cell="usage"]')).toHaveText(`${w.usedCount} / ${w.usedCount + 1}`);
  const first = await checkoutWithCoupon(page, 'MARIAS5', { lines: [[SKU1, 1]] });
  expect(first.couponCode).toBe('MARIAS5');
  const second = await checkoutWithCoupon(page, 'MARIAS5', { lines: [[SKU1, 1]] });
  expect(second).toEqual({ couponRejected: 'max-uses' });
  await page.reload();
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  await expect(row(page, 'MARIAS5')).toHaveAttribute('data-status', 'exhausted');
});

test('code validation: duplicates (any case/whitespace), bad characters and length are rejected with aria wiring', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await fillCoupon(page, { code: ' welcome10 ', type: 'percent', value: 10 });
  await saveCouponDialog(page);
  const code = field(page, 'code');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(`${MODAL} [data-error-for="code"]`)).toContainText('υπάρχει ήδη');
  await expect(code).toHaveAttribute('aria-describedby', /err/);
  await expect(code).toBeFocused();
  expect((await page.evaluate(async () => (await import('/assets/js/db.js')).getAll('coupons'))).length).toBe(4);
  for (const bad of ['AB', 'HAS SPACE', 'ΕΛΛΗΝΙΚΑ', 'A'.repeat(21), 'BAD!']) {
    await code.fill(bad);
    await saveCouponDialog(page);
    await expect(code, bad).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(MODAL)).toBeVisible();
  }
  // value errors show next to the value and focus moves to the first invalid field
  await code.fill('GOOD1');
  await field(page, 'value').fill('0');
  await saveCouponDialog(page);
  await expect(field(page, 'value')).toHaveAttribute('aria-invalid', 'true');
  await expect(field(page, 'value')).toBeFocused();
  await expect(page.locator(`${MODAL} [data-error-for="value"]`)).toContainText('1 έως 100');
  await field(page, 'value').fill('100');
  await saveCouponDialog(page);
  await expect(page.locator(MODAL)).toHaveCount(0);
  await createCoupon(page, { code: 'good2', type: 'percent', value: 5 });
  // a second creation with the same code in a different case is refused
  await fillCoupon(page, { code: 'GOOD2', type: 'percent', value: 5 });
  await saveCouponDialog(page);
  await expect(page.locator(`${MODAL} [data-error-for="code"]`)).toContainText('υπάρχει ήδη');
  await page.keyboard.press('Escape');
  await expect(page.locator(MODAL)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('delete: an unused coupon is removed after confirmation; a used coupon cannot be deleted and the deactivate offer is shown', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await createCoupon(page, { code: 'DEL1', type: 'percent', value: 5 });
  // Escape cancels the confirmation
  await row(page, 'DEL1').locator('[data-action="delete"]').click();
  await expect(page.locator('.modal.show')).toContainText('Διαγραφή κουπονιού');
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(row(page, 'DEL1')).toBeVisible();
  // confirm
  await row(page, 'DEL1').locator('[data-action="delete"]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(row(page, 'DEL1')).toHaveCount(0);
  expect(await dbGet(page, 'coupons', 'DEL1')).toBeUndefined();

  // used (usedCount > 0)
  await row(page, 'WELCOME10').locator('[data-action="delete"]').click();
  const dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('δεν μπορεί να διαγραφεί');
  await expect(dlg.locator('[data-ok]')).toHaveText('Απενεργοποίηση');
  await dlg.locator('[data-bs-dismiss="modal"]').last().click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect((await dbGet(page, 'coupons', 'WELCOME10')).active).toBe(true);
  await row(page, 'WELCOME10').locator('[data-action="delete"]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(row(page, 'WELCOME10')).toHaveAttribute('data-status', 'inactive');
  expect(await dbGet(page, 'coupons', 'WELCOME10')).toMatchObject({ active: false });

  // unused but referenced by an order: refused by the service, then the same offer
  await createCoupon(page, { code: 'REFD', type: 'percent', value: 5 });
  const anyOrder = await page.evaluate(async () => (await import('/assets/js/db.js')).getAll('orders').then((o) => o[0]));
  await dbPut(page, 'orders', { ...anyOrder, id: 'MARIAS-20260101-ZZZ1', couponCode: 'REFD' });
  const refused = await page.evaluate(async () => (await import('/assets/js/services/coupons.js')).deleteCoupon('REFD'));
  expect(refused).toEqual({ deleted: false, reason: 'used' });
  await row(page, 'REFD').locator('[data-action="delete"]').click();
  await page.locator('.modal.show [data-ok]').click(); // confirm the destructive dialog
  await expect(page.locator('.modal.show')).toContainText('δεν μπορεί να διαγραφεί');
  await page.locator('.modal.show [data-ok]').click(); // offered: deactivate
  await expect(row(page, 'REFD')).toHaveAttribute('data-status', 'inactive');
  expect(await dbGet(page, 'coupons', 'REFD')).toBeTruthy();
  expect(errors).toEqual([]);
});

test('usedCount cannot be altered through the form or by tampering with saveCoupon', async ({ page }) => {
  await boot(page);
  const before = await dbGet(page, 'coupons', 'WELCOME10');
  expect(before.usedCount).toBeGreaterThan(0);
  const r = await page.evaluate(async (b) => {
    const m = await import('/assets/js/services/coupons.js');
    const edit = await m.saveCoupon({ editingCode: 'WELCOME10', code: 'WELCOME10', type: 'percent', value: '12', minSubtotal: '30', usedCount: 0, maxUses: '' });
    const create = await m.saveCoupon({ code: 'TAMPER1', type: 'percent', value: '5', usedCount: 99 });
    let rename = null;
    try { await m.saveCoupon({ editingCode: 'WELCOME10', code: 'RENAMED', type: 'percent', value: '12' }); } catch (e) { rename = e.errors; }
    let dup = null;
    try { await m.saveCoupon({ code: 'welcome10', type: 'percent', value: '12', usedCount: 0 }); } catch (e) { dup = e.errors; }
    return { edit, create, rename, dup, b };
  }, before);
  expect(r.edit.usedCount).toBe(before.usedCount);
  expect(r.edit.value).toBe(12);
  expect(r.create.usedCount).toBe(0);
  expect(r.rename.code).toBeTruthy();
  expect(r.dup.code).toContain('υπάρχει ήδη');
  expect((await dbGet(page, 'coupons', 'WELCOME10')).usedCount).toBe(before.usedCount);
  expect(await dbGet(page, 'coupons', 'RENAMED')).toBeUndefined();
  // the form has no usedCount control at all
  await openPromos(page);
  await row(page, 'WELCOME10').locator('[data-action="edit"]').click();
  await expect(page.locator(`${MODAL}.show`)).toBeVisible();
  await expect(page.locator(`${MODAL} [name="usedCount"], ${MODAL} [data-field="usedCount"]`)).toHaveCount(0);
  await expect(field(page, 'maxUses')).toBeVisible();
});

test('search by code and status filter, with a count, an empty state and clear filters', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  await page.fill('#cl-q', 'wel');
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', '1');
  await expect(page.locator('tr[data-coupon-code]')).toHaveCount(1);
  await page.fill('#cl-q', '  elan5 ');
  await expect(page.locator('tr[data-coupon-code]')).toHaveCount(1);
  await page.fill('#cl-q', '');
  await expect(page.locator('tr[data-coupon-code]')).toHaveCount(4);
  await page.selectOption('#cl-status', 'expired');
  await expect(page.locator('tr[data-coupon-code]')).toHaveCount(1);
  await expect(row(page, 'SUMMER20')).toBeVisible();
  await page.selectOption('#cl-status', 'inactive');
  await expect(row(page, 'VIP15')).toBeVisible();
  await expect(page.locator('tr[data-coupon-code]')).toHaveCount(1);
  await page.selectOption('#cl-status', 'exhausted');
  await expect(page.locator('[data-empty]')).toBeVisible();
  await page.locator('[data-clear-filters]').click();
  await expect(page.locator('tr[data-coupon-code]')).toHaveCount(4);
  await expect(page.locator('#cl-status')).toHaveValue('');
  await page.selectOption('#cl-status', 'active');
  await page.fill('#cl-q', 'vip');
  await expect(page.locator('[data-empty]')).toBeVisible(); // VIP15 is inactive
  expect(errors).toEqual([]);
});

test('keyboard: the dialog opens from the keyboard, focus is trapped, Escape closes and returns focus', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openPromos(page);
  const newBtn = page.locator('[data-new-coupon]').first();
  await newBtn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`${MODAL}.show`)).toBeVisible();
  await expect(field(page, 'code')).toBeFocused();
  await expect(page.locator(MODAL)).toHaveAttribute('aria-labelledby', /title/);
  // Tab never leaves the dialog
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate((s) => document.querySelector(s).contains(document.activeElement), MODAL)).toBe(true);
  }
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate((s) => document.querySelector(s).contains(document.activeElement), MODAL)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(newBtn).toBeFocused();
  // submit with Enter from a field
  await newBtn.press('Enter');
  await field(page, 'code').fill('KEYB5');
  await field(page, 'value').fill('5');
  await field(page, 'value').press('Enter');
  await expect(page.locator(MODAL)).toHaveCount(0);
  await expect(row(page, 'KEYB5')).toBeVisible();
  // the switch is operable by keyboard
  const sw = row(page, 'KEYB5').locator('[data-action="toggle"]');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(row(page, 'KEYB5')).toHaveAttribute('data-status', 'inactive');
  await expect(row(page, 'KEYB5').locator('[data-action="toggle"]')).toBeFocused();
  expect(errors).toEqual([]);
});

test('no horizontal overflow on the list and the dialog at 320/390/768/1440', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openPromos(page);
    expect(await overflow(page), `list ${width}`).toBeLessThanOrEqual(0);
    await page.locator('[data-new-coupon]').first().click();
    await expect(page.locator(`${MODAL}.show`)).toBeVisible();
    await expect(field(page, 'code')).toBeFocused(); // the dialog has settled (see fillCoupon)
    await field(page, 'value').fill('0');
    await saveCouponDialog(page); // shows the errors
    expect(await overflow(page), `dialog ${width}`).toBeLessThanOrEqual(0);
    const box = await page.locator(`${MODAL} .modal-content`).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
