const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const D = JSON.parse(fs.readFileSync(path.join(root, 'data/content.json'), 'utf8'));
const active = products.filter((p) => p.status !== 'archived');
const [PA, PB] = active;

const VIEW = '[data-admin-view="content"]';
const PANEL = `${VIEW} [data-panel]`;
const HOME = '[data-page="home"]';
const DEMO_LABEL = 'Επιλεγμένο περιεχόμενο — demo, όχι ζωντανή σύνδεση με Instagram';
const norm = (s) => String(s).replace(/\s/g, ' ');
const money = (c) => norm(new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100));
const bind = (page, path_) => page.locator(`${PANEL} [data-bind="${path_}"]`);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); if (process.env.DBG) console.log(e.stack); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const dbGet = (page, store, key) => page.evaluate(async ([s, k]) => (await import('/assets/js/db.js')).get(s, k), [store, key]);
const dbPut = (page, store, val) => page.evaluate(async ([s, v]) => (await import('/assets/js/db.js')).put(s, v), [store, val]);
const stored = async (page, key) => { const { key: _k, ...rest } = await dbGet(page, 'content', key); return rest; };
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

async function boot(page) {
  await page.goto('/#/');
  await expect(page.locator('#app [data-route]').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}
async function openContent(page, tab = 'hero') {
  await page.goto('/#/admin/content');
  await expect(page.locator(VIEW)).toHaveAttribute('data-ready', 'true');
  if ((await page.locator(VIEW).getAttribute('data-tab')) !== tab) await openTab(page, tab);
  await expect(page.locator(VIEW)).toHaveAttribute('data-tab', tab);
}
async function openTab(page, tab) {
  await page.locator(`${VIEW} [data-tab="${tab}"]`).click();
  await expect(page.locator(VIEW)).toHaveAttribute('data-tab', tab);
  await expect(page.locator(`${VIEW} [data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
}
async function save(page) {
  const view = page.locator(VIEW);
  const before = await view.getAttribute('data-saved');
  await page.locator(`${PANEL} [data-save]`).click();
  await expect.poll(() => view.getAttribute('data-saved')).not.toBe(before);
}
async function openHome(page) {
  await go(page, '#/');
  await expect(page.locator(HOME)).toBeVisible();
}
/** Library pick inside the picker whose text input has the given bind path. */
async function pickFromLibrary(page, bindPath, file) {
  const picker = page.locator(`${PANEL} [data-image-picker]:has([data-bind="${bindPath}"])`);
  await picker.locator('[data-picker-toggle]').click();
  await picker.locator(`[data-lib="assets/images/content/${file}"]`).click();
  await expect(bind(page, bindPath)).toHaveValue(`assets/images/content/${file}`);
}
const items = (page, list) => page.locator(`${PANEL} [data-item^="${list}."]:not(.cms-link-row):not(.cms-note-row)`);

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('the page replaces the placeholder: seven keyboard-operable tabs, hero first', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page);
  await expect(page.locator('h1')).toHaveText('Περιεχόμενο');
  await expect(page.locator(`${VIEW} .admin-soon`)).toHaveCount(0);
  const tabs = page.locator(`${VIEW} [role="tab"]`);
  await expect(tabs).toHaveCount(7);
  await expect(page.locator(`${VIEW} [role="tablist"]`)).toHaveAttribute('aria-label', /περιεχομένου/);
  await expect(page.locator(`${VIEW} [data-tab="hero"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`${VIEW} [data-tab="hero"]`)).toHaveAttribute('tabindex', '0');
  await expect(page.locator(`${VIEW} [data-tab="banners"]`)).toHaveAttribute('tabindex', '-1');
  await expect(page.locator(PANEL)).toHaveAttribute('role', 'tabpanel');
  await expect(page.locator(PANEL)).toHaveAttribute('aria-labelledby', 'tab-hero');
  await expect(bind(page, 'title')).toHaveValue(D.hero.title);
  // arrows move focus, Enter activates, Home/End jump
  await page.locator(`${VIEW} [data-tab="hero"]`).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`${VIEW} [data-tab="banners"]`)).toBeFocused();
  await expect(page.locator(`${VIEW} [data-tab="hero"]`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator(VIEW)).toHaveAttribute('data-tab', 'banners');
  await page.keyboard.press('End');
  await expect(page.locator(`${VIEW} [data-tab="footer"]`)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`${VIEW} [data-tab="hero"]`)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(`${VIEW} [data-tab="footer"]`)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator(VIEW)).toHaveAttribute('data-tab', 'footer');
  expect(errors).toEqual([]);
});

