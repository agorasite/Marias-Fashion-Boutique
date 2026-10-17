// Task 18 — accessibility: keyboard-only purchase, dialogs (Escape + focus return), focus after route
// changes, accessible names, image alts, heading order, colour contrast, reduced motion and an axe-core
// scan (serious/critical) of the main routes.
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const {
  PRODUCT, SKU, watch, settle, go, open, seedShopper, adminOn,
} = require('./support/qa');

const VARIANT = PRODUCT.variants.find((v) => v.sku === SKU);

/** Press Tab (or Shift+Tab) until the focused element matches `selector`. */
async function tabTo(page, selector, { back = false, max = 250 } = {}) {
  const trail = [];
  for (let i = 0; i < max; i += 1) {
    const [hit, here] = await page.evaluate((s) => {
      const a = document.activeElement;
      return [!!a?.matches(s), a ? `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}«${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 18)}» ${location.hash}` : 'none'];
    }, selector);
    if (hit) return;
    trail.push(here);
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Tab never reached ${selector}; focus went: ${trail.slice(0, 40).join(' → ')}`);
}
/** Press a key that navigates (Enter on a link): the old page is marked first so settle() waits for the NEW one. */
async function pressNavigating(page, key = 'Enter') {
  await page.evaluate(() => document.getElementById('app').firstElementChild?.setAttribute('data-qa-old', ''));
  await page.keyboard.press(key);
  await settle(page);
}
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}` : 'none';
});

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

test('keyboard-only purchase: skip link, filters, card, PDP variant, cart stepper, checkout errors and COD order', async ({ page }) => {
  test.slow();
  const problems = watch(page);
  await open(page, '#/catalog');
  // skip link is the first stop and moves focus to the main content
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toBeFocused();

  // a size filter in the sidebar toggles with Enter and keeps focus
  const size = VARIANT.size;
  await tabTo(page, `#filtersSidebar [data-f-size="${size}"]`);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`size=${encodeURIComponent(size)}`));
  await settle(page);
  await expect(page.locator(`#filtersSidebar [data-f-size="${size}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`#filtersSidebar [data-f-size="${size}"]`)).toBeFocused();
  // back to the full list (Enter again), then the product card title link
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/size=/);
  await settle(page);
  await page.evaluate((slug) => { // bring the product onto the first page: search for it by keyboard
    document.getElementById('catalogSearch').focus();
  }, PRODUCT.slug);
  await page.keyboard.type(PRODUCT.name);
  await expect(page.locator(`.product-card[data-product-id="${PRODUCT.id}"]`)).toBeVisible();
  await settle(page);
  await tabTo(page, `.product-card[data-product-id="${PRODUCT.id}"] .product-card-title a`);
  await pressNavigating(page);
  await expect(page).toHaveURL(new RegExp(`#/product/${PRODUCT.slug}`));
  await expect(page.locator('#app h1')).toBeFocused();

  // PDP: colour (if several) and size with the keyboard; focus stays on the chosen option
  if (await page.locator('.pdp-color').count() > 1) {
    await tabTo(page, `.pdp-color[data-color="${VARIANT.color}"]`);
    await page.keyboard.press('Enter');
    await expect(page.locator(`.pdp-color[data-color="${VARIANT.color}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`.pdp-color[data-color="${VARIANT.color}"]`)).toBeFocused();
  }
  await tabTo(page, `.pdp-size[data-size="${VARIANT.size}"]`);
  await page.keyboard.press('Space');
  await expect(page.locator(`.pdp-size[data-size="${VARIANT.size}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`.pdp-size[data-size="${VARIANT.size}"]`)).toBeFocused();
  await tabTo(page, '[data-add]');
  await page.keyboard.press('Enter');
  await expect(page.locator('.site-header [data-badge="cart"]')).toHaveText('1');

  // header cart link (Shift+Tab back up), cart stepper +
  await tabTo(page, '.site-header a[href="#/cart"]', { back: true });
  await pressNavigating(page);
  await expect(page).toHaveURL(/#\/cart$/);
  await tabTo(page, '[data-qty-plus]');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-qty-input]')).toHaveValue('2');
  await expect.poll(() => focused(page)).not.toBe('body');
  await tabTo(page, '#app a[href="#/checkout"]');
  await pressNavigating(page);
  await expect(page).toHaveURL(/#\/checkout$/);

  // empty submit: error summary takes focus, fields are flagged and described
  await tabTo(page, '[data-place-order]');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-error-summary]')).toBeVisible();
  await expect(page.locator('[data-error-summary]')).toBeFocused();
  await expect(page.locator('#co-firstName')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#co-firstName')).toHaveAttribute('aria-describedby', /co-firstName-error/);
  await expect(page.locator('#co-firstName-error')).not.toBeEmpty();

  const values = { firstName: 'Ελένη', lastName: 'Κωνσταντίνου', email: 'eleni@example.gr', phone: '6987654321', address: 'Πανεπιστημίου 10', city: 'Αθήνα', postalCode: '10671' };
  for (const [k, v] of Object.entries(values)) {
    await tabTo(page, `#co-${k}`);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(v);
  }
  await tabTo(page, '#co-region');
  for (let i = 0; i < 20 && (await page.locator('#co-region').inputValue()) !== 'Αττική'; i += 1) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#co-region')).toHaveValue('Αττική');
  // payment radios: arrows move between IRIS and COD, COD ends selected
  await tabTo(page, 'input[name="paymentMethod"]:checked');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('input[name="paymentMethod"][value="iris"]')).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('input[name="paymentMethod"][value="cod"]')).toBeChecked();
  await tabTo(page, '#co-acceptTerms');
  await page.keyboard.press('Space');
  await expect(page.locator('#co-acceptTerms')).toBeChecked();
  await tabTo(page, '[data-place-order]');
  await pressNavigating(page);
  await expect(page).toHaveURL(/#\/order\//);
  await expect(page.locator('#app h1')).toBeFocused();
  expect(problems).toEqual([]);
});

/** Open with the keyboard (Enter on the focused trigger), close with Escape, focus must return to the trigger. */
async function escapeReturnsFocus(page, trigger, dialog, label) {
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog, label).toBeVisible();
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement)), { message: `${label}: focus inside` }).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog, label).toBeHidden();
  await expect(trigger, `${label}: focus back on the trigger`).toBeFocused();
}

