// Task 18 — viewport matrix over the storefront and the admin: no horizontal overflow, landmarks and h1,
// images load, no console/page errors or failed requests, mobile chrome (bottom nav, offcanvas) works and
// tap targets are at least 44×44 CSS px on phones.
const { test, expect } = require('@playwright/test');
const {
  PRODUCT, WIDTHS, watch, settle, go, open, clickNavigating, scrollThrough, expectImagesLoaded, overflowX, overflowCulprits, seedShopper, adminOn, tapTargetViolations,
} = require('./support/qa');

const MOBILE_SCOPES = ['.site-header', '.bottom-nav', '#navOffcanvas', '.product-card', '.catalog-toolbar', '.catalog-pills', '.filter-chips',
  '#filtersOffcanvas', '.qty-stepper', '#checkoutForm', '.admin-topbar', '.acct-nav', '.pdp-buy', '.pdp-sizes', '.pdp-colors', '.pdp-wish'];

async function checkRoute(page, hash, { mobile }) {
  await go(page, hash);
  await expect(page.locator('main#app'), hash).toHaveCount(1);
  await expect(page.locator('#app h1').first(), hash).toBeVisible();
  await scrollThrough(page);
  await expectImagesLoaded(page, hash);
  const over = await overflowX(page);
  expect(over, `horizontal overflow on ${hash}: ${(await overflowCulprits(page)).join(', ')}`).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (mobile) {
    const bad = await tapTargetViolations(page, MOBILE_SCOPES);
    expect(bad, `tap targets < 44px on ${hash}`).toEqual([]);
  }
}

for (const width of WIDTHS) {
  const mobile = width <= 767;
  const bottomNav = width < 992; // the bottom bar serves phones and tablets (hidden from the lg breakpoint)

  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: width < 768 ? 844 : 900 }); });

    test(`storefront routes at ${width}px`, async ({ page }) => {
      test.slow();
      const problems = watch(page);
      await open(page, '#/');
      const { orderId } = await seedShopper(page);
      const routes = ['#/catalog', '#/catalog/women', `#/product/${PRODUCT.slug}`, '#/cart', '#/checkout', '#/account', '#/account/orders',
        '#/account/wishlist', `#/order/${encodeURIComponent(orderId)}`, '#/'];
      for (const hash of routes) await checkRoute(page, hash, { mobile });
      if (bottomNav) {
        // bottom nav: visible and operable
        const nav = page.locator('.bottom-nav');
        await expect(nav).toBeVisible();
        await clickNavigating(page, nav.locator('a[href="#/catalog"]'));
        await expect(page).toHaveURL(/#\/catalog$/);
        await expect(nav.locator('a[href="#/catalog"]')).toHaveAttribute('aria-current', 'page');
        await clickNavigating(page, nav.locator('a[href="#/cart"]'));
        await expect(page).toHaveURL(/#\/cart$/);
        // offcanvas menu opens and closes with Escape, focus returns to the toggle
        const toggle = page.locator('.site-header [data-bs-target="#navOffcanvas"]');
        await toggle.click();
        await expect(page.locator('#navOffcanvas')).toBeVisible();
        await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#navOffcanvas'))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.locator('#navOffcanvas')).toBeHidden();
        await expect(toggle).toBeFocused();
      } else {
        await expect(page.locator('.bottom-nav')).toBeHidden();
      }
      expect(problems).toEqual([]);
    });

    test(`admin routes at ${width}px`, async ({ page }) => {
      test.slow();
      const problems = watch(page);
      await open(page, '#/');
      const { orderId, customerId } = await seedShopper(page);
      // the gate itself
      await go(page, '#/admin');
      await expect(page.locator('#app h1')).toBeVisible();
      expect(await overflowX(page), 'gate overflow').toBeLessThanOrEqual(0);
      await adminOn(page);
      const routes = ['#/admin', '#/admin/products', '#/admin/products/new', '#/admin/orders', `#/admin/orders/${encodeURIComponent(orderId)}`,
        '#/admin/customers', `#/admin/customers/${encodeURIComponent(customerId)}`, '#/admin/promotions', '#/admin/settings', '#/admin/backup', '#/admin/content'];
      await open(page, '#/admin/overview-reset'); // unknown admin path: admin «not found» page (also checked)
      for (const hash of routes) await checkRoute(page, hash, { mobile });
      // every content tab
      const tabs = page.locator('[data-admin-view="content"] [role="tab"]');
      const n = await tabs.count();
      expect(n).toBeGreaterThan(3);
      for (let i = 0; i < n; i += 1) {
        const key = await tabs.nth(i).getAttribute('data-tab');
        await tabs.nth(i).click();
        await expect(page.locator('[data-admin-view="content"]')).toHaveAttribute('data-tab', key);
        await settle(page);
        await scrollThrough(page);
        await expectImagesLoaded(page, `content/${key}`);
        expect(await overflowX(page), `overflow on content tab ${key}: ${(await overflowCulprits(page)).join(', ')}`).toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      expect(problems).toEqual([]);
    });
  });
}

test('sticky header never covers a focused element (scroll-padding)', async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, '#/catalog');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // focus a control that is now ABOVE the viewport: the browser scrolls it in at the top edge
    await page.evaluate(() => { document.activeElement?.blur(); document.querySelectorAll('.product-card [data-wish]')[2].focus(); });
    // (scrolling may be smooth: wait for it to settle, then the control must sit below the sticky header)
    await expect.poll(() => page.evaluate(() => {
      const el = document.activeElement.getBoundingClientRect().top;
      const header = document.querySelector('.site-header').getBoundingClientRect().bottom;
      return el >= header;
    }), { message: `width ${width}` }).toBe(true);
  }
});
