const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog-meta.json'), 'utf8'));
const SEED = meta.settings;

const active = products.filter((p) => p.status !== 'archived');
const stocked = (p, min = 1) => p.variants.find((v) => v.stock >= min && !v.archived);
const P = active.find((p) => p.priceCents >= 3000 && p.priceCents < 5500 && stocked(p, 3)); // below the 60 € threshold
const SKU = stocked(P, 3).sku;
const PRICE = P.priceCents;

const VIEW = '[data-admin-view="settings"]';
const norm = (s) => String(s).replace(/\s/g, ' ');
const money = (c) => norm(new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100));
const parseEuro = (t) => Math.round(parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.')) * 100);
const f = (page, key) => page.locator(`${VIEW} [data-field="${key}"]`);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const dbGet = (page, store, key) => page.evaluate(async ([s, k]) => (await import('/assets/js/db.js')).get(s, k), [store, key]);
const dbAll = (page, store) => page.evaluate(async (s) => (await import('/assets/js/db.js')).getAll(s), store);

async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}
async function openSettings(page) {
  await page.goto('/#/admin/settings');
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-settings-form]')).toBeVisible();
}
/** Click save and wait until the page reports a completed save. */
async function save(page) {
  const view = page.locator(VIEW);
  const before = await view.getAttribute('data-saved');
  await page.locator(`${VIEW} [data-save]`).click();
  await expect.poll(() => view.getAttribute('data-saved')).not.toBe(before);
}
/** Navigate inside the SPA without reloading (same page session). */
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);
async function addToCart(page, sku = SKU, qty = 1) {
  await page.evaluate(async ([s, q]) => (await import('/assets/js/services/cart.js')).addLine(s, q), [sku, qty]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('fixture exists', () => { expect(P).toBeTruthy(); });

test('the page replaces the placeholder and shows every settings group', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openSettings(page);
  await expect(page.locator('h1')).toHaveText('Ρυθμίσεις');
  await expect(page.locator(`${VIEW} .admin-soon`)).toHaveCount(0);
  for (const s of ['store', 'logo', 'vat', 'shipping', 'payments', 'social', 'index']) await expect(page.locator(`${VIEW} [data-section="${s}"]`)).toBeVisible();
  // values come from the seed
  await expect(f(page, 'storeName')).toHaveValue(SEED.storeName);
  await expect(f(page, 'vatPercent')).toHaveValue('24');
  await expect(f(page, 'courier')).toHaveValue('3,90');
  await expect(f(page, 'freeShippingThreshold')).toHaveValue('60,00');
  await expect(f(page, 'codFee')).toHaveValue('2,00');
  await expect(f(page, 'irisInstructions')).toHaveValue(SEED.irisInstructions);
  // read-only informative fields
  await expect(page.locator('#f-currency')).toHaveAttribute('readonly', '');
  await expect(page.locator('#f-pricesIncludeVat')).toHaveAttribute('readonly', '');
  await expect(page.locator('[data-index-info]')).toContainText('IndexedDB');
  expect(errors).toEqual([]);
});

test('each group saves and persists after a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openSettings(page);
  const vals = {
    storeName: 'Maison Test', contactEmail: 'hello@maison.gr', contactPhone: '+30 211 123 4567', contactAddress: 'Σταδίου 5, Αθήνα',
    vatNumber: '123456789', openingHours: 'Δευ–Παρ 10:00–20:00', logoText: 'MAISON', logoSubtext: 'Athens',
    vatPercent: '13,5', courier: '4,50', freeShippingThreshold: '75,00', pickupNote: 'Παραλαβή από το ταμείο.', codFee: '1,75',
    irisInstructions: 'Αυτή είναι προσομοίωση IRIS: δεν γίνεται καμία πραγματική χρέωση σε αυτό το demo.',
    instagram: 'https://instagram.com/maison.test', facebook: 'https://facebook.com/maison', tiktok: 'https://tiktok.com/@maison', pinterest: 'https://pinterest.com/maison',
  };
  for (const [k, v] of Object.entries(vals)) await f(page, k).fill(v);
  await expect(page.locator('[data-ig-handle]')).toHaveText('@maison.test');
  await expect(page.locator('[data-dirty-note]')).toBeVisible();
  await save(page);
  await expect(page.locator('[data-dirty-note]')).toBeHidden();

  const stored = await dbGet(page, 'settings', 'store');
  expect(stored).toMatchObject({
    storeName: 'Maison Test', vatRate: 0.135, courierCents: 450, freeShippingThresholdCents: 7500, codFeeCents: 175, pickupNote: 'Παραλαβή από το ταμείο.',
    logo: { text: 'MAISON', subtext: 'Athens' },
    contact: { email: 'hello@maison.gr', phone: '+30 211 123 4567', address: 'Σταδίου 5, Αθήνα', vatNumber: '123456789', openingHours: 'Δευ–Παρ 10:00–20:00' },
    social: { instagram: vals.instagram, facebook: vals.facebook, tiktok: vals.tiktok, pinterest: vals.pinterest },
  });
  expect(stored.irisInstructions).toBe(vals.irisInstructions);
  // unknown/other keys preserved, seeded marker untouched
  expect(stored.currency).toBe('EUR');
  expect(stored.pricesIncludeVat).toBe(true);
  expect((await dbGet(page, 'settings', 'seeded')).seededAt).toBeTruthy();

  await page.reload();
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  for (const [k, v] of Object.entries(vals)) await expect(f(page, k)).toHaveValue(v);
  expect(errors).toEqual([]);
});