test('Escape closes every dialog/offcanvas and focus returns to the trigger (never to <body>)', async ({ page }) => {
  test.slow();
  const problems = watch(page);
  await open(page, '#/');
  await escapeReturnsFocus(page, page.locator('.demo-strip-btn'), page.locator('#aboutDemoModal'), 'about demo');
  const tile = page.locator('[data-insta-tile]').first();
  await tile.scrollIntoViewIfNeeded();
  await escapeReturnsFocus(page, tile, page.locator('[data-insta-modal]'), 'shop the look');
  await go(page, '#/catalog');
  await escapeReturnsFocus(page, page.locator('.product-card [data-quick]').first(), page.locator('[data-quick-view]'), 'quick view');
  await go(page, `#/product/${PRODUCT.slug}`);
  await escapeReturnsFocus(page, page.locator('[data-lightbox-open]'), page.locator('#lightboxModal'), 'lightbox');
  if (await page.locator('[data-size-chart-open]').isVisible()) {
    await escapeReturnsFocus(page, page.locator('[data-size-chart-open]'), page.locator('.modal').filter({ has: page.locator('table') }).first(), 'size chart');
  }
  // phone: navigation offcanvas and filter offcanvas
  await page.setViewportSize({ width: 390, height: 844 });
  await escapeReturnsFocus(page, page.locator('.site-header [data-bs-target="#navOffcanvas"]'), page.locator('#navOffcanvas'), 'menu');
  await go(page, '#/catalog/women');
  await escapeReturnsFocus(page, page.locator('[data-open-filters]'), page.locator('#filtersOffcanvas'), 'filters');
  // confirm dialog (admin delete) and the coupon form
  await page.setViewportSize({ width: 1280, height: 900 });
  await adminOn(page);
  await go(page, '#/admin/products');
  await escapeReturnsFocus(page, page.locator('tr[data-product-id] [data-action="delete"]').first(), page.locator('.modal.show, .modal.fade').last(), 'confirm');
  await go(page, '#/admin/promotions');
  await escapeReturnsFocus(page, page.locator('[data-new-coupon]').first(), page.locator('[data-coupon-modal]'), 'coupon form');
  expect(problems).toEqual([]);
});

