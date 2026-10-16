const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const sample = JSON.parse(fs.readFileSync(path.join(root, 'data/sample-data.json'), 'utf8'));
const active = products.filter((p) => p.status !== 'archived');
const stocked = (p, min) => p.variants.find((v) => v.stock >= min && !v.archived);
const [P1, P2] = active.filter((p) => stocked(p, 5)).slice(0, 2);
const SKU1 = stocked(P1, 5).sku;
const SKU2 = stocked(P2, 5).sku;

const LIST = '[data-admin-view="orders"]';
const DETAIL = '[data-admin-view="order-detail"]';
const money = (c) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Load the storefront (seeds IndexedDB) and open a demo admin session. */
async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}
async function openList(page) {
  await page.goto('/#/admin/orders');
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
}
async function openDetail(page, id) {
  await page.goto(`/#/admin/orders/${id}`);
  await expect(page.locator(DETAIL)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-order-ref]')).toHaveText(id);
}

let seq = 0;
/** Place a real storefront order through the checkout service (same code path as the checkout page). */
async function place(page, { lines = [[SKU1, 2], [SKU2, 1]], pay = 'cod', ship = 'courier', first = 'Μαρίνα', last = 'Δοκιμή', email } = {}) {
  seq += 1;
  const mail = email || `marina.${Date.now()}.${seq}@example.gr`;
  return page.evaluate(async (a) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    for (const [sku, qty] of a.lines) await cart.addLine(sku, qty);
    return co.placeOrder({
      form: { firstName: a.first, lastName: a.last, email: a.mail, phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: a.ship, paymentMethod: a.pay, requestId: `r-${Math.random()}`,
    });
  }, { lines, pay, ship, first, last, mail });
}

const dbGet = (page, store, key) => page.evaluate(async ([s, k]) => (await import('/assets/js/db.js')).get(s, k), [store, key]);
const dbAll = (page, store) => page.evaluate(async (s) => (await import('/assets/js/db.js')).getAll(s), store);
const dbPut = (page, store, val) => page.evaluate(async ([s, v]) => (await import('/assets/js/db.js')).put(s, v), [store, val]);
const stockOf = async (page, sku) => (await dbGet(page, 'variants', sku))?.stock;
/** Call an orders.js service from the page; resolves {ok, value} or {ok:false, code, message}. */
const svc = (page, fn, ...args) => page.evaluate(async ([f, a]) => {
  const m = await import('/assets/js/services/orders.js');
  try { return { ok: true, value: await m[f](...a) }; } catch (e) { return { ok: false, code: e.code, message: e.message, name: e.name }; }
}, [fn, args]);

/** Confirm the open dialog by clicking its OK button (optionally twice, as a double click). */
async function confirmModal(page, { dbl = false } = {}) {
  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();
  const ok = modal.locator('[data-ok]');
  if (dbl) await ok.dblclick(); else await ok.click();
  await expect(page.locator('.modal')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

test('fixtures', () => {
  expect(SKU1).toBeTruthy();
  expect(SKU2).toBeTruthy();
  expect(P1.id).not.toBe(P2.id);
});

test('a freshly placed storefront order is found in the admin list by reference, email and name', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { first: 'Ευτέρπη', last: 'Ξενοφώντος' });
  await openList(page);
  const total = sample.orders.length + 1;
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(total));
  // newest first by default: the new order is the first row
  await expect(page.locator('tr[data-order-id]').first()).toHaveAttribute('data-order-id', o.id);
  for (const q of [o.id, o.id.toLowerCase(), o.customer.email, 'Ευτέρπη Ξενοφ', 'ξενοφωντος']) {
    await page.fill('#ol-q', q);
    await expect(page.locator('[data-count]'), q).toHaveAttribute('data-query', q);
    await expect(page.locator('[data-count]'), q).toHaveAttribute('data-matching', '1');
    await expect(page.locator('tr[data-order-id]')).toHaveCount(1);
    await expect(page.locator('tr[data-order-id]').first()).toHaveAttribute('data-order-id', o.id);
  }
  const row = page.locator(`tr[data-order-id="${o.id}"]`);
  await expect(row).toContainText('Παραλήφθηκε');
  await expect(row).toContainText('Εκκρεμεί πληρωμή');
  await expect(row).toContainText(money(o.totals.totalCents).replace(/\s/g, ' '));
  await row.locator('a.admin-order-link').click();
  await expect(page.locator(DETAIL)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-order-ref]')).toHaveText(o.id);
  await expect(page.locator('[data-items] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-customer-card]')).toContainText(o.customer.email);
  await expect(page.locator('[data-shipping-address]')).toContainText('Ερμού 25');
  await expect(page.locator('[data-totals-card] [data-total]')).toHaveText(money(o.totals.totalCents));
  await expect(page.locator('[data-totals-card]')).toContainText('Συμπεριλαμβάνεται ΦΠΑ');
  await expect(page.locator('[data-pay-note]')).toContainText('Αντικαταβολή');
  // the filters survive a visit to the order and back
  await page.goBack();
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#ol-q')).toHaveValue('ξενοφωντος');
  expect(errors).toEqual([]);
});

