// Task 18 — resilience: storage unavailable/blocked, first-install fetch failure with retry, broken images,
// corrupted records, very long text, rapid navigation, quota errors, two tabs and Back/Forward through a
// purchase. Every wait is on observable state.
const { test, expect } = require('@playwright/test');
const {
  ACTIVE, PRODUCT, SKU, watch, settle, go, open, scrollThrough, overflowX, overflowCulprits, seedShopper, adminOn, clickNavigating,
} = require('./support/qa');

const STARTUP = '[data-startup-error]';
const errorsOnly = (problems) => problems.filter((p) => !/^requestfailed: .*\/data\/|http 5\d\d: .*\/data\//.test(p));

// ------------------------------------------------------------------ storage unavailable / blocked
const NO_IDB = {
  'indexedDB is undefined': () => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }),
  'indexedDB.open throws (storage disabled)': () => { IDBFactory.prototype.open = () => { throw new DOMException('denied', 'SecurityError'); }; },
  'the open request fails': () => {
    IDBFactory.prototype.open = function open() {
      const req = { result: null, error: null };
      setTimeout(() => { req.error = new DOMException('broken', 'UnknownError'); req.onerror?.(new Event('error')); }, 0);
      return req;
    };
  },
};
for (const [name, script] of Object.entries(NO_IDB)) {
  test(`IndexedDB unavailable (${name}): Greek error screen, never a blank page`, async ({ page }) => {
    const problems = watch(page);
    await page.addInitScript(script);
    await page.goto('/#/catalog');
    await expect(page.locator(STARTUP)).toHaveAttribute('data-startup-error', 'unavailable');
    await expect(page.locator('main#app h1')).toHaveText('Σφάλμα βάσης δεδομένων');
    await expect(page.locator(`${STARTUP} [role="alert"]`)).toContainText('IndexedDB');
    await expect(page.locator(`${STARTUP} [data-retry]`)).toBeVisible();
    await expect(page.locator('.site-header')).toBeVisible(); // the shell still renders around it
    expect(problems).toEqual([]);
  });
}

test('blocked database upgrade shows the «close other tabs» message with a retry', async ({ page }) => {
  const problems = watch(page);
  // simulate another tab holding an old connection: the open request only ever reports «blocked»
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function open() {
      const req = {};
      setTimeout(() => req.onblocked?.(new Event('blocked')), 0);
      return req;
    };
  });
  await page.goto('/#/');
  await expect(page.locator(STARTUP)).toHaveAttribute('data-startup-error', 'blocked');
  await expect(page.locator(`${STARTUP} [role="alert"]`)).toContainText('άλλες καρτέλες');
  await expect(page.locator(`${STARTUP} [data-retry]`)).toBeVisible();
  expect(problems).toEqual([]);
});

test('first install with the catalog fetch failing: clear error, and «Δοκιμή ξανά» recovers once the network is back', async ({ page }) => {
  const problems = watch(page);
  await page.route('**/data/products.json', (r) => r.abort('internetdisconnected'));
  await page.goto('/#/');
  await expect(page.locator(STARTUP)).toHaveAttribute('data-startup-error', 'seed-fetch');
  await expect(page.locator('main#app h1')).toHaveText('Δεν φορτώθηκαν τα δεδομένα του καταστήματος');
  await page.unroute('**/data/products.json');
  await page.locator(`${STARTUP} [data-retry]`).click();
  await expect(page.locator('#app [data-route="/"]')).toBeVisible();
  await settle(page);
  await go(page, '#/catalog');
  await expect(page.locator('.product-card[data-product-id]').first()).toBeVisible();
  expect(errorsOnly(problems).filter((p) => !/products\.json|Failed to load resource/.test(p))).toEqual([]);
});

// ------------------------------------------------------------------ broken images everywhere
test('every image failing: fallback tiles on catalog, PDP, cart, account order and admin list; no error spam', async ({ page }) => {
  test.slow();
  const problems = watch(page, { allowImageFailures: true });
  await open(page, '#/');
  const { orderId } = await seedShopper(page);
  await adminOn(page);
  await page.route('**/assets/images/**', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }));
  const broken = () => page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && getComputedStyle(i).visibility !== 'hidden' && i.getBoundingClientRect().width > 0).map((i) => i.getAttribute('src')));

  await open(page, '#/catalog');
  await scrollThrough(page);
  await expect.poll(() => page.locator('.product-card .product-card-fallback[role="img"]').count()).toBeGreaterThanOrEqual(12);
  await expect.poll(broken).toEqual([]);

  await go(page, `#/product/${PRODUCT.slug}`);
  await expect(page.locator('#app .product-card-fallback[role="img"]').first()).toHaveAttribute('aria-label', PRODUCT.name);
  await scrollThrough(page);
  await expect.poll(broken).toEqual([]);

  await go(page, '#/cart');
  await expect(page.locator('.cart-line .img-fallback, .cart-line .cart-line-fallback').first()).toBeVisible();
  await expect.poll(broken).toEqual([]);

  await go(page, `#/account/orders/${encodeURIComponent(orderId)}`);
  await scrollThrough(page);
  await expect.poll(broken).toEqual([]);
  await expect(page.locator('#app h1')).toBeVisible();

  await go(page, '#/admin/products');
  await expect.poll(() => page.locator('.admin-thumb-empty').count()).toBeGreaterThan(5);
  await expect.poll(broken).toEqual([]);
  expect(problems).toEqual([]);
});

