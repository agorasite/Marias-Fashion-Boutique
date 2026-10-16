// Task 17: backup export, validated import (all-or-nothing) and confirmed demo reset.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog-meta.json'), 'utf8'));
const sample = JSON.parse(fs.readFileSync(path.join(root, 'data/sample-data.json'), 'utf8'));
const contentSeed = JSON.parse(fs.readFileSync(path.join(root, 'data/content.json'), 'utf8'));

const VIEW = '[data-admin-view="backup"]';
const P = products.find((p) => p.status !== 'archived' && p.variants.some((v) => v.stock >= 3));
const SKU = P.variants.find((v) => v.stock >= 3).sku;
const DISHONEST_IRIS = 'Η πληρωμή σας μέσω IRIS ολοκληρώθηκε και η παραγγελία πληρώθηκε. Ευχαριστούμε για την προσομοίωση.';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.waitForFunction(async () => !!(await (await import('/assets/js/db.js')).get('settings', 'seeded')));
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}
async function openBackup(page) {
  await page.goto('/#/admin/backup');
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
}
/** Every store, read in one transaction (the same snapshot exportAll produces). */
const snapshot = (page) => page.evaluate(async () => (await (await import('/assets/js/services/backup.js')).exportAll()).stores);
/** A backup object built in the page from the current data, after `mutate(backup)` (a function source). */
const backupObject = (page) => page.evaluate(async () => JSON.parse(JSON.stringify(await (await import('/assets/js/services/backup.js')).exportAll())));
const fileOf = (name, obj) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });

async function chooseFile(page, file) {
  await page.locator(`${VIEW} [data-import-file]`).setInputFiles(file);
  await expect(page.locator(VIEW)).toHaveAttribute('data-import-state', /^(valid|invalid)$/);
}
async function reopen(page) {
  await page.reload();
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
}
async function exportViaUi(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`${VIEW} [data-export]`).click()]);
  const file = await download.path();
  return { name: download.suggestedFilename(), file, json: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
async function mutateEverything(page) {
  await page.evaluate(async ([sku]) => {
    const pa = await import('/assets/js/services/product-admin.js');
    const { products: list } = await pa.loadAdminCatalog();
    const p = await pa.getAdminProduct(list[0].id);
    await pa.saveProduct({ ...p, priceCents: p.priceCents + 1234, compareAtCents: undefined });
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    await cart.addLine(sku, 2);
    await co.placeOrder({
      form: { firstName: 'Μαρίνα', lastName: 'Δοκιμή', email: `m.${Date.now()}@example.gr`, phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'cod', requestId: `r-${Math.random()}`,
    });
    await cart.addLine(sku, 1);
    const settings = await import('/assets/js/services/settings.js');
    await settings.saveSettings({ courierCents: 990, storeName: 'Άλλο Όνομα' });
    const content = await import('/assets/js/services/content.js');
    const hero = await content.getContent('hero');
    await content.saveContent('hero', { ...hero, title: 'Αλλαγμένος τίτλος' });
    const wl = await import('/assets/js/services/wishlist.js');
    await wl.toggle(list[1].id);
  }, [SKU]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('the backup page replaces the placeholder: three cards, local-only wording, counts per store', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openBackup(page);
  await expect(page.locator('[data-admin-view="placeholder"]')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveText('Αντίγραφα ασφαλείας');
  await expect(page.locator(`${VIEW} [data-backup-export]`)).toContainText('δεν είναι αντίγραφο cloud');
  await expect(page.locator(`${VIEW} [data-backup-export]`)).toContainText('στοιχεία πελατών');
  await expect(page.locator(`${VIEW} [data-backup-import]`)).toBeVisible();
  await expect(page.locator(`${VIEW} [data-backup-reset]`)).toBeVisible();
  await expect(page.locator(`${VIEW} [data-export-counts] tr[data-store="products"] [data-count]`)).toHaveText(String(products.length));
  await expect(page.locator(`${VIEW} [data-export-counts] tbody tr`)).toHaveCount(11);
  expect(errors).toEqual([]);
});

test('export downloads elan-backup-YYYY-MM-DD.json whose counts equal IndexedDB and which validates', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openBackup(page);
  const before = await snapshot(page);
  const { name, json } = await exportViaUi(page);
  expect(name).toMatch(/^elan-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(json.format).toBe('elan-demo-backup');
  expect(json.dbName).toBe('agorasite-fashion1-v1');
  expect(json.schemaVersion).toBe(1);
  expect(json.app).toEqual({ name: 'ÉLAN Fashion Boutique', demo: true });
  expect(Number.isNaN(Date.parse(json.exportedAt))).toBe(false);
  const counts = await page.evaluate(async () => (await import('/assets/js/services/backup.js')).storeCounts());
  expect(json.counts).toEqual(counts);
  for (const [s, list] of Object.entries(json.stores)) expect(list.length, s).toBe(counts[s]);
  expect(json.stores).toEqual(before);
  const v = await page.evaluate(async (obj) => (await import('/assets/js/services/backup.js')).validateImport(obj), json);
  expect(v.errors).toEqual([]);
  expect(v.ok).toBe(true);
  await expect(page.locator(VIEW)).toHaveAttribute('data-exported', /\d+/);
  expect(errors).toEqual([]);
});

test('export → mutate → import restores every store exactly; storefront and admin show the restored values', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openBackup(page);
  const before = await snapshot(page);
  const { file } = await exportViaUi(page);

  await mutateEverything(page);
  const mutated = await snapshot(page);
  expect(mutated).not.toEqual(before);

  await reopen(page);
  await chooseFile(page, file);
  await expect(page.locator(`${VIEW} [data-import-ok]`)).toBeVisible();
  const ordersRow = page.locator(`${VIEW} [data-import-preview] tr[data-store="orders"]`);
  await expect(ordersRow.locator('[data-current]')).toHaveText(String(mutated.orders.length));
  await expect(ordersRow.locator('[data-incoming]')).toContainText(String(before.orders.length));
  await page.locator(`${VIEW} [data-import-confirm]`).fill('ΑΝΤΙΚΑΤΑΣΤΑΣΗ');
  await page.locator(`${VIEW} [data-import-run]`).click();
  await expect(page.locator(`${VIEW} [data-import-success]`)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);

  await Promise.all([page.waitForEvent('load'), page.locator(`${VIEW} [data-import-continue]`).click()]);
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  expect(await snapshot(page)).toEqual(before);

  // Storefront: restored price, cart and wishlist badges reflect the backup (empty).
  const p0 = before.products[0];
  await page.goto(`/#/product/${p0.slug}`);
  const money = await page.evaluate(async (c) => (await import('/assets/js/services/pricing.js')).formatMoney(c), p0.priceCents);
  await expect(page.locator('#app [data-route]').first()).toContainText(money);
  // Admin settings: restored courier cost and store name.
  await page.goto('/#/admin/settings');
  await expect(page.locator('[data-admin-view="settings"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-field="courier"]')).toHaveValue('3,90');
  await expect(page.locator('[data-field="storeName"]')).toHaveValue(meta.settings.storeName);
  expect(errors).toEqual([]);
});

test('invalid files show Greek errors, keep the import button unavailable and leave IndexedDB unchanged', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openBackup(page);
  const good = await backupObject(page);
  const before = await snapshot(page);

  const badLine = JSON.parse(JSON.stringify(good));
  badLine.stores.orders[0].lines[0].qty = -3;
  const iris = JSON.parse(JSON.stringify(good));
  iris.stores.settings.find((s) => s.key === 'store').irisInstructions = DISHONEST_IRIS;

  const cases = [
    [fileOf('broken.json', '{"format": "elan-demo-backup", "stores": ['), /δεν είναι έγκυρο JSON/],
    [fileOf('other.json', { hello: 'world', version: 3 }), /Μη αναγνωρισμένη μορφή αρχείου/],
    [fileOf('bad-line.json', badLine), /ποσότητα της γραμμής 1/],
    [fileOf('iris.json', iris), /οδηγίες IRIS απορρίφθηκαν/],
  ];
  for (const [file, re] of cases) {
    await chooseFile(page, file);
    await expect(page.locator(VIEW)).toHaveAttribute('data-import-state', 'invalid');
    const box = page.locator(`${VIEW} [data-import-errors]`);
    await expect(box, file.name).toBeVisible();
    await expect(box.locator('li').first()).toHaveText(re);
    await expect(box).toContainText('Τα υπάρχοντα δεδομένα δεν άλλαξαν');
    await expect(page.locator(`${VIEW} [data-import-run]`)).toHaveCount(0);
    await expect(page.locator(`${VIEW} [data-import-status]`)).toHaveClass(/is-error/);
  }
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('typed confirmation: the replace button stays disabled until exactly ΑΝΤΙΚΑΤΑΣΤΑΣΗ is typed', async ({ page }) => {
  await boot(page);
  await openBackup(page);
  await chooseFile(page, fileOf('ok.json', await backupObject(page)));
  const run = page.locator(`${VIEW} [data-import-run]`);
  const confirm = page.locator(`${VIEW} [data-import-confirm]`);
  await expect(run).toBeDisabled();
  for (const wrong of ['αντικατασταση', 'ΑΝΤΙΚΑΤΑΣΤΑΣ', 'ΑΝΤΙΚΑΤΑΣΤΑΣΗ!', 'ΕΠΑΝΑΦΟΡΑ']) {
    await confirm.fill(wrong);
    await expect(run, wrong).toBeDisabled();
  }
  await confirm.fill('ΑΝΤΙΚΑΤΑΣΤΑΣΗ');
  await expect(run).toBeEnabled();
  await confirm.fill('');
  await expect(run).toBeDisabled();
});

test('a failure in the middle of the import transaction leaves every store untouched', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openBackup(page);
  const before = await snapshot(page);
  // Service level: the 200th put throws (after every store has already been cleared in the same transaction).
  const r = await page.evaluate(async () => {
    const bk = await import('/assets/js/services/backup.js');
    const obj = JSON.parse(JSON.stringify(await bk.exportAll()));
    obj.stores.products[0].priceCents += 5000;
    obj.stores.orders = [];
    const orig = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function patched(...a) {
      calls += 1;
      if (calls === 200) throw new DOMException('Simulated failure', 'DataError');
      return orig.apply(this, a);
    };
    try {
      await bk.importAll(obj);
      return { threw: false, calls };
    } catch (e) {
      return { threw: true, calls, name: e.name };
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
  });
  expect(r.threw).toBe(true);
  expect(r.calls).toBe(200);
  expect(await snapshot(page)).toEqual(before);

  // UI level: same failure through the page shows the safe-failure message.
  const changed = await backupObject(page);
  changed.stores.products[0].priceCents += 5000;
  await chooseFile(page, fileOf('changed.json', changed));
  await page.locator(`${VIEW} [data-import-confirm]`).fill('ΑΝΤΙΚΑΤΑΣΤΑΣΗ');
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    let calls = 0;
    window.__restorePut = () => { IDBObjectStore.prototype.put = orig; };
    IDBObjectStore.prototype.put = function patched(...a) {
      calls += 1;
      if (calls === 150) throw new DOMException('Simulated failure', 'DataError');
      return orig.apply(this, a);
    };
  });
  await page.locator(`${VIEW} [data-import-run]`).click();
  await expect(page.locator(`${VIEW} [data-import-errors]`)).toContainText('Η εισαγωγή απέτυχε — τα υπάρχοντα δεδομένα δεν άλλαξαν.');
  await page.evaluate(() => window.__restorePut());
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator(`${VIEW} [data-import-file]`)).toBeEnabled();
  expect(errors.filter((e) => !/Backup import failed|Simulated failure/.test(e))).toEqual([]);
});

test('double-clicking replace runs exactly one import', async ({ page }) => {
  await boot(page);
  await openBackup(page);
  await chooseFile(page, fileOf('ok.json', await backupObject(page)));
  await page.locator(`${VIEW} [data-import-confirm]`).fill('ΑΝΤΙΚΑΤΑΣΤΑΣΗ');
  await page.evaluate(() => {
    window.__clears = 0;
    const orig = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function counted(...a) { window.__clears += 1; return orig.apply(this, a); };
  });
  await page.locator(`${VIEW} [data-import-run]`).dblclick();
  await expect(page.locator(`${VIEW} [data-import-success]`)).toBeVisible();
  expect(await page.evaluate(() => window.__clears)).toBe(11);
});

test('a data-URL product image is exported and imported back intact', async ({ page }) => {
  await boot(page);
  await openBackup(page);
  const r = await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    const bk = await import('/assets/js/services/backup.js');
    const [p] = await db.getAll('products');
    const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(30000).map((_, i) => i % 251)))}`;
    await db.put('products', { ...p, images: [dataUrl, ...p.images] });
    const text = bk.serializeBackup(await bk.exportAll());
    await db.put('products', { ...p, images: p.images.slice(1) });
    await bk.importAll(JSON.parse(text));
    const back = await db.get('products', p.id);
    return { same: back.images[0] === dataUrl, len: dataUrl.length, inFile: text.includes(dataUrl) };
  });
  expect(r.inFile).toBe(true);
  expect(r.same).toBe(true);
  expect(r.len).toBeGreaterThan(20000);
});

test('reset requires typing ΕΠΑΝΑΦΟΡΑ; Escape cancels; confirmed reset restores the seed and the shop still works', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const seededBefore = await page.evaluate(async () => (await (await import('/assets/js/db.js')).get('settings', 'seeded')).seededAt);
  await mutateEverything(page);
  await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    const [p] = await db.getAll('products');
    await db.del('products', 'p-extra');
    await db.put('products', { ...p, id: 'p-extra', slug: 'p-extra' });
  });
  await openBackup(page);
  const mutated = await snapshot(page);

  // Escape closes without resetting; focus returns to the trigger.
  const open = page.locator(`${VIEW} [data-reset-open]`);
  await open.click();
  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-confirm-typed]')).toBeFocused();
  await modal.locator('[data-confirm-typed]').fill('ΕΠΑΝΑΦΟΡΑ');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(await snapshot(page)).toEqual(mutated);

  // Typed confirmation; double-click on the trigger opens ONE dialog, double-click on OK resets ONCE.
  await page.evaluate(() => {
    window.__clears = 0;
    const orig = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function counted(...a) { window.__clears += 1; return orig.apply(this, a); };
  });
  await open.dblclick();
  await expect(page.locator('.modal')).toHaveCount(1);
  const ok = page.locator('.modal.show [data-ok]');
  await expect(ok).toBeDisabled();
  for (const wrong of ['επαναφορα', 'ΕΠΑΝΑΦΟΡ', 'RESET']) {
    await page.locator('.modal.show [data-confirm-typed]').fill(wrong);
    await expect(ok).toBeDisabled();
  }
  await page.locator('.modal.show [data-confirm-typed]').fill('ΕΠΑΝΑΦΟΡΑ');
  await expect(ok).toBeEnabled();
  const loaded = page.waitForEvent('load');
  await ok.dblclick();
  await expect(page.locator(VIEW)).toHaveAttribute('data-reset-state', 'done');
  expect(await page.evaluate(() => window.__clears)).toBe(11);
  await expect(page.locator('.toast-elan')).toContainText('επανήλθε στα αρχικά δεδομένα');
  await loaded;
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');

  const after = await snapshot(page);
  expect(after.products).toHaveLength(products.length);
  expect(after.products.find((p) => p.id === 'p-extra')).toBeUndefined();
  expect(after.products.find((p) => p.id === mutated.products[0].id).priceCents).toBe(products.find((p) => p.id === mutated.products[0].id).priceCents);
  expect(after.orders).toHaveLength(sample.orders.length);
  expect(after.orders.every((o) => o.sample === true)).toBe(true);
  expect(after.customers).toHaveLength(sample.customers.length);
  expect(after.carts).toEqual([]);
  expect(after.wishlists).toEqual([]);
  const store = after.settings.find((s) => s.key === 'store');
  expect(store.courierCents).toBe(meta.settings.courierCents);
  expect(store.storeName).toBe(meta.settings.storeName);
  expect(store.irisInstructions).toBe(meta.settings.irisInstructions);
  expect(after.content.find((c) => c.key === 'hero').title).toBe(contentSeed.hero.title);
  const seededAfter = after.settings.find((s) => s.key === 'seeded').seededAt;
  expect(Date.parse(seededAfter)).toBeGreaterThan(Date.parse(seededBefore));

  // The app still works: home renders and a checkout succeeds.
  await page.goto('/#/');
  await expect(page.locator('#app [data-route="/"]')).toBeVisible();
  await expect(page.locator('#app')).toContainText(contentSeed.hero.title);
  const order = await page.evaluate(async ([sku]) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    await cart.addLine(sku, 1);
    return co.placeOrder({
      form: { firstName: 'Νίκος', lastName: 'Δοκιμή', email: 'nikos.reset@example.gr', phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'iris', requestId: 'r-after-reset',
    });
  }, [SKU]);
  expect(order.id).toMatch(/^ELAN-\d{8}-[A-Z0-9]{4}$/);
  expect(errors).toEqual([]);
});

test('keyboard: sensible Tab order through the three cards', async ({ page }) => {
  await boot(page);
  await openBackup(page);
  await page.locator(`${VIEW} [data-export]`).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(`${VIEW} [data-import-file]`)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator(`${VIEW} [data-reset-open]`)).toBeFocused();
  // With a validated file: file → confirm field → (button disabled, skipped) → reset.
  await chooseFile(page, fileOf('ok.json', await backupObject(page)));
  await page.locator(`${VIEW} [data-import-file]`).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(`${VIEW} [data-import-confirm]`)).toBeFocused();
  await page.keyboard.type('ΑΝΤΙΚΑΤΑΣΤΑΣΗ');
  await page.keyboard.press('Tab');
  await expect(page.locator(`${VIEW} [data-import-run]`)).toBeFocused();
});

test('large-file guard: a file over 50 MB is refused before it is read', async ({ page }) => {
  await boot(page);
  await openBackup(page);
  await page.evaluate(() => {
    const input = document.querySelector('[data-import-file]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(51 * 1024 * 1024)], 'huge.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator(`${VIEW} [data-import-errors]`)).toContainText('Το όριο είναι 50 MB');
  await expect(page.locator(`${VIEW} [data-import-run]`)).toHaveCount(0);
});

test('no horizontal overflow at 320–1440 (idle and with a long error list)', async ({ page }) => {
  await boot(page);
  await openBackup(page);
  const bad = await backupObject(page);
  bad.stores.orders.forEach((o) => { o.lines[0].qty = 0; o.lines[0].sku = `VERY-LONG-SKU-${'X'.repeat(30)}`; });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await reopen(page);
    expect(await overflow(page), `idle ${width}`).toBeLessThanOrEqual(0);
    await chooseFile(page, fileOf('bad.json', bad));
    const list = page.locator(`${VIEW} [data-import-errors] .backup-scroll`);
    await expect(list).toBeVisible();
    expect(await overflow(page), `errors ${width}`).toBeLessThanOrEqual(0);
    expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth), `list ${width}`).toBeLessThanOrEqual(0);
    await expect(page.locator(`${VIEW} [data-import-errors] li`)).toHaveCount(51);
  }
});