test('fulfillment moves forward through the chain, persists after reload and shows in the customer account', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page);
  await openDetail(page, o.id);
  // only forward steps are offered; cancel is offered, return is not
  const offered = () => page.locator('[data-set-status]').evaluateAll((bs) => bs.map((b) => b.dataset.setStatus));
  expect(await offered()).toEqual(['confirmed', 'processing', 'shipped', 'delivered']);
  await expect(page.locator('[data-cancel-order]')).toBeVisible();
  await expect(page.locator('[data-return-order]')).toHaveCount(0);
  const chain = ['confirmed', 'processing', 'shipped', 'delivered'];
  for (const s of chain) {
    await page.locator(`[data-set-status="${s}"]`).click();
    await expect(page.locator(`[data-fulfillment-badge="${s}"]`)).toBeVisible();
    await expect(page.locator('.toast-elan').last()).toContainText('Η κατάσταση άλλαξε');
    expect(await offered()).toEqual(chain.slice(chain.indexOf(s) + 1));
  }
  await expect(page.locator('[data-return-order]')).toBeVisible();
  await expect(page.locator('[data-cancel-order]')).toHaveCount(0);
  const stored = await dbGet(page, 'orders', o.id);
  expect(stored.fulfillmentStatus).toBe('delivered');
  const statusEntries = stored.history.filter((h) => h.type === 'status');
  expect(statusEntries.map((h) => h.detail)).toEqual(['Επιβεβαιώθηκε', 'Σε προετοιμασία', 'Απεστάλη', 'Παραδόθηκε'].map((l) => `Η κατάσταση άλλαξε σε «${l}».`));
  expect(statusEntries.every((h) => h.by === 'admin-demo' && !Number.isNaN(Date.parse(h.at)))).toBe(true);
  await page.reload();
  await expect(page.locator(DETAIL)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-fulfillment-badge="delivered"]')).toBeVisible();
  await expect(page.locator('[data-history] li')).toHaveCount(5);
  // the same no-op from the service adds nothing
  const again = await svc(page, 'updateFulfillment', o.id, 'delivered');
  expect(again.ok).toBe(true);
  expect((await dbGet(page, 'orders', o.id)).history.length).toBe(stored.history.length);
  // storefront account order page reflects the admin change after reload
  await page.goto(`/#/account/orders/${o.id}`);
  await expect(page.locator('[data-order-detail]')).toBeVisible();
  await expect(page.locator('[data-order-detail] [data-fulfillment-status]')).toHaveAttribute('data-fulfillment-status', 'delivered');
  await expect(page.locator('[data-step="delivered"]')).toHaveAttribute('data-state', 'done');
  expect(errors).toEqual([]);
});

