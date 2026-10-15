const { test, expect } = require('@playwright/test');

const NOT_FOUND = '[data-page="not-found"]';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function open(page, hash = '#/') {
  await page.goto(`/${hash}`);
  await expect(page.locator('#app h1')).toBeVisible();
}

// Bootstrap moves focus into a dialog once its show transition ends; keyboard
// users can only press Escape from there, so wait for it like a real user would.
async function focusInside(page, selector) {
  await expect.poll(() => page.evaluate((sel) => !!document.activeElement?.closest(sel), selector)).toBe(true);
}

async function collectHashLinks(page, selector) {
  return page.$$eval(`${selector} a[href^="#/"]`, (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
}

test('every header, offcanvas, footer and bottom-nav link resolves to a real view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const hrefs = new Set();
  for (const sel of ['.site-header', '#navOffcanvas', '.site-footer', '.bottom-nav']) {
    const found = await collectHashLinks(page, sel);
    expect(found.length, `${sel} has links`).toBeGreaterThan(0);
    found.forEach((h) => hrefs.add(h));
  }
  for (const d of ['women', 'men', 'shoes', 'accessories']) expect(hrefs).toContain(`#/catalog/${d}`);
  for (const href of hrefs) {
    await page.goto(`/${href}`);
    await expect(page.locator('#app h1'), href).toBeVisible();
    await expect(page.locator(NOT_FOUND), href).toHaveCount(0);
  }
});

test('placeholder routes for unbuilt pages exist', async ({ page }) => {
  for (const hash of ['#/catalog', '#/catalog/women', '#/product/some-slug', '#/cart', '#/checkout', '#/account', '#/account/orders/ELN-1', '#/admin', '#/admin/orders']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('#app h1'), hash).toBeVisible();
    await expect(page.locator(NOT_FOUND), hash).toHaveCount(0);
  }
});

test('unknown hash shows not-found inside the shell with a link home', async ({ page }) => {
  await open(page, '#/does-not-exist');
  await expect(page.locator(NOT_FOUND)).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('.site-footer')).toBeVisible();
  await page.locator(`${NOT_FOUND} a[href="#/"]`).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator(NOT_FOUND)).toHaveCount(0);
});

