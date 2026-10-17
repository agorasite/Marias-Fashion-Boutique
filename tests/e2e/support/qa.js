// Shared helpers for the Task 18 responsive / a11y / resilience suites. Not a spec file (no tests here).
// Every wait is on observable page state (no fixed sleeps).
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../../..');
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8')).products;
const ACTIVE = PRODUCTS.filter((p) => p.status !== 'archived');
const stockedVariant = (p, min = 1) => p.variants.find((v) => v.stock >= min && !v.archived);
/** A product with plenty of stock in at least one variant (used for carts and orders). */
const PRODUCT = ACTIVE.find((p) => p.images.length > 1 && stockedVariant(p, 8));
const SKU = stockedVariant(PRODUCT, 8).sku;

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];

/**
 * Collect everything that should never happen on a normal path: page errors, console errors, failed
 * requests and HTTP >= 400. `allowImageFailures` is for suites that break images on purpose: the expected
 * image 404s/aborts (and Chrome's matching «Failed to load resource» console line) are then not counted.
 * An image request ABORTED because its <img> left the DOM (fast navigation, srcset switch on resize) is
 * not a failure either.
 */
function watch(page, { allowImageFailures = false } = {}) {
  const problems = [];
  const imageUrl = (u) => /\/assets\/images\//.test(u) || /\.(webp|jpe?g|png|svg|avif)(\?|$)/i.test(u);
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (allowImageFailures && /Failed to load resource/.test(t) && (!m.location()?.url || imageUrl(m.location().url))) return;
    problems.push(`console: ${t}`);
  });
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    if (r.resourceType() === 'image' && (allowImageFailures || /ERR_ABORTED/.test(err))) return;
    problems.push(`requestfailed: ${r.url()} ${err}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if (allowImageFailures && (r.request().resourceType() === 'image' || imageUrl(r.url()))) return;
    problems.push(`http ${r.status()}: ${r.url()}`);
  });
  return problems;
}

/** Wait until the routed page is fully rendered: not busy, no pending readiness flags, an h1 is present. */
async function settle(page, { timeout = 15000 } = {}) {
  await expect.poll(() => page.evaluate(() => {
    const app = document.getElementById('app');
    if (!app || app.getAttribute('aria-busy') === 'true') return 'app busy';
    if (app.querySelector('[data-qa-old]')) return 'old page still shown';
    if (app.querySelector('[aria-busy="true"]')) return 'section busy';
    if (app.querySelector('[data-ready="false"]')) return 'view not ready';
    const home = app.querySelector('.home');
    if (home && home.dataset.ready !== 'true') return 'home not ready';
    return app.querySelector('h1') ? 'ok' : 'no h1';
  }), { timeout }).toBe('ok');
}

/** In-app navigation (hash change, no reload); resolves once the new page has settled. */
async function go(page, hash) {
  const changed = await page.evaluate((h) => {
    const app = document.getElementById('app');
    if (location.hash === h) return false;
    app.firstElementChild?.setAttribute('data-qa-old', '');
    location.hash = h;
    return true;
  }, hash);
  if (!changed) await page.evaluate(() => document.querySelectorAll('[data-qa-old]').forEach((n) => n.removeAttribute('data-qa-old')));
  await settle(page);
}

/** Click something that navigates; the old page is marked so settle() waits for the new one. */
async function clickNavigating(page, locator) {
  await page.evaluate(() => document.getElementById('app').firstElementChild?.setAttribute('data-qa-old', ''));
  await locator.click();
  await settle(page);
}

/** Full page load at `hash`, then settle. */
async function open(page, hash) {
  await page.goto(`/${hash}`);
  await settle(page);
}

/** Scroll the whole page in viewport steps (one frame pair each) so lazy content and images load. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await frame();
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await frame();
  });
}

/**
 * After scrolling through: every rendered <img> inside the vertical page area must have loaded with a real
 * bitmap. Images parked outside the horizontal viewport (carousel items) are only checked if they loaded.
 */
async function expectImagesLoaded(page, label = '') {
  await expect.poll(() => page.evaluate(() => [...document.images].flatMap((i) => {
    const src = i.currentSrc || i.getAttribute('src') || '';
    if (!src) return [];
    const r = i.getBoundingClientRect();
    const cs = getComputedStyle(i);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return [];
    if (i.complete) return i.naturalWidth > 0 ? [] : [`broken ${src}`];
    const offX = r.right <= 0 || r.left >= window.innerWidth;
    return offX && i.loading === 'lazy' ? [] : [`pending ${src}`];
  })), { timeout: 15000, message: `images ${label}` }).toEqual([]);
}

const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Elements sticking out past the right edge (diagnostics for overflow failures). */
const overflowCulprits = (page) => page.evaluate(() => {
  const W = window.innerWidth;
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/s+/).slice(0, 2).join('.')}${el.dataset.label ? `[${el.dataset.label}]` : ''}«${(el.textContent || '').trim().replace(/s+/g, ' ').slice(0, 40)}»`;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.visually-hidden, .offcanvas:not(.show), .modal:not(.show)')) continue;
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > W + 0.5) out.push(`${name(el)} right=${Math.round(b.right)}`);
    // text that overflows its own box (an unbreakable word) does not show in the box itself
    else if (getComputedStyle(el).overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1 && b.left + el.scrollWidth > W + 0.5 && el.clientWidth > 0) out.push(`${name(el)} text-overflow=${el.scrollWidth - el.clientWidth}`);
    if (out.length >= 6) break;
  }
  return out;
});