test('hero: edit title, subtitle, CTA, image from the picker, alt and focal point; live preview; home follows after navigation and reload', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page);
  await bind(page, 'title').fill('Νέος τίτλος hero');
  await bind(page, 'subtitle').fill('Νέος υπότιτλος hero');
  await bind(page, 'ctaLabel').fill('Δείτε τα ανδρικά');
  await bind(page, 'ctaHref').fill('#/catalog/men');
  await pickFromLibrary(page, 'image', 'banner-1.webp');
  await bind(page, 'alt').fill('Νέα περιγραφή φωτογραφίας hero');
  await bind(page, 'focal').selectOption('50% 50%');
  // live preview
  const pv = page.locator(`${PANEL} [data-hero-preview]`);
  await expect(pv.locator('[data-prev-title]')).toHaveText('Νέος τίτλος hero');
  await expect(pv.locator('[data-prev-sub]')).toHaveText('Νέος υπότιτλος hero');
  await expect(pv.locator('[data-prev-cta]')).toHaveText('Δείτε τα ανδρικά');
  await expect(pv.locator('[data-prev-img]')).toHaveAttribute('src', 'assets/images/content/banner-1.webp');
  await expect(pv.locator('[data-prev-img]')).toHaveCSS('object-position', '50% 50%');
  await expect(page.locator(`${PANEL} [data-dirty-note]`)).toBeVisible();
  await save(page);
  await expect(page.locator(`${PANEL} [data-dirty-note]`)).toBeHidden();

  const hero = await stored(page, 'hero');
  expect(hero).toMatchObject({ title: 'Νέος τίτλος hero', image: 'assets/images/content/banner-1.webp', imageSm: 'assets/images/content/banner-1-sm.webp', focal: '50% 50%', ctaHref: '#/catalog/men' });
  expect(hero.width).toBeGreaterThan(100);
  expect(hero.height).toBeGreaterThan(100);

  const check = async () => {
    await expect(page.locator('.home-hero-title')).toHaveText('Νέος τίτλος hero');
    await expect(page.locator('.home-hero-text')).toHaveText('Νέος υπότιτλος hero');
    await expect(page.locator('.home-hero-actions a').first()).toHaveAttribute('href', '#/catalog/men');
    await expect(page.locator('.home-hero-actions a').first()).toHaveText('Δείτε τα ανδρικά');
    await expect(page.locator('.home-hero-img')).toHaveAttribute('src', 'assets/images/content/banner-1.webp');
    await expect(page.locator('.home-hero-img')).toHaveAttribute('alt', 'Νέα περιγραφή φωτογραφίας hero');
    await expect(page.locator('[data-section="hero"]')).toHaveAttribute('style', /--hero-focal: 50% 50%/);
  };
  await openHome(page);
  await check();
  await page.reload();
  await check();
  // back in the admin the saved values are shown
  await openContent(page);
  await expect(bind(page, 'title')).toHaveValue('Νέος τίτλος hero');
  await expect(bind(page, 'focal')).toHaveValue('50% 50%');
  expect(errors).toEqual([]);
});

test('hero: an uploaded file is stored as a data URL and shown on the home page', async ({ page }) => {
  await boot(page);
  await openContent(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator(`${PANEL} [data-picker-file]`).first().setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: png });
  await expect(bind(page, 'image')).toHaveValue(/^data:image\/(webp|jpeg);base64,/);
  await bind(page, 'alt').fill('Δοκιμαστική φωτογραφία');
  await save(page);
  expect((await stored(page, 'hero')).image).toMatch(/^data:image\//);
  expect((await stored(page, 'hero')).imageSm).toBeUndefined();
  await openHome(page);
  await expect(page.locator('.home-hero-img')).toHaveAttribute('src', /^data:image\//);
  // a text file is refused
  await openContent(page);
  await page.locator(`${PANEL} [data-picker-file]`).first().setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.locator(`${PANEL} [data-picker-status]`).first()).toContainText('δεν είναι εικόνα');
});

test('image picker: a typed URL is checked; an http:// or javascript: source is refused with a Greek message', async ({ page }) => {
  await boot(page);
  await openContent(page);
  const input = bind(page, 'image');
  await input.fill('javascript:alert(1)');
  await input.dispatchEvent('change');
  await expect(page.locator(`${PANEL} [data-picker-status]`).first()).toContainText('Μη έγκυρη');
  await input.fill('http://example.com/a.jpg');
  await input.dispatchEvent('change');
  await expect(page.locator(`${PANEL} [data-picker-status]`).first()).toContainText('https://');
  await input.fill('assets/images/content/nope.webp');
  await input.dispatchEvent('change');
  await expect(page.locator(`${PANEL} [data-picker-status]`).first()).toContainText('δεν φορτώνει');
  await expect(page.locator(`${PANEL} [data-picker-thumb]`).first()).toHaveClass(/is-error|/);
});