test('back and forward navigation re-render the right views', async ({ page }) => {
  await open(page, '#/');
  await page.evaluate(() => { location.hash = '#/cart'; });
  await expect(page.locator('#app [data-route="/cart"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/nope'; });
  await expect(page.locator(NOT_FOUND)).toBeVisible();
  await page.goBack();
  await expect(page.locator('#app [data-route="/cart"]')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#app [data-route="/"]')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#app [data-route="/cart"]')).toBeVisible();
});

for (const hash of ['#/', '#/catalog', '#/cart']) {
  test(`no horizontal overflow at 320px on ${hash}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, hash);
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(sw).toBeLessThanOrEqual(iw);
  });
}

test('Escape closes the offcanvas navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator('.site-header [data-bs-target="#navOffcanvas"]').click();
  const oc = page.locator('#navOffcanvas');
  await expect(oc).toBeVisible();
  await expect(oc.locator('a[href="#/catalog/women"]')).toBeVisible();
  await focusInside(page, '#navOffcanvas');
  await page.keyboard.press('Escape');
  await expect(oc).toBeHidden();
});

test('offcanvas link navigates and closes the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator('.site-header [data-bs-target="#navOffcanvas"]').click();
  await page.locator('#navOffcanvas a[href="#/catalog/men"]').click();
  await expect(page).toHaveURL(/#\/catalog\/men$/);
  await expect(page.locator('#navOffcanvas')).toBeHidden();
  // Bootstrap refocuses the toggle on hidden.bs.offcanvas; the page h1 must win.
  await page.waitForTimeout(400);
  const focused = await page.evaluate(() => ({ tag: document.activeElement.tagName, inApp: !!document.activeElement.closest('#app') }));
  expect(focused).toEqual({ tag: 'H1', inApp: true });
});

test('searching the same query twice re-renders and refocuses the heading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const input = page.locator('.site-header .header-search-desktop input[name="q"]');
  await input.fill('παλτό');
  await input.press('Enter');
  await expect(page).toHaveURL(/#\/catalog\?q=/);
  await expect(page.locator('#app h1')).toBeFocused();
  await page.evaluate(() => { document.querySelector('#app h1').dataset.marker = 'old'; });
  await input.fill('παλτό');
  await input.press('Enter');
  await expect(page.locator('#app h1:not([data-marker])')).toBeVisible();
  await expect(page.locator('#app h1')).toBeFocused();
});

test('bottom-nav search button exposes aria-expanded and badges are announced', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const btn = page.locator('.bottom-nav').getByRole('button', { name: 'Αναζήτηση' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cart:changed', { detail: { count: 4 } })));
  await expect(page.locator('.bottom-nav a[href="#/cart"]')).toHaveAttribute('aria-label', 'Καλάθι (4)');
});

test('navigate is available from ui.js', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => (await import('/assets/js/ui.js')).navigate('#/cart'));
  await expect(page.locator('#app [data-route="/cart"]')).toBeVisible();
});

test('demo strip opens the about-demo modal; Escape closes it', async ({ page }) => {
  await open(page);
  const strip = page.locator('.demo-strip');
  await expect(strip).toContainText('Demo κατάστημα');
  await strip.getByRole('button', { name: 'Πληροφορίες' }).click();
  const modal = page.locator('#aboutDemoModal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Σχετικά με αυτό το demo');
  await expect(modal.locator('li')).toHaveCount(7);
  await focusInside(page, '#aboutDemoModal');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('demo strip is visible on every route including admin', async ({ page }) => {
  for (const hash of ['#/', '#/catalog', '#/cart', '#/zzz', '#/admin', '#/admin/products']) {
    await open(page, hash);
    await expect(page.locator('.demo-strip'), hash).toBeVisible();
  }
  await expect(page.locator('.site-header')).toBeHidden();
});

test('focus moves to the page h1 after navigation', async ({ page }) => {
  await open(page);
  await page.locator('.site-footer a[href="#/cart"]').first().click();
  await expect(page.locator('#app [data-route="/cart"]')).toBeVisible();
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, inApp: !!el.closest('#app'), tabindex: el.getAttribute('tabindex') };
  });
  expect(focused).toEqual({ tag: 'H1', inApp: true, tabindex: '-1' });
});

test('skip link moves focus to main content without changing the route', async ({ page }) => {
  await open(page, '#/cart');
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.locator('#app')).toBeFocused();
});

test('desktop search submit routes to the catalog with q', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const input = page.locator('.site-header .header-search-desktop input[name="q"]');
  await input.fill('λινό φόρεμα');
  await input.press('Enter');
  await expect(page).toHaveURL(/#\/catalog\?q=/);
  const hash = await page.evaluate(() => location.hash);
  expect(decodeURIComponent(hash.split('q=')[1].replace(/\+/g, ' '))).toBe('λινό φόρεμα');
});

test('mobile bottom-nav search opens the search field and submits to catalog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const nav = page.locator('.bottom-nav');
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'Αναζήτηση' }).click();
  const input = page.locator('#mobileSearch input[name="q"]');
  await expect(input).toBeFocused();
  await input.fill('sneakers');
  await input.press('Enter');
  await expect(page).toHaveURL(/#\/catalog\?q=sneakers$/);
});

test('bottom nav hidden on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.locator('.bottom-nav')).toBeHidden();
});

test('header badges react to cart:changed and wishlist:changed events', async ({ page }) => {
  await open(page);
  const cart = page.locator('.site-header [data-badge="cart"]');
  const wish = page.locator('.site-header [data-badge="wishlist"]');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('cart:changed', { detail: { count: 3 } }));
    window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { count: 2 } }));
  });
  await expect(cart).toHaveText('3');
  await expect(wish).toHaveText('2');
});

test('toast and confirmDialog work', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const ui = await import('/assets/js/ui.js');
    ui.toast('Προστέθηκε στο καλάθι', 'success');
  });
  await expect(page.locator('.toast')).toContainText('Προστέθηκε στο καλάθι');
  const result = page.evaluate(async () => {
    const ui = await import('/assets/js/ui.js');
    return ui.confirmDialog('Σίγουρα;', { title: 'Επιβεβαίωση', okLabel: 'Ναι', cancelLabel: 'Όχι' });
  });
  const dlg = page.locator('.modal.show');
  await expect(dlg).toContainText('Σίγουρα;');
  await dlg.getByRole('button', { name: 'Ναι' }).click();
  expect(await result).toBe(true);
  const result2 = page.evaluate(async () => (await import('/assets/js/ui.js')).confirmDialog('Διαγραφή;'));
  await expect(page.locator('.modal.show')).toContainText('Διαγραφή;');
  await focusInside(page, '.modal.show');
  await page.keyboard.press('Escape');
  expect(await result2).toBe(false);
});

test('main routes load without console errors', async ({ page }) => {
  const errors = trackErrors(page);
  for (const hash of ['#/', '#/catalog', '#/catalog/women?sort=price-asc', '#/product/x', '#/cart', '#/checkout', '#/account', '#/admin', '#/missing']) {
    await open(page, hash);
  }
  expect(errors).toEqual([]);
});