test('invalid values show Greek errors per field and in the summary, and nothing is written', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openSettings(page);
  const before = await dbGet(page, 'settings', 'store');
  await f(page, 'storeName').fill('   ');
  await f(page, 'contactEmail').fill('not-an-email');
  await f(page, 'contactPhone').fill('abc');
  await f(page, 'vatPercent').fill('120');
  await f(page, 'courier').fill('-3');
  await f(page, 'freeShippingThreshold').fill('δώδεκα');
  await f(page, 'codFee').fill('1,234');
  await f(page, 'facebook').fill('http://facebook.com/x');
  await f(page, 'tiktok').fill('javascript:alert(1)');
  await f(page, 'logoImage').fill('javascript:alert(1)');
  await page.locator(`${VIEW} [data-save]`).click();

  const summary = page.locator('[data-error-summary]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Διορθώστε');
  for (const k of ['storeName', 'contactEmail', 'contactPhone', 'vatPercent', 'courier', 'freeShippingThreshold', 'codFee', 'facebook', 'tiktok']) {
    await expect(f(page, k)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`[data-error-for="${k}"]`)).not.toBeEmpty();
  }
  await expect(page.locator('[data-error-for="vatPercent"]')).toContainText('0 έως 100');
  await expect(page.locator('[data-error-for="facebook"]')).toContainText('https://');
  await expect(page.locator('[data-error-for="courier"]')).toContainText('Μη έγκυρο ποσό');
  await expect(f(page, 'storeName')).toBeFocused();
  // typing clears that field's error
  await f(page, 'storeName').fill('Καλό όνομα');
  await expect(f(page, 'storeName')).not.toHaveAttribute('aria-invalid', 'true');
  // nothing written
  expect(await dbGet(page, 'settings', 'store')).toEqual(before);
  expect(errors).toEqual([]);
});

test('IRIS instructions must say «προσομοίωση» and must not claim payment; the seeded text is accepted', async ({ page }) => {
  await boot(page);
  await openSettings(page);
  const before = await dbGet(page, 'settings', 'store');
  await expect(page.locator('#hint-irisInstructions')).toContainText('προσομοίωση');
  // missing the word
  await f(page, 'irisInstructions').fill('Πληρώστε με IRIS στον κωδικό που θα δείτε παρακάτω, ευχαριστούμε πολύ.');
  await page.locator(`${VIEW} [data-save]`).click();
  await expect(page.locator('[data-error-for="irisInstructions"]')).toContainText('προσομοίωση');
  // claims real payment
  await f(page, 'irisInstructions').fill('Προσομοίωση IRIS. Η παραγγελία πληρώθηκε και είναι πληρωμένη αμέσως.');
  await page.locator(`${VIEW} [data-save]`).click();
  await expect(page.locator('[data-error-for="irisInstructions"]')).toContainText('πληρώθηκε');
  // too short
  await f(page, 'irisInstructions').fill('προσομοίωση');
  await page.locator(`${VIEW} [data-save]`).click();
  await expect(page.locator('[data-error-for="irisInstructions"]')).toContainText('20');
  expect(await dbGet(page, 'settings', 'store')).toEqual(before);
  // seeded wording and a fresh honest text pass
  await f(page, 'irisInstructions').fill(SEED.irisInstructions);
  await save(page);
  await f(page, 'irisInstructions').fill('ΠΡΟΣΟΜΟΙΩΣΗ IRIS: καμία πραγματική χρέωση. Ακολουθεί δοκιμαστικός κωδικός.');
  await save(page);
  expect((await dbGet(page, 'settings', 'store')).irisInstructions).toContain('ΠΡΟΣΟΜΟΙΩΣΗ');
});

