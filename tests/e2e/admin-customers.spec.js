const { test, expect } = require('./support/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const sample = JSON.parse(fs.readFileSync(path.join(root, 'data/sample-data.json'), 'utf8'));
const active = products.filter((p) => p.status !== 'archived');
const stocked = (p, min) => p.variants.find((v) => v.stock >= min && !v.archived);
const [P1, P2] = active.filter((p) => stocked(p, 5)).slice(0, 2);
const SKU1 = stocked(P1, 5).sku;
const SKU2 = stocked(P2, 5).sku;

const LIST = '[data-admin-view="customers"]';
const PROFILE = '[data-admin-view="customer-detail"]';
const norm = (s) => String(s).replace(/\s/g, ' ');
const money = (c) => norm(new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100));
const TERMINAL = ['cancelled', 'returned'];
const CANCELLED_CUSTOMER = 'c-16bz676rt72'; // has a cancelled order in the sample data

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const dbGet = (page, store, key) => page.evaluate(async ([s, k]) => (await import('/assets/js/db.js')).get(s, k), [store, key]);
const dbAll = (page, store) => page.evaluate(async (s) => (await import('/assets/js/db.js')).getAll(s), store);
const dbPut = (page, store, val) => page.evaluate(async ([s, v]) => (await import('/assets/js/db.js')).put(s, v), [store, val]);

async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}
async function openList(page) {
  await page.goto('/#/admin/customers');
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
}
async function openProfile(page, id) {
  await page.goto(`/#/admin/customers/${id}`);
  await expect(page.locator(PROFILE)).toHaveAttribute('data-ready', 'true');
}
/** Spend recomputed in the test from the stored orders: every status counts as an order, cancelled/returned are not spend. */
function expectedFor(orders, id) {
  const mine = orders.filter((o) => o.customerId === id);
  const counted = mine.filter((o) => !TERMINAL.includes(o.fulfillmentStatus));
  return {
    orders: mine.length,
    spend: counted.reduce((s, o) => s + o.totals.totalCents, 0),
    counted: counted.length,
    mine,
  };
}

let seq = 0;
async function place(page, { email, lines = [[SKU1, 2], [SKU2, 1]], first = 'Μαρίνα', last = 'Δοκιμή' } = {}) {
  seq += 1;
  const mail = email || `marina.${Date.now()}.${seq}@example.gr`;
  return page.evaluate(async (a) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    for (const [sku, qty] of a.lines) await cart.addLine(sku, qty);
    return co.placeOrder({
      form: { firstName: a.first, lastName: a.last, email: a.mail, phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'cod', requestId: `r-${Math.random()}`,
    });
  }, { lines, first, last, mail });
}
/** Insert plain customers (no sample flag) so the list needs a second page. */
async function addOwnCustomers(page, n) {
  await page.evaluate(async (count) => {
    const db = await import('/assets/js/db.js');
    for (let i = 1; i <= count; i += 1) {
      await db.put('customers', {
        id: `c-own-${i}`, email: `own${i}@example.gr`, firstName: `Ζήνων${i}`, lastName: `Τεστ${String(i).padStart(2, '0')}`, phone: '6900000000', company: '', vatNumber: '',
        createdAt: new Date(Date.now() + i * 1000).toISOString(), updatedAt: new Date().toISOString(), newsletter: i % 2 === 0, newsletterTopics: { collections: false, offers: false },
        savedAddresses: [], orderCount: 0, totalCents: 0, lastOrderAt: null,
      });
    }
  }, n);
}
const rowIds = (page) => page.locator('tr[data-customer-id]').evaluateAll((rs) => rs.map((r) => r.dataset.customerId));

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

test('fixtures', () => {
  expect(SKU1).toBeTruthy();
  expect(SKU2).toBeTruthy();
  expect(sample.customers.length).toBe(17);
});