test('invalid transitions are not offered in the UI and are rejected by the service', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  expect((await svc(page, 'updateFulfillment', o.id, 'shipped')).ok).toBe(true);
  await openDetail(page, o.id);
  expect(await page.locator('[data-set-status]').evaluateAll((bs) => bs.map((b) => b.dataset.setStatus))).toEqual(['delivered']);
  for (const s of ['pending', 'confirmed', 'processing']) {
    const r = await svc(page, 'updateFulfillment', o.id, s);
    expect(r, s).toMatchObject({ ok: false, code: 'INVALID_TRANSITION', name: 'OrderError' });
    expect(r.message).toMatch(/[Α-ω]/);
  }
  // terminal states only through the dedicated functions
  expect(await svc(page, 'updateFulfillment', o.id, 'cancelled')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(await svc(page, 'updateFulfillment', o.id, 'returned')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(await svc(page, 'returnOrder', o.id)).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(await svc(page, 'updateFulfillment', o.id, 'bogus')).toMatchObject({ ok: false, code: 'INVALID_STATUS' });
  expect(await svc(page, 'updateFulfillment', 'ELAN-00000000-NONE', 'delivered')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  // nothing changed
  const stored = await dbGet(page, 'orders', o.id);
  expect(stored.fulfillmentStatus).toBe('shipped');
  expect(stored.history.length).toBe(2);
  // delivered → pending (backward) rejected too
  await svc(page, 'updateFulfillment', o.id, 'delivered');
  expect(await svc(page, 'updateFulfillment', o.id, 'pending')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  // a stale page offering an action that became invalid shows an error and re-renders the true state
  const o2 = await place(page, { lines: [[SKU1, 1]] });
  await openDetail(page, o2.id);
  await expect(page.locator('[data-set-status="confirmed"]')).toBeVisible();
  await svc(page, 'updateFulfillment', o2.id, 'shipped');
  await page.locator('[data-set-status="confirmed"]').click();
  await expect(page.locator('.toast-danger').last()).toContainText('Δεν επιτρέπεται');
  await expect(page.locator('[data-fulfillment-badge="shipped"]')).toBeVisible();
  expect(await page.locator('[data-set-status]').evaluateAll((bs) => bs.map((b) => b.dataset.setStatus))).toEqual(['delivered']);
  expect((await dbGet(page, 'orders', o2.id)).fulfillmentStatus).toBe('shipped');
});

test('payment: pending → simulated-paid → refunded through the UI; refund from pending rejected', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page);
  await openDetail(page, o.id);
  await expect(page.locator('[data-refund]')).toHaveCount(0);
  expect(await svc(page, 'updatePayment', o.id, 'refunded')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  await expect(page.locator('[data-mark-paid]')).toHaveText(/Σήμανση ως πληρωμένη \(προσομοίωση\)/);
  await expect(page.locator('[data-payment-actions]')).toContainText('Προσομοίωση');
  await page.locator('[data-mark-paid]').click();
  await expect(page.locator('[data-payment-badge="simulated-paid"]')).toBeVisible();
  await expect(page.locator('[data-mark-paid]')).toHaveCount(0);
  await page.locator('[data-refund]').click();
  await expect(page.locator('.modal.show')).toContainText('Δεν μεταφέρονται πραγματικά χρήματα');
  await confirmModal(page);
  await expect(page.locator('[data-payment-badge="refunded"]')).toBeVisible();
  await expect(page.locator('[data-payment-badge="refunded"]')).toContainText('Επιστροφή χρημάτων (προσομοίωση)');
  await expect(page.locator('[data-mark-paid], [data-refund]')).toHaveCount(0);
  const stored = await dbGet(page, 'orders', o.id);
  expect(stored.paymentStatus).toBe('refunded');
  expect(stored.fulfillmentStatus).toBe('pending'); // payment and fulfillment are separate
  expect(stored.history.filter((h) => h.type === 'payment').length).toBe(2);
  expect(await svc(page, 'updatePayment', o.id, 'simulated-paid')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  await page.reload();
  await expect(page.locator('[data-payment-badge="refunded"]')).toBeVisible();
  // in the list too
  await openList(page);
  await page.fill('#ol-q', o.id);
  await expect(page.locator(`tr[data-order-id="${o.id}"]`)).toHaveAttribute('data-payment', 'refunded');
  expect(errors).toEqual([]);
});

test('cancelling a real order restores each SKU exactly once (double-click, repeat calls, cancel→return)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { pay: 'iris' });
  const before = { [SKU1]: await stockOf(page, SKU1), [SKU2]: await stockOf(page, SKU2) };
  await svc(page, 'updatePayment', o.id, 'simulated-paid');
  await openDetail(page, o.id);
  await page.locator('[data-cancel-order]').click();
  const modal = page.locator('.modal.show');
  await expect(modal).toContainText('Θα επανέλθουν στο απόθεμα 3 τεμάχια');
  await expect(modal).toContainText(`${SKU1} ×2`);
  await confirmModal(page, { dbl: true });
  await expect(page.locator('[data-fulfillment-badge="cancelled"]')).toBeVisible();
  await expect(page.locator('[data-cancel-order]')).toHaveCount(0);
  await expect(page.locator('[data-set-status]')).toHaveCount(0);
  await expect(page.locator('[data-terminal-note]')).toBeVisible();
  expect(await stockOf(page, SKU1)).toBe(before[SKU1] + 2);
  expect(await stockOf(page, SKU2)).toBe(before[SKU2] + 1);
  let stored = await dbGet(page, 'orders', o.id);
  expect(stored.restocked).toBe(true);
  expect(stored.paymentStatus).toBe('simulated-paid'); // not changed automatically
  expect(stored.history.filter((h) => h.type === 'status' && /Ακυρώθηκε/.test(h.detail)).length).toBe(1);
  expect(stored.history.filter((h) => h.type === 'restock').length).toBe(1);
  const hLen = stored.history.length;
  // the UI then prompts for the simulated refund
  await expect(page.locator('[data-refund-prompt]')).toBeVisible();
  await expect(page.locator('[data-refund]')).toBeVisible();
  // repeated / concurrent service calls: no further stock change and no extra history
  const results = await page.evaluate(async (id) => {
    const m = await import('/assets/js/services/orders.js');
    return Promise.all([m.cancelOrder(id), m.cancelOrder(id), m.cancelOrder(id)].map((p) => p.then((x) => x.fulfillmentStatus)));
  }, o.id);
  expect(results).toEqual(['cancelled', 'cancelled', 'cancelled']);
  expect(await svc(page, 'returnOrder', o.id)).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(await svc(page, 'updateFulfillment', o.id, 'delivered')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(await stockOf(page, SKU1)).toBe(before[SKU1] + 2);
  expect(await stockOf(page, SKU2)).toBe(before[SKU2] + 1);
  stored = await dbGet(page, 'orders', o.id);
  expect(stored.history.length).toBe(hLen);
  // the refund is still possible after cancelling
  await page.locator('[data-refund]').click();
  await confirmModal(page);
  await expect(page.locator('[data-payment-badge="refunded"]')).toBeVisible();
  // customer view: cancelled, internal stock bookkeeping hidden
  await page.goto(`/#/account/orders/${o.id}`);
  await expect(page.locator('[data-tracking-terminal="cancelled"]')).toBeVisible();
  await expect(page.locator('[data-history]')).not.toContainText('απόθεμα');
  expect(errors).toEqual([]);
});

test('returning a delivered real order restocks once; dashboard revenue drops after a cancel', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  const o2 = await place(page, { lines: [[SKU1, 1]] });
  await page.goto('/#/admin');
  await expect(page.locator('[data-admin-view="overview"]')).toHaveAttribute('data-ready', 'true');
  const revBefore = Number(await page.locator('[data-stat="revenueCents"]').getAttribute('data-value'));

  await svc(page, 'updateFulfillment', o.id, 'delivered');
  const before = { [SKU1]: await stockOf(page, SKU1), [SKU2]: await stockOf(page, SKU2) };
  await openDetail(page, o.id);
  await page.locator('[data-return-order]').click();
  await expect(page.locator('.modal.show')).toContainText('επιστραμμένη');
  await confirmModal(page);
  await expect(page.locator('[data-fulfillment-badge="returned"]')).toBeVisible();
  expect(await stockOf(page, SKU1)).toBe(before[SKU1] + 2);
  expect(await stockOf(page, SKU2)).toBe(before[SKU2] + 1);
  expect((await svc(page, 'returnOrder', o.id)).value.fulfillmentStatus).toBe('returned');
  expect(await svc(page, 'cancelOrder', o.id)).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(await stockOf(page, SKU1)).toBe(before[SKU1] + 2);
  expect(await stockOf(page, SKU2)).toBe(before[SKU2] + 1);

  // cancel the second order via the UI and check the dashboard
  await openDetail(page, o2.id);
  await page.locator('[data-cancel-order]').click();
  await confirmModal(page);
  await expect(page.locator('[data-fulfillment-badge="cancelled"]')).toBeVisible();
  await page.goto('/#/admin');
  await expect(page.locator('[data-admin-view="overview"]')).toHaveAttribute('data-ready', 'true');
  const revAfter = Number(await page.locator('[data-stat="revenueCents"]').getAttribute('data-value'));
  expect(revAfter).toBe(revBefore - o.totals.totalCents - o2.totals.totalCents);
});

test('sample orders (not restocked) never change stock on cancel or return, and the history says so', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const delivered = sample.orders.find((o) => o.fulfillmentStatus === 'delivered' && !o.restocked);
  const open = sample.orders.find((o) => o.fulfillmentStatus === 'shipped' && !o.restocked);
  const skus = [...new Set([...delivered.lines, ...open.lines].map((l) => l.sku))];
  const snapshot = async () => Object.fromEntries(await Promise.all(skus.map(async (s) => [s, await stockOf(page, s)])));
  const before = await snapshot();

  await openDetail(page, delivered.id);
  await page.locator('[data-return-order]').click();
  await expect(page.locator('.modal.show')).toContainText('δείγμα παραγγελίας');
  await expect(page.locator('.modal.show')).toContainText('ΔΕΝ θα αλλάξει');
  await confirmModal(page);
  await expect(page.locator('[data-fulfillment-badge="returned"]')).toBeVisible();
  await expect(page.locator('[data-history]')).toContainText('Δείγμα παραγγελίας: χωρίς επαναφορά αποθέματος');
  await expect(page.locator('.toast-elan').last()).toContainText('το απόθεμα δεν άλλαξε');

  const r = await svc(page, 'cancelOrder', open.id);
  expect(r.value.fulfillmentStatus).toBe('cancelled');
  expect(r.value.history.at(-1).detail).toBe('Δείγμα παραγγελίας: χωρίς επαναφορά αποθέματος');
  expect(await snapshot()).toEqual(before);
  // an already-restocked sample cancellation stays as it is
  const done = sample.orders.find((o) => o.fulfillmentStatus === 'cancelled');
  const same = await svc(page, 'cancelOrder', done.id);
  expect(same.value.history.length).toBe(done.history.length);
  expect(await snapshot()).toEqual(before);
  expect(errors).toEqual([]);
});

test('cancel restores into an archived variant and skips a deleted one with a history note', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  // archive SKU1 (as the product editor does for referenced variants) and delete SKU2
  const v1 = await dbGet(page, 'variants', SKU1);
  await dbPut(page, 'variants', { ...v1, archived: true, stock: 0 });
  await page.evaluate(async (s) => (await import('/assets/js/db.js')).del('variants', s), SKU2);
  await openDetail(page, o.id);
  await page.locator('[data-cancel-order]').click();
  await confirmModal(page);
  await expect(page.locator('[data-fulfillment-badge="cancelled"]')).toBeVisible();
  const after = await dbGet(page, 'variants', SKU1);
  expect(after.stock).toBe(2);
  expect(after.archived).toBe(true);
  expect(await dbGet(page, 'variants', SKU2)).toBeUndefined();
  await expect(page.locator('[data-history]')).toContainText(`Παραλλαγή ${SKU2} δεν υπάρχει πλέον — δεν επαναφέρθηκε απόθεμα`);
  await expect(page.locator('[data-history]')).toContainText('αρχειοθετημένη παραλλαγή');
  expect((await dbGet(page, 'orders', o.id)).restocked).toBe(true);
  // the snapshot still renders the deleted variant's line
  await expect(page.locator(`[data-item="${SKU2}"]`)).toBeVisible();
});

