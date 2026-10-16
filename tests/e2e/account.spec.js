const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const ok = (p) => p.status !== 'archived';
const stocked = (p, min = 1) => p.variants.find((v) => v.stock >= min);
const prodA = products.find((p) => ok(p) && p.priceCents >= 3000 && p.priceCents < 6000 && stocked(p, 6));
const prodB = products.find((p) => ok(p) && p !== prodA && p.priceCents < 6000 && stocked(p, 6));
const NOTICE = 'Ο λογαριασμός είναι demo: τα στοιχεία σας αποθηκεύονται μόνο σε αυτόν τον περιηγητή και δεν συγχρονίζονται με άλλες συσκευές. Δεν υπάρχει πραγματική σύνδεση/ταυτοποίηση.';

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
async function place(page, { email = 'maria@example.gr', firstName = 'Μαρία', lastName = 'Παπαδοπούλου', prod = prodA, ship = 'courier', pay = 'cod', qty = 1, saveDetails = false } = {}) {
  const sku = stocked(prod, 6).sku;
  return page.evaluate(async (a) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    await cart.addLine(a.sku, a.qty);
    const o = await co.placeOrder({
      form: { firstName: a.firstName, lastName: a.lastName, email: a.email, phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: a.ship, paymentMethod: a.pay, requestId: `r-${Math.random()}`, saveDetails: a.saveDetails,
    });
    return o.order || o;
  }, { sku, qty, email, firstName, lastName, ship, pay, saveDetails });
}
async function dbPatch(page, store, key, patch) {
  await page.evaluate(async ([st, k, pt]) => {
    const db = await import('/assets/js/db.js');
    await db.put(st, { ...(await db.get(st, k)), ...pt });
  }, [store, key, patch]);
}
const dbGet = (page, store, key) => page.evaluate(async ([st, k]) => (await import('/assets/js/db.js')).get(st, k), [store, key]);
const dbAll = (page, store) => page.evaluate(async (st) => (await import('/assets/js/db.js')).getAll(st), store);
async function go(page, hash) {
  await page.goto(`/${hash}`);
  await page.reload();
  await expect(page.locator('[data-page="account"] h1')).toBeVisible();
}
const money = (c) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100);
const nbsp = (s) => s.replace(/\s/g, ' ');

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

test('fixtures', () => { expect(prodA).toBeTruthy(); expect(prodB).toBeTruthy(); });