/** Seed state through the real services: one placed order (COD), then one line left in the cart. */
async function seedShopper(page) {
  const order = await page.evaluate(async (sku) => {
    const cart = await import('/assets/js/services/cart.js');
    const co = await import('/assets/js/services/checkout.js');
    await cart.addLine(sku, 1);
    const r = await co.placeOrder({
      form: { firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.gr', phone: '6912345678', address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true },
      shippingMethod: 'courier', paymentMethod: 'cod', requestId: `qa-${Math.random()}`, saveDetails: true,
    });
    await cart.addLine(sku, 1);
    return r.order || r;
  }, SKU);
  return { orderId: order.id, customerId: order.customerId };
}

async function adminOn(page) {
  await page.evaluate(() => sessionStorage.setItem('adminSession', '1'));
}

/**
 * Tap-target audit (mobile widths). Every visible interactive control inside `scopes` must be at least
 * 44×44 CSS px. Checkbox/radio inputs are measured together with their label (the label is part of the
 * target); the only exemption is a text link flowing inline inside a paragraph / help text.
 */
function tapTargetViolations(page, scopes) {
  return page.evaluate((sel) => {
    const out = [];
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      if (el.closest('[hidden], [aria-hidden="true"], .visually-hidden')) return false;
      if (cs.position === 'absolute' && cs.clip && cs.clip !== 'auto' && r.width <= 1) return false; // visually-hidden
      return true;
    };
    const roots = sel.flatMap((s) => [...document.querySelectorAll(s)]);
    const seen = new Set();
    for (const root of roots) {
      for (const el of root.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"]')) {
        if (seen.has(el) || !vis(el)) continue;
        seen.add(el);
        if (el.disabled) continue;
        const cs = getComputedStyle(el);
        if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p, .form-text, small')) continue;
        let r = el.getBoundingClientRect();
        // «stretched link»: an absolutely positioned ::after overlay makes the positioned ancestor (the
        // whole product card) the tap target — measure that box, which is what a finger actually hits.
        const after = getComputedStyle(el, '::after');
        if (after.content !== 'none' && after.position === 'absolute' && el.offsetParent) {
          const o = el.offsetParent.getBoundingClientRect();
          if (o.width * o.height > r.width * r.height) r = o;
        }
        if (el.matches('input[type="checkbox"], input[type="radio"]')) {
          const lab = el.labels?.[0] || el.closest('label');
          const box = el.closest('.form-check') || lab;
          if (box) r = box.getBoundingClientRect();
        }
        if (r.width + 0.5 < 44 || r.height + 0.5 < 44) {
          const name = (el.getAttribute('aria-label') || el.textContent || el.name || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} «${name}» ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
    }
    return out;
  }, scopes);
}

module.exports = {
  PRODUCTS, ACTIVE, PRODUCT, SKU, WIDTHS, stockedVariant,
  watch, settle, go, open, clickNavigating, scrollThrough, expectImagesLoaded, overflowX, overflowCulprits, seedShopper, adminOn, tapTargetViolations,
};