test('invalid hero values: per-field Greek errors, summary, javascript: link rejected, nothing written', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page);
  const before = await dbGet(page, 'content', 'hero');
  await bind(page, 'title').fill('');
  await bind(page, 'ctaHref').fill('javascript:alert(1)');
  await bind(page, 'secondaryLabel').fill('Μόνο ετικέτα');
  await bind(page, 'secondaryHref').fill('');
  await bind(page, 'focal').evaluate((el) => { el.innerHTML += '<option value="bad">bad</option>'; el.value = 'bad'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator(`${PANEL} [data-save]`).click();
  const summary = page.locator(`${PANEL} [data-error-summary]`);
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Διορθώστε');
  await expect(page.locator(`${PANEL} [data-error-for="title"]`)).toContainText('υποχρεωτικό');
  await expect(page.locator(`${PANEL} [data-error-for="ctaHref"]`)).toContainText('#/');
  await expect(page.locator(`${PANEL} [data-error-for="focal"]`)).not.toBeEmpty();
  await expect(bind(page, 'ctaHref')).toHaveAttribute('aria-invalid', 'true');
  await expect(bind(page, 'title')).toBeFocused();
  // the summary links to the field
  await summary.locator('button', { hasText: 'Κουμπί: σύνδεσμος' }).click();
  await expect(bind(page, 'ctaHref')).toBeFocused();
  expect(await dbGet(page, 'content', 'hero')).toEqual(before);
  // the invalid draft is unsaved: leaving asks, discarding shows the untouched home page
  await go(page, '#/');
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator(HOME)).toBeVisible();
  await expect(page.locator('.home-hero-title')).toHaveText(D.hero.title);
  expect(errors).toEqual([]);
});

test('banners: add, edit, reorder, deactivate and remove persist and render on the home page', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page, 'banners');
  await expect(items(page, 'items')).toHaveCount(D.banners.items.length);
  await expect(page.locator('[data-token-docs]')).toContainText('{freeShipping}');
  await page.locator(`${PANEL} [data-act="add"][data-list="items"]`).click();
  const n = D.banners.items.length;
  await expect(items(page, 'items')).toHaveCount(n + 1);
  await expect(page.locator(`${PANEL} [data-item="items.${n}"]`)).toBeFocused();
  await bind(page, `items.${n}.title`).fill('Banner δοκιμής {freeShipping}');
  await bind(page, `items.${n}.text`).fill('Κείμενο banner');
  await bind(page, `items.${n}.ctaLabel`).fill('Δείτε');
  await bind(page, `items.${n}.ctaHref`).fill('#/catalog');
  await pickFromLibrary(page, `items.${n}.image`, 'banner-3.webp');
  await bind(page, `items.${n}.alt`).fill('Φωτογραφία banner');
  // move it to the top (keyboard-focus stays on a usable button)
  for (let i = 0; i < n; i += 1) await page.locator(`${PANEL} [data-act="up"][data-list="items"][data-idx="${n - i}"]`).click();
  await expect(bind(page, 'items.0.title')).toHaveValue('Banner δοκιμής {freeShipping}');
  await expect(page.locator(`${PANEL} [data-act="up"][data-list="items"][data-idx="0"]`)).toBeDisabled();
  await save(page);
  expect((await stored(page, 'banners')).items[0]).toMatchObject({ title: 'Banner δοκιμής {freeShipping}', placement: 'promo', image: 'assets/images/content/banner-3.webp' });

  await openHome(page);
  const titles = page.locator('[data-section="promo"] [data-banner-title]');
  await expect(titles).toHaveCount(2);
  await expect(titles.first()).toHaveText(`Banner δοκιμής ${money(6000)}`);
  await page.reload();
  await expect(page.locator('[data-section="promo"] [data-banner-title]').first()).toHaveText(`Banner δοκιμής ${money(6000)}`);

  // deactivate -> hidden on home; remove -> gone from storage
  await openContent(page, 'banners');
  await page.locator(`${PANEL} [data-bind="items.0.active"]`).uncheck();
  await save(page);
  expect((await stored(page, 'banners')).items[0].active).toBe(false);
  await openHome(page);
  await expect(page.locator('[data-section="promo"] [data-banner-title]')).toHaveCount(1);
  await openContent(page, 'banners');
  await page.locator(`${PANEL} [data-act="remove"][data-list="items"][data-idx="0"]`).click();
  await expect(items(page, 'items')).toHaveCount(n);
  await save(page);
  expect((await stored(page, 'banners')).items.map((b) => b.id)).toEqual(D.banners.items.map((b) => b.id));
  expect(errors).toEqual([]);
});