test('free-shipping threshold change shows immediately in cart (indicator + shipping line) and on the home banner, and after reload', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await addToCart(page);
  await openSettings(page);
  await f(page, 'freeShippingThreshold').fill('100');
  await f(page, 'courier').fill('5,50');
  await save(page);

  const check = async () => {
    await go(page, '#/cart');
    await expect(page.locator('h1')).toHaveText('Καλάθι αγορών');
    await expect(page.locator('[data-freeship-msg]')).toContainText(money(10000 - PRICE));
    expect(parseEuro(await page.locator('[data-sum-shipping]').innerText())).toBe(550);
    expect(parseEuro(await page.locator('[data-sum-total]').innerText())).toBe(PRICE + 550);
    await go(page, '#/');
    await expect(page.locator('[data-banner-title]').first()).toContainText(money(10000));
    await expect(page.locator('[data-promo-item="shipping"]')).toContainText(money(10000));
    await go(page, `#/product/${P.slug}`);
    await expect(page.locator('[data-page="product"]')).toContainText(`Δωρεάν αποστολή για αγορές άνω των ${money(10000)}`);
    await expect(page.locator('[data-page="product"]')).toContainText(`Αποστολή με courier: ${money(550)}`);
  };
  await check();
  await page.reload();
  await check();
  // threshold 0 = always free
  await openSettings(page);
  await f(page, 'freeShippingThreshold').fill('0');
  await save(page);
  await go(page, '#/cart');
  await expect(page.locator('[data-sum-shipping]')).toHaveText('Δωρεάν');
  expect(errors).toEqual([]);
});

test('COD fee and courier fee change the checkout total (independent math)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await addToCart(page);
  await openSettings(page);
  await f(page, 'codFee').fill('3,50');
  await f(page, 'courier').fill('4,20');
  await save(page);
  await go(page, '#/checkout');
  await expect(page.locator('[data-page="checkout"] h1')).toBeVisible();
  await page.check('input[name="shippingMethod"][value="courier"]');
  await page.check('input[name="paymentMethod"][value="cod"]');
  await expect(page.locator('[data-sum-cod]')).toContainText(money(350));
  expect(parseEuro(await page.locator('[data-sum-shipping]').innerText())).toBe(420);
  expect(parseEuro(await page.locator('[data-sum-total]').innerText())).toBe(PRICE + 420 + 350);
  await expect(page.locator('[data-cod-note]')).toContainText(money(350));
  // IRIS: no COD fee
  await page.check('input[name="paymentMethod"][value="iris"]');
  await expect(page.locator('[data-sum-cod]')).toHaveCount(0);
  expect(parseEuro(await page.locator('[data-sum-total]').innerText())).toBe(PRICE + 420);
  // after reload the same values are used
  await page.reload();
  await page.check('input[name="paymentMethod"][value="cod"]');
  expect(parseEuro(await page.locator('[data-sum-total]').innerText())).toBe(PRICE + 420 + 350);
  // cart uses the courier fee too
  await go(page, '#/cart');
  expect(parseEuro(await page.locator('[data-sum-shipping]').innerText())).toBe(420);
  expect(errors).toEqual([]);
});

test('pickup note appears in the checkout pickup message', async ({ page }) => {
  await boot(page);
  await addToCart(page);
  await openSettings(page);
  await f(page, 'pickupNote').fill('Φέρτε το email επιβεβαίωσης.');
  await save(page);
  await go(page, '#/checkout');
  await page.check('input[name="shippingMethod"][value="pickup"]');
  await expect(page.locator('[data-pickup-note]')).toContainText('Φέρτε το email επιβεβαίωσης.');
});