test('the list shows the seeded sample customers with spend COMPUTED from the orders (cancelled/returned excluded)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openList(page);
  await expect(page.locator('[data-admin-view="placeholder"]')).toHaveCount(0);
  await expect(page.locator('[data-count]')).toHaveAttribute('data-total', String(sample.customers.length));
  await expect(page.locator('tr[data-customer-id]')).toHaveCount(sample.customers.length);
  const orders = await dbAll(page, 'orders');
  const customers = await dbAll(page, 'customers');
  let lowerThanStored = 0;
  for (const c of customers) {
    const exp = expectedFor(orders, c.id);
    const r = page.locator(`tr[data-customer-id="${c.id}"]`);
    await expect(r).toHaveAttribute('data-orders', String(exp.orders));
    await expect(r).toHaveAttribute('data-spend', String(exp.spend));
    await expect(r.locator('[data-cell="orders"]')).toHaveText(String(exp.orders));
    await expect(r.locator('[data-cell="spend"]')).toHaveText(money(exp.spend));
    await expect(r.locator('[data-sample-badge]')).toHaveText('Δείγμα');
    if (exp.spend < c.totalCents) lowerThanStored += 1;
  }
  expect(lowerThanStored).toBeGreaterThan(0);
  // the customer with a cancelled order shows less than the stored aggregate, which includes it
  const stored = customers.find((c) => c.id === CANCELLED_CUSTOMER);
  const exp = expectedFor(orders, CANCELLED_CUSTOMER);
  expect(orders.some((o) => o.customerId === CANCELLED_CUSTOMER && o.fulfillmentStatus === 'cancelled')).toBe(true);
  expect(exp.spend).toBeLessThan(stored.totalCents);
  await expect(page.locator(`tr[data-customer-id="${CANCELLED_CUSTOMER}"] [data-cell="spend"]`)).toHaveText(money(exp.spend));
  await expect(page.locator(`tr[data-customer-id="${CANCELLED_CUSTOMER}"] [data-cell="spend"]`)).not.toHaveText(money(stored.totalCents));
  await expect(page.locator(`tr[data-customer-id="${CANCELLED_CUSTOMER}"] [data-cell="orders"]`)).toHaveText(String(exp.orders));
  // the explanation is visible and exposed as a tooltip
  await expect(page.locator('[data-count]')).toContainText('Δεν περιλαμβάνονται ακυρωμένες/επιστραμμένες');
  await expect(page.locator('th[title*="ακυρωμένες/επιστραμμένες"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('search by name (accent/case-insensitive, either order), email and phone; sort; filters', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openList(page);
  const customers = await dbAll(page, 'customers');
  const orders = await dbAll(page, 'orders');
  const target = customers.find((c) => c.id === CANCELLED_CUSTOMER);
  const matching = async (n) => {
    await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(n));
    await expect(page.locator('tr[data-customer-id]')).toHaveCount(n);
  };
  const search = async (q) => {
    await page.fill('#cu-q', q);
    await expect(page.locator('[data-count]')).toHaveAttribute('data-query', q);
  };
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // expected hits, computed in the test (not by the app): name in either order, email, or phone digits
  const hits = (q) => customers.filter((c) => {
    const digits = q.replace(/[^0-9]/g, '').replace(/^30/, '');
    return [c.email, `${c.firstName} ${c.lastName}`, `${c.lastName} ${c.firstName}`].some((v) => fold(v).includes(fold(q)))
      || (digits.length >= 3 && c.phone.includes(digits));
  }).length;
  for (const q of [target.email, target.email.toUpperCase(), fold(`${target.firstName} ${target.lastName}`), `${target.lastName} ${target.firstName}`.toUpperCase(), target.phone, `+30 ${target.phone.slice(0, 3)} ${target.phone.slice(3)}`]) {
    await search(q);
    expect(hits(q), q).toBeGreaterThan(0);
    await matching(hits(q));
    await expect(page.locator(`tr[data-customer-id="${CANCELLED_CUSTOMER}"]`), q).toBeVisible();
  }
  await search('zzzz-nobody');
  await matching(0);
  await expect(page.locator('[data-empty]')).toBeVisible();
  await page.locator('[data-clear-filters]').click();
  await matching(customers.length);
  await expect(page.locator('#cu-q')).toHaveValue('');

  // sort
  const ids = () => rowIds(page);
  await page.selectOption('#cu-sort', 'spend');
  const spendOf = (id) => expectedFor(orders, id).spend;
  let got = await ids();
  expect(got.map(spendOf)).toEqual([...got.map(spendOf)].sort((a, b) => b - a));
  await page.selectOption('#cu-sort', 'orders');
  got = await ids();
  const ordersOf = (id) => expectedFor(orders, id).orders;
  expect(got.map(ordersOf)).toEqual([...got.map(ordersOf)].sort((a, b) => b - a));
  await page.selectOption('#cu-sort', 'newest');
  got = await ids();
  const created = Object.fromEntries(customers.map((c) => [c.id, c.createdAt]));
  expect(got.map((id) => created[id])).toEqual([...got.map((id) => created[id])].sort().reverse());
  await page.selectOption('#cu-sort', 'name');
  got = await ids();
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const nameKey = (id) => `${byId[id].lastName} ${byId[id].firstName}`.trim();
  const expectedNames = await page.evaluate((keys) => [...keys].sort((a, b) => a.localeCompare(b, 'el')), got.map(nameKey));
  expect(got.map(nameKey)).toEqual(expectedNames);

  // filters
  await page.selectOption('#cu-orders', 'with');
  await matching(customers.filter((c) => ordersOf(c.id) > 0).length);
  await page.selectOption('#cu-orders', 'without');
  await matching(customers.filter((c) => ordersOf(c.id) === 0).length);
  expect(customers.filter((c) => ordersOf(c.id) === 0).length).toBeGreaterThan(0);
  await page.selectOption('#cu-orders', '');
  await page.selectOption('#cu-news', 'yes');
  await matching(customers.filter((c) => c.newsletter).length);
  await expect(page.locator('tr[data-customer-id][data-newsletter="no"]')).toHaveCount(0);
  await expect(page.locator('tr[data-customer-id] [data-news-badge="yes"]')).toHaveCount(customers.filter((c) => c.newsletter).length);
  await page.selectOption('#cu-news', 'no');
  await matching(customers.filter((c) => !c.newsletter).length);
  await page.selectOption('#cu-news', '');
  // sample vs own: place an order as a brand-new customer
  const o = await place(page);
  await page.reload();
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
  await page.selectOption('#cu-origin', 'own');
  await matching(1);
  await expect(page.locator(`tr[data-customer-id="${o.customerId}"]`)).toBeVisible();
  await expect(page.locator('[data-sample-badge]')).toHaveCount(0);
  await page.selectOption('#cu-origin', 'sample');
  await matching(sample.customers.length);
  await expect(page.locator('[data-sample-badge]')).toHaveCount(sample.customers.length);
  // filters combine, and survive a visit to a profile and back
  await page.selectOption('#cu-news', 'yes');
  await page.selectOption('#cu-orders', 'with');
  await matching(customers.filter((c) => c.newsletter && ordersOf(c.id) > 0).length);
  await page.locator('tr[data-customer-id] a.admin-cu-name').first().click();
  await expect(page.locator(PROFILE)).toHaveAttribute('data-ready', 'true');
  await page.goBack();
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#cu-news')).toHaveValue('yes');
  await expect(page.locator('#cu-origin')).toHaveValue('sample');
  expect(errors).toEqual([]);
});