test('no customer: empty state, demo notice, catalog CTA, no login UI', async ({ page }) => {
  const errors = trackErrors(page);
  await go(page, '#/account');
  await expect(page.locator('[data-account-notice]')).toHaveText(NOTICE);
  await expect(page.locator('[data-account-empty]')).toBeVisible();
  await expect(page.locator('[data-account-empty] a[href="#/catalog"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await go(page, '#/account/orders');
  await expect(page.locator('[data-account-empty]')).toBeVisible();
  await go(page, '#/account/orders/ELAN-20260101-ABCD');
  await expect(page.locator('[data-account-empty]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('create a local profile, then a checkout with the same email attaches to it', async ({ page }) => {
  const errors = trackErrors(page);
  await go(page, '#/account');
  await page.locator('[data-create-submit]').click();
  await expect(page.locator('[data-profile-create] [data-error-for="email"]')).not.toBeEmpty();
  await expect(page.locator('[data-profile-create] [data-error-for="phone"]')).not.toBeEmpty();
  await page.fill('#ac-new-firstName', 'Μαρία');
  await page.fill('#ac-new-lastName', 'Παπαδοπούλου');
  await page.fill('#ac-new-email', 'Maria@Example.gr');
  await page.fill('#ac-new-phone', '6912345678');
  await page.locator('[data-create-submit]').click();
  await expect(page.locator('[data-account-greeting]')).toContainText('Μαρία');
  const list = await dbAll(page, 'customers');
  expect(list).toHaveLength(1);
  const id = list[0].id;
  expect(list[0].email).toBe('maria@example.gr');
  expect(list[0].orderCount).toBe(0);
  const o = await place(page, { email: 'maria@example.gr' });
  expect(o.customerId).toBe(id);
  const c = await dbGet(page, 'customers', id);
  expect(c.orderCount).toBe(1);
  expect(await dbAll(page, 'customers')).toHaveLength(1);
  await go(page, '#/account/orders');
  await expect(page.locator('[data-order-row]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('order history: reference, date, total, Greek status badges, thumbnails, newest first', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o1 = await place(page, { prod: prodA, pay: 'cod' });
  await dbPatch(page, 'orders', o1.id, { createdAt: '2026-03-01T10:00:00.000Z' });
  const o2 = await place(page, { prod: prodB, pay: 'iris', qty: 2 });
  await go(page, '#/account/orders');
  const rows = page.locator('[data-order-row]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-order-id', o2.id);
  await expect(rows.nth(1)).toHaveAttribute('data-order-id', o1.id);
  await expect(rows.nth(0).locator('[data-order-ref]')).toHaveText(o2.id);
  expect(nbsp(await rows.nth(0).locator('[data-order-total]').innerText())).toBe(nbsp(money(o2.totals.totalCents)));
  await expect(rows.nth(1).locator('[data-order-date]')).toContainText('2026');
  await expect(rows.nth(0).locator('[data-fulfillment-status="pending"]')).toBeVisible();
  await expect(rows.nth(0).locator('[data-payment-status="pending"]')).toContainText('Εκκρεμεί');
  await expect(rows.nth(0).locator('img')).toHaveCount(1);
  await dbPatch(page, 'orders', o2.id, { paymentStatus: 'refunded', fulfillmentStatus: 'returned' });
  await dbPatch(page, 'orders', o1.id, { paymentStatus: 'simulated-paid', fulfillmentStatus: 'confirmed' });
  await page.reload();
  await expect(rows.nth(0).locator('[data-payment-status="refunded"]')).toContainText('Επιστροφή');
  await expect(rows.nth(0).locator('[data-fulfillment-status="returned"]')).toContainText('Επιστράφηκε');
  await expect(rows.nth(1).locator('[data-payment-status="simulated-paid"]')).toContainText('Προσομοίωση');
  await expect(rows.nth(1).locator('[data-fulfillment-status="confirmed"]')).toContainText('Επιβεβαιώθηκε');
  await rows.nth(1).locator('a[data-order-link]').click();
  await expect(page).toHaveURL(new RegExp(`#/account/orders/${o1.id}$`));
  expect(errors).toEqual([]);
});

test('order detail: snapshot, totals with VAT, tracking from fulfillmentStatus, history, print + confirmation link', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { pay: 'iris' });
  await go(page, `#/account/orders/${o.id}`);
  await expect(page.locator('h1')).toContainText(o.id);
  await expect(page.locator('[data-order-detail]')).toBeVisible();
  await expect(page.locator('[data-order-line]')).toHaveCount(o.lines.length);
  expect(nbsp(await page.locator('[data-order-detail] [data-total]').innerText())).toBe(nbsp(money(o.totals.totalCents)));
  await expect(page.locator('[data-order-detail]')).toContainText('Συμπεριλαμβάνεται ΦΠΑ');
  await expect(page.locator('[data-shipping-address]')).toContainText('Ερμού 25');
  await expect(page.locator('[data-payment-info]')).toContainText('προσομοίωση');
  await expect(page.locator('[data-payment-info]')).not.toContainText('πληρώθηκε');
  await expect(page.locator('[data-history] li')).toHaveCount(1);
  await expect(page.locator('[data-print]')).toBeVisible();
  await expect(page.locator(`[data-confirmation-link][href="#/order/${o.id}"]`)).toBeVisible();

  const step = (k) => page.locator(`[data-tracking] li[data-step="${k}"]`);
  await expect(step('pending')).toHaveAttribute('data-state', 'current');
  await expect(step('shipped')).toHaveAttribute('data-state', 'upcoming');
  await expect(page.locator('[data-tracking] li')).toHaveText([/Παραλήφθηκε/, /Επιβεβαίωση/, /Προετοιμασία/, /Απεστάλη/, /Παραδόθηκε/]);

  await dbPatch(page, 'orders', o.id, { fulfillmentStatus: 'shipped' });
  await page.reload();
  await expect(step('shipped')).toHaveAttribute('data-state', 'current');
  await expect(step('processing')).toHaveAttribute('data-state', 'done');
  await expect(step('delivered')).toHaveAttribute('data-state', 'upcoming');

  await dbPatch(page, 'orders', o.id, { fulfillmentStatus: 'delivered' });
  await page.reload();
  for (const k of ['pending', 'confirmed', 'processing', 'shipped', 'delivered']) await expect(step(k)).toHaveAttribute('data-state', 'done');

  await dbPatch(page, 'orders', o.id, { fulfillmentStatus: 'cancelled' });
  await page.reload();
  await expect(page.locator('[data-tracking-terminal="cancelled"]')).toContainText('Ακυρώθηκε');
  await expect(page.locator('[data-tracking] li[data-state="current"]')).toHaveCount(0);

  await dbPatch(page, 'orders', o.id, { fulfillmentStatus: 'returned', paymentStatus: 'refunded' });
  await page.reload();
  await expect(page.locator('[data-tracking-terminal="returned"]')).toContainText('Επιστράφηκε');
  await expect(page.locator('[data-payment-info]')).toContainText('Επιστροφή');
  expect(errors).toEqual([]);
});

test('pickup order detail shows pickup text, no address, no error', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { ship: 'pickup' });
  expect(o.shippingAddress).toBeNull();
  await go(page, `#/account/orders/${o.id}`);
  await expect(page.locator('[data-order-detail]')).toBeVisible();
  await expect(page.locator('[data-pickup-text]')).toContainText('κατάστημα');
  await expect(page.locator('[data-shipping-address]')).toHaveCount(0);
  await expect(page.locator('[data-order-detail]')).not.toContainText('Ερμού 25');
  expect(errors).toEqual([]);
});

test('unknown id and another customer order show the friendly message without leaking data', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const mine = await place(page, { email: 'maria@example.gr' });
  const theirs = await place(page, { email: 'nikos@example.gr', firstName: 'Νίκος', lastName: 'Γεωργίου', prod: prodB });
  // active customer is now Nikos (last checkout); switch to Maria
  await page.evaluate((id) => localStorage.setItem('elan.activeCustomerId', id), mine.customerId);
  await go(page, `#/account/orders/${theirs.id}`);
  await expect(page.locator('[data-order-not-found]')).toBeVisible();
  await expect(page.locator('[data-order-not-found]')).toContainText('δεν ανήκει σε αυτό το προφίλ');
  await expect(page.locator('[data-order-detail]')).toHaveCount(0);
  await expect(page.locator('[data-order-not-found]')).not.toContainText('nikos@example.gr');
  await expect(page.locator('[data-order-not-found]')).not.toContainText('Νίκος');
  await go(page, '#/account/orders/ELAN-20200101-ZZZZ');
  await expect(page.locator('[data-order-not-found]')).toBeVisible();
  await go(page, `#/account/orders/${mine.id}`);
  await expect(page.locator('[data-order-detail]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('switching between two local customers shows only each one orders', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const a = await place(page, { email: 'maria@example.gr' });
  const b = await place(page, { email: 'nikos@example.gr', firstName: 'Νίκος', lastName: 'Γεωργίου', prod: prodB });
  await go(page, '#/account/orders');
  const sw = page.locator('[data-account-switch]');
  await expect(sw).toBeVisible();
  await expect(sw.locator('option')).toHaveCount(2);
  await expect(page.locator('[data-order-row]')).toHaveCount(1);
  await expect(page.locator('[data-order-row]')).toHaveAttribute('data-order-id', b.id);
  await sw.selectOption(a.customerId);
  await expect(page.locator('[data-order-row]')).toHaveAttribute('data-order-id', a.id);
  await expect(page.locator('[data-order-row]')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('elan.activeCustomerId'))).toBe(a.customerId);
  await expect(page.locator('h1')).toBeFocused();
  await page.reload();
  await expect(page.locator('[data-order-row]')).toHaveAttribute('data-order-id', a.id);
  await expect(page.locator('a[data-new-profile]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('overview: greeting, counts, last order card, quick links', async ({ page }) => {
  await boot(page);
  const o = await place(page);
  await page.goto('/#/catalog');
  await page.locator('.product-card [data-wish]').first().click();
  await go(page, '#/account');
  await expect(page.locator('[data-account-greeting]')).toContainText('Μαρία');
  await expect(page.locator('[data-overview-orders]')).toContainText('1');
  await expect(page.locator('[data-overview-wishlist]')).toContainText('1');
  await expect(page.locator('[data-last-order]')).toContainText(o.id);
  await expect(page.locator('[data-last-order] a[href^="#/account/orders/"]').first()).toBeVisible();
  await expect(page.locator('[data-quick-links] a')).not.toHaveCount(0);
});

test('profile edit validates, persists after reload, keeps the customer id on email change', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page);
  const id = o.customerId;
  await go(page, '#/account/profile');
  await page.fill('#ac-pf-email', 'not-an-email');
  await page.fill('#ac-pf-phone', '123');
  await page.fill('#ac-pf-vatNumber', '123456789');
  await page.locator('[data-profile-save]').click();
  await expect(page.locator('[data-profile-form] [data-error-for="email"]')).not.toBeEmpty();
  await expect(page.locator('[data-profile-form] [data-error-for="phone"]')).not.toBeEmpty();
  await expect(page.locator('[data-profile-form] [data-error-for="vatNumber"]')).toContainText('ΑΦΜ');
  await expect(page.locator('#ac-pf-email')).toHaveAttribute('aria-invalid', 'true');
  expect((await dbGet(page, 'customers', id)).email).toBe('maria@example.gr');

  await page.fill('#ac-pf-firstName', 'Μαριάννα');
  await page.fill('#ac-pf-email', 'marianna@example.gr');
  await page.fill('#ac-pf-phone', '210 123 4567');
  await page.fill('#ac-pf-company', 'Μοδα ΑΕ');
  await page.fill('#ac-pf-vatNumber', '090000045');
  await page.locator('[data-profile-save]').click();
  await expect(page.locator('.toast-elan')).toContainText('αποθηκεύτηκε');
  await page.reload();
  await expect(page.locator('#ac-pf-firstName')).toHaveValue('Μαριάννα');
  await expect(page.locator('#ac-pf-email')).toHaveValue('marianna@example.gr');
  await expect(page.locator('#ac-pf-phone')).toHaveValue('2101234567');
  await expect(page.locator('#ac-pf-company')).toHaveValue('Μοδα ΑΕ');
  await expect(page.locator('#ac-pf-vatNumber')).toHaveValue('090000045');
  const c = await dbGet(page, 'customers', id);
  expect(c.id).toBe(id);
  expect(c.email).toBe('marianna@example.gr');
  expect(c.orderCount).toBe(1);
  await go(page, '#/account/orders');
  await expect(page.locator('[data-order-row]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('profile email cannot collide with another local profile', async ({ page }) => {
  await boot(page);
  const a = await place(page, { email: 'maria@example.gr' });
  await place(page, { email: 'nikos@example.gr', firstName: 'Νίκος', lastName: 'Γεωργίου', prod: prodB });
  await page.evaluate((id) => localStorage.setItem('elan.activeCustomerId', id), a.customerId);
  await go(page, '#/account/profile');
  await page.fill('#ac-pf-email', 'nikos@example.gr');
  await page.locator('[data-profile-save]').click();
  await expect(page.locator('[data-profile-form] [data-error-for="email"]')).toContainText('υπάρχει ήδη');
  expect((await dbGet(page, 'customers', a.customerId)).email).toBe('maria@example.gr');
});

test('saved addresses: add, edit, delete, set default persist; checkout reuses the default', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page);
  const id = o.customerId;
  await go(page, '#/account/addresses');
  await expect(page.locator('[data-address-card]')).toHaveCount(0);
  await expect(page.locator('[data-addresses-empty]')).toBeVisible();

  await page.locator('[data-address-add]').click();
  await page.locator('[data-address-save]').click();
  await expect(page.locator('[data-address-form] [data-error-for="address"]')).not.toBeEmpty();
  await expect(page.locator('[data-address-form] [data-error-for="postalCode"]')).not.toBeEmpty();
  await expect(page.locator('[data-address-form] [data-error-for="region"]')).not.toBeEmpty();
  await page.fill('#ac-ad-address', 'Λεωφόρος Καλοκαιρινού 10');
  await page.fill('#ac-ad-city', 'Ηράκλειο');
  await page.fill('#ac-ad-postalCode', '7120');
  await page.selectOption('#ac-ad-region', 'Κρήτη');
  await page.locator('[data-address-save]').click();
  await expect(page.locator('[data-address-form] [data-error-for="postalCode"]')).toContainText('5 ψηφία');
  await page.fill('#ac-ad-postalCode', '71201');
  await page.locator('[data-address-save]').click();
  await expect(page.locator('[data-address-card]')).toHaveCount(1);
  await expect(page.locator('[data-address-card]').first().locator('[data-default-badge]')).toBeVisible();

  await page.locator('[data-address-add]').click();
  await page.fill('#ac-ad-address', 'Ερμού 99');
  await page.fill('#ac-ad-city', 'Πάτρα');
  await page.fill('#ac-ad-postalCode', '26221');
  await page.selectOption('#ac-ad-region', 'Δυτική Ελλάδα');
  await page.locator('[data-address-save]').click();
  const cards = page.locator('[data-address-card]');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).locator('[data-default-badge]')).toHaveCount(0);

  await cards.nth(1).locator('[data-address-default]').click();
  await expect(cards.nth(1).locator('[data-default-badge]')).toBeVisible();
  await expect(cards.nth(0).locator('[data-default-badge]')).toHaveCount(0);

  await cards.nth(1).locator('[data-address-edit]').click();
  await expect(page.locator('#ac-ad-address')).toHaveValue('Ερμού 99');
  await page.fill('#ac-ad-city', 'Πάτρα Κέντρο');
  await page.locator('[data-address-save]').click();
  await expect(cards.nth(1)).toContainText('Πάτρα Κέντρο');

  await page.reload();
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toContainText('Πάτρα Κέντρο');
  await expect(cards.nth(1).locator('[data-default-badge]')).toBeVisible();

  // checkout reuses the default (Πάτρα) address
  await page.evaluate(async (sku) => (await import('/assets/js/services/cart.js')).addLine(sku, 1), stocked(prodB, 3).sku);
  await page.goto('/#/checkout');
  await page.reload();
  await page.locator('[data-fill-saved]').click();
  await expect(page.locator('#co-address')).toHaveValue('Ερμού 99');
  await expect(page.locator('#co-city')).toHaveValue('Πάτρα Κέντρο');
  await expect(page.locator('#co-postalCode')).toHaveValue('26221');
  await expect(page.locator('#co-region')).toHaveValue('Δυτική Ελλάδα');

  // delete the default, the other becomes default
  await go(page, '#/account/addresses');
  await cards.nth(1).locator('[data-address-delete]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('[data-default-badge]')).toBeVisible();
  await page.reload();
  await expect(cards).toHaveCount(1);
  const c = await dbGet(page, 'customers', id);
  expect(c.savedAddresses).toHaveLength(1);
  expect(c.savedAddresses[0].isDefault).toBe(true);
  expect(errors).toEqual([]);
});

test('newsletter preferences persist and are labelled demo', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page);
  await go(page, '#/account/newsletter');
  await expect(page.locator('[data-newsletter-demo]')).toContainText('δεν αποστέλλονται πραγματικά email');
  await expect(page.locator('#ac-nl-enabled')).not.toBeChecked();
  await expect(page.locator('#ac-nl-collections')).toBeDisabled();
  await page.check('#ac-nl-enabled');
  await page.check('#ac-nl-offers');
  await page.locator('[data-newsletter-save]').click();
  await expect(page.locator('.toast-elan')).toContainText('αποθηκεύ');
  await page.reload();
  await expect(page.locator('#ac-nl-enabled')).toBeChecked();
  await expect(page.locator('#ac-nl-offers')).toBeChecked();
  await expect(page.locator('#ac-nl-collections')).not.toBeChecked();
  const c = await dbGet(page, 'customers', o.customerId);
  expect(c.newsletter).toBe(true);
  expect(c.newsletterTopics).toEqual({ collections: false, offers: true });
  expect(errors).toEqual([]);
});