// ------------------------------------------------------------------ corrupted / dangling records
test('corrupted records: product without images/variants/price, cart line to a deleted variant, orders without product or customer', async ({ page }) => {
  test.slow();
  const problems = watch(page);
  await open(page, '#/');
  const { orderId, customerId } = await seedShopper(page);
  await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    // 1. a product record missing images, variants and price
    await db.put('products', { id: 'qa-broken', slug: 'qa-broken', name: 'Προϊόν με ελλιπή στοιχεία', brand: 'ÉLAN', categoryId: 'women', status: 'active', createdAt: new Date().toISOString() });
    // 2. the cart points at a variant that no longer exists (plus the real line)
    const cart = await db.get('carts', 'local');
    await db.put('carts', { ...cart, lines: [...cart.lines, { sku: 'NO-SUCH-SKU', qty: 2 }] });
    // 3. a historical order whose product was deleted and a second one whose customer was deleted
    const orders = await db.getAll('orders');
    const own = orders.find((o) => !o.sample);
    await db.put('orders', { ...own, id: `${own.id}-X`, customerId: 'cust-deleted', lines: own.lines.map((l) => ({ ...l, productId: 'gone-product', sku: 'gone-sku' })) });
  });

  await go(page, '#/catalog/women');
  await expect(page.locator('.product-card[data-product-id="qa-broken"]')).toBeVisible();
  await expect(page.locator('.product-card[data-product-id="qa-broken"] .product-card-fallback, .product-card[data-product-id="qa-broken"] .img-fallback')).toHaveCount(0); // no <img> at all: media area is simply empty
  await expect(page.locator('#app')).not.toContainText('NaN');
  await expect(page.locator('#app')).not.toContainText('undefined');

  await go(page, '#/product/qa-broken');
  await expect(page.locator('#app h1')).toBeVisible();
  await expect(page.locator('#app')).not.toContainText('NaN');

  await go(page, '#/cart');
  await expect(page.locator('.cart-line[data-sku="NO-SUCH-SKU"] [data-problem]')).toBeVisible();
  await expect(page.locator('[data-checkout]')).toBeDisabled();
  await expect(page.locator('#app')).not.toContainText('NaN');

  await go(page, '#/checkout');
  await expect(page.locator('[data-checkout-refusal="problems"]')).toBeVisible();

  await adminOn(page);
  await go(page, '#/admin/products');
  await page.fill('#pl-q', 'qa-broken');
  await expect(page.locator('tr[data-product-id="qa-broken"]')).toBeVisible();
  await go(page, `#/admin/orders/${encodeURIComponent(`${orderId}-X`)}`);
  await expect(page.locator('#app h1')).toContainText(`${orderId}-X`);
  await expect(page.locator('#app')).not.toContainText('NaN');
  await go(page, '#/admin/orders');
  await expect(page.locator(`tr[data-order-id="${orderId}-X"]`)).toBeVisible();
  await go(page, '#/admin/customers');
  await expect(page.locator(`tr[data-customer-id="${customerId}"]`)).toBeVisible();
  await go(page, `#/account/orders/${encodeURIComponent(orderId)}`);
  await expect(page.locator('#app h1')).toBeVisible();
  await go(page, '#/admin/products/qa-broken');
  await expect(page.locator('#app h1')).toBeVisible();
  expect(problems).toEqual([]);
});