test('pagination: 25 per page with a range, previous/next and the page indicator', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await addOwnCustomers(page, 10);
  await openList(page);
  await expect(page.locator('[data-count]')).toHaveAttribute('data-total', '27');
  await expect(page.locator('tr[data-customer-id]')).toHaveCount(25);
  await expect(page.locator('[data-range]')).toHaveText('Εμφάνιση 1–25 από 27');
  await expect(page.locator('[data-page-info]')).toHaveText('Σελίδα 1 από 2');
  await expect(page.locator('[data-goto]').first()).toBeDisabled();
  const first = await rowIds(page);
  await page.locator('[data-goto="2"]').click();
  await expect(page.locator('tr[data-customer-id]')).toHaveCount(2);
  await expect(page.locator('[data-range]')).toHaveText('Εμφάνιση 26–27 από 27');
  await expect(page.locator('[data-page-info]')).toHaveText('Σελίδα 2 από 2');
  const second = await rowIds(page);
  expect(new Set([...first, ...second]).size).toBe(27);
  await expect(page.locator('[data-goto="3"]')).toBeDisabled();
  await page.locator('[data-goto="1"]').click();
  await expect(page.locator('tr[data-customer-id]')).toHaveCount(25);
  // a new search returns to page 1
  await page.locator('[data-goto="2"]').click();
  await page.fill('#cu-q', 'Ζήνων');
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', '10');
  await expect(page.locator('[data-range]')).toHaveText('Εμφάνιση 1–10 από 10');
  expect(errors).toEqual([]);
});