test('wishlist tab is embedded in the account layout and lists wished products', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.goto('/#/catalog');
  const card = page.locator('.product-card[data-product-id]').first();
  const id = await card.getAttribute('data-product-id');
  await card.locator('[data-wish]').click();
  await go(page, '#/account/wishlist');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Αγαπημένα');
  await expect(page.locator('[data-page="account"] [data-account-nav]')).toBeVisible();
  await expect(page.locator('[data-account-notice]')).toBeVisible();
  await expect(page.locator(`.product-card[data-product-id="${id}"]`)).toBeVisible();
  await expect(page.locator('[data-account-nav] a[aria-current="page"]')).toHaveText(/Αγαπημένα/);
  expect(errors).toEqual([]);
});

test('nav lists all sections; focus lands on the h1 after tab switches', async ({ page }) => {
  await boot(page);
  await place(page);
  await go(page, '#/account');
  const nav = page.locator('[data-account-nav]');
  await expect(nav.locator('a')).toHaveText([/Επισκόπηση/, /Παραγγελίες/, /Προφίλ/, /Διευθύνσεις/, /Αγαπημένα/, /Newsletter/]);
  for (const t of ['orders', 'profile', 'addresses', 'wishlist', 'newsletter', 'overview']) {
    await nav.locator(`a[data-tab="${t}"]`).click();
    await expect(page.locator('h1')).toBeFocused();
    await expect(nav.locator(`a[data-tab="${t}"]`)).toHaveAttribute('aria-current', 'page');
  }
});

test('no horizontal overflow on account subpages at 390px and orders at 320px', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  const o = await place(page);
  await place(page, { prod: prodB, ship: 'pickup', pay: 'iris', qty: 2 });
  await page.goto('/#/catalog');
  await page.locator('.product-card [data-wish]').first().click();
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const h of ['#/account', '#/account/orders', `#/account/orders/${o.id}`, '#/account/profile', '#/account/addresses', '#/account/newsletter', '#/account/wishlist', '#/account/orders/nope']) {
    await go(page, h);
    expect(await over(), h).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await go(page, '#/account/orders');
  expect(await over()).toBeLessThanOrEqual(0);
  await go(page, `#/account/orders/${o.id}`);
  expect(await over()).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