test('banner validation: javascript: link, unpaired CTA and missing title are rejected per field', async ({ page }) => {
  await boot(page);
  await openContent(page, 'banners');
  const before = await dbGet(page, 'content', 'banners');
  await bind(page, 'items.0.ctaHref').fill('javascript:alert(1)');
  await bind(page, 'items.1.ctaLabel').fill('');
  await bind(page, 'items.1.ctaHref').fill('#/catalog');
  await bind(page, 'items.2.title').fill('');
  await page.locator(`${PANEL} [data-save]`).click();
  await expect(page.locator(`${PANEL} [data-error-for="items.0.ctaHref"]`)).toContainText('#/');
  await expect(page.locator(`${PANEL} [data-error-for="items.1"]`)).toContainText('συμπληρώνονται μαζί');
  await expect(page.locator(`${PANEL} [data-error-for="items.2.title"]`)).toContainText('υποχρεωτικό');
  expect(await dbGet(page, 'content', 'banners')).toEqual(before);
});

test('collections: add, reorder, remove and department photo persist and render', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page, 'collections');
  const n = D.collections.items.length;
  await expect(items(page, 'departments')).toHaveCount(4);
  await expect(page.locator(`${PANEL} [data-item="departments.0"] [data-act]`)).toHaveCount(0); // fixed tiles: no add/remove/move
  await pickFromLibrary(page, 'departments.0.image', 'collection-2.webp');
  await page.locator(`${PANEL} [data-act="add"][data-list="items"]`).click();
  await bind(page, `items.${n}.title`).fill('Νέα συλλογή δοκιμής');
  await bind(page, `items.${n}.href`).fill('#/catalog/shoes');
  await bind(page, `items.${n}.text`).fill('Περιγραφή δοκιμής');
  await page.locator(`${PANEL} [data-act="up"][data-list="items"][data-idx="${n}"]`).click();
  await page.locator(`${PANEL} [data-act="up"][data-list="items"][data-idx="${n - 1}"]`).click();
  await save(page);
  const doc = await stored(page, 'collections');
  expect(doc.items).toHaveLength(n + 1);
  expect(doc.items[n - 2].title).toBe('Νέα συλλογή δοκιμής');
  expect(doc.departments[0].image).toBe('assets/images/content/collection-2.webp');

  await openHome(page);
  const cards = page.locator('[data-section="collections"] .collection-card');
  await expect(cards).toHaveCount(n + 1);
  await expect(cards.nth(n - 2).locator('.collection-card-title')).toHaveText('Νέα συλλογή δοκιμής');
  await expect(cards.nth(n - 2)).toHaveAttribute('href', '#/catalog/shoes');
  await expect(page.locator('.dept-card').first().locator('img')).toHaveAttribute('src', 'assets/images/content/collection-2.webp');
  await page.reload();
  await expect(page.locator('[data-section="collections"] .collection-card')).toHaveCount(n + 1);

  await openContent(page, 'collections');
  await page.locator(`${PANEL} [data-act="remove"][data-list="items"][data-idx="${n - 2}"]`).click();
  await save(page);
  expect((await stored(page, 'collections')).items.map((c) => c.id)).toEqual(D.collections.items.map((c) => c.id));
  await page.locator(`${PANEL} [data-act="add"][data-list="items"]`).click();
  await bind(page, `items.${n}.href`).fill('javascript:alert(1)');
  await page.locator(`${PANEL} [data-save]`).click();
  await expect(page.locator(`${PANEL} [data-error-for="items.${n}.href"]`)).toContainText('#/');
  expect(errors).toEqual([]);
});