// ------------------------------------------------------------------ very long text
test('2,000-character names do not break any layout (no horizontal overflow at 390px)', async ({ page }) => {
  test.slow();
  const problems = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '#/');
  const longWord = 'Υπερβολικάμεγάλοόνομαπροϊόντος'.repeat(67).slice(0, 2000);
  const { orderId, customerId } = await page.evaluate(async ([pid, name]) => {
    const db = await import('/assets/js/db.js');
    const p = await db.get('products', pid);
    await db.put('products', { ...p, name, brand: name.slice(0, 300) });
    return null;
  }, [PRODUCT.id, longWord]).then(() => seedShopper(page));
  await page.evaluate(async ([cid, name]) => {
    const db = await import('/assets/js/db.js');
    const c = await db.get('customers', cid);
    await db.put('customers', { ...c, firstName: name, lastName: name });
  }, [customerId, longWord]);
  await adminOn(page);
  for (const hash of ['#/catalog', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account', '#/account/orders',
    `#/account/orders/${encodeURIComponent(orderId)}`, `#/order/${encodeURIComponent(orderId)}`, '#/admin/products', '#/admin/orders',
    `#/admin/orders/${encodeURIComponent(orderId)}`, '#/admin/customers', `#/admin/customers/${encodeURIComponent(customerId)}`, '#/admin']) {
    await go(page, hash);
    if (hash === '#/admin/products') await page.fill('#pl-q', PRODUCT.slug);
    await scrollThrough(page);
    const over = await overflowX(page);
    expect(over, `${hash}: ${(await overflowCulprits(page)).join(', ')}`).toBeLessThanOrEqual(0);
  }
  expect(problems).toEqual([]);
});

// ------------------------------------------------------------------ rapid navigation
test('30 rapid route changes end on the last route with one consistent render and no errors', async ({ page }) => {
  const problems = watch(page);
  await open(page, '#/');
  await seedShopper(page);
  await adminOn(page);
  const routes = ['#/catalog', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account', '#/account/orders', '#/catalog/men', '#/admin',
    '#/admin/products', '#/admin/orders', '#/', '#/catalog/shoes', '#/account/wishlist', '#/admin/customers', '#/admin/promotions'];
  const sequence = [...routes, ...routes]; // 30
  await page.evaluate(async (seq) => {
    document.getElementById('app').firstElementChild?.setAttribute('data-qa-old', '');
    for (const h of seq) {
      location.hash = h;
      await new Promise((r) => setTimeout(r, Math.random() * 15)); // faster than any page can load
    }
  }, sequence);
  await settle(page);
  const last = sequence[sequence.length - 1];
  await expect(page).toHaveURL(new RegExp(`${last.replace(/[/#]/g, (c) => `\\${c}`)}$`));
  await expect(page.locator('#app > *')).toHaveCount(1);
  await expect(page.locator('#app [data-admin-view="promotions"]')).toBeVisible();
  await expect(page.locator('#app h1')).toHaveText('Προωθήσεις');
  await expect(page.locator('.modal.show, .offcanvas.show, .modal-backdrop, .offcanvas-backdrop')).toHaveCount(0);
  expect(problems).toEqual([]);
});

