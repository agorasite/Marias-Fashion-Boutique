const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog-meta.json'), 'utf8'));
const S = meta.settings;
const ORDER_RE = /^ELAN-\d{8}-[0-9A-Z]{4}$/;

const ok = (p) => p.status !== 'archived';
const stocked = (p, min = 1) => p.variants.find((v) => v.stock >= min);
// mid: one unit qualifies for WELCOME10 (min 30€) and stays below free shipping (60€)
const mid = products.find((p) => ok(p) && p.priceCents >= 3400 && p.priceCents < S.freeShippingThresholdCents && stocked(p, 5));
const other = products.find((p) => ok(p) && p !== mid && p.priceCents < S.freeShippingThresholdCents && stocked(p, 3));
const big = products.find((p) => ok(p) && p.priceCents >= S.freeShippingThresholdCents && stocked(p, 3));

const parseEuro = (t) => Math.round(parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.')) * 100);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('[data-route="/"]')).toBeVisible();
}
async function addSku(page, sku, qty = 1) {
  return page.evaluate(async ([s, q]) => (await import('/assets/js/services/cart.js')).addLine(s, q).then((r) => r.ok), [sku, qty]);
}
async function applyCoupon(page, code) {
  return page.evaluate(async (c) => (await import('/assets/js/services/cart.js')).applyCoupon(c).then((r) => r.ok), code);
}
async function dbPatch(page, store, key, patch) {
  await page.evaluate(async ([st, k, pt]) => {
    const db = await import('/assets/js/db.js');
    const rec = await db.get(st, k);
    await db.put(st, { ...rec, ...pt });
  }, [store, key, patch]);
}
const dbGet = (page, store, key) => page.evaluate(async ([st, k]) => (await import('/assets/js/db.js')).get(st, k), [store, key]);
const dbAll = (page, store) => page.evaluate(async (st) => (await import('/assets/js/db.js')).getAll(st), store);
const stockMap = async (page) => Object.fromEntries((await dbAll(page, 'variants')).map((v) => [v.sku, v.stock]));

async function openCheckout(page) {
  await page.goto('/#/checkout');
  await expect(page.locator('[data-page="checkout"] h1')).toHaveText('Ολοκλήρωση παραγγελίας');
  await expect(page.locator('[data-checkout-body]')).not.toHaveAttribute('aria-busy', 'true');
}

const DETAILS = {
  firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.gr', phone: '691 234 5678',
  address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563',
};
async function fillForm(page, over = {}) {
  const d = { ...DETAILS, ...over };
  for (const k of Object.keys(DETAILS)) await page.fill(`#co-${k}`, d[k]);
  await page.selectOption('#co-region', d.region || 'Αττική');
  await page.check('#co-acceptTerms');
}
const submit = (page) => page.locator('[data-place-order]');