test('instagram: label and mode are fixed; posts add/reorder/remove; product selection feeds the shop-the-look modal', async ({ page }) => {
  // ~80 sequential steps across admin and storefront: needs more than the default 30 s budget on a loaded
  // machine (it was observed timing out mid-way, never failing an assertion).
  test.slow();
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page, 'instagram');
  // fixed honest label, read-only mode, integration note
  await expect(page.locator(`${PANEL} [data-insta-label]`)).toHaveText(DEMO_LABEL);
  await expect(page.locator(`${PANEL} [data-insta-label]`)).not.toHaveAttribute('contenteditable', /.*/);
  await expect(page.locator(`${PANEL} #c-instagram-mode`)).toHaveAttribute('readonly', '');
  await expect(page.locator(`${PANEL} [data-bind="mode"]`)).toHaveCount(0);
  await expect(page.locator(`${PANEL} [data-bind="label"]`)).toHaveCount(0);
  await expect(page.locator(`${PANEL} [data-insta-note]`)).toContainText('Meta');
  await expect(page.locator(`${PANEL} [data-insta-note]`)).toContainText('scraping');

  const n = D.instagram.posts.length;
  await page.locator(`${PANEL} [data-act="add"][data-list="posts"]`).click();
  await expect(items(page, 'posts')).toHaveCount(n + 1);
  const host = page.locator(`${PANEL} [data-post="${n}"]`);
  await bind(page, `posts.${n}.caption`).fill('Λεζάντα νέας ανάρτησης');
  await bind(page, `posts.${n}.alt`).fill('Νέα φωτογραφία ανάρτησης');
  await pickFromLibrary(page, `posts.${n}.image`, 'insta-5.webp');
  // search + select products (thumbnails shown)
  await host.locator('[data-product-search]').fill(PA.name.split(' ').slice(0, 2).join(' '));
  const resA = host.locator(`[data-results] [data-toggle-product="${PA.id}"]`);
  await expect(resA).toBeVisible();
  await expect(resA.locator('img')).toHaveCount(1);
  await resA.click();
  await expect(host.locator(`[data-chips] [data-chip="${PA.id}"] img`)).toHaveCount(1);
  await expect(resA).toHaveAttribute('aria-pressed', 'true');
  await host.locator('[data-product-search]').fill(PB.name.split(' ').slice(0, 2).join(' '));
  await host.locator(`[data-results] [data-toggle-product="${PB.id}"]`).click();
  await expect(host.locator('[data-chips] [data-chip]')).toHaveCount(2);
  // toggling off removes it
  await host.locator(`[data-chips] [data-chip="${PB.id}"] button`).click();
  await expect(host.locator('[data-chips] [data-chip]')).toHaveCount(1);
  await host.locator(`[data-results] [data-toggle-product="${PB.id}"]`).click();
  await expect(host.locator('[data-chips] [data-chip]')).toHaveCount(2);
  // fill up to six, the seventh is refused with a message
  for (const p of active.slice(2, 6)) {
    await host.locator('[data-product-search]').fill(p.id);
    await host.locator(`[data-results] [data-toggle-product="${p.id}"]`).click();
  }
  await expect(host.locator('[data-chips] [data-chip]')).toHaveCount(6);
  await host.locator('[data-product-search]').fill(active[6].id);
  await host.locator(`[data-results] [data-toggle-product="${active[6].id}"]`).click();
  await expect(host.locator('[data-product-msg]')).toContainText('6');
  await expect(host.locator('[data-chips] [data-chip]')).toHaveCount(6);
  // trim back to exactly PA + PB
  for (const p of active.slice(2, 6)) await host.locator(`[data-chips] [data-chip="${p.id}"] button`).click();
  await expect(host.locator('[data-chips] [data-chip]')).toHaveCount(2);
  await save(page);
  const doc = await stored(page, 'instagram');
  expect(doc.posts[n]).toMatchObject({ caption: 'Λεζάντα νέας ανάρτησης', image: 'assets/images/content/insta-5.webp' });
  expect(doc.posts[n].productIds.sort()).toEqual([PA.id, PB.id].sort());

  await openHome(page);
  await expect(page.locator('[data-section="instagram"] [data-insta-tile]')).toHaveCount(n + 1);
  await expect(page.locator('[data-section="instagram"]')).toContainText(DEMO_LABEL);
  await page.locator(`[data-section="instagram"] [data-insta-tile="${doc.posts[n].id}"]`).click();
  const modal = page.locator('[data-insta-modal].show');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-insta-caption]')).toHaveText('Λεζάντα νέας ανάρτησης');
  await expect(modal.locator('.stl-item')).toHaveCount(2);
  await expect(modal).toContainText(PA.name);
  await expect(modal).toContainText(PB.name);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-insta-modal]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-insta-modal].show')).toHaveCount(0);

  // reorder to the top and remove again
  await openContent(page, 'instagram');
  for (let i = n; i > 0; i -= 1) await page.locator(`${PANEL} [data-act="up"][data-list="posts"][data-idx="${i}"]`).click();
  await save(page);
  expect((await stored(page, 'instagram')).posts[0].id).toBe(doc.posts[n].id);
  await openHome(page);
  await expect(page.locator('[data-section="instagram"] [data-insta-tile]').first()).toHaveAttribute('data-insta-tile', doc.posts[n].id);
  await openContent(page, 'instagram');
  await page.locator(`${PANEL} [data-act="remove"][data-list="posts"][data-idx="0"]`).click();
  await save(page);
  expect((await stored(page, 'instagram')).posts.map((p) => p.id)).toEqual(D.instagram.posts.map((p) => p.id));
  expect(errors).toEqual([]);
});