test('pickup order (no shipping address) and a null-image line render; unknown id shows a friendly not-found', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { ship: 'pickup', lines: [[SKU1, 1]] });
  expect(o.shippingAddress).toBeNull();
  const stored = await dbGet(page, 'orders', o.id);
  await dbPut(page, 'orders', { ...stored, lines: stored.lines.map((l) => ({ ...l, image: null })) });
  await openDetail(page, o.id);
  await expect(page.locator('[data-pickup-text]')).toBeVisible();
  await expect(page.locator('[data-shipping-address]')).toHaveCount(0);
  await expect(page.locator('[data-items] .admin-thumb-empty')).toHaveCount(1);
  // customer link lands on the real customer profile, not a 404
  await page.locator('[data-customer-link]').click();
  await expect(page).toHaveURL(new RegExp(`#/admin/customers/${o.customerId}$`));
  await expect(page.locator('[data-admin-view="customer-detail"]')).toBeVisible();
  await expect(page.locator('[data-page="not-found"]')).toHaveCount(0);

  await page.goto('/#/admin/orders/ELAN-20990101-ZZZZ');
  await expect(page.locator('[data-admin-view="order-not-found"]')).toBeVisible();
  await expect(page.locator('[data-order-not-found]')).toContainText('ELAN-20990101-ZZZZ');
  await expect(page.locator('[data-admin-shell]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('internal notes: validation, add, persist after reload, hidden from the customer', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  await openDetail(page, o.id);
  await expect(page.locator('[data-notes-empty]')).toBeVisible();
  await page.locator('[data-note-submit]').click();
  await expect(page.locator('[data-note-error]')).toBeVisible();
  await expect(page.locator('#od-note')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#od-note', 'α'.repeat(1001));
  await page.locator('[data-note-submit]').click();
  await expect(page.locator('[data-note-error]')).toContainText('1000');
  expect((await dbGet(page, 'orders', o.id)).internalNotes).toEqual([]);
  expect(await svc(page, 'addNote', o.id, '   ')).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await svc(page, 'addNote', o.id, 'x'.repeat(1001))).toMatchObject({ ok: false, code: 'VALIDATION' });

  await page.fill('#od-note', '  Ο πελάτης ζήτησε συσκευασία δώρου.  ');
  await page.locator('[data-note-submit]').click();
  await expect(page.locator('[data-notes] li')).toHaveCount(1);
  await expect(page.locator('[data-notes] li').first()).toContainText('Ο πελάτης ζήτησε συσκευασία δώρου.');
  await expect(page.locator('#od-note')).toHaveValue('');
  await page.fill('#od-note', 'Δεύτερη σημείωση');
  await page.keyboard.press('Tab');
  await page.locator('[data-note-submit]').click();
  await expect(page.locator('[data-notes] li')).toHaveCount(2);
  await expect(page.locator('[data-notes] li').first()).toContainText('Δεύτερη σημείωση'); // newest first
  await page.reload();
  await expect(page.locator(DETAIL)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-notes] li')).toHaveCount(2);
  const stored = await dbGet(page, 'orders', o.id);
  expect(stored.internalNotes.map((n) => n.text)).toEqual(['Ο πελάτης ζήτησε συσκευασία δώρου.', 'Δεύτερη σημείωση']);
  expect(stored.fulfillmentStatus).toBe('pending');
  await page.goto(`/#/account/orders/${o.id}`);
  await expect(page.locator('[data-order-detail]')).toBeVisible();
  await expect(page.locator('[data-order-detail]')).not.toContainText('συσκευασία δώρου');
  await expect(page.locator('[data-history] li')).toHaveCount(1);
});