test('every route change moves focus to the page h1', async ({ page }) => {
  await open(page, '#/');
  const { orderId } = await seedShopper(page);
  for (const hash of ['#/catalog', '#/catalog/men', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account', '#/account/orders', `#/order/${encodeURIComponent(orderId)}`, '#/']) {
    await go(page, hash);
    await expect(page.locator('#app h1').first(), hash).toBeFocused();
  }
});

// ------------------------------------------------------------------ static audits per route
const AUDIT_STORE = ['#/', '#/catalog', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account', '#/account/profile', '#/account/addresses', '#/account/newsletter'];
const AUDIT_ADMIN = ['#/admin', '#/admin/products', '#/admin/products/new', '#/admin/orders', '#/admin/customers', '#/admin/promotions', '#/admin/content', '#/admin/settings', '#/admin/backup'];

function audit(page) {
  return page.evaluate(() => {
    const textOf = (n) => {
      if (!n) return '';
      const c = n.cloneNode(true);
      c.querySelectorAll('[aria-hidden="true"], script, style').forEach((x) => x.remove());
      const alts = [...c.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')).join(' ');
      return `${c.textContent} ${alts}`.replace(/\s+/g, ' ').trim();
    };
    const byIds = (ids) => (ids || '').split(/\s+/).filter(Boolean).map((id) => textOf(document.getElementById(id))).join(' ').trim();
    const visible = (el) => {
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const accName = (el) => byIds(el.getAttribute('aria-labelledby'))
      || (el.getAttribute('aria-label') || '').trim()
      || (el.labels ? [...el.labels].map(textOf).join(' ').trim() : '')
      || (el.matches('button, a, summary, [role="button"], [role="tab"]') ? textOf(el) : '')
      || (el.matches('input[type="submit"], input[type="button"]') ? el.value : '')
      || (el.getAttribute('title') || '').trim();
    const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
    const out = { unnamedControls: [], unnamedButtons: [], noAlt: [], headingSkips: [] };
    for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) if (visible(el) && !accName(el)) out.unnamedControls.push(desc(el));
    for (const el of document.querySelectorAll('button, a[href], [role="button"], summary')) if (visible(el) && !accName(el)) out.unnamedButtons.push(desc(el));
    for (const img of document.images) if (!img.hasAttribute('alt')) out.noAlt.push(img.getAttribute('src')?.slice(0, 60));
    // heading levels inside the main content: never jump more than one level down
    const hs = [...document.querySelectorAll('#app h1, #app h2, #app h3, #app h4, #app h5, #app h6')].filter(visible);
    let prev = 0;
    for (const h of hs) {
      const lvl = Number(h.tagName[1]);
      if (prev && lvl > prev + 1) out.headingSkips.push(`${h.tagName} after H${prev}: «${h.textContent.trim().slice(0, 40)}»`);
      if (!prev && lvl !== 1) out.headingSkips.push(`first heading is ${h.tagName}`);
      prev = lvl;
    }
    return out;
  });
}

test('names, alts and heading order on storefront and admin routes', async ({ page }) => {
  test.slow();
  await open(page, '#/');
  await seedShopper(page);
  await adminOn(page);
  const report = {};
  for (const hash of [...AUDIT_STORE, ...AUDIT_ADMIN]) {
    await go(page, hash);
    const r = await audit(page);
    const bad = Object.fromEntries(Object.entries(r).filter(([, v]) => v.length));
    if (Object.keys(bad).length) report[hash] = bad;
  }
  // dialogs with forms: the coupon form and the checkout/confirm dialogs share the same audit
  await go(page, '#/admin/promotions');
  await page.locator('[data-new-coupon]').first().click();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-coupon-modal]'))).toBe(true);
  const dlg = await audit(page);
  if (dlg.unnamedControls.length || dlg.unnamedButtons.length) report['coupon dialog'] = dlg;
  expect(report).toEqual({});
});

// ------------------------------------------------------------------ colour contrast
/**
 * Walk visible text nodes, resolve the text colour and the first opaque background behind the element
 * (alpha-blended up the ancestor chain). Elements over a background IMAGE or GRADIENT (hero, banners,
 * photo tiles) cannot be measured this way and are excluded (documented in the Task 18 report).
 */
function contrastFailures(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const blend = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
    });
    const lum = ({ r, g, b }) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    function background(el) {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // image / gradient
        if (n.matches('.home-hero, .home-banner, .insta-tile, .home-feature-media, .collection-card, .dept-card, .product-card-media, .stl-media')) return null;
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i -= 1) bg = blend(layers[i], bg);
      return bg;
    }
    const fails = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (el.closest('[hidden], [aria-hidden="true"], .visually-hidden, script, style, noscript, option, .modal:not(.show), .offcanvas:not(.show), .toast-stack')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let op = 1;
      for (let n = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      if (op < 0.99) continue; // fading in / decorative
      if (el.closest('button:disabled, [aria-disabled="true"], .disabled, input:disabled + label')) continue; // disabled controls are exempt (WCAG 1.4.3)
      const fg = parse(cs.color);
      const bg = background(el);
      if (!fg || !bg) continue;
      const color = fg.a < 1 ? blend(fg, bg) : fg;
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      const got = ratio(color, bg);
      if (got + 0.005 < need) {
        fails.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')} «${t.textContent.trim().slice(0, 30)}» ${got.toFixed(2)}:1 < ${need} (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`);
      }
    }
    return fails;
  });
}