test('instagram validation: http:// profile and permalink, javascript: permalink and a missing handle are rejected per field', async ({ page }) => {
  await boot(page);
  await openContent(page, 'instagram');
  const before = await dbGet(page, 'content', 'instagram');
  await bind(page, 'profileUrl').fill('http://instagram.com/x');
  await bind(page, 'handle').fill('');
  await bind(page, 'posts.0.permalink').fill('javascript:alert(1)');
  await bind(page, 'posts.1.permalink').fill('http://instagram.com/p/1');
  await page.locator(`${PANEL} [data-save]`).click();
  await expect(page.locator(`${PANEL} [data-error-for="profileUrl"]`)).toContainText('https://');
  await expect(page.locator(`${PANEL} [data-error-for="handle"]`)).toContainText('υποχρεωτικό');
  await expect(page.locator(`${PANEL} [data-error-for="posts.0.permalink"]`)).toContainText('https://');
  await expect(page.locator(`${PANEL} [data-error-for="posts.1.permalink"]`)).toContainText('https://');
  expect(await dbGet(page, 'content', 'instagram')).toEqual(before);
});

test('promos: tokens are documented and filled on the home page; add and remove', async ({ page }) => {
  await boot(page);
  await openContent(page, 'promos');
  const docs = page.locator('[data-token-docs]');
  await expect(docs).toContainText('{freeShipping}');
  await expect(docs).toContainText('{storeName}');
  const n = D.promos.items.length;
  await page.locator(`${PANEL} [data-act="add"][data-list="items"]`).click();
  await bind(page, `items.${n}.title`).fill('Προνόμιο {storeName}');
  await bind(page, `items.${n}.text`).fill('Δωρεάν από {freeShipping}');
  await bind(page, `items.${n}.icon`).fill('star');
  await save(page);
  await openHome(page);
  const row = page.locator(`[data-section="promo"] [data-promo-item="promo-1"]`);
  await expect(row).toContainText('Προνόμιο ÉLAN Fashion Boutique');
  await expect(row).toContainText(`Δωρεάν από ${money(6000)}`);
  await openContent(page, 'promos');
  await bind(page, `items.${n}.icon`).fill('Bad Icon!');
  await page.locator(`${PANEL} [data-save]`).click();
  await expect(page.locator(`${PANEL} [data-error-for="items.${n}.icon"]`)).not.toBeEmpty();
  await page.locator(`${PANEL} [data-act="remove"][data-list="items"][data-idx="${n}"]`).click();
  await save(page);
  expect((await stored(page, 'promos')).items).toHaveLength(n);
});

test('newsletter: the display switch hides the home section; local subscribers are listed and exported as safe CSV', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  // subscribe on the home page first
  await openHome(page);
  await page.locator('#newsletterEmail').fill('Tester@Example.gr');
  await page.locator('[data-newsletter-form] button[type="submit"]').click();
  await expect(page.locator('[data-newsletter-status]')).toContainText('Ευχαριστούμε');
  await dbPut(page, 'settings', {
    key: 'newsletterSubscribers',
    list: [...(await dbGet(page, 'settings', 'newsletterSubscribers')).list, { email: '=cmd|calc@evil.gr', createdAt: '2026-10-01T10:00:00.000Z' }],
  });

  await openContent(page, 'newsletter');
  await expect(page.locator(`${PANEL} [data-subscriber-count]`)).toContainText('2 εγγραφές');
  await expect(page.locator(`${PANEL} .cms-sub-table`)).toContainText('tester@example.gr');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`${PANEL} [data-export-subscribers]`).click()]);
  expect(download.suggestedFilename()).toMatch(/^elan-newsletter-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text.charCodeAt(0)).toBe(0xFEFF);
  const { parseCsv } = await import(pathToFileURL(path.join(root, 'tests/unit/csv-helper.mjs')).href);
  const rows = parseCsv(text);
  expect(rows[0]).toEqual(['email', 'createdAt']);
  expect(rows.map((r) => r[0])).toContain('tester@example.gr');
  expect(rows.map((r) => r[0])).toContain("'=cmd|calc@evil.gr");

  // display switch
  await bind(page, 'enabled').uncheck();
  await bind(page, 'title').fill('Νέος τίτλος newsletter');
  await bind(page, 'privacyNote').fill('Σημείωση απορρήτου δοκιμής.');
  await save(page);
  expect((await stored(page, 'newsletter')).enabled).toBe(false);
  await openHome(page);
  await expect(page.locator('[data-section="newsletter"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-section="newsletter"]')).toHaveCount(0);
  await openContent(page, 'newsletter');
  await bind(page, 'enabled').check();
  await save(page);
  await openHome(page);
  await expect(page.locator('[data-section="newsletter"] .home-newsletter-title')).toHaveText('Νέος τίτλος newsletter');
  await expect(page.locator('[data-newsletter-privacy]')).toHaveText('Σημείωση απορρήτου δοκιμής.');
  await expect(page.locator('[data-section="newsletter"]')).toContainText('δεν αποστέλλεται');
  expect(errors).toEqual([]);
});