/** Independent pricing math (VAT-inclusive prices, integer cents). */
function expected({ sub, percent = 0, ship = 'courier', pay = 'cod' }) {
  const disc = Math.round(sub * percent / 100);
  const after = sub - disc;
  const shipping = ship === 'courier' && after < S.freeShippingThresholdCents ? S.courierCents : 0;
  const cod = pay === 'cod' ? S.codFeeCents : 0;
  const total = after + shipping + cod;
  return { disc, shipping, cod, total, vat: total - Math.round(total / (1 + S.vatRate)) };
}
async function readSummary(page) {
  const val = async (sel) => {
    const l = page.locator(sel);
    return (await l.count()) ? parseEuro(await l.innerText()) : 0;
  };
  return {
    sub: await val('[data-sum-subtotal]'), disc: await val('[data-sum-discount]'), shipping: await val('[data-sum-shipping]'),
    cod: await val('[data-sum-cod]'), total: await val('[data-sum-total]'), vat: await val('[data-sum-vat]'),
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('fixtures exist', () => {
  for (const x of [mid, other, big]) expect(x).toBeTruthy();
});

test('direct navigation with an empty cart refuses checkout', async ({ page }) => {
  const errors = trackErrors(page);
  await openCheckout(page);
  const r = page.locator('[data-checkout-refusal="empty"]');
  await expect(r).toBeVisible();
  await expect(r.locator('a[href="#/cart"], a[href="#/catalog"]').first()).toBeVisible();
  await expect(page.locator('[data-checkout-form]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('direct navigation with problem lines refuses checkout and links to the cart', async ({ page }) => {
  await boot(page);
  const v = stocked(mid, 5);
  const w = stocked(other, 3);
  await addSku(page, v.sku, 2);
  await addSku(page, w.sku, 1);
  await dbPatch(page, 'variants', v.sku, { stock: 1 }); // insufficient
  await openCheckout(page);
  await expect(page.locator('[data-checkout-refusal="problems"]')).toBeVisible();
  await expect(page.locator('[data-checkout-refusal="problems"] a[href="#/cart"]')).toBeVisible();
  await expect(page.locator('[data-checkout-form]')).toHaveCount(0);
  // archived product is also a problem
  await dbPatch(page, 'variants', v.sku, { stock: 9 });
  await dbPatch(page, 'products', other.id, { status: 'archived' });
  await openCheckout(page);
  await expect(page.locator('[data-checkout-refusal="problems"]')).toBeVisible();
  // and placeOrder itself refuses
  const code = await page.evaluate(async () => {
    const m = await import('/assets/js/services/checkout.js');
    try {
      await m.placeOrder({
        form: { firstName: 'Μα', lastName: 'Πα', email: 'a@b.gr', phone: '6912345678', address: 'Οδός 1', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
        shippingMethod: 'courier', paymentMethod: 'cod', requestId: 'r-problems',
      });
      return 'no-error';
    } catch (e) { return e.code; }
  });
  expect(code).toBe('PROBLEMS');
  expect(await dbAll(page, 'orders')).toEqual([]);
});

test('per-field validation messages, error summary and accessible attributes', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await addSku(page, stocked(mid, 5).sku, 1);
  await openCheckout(page);
  await submit(page).click();
  const summary = page.locator('[data-error-summary]');
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  for (const f of ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'postalCode', 'region', 'acceptTerms']) {
    const input = page.locator(`#co-${f}`);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    const err = page.locator(`#co-${f}-error`);
    await expect(err).not.toBeEmpty();
    expect(await input.getAttribute('aria-describedby')).toContain(`co-${f}-error`);
    await expect(summary.locator(`a[href="#co-${f}"]`)).toHaveCount(1);
  }
  // specific invalid values
  await fillForm(page, { email: 'maria@', phone: '12345', postalCode: '123', firstName: 'Μ' });
  await page.fill('#co-vatNumber', '123456789');
  await submit(page).click();
  await expect(page.locator('#co-email-error')).toContainText('email');
  await expect(page.locator('#co-phone-error')).toContainText('69');
  await expect(page.locator('#co-postalCode-error')).toContainText('5 ψηφία');
  await expect(page.locator('#co-firstName-error')).toContainText('2 χαρακτήρες');
  await expect(page.locator('#co-vatNumber-error')).toContainText('ΑΦΜ');
  await expect(page.locator('#co-lastName')).not.toHaveAttribute('aria-invalid', 'true');
  // inline: fixing a field on blur clears its error
  await page.fill('#co-email', 'maria@example.gr');
  await page.locator('#co-email').blur();
  await expect(page.locator('#co-email')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#co-email-error')).toBeEmpty();
  // input types / keyboards / autocomplete
  await expect(page.locator('#co-email')).toHaveAttribute('type', 'email');
  await expect(page.locator('#co-phone')).toHaveAttribute('type', 'tel');
  await expect(page.locator('#co-postalCode')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.locator('#co-firstName')).toHaveAttribute('autocomplete', 'given-name');
  await expect(page.locator('#co-address')).toHaveAttribute('autocomplete', /address-line1/);
  // pickup: address fields are not required and are hidden
  await page.check('input[name="shippingMethod"][value="pickup"]');
  await expect(page.locator('[data-pickup-note]')).toBeVisible();
  await expect(page.locator('#co-address')).toBeHidden();
  await page.fill('#co-postalCode', '').catch(() => {});
  await submit(page).click();
  await expect(page.locator('[data-error-summary] a[href="#co-address"]')).toHaveCount(0);
  await expect(page.locator('[data-error-summary] a[href="#co-postalCode"]')).toHaveCount(0);
  expect(await dbAll(page, 'orders')).toEqual([]);
  expect(errors).toEqual([]);
});

test('shipping, COD and coupon change totals live and match the pricing math', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const v = stocked(mid, 5);
  await addSku(page, v.sku, 1);
  expect(await applyCoupon(page, 'WELCOME10')).toBe(true);
  await openCheckout(page);
  const sub = mid.priceCents;
  await expect(page.locator('[data-sum-coupon]')).toContainText('WELCOME10');
  await expect(page.locator('[data-sum-coupon] a[href="#/cart"]')).toBeVisible();
  await expect(page.locator('[data-summary-line]')).toHaveCount(1);

  const check = async (ship, pay) => {
    const e = expected({ sub, percent: 10, ship, pay });
    await expect.poll(async () => (await readSummary(page)).total).toBe(e.total);
    const s = await readSummary(page);
    expect(s.sub).toBe(sub);
    expect(s.disc).toBe(e.disc);
    expect(s.shipping).toBe(e.shipping);
    expect(s.cod).toBe(e.cod);
    expect(s.vat).toBe(e.vat);
  };
  // default: courier + COD
  await expect(page.locator('input[name="shippingMethod"][value="courier"]')).toBeChecked();
  await expect(page.locator('input[name="paymentMethod"][value="cod"]')).toBeChecked();
  await check('courier', 'cod');
  await expect(page.locator('[data-cod-note]')).toContainText('2,00');
  await page.check('input[name="shippingMethod"][value="pickup"]');
  await check('pickup', 'cod');
  await page.check('input[name="paymentMethod"][value="iris"]');
  await check('pickup', 'iris');
  await expect(page.locator('[data-sum-cod]')).toHaveCount(0);
  await page.check('input[name="shippingMethod"][value="courier"]');
  await check('courier', 'iris');

  // above the free-shipping threshold courier is free
  await addSku(page, stocked(big, 3).sku, 1);
  await openCheckout(page);
  const sub2 = mid.priceCents + big.priceCents;
  const e2 = expected({ sub: sub2, percent: 10, ship: 'courier', pay: 'cod' });
  await expect.poll(async () => (await readSummary(page)).total).toBe(e2.total);
  expect(e2.shipping).toBe(0);
  await expect(page.locator('[data-sum-shipping]')).toHaveText('Δωρεάν');
  expect(errors).toEqual([]);
});

test('COD order: one order, exact stock decrement, cart cleared, coupon used, customer recorded', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const v = stocked(mid, 5);
  const w = stocked(other, 3);
  await addSku(page, v.sku, 2);
  await addSku(page, w.sku, 1);
  expect(await applyCoupon(page, 'WELCOME10')).toBe(true);
  const before = await stockMap(page);
  const couponBefore = (await dbGet(page, 'coupons', 'WELCOME10')).usedCount;
  await openCheckout(page);
  const shownTotal = parseEuro(await page.locator('[data-sum-total]').innerText());
  await fillForm(page);
  await submit(page).click();
  await expect(page).toHaveURL(/#\/order\/ELAN-\d{8}-[0-9A-Z]{4}$/);
  await expect(page.locator('[data-page="confirmation"]')).toBeVisible();
  const ref = (await page.locator('[data-order-ref]').innerText()).trim();
  expect(ref).toMatch(ORDER_RE);

  const orders = await dbAll(page, 'orders');
  expect(orders).toHaveLength(1);
  const o = orders[0];
  expect(o.id).toBe(ref);
  expect(o.paymentStatus).toBe('pending');
  expect(o.fulfillmentStatus).toBe('pending');
  expect(o.payment).toMatchObject({ method: 'cod', status: 'pending', simulated: true });
  expect(o.restocked).toBe(false);
  expect(o.demo).toBe(true);
  expect(o.couponCode).toBe('WELCOME10');
  expect(o.requestId).toBeTruthy();
  expect(o.history[0].type).toBe('created');
  expect(o.customer).toMatchObject({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.gr', phone: '6912345678' });
  expect(o.shippingAddress).toMatchObject({ address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική' });
  const sub = mid.priceCents * 2 + other.priceCents;
  const e = expected({ sub, percent: 10, ship: 'courier', pay: 'cod' });
  expect(o.totals).toEqual({
    subtotalCents: sub, discountCents: e.disc, shippingCents: e.shipping, codFeeCents: e.cod, totalCents: e.total, vatIncludedCents: e.vat,
  });
  expect(o.totals.totalCents).toBe(shownTotal);
  const lv = o.lines.find((l) => l.sku === v.sku);
  expect(lv).toMatchObject({ productId: mid.id, slug: mid.slug, name: mid.name, qty: 2, unitCents: mid.priceCents, lineTotalCents: mid.priceCents * 2, vatRate: S.vatRate });
  expect(lv.image).toBeTruthy();

  // exact decrements, nothing else touched
  const after = await stockMap(page);
  for (const [sku, s] of Object.entries(before)) {
    const d = sku === v.sku ? 2 : sku === w.sku ? 1 : 0;
    expect(after[sku], sku).toBe(s - d);
  }
  const cart = await dbGet(page, 'carts', 'local');
  expect(cart.lines).toEqual([]);
  expect(cart.couponCode).toBeNull();
  await expect(page.locator('.header-end [data-badge="cart"]')).toBeHidden();
  expect((await dbGet(page, 'coupons', 'WELCOME10')).usedCount).toBe(couponBefore + 1);

  const customers = await dbAll(page, 'customers');
  expect(customers).toHaveLength(1);
  expect(customers[0]).toMatchObject({ id: o.customerId, email: 'maria@example.gr', orderCount: 1, totalCents: e.total });
  expect(customers[0].id).toMatch(/^c-/);

  // confirmation content
  await expect(page.locator('[data-payment-status]')).toContainText('Εκκρεμεί');
  await expect(page.locator('[data-page="confirmation"]')).toContainText('Αντικαταβολή');
  await expect(page.locator('[data-order-line]')).toHaveCount(2);
  expect(parseEuro(await page.locator('[data-total]').innerText())).toBe(e.total);
  await expect(page.locator('[data-print]')).toBeVisible();
  await expect(page.locator('a[href="#/account/orders"]').first()).toBeVisible();
  await expect(page.locator('[data-iris-simulate]')).toHaveCount(0);

  // snapshot is immutable: editing the product afterwards changes nothing in the order
  await dbPatch(page, 'products', mid.id, { name: 'Αλλαγμένο όνομα', priceCents: 1 });
  await page.reload();
  await expect(page.locator('[data-page="confirmation"]')).toBeVisible();
  await expect(page.locator('[data-page="confirmation"]')).toContainText(mid.name);
  await expect(page.locator('[data-page="confirmation"]')).not.toContainText('Αλλαγμένο όνομα');
  const o2 = await dbGet(page, 'orders', o.id);
  expect(o2.lines).toEqual(o.lines);
  expect(o2.totals).toEqual(o.totals);
  expect(errors).toEqual([]);
});

test('IRIS: explanation and simulation labels; payment flips only after the simulation click', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await addSku(page, stocked(big, 3).sku, 1);
  await openCheckout(page);
  await fillForm(page);
  await page.check('input[name="paymentMethod"][value="iris"]');
  const info = page.locator('[data-iris-info]');
  await expect(info).toBeVisible();
  await expect(info).toContainText('Προσομοίωση — δεν πραγματοποιείται πραγματική πληρωμή');
  await expect(page.locator('[data-page="checkout"]')).not.toContainText('πληρώθηκε');
  await submit(page).click();
  await expect(page).toHaveURL(/#\/order\/ELAN-/);
  const id = (await page.locator('[data-order-ref]').innerText()).trim();
  let o = await dbGet(page, 'orders', id);
  expect(o.payment.method).toBe('iris');
  expect(o.paymentStatus).toBe('pending');
  expect(o.fulfillmentStatus).toBe('pending');
  expect(o.totals.codFeeCents).toBe(0);
  const conf = page.locator('[data-page="confirmation"]');
  await expect(conf).toContainText(S.irisInstructions.slice(0, 40));
  await expect(conf).toContainText('Προσομοίωση');
  await expect(conf).not.toContainText('πληρώθηκε');
  await expect(page.locator('[data-payment-status]')).toContainText('Εκκρεμεί');
  const btn = page.locator('[data-iris-simulate]');
  await expect(btn).toHaveText(/Προσομοίωση πληρωμής IRIS/);
  // still pending after a reload (nothing auto-confirms)
  await page.reload();
  await expect(btn).toBeVisible();
  expect((await dbGet(page, 'orders', id)).paymentStatus).toBe('pending');
  await btn.click();
  await expect(page.locator('[data-payment-status]')).toHaveText(/Προσομοίωση: πληρώθηκε/);
  o = await dbGet(page, 'orders', id);
  expect(o.paymentStatus).toBe('simulated-paid');
  expect(o.fulfillmentStatus).toBe('pending');
  expect(o.history.map((h) => h.type)).toEqual(['created', 'payment-simulated']);
  // idempotent
  await page.evaluate(async (oid) => (await import('/assets/js/services/checkout.js')).confirmIrisSimulation(oid), id);
  expect((await dbGet(page, 'orders', id)).history).toHaveLength(2);
  await page.reload();
  await expect(page.locator('[data-payment-status]')).toHaveText(/Προσομοίωση: πληρώθηκε/);
  await expect(page.locator('[data-iris-simulate]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('double-click on submit creates one order and decrements once', async ({ page }) => {
  await boot(page);
  const v = stocked(mid, 5);
  await addSku(page, v.sku, 2);
  const before = (await dbGet(page, 'variants', v.sku)).stock;
  await openCheckout(page);
  await fillForm(page);
  await submit(page).dblclick();
  await expect(page).toHaveURL(/#\/order\/ELAN-/);
  await expect(page.locator('[data-page="confirmation"]')).toBeVisible();
  expect(await dbAll(page, 'orders')).toHaveLength(1);
  expect((await dbGet(page, 'variants', v.sku)).stock).toBe(before - 2);
});

test('placeOrder twice with the same requestId returns the same order without side effects', async ({ page }) => {
  await boot(page);
  const v = stocked(mid, 5);
  await addSku(page, v.sku, 1);
  await addSku(page, stocked(other, 3).sku, 1);
  const before = (await dbGet(page, 'variants', v.sku)).stock;
  const ids = await page.evaluate(async () => {
    const m = await import('/assets/js/services/checkout.js');
    const args = {
      form: { firstName: 'Νίκος', lastName: 'Γεωργίου', email: 'nikos@example.gr', phone: '2101234567', address: 'Σταδίου 5', city: 'Αθήνα', postalCode: '10562', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'cod', requestId: 'req-same-1',
    };
    const [a, b] = await Promise.all([m.placeOrder(args), m.placeOrder(args)]);
    const c = await m.placeOrder(args);
    return [a.id, b.id, c.id];
  });
  expect(ids[0]).toMatch(ORDER_RE);
  expect(new Set(ids).size).toBe(1);
  expect(await dbAll(page, 'orders')).toHaveLength(1);
  expect((await dbGet(page, 'variants', v.sku)).stock).toBe(before - 1);
  expect((await dbAll(page, 'customers'))[0].orderCount).toBe(1);
});

test('stock lowered after the checkout loaded: STOCK error, no order, no decrement', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const v = stocked(mid, 5);
  const w = stocked(other, 3);
  await addSku(page, v.sku, 3);
  await addSku(page, w.sku, 1);
  await openCheckout(page);
  await fillForm(page);
  await dbPatch(page, 'variants', v.sku, { stock: 2 }); // "another tab" sold some
  const before = await stockMap(page);
  await submit(page).click();
  const banner = page.locator('[data-checkout-error="STOCK"]');
  await expect(banner).toBeVisible();
  await expect(banner.locator('a[href="#/cart"]')).toBeVisible();
  await expect(banner).toContainText(mid.name);
  await expect(page).toHaveURL(/#\/checkout$/);
  expect(await dbAll(page, 'orders')).toEqual([]);
  expect(await stockMap(page)).toEqual(before);
  expect((await dbGet(page, 'carts', 'local')).lines).toHaveLength(2);
  await expect(submit(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test('coupon exhausted or expired between cart and submit: COUPON error, no order', async ({ page }) => {
  await boot(page);
  const v = stocked(mid, 5);
  await addSku(page, v.sku, 1);
  expect(await applyCoupon(page, 'WELCOME10')).toBe(true);
  const before = await stockMap(page);
  await openCheckout(page);
  await fillForm(page);
  await dbPatch(page, 'coupons', 'WELCOME10', { maxUses: 3, usedCount: 3 });
  await submit(page).click();
  const banner = page.locator('[data-checkout-error="COUPON"]');
  await expect(banner).toBeVisible();
  await expect(banner.locator('a[href="#/cart"]')).toBeVisible();
  expect(await dbAll(page, 'orders')).toEqual([]);
  expect(await stockMap(page)).toEqual(before);
  expect((await dbGet(page, 'coupons', 'WELCOME10')).usedCount).toBe(3);
  // expired
  await dbPatch(page, 'coupons', 'WELCOME10', { maxUses: null, usedCount: 0, expiresAt: '2020-01-01T00:00:00Z' });
  await submit(page).click();
  await expect(page.locator('[data-checkout-error="COUPON"]')).toBeVisible();
  expect(await dbAll(page, 'orders')).toEqual([]);
  expect((await dbGet(page, 'coupons', 'WELCOME10')).usedCount).toBe(0);
});

test('returning local customer can reuse saved details; orderCount grows', async ({ page }) => {
  await boot(page);
  await addSku(page, stocked(mid, 5).sku, 1);
  await openCheckout(page);
  await expect(page.locator('[data-fill-saved]')).toHaveCount(0);
  await fillForm(page, { region: 'Κρήτη', city: 'Ηράκλειο', postalCode: '71201', address: 'Λεωφόρος Καλοκαιρινού 10' });
  await page.fill('#co-vatNumber', '090000045');
  await page.check('#co-saveDetails');
  await submit(page).click();
  await expect(page).toHaveURL(/#\/order\/ELAN-/);

  await addSku(page, stocked(other, 3).sku, 1);
  await openCheckout(page);
  const fill = page.locator('[data-fill-saved]');
  await expect(fill).toBeVisible();
  await expect(page.locator('[data-saved-note]')).toContainText('μόνο σε αυτόν τον περιηγητή');
  await expect(page.locator('#co-email')).toHaveValue('');
  await fill.click();
  await expect(page.locator('#co-firstName')).toHaveValue('Μαρία');
  await expect(page.locator('#co-email')).toHaveValue('maria@example.gr');
  await expect(page.locator('#co-phone')).toHaveValue('6912345678');
  await expect(page.locator('#co-address')).toHaveValue('Λεωφόρος Καλοκαιρινού 10');
  await expect(page.locator('#co-city')).toHaveValue('Ηράκλειο');
  await expect(page.locator('#co-postalCode')).toHaveValue('71201');
  await expect(page.locator('#co-region')).toHaveValue('Κρήτη');
  await expect(page.locator('#co-vatNumber')).toHaveValue('090000045');
  await page.check('#co-acceptTerms');
  await submit(page).click();
  await expect(page).toHaveURL(/#\/order\/ELAN-/);
  const customers = await dbAll(page, 'customers');
  expect(customers).toHaveLength(1);
  expect(customers[0].orderCount).toBe(2);
  expect(customers[0].savedAddresses[0]).toMatchObject({ city: 'Ηράκλειο', region: 'Κρήτη' });
  const orders = await page.evaluate(async (cid) => (await import('/assets/js/services/orders.js')).listOrdersForCustomer(cid), customers[0].id);
  expect(orders).toHaveLength(2);
});

test('unknown order id shows a friendly not-found', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/#/order/ELAN-20260101-ZZZZ');
  await expect(page.locator('[data-order-not-found]')).toBeVisible();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('[data-order-not-found] a[href="#/"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('390px: no horizontal overflow on checkout and confirmation', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await addSku(page, stocked(mid, 5).sku, 1);
  await openCheckout(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.check('input[name="paymentMethod"][value="iris"]');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await fillForm(page);
  await submit(page).click();
  await expect(page.locator('[data-page="confirmation"]')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
