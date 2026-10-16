const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const sample = JSON.parse(fs.readFileSync(path.join(root, 'data/sample-data.json'), 'utf8'));

const DB = 'agorasite-fashion1-v1';
const IMG = 'assets/images/products/w-shirt-dress-mustard-1.webp';
// 1x1 PNG: the upload test converts it client-side to a resized WebP data URL.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sampleProductId = sample.orders[0].lines[0].productId;
const sampleProduct = seed.find((p) => p.id === sampleProductId);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

const READY = (view) => `[data-admin-view="${view}"][data-ready="true"]`;

async function adminAt(page, hash, view) {
  await page.addInitScript(() => { try { sessionStorage.setItem('adminSession', '1'); } catch (e) { /* ignore */ } });
  await page.evaluate(() => { try { sessionStorage.setItem('adminSession', '1'); } catch (e) { /* ignore */ } }).catch(() => {});
  await page.goto(`/${hash}`);
  await expect(page.locator(READY(view))).toBeVisible();
}
async function toList(page) {
  await page.goto('/#/admin/products');
  await page.reload(); // re-read IndexedDB: the list does not poll for outside changes
  await expect(page.locator(READY('products'))).toBeVisible();
}

const idbAll = (page, store) => page.evaluate(({ db, store }) => new Promise((res, rej) => {
  const r = indexedDB.open(db);
  r.onsuccess = () => {
    const q = r.result.transaction(store).objectStore(store).getAll();
    q.onsuccess = () => { r.result.close(); res(q.result); };
    q.onerror = () => rej(q.error);
  };
  r.onerror = () => rej(r.error);
}), { db: DB, store });
const idbPut = (page, store, value) => page.evaluate(({ db, store, value }) => new Promise((res, rej) => {
  const r = indexedDB.open(db);
  r.onsuccess = () => {
    const t = r.result.transaction(store, 'readwrite');
    t.objectStore(store).put(value);
    t.oncomplete = () => { r.result.close(); res(true); };
    t.onerror = () => rej(t.error);
  };
  r.onerror = () => rej(r.error);
}), { db: DB, store, value });
const product = async (page, id) => (await idbAll(page, 'products')).find((p) => p.id === id);
const variantsOf = async (page, id) => (await idbAll(page, 'variants')).filter((v) => v.productId === id);

const input = (o = {}) => ({
  name: 'Δοκιμαστικό φόρεμα Zeta', slug: '', brand: 'ÉLAN', categoryId: 'women', subcategoryId: 'dresses',
  description: 'Δοκιμαστική περιγραφή.', priceCents: 8000, compareAtCents: 10000, images: [IMG],
  attributes: {}, flags: { featured: false, new: false, bestSeller: false }, status: 'active',
  variants: [
    { size: 'S', color: 'Μαύρο', colorHex: '#111111', stock: 5 },
    { size: 'M', color: 'Μαύρο', colorHex: '#111111', stock: 0 },
  ],
  ...o,
});
const seedProduct = (page, o) => page.evaluate(async (inp) => (await import('/assets/js/services/product-admin.js')).saveProduct(inp), input(o));

// A copy of a sample order whose single line points at `sku`.
async function addOrder(page, p, v, id = 'ELAN-TEST-0001') {
  const orders = await idbAll(page, 'orders');
  const base = JSON.parse(JSON.stringify(orders[0]));
  const order = {
    ...base,
    id,
    sample: false,
    lines: [{
      sku: v.sku, productId: p.id, slug: p.slug, name: p.name, brand: p.brand, size: v.size, color: v.color, colorHex: v.colorHex,
      image: p.images[0], qty: 1, unitCents: p.priceCents, compareAtCents: p.compareAtCents || null, lineTotalCents: p.priceCents, vatRate: 0.24,
    }],
  };
  await idbPut(page, 'orders', order);
  return order;
}
const orderById = async (page, id) => (await idbAll(page, 'orders')).find((o) => o.id === id);