test('CSV export: the filtered set, Greek names, computed spend, RFC 4180 and formula-injection defence', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openList(page);
  const customers = await dbAll(page, 'customers');
  const orders = await dbAll(page, 'orders');
  // tricky values: a formula-looking name with a quote and a comma in the last name
  const victim = customers.find((c) => c.id === CANCELLED_CUSTOMER);
  await dbPut(page, 'customers', { ...victim, firstName: '=HYPERLINK("http://x")', lastName: 'Ντελής, Ο', company: '@evil' });
  await page.reload();
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
  await page.selectOption('#cu-news', 'yes');
  const nl = (await dbAll(page, 'customers')).filter((c) => c.newsletter);
  await expect(page.locator('[data-count]')).toHaveAttribute('data-matching', String(nl.length));
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-csv]').click()]);
  expect(download.suggestedFilename()).toMatch(/^elan-customers-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text.charCodeAt(0)).toBe(0xFEFF);
  expect(text).toContain('\r\n');
  const { parseCsv } = await import(pathToFileURL(path.join(root, 'tests/unit/csv-helper.mjs')).href);
  const table = parseCsv(text);
  expect(table.length - 1).toBe(nl.length);
  const h = (n) => table[0].indexOf(n);
  expect(table[0]).toEqual(expect.arrayContaining(['Όνομα', 'Επώνυμο', 'Email', 'Παραγγελίες', 'Δαπάνη']));
  const byId = Object.fromEntries(table.slice(1).map((r) => [r[h('ID')], r]));
  for (const c of nl) {
    const r = byId[c.id];
    expect(r, c.id).toBeTruthy();
    const exp = expectedFor(orders, c.id);
    expect(r[h('Παραγγελίες')]).toBe(String(exp.orders));
    expect(r[h('Δαπάνη')]).toBe((exp.spend / 100).toFixed(2));
    expect(r[h('Newsletter')]).toBe('Ναι');
    expect(r[h('Δείγμα')]).toBe('Ναι');
  }
  const v = byId[CANCELLED_CUSTOMER];
  expect(v[h('Όνομα')]).toBe("'=HYPERLINK(\"http://x\")");
  expect(v[h('Επώνυμο')]).toBe('Ντελής, Ο');
  expect(v[h('Εταιρεία')]).toBe("'@evil");
  // Greek text survives
  expect(table.slice(1).some((r) => /[Α-Ωα-ω]/.test(r[h('Όνομα')]))).toBe(true);
  // an empty result disables the export
  await page.fill('#cu-q', 'zzzz-nobody');
  await expect(page.locator('[data-export-csv]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('profile: computed stats, status counts, order history linking to the admin order pages', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openList(page);
  const orders = await dbAll(page, 'orders');
  const customers = await dbAll(page, 'customers');
  const c = customers.find((x) => x.id === CANCELLED_CUSTOMER);
  await page.locator(`tr[data-customer-id="${CANCELLED_CUSTOMER}"] a.admin-cu-name`).click();
  await expect(page).toHaveURL(new RegExp(`#/admin/customers/${CANCELLED_CUSTOMER}$`));
  await expect(page.locator(PROFILE)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('h1')).toHaveText(`${c.firstName} ${c.lastName}`);
  await expect(page.locator('[data-sample-badge]').first()).toBeVisible();
  const exp = expectedFor(orders, CANCELLED_CUSTOMER);
  await expect(page.locator('[data-stat="orders"]')).toHaveText(String(exp.orders));
  await expect(page.locator('[data-stat="spend"]')).toHaveText(money(exp.spend));
  await expect(page.locator('[data-stat="spend"]')).not.toHaveText(money(c.totalCents));
  await expect(page.locator('[data-stat="average"]')).toHaveText(money(Math.round(exp.spend / exp.counted)));
  const times = exp.mine.map((o) => new Date(o.createdAt).getTime());
  const day = (t) => norm(new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t)));
  await expect(page.locator('[data-stat="first"]')).toHaveText(day(Math.min(...times)));
  await expect(page.locator('[data-stat="last"]')).toHaveText(day(Math.max(...times)));
  await expect(page.locator('[data-spend-note]')).toContainText('Δεν περιλαμβάνονται ακυρωμένες/επιστραμμένες');
  const byStatus = {};
  for (const o of exp.mine) byStatus[o.fulfillmentStatus] = (byStatus[o.fulfillmentStatus] || 0) + 1;
  for (const [s, n] of Object.entries(byStatus)) await expect(page.locator(`[data-status-count="${s}"]`)).toHaveAttribute('data-count', String(n));
  await expect(page.locator('[data-status-count="cancelled"]')).toHaveCount(1);
  expect(await page.locator('[data-status-count]').count()).toBe(Object.keys(byStatus).length);
  // history
  await expect(page.locator('tr[data-order-id]')).toHaveCount(exp.orders);
  const hrefs = await page.locator('[data-orders-table] a.admin-order-link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs.sort()).toEqual(exp.mine.map((o) => `#/admin/orders/${o.id}`).sort());
  const cancelled = exp.mine.find((o) => o.fulfillmentStatus === 'cancelled');
  await expect(page.locator(`tr[data-order-id="${cancelled.id}"] .admin-badge.st-cancelled`)).toBeVisible();
  // newest first
  const listed = await page.locator('tr[data-order-id]').evaluateAll((rs) => rs.map((r) => r.dataset.orderId));
  expect(listed).toEqual([...exp.mine].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((o) => o.id));
  await page.locator(`tr[data-order-id="${cancelled.id}"] a.admin-order-link`).click();
  await expect(page.locator('[data-admin-view="order-detail"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-order-ref]')).toHaveText(cancelled.id);
  // saved addresses (read only)
  await openProfile(page, customers.find((x) => (x.savedAddresses || []).length)?.id);
  await expect(page.locator('[data-addresses] li').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('profile with no orders: zeros, empty history; unknown id: friendly not-found inside the admin layout', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const noOrders = sample.customers.find((c) => !sample.orders.some((o) => o.customerId === c.id));
  await openProfile(page, noOrders.id);
  await expect(page.locator('[data-stat="orders"]')).toHaveText('0');
  await expect(page.locator('[data-stat="spend"]')).toHaveText(money(0));
  await expect(page.locator('[data-stat="average"]')).toHaveText('—');
  await expect(page.locator('[data-orders-empty]')).toBeVisible();
  await expect(page.locator('[data-status-counts]')).toHaveCount(0);

  await page.goto('/#/admin/customers/c-does-not-exist');
  await expect(page.locator('[data-admin-view="customer-not-found"]')).toBeVisible();
  await expect(page.locator('[data-customer-not-found]')).toContainText('c-does-not-exist');
  await expect(page.locator('[data-admin-shell]')).toBeVisible();
  await expect(page.locator('[data-page="not-found"]')).toHaveCount(0);
  await page.locator('[data-customer-not-found] a').click();
  await expect(page.locator(LIST)).toHaveAttribute('data-ready', 'true');
  expect(errors).toEqual([]);
});

test('edit profile persists after reload; the id and the order link never change', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const customers = await dbAll(page, 'customers');
  const before = customers.find((c) => c.id === CANCELLED_CUSTOMER);
  const ordersBefore = (await dbAll(page, 'orders')).filter((o) => o.customerId === before.id).length;
  await openProfile(page, before.id);
  await page.fill('#cf-firstName', '  Αριάδνη ');
  await page.fill('#cf-lastName', 'Ξυλούρη');
  await page.fill('#cf-email', '  Ariadni.Xylouri@Example.GR ');
  await page.fill('#cf-phone', '+30 691 234 5678');
  await page.fill('#cf-company', 'Ξυλούρη ΙΚΕ');
  await page.fill('#cf-vatNumber', 'EL 094259216');
  await page.locator('#cf-newsletter').setChecked(!before.newsletter);
  await page.locator('[data-save]').click();
  await expect(page.locator('.toast-elan').last()).toContainText('αποθηκεύτηκαν');
  await expect(page.locator('h1')).toHaveText('Αριάδνη Ξυλούρη');
  await expect(page.locator('#cf-email')).toHaveValue('ariadni.xylouri@example.gr');
  await expect(page.locator('#cf-phone')).toHaveValue('6912345678');
  const stored = await dbGet(page, 'customers', before.id);
  expect(stored).toMatchObject({
    id: before.id, firstName: 'Αριάδνη', lastName: 'Ξυλούρη', email: 'ariadni.xylouri@example.gr', phone: '6912345678', company: 'Ξυλούρη ΙΚΕ', vatNumber: '094259216', newsletter: !before.newsletter,
  });
  // nothing else was touched
  expect(stored.sample).toBe(true);
  expect(stored.orderCount).toBe(before.orderCount);
  expect(stored.totalCents).toBe(before.totalCents);
  expect(stored.savedAddresses).toEqual(before.savedAddresses);
  expect(stored.createdAt).toBe(before.createdAt);
  await page.reload();
  await expect(page.locator(PROFILE)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#cf-firstName')).toHaveValue('Αριάδνη');
  await expect(page.locator('#cf-vatNumber')).toHaveValue('094259216');
  await expect(page.locator('#cf-newsletter')).toBeChecked({ checked: !before.newsletter });
  await expect(page.locator('code[data-customer-id]')).toHaveText(before.id);
  await expect(page.locator('tr[data-order-id]')).toHaveCount(ordersBefore);
  // no duplicate customer was created and the list shows the new name
  expect((await dbAll(page, 'customers')).length).toBe(customers.length);
  await openList(page);
  await expect(page.locator(`tr[data-customer-id="${before.id}"] .admin-cu-name`)).toHaveText('Αριάδνη Ξυλούρη');
  await expect(page.locator(`tr[data-customer-id="${before.id}"]`)).toContainText('ariadni.xylouri@example.gr');
  // clearing the optional fields is allowed
  await openProfile(page, before.id);
  await page.fill('#cf-company', '');
  await page.fill('#cf-vatNumber', '');
  await page.locator('[data-save]').click();
  // (the first save's «αποθηκεύτηκαν» toast can still be on screen: wait for the stored record itself)
  await expect.poll(async () => { const c = await dbGet(page, 'customers', before.id); return [c.company, c.vatNumber]; }).toEqual(['', '']);
  expect(errors).toEqual([]);
});

test('edit validation: bad email, duplicate email (case/whitespace), bad AFM, bad phone, missing names; nothing is saved', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const customers = await dbAll(page, 'customers');
  const me = customers.find((c) => c.id === CANCELLED_CUSTOMER);
  const other = customers.find((c) => c.id !== me.id);
  await openProfile(page, me.id);
  const err = (key) => page.locator(`[data-error-for="${key}"]`);
  const submit = () => page.locator('[data-save]').click();
  const unchanged = async () => expect(await dbGet(page, 'customers', me.id)).toEqual(me);

  await page.fill('#cf-email', 'not-an-email');
  await submit();
  await expect(page.locator('#cf-email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#cf-email')).toBeFocused();
  await expect(err('email')).not.toBeEmpty();
  await expect(page.locator('#cf-email')).toHaveAttribute('aria-describedby', /cf-email-err/);
  await unchanged();

  // duplicate of another customer, different case and surrounding whitespace
  await page.fill('#cf-email', `   ${other.email.toUpperCase()}  `);
  await submit();
  await expect(err('email')).toContainText('ήδη');
  await expect(page.locator('#cf-email')).toHaveAttribute('aria-invalid', 'true');
  await unchanged();
  // typing clears that field's error
  await page.fill('#cf-email', me.email);
  await expect(page.locator('#cf-email')).not.toHaveAttribute('aria-invalid', 'true');

  await page.fill('#cf-vatNumber', '123456789'); // 9 digits but a wrong check digit
  await page.fill('#cf-phone', '12345');
  await page.fill('#cf-firstName', '');
  await submit();
  await expect(err('vatNumber')).toContainText('ΑΦΜ');
  await expect(err('phone')).not.toBeEmpty();
  await expect(err('firstName')).not.toBeEmpty();
  await expect(page.locator('#cf-firstName')).toBeFocused(); // first invalid field in form order
  await unchanged();
  await page.fill('#cf-vatNumber', '12345');
  await page.fill('#cf-firstName', me.firstName);
  await page.fill('#cf-phone', me.phone);
  await submit();
  await expect(err('vatNumber')).toContainText('9 ψηφία');
  await unchanged();
  // the same customer's own email, re-saved with other case/whitespace, is not a duplicate
  await page.fill('#cf-vatNumber', '');
  await page.fill('#cf-email', `  ${me.email.toUpperCase()} `);
  await submit();
  await expect(page.locator('.toast-elan').last()).toContainText('αποθηκεύτηκαν');
  expect((await dbGet(page, 'customers', me.id)).email).toBe(me.email.toLowerCase());
  // service level: unknown id and tampered fields
  const r = await page.evaluate(async (id) => {
    const m = await import('/assets/js/services/customers.js');
    const out = {};
    try { await m.updateCustomerAdmin('c-missing', { firstName: 'Νίκη' }); } catch (e) { out.missing = e.code; }
    const upd = await m.updateCustomerAdmin(id, { id: 'hacked', orderCount: 77, totalCents: 1, sample: false, firstName: 'Νίκη' });
    out.id = upd.id; out.orderCount = upd.orderCount; out.sample = upd.sample;
    return out;
  }, me.id);
  expect(r).toMatchObject({ missing: 'NOT_FOUND', id: me.id, orderCount: me.orderCount, sample: true });
  expect(await dbGet(page, 'customers', 'hacked')).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a new storefront checkout appears in the customer history and stats; cancelling it lowers the spend', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const customers = await dbAll(page, 'customers');
  const c = customers.find((x) => x.id === 'c-143daqcn7g1') || customers[5];
  await openProfile(page, c.id);
  const beforeOrders = Number(await page.locator('[data-stat="orders"]').textContent());
  const beforeSpend = Number(await page.locator('[data-stat="spend"]').getAttribute('data-value'));
  // the same email attaches the order to the existing customer
  const o = await place(page, { email: c.email, first: c.firstName, last: c.lastName });
  expect(o.customerId).toBe(c.id);
  await page.reload();
  await expect(page.locator(PROFILE)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-stat="orders"]')).toHaveText(String(beforeOrders + 1));
  await expect(page.locator('[data-stat="spend"]')).toHaveText(money(beforeSpend + o.totals.totalCents));
  await expect(page.locator('tr[data-order-id]').first()).toHaveAttribute('data-order-id', o.id);
  await expect(page.locator('tr[data-order-id]').first().locator('.admin-badge.st-pending')).toBeVisible();
  await expect(page.locator('[data-status-count="pending"]')).toBeVisible();
  // cancel it from the admin order page: the order still counts, the spend does not
  await page.locator(`tr[data-order-id="${o.id}"] a.admin-order-link`).click();
  await expect(page.locator('[data-admin-view="order-detail"]')).toHaveAttribute('data-ready', 'true');
  await page.locator('[data-cancel-order]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator('[data-fulfillment-badge="cancelled"]')).toBeVisible();
  await page.locator('[data-customer-link]').click();
  await expect(page.locator(PROFILE)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-stat="orders"]')).toHaveText(String(beforeOrders + 1));
  await expect(page.locator('[data-stat="spend"]')).toHaveText(money(beforeSpend));
  await expect(page.locator('[data-status-count="cancelled"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the order page links to the real customer profile; an order whose customer record is gone shows its snapshot gracefully', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const o = await place(page, { first: 'Φωτεινή', last: 'Αγνώστου' });
  await page.goto(`/#/admin/orders/${o.id}`);
  await expect(page.locator('[data-admin-view="order-detail"]')).toHaveAttribute('data-ready', 'true');
  await page.locator('[data-customer-link]').click();
  await expect(page).toHaveURL(new RegExp(`#/admin/customers/${o.customerId}$`));
  await expect(page.locator(PROFILE)).toBeVisible();
  await expect(page.locator('[data-admin-view="placeholder"]')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveText('Φωτεινή Αγνώστου');
  await expect(page.locator('tr[data-order-id]')).toHaveCount(1);
  // delete the customer record behind the order's back
  await page.evaluate(async (id) => (await import('/assets/js/db.js')).del('customers', id), o.customerId);
  await page.goto(`/#/admin/orders/${o.id}`);
  await expect(page.locator('[data-admin-view="order-detail"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-customer-name]')).toHaveText('Φωτεινή Αγνώστου');
  await expect(page.locator('[data-customer-card]')).toContainText(o.customer.email);
  await expect(page.locator('[data-customer-link]')).toHaveCount(0);
  await expect(page.locator('[data-customer-gone]')).toContainText('δεν υπάρχει πλέον');
  await page.goto(`/#/admin/customers/${o.customerId}`);
  await expect(page.locator('[data-admin-view="customer-not-found"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('no horizontal overflow on the list and the profile (also with errors and a long name) at 320/390/768/1440', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const customers = await dbAll(page, 'customers');
  const c = customers.find((x) => x.id === CANCELLED_CUSTOMER);
  await dbPut(page, 'customers', { ...c, firstName: 'Παναγιώτα-Μαρία-Αικατερίνη', lastName: 'Παπαδοπούλου-Χατζηγεωργακοπούλου', email: 'panagiota.maria.aikaterini.papadopoulou.chatzigeorgakopoulou@example-long-domain.gr' });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openList(page);
    expect(await overflow(page), `list ${width}`).toBeLessThanOrEqual(0);
    await openProfile(page, CANCELLED_CUSTOMER);
    expect(await overflow(page), `profile ${width}`).toBeLessThanOrEqual(0);
    await page.fill('#cf-email', 'x');
    await page.fill('#cf-phone', '1');
    await page.fill('#cf-vatNumber', '1');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-error-for="email"]')).not.toBeEmpty();
    expect(await overflow(page), `profile errors ${width}`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await openList(page);
  await page.selectOption('#cu-origin', 'sample');
  expect(await overflow(page), 'filtered list 320').toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
