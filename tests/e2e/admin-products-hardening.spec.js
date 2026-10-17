const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const DB = 'agorasite-fashion1-v1';
const IMG = 'assets/images/products/w-shirt-dress-mustard-1.webp';
const READY = (view) => `[data-admin-view="${view}"][data-ready="true"]`;

async function adminAt(page, hash, view) {
  await page.evaluate(() => { try { sessionStorage.setItem('adminSession', '1'); } catch (e) { /* ignore */ } }).catch(() => {});
  await page.addInitScript(() => { try { sessionStorage.setItem('adminSession', '1'); } catch (e) { /* ignore */ } });
  await page.goto(`/${hash}`);
  await expect(page.locator(READY(view))).toBeVisible();
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
  name: 'Δοκιμαστικό φόρεμα Zeta', slug: '', brand: 'Marias', categoryId: 'women', subcategoryId: 'dresses',
  description: 'Δοκιμαστική περιγραφή.', priceCents: 8000, compareAtCents: 10000, images: [IMG],
  attributes: {}, flags: { featured: false, new: false, bestSeller: false }, status: 'active',
  variants: [
    { size: 'S', color: 'Μαύρο', colorHex: '#111111', stock: 5 },
    { size: 'M', color: 'Μαύρο', colorHex: '#111111', stock: 0 },
  ],
  ...o,
});
const seedProduct = (page, o) => page.evaluate(async (inp) => (await import('/assets/js/services/product-admin.js')).saveProduct(inp), input(o));
const stay = (page) => page.locator('.modal.show [data-bs-dismiss="modal"]', { hasText: 'Παραμονή' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('in-page anchors (#app) neither show a leave dialog nor disarm the guard', async ({ page }) => {
  await adminAt(page, `#/admin/products/${seed[2].id}`, 'product-editor');
  await page.fill('#f-name', 'Αλλαγμένο');
  await page.evaluate(() => { location.hash = '#app'; });
  await page.waitForTimeout(300);
  await expect(page.locator('.modal.show')).toHaveCount(0);
  await expect(page.locator('#f-name')).toHaveValue('Αλλαγμένο');
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  await expect(page.locator('.modal.show')).toContainText('Μη αποθηκευμένες αλλαγές');
  await stay(page).click();
  await expect(page.locator('#f-name')).toHaveValue('Αλλαγμένο');
});

test('clean editor: an anchor keeps it mounted, a real navigation goes without a dialog', async ({ page }) => {
  await adminAt(page, `#/admin/products/${seed[2].id}`, 'product-editor');
  await page.evaluate(() => { location.hash = '#app'; });
  await page.waitForTimeout(200);
  await expect(page.locator('[data-product-form]')).toBeVisible();
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  await expect(page).toHaveURL(/#\/admin\/orders$/);
  await expect(page.locator('.modal.show')).toHaveCount(0);
});

test('Back/Forward with unsaved changes keeps history consistent (cancel and confirm)', async ({ page }) => {
  await adminAt(page, '#/admin/products', 'products');
  await page.fill('#pl-q', seed[2].slug);
  await page.locator(`tr[data-product-id="${seed[2].id}"] a[data-action="edit"]`).click();
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  const editorUrl = page.url();
  await page.fill('#f-name', 'Αλλαγμένο όνομα');
  const len = await page.evaluate(() => history.length);

  await page.goBack();
  await expect(page.locator('.modal.show')).toContainText('Μη αποθηκευμένες αλλαγές');
  await stay(page).click();
  await expect(page.locator('.modal')).toHaveCount(0); // fully hidden and removed
  await expect.poll(() => page.url()).toBe(editorUrl);
  expect(await page.evaluate(() => history.length)).toBe(len);
  await expect(page.locator('#f-name')).toHaveValue('Αλλαγμένο όνομα');

  await page.goBack();
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator(READY('products'))).toBeVisible();
  await expect(page).toHaveURL(/#\/admin\/products$/);
  expect(await page.evaluate(() => history.length)).toBe(len);
  await page.goForward();
  await expect(page.locator(READY('product-editor'))).toBeVisible();
  await expect(page).toHaveURL(editorUrl);
  await expect(page.locator('#f-name')).toHaveValue(seed[2].name);
});

test('a second navigation while the leave dialog is open does not stack dialogs', async ({ page }) => {
  await adminAt(page, `#/admin/products/${seed[2].id}`, 'product-editor');
  await page.fill('#f-name', 'Αλλαγμένο');
  await page.locator('#adminSidebar a[href="#/admin/orders"]').click();
  await expect(page.locator('.modal.show')).toBeVisible();
  await expect.poll(() => page.url()).toContain(`#/admin/products/${seed[2].id}`); // undo finished
  await page.evaluate(() => { location.hash = '#/admin/customers'; });
  await page.waitForTimeout(500);
  await expect(page.locator('.modal')).toHaveCount(1);
  await stay(page).click();
  await expect(page.locator('#f-name')).toHaveValue('Αλλαγμένο');
  await expect(page).toHaveURL(new RegExp(`#/admin/products/${seed[2].id}$`));
});

test('service hardening: image allow-list, immutable SKU, atomic save, no stock lost-update', async ({ page }) => {
  await adminAt(page, '#/admin/products', 'products');
  const p = await seedProduct(page, {});
  const svc = (arg) => page.evaluate(async (a) => {
    const m = await import('/assets/js/services/product-admin.js');
    if (a.__bad) { delete a.__bad; a.variants.push({ size: 'XL', color: 'Μαύρο', colorHex: '#111111', stock: 1, sku: 'BOOM-1', bad: () => 1 }); }
    try { return { ok: true, v: await m.saveProduct(a) }; } catch (e) { return { ok: false, code: e.code, errors: e.errors, name: e.name }; }
  }, arg);
  const vs = await variantsOf(page, p.id);
  const rows = (f) => vs.map((v) => ({ ...v, originalSku: v.sku, baseStock: v.stock, ...f(v) }));
  const full = (o) => ({ ...input(), ...p, variants: rows(() => ({})), ...o });

  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    const r = await svc(full({ images: [bad] }));
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(r.errors.images).toBeTruthy();
  }
  const renamed = await svc(full({ variants: rows((v) => (v.size === 'S' ? { sku: 'RENAMED-1' } : {})) }));
  expect(renamed).toMatchObject({ ok: false, code: 'invalid' });
  expect(Object.keys(renamed.errors).some((k) => k.endsWith('.sku'))).toBe(true);

  const byId = (a, b) => a.sku.localeCompare(b.sku);
  const before = { p: await product(page, p.id), v: (await variantsOf(page, p.id)).sort(byId) };
  const boom = await svc(full({ name: 'Δεν πρέπει να αποθηκευτεί', variants: rows(() => ({})), __bad: true }));
  expect(boom.ok).toBe(false);
  expect(await product(page, p.id)).toEqual(before.p);
  expect((await variantsOf(page, p.id)).sort(byId)).toEqual(before.v);

  const s = vs.find((v) => v.size === 'S');
  const m = vs.find((v) => v.size === 'M');
  await idbPut(page, 'variants', { ...s, stock: 2 }); // an order decremented 5 -> 2 after the form loaded
  const saved = await svc(full({ variants: [{ ...s, originalSku: s.sku, baseStock: 5, stock: 5 }, { ...m, originalSku: m.sku, baseStock: 0, stock: 9 }] }));
  expect(saved.ok).toBe(true);
  const after = await variantsOf(page, p.id);
  expect(after.find((v) => v.sku === s.sku).stock).toBe(2);
  expect(after.find((v) => v.sku === m.sku).stock).toBe(9);
  expect(after.every((v) => v.originalSku === undefined && v.baseStock === undefined)).toBe(true);
});

test('upload of SVG files is rejected in the editor', async ({ page }) => {
  await adminAt(page, '#/admin/products/new', 'product-editor');
  await page.setInputFiles('#f-imageFile', { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(page.locator('[data-image-msg]')).toContainText('δεν είναι εικόνα');
  await expect(page.locator('[data-image-index]')).toHaveCount(0);
});

test('checkout line snapshots drop data: URL images', async ({ page }) => {
  await adminAt(page, '#/admin/products', 'products');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const p = await seedProduct(page, { images: [png] });
  const v = (await variantsOf(page, p.id)).find((x) => x.stock > 0);
  await idbPut(page, 'carts', { id: 'local', lines: [{ sku: v.sku, qty: 1 }], couponCode: null, updatedAt: new Date().toISOString() });
  await page.goto('/#/checkout');
  await expect(page.locator('[data-page="checkout"] h1')).toBeVisible();
  const d = { firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.gr', phone: '691 234 5678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563' };
  for (const k of Object.keys(d)) await page.fill('#co-' + k, d[k]);
  await page.selectOption('#co-region', 'Αττική');
  await page.check('#co-acceptTerms');
  await page.locator('[data-place-order]').click();
  await expect(page).toHaveURL(/#\/order\//);
  const order = (await idbAll(page, 'orders')).find((o) => o.lines.some((l) => l.sku === v.sku));
  expect(order.lines[0].image).toBeNull();
});