test('VAT rate change drives the «ΦΠΑ περιλαμβάνεται» line', async ({ page }) => {
  await boot(page);
  await addToCart(page);
  await openSettings(page);
  await f(page, 'vatPercent').fill('13,5');
  await save(page);
  expect((await dbGet(page, 'settings', 'store')).vatRate).toBe(0.135);
  await go(page, '#/cart');
  const total = parseEuro(await page.locator('[data-sum-total]').innerText());
  const expectedVat = total - Math.round(total / 1.135);
  await expect(page.locator('.cart-vat dt')).toContainText('13,5%');
  expect(parseEuro(await page.locator('[data-sum-vat]').innerText())).toBe(expectedVat);
  await openSettings(page);
  await f(page, 'vatPercent').fill('0');
  await save(page);
  await go(page, '#/cart');
  expect(parseEuro(await page.locator('[data-sum-vat]').innerText())).toBe(0);
});

test('wordmark and logo image show in the storefront header, footer, mobile menu and admin sidebar; clearing restores Marias', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openSettings(page);
  // default
  await expect(page.locator('.site-header a.brand .brand-mark')).toHaveText('Marias');
  await expect(page.locator('.admin-brand-name')).toContainText('Marias');
  await f(page, 'logoText').fill('MAISON');
  await f(page, 'logoSubtext').fill('Athens');
  await save(page);
  await expect(page.locator('.admin-brand-name')).toContainText('MAISON');
  await expect(page.locator('.admin-brand-mark')).toHaveText('M');
  await expect(page.locator('.site-header a.brand .brand-mark')).toHaveText('MAISON');
  await expect(page.locator('.site-header a.brand .brand-sub')).toHaveText('Athens');
  await expect(page.locator('.site-footer a.brand .brand-mark')).toHaveText('MAISON');
  await expect(page.locator('#navOffcanvasLabel')).toContainText('MAISON');
  await go(page, '#/');
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  await expect(page.locator('.site-header a.brand .brand-mark')).toHaveText('MAISON');
  await page.reload();
  await expect(page.locator('.site-header a.brand .brand-mark')).toHaveText('MAISON');
  await expect(page.locator('.site-footer a.brand .brand-mark')).toHaveText('MAISON');

  // image from the library
  await openSettings(page);
  await page.locator(`${VIEW} [data-picker-toggle]`).click();
  await page.locator(`${VIEW} [data-lib="assets/images/content/hero-1.webp"]`).click();
  await expect(f(page, 'logoImage')).toHaveValue('assets/images/content/hero-1.webp');
  // alt is required with an image
  await page.locator(`${VIEW} [data-save]`).click();
  await expect(page.locator('[data-error-for="logoAlt"]')).toContainText('εναλλακτικό');
  await f(page, 'logoAlt').fill('Λογότυπο Maison');
  await save(page);
  await expect(page.locator('.site-header a.brand img.brand-logo')).toHaveAttribute('src', 'assets/images/content/hero-1.webp');
  await expect(page.locator('.site-header a.brand img.brand-logo')).toHaveAttribute('alt', 'Λογότυπο Maison');
  await expect(page.locator('.site-footer a.brand img.brand-logo')).toHaveCount(1);
  await expect(page.locator('.admin-brand-mark img')).toHaveCount(1);

  // clear everything -> default wordmark
  await f(page, 'logoText').fill('');
  await f(page, 'logoSubtext').fill('');
  await f(page, 'logoImage').fill('');
  await f(page, 'logoImage').dispatchEvent('change');
  await f(page, 'logoAlt').fill('');
  await save(page);
  await expect(page.locator('.site-header a.brand .brand-mark')).toHaveText('Marias');
  await expect(page.locator('.site-header a.brand .brand-sub')).toHaveText('Fashion Boutique');
  await expect(page.locator('.site-header a.brand img')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('logo upload accepts an image file and rejects non-images', async ({ page }) => {
  await boot(page);
  await openSettings(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator(`${VIEW} [data-picker-file]`).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(f(page, 'logoImage')).toHaveValue(/^data:image\/(webp|jpeg);base64,/);
  await f(page, 'logoAlt').fill('Δοκιμαστικό λογότυπο');
  await save(page);
  await expect(page.locator('.site-header a.brand img.brand-logo')).toHaveAttribute('src', /^data:image\//);
  // a text file is refused with a Greek message
  await page.locator(`${VIEW} [data-picker-file]`).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator(`${VIEW} [data-picker-status]`)).toContainText('δεν είναι εικόνα');
});

test('footer contact and social links follow the settings immediately', async ({ page }) => {
  await boot(page);
  await openSettings(page);
  await f(page, 'contactEmail').fill('shop@maison.gr');
  await f(page, 'contactPhone').fill('+30 210 5551234');
  await f(page, 'contactAddress').fill('Βουλής 3, Αθήνα');
  await f(page, 'vatNumber').fill('987654321');
  await f(page, 'openingHours').fill('Δευ–Σαβ 9:00–21:00');
  await f(page, 'facebook').fill('https://facebook.com/maison.shop');
  await f(page, 'tiktok').fill('');
  await f(page, 'pinterest').fill('https://pinterest.com/maison');
  await f(page, 'storeName').fill('Maison Boutique');
  await save(page);
  await expect(page.locator('.admin-topbar-name')).toHaveText('Maison Boutique');
  await go(page, '#/');
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  const footer = page.locator('.site-footer');
  await expect(footer.locator('a[href="mailto:shop@maison.gr"]')).toBeVisible();
  await expect(footer.locator('a[href="tel:+302105551234"]')).toContainText('+30 210 5551234');
  await expect(footer.locator('[data-f="address"]')).toHaveText('Βουλής 3, Αθήνα');
  await expect(footer.locator('.footer-contact-extra')).toContainText('987654321');
  await expect(footer.locator('.footer-contact-extra')).toContainText('Δευ–Σαβ 9:00–21:00');
  await expect(footer.locator('.footer-social a[href="https://facebook.com/maison.shop"]')).toBeVisible();
  await expect(footer.locator('.footer-social a[href="https://pinterest.com/maison"]')).toBeVisible();
  await expect(footer.locator('.footer-social a[href^="https://tiktok.com"]')).toHaveCount(0);
  await expect(footer.locator('[data-f="name"]')).toHaveText('Maison Boutique');
  await page.reload();
  await expect(footer.locator('a[href="mailto:shop@maison.gr"]')).toBeVisible();
  await expect(page).toHaveTitle(/Maison Boutique/);
});

test('reset to defaults (with confirmation) restores only the settings; products and orders are untouched', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openSettings(page);
  await f(page, 'storeName').fill('Αλλαγμένο');
  await f(page, 'courier').fill('9');
  await f(page, 'logoText').fill('ΧΧΧ');
  await save(page);
  const productsBefore = await dbAll(page, 'products');
  const ordersBefore = await dbAll(page, 'orders');
  const contentBefore = await dbGet(page, 'content', 'hero');
  const seededBefore = await dbGet(page, 'settings', 'seeded');
  expect((await dbGet(page, 'settings', 'store')).courierCents).toBe(900);

  // cancel keeps the edit
  await page.locator(`${VIEW} [data-reset-settings]`).click();
  await expect(page.locator('.modal.show')).toContainText('Επαναφορά προεπιλογών ρυθμίσεων');
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect((await dbGet(page, 'settings', 'store')).courierCents).toBe(900);

  await page.locator(`${VIEW} [data-reset-settings]`).click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(f(page, 'storeName')).toHaveValue(SEED.storeName);
  const stored = await dbGet(page, 'settings', 'store');
  expect(stored).toEqual({ key: 'store', ...SEED });
  expect(stored.logo).toBeUndefined();
  await expect(f(page, 'courier')).toHaveValue('3,90');
  await expect(page.locator('.site-header a.brand .brand-mark')).toHaveText('Marias');
  expect(await dbAll(page, 'products')).toEqual(productsBefore);
  expect(await dbAll(page, 'orders')).toEqual(ordersBefore);
  expect(await dbGet(page, 'content', 'hero')).toEqual(contentBefore);
  expect(await dbGet(page, 'settings', 'seeded')).toEqual(seededBefore);
  expect(errors).toEqual([]);
});

test('unsaved-changes guard: leaving asks for confirmation, staying keeps the edit', async ({ page }) => {
  await boot(page);
  await openSettings(page);
  await f(page, 'storeName').fill('Μη αποθηκευμένο');
  await page.locator('.admin-nav-link[href="#/admin/products"]').click();
  const dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('Μη αποθηκευμένες αλλαγές');
  await dlg.locator('[data-bs-dismiss="modal"]').last().click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator(VIEW)).toBeVisible();
  await expect(f(page, 'storeName')).toHaveValue('Μη αποθηκευμένο');
  await page.locator('.admin-nav-link[href="#/admin/products"]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator('[data-admin-view="products"]')).toBeVisible();
  // after saving there is no prompt
  await openSettings(page);
  await f(page, 'storeName').fill('Αποθηκευμένο');
  await save(page);
  await page.locator('.admin-nav-link[href="#/admin/products"]').click();
  await expect(page.locator('[data-admin-view="products"]')).toBeVisible();
  await expect(page.locator('.modal.show')).toHaveCount(0);
});

test('keyboard: fields follow a logical tab order; Escape closes the reset dialog', async ({ page }) => {
  await boot(page);
  await openSettings(page);
  await f(page, 'storeName').focus();
  const order = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement.dataset.field || document.activeElement.id));
  }
  expect(order).toEqual(['contactEmail', 'contactPhone', 'contactAddress', 'vatNumber']);
  await page.locator(`${VIEW} [data-reset-settings]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.modal.show')).toBeVisible();
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
});

for (const w of [320, 390, 768, 1440]) {
  test(`no horizontal overflow at ${w}px`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: w, height: 900 });
    await boot(page);
    await openSettings(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await f(page, 'storeName').fill('');
    await page.locator(`${VIEW} [data-save]`).click();
    await expect(page.locator('[data-error-summary]')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------- fix round
test('threshold 0: every storefront string says shipping is free for all orders and never prints 0,00 €', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await addToCart(page);
  await openSettings(page);
  await f(page, 'freeShippingThreshold').fill('0');
  await save(page);
  const ALL = 'Δωρεάν αποστολή σε όλες τις παραγγελίες';
  await go(page, '#/');
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  await expect(page.locator('[data-section="promo"] [data-banner-title]').first()).toHaveText(ALL);
  await expect(page.locator('[data-promo-item="shipping"]')).toContainText('Για όλες τις παραγγελίες');
  await expect(page.locator('.site-footer [data-footer-notes]')).toContainText(ALL);
  await expect(page.locator('[data-page="home"]')).not.toContainText('0,00');
  await expect(page.locator('.site-footer')).not.toContainText('0,00');
  await expect(page.locator('#navOffcanvas .offcanvas-note')).toHaveText(ALL.replace('Δωρεάν αποστολή σε όλες τις παραγγελίες', 'Δωρεάν αποστολή σε όλες τις παραγγελίες'));
  await go(page, `#/product/${P.slug}`);
  await expect(page.locator('.pdp-trust')).toContainText(ALL);
  await expect(page.locator('[data-page="product"]')).toContainText(`${ALL}.`);
  await expect(page.locator('[data-page="product"]')).not.toContainText('0,00 €');
  await go(page, '#/cart');
  await expect(page.locator('[data-freeship-msg]')).toContainText('δωρεάν μεταφορικά');
  await expect(page.locator('[data-freeship]')).not.toContainText('0,00');
  await go(page, '#/checkout');
  await expect(page.locator('[data-page="checkout"]')).toContainText(ALL);
  await expect(page.locator('[data-page="checkout"] .co-choice-desc').first()).not.toContainText('0,00');
  await page.reload();
  await expect(page.locator('[data-page="checkout"]')).toContainText(ALL);
  expect(errors).toEqual([]);
});