test('colour contrast of text on the main storefront and admin pages', async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no fade-ins while measuring
  await open(page, '#/');
  await seedShopper(page);
  // calibration: the walker must catch a known failure (#bbb on white = 1.92:1) and pass a known good one
  await page.evaluate(() => document.getElementById('app').insertAdjacentHTML('afterbegin',
    '<p id="qaLow" style="color:#bbb;background:#fff">Δοκιμή χαμηλής αντίθεσης</p><p id="qaOk" style="color:#595959;background:#fff">Δοκιμή επαρκούς αντίθεσης</p>'));
  const cal = await contrastFailures(page);
  expect(cal.some((f) => f.includes('χαμηλής'))).toBe(true);
  expect(cal.some((f) => f.includes('επαρκούς'))).toBe(false);
  await page.evaluate(() => { document.getElementById('qaLow').remove(); document.getElementById('qaOk').remove(); });
  const report = {};
  for (const hash of ['#/', '#/catalog', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account', '#/account/orders']) {
    await go(page, hash);
    const f = await contrastFailures(page);
    if (f.length) report[hash] = f;
  }
  await adminOn(page);
  for (const hash of ['#/admin', '#/admin/orders', '#/admin/products']) {
    await go(page, hash);
    const f = await contrastFailures(page);
    if (f.length) report[hash] = f;
  }
  expect(report).toEqual({});
});

test('prefers-reduced-motion: no transitions/animations and no smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '#/');
  const slow = await page.evaluate(() => {
    const secs = (v) => Math.max(0, ...v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x)) || 0));
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        const t = secs(cs.transitionDuration);
        const a = cs.animationName !== 'none' ? secs(cs.animationDuration) : 0;
        if (t > 0.01 || a > 0.01) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}${pseudo || ''} t=${t} a=${a}`);
      }
    }
    return { out: out.slice(0, 20), smooth: getComputedStyle(document.documentElement).scrollBehavior };
  });
  expect(slow.out).toEqual([]);
  expect(slow.smooth).toBe('auto');
  await expect(page.locator('.home')).not.toHaveClass(/motion-ok/);
});

// ------------------------------------------------------------------ axe-core (serious / critical)
for (const [name, hashes, width] of [
  ['storefront', ['#/', '#/catalog', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account'], 1280],
  ['storefront 390px', ['#/', '#/catalog/women', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account/orders'], 390],
  ['admin', ['#/admin', '#/admin/products', '#/admin/products/new', '#/admin/orders', '#/admin/settings', '#/admin/content'], 1280],
  ['admin 390px', ['#/admin', '#/admin/orders', '#/admin/customers', '#/admin/promotions', '#/admin/backup'], 390],
]) {
  test(`axe: no serious or critical violations (${name})`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '#/');
    await seedShopper(page);
    if (name.startsWith('admin')) await adminOn(page);
    const report = {};
    for (const hash of hashes) {
      await go(page, hash);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      if (bad.length) report[hash] = bad.map((v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ')}`);
    }
    expect(report).toEqual({});
  });
}