test('newsletter tab with no subscribers disables the export', async ({ page }) => {
  await boot(page);
  await openContent(page, 'newsletter');
  await expect(page.locator(`${PANEL} [data-subscriber-count]`)).toContainText('0 εγγραφές');
  await expect(page.locator(`${PANEL} [data-export-subscribers]`)).toBeDisabled();
});

test('footer: tagline, columns, links, notes and copyright render in the footer; bad links are rejected', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page, 'footer');
  const cols = D.footer.columns.length;
  await bind(page, 'tagline').fill('Νέο σλόγκαν υποσέλιδου');
  await bind(page, 'copyright').fill('© 2026 {storeName} · Όλα τα δικαιώματα');
  await page.locator(`${PANEL} [data-act="add"][data-list="columns"]`).click();
  await bind(page, `columns.${cols}.title`).fill('Βοήθεια');
  await page.locator(`${PANEL} [data-act="add"][data-list="columns.${cols}.links"]`).click();
  await bind(page, `columns.${cols}.links.0.label`).fill('Συχνές ερωτήσεις');
  await bind(page, `columns.${cols}.links.0.href`).fill('https://example.com/faq');
  await page.locator(`${PANEL} [data-act="add"][data-list="columns.${cols}.links"]`).click();
  await bind(page, `columns.${cols}.links.1.label`).fill('Επιστροφές');
  await bind(page, `columns.${cols}.links.1.href`).fill('#/catalog');
  await page.locator(`${PANEL} [data-act="up"][data-list="columns.${cols}.links"][data-idx="1"]`).click();
  await page.locator(`${PANEL} [data-act="add"][data-list="notes"]`).click();
  const nn = D.footer.notes.length;
  await bind(page, `notes.${nn}`).fill('Νέα σημείωση {freeShipping}');
  await save(page);
  const doc = await stored(page, 'footer');
  expect(doc.columns[cols].links.map((l) => l.label)).toEqual(['Επιστροφές', 'Συχνές ερωτήσεις']);

  await openHome(page);
  const footer = page.locator('.site-footer');
  await expect(footer.locator('.footer-tagline')).toHaveText('Νέο σλόγκαν υποσέλιδου');
  await expect(footer.locator('[data-footer-columns] .footer-heading')).toHaveCount(cols + 1);
  await expect(footer.locator('[data-footer-columns] .footer-heading').last()).toHaveText('Βοήθεια');
  await expect(footer.locator('[data-footer-columns] a[href="https://example.com/faq"]')).toHaveText('Συχνές ερωτήσεις');
  await expect(footer.locator('[data-footer-notes] li').last()).toHaveText(`Νέα σημείωση ${money(6000)}`);
  await expect(footer.locator('[data-footer-copy]')).toHaveText('© 2026 ÉLAN Fashion Boutique · Όλα τα δικαιώματα');
  await page.reload();
  await expect(footer.locator('.footer-tagline')).toHaveText('Νέο σλόγκαν υποσέλιδου');

  await openContent(page, 'footer');
  const before = await dbGet(page, 'content', 'footer');
  await bind(page, `columns.${cols}.links.0.href`).fill('javascript:alert(1)');
  await bind(page, 'tagline').fill('');
  await page.locator(`${PANEL} [data-save]`).click();
  await expect(page.locator(`${PANEL} [data-error-for="columns.${cols}.links.0.href"]`)).toContainText('#/');
  await expect(page.locator(`${PANEL} [data-error-for="tagline"]`)).toContainText('υποχρεωτικό');
  expect(await dbGet(page, 'content', 'footer')).toEqual(before);
  expect(errors).toEqual([]);
});