// ------------------------------------------------------------------ quota exceeded
const QUOTA = (stores) => {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function quotaPut(...args) {
    if (window.__quotaOn && stores.includes(this.name)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return put.apply(this, args);
  };
};

test('quota exceeded on product save and settings save shows the Greek storage message', async ({ page }) => {
  await page.addInitScript(QUOTA, ['products', 'variants', 'settings']);
  await open(page, '#/');
  await adminOn(page);
  await go(page, `#/admin/products/${PRODUCT.id}`);
  await page.fill('#f-name', `${PRODUCT.name} νέο`);
  await page.evaluate(() => { window.__quotaOn = true; });
  await page.locator('[data-product-form] [type="submit"], [data-save]').first().click();
  await expect(page.locator('#toastStack')).toContainText('Δεν υπάρχει αρκετός χώρος αποθήκευσης');
  await page.evaluate(() => { window.__quotaOn = false; });
  // the edit is still unsaved (nothing was written): leaving asks, and we confirm
  await expect.poll(() => page.evaluate(async (id) => (await (await import('/assets/js/db.js')).get('products', id)).name, PRODUCT.id)).toBe(PRODUCT.name);
  await page.evaluate(() => { document.getElementById('app').firstElementChild?.setAttribute('data-qa-old', ''); location.hash = '#/admin/settings'; });
  await expect(page.locator('.modal.show')).toContainText('Μη αποθηκευμένες αλλαγές');
  await page.locator('.modal.show [data-ok]').click();
  await settle(page);
  await expect(page.locator('#app h1')).toHaveText('Ρυθμίσεις');
  await page.fill('[data-admin-view="settings"] [data-field="storeName"], #s-storeName', 'ÉLAN Test');
  await page.evaluate(() => { window.__quotaOn = true; });
  await page.locator('[data-admin-view="settings"] [type="submit"], [data-admin-view="settings"] [data-save]').first().click();
  await expect(page.locator('#toastStack')).toContainText('Δεν υπάρχει αρκετός χώρος αποθήκευσης');
});

// ------------------------------------------------------------------ two tabs
test('two tabs: cart changes in tab A show in tab B after reload; tab B checkout with stock gone fails cleanly', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const problems = [...[a, b].map((p) => watch(p))];
  await open(a, '#/');
  await open(b, '#/');
  await a.evaluate(async (sku) => (await import('/assets/js/services/cart.js')).addLine(sku, 2), SKU);
  await b.reload();
  await settle(b);
  await go(b, '#/cart');
  await expect(b.locator(`.cart-line[data-sku="${SKU}"] [data-qty-input]`)).toHaveValue('2');
  // tab B goes to checkout and fills the form; meanwhile tab A (admin) sets that variant's stock to 1
  await go(b, '#/checkout');
  for (const [k, v] of Object.entries({ firstName: 'Νίκος', lastName: 'Αλεξίου', email: 'nikos@example.gr', phone: '6911111111', address: 'Σταδίου 5', city: 'Αθήνα', postalCode: '10562' })) await b.fill(`#co-${k}`, v);
  await b.selectOption('#co-region', 'Αττική');
  await b.check('#co-acceptTerms');
  const ordersBefore = await a.evaluate(async () => (await (await import('/assets/js/db.js')).getAll('orders')).length);
  await a.evaluate(async (sku) => {
    const db = await import('/assets/js/db.js');
    const v = await db.get('variants', sku);
    await db.put('variants', { ...v, stock: 1 });
  }, SKU);
  await b.locator('[data-place-order]').click();
  await expect(b.locator('[data-checkout-error], .co-banner, [role="alert"]').filter({ hasText: /διαθέσιμ|απόθεμα/ }).first()).toBeVisible();
  await expect(b).toHaveURL(/#\/checkout$/);
  expect(await a.evaluate(async () => (await (await import('/assets/js/db.js')).getAll('orders')).length)).toBe(ordersBefore);
  const stock = await a.evaluate(async (sku) => (await (await import('/assets/js/db.js')).get('variants', sku)).stock, SKU);
  expect(stock).toBe(1); // nothing decremented
  expect(problems.flat()).toEqual([]);
});

// ------------------------------------------------------------------ Back / Forward through a purchase
test('Back/Forward through a full purchase journey stays consistent (no duplicate order, sensible pages)', async ({ page }) => {
  test.slow();
  const problems = watch(page);
  await open(page, '#/');
  await clickNavigating(page, page.locator('.header-nav a[href="#/catalog/women"]').first());
  await go(page, `#/product/${PRODUCT.slug}`);
  const v = PRODUCT.variants.find((x) => x.sku === SKU);
  if (await page.locator('.pdp-color').count() > 1) await page.locator(`.pdp-color[data-color="${v.color}"]`).click();
  await page.locator(`.pdp-size[data-size="${v.size}"]`).click();
  await page.locator('[data-add]').click();
  await expect(page.locator('.site-header [data-badge="cart"]')).toHaveText('1');
  await go(page, '#/cart');
  await clickNavigating(page, page.locator('#app a[href="#/checkout"]'));
  for (const [k, val] of Object.entries({ firstName: 'Ελένη', lastName: 'Μάρκου', email: 'eleni.m@example.gr', phone: '6922222222', address: 'Ερμού 1', city: 'Αθήνα', postalCode: '10563' })) await page.fill(`#co-${k}`, val);
  await page.selectOption('#co-region', 'Αττική');
  await page.check('#co-acceptTerms');
  await clickNavigating(page, page.locator('[data-place-order]'));
  await expect(page).toHaveURL(/#\/order\//);
  const confirmationUrl = page.url();
  const own = () => page.evaluate(async () => (await (await import('/assets/js/db.js')).getAll('orders')).filter((o) => !o.sample).length);
  expect(await own()).toBe(1);

  const back = async () => { await page.evaluate(() => document.getElementById('app').firstElementChild?.setAttribute('data-qa-old', '')); await page.goBack(); await settle(page); };
  const fwd = async () => { await page.evaluate(() => document.getElementById('app').firstElementChild?.setAttribute('data-qa-old', '')); await page.goForward(); await settle(page); };
  await back(); // checkout with an empty cart: refusal, not a form that could re-submit
  await expect(page).toHaveURL(/#\/checkout$/);
  await expect(page.locator('[data-checkout-refusal="empty"]')).toBeVisible();
  await back(); // cart: empty
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.locator('#app')).toContainText('Το καλάθι σας είναι άδειο');
  await back(); // product page
  await expect(page.locator('#app h1')).toHaveText(PRODUCT.name);
  await fwd();
  await fwd();
  await fwd(); // confirmation again: same order, still exactly one
  expect(page.url()).toBe(confirmationUrl);
  await expect(page.locator('#app h1')).toBeVisible();
  expect(await own()).toBe(1);
  expect(problems).toEqual([]);
});