test('saveSettings merges contact inside the transaction: two sequential saves of different keys keep both', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const m = await import('/assets/js/services/settings.js');
    await m.saveSettings({ contact: { email: 'one@example.gr' } });
    await m.saveSettings({ contact: { phone: '+30 210 1112233' } });
  });
  const s = await dbGet(page, 'settings', 'store');
  expect(s.contact).toEqual({ email: 'one@example.gr', phone: '+30 210 1112233', address: SEED.contact.address });
});

test('confirmation never renders a stored IRIS text that breaks the honesty guard', async ({ page }) => {
  await boot(page);
  await addToCart(page);
  const id = await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    const cur = await db.get('settings', 'store');
    await db.put('settings', { ...cur, irisInstructions: 'Η παραγγελία πληρώ​θηκε ήδη, μην κάνετε τίποτα άλλο.' });
    const m = await import('/assets/js/services/checkout.js');
    const o = await m.placeOrder({
      form: { firstName: 'Νίκος', lastName: 'Γεωργίου', email: 'nikos@example.gr', phone: '2101234567', address: 'Σταδίου 5', city: 'Αθήνα', postalCode: '10562', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'iris', requestId: `iris-${Math.random()}`,
    });
    return o.id;
  });
  await go(page, `#/order/${id}`);
  await expect(page.locator('[data-iris-instructions]')).toHaveText(SEED.irisInstructions);
});