test('per-tab reset restores the seeded default (after confirmation) and leaves other tabs alone', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await openContent(page);
  await bind(page, 'title').fill('Προσωρινός τίτλος');
  await save(page);
  await openContent(page, 'banners');
  await bind(page, 'items.0.title').fill('Προσωρινό banner');
  await save(page);
  await openContent(page);
  // Escape cancels the reset
  await page.locator(`${PANEL} [data-reset-tab]`).click();
  await expect(page.locator('.modal.show')).toContainText('Επαναφορά ενότητας');
  await expect(page.locator('.modal.show [data-ok]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect((await stored(page, 'hero')).title).toBe('Προσωρινός τίτλος');
  await page.locator(`${PANEL} [data-reset-tab]`).click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(bind(page, 'title')).toHaveValue(D.hero.title);
  expect(await stored(page, 'hero')).toEqual(D.hero);
  expect((await stored(page, 'banners')).items[0].title).toBe('Προσωρινό banner');
  await openHome(page);
  await expect(page.locator('.home-hero-title')).toHaveText(D.hero.title);
  expect(errors).toEqual([]);
});

test('unsaved-changes guard: switching tabs and leaving the page ask for confirmation', async ({ page }) => {
  await boot(page);
  await openContent(page);
  await bind(page, 'title').fill('Μη αποθηκευμένος τίτλος');
  // switching tabs: stay
  await page.locator(`${VIEW} [data-tab="banners"]`).click();
  let dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('Μη αποθηκευμένες αλλαγές');
  await expect(dlg).toContainText('Hero');
  await dlg.locator('[data-bs-dismiss="modal"]').last().click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator(VIEW)).toHaveAttribute('data-tab', 'hero');
  await expect(bind(page, 'title')).toHaveValue('Μη αποθηκευμένος τίτλος');
  // switching tabs: discard
  await page.locator(`${VIEW} [data-tab="banners"]`).click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator(VIEW)).toHaveAttribute('data-tab', 'banners');
  expect((await stored(page, 'hero')).title).toBe(D.hero.title);
  await openTab(page, 'hero');
  await expect(bind(page, 'title')).toHaveValue(D.hero.title);
  // reverting the edit by hand clears the dirty state: no prompt
  await bind(page, 'title').fill('x');
  await bind(page, 'title').fill(D.hero.title);
  await expect(page.locator(`${PANEL} [data-dirty-note]`)).toBeHidden();
  await openTab(page, 'banners');
  // leaving the page
  await bind(page, 'items.0.title').fill('Άλλο');
  await page.locator('.admin-nav-link[href="#/admin/products"]').click();
  dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('Μη αποθηκευμένες αλλαγές');
  await dlg.locator('[data-bs-dismiss="modal"]').last().click();
  await expect(page.locator(VIEW)).toBeVisible();
  await page.locator('.admin-nav-link[href="#/admin/products"]').click();
  await page.locator('.modal.show [data-ok]').click();
  await expect(page.locator('[data-admin-view="products"]')).toBeVisible();
});

test('keyboard: library panel closes with Escape and returns focus; reorder buttons are reachable by Tab', async ({ page }) => {
  await boot(page);
  await openContent(page, 'banners');
  const picker = page.locator(`${PANEL} [data-image-picker]`).first();
  const toggle = picker.locator('[data-picker-toggle]');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(picker.locator('[data-picker-lib]')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(picker.locator('[data-lib]').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker.locator('[data-picker-lib]')).toBeHidden();
  await expect(toggle).toBeFocused();
  // a move keeps focus on a usable control
  const down0 = page.locator(`${PANEL} [data-act="down"][data-list="items"][data-idx="0"]`);
  await down0.focus();
  await page.keyboard.press('Enter');
  await expect(bind(page, 'items.1.id')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.act)).toBeTruthy();
  const focused = await page.evaluate(() => ({ act: document.activeElement.dataset.act, idx: document.activeElement.dataset.idx }));
  expect(focused).toEqual({ act: 'down', idx: '1' });
});

test('resetToSeed dispatches settings:changed and content:changed after it commits', async ({ page }) => {
  await boot(page);
  const counts = await page.evaluate(async () => {
    const seen = { settings: 0, content: 0 };
    window.addEventListener('settings:changed', () => { seen.settings += 1; });
    window.addEventListener('content:changed', () => { seen.content += 1; });
    const seed = await import('/assets/js/seed.js');
    await seed.resetToSeed();
    return seen;
  });
  expect(counts.settings).toBeGreaterThanOrEqual(1);
  expect(counts.content).toBeGreaterThanOrEqual(1);
});

for (const w of [320, 390, 768, 1440]) {
  test(`no horizontal overflow at ${w}px on every tab`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: w, height: 900 });
    await boot(page);
    await openContent(page);
    for (const t of ['hero', 'banners', 'collections', 'instagram', 'promos', 'newsletter', 'footer']) {
      await openTab(page, t);
      expect(await overflow(page), `${t} @${w}`).toBeLessThanOrEqual(0);
    }
    // with an open library panel and an error summary
    await openTab(page, 'hero');
    await page.locator(`${PANEL} [data-picker-toggle]`).first().click();
    await bind(page, 'title').fill('');
    await page.locator(`${PANEL} [data-save]`).click();
    await expect(page.locator(`${PANEL} [data-error-summary]`)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