async function fillBasics(page, o) {
  await page.fill('#f-name', o.name);
  await page.selectOption('#f-categoryId', 'women');
  await page.selectOption('#f-subcategoryId', 'dresses');
  await page.fill('#f-description', 'Δοκιμαστική περιγραφή.');
  await page.fill('#f-price', o.price);
  if (o.sale) await page.fill('#f-salePrice', o.sale);
}
async function addUrlImage(page, src) {
  await page.fill('#f-images', src);
  await page.click('[data-add-image]');
}
async function genVariants(page, sizes, colors) {
  await page.fill('[data-size-input]', sizes);
  await page.click('[data-add-size]');
  for (const c of colors) {
    await page.fill('[data-color-name]', c);
    await page.click('[data-add-color]');
  }
  await page.click('[data-generate]');
}
const stockInput = (page, i) => page.locator(`[data-variant-index="${i}"] [data-vf="stock"]`);
const sizeBtn = (page, size) => page.locator(`[data-size="${size}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('create a product via the UI (URL image + uploaded file) and see it in the storefront', async ({ page }) => {
  const errors = trackErrors(page);
  await adminAt(page, '#/admin/products/new', 'product-editor');
  await fillBasics(page, { name: 'Δοκιμαστικό φόρεμα Zeta', price: '100', sale: '79,90' });
  await expect(page.locator('#f-slug')).toHaveValue('dokimastiko-forema-zeta');
  await expect(page.locator('[data-discount-preview]')).toContainText('20%');
  await addUrlImage(page, IMG);
  await expect(page.locator('[data-image-index]')).toHaveCount(1);
  await page.setInputFiles('#f-imageFile', { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('[data-image-index]')).toHaveCount(2);
  await genVariants(page, 'S M', ['Μαύρο']);
  await expect(page.locator('[data-variant-index]')).toHaveCount(2);
  await stockInput(page, 0).fill('5');
  await stockInput(page, 1).fill('0');
  await page.locator('[data-save]').click();
  await expect(page).toHaveURL(/#\/admin\/products\/p-/);
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  const id = page.url().split('/').pop();
  const saved = await product(page, id);
  expect(saved.slug).toBe('dokimastiko-forema-zeta');
  expect(saved.priceCents).toBe(7990);
  expect(saved.compareAtCents).toBe(10000);
  expect(saved.images[0]).toBe(IMG);
  expect(saved.images[1]).toMatch(/^data:image\/(webp|jpeg);base64,/);
  expect(saved.status).toBe('active');
  const vs = await variantsOf(page, id);
  expect(vs.map((v) => [v.size, v.stock]).sort()).toEqual([['M', 0], ['S', 5]]);
  expect(new Set(vs.map((v) => v.sku)).size).toBe(2);
  await expect(page.locator('[data-store-link] a')).toHaveAttribute('target', '_blank');

  // storefront after a full reload: catalog search, card badge and price, PDP availability
  await page.goto('/#/catalog?q=zeta');
  await page.reload();
  const card = page.locator('[data-grid] .product-card[data-slug="dokimastiko-forema-zeta"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.badge-sale')).toBeVisible();
  await expect(card.locator('.product-card-price')).toContainText('79,90');
  await expect(card.locator('.product-card-price')).toContainText('100,00');
  await page.goto('/#/product/dokimastiko-forema-zeta');
  await page.reload();
  await expect(page.locator('[data-page="product"] h1')).toHaveText('Δοκιμαστικό φόρεμα Zeta');
  await expect(page.locator('.pdp-price')).toContainText('79,90');
  await expect(sizeBtn(page, 'S')).toBeEnabled();
  await expect(sizeBtn(page, 'M')).toBeDisabled();
  await expect(page.locator('.pdp-thumb img[src^="data:image/"]')).toHaveCount(1);
  await expect(page.locator('[data-gallery-main]')).toHaveAttribute('src', IMG);
  // it is also in the admin list
  await toList(page);
  await page.fill('#pl-q', 'zeta');
  await expect(page.locator(`tr[data-product-id="${id}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});

test('edit price: storefront shows the new price, an existing order snapshot is unchanged', async ({ page }) => {
  const errors = trackErrors(page);
  await adminAt(page, '#/admin/products', 'products');
  const p = await seedProduct(page, {});
  const vs = await variantsOf(page, p.id);
  const order = await addOrder(page, p, vs.find((v) => v.size === 'S'));
  const before = JSON.parse(JSON.stringify(await orderById(page, order.id)));

  await page.goto(`/#/admin/products/${p.id}`);
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  await expect(page.locator('#f-price')).toHaveValue('100.00');
  await expect(page.locator('#f-salePrice')).toHaveValue('80.00');
  await page.fill('#f-salePrice', '59,50');
  await page.locator('[data-save]').click();
  await expect(page.locator('#toastStack')).toContainText('αποθηκεύτηκαν');
  expect((await product(page, p.id)).priceCents).toBe(5950);

  await page.goto(`/#/product/${p.slug}`);
  await page.reload();
  await expect(page.locator('.pdp-price')).toContainText('59,50');
  await page.goto(`/#/catalog?q=${encodeURIComponent('zeta')}`);
  await expect(page.locator(`[data-grid] .product-card[data-slug="${p.slug}"] .product-card-price`)).toContainText('59,50');

  expect(await orderById(page, order.id)).toEqual(before);
  expect((await orderById(page, order.id)).lines[0].unitCents).toBe(8000);
  await page.goto(`/#/order/${order.id}`);
  await expect(page.locator('[data-page="confirmation"], [data-route^="/order"]').first()).toBeVisible();
  await expect(page.locator('body')).toContainText('80,00');
  expect(errors).toEqual([]);
});

test('stock edits make a variant sold out or available in the PDP', async ({ page }) => {
  await adminAt(page, '#/admin/products', 'products');
  const p = await seedProduct(page, {});
  await page.goto(`/#/product/${p.slug}`);
  await expect(sizeBtn(page, 'M')).toBeDisabled();
  await expect(sizeBtn(page, 'S')).toBeEnabled();

  await page.goto(`/#/admin/products/${p.id}`);
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  const rows = page.locator('[data-variant-index]');
  await expect(rows).toHaveCount(2);
  const mIndex = await rows.evaluateAll((trs) => trs.findIndex((tr) => tr.querySelector('[data-vf="size"]').value === 'M'));
  const sIndex = 1 - mIndex;
  await stockInput(page, mIndex).fill('4');
  await stockInput(page, sIndex).fill('0');
  await page.locator('[data-save]').click();
  await expect(page.locator('#toastStack')).toContainText('αποθηκεύτηκαν');

  await page.goto(`/#/product/${p.slug}`);
  await page.reload();
  await expect(sizeBtn(page, 'M')).toBeEnabled();
  await expect(sizeBtn(page, 'S')).toBeDisabled();
});

test('archive hides the product everywhere, blocks cart/checkout, and unarchive restores it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('[data-page="home"] a[href^="#/product/"]').first()).toBeVisible();
  const slug = (await page.locator('[data-page="home"] a[href^="#/product/"]').first().getAttribute('href')).replace('#/product/', '');
  const seededP = seed.find((p) => p.slug === slug);
  expect(seededP).toBeTruthy();
  const sku = seededP.variants.find((v) => v.stock > 0).sku;
  await idbPut(page, 'carts', { id: 'local', lines: [{ sku, qty: 1 }], couponCode: null, updatedAt: new Date().toISOString() });

  await adminAt(page, '#/admin/products', 'products');
  await page.fill('#pl-q', slug);
  const row = page.locator(`tr[data-product-id="${seededP.id}"]`);
  await expect(row).toBeVisible();
  await row.locator('[data-action="archive"]').click();
  await expect(page.locator('#toastStack')).toContainText('αρχειοθετήθηκε');
  await expect(row.locator('.admin-badge')).toHaveText('Αρχειοθετημένο');
  expect((await product(page, seededP.id)).status).toBe('archived');

  await page.goto('/');
  await page.reload();
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  await expect(page.locator(`[data-page="home"] a[href="#/product/${slug}"]`)).toHaveCount(0);
  await page.goto(`/#/catalog?q=${encodeURIComponent(seededP.name)}`);
  await expect(page.locator('[data-grid] .product-card').first()).toBeAttached().catch(() => {});
  await expect(page.locator(`[data-grid] .product-card[data-slug="${slug}"]`)).toHaveCount(0);
  await page.goto(`/#/product/${slug}`);
  await expect(page.locator('[data-page="product-not-found"]')).toBeVisible();
  await page.goto('/#/cart');
  await expect(page.locator(`[data-sku="${sku}"] [data-problem="archived"]`)).toBeVisible();
  await expect(page.locator('[data-checkout]')).toBeDisabled();
  await page.goto('/#/checkout');
  await expect(page.locator('body')).toContainText('Αφαιρέστε');

  await toList(page);
  await page.fill('#pl-q', slug);
  await page.locator(`tr[data-product-id="${seededP.id}"] [data-action="restore"]`).click();
  await expect(page.locator('#toastStack')).toContainText('επαναφέρθηκε');
  await page.goto(`/#/product/${slug}`);
  await expect(page.locator('[data-page="product"] h1')).toHaveText(seededP.name);
  await page.goto('/#/cart');
  await expect(page.locator('[data-problem="archived"]')).toHaveCount(0);
  await expect(page.locator('[data-checkout]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('delete a product without orders removes variants, reviews, wishlist and cart references', async ({ page }) => {
  const errors = trackErrors(page);
  await adminAt(page, '#/admin/products', 'products');
  const p = await seedProduct(page, {});
  const vs = await variantsOf(page, p.id);
  await idbPut(page, 'reviews', { id: 'rev-del-1', productId: p.id, rating: 5, title: 'Τέλειο', body: 'Πολύ ωραίο προϊόν.', author: 'Test', createdAt: new Date().toISOString(), local: true });
  await idbPut(page, 'wishlists', { id: 'local', productIds: [p.id, seed[0].id] });
  await idbPut(page, 'carts', { id: 'local', lines: [{ sku: vs[0].sku, qty: 1 }, { sku: seed[1].variants[0].sku, qty: 2 }], couponCode: null, updatedAt: new Date().toISOString() });

  await toList(page);
  await page.fill('#pl-q', 'zeta');
  const row = page.locator(`tr[data-product-id="${p.id}"]`);
  await row.locator('[data-action="delete"]').click();
  const dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('Διαγραφή προϊόντος');
  await dlg.locator('[data-ok]').click();
  await expect(page.locator('#toastStack')).toContainText('διαγράφηκε');
  await expect(row).toHaveCount(0);

  expect(await product(page, p.id)).toBeUndefined();
  expect(await variantsOf(page, p.id)).toEqual([]);
  expect((await idbAll(page, 'reviews')).filter((r) => r.productId === p.id)).toEqual([]);
  expect((await idbAll(page, 'wishlists'))[0].productIds).toEqual([seed[0].id]);
  expect((await idbAll(page, 'carts'))[0].lines).toEqual([{ sku: seed[1].variants[0].sku, qty: 2 }]);
  await page.goto(`/#/product/${p.slug}`);
  await expect(page.locator('[data-page="product-not-found"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a product that appears in an order cannot be deleted; archiving is offered', async ({ page }) => {
  await adminAt(page, '#/admin/products', 'products');
  await page.fill('#pl-q', sampleProduct.slug);
  const row = page.locator(`tr[data-product-id="${sampleProduct.id}"]`);
  await expect(row).toBeVisible();
  await row.locator('[data-action="delete"]').click();
  const dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('δεν μπορεί να διαγραφεί');
  await expect(dlg).toContainText('Αρχειοθέτηση');
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal.show')).toHaveCount(0);
  expect((await product(page, sampleProduct.id)).status).toBe('active');

  // the service itself also refuses
  const r = await page.evaluate(async (id) => (await import('/assets/js/services/product-admin.js')).deleteProduct(id), sampleProduct.id);
  expect(r).toEqual({ deleted: false, reason: 'has-orders' });
  expect(await product(page, sampleProduct.id)).toBeTruthy();

  await row.locator('[data-action="delete"]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator('#toastStack')).toContainText('αρχειοθετήθηκε');
  expect((await product(page, sampleProduct.id)).status).toBe('archived');
  expect(await variantsOf(page, sampleProduct.id)).not.toEqual([]);
});

test('validation: required fields, duplicate slug, duplicate SKU, bad prices, no image, bad hex', async ({ page }) => {
  await adminAt(page, '#/admin/products/new', 'product-editor');
  // empty form: summary + first invalid field focused
  await page.locator('[data-save]').click();
  const summary = page.locator('[data-error-summary]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Διορθώστε');
  await expect(page.locator('#f-name')).toBeFocused();
  await expect(page.locator('#f-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-name')).toHaveAttribute('aria-describedby', /err-name/);
  await expect(page.locator('#err-name')).not.toBeEmpty();
  await expect(page.locator('#err-images')).not.toBeEmpty();
  await expect(page.locator('#err-variants')).not.toBeEmpty();

  await fillBasics(page, { name: 'Δοκιμή validation', price: '50' });
  await addUrlImage(page, IMG);
  await genVariants(page, 'M', ['Μαύρο']);

  // duplicate slug (seeded product)
  await page.fill('#f-slug', seed[0].slug);
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-slug')).toContainText('slug');
  await expect(page.locator('#f-slug')).toBeFocused();
  await page.fill('#f-slug', 'validation-test');

  // duplicate SKU (seeded)
  await page.fill('[data-variant-index="0"] [data-vf="sku"]', seed[0].variants[0].sku);
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-v0-sku')).toContainText('SKU');
  await expect(page.locator('[data-variant-index="0"] [data-vf="sku"]')).toBeFocused();
  await page.fill('[data-variant-index="0"] [data-vf="sku"]', '');

  // negative / NaN price
  for (const bad of ['-5', 'abc']) {
    await page.fill('#f-price', bad);
    await page.locator('[data-save]').click();
    await expect(page.locator('#err-price')).not.toBeEmpty();
    await expect(page.locator('#f-price')).toBeFocused();
  }
  await page.fill('#f-price', '50');
  // sale >= regular
  await page.fill('#f-salePrice', '50');
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-salePrice')).toContainText('μικρότερη');
  await page.fill('#f-salePrice', '60');
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-salePrice')).toContainText('μικρότερη');
  await page.fill('#f-salePrice', '');

  // bad hex
  await page.fill('[data-variant-index="0"] [data-vf="colorHex"]', 'red');
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-v0-colorHex')).not.toBeEmpty();
  await page.fill('[data-variant-index="0"] [data-vf="colorHex"]', '#336699');

  // no image
  await page.locator('[data-img-remove="0"]').click();
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-images')).toContainText('φωτογραφία');
  await expect(page.locator('#f-images')).toBeFocused();
  await addUrlImage(page, IMG);

  // negative stock
  await stockInput(page, 0).fill('-1');
  await page.locator('[data-save]').click();
  await expect(page.locator('#err-v0-stock')).not.toBeEmpty();
  await stockInput(page, 0).fill('2');

  // nothing was saved along the way; now it passes
  expect((await idbAll(page, 'products')).length).toBe(seed.length);
  await page.locator('[data-save]').click();
  await expect(page).toHaveURL(/#\/admin\/products\/p-/);
  expect((await idbAll(page, 'products')).length).toBe(seed.length + 1);
});

test('image URL preview shows an error state and non-image / oversized uploads are rejected', async ({ page }) => {
  await adminAt(page, '#/admin/products/new', 'product-editor');
  await page.fill('#f-images', 'assets/images/nope-does-not-exist.webp');
  await expect(page.locator('[data-url-preview].is-error')).toContainText('δεν φορτώθηκε');
  await page.click('[data-add-image]');
  await expect(page.locator('[data-image-index]')).toHaveCount(0);
  await expect(page.locator('[data-image-msg]')).toContainText('δεν προστέθηκε');
  await page.fill('#f-images', IMG);
  await expect(page.locator('[data-url-preview].is-ok')).toBeVisible();

  await page.setInputFiles('#f-imageFile', { name: 'doc.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('[data-image-msg]')).toContainText('δεν είναι εικόνα');
  await page.setInputFiles('#f-imageFile', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 1) });
  await expect(page.locator('[data-image-msg]')).toContainText('5 MB');
  await expect(page.locator('[data-image-index]')).toHaveCount(0);
});

test('images can be reordered and removed', async ({ page }) => {
  await adminAt(page, '#/admin/products/new', 'product-editor');
  const second = 'assets/images/products/w-shirt-dress-mustard-2.webp';
  await addUrlImage(page, IMG);
  await expect(page.locator('[data-image-index]')).toHaveCount(1);
  await addUrlImage(page, second);
  await expect(page.locator('[data-image-index]')).toHaveCount(2);
  await expect(page.locator('[data-image-index="0"] .admin-image-src')).toHaveText(IMG);
  await page.locator('[data-img-down="0"]').click();
  await expect(page.locator('[data-image-index="0"] .admin-image-src')).toHaveText(second);
  await page.locator('[data-img-up="1"]').click();
  await expect(page.locator('[data-image-index="0"] .admin-image-src')).toHaveText(IMG);
  await page.locator('[data-img-remove="0"]').click();
  await expect(page.locator('[data-image-index]')).toHaveCount(1);
  await expect(page.locator('[data-image-index="0"] .admin-image-src')).toHaveText(second);
});

test('removing a variant used by an order archives it (stock 0, not purchasable) and the old order still renders', async ({ page }) => {
  const errors = trackErrors(page);
  await adminAt(page, '#/admin/products', 'products');
  const p = await seedProduct(page, {});
  const vs = await variantsOf(page, p.id);
  const mVar = vs.find((v) => v.size === 'M');
  const sVar = vs.find((v) => v.size === 'S');
  await idbPut(page, 'variants', { ...mVar, stock: 7 }); // stock that would otherwise be purchasable
  const order = await addOrder(page, p, mVar, 'ELAN-TEST-0002');
  await idbPut(page, 'carts', { id: 'local', lines: [{ sku: mVar.sku, qty: 1 }], couponCode: null, updatedAt: new Date().toISOString() });

  await page.goto(`/#/admin/products/${p.id}`);
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  const rows = page.locator('[data-variant-index]');
  const mIndex = await rows.evaluateAll((trs) => trs.findIndex((tr) => tr.querySelector('[data-vf="size"]').value === 'M'));
  await rows.nth(mIndex).locator('[data-rm-variant]').click();
  await expect(rows).toHaveCount(1);
  await page.locator('[data-save]').click();
  await expect(page.locator('#toastStack')).toContainText('αποθηκεύτηκαν');

  const after = await variantsOf(page, p.id);
  const archivedVar = after.find((v) => v.sku === mVar.sku);
  expect(archivedVar).toMatchObject({ archived: true, stock: 0 });
  expect(after.find((v) => v.sku === sVar.sku).archived).toBeFalsy();
  // sku never referenced by an order is really deleted
  await page.goto(`/#/admin/products/${p.id}`);
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  await page.locator('[data-add-row]').click();
  await page.fill('[data-variant-index="1"] [data-vf="size"]', 'L');
  await page.fill('[data-variant-index="1"] [data-vf="color"]', 'Μαύρο');
  await page.fill('[data-variant-index="1"] [data-vf="colorHex"]', '#111111');
  await page.locator('[data-variant-index="1"] [data-rm-variant]').click();
  await page.locator('[data-save]').click();
  await expect(page.locator('#toastStack')).toContainText('αποθηκεύτηκαν');
  expect((await variantsOf(page, p.id)).length).toBe(2);

  // storefront: the archived size is gone and cannot be bought
  await page.goto(`/#/product/${p.slug}`);
  await page.reload();
  await expect(sizeBtn(page, 'S')).toBeEnabled();
  await expect(sizeBtn(page, 'M')).toHaveCount(0);
  const add = await page.evaluate(async (sku) => (await import('/assets/js/services/cart.js')).addLine(sku, 1), mVar.sku);
  expect(add).toMatchObject({ ok: false, reason: 'archived' });
  await page.goto('/#/cart');
  await expect(page.locator(`[data-sku="${mVar.sku}"] [data-problem="archived"]`)).toBeVisible();
  await expect(page.locator('[data-checkout]')).toBeDisabled();
  // the old order is untouched and renders
  expect((await orderById(page, order.id)).lines[0].sku).toBe(mVar.sku);
  await page.goto(`/#/order/${order.id}`);
  await expect(page.locator('body')).toContainText(p.name);
  expect(errors).toEqual([]);
});

test('unsaved-changes guard: navigating away asks first; staying keeps the edits', async ({ page }) => {
  await adminAt(page, `#/admin/products/${seed[2].id}`, 'product-editor');
  // clean form: leaving needs no confirmation
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  await expect(page).toHaveURL(/#\/admin\/orders$/);
  await page.goBack();
  await expect(page.locator(READY('product-editor'))).toBeVisible();

  await page.fill('#f-name', 'Αλλαγμένο όνομα');
  await expect(page.locator('[data-dirty-note]')).toBeVisible();
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  const dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('Μη αποθηκευμένες αλλαγές');
  await dlg.locator('[data-bs-dismiss="modal"]', { hasText: 'Παραμονή' }).click();
  await expect(page.locator('.modal.show')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/admin/products/${seed[2].id}$`));
  await expect(page.locator('#f-name')).toHaveValue('Αλλαγμένο όνομα');

  // Escape also keeps the user on the page
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  await expect(page.locator('.modal.show')).toBeVisible();
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal.show')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/admin/products/${seed[2].id}$`));

  // Cancel button: confirm, then leave
  await page.locator('[data-cancel]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator(READY('products'))).toBeVisible();
  await expect(page).toHaveURL(/#\/admin\/products$/);
  expect((await product(page, seed[2].id)).name).toBe(seed[2].name);

  // leaving through the dialog from a link
  await page.locator(`tr[data-product-id="${seed[2].id}"] [data-action="edit"]`).click().catch(async () => {
    await page.goto(`/#/admin/products/${seed[2].id}`);
  });
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  await page.fill('#f-brand', 'Άλλο brand');
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page).toHaveURL(/#\/admin\/orders$/);
});

test('list: search, filters, sort and pagination over 39 seeded + created products', async ({ page }) => {
  const errors = trackErrors(page);
  await adminAt(page, '#/admin/products', 'products');
  const a = await seedProduct(page, { name: 'Αλφα δοκιμή Zzz', priceCents: 100, compareAtCents: undefined, flags: { featured: true, new: false, bestSeller: false }, variants: [{ size: 'M', color: 'Μαύρο', colorHex: '#111111', stock: 2, sku: 'ZZ-LOW-1' }] });
  const b = await seedProduct(page, { name: 'Βήτα δοκιμή Zzz', priceCents: 999900, compareAtCents: undefined, status: 'archived', variants: [{ size: 'M', color: 'Μαύρο', colorHex: '#111111', stock: 50, sku: 'ZZ-BIG-1' }] });
  await toList(page);
  const total = seed.length + 2;
  const count = page.locator('[data-count]');
  await expect(count).toHaveAttribute('data-total', String(total));
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(25);
  await expect(page.locator('[data-range]')).toContainText(`1–25 από ${total}`);
  await page.getByRole('button', { name: /Επόμενη/ }).click();
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(total - 25);
  await expect(page.locator('.admin-pager-page')).toContainText('Σελίδα 2 από 2');
  await page.getByRole('button', { name: /Προηγούμενη/ }).click();
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(25);

  // search by name, brand, SKU
  await page.fill('#pl-q', 'zzz');
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(2);
  await page.fill('#pl-q', 'zz-big');
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(1);
  await expect(page.locator(`tr[data-product-id="${b.id}"]`)).toBeVisible();
  await page.fill('#pl-q', seed[0].variants[0].sku.toLowerCase());
  await expect(page.locator(`tr[data-product-id="${seed[0].id}"]`)).toBeVisible();
  await page.fill('#pl-q', 'δεν-υπαρχει-τιποτα');
  await expect(page.locator('[data-empty]')).toContainText('Κανένα προϊόν');
  await page.locator('[data-clear-filters]').click();
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(25);

  // filters
  await page.selectOption('#pl-status', 'archived');
  const archivedSeed = seed.filter((p) => p.status === 'archived').length;
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(archivedSeed + 1);
  await page.selectOption('#pl-status', '');
  await page.fill('#pl-q', 'zzz');
  await page.check('#pl-low');
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(1);
  await expect(page.locator(`tr[data-product-id="${a.id}"] [data-stock-state="low"]`)).toBeVisible();
  await page.uncheck('#pl-low');
  await page.check('#pl-feat');
  await expect(page.locator('[data-products-table] tbody tr')).toHaveCount(1);
  await expect(page.locator(`tr[data-product-id="${a.id}"]`)).toBeVisible();
  await page.uncheck('#pl-feat');

  // sort (within the two created products)
  await page.selectOption('#pl-sort', 'price-asc');
  await expect(page.locator('[data-products-table] tbody tr').first()).toHaveAttribute('data-product-id', a.id);
  await page.selectOption('#pl-sort', 'price-desc');
  await expect(page.locator('[data-products-table] tbody tr').first()).toHaveAttribute('data-product-id', b.id);
  await page.selectOption('#pl-sort', 'stock-asc');
  await expect(page.locator('[data-products-table] tbody tr').first()).toHaveAttribute('data-product-id', a.id);
  await page.selectOption('#pl-sort', 'name');
  await expect(page.locator('[data-products-table] tbody tr').first()).toHaveAttribute('data-product-id', a.id);

  // feature toggle persists and survives reload
  await page.locator(`tr[data-product-id="${b.id}"] [data-action="feature"]`).click();
  await expect(page.locator(`tr[data-product-id="${b.id}"] [data-action="feature"]`)).toHaveAttribute('aria-pressed', 'true');
  expect((await product(page, b.id)).flags.featured).toBe(true);
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`no page-level horizontal overflow at ${width}px (list and editor)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await adminAt(page, '#/admin/products', 'products');
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await over()).toBeLessThanOrEqual(0);
    await page.goto(`/#/admin/products/${seed[3].id}`);
    await expect(page.locator(READY('product-editor'))).toBeVisible();
    await expect(page.locator('[data-variant-index]').first()).toBeVisible();
    expect(await over()).toBeLessThanOrEqual(0);
    await page.goto('/#/admin/products/new');
    await expect(page.locator(READY('product-editor'))).toBeVisible();
    expect(await over()).toBeLessThanOrEqual(0);
  });
}

test('keyboard: the form is reachable by Tab in order and dialogs close on Escape', async ({ page }) => {
  await adminAt(page, '#/admin/products/new', 'product-editor');
  await page.locator('#f-name').focus();
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    order.push(await page.evaluate(() => document.activeElement.id));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual(['f-name', 'f-slug', 'f-brand', 'f-categoryId', 'f-subcategoryId', 'f-description']);
  for (const id of ['f-name', 'f-slug', 'f-brand', 'f-categoryId', 'f-subcategoryId', 'f-description', 'f-price', 'f-salePrice', 'f-images', 'f-imageFile', 'f-sizeInput', 'f-colorName', 'f-bulkStock']) {
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  }
  // Enter in the URL box adds the image without submitting the form
  await page.fill('#f-images', IMG);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-image-index]')).toHaveCount(1);
  await expect(page.locator('[data-error-summary]')).toBeHidden();

  // the editor has unsaved changes: leaving asks first
  await page.goto('/#/admin/products');
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator(READY('products'))).toBeVisible();
  await page.fill('#pl-q', sampleProduct.slug);
  await page.locator(`tr[data-product-id="${sampleProduct.id}"] [data-action="delete"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.modal.show')).toBeVisible();
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal.show')).toHaveCount(0);
});

test('presets, matrix generation and bulk stock', async ({ page }) => {
  await adminAt(page, '#/admin/products/new', 'product-editor');
  await page.click('[data-preset="clothing"]');
  await expect(page.locator('[data-size-chips] .admin-chip')).toHaveCount(5);
  await page.click('[data-preset="one"]');
  await expect(page.locator('[data-size-chips] .admin-chip')).toHaveCount(6);
  await page.fill('[data-color-name]', 'Κόκκινο');
  await page.fill('[data-color-pick]', '#cc0000');
  await page.click('[data-add-color]');
  await page.fill('[data-color-name]', 'Λευκό');
  await page.click('[data-add-color]');
  await page.click('[data-generate]');
  await expect(page.locator('[data-variant-index]')).toHaveCount(12);
  await page.fill('[data-bulk-stock]', '9');
  await page.click('[data-bulk-apply]');
  for (const i of [0, 5, 11]) await expect(stockInput(page, i)).toHaveValue('9');
  const skus = await page.locator('[data-vf="sku"]').evaluateAll((els) => els.map((e) => e.value));
  expect(new Set(skus).size).toBe(12);
  // regenerating keeps the existing rows (no duplicates)
  await page.click('[data-generate]');
  await expect(page.locator('[data-variant-index]')).toHaveCount(12);
});
