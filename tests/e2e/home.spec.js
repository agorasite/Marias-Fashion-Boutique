const { test, expect } = require('@playwright/test');

const HOME = '[data-page="home"]';
const READY = '[data-page="home"][data-ready="true"]';
const sec = (name) => `${HOME} [data-section="${name}"]`;
const PRODUCT_SECTIONS = ['new-collection', 'women', 'men', 'shoes', 'accessories', 'best-sellers', 'new-arrivals'];

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function openHome(page) {
  await page.goto('/#/');
  await expect(page.locator(READY)).toBeVisible();
}

/** Scroll the whole page in steps so every lazy image gets requested. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.7));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
}

const dbProducts = (page) => page.evaluate(async () => (await import('/assets/js/db.js')).getAll('products'));

test('every homepage section renders with items from the database, without console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await openHome(page);
  for (const name of ['hero', 'departments', 'promo', 'collections', 'instagram', 'newsletter', ...PRODUCT_SECTIONS]) {
    await expect(page.locator(sec(name)), name).toBeVisible();
  }
  const products = await dbProducts(page);
  const byId = new Map(products.map((p) => [p.id, p]));
  const ids = async (name) => page.locator(`${sec(name)} .product-card`).evaluateAll((els) => els.map((e) => e.dataset.productId));

  const nc = await ids('new-collection');
  expect(nc.length).toBeGreaterThanOrEqual(4);
  expect(nc.every((id) => byId.get(id)?.flags?.new)).toBe(true);
  for (const d of ['women', 'men', 'shoes', 'accessories']) {
    const list = await ids(d);
    expect(list, d).toHaveLength(4);
    expect(list.every((id) => byId.get(id)?.categoryId === d), d).toBe(true);
  }
  const best = await ids('best-sellers');
  expect(best.length).toBeGreaterThanOrEqual(4);
  expect(best.every((id) => byId.get(id)?.flags?.bestSeller)).toBe(true);
  const pops = best.map((id) => byId.get(id).popularity);
  expect([...pops].sort((a, b) => b - a)).toEqual(pops);
  const arrivals = await ids('new-arrivals');
  expect(arrivals.length).toBe(4);
  const dates = arrivals.map((id) => Date.parse(byId.get(id).createdAt));
  expect([...dates].sort((a, b) => b - a)).toEqual(dates);

  await expect(page.locator(`${sec('departments')} a[href^="#/catalog/"]`)).toHaveCount(4);
  await expect(page.locator(`${sec('collections')} a.collection-card`)).toHaveCount(4);
  await expect(page.locator(`${sec('instagram')} [data-insta-tile]`)).toHaveCount(9);
  await expect(page.locator(`${sec('instagram')}`)).toContainText('Επιλεγμένο περιεχόμενο — demo, όχι ζωντανή σύνδεση με Instagram');
  await expect(page.locator(`${sec('promo')} [data-promo-item]`)).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('all homepage images load and no request fails; only the hero image is eager', async ({ page }) => {
  const failed = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await openHome(page);
  await scrollThrough(page);
  await expect.poll(() => page.$$eval(`${HOME} img`, (imgs) => imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src)), { timeout: 15000 }).toEqual([]);
  const imgs = await page.$$eval(`${HOME} img`, (list) => list.map((i) => ({
    hero: i.classList.contains('home-hero-img'), loading: i.getAttribute('loading'), w: i.getAttribute('width'), h: i.getAttribute('height'),
  })));
  expect(imgs.length).toBeGreaterThan(30);
  expect(imgs.filter((i) => i.hero)).toHaveLength(1);
  for (const i of imgs) {
    expect(i.w && i.h, 'explicit dimensions').toBeTruthy();
    if (i.hero) expect(i.loading).toBe('eager');
    else expect(i.loading).toBe('lazy');
  }
  expect(failed).toEqual([]);
});

test('hero is the LCP candidate: fetchpriority, srcset and mobile focal crop at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const hero = page.locator(`${sec('hero')} img.home-hero-img`);
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  await expect(hero).toHaveAttribute('srcset', /hero-1-sm\.webp 480w.*hero-1\.webp 1920w/);
  await expect(hero).toHaveAttribute('width', '1920');
  await expect(hero).toHaveAttribute('height', '1280');
  expect(await hero.evaluate((i) => getComputedStyle(i).objectPosition)).toBe('65% 50%');
  await expect(page.locator(`${sec('hero')} h1`)).toHaveText('Η ησυχία της καλής ραφής');
  // layout box (the intro zoom animation scales the painted image slightly)
  const box = await hero.evaluate((i) => ({ width: i.offsetWidth, height: i.offsetHeight }));
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.height).toBeGreaterThan(400);
});

test('every internal homepage link resolves to a populated, non-404 view', async ({ page }) => {
  test.setTimeout(120000);
  await openHome(page);
  const hrefs = await page.$$eval(`${HOME} a[href^="#/"]`, (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
  expect(hrefs.length).toBeGreaterThan(20);
  for (const href of hrefs) {
    await page.goto(`/${href}`);
    await expect(page.locator('#app h1'), href).toBeVisible();
    await expect(page.locator('[data-page="not-found"], [data-page="product-not-found"], [data-page="error"]'), href).toHaveCount(0);
    if (href.startsWith('#/catalog')) {
      await expect(page.locator('[data-page="catalog"] .product-card').first(), href).toBeVisible();
    } else if (href.startsWith('#/product/')) {
      await expect(page.locator('[data-page="product"]'), href).toBeVisible();
    }
  }
});

test('free-shipping banner and strip follow the settings threshold', async ({ page }) => {
  await openHome(page);
  const banner = page.locator(`${sec('promo')} [data-banner-title]`);
  await expect(banner).toHaveText(/Δωρεάν αποστολή για αγορές άνω των 60,00\s€/);
  await page.evaluate(async () => {
    const s = await import('/assets/js/services/settings.js');
    await s.saveSettings({ freeShippingThresholdCents: 8550 });
  });
  await page.reload();
  await expect(page.locator(READY)).toBeVisible();
  await expect(banner).toHaveText(/άνω των 85,50\s€/);
  await expect(page.locator(`${sec('promo')} [data-promo-item="shipping"]`)).toContainText(/85,50\s€/);
  await expect(page.locator('.site-footer [data-footer-notes]')).toContainText(/85,50\s€/);
});

test('content edited through saveContent shows after reload; invalid content is rejected', async ({ page }) => {
  await openHome(page);
  const res = await page.evaluate(async () => {
    const c = await import('/assets/js/services/content.js');
    const hero = await c.getContent('hero');
    let rejected = false;
    try { await c.saveContent('hero', { ...hero, title: '' }); } catch (e) { rejected = true; }
    let changed = null;
    window.addEventListener('content:changed', (e) => { changed = e.detail.key; }, { once: true });
    await c.saveContent('hero', { ...hero, title: 'Χειμώνας στην πόλη', subtitle: 'Νέο κείμενο', ctaLabel: 'Δείτε τα πλεκτά', ctaHref: '#/catalog/women?sub=tops' });
    const footer = await c.getContent('footer');
    await c.saveContent('footer', { ...footer, tagline: 'Νέα φράση footer από τη διαχείριση.' });
    return { rejected, changed };
  });
  expect(res).toEqual({ rejected: true, changed: 'hero' });
  await page.reload();
  await expect(page.locator(READY)).toBeVisible();
  await expect(page.locator(`${sec('hero')} h1`)).toHaveText('Χειμώνας στην πόλη');
  await expect(page.locator(`${sec('hero')}`)).toContainText('Νέο κείμενο');
  await expect(page.locator(`${sec('hero')} a.btn`).first()).toHaveAttribute('href', '#/catalog/women?sub=tops');
  await expect(page.locator(`${sec('hero')} a.btn`).first()).toHaveText('Δείτε τα πλεκτά');
  await expect(page.locator('.site-footer .footer-tagline')).toHaveText('Νέα φράση footer από τη διαχείριση.');
});

test('instagram tile opens shop-the-look modal with product links; Escape returns focus to the tile', async ({ page }) => {
  await openHome(page);
  const profile = page.locator(`${sec('instagram')} a[data-insta-profile]`);
  await expect(profile).toHaveAttribute('target', '_blank');
  await expect(profile).toHaveAttribute('rel', /noopener/);
  await expect(profile).toHaveAttribute('href', /^https:\/\//);

  const tile = page.locator(`${sec('instagram')} [data-insta-tile="insta-9"]`);
  await tile.scrollIntoViewIfNeeded();
  await tile.focus();
  await page.keyboard.press('Enter');
  const modal = page.locator('[data-insta-modal]');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  await expect(modal).toContainText('Επιλεγμένο περιεχόμενο — demo, όχι ζωντανή σύνδεση με Instagram');
  await expect(modal.locator('[data-insta-caption]')).not.toBeEmpty();
  await expect(modal.locator('img.insta-modal-img')).toHaveAttribute('alt', /overshirt/);
  const links = modal.locator('a[href^="#/product/"]');
  await expect(links).toHaveCount(2);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(expect.arrayContaining(['#/product/m-check-overshirt-grey', '#/product/m-slim-jeans-black']));
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-insta-modal]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.instaTile)).toBe('insta-9');

  // product links navigate to the PDP and close the dialog
  await tile.click();
  await expect(modal).toBeVisible();
  await modal.locator('a[href="#/product/m-slim-jeans-black"]').first().click();
  await expect(page.locator('[data-page="product"]')).toBeVisible();
  await expect(page.locator('.modal.show')).toHaveCount(0);
});

test('newsletter: validation, success, duplicate handling and persistence', async ({ page }) => {
  await openHome(page);
  const form = page.locator(`${sec('newsletter')} form[data-newsletter-form]`);
  const input = form.locator('input[type="email"]');
  const status = page.locator(`${sec('newsletter')} [data-newsletter-status]`);
  await expect(page.locator(sec('newsletter'))).toContainText('δεν αποστέλλεται');

  await form.locator('button[type="submit"]').click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.invalid-feedback')).toBeVisible();
  await expect(input).toBeFocused();

  await input.fill('maria@');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.invalid-feedback')).toContainText('έγκυρο');

  await input.fill('Maria@Example.gr');
  await form.locator('button[type="submit"]').click();
  await expect(status).toContainText('Ευχαριστούμε');
  await expect(status).toContainText('δεν αποστέλλεται');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(input).toHaveValue('');

  await page.reload();
  await expect(page.locator(READY)).toBeVisible();
  const stored = await page.evaluate(async () => (await import('/assets/js/db.js')).get('settings', 'newsletterSubscribers'));
  expect(stored.list).toHaveLength(1);
  expect(stored.list[0].email).toBe('maria@example.gr');
  expect(stored.list[0].createdAt).toBeTruthy();

  await input.fill('maria@example.GR');
  await form.locator('button[type="submit"]').click();
  await expect(status).toContainText('ήδη εγγεγραμμένο');
  const after = await page.evaluate(async () => (await import('/assets/js/db.js')).get('settings', 'newsletterSubscribers'));
  expect(after.list).toHaveLength(1);
});

test('a product section hides itself when it has no products', async ({ page }) => {
  await openHome(page);
  await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    const all = await db.getAll('products');
    for (const p of all) {
      const next = { ...p, flags: { ...p.flags, bestSeller: false } };
      if (p.categoryId === 'accessories') next.status = 'archived';
      await db.put('products', next);
    }
  });
  await page.reload();
  await expect(page.locator(READY)).toBeVisible();
  await expect(page.locator(sec('best-sellers'))).toBeHidden();
  await expect(page.locator(sec('accessories'))).toBeHidden();
  await expect(page.locator(sec('women'))).toBeVisible();
  await expect(page.locator(`${sec('best-sellers')} .product-card`)).toHaveCount(0);
});

test('new collection carousel is keyboard accessible and does not trap focus', async ({ page }) => {
  await openHome(page);
  const scroller = page.locator(`${sec('new-collection')} [data-scroller]`);
  await expect(scroller).toHaveAttribute('tabindex', '0');
  await expect(scroller).toHaveAttribute('role', 'region');
  await expect(scroller).toHaveAttribute('aria-label', /.+/);
  await scroller.focus();
  const outline = await scroller.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  const before = await scroller.evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  // Tab walks through the cards and eventually leaves the carousel
  let left = false;
  for (let i = 0; i < 60 && !left; i += 1) {
    await page.keyboard.press('Tab');
    left = await page.evaluate(() => !document.activeElement.closest('[data-section="new-collection"]'));
  }
  expect(left).toBe(true);
  const next = page.locator(`${sec('new-collection')} [data-scroll-next]`);
  await expect(next).toHaveAttribute('aria-label', /.+/);
});

for (const width of [320, 390, 768, 1440]) {
  test(`no horizontal overflow on the homepage at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page);
    await scrollThrough(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });
}

test('legacy content records from the first seed are migrated on load', async ({ page }) => {
  await openHome(page);
  await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    await db.put('content', { key: 'editorial', hero: { image: 'x' }, banners: [], collections: [], instagram: [] });
    await db.put('content', { key: 'hero', title: 'Νέα συλλογή Φθινόπωρο', subtitle: 'x', cta: 'Αγόρασε τώρα', link: '#/shop' });
    await db.put('content', { key: 'promos', items: [{ title: 'Κωδικός WELCOME10', text: '10%' }] });
  });
  await page.reload();
  await expect(page.locator(READY)).toBeVisible();
  const r = await page.evaluate(async () => {
    const db = await import('/assets/js/db.js');
    return { editorial: await db.get('content', 'editorial'), hero: await db.get('content', 'hero') };
  });
  expect(r.editorial).toBeUndefined();
  expect(r.hero.image).toBe('assets/images/content/hero-1.webp');
  await expect(page.locator(`${sec('hero')} a.btn`).first()).not.toHaveAttribute('href', '#/shop');
});

test('reveal animations finish on scroll and are skipped with prefers-reduced-motion', async ({ page, browser }) => {
  await openHome(page);
  await expect(page.locator(HOME)).toHaveClass(/motion-ok/);
  await scrollThrough(page);
  await expect.poll(() => page.locator(`${HOME} .reveal:not([hidden]):not(.is-in)`).count()).toBe(0);
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const p2 = await ctx.newPage();
  await p2.goto('/#/');
  await expect(p2.locator(READY)).toBeVisible();
  await expect(p2.locator(HOME)).not.toHaveClass(/motion-ok/);
  const opacity = await p2.locator(`${HOME} [data-section="newsletter"]`).evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe('1');
  await ctx.close();
});