test('filters, search, sort, pagination and date range match the IndexedDB data', async ({ page }) => {
  await boot(page);
  await openList(page);
  const orders = await dbAll(page, 'orders');
  const byNewest = orders.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const ids = () => page.locator('tr[data-order-id]').evaluateAll((rs) => rs.map((r) => r.dataset.orderId));
  // pagination 25 / page
  expect(await ids()).toEqual(byNewest.slice(0, 25).map((o) => o.id));
  await expect(page.locator('[data-range]')).toHaveText(`Εμφάνιση 1–25 από ${orders.length}`);
  await page.locator('[data-goto="2"]').first().click();
  expect(await ids()).toEqual(byNewest.slice(25, 50).map((o) => o.id));
  await page.locator('[data-goto="3"]').first().click();
  expect(await ids()).toEqual(byNewest.slice(50).map((o) => o.id));
  await expect(page.locator('[data-goto="4"]')).toBeDisabled();
  // sorts (reset to page 1)
  await page.selectOption('#ol-sort', 'oldest');
  expect(await ids()).toEqual(byNewest.slice().reverse().slice(0, 25).map((o) => o.id));
  await page.selectOption('#ol-sort', 'total-desc');
  const firstTotals = await page.locator('tr[data-order-id]').evaluateAll((rs) => rs.map((r) => r.dataset.orderId));
  const totalOf = Object.fromEntries(orders.map((o) => [o.id, o.totals.totalCents]));
  const shownTotals = firstTotals.map((id) => totalOf[id]);
  expect(shownTotals).toEqual(shownTotals.slice().sort((a, b) => b - a));
  expect(shownTotals[0]).toBe(Math.max(...orders.map((o) => o.totals.totalCents)));
  await page.selectOption('#ol-sort', 'newest');
  // status / payment / method filters
  for (const [sel, key, value, pick] of [
    ['#ol-fs', 'fulfillmentStatus', 'delivered', (o) => o.fulfillmentStatus === 'delivered'],
    ['#ol-ps', 'paymentStatus', 'refunded', (o) => o.paymentStatus === 'refunded'],
    ['#ol-pm', 'paymentMethod', 'iris', (o) => o.payment.method === 'iris'],
  ]) {
    await page.selectOption(sel, value);
    const expected = orders.filter(pick);
    await expect(page.locator('[data-count]'), key).toHaveAttribute('data-matching', String(expected.length));
    const shown = await ids();
    expect(shown.length).toBe(Math.min(25, expected.length));
    expect(shown.every((id) => expected.some((o) => o.id === id))).toBe(true);
    await page.selectOption(sel, '');
  }
  // combined: cancelled + refunded
  await page.selectOption('#ol-fs', 'cancelled');
  await page.selectOption('#ol-ps', 'refunded');
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(orders.filter((o) => o.fulfillmentStatus === 'cancelled' && o.paymentStatus === 'refunded').length));
  await expect(page.locator('tr[data-order-id] .st-cancelled')).toHaveCount(await page.locator('tr[data-order-id]').count());
  await expect(page.locator('tr[data-order-id] .pay-refunded').first()).toBeVisible();
  await page.selectOption('#ol-fs', '');
  await page.selectOption('#ol-ps', '');
  // date range (local days, inclusive)
  const localDay = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const days = await page.evaluate((list) => list.map((iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }), orders.map((o) => o.createdAt));
  const sortedDays = [...new Set(days)].sort();
  const from = sortedDays[Math.floor(sortedDays.length / 4)];
  const to = sortedDays[Math.floor(sortedDays.length / 2)];
  await page.fill('#ol-from', from);
  await page.fill('#ol-to', to);
  await page.locator('#ol-to').dispatchEvent('change');
  const inRange = days.filter((d) => d >= from && d <= to).length;
  expect(inRange).toBeGreaterThan(0);
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(inRange));
  // a single day is inclusive at both ends
  await page.fill('#ol-from', to);
  await page.locator('#ol-from').dispatchEvent('change');
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(days.filter((d) => d === to).length));
  expect(localDay(orders[0].createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // empty state + clear
  await page.fill('#ol-q', 'δεν-υπάρχει-τέτοια-παραγγελία');
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-export-csv]')).toBeDisabled();
  await page.locator('[data-clear-filters]').click();
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(orders.length));
  await expect(page.locator('#ol-from')).toHaveValue('');
});

/** RFC-4180 parser used to verify the export independently of the app code. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('CSV export downloads the current filtered set (BOM, header, escaping, formula-injection prefix)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const tricky = await place(page, { first: 'Ζωή, "Ζιζή"', last: '=HYPERLINK("x")', email: 'zoi.csv@example.gr' });
  const greek = await place(page, { first: 'Αικατερίνη', last: 'Παπαδοπούλου-Ρήγα', email: 'katerina.csv@example.gr' });
  await openList(page);
  await page.selectOption('#ol-pm', 'cod');
  const orders = await dbAll(page, 'orders');
  const expected = orders.filter((o) => o.payment.method === 'cod');
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(expected.length));
  expect(expected.length).toBeGreaterThan(25); // export is the whole filtered set, not just the page
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-csv]').click()]);
  expect(download.suggestedFilename()).toMatch(/^elan-orders-\d{4}-\d{2}-\d{2}\.csv$/);
  const buf = fs.readFileSync(await download.path());
  expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = buf.subarray(3).toString('utf8');
  expect(text.endsWith('\r\n')).toBe(true);
  const rows = parseCsv(text);
  expect(rows[0]).toEqual(['Αριθμός', 'Ημερομηνία (ISO)', 'Πελάτης', 'Email', 'Τηλέφωνο', 'Τρόπος αποστολής', 'Τρόπος πληρωμής',
    'Κατάσταση παραγγελίας', 'Κατάσταση πληρωμής', 'Κουπόνι', 'Υποσύνολο', 'Έκπτωση', 'Μεταφορικά', 'Αντικαταβολή', 'ΦΠΑ', 'Σύνολο', 'Προϊόντα']);
  expect(rows.length - 1).toBe(expected.length);
  expect(rows.slice(1).every((r) => r.length === 17)).toBe(true);
  expect(new Set(rows.slice(1).map((r) => r[0]))).toEqual(new Set(expected.map((o) => o.id)));
  const byId = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
  // Greek name round-trips
  expect(byId[greek.id][2]).toBe('Αικατερίνη Παπαδοπούλου-Ρήγα');
  expect(byId[greek.id][15]).toBe((greek.totals.totalCents / 100).toFixed(2));
  expect(byId[greek.id][6]).toBe('Αντικαταβολή');
  expect(byId[greek.id][16]).toBe(greek.lines.map((l) => `${l.name} x ${l.qty}`).join(' | '));
  // comma + quotes round-trip; the formula-looking last name is still visible but the cell starts with the name
  expect(byId[tricky.id][2]).toBe('Ζωή, "Ζιζή" =HYPERLINK("x")');
  // phone cell is prefixed only if it starts with a formula char; the email of a sample order never is
  for (const o of expected) {
    const r = byId[o.id];
    expect(r[1]).toBe(o.createdAt);
    expect(r[3]).toBe(o.customer.email);
    expect(r[15]).toBe((o.totals.totalCents / 100).toFixed(2));
  }
  expect(errors).toEqual([]);
});

test('CSV: a text cell starting with a formula character is prefixed with a single quote', async ({ page }) => {
  await boot(page);
  const o = await place(page, { first: '=cmd|"/c calc"!A1', last: '@Επώνυμο', email: 'formula.csv@example.gr' });
  await openList(page);
  await page.fill('#ol-q', 'formula.csv@example.gr');
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', '1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-csv]').click()]);
  const rows = parseCsv(fs.readFileSync(await download.path()).subarray(3).toString('utf8'));
  expect(rows.length).toBe(2);
  expect(rows[1][0]).toBe(o.id);
  expect(rows[1][2]).toBe('\'=cmd|"/c calc"!A1 @Επώνυμο');
});

test('print view hides the admin chrome and actions', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  await openDetail(page, o.id);
  await page.emulateMedia({ media: 'print' });
  for (const sel of ['.admin-sidebar', '.admin-topbar', '.admin-crumbs', '.demo-strip', '[data-actions]', '[data-note-form]', '[data-print]']) {
    await expect(page.locator(sel).first(), sel).toBeHidden();
  }
  await expect(page.locator('.aod-print-head')).toBeVisible();
  await expect(page.locator('[data-items]')).toBeVisible();
  await expect(page.locator('[data-totals-card]')).toBeVisible();
  await expect(page.locator('[data-customer-card]')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.admin-topbar')).toBeVisible();
  await expect(page.locator('.aod-print-head')).toBeHidden();
});

test('keyboard: the cancel dialog keeps focus inside, Escape closes it without changes', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  const before = await stockOf(page, SKU1);
  await openDetail(page, o.id);
  await page.locator('[data-cancel-order]').focus();
  await page.keyboard.press('Enter');
  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-ok]')).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('.modal'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect((await dbGet(page, 'orders', o.id)).fulfillmentStatus).toBe('pending');
  expect(await stockOf(page, SKU1)).toBe(before);
  // the «Πίσω» button also cancels
  await page.locator('[data-cancel-order]').click();
  await page.locator('.modal.show [data-bs-dismiss="modal"].btn-outline-dark').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect((await dbGet(page, 'orders', o.id)).fulfillmentStatus).toBe('pending');
});

test('no horizontal overflow on the order list and detail at 320/390/768/1440', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { first: 'Παρασκευή-Αλεξάνδρα', last: 'Κωνσταντινοπουλοπούλου', email: 'a.very.long.email.address.for.overflow@example-domain.gr' });
  await svc(page, 'addNote', o.id, 'Μεγάλη σημείωση '.repeat(30));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openList(page);
    expect(await overflow(page), `list ${width}`).toBeLessThanOrEqual(0);
    await openDetail(page, o.id);
    expect(await overflow(page), `detail ${width}`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
