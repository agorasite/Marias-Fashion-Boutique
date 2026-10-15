const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const products = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8')).products;
const reviews = JSON.parse(fs.readFileSync(path.join(root, 'data/reviews.json'), 'utf8')).reviews;

const colorsOf = (p) => [...new Set(p.variants.map((v) => v.color))];
const stockOf = (p, size, color) => {
  const v = p.variants.find((x) => x.size === size && x.color === color);
  return v ? v.stock : null;
};

// Product with two colours plus a sold-out size that exists in stock in another colour.
const multi = products.find((p) => p.status !== 'archived' && colorsOf(p).length >= 2
  && p.variants.some((v) => v.stock === 0));
const soldOutProduct = products.find((p) => p.variants.some((v) => v.stock === 0) && p.variants.some((v) => v.stock > 0));
const soldOutVariant = soldOutProduct.variants.find((v) => v.stock === 0);
const lowProduct = products.find((p) => p.variants.some((v) => v.stock >= 2 && v.stock <= 5));
const lowVariant = lowProduct.variants.find((v) => v.stock >= 2 && v.stock <= 5);
const saleProduct = products.find((p) => p.compareAtCents && p.compareAtCents > p.priceCents);
const reviewed = new Set(reviews.map((r) => r.productId));
const unreviewed = products.find((p) => !reviewed.has(p.id));
const reviewedProduct = products.find((p) => reviewed.has(p.id));
const shoe = products.find((p) => p.categoryId === 'shoes');
const bag = products.find((p) => p.subcategoryId === 'bags');
const wearable = products.find((p) => p.categoryId === 'women' && p.images.length >= 2
  && new Set(p.variants.map((v) => v.size)).size > 1 && p.variants.some((v) => v.stock >= 6));
const wearVariant = wearable.variants.find((v) => v.stock >= 6);

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function open(page, slug, query = '') {
  await page.goto(`/#/product/${slug}${query}`);
  await expect(page.locator('[data-page="product"] h1')).toBeVisible();
}

const q = (v) => encodeURIComponent(v);
const sizeBtn = (page, size) => page.locator(`[data-size="${size}"]`);
const colorBtn = (page, color) => page.locator(`[data-color="${color}"]`);
// Wait until a Bootstrap modal finished opening (focus moved inside it).
const modalReady = (page, id) => page.waitForFunction((i) => { const m = document.getElementById(i); return m && m.classList.contains('show') && m.contains(document.activeElement); }, id);
const cartBadge = (page) => page.locator('.header-end [data-badge="cart"]');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('renders product info, breadcrumbs and sets document title', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, wearable.slug);
  await expect(page.locator('h1')).toHaveText(wearable.name);
  await expect(page.locator('.breadcrumb')).toContainText('Γυναικεία');
  await expect(page.locator('.breadcrumb')).toContainText(wearable.name);
  await expect(page.locator('[data-page="product"]')).toContainText(wearable.brand);
  await expect(page).toHaveTitle(new RegExp(wearable.name.slice(0, 12)));
  await expect(page.locator('[data-specs]')).toContainText(wearable.attributes.material);
  await expect(page.locator('[data-care]')).toContainText(wearable.attributes.care.slice(0, 10));
  await expect(page.locator('[data-shipping]')).toContainText('3,90');
  await expect(page.locator('[data-shipping]')).toContainText('60,00');
  expect(errors).toEqual([]);
});

test('changing colour updates which sizes are available', async ({ page }) => {
  await open(page, multi.slug);
  const sizes = [...new Set(multi.variants.map((v) => v.size))];
  for (const c of colorsOf(multi)) {
    await colorBtn(page, c).click();
    await expect(colorBtn(page, c)).toHaveAttribute('aria-pressed', 'true');
    for (const size of sizes) {
      const st = stockOf(multi, size, c);
      const btn = sizeBtn(page, size);
      if (!st) await expect(btn).toBeDisabled();
      else await expect(btn).toBeEnabled();
    }
  }
});

test('sold-out size is disabled and labelled', async ({ page }) => {
  await open(page, soldOutProduct.slug, `?color=${q(soldOutVariant.color)}`);
  const btn = sizeBtn(page, soldOutVariant.size);
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText('Εξαντλημένο');
});

test('stock text updates per selected variant', async ({ page }) => {
  await open(page, lowProduct.slug, `?color=${q(lowVariant.color)}`);
  await sizeBtn(page, lowVariant.size).click();
  await expect(page.locator('[data-stock]')).toContainText(`Μόνο ${lowVariant.stock} διαθέσιμα`);
  await open(page, wearable.slug, `?color=${q(wearVariant.color)}`);
  await sizeBtn(page, wearVariant.size).click();
  await expect(page.locator('[data-stock]')).toHaveText(/Διαθέσιμο/);
});

test('add to cart is disabled until a valid variant is chosen, with hint', async ({ page }) => {
  await open(page, wearable.slug);
  await expect(page.locator('[data-add]')).toBeDisabled();
  await expect(page.locator('[data-hint]')).toContainText('Επιλέξτε μέγεθος');
  await colorBtn(page, wearVariant.color).click();
  await sizeBtn(page, wearVariant.size).click();
  await expect(page.locator('[data-add]')).toBeEnabled();
  await expect(page.locator('[data-hint]')).toBeHidden();
});

test('quantity is capped at the variant stock', async ({ page }) => {
  await open(page, lowProduct.slug, `?color=${q(lowVariant.color)}&size=${q(lowVariant.size)}`);
  const input = page.locator('[data-qty-input]');
  for (let i = 0; i < lowVariant.stock + 3; i += 1) await page.locator('[data-qty-plus]').click({ force: true });
  await expect(input).toHaveValue(String(lowVariant.stock));
  await expect(page.locator('[data-qty-plus]')).toBeDisabled();
  await input.fill('99');
  await input.blur();
  await expect(input).toHaveValue(String(lowVariant.stock));
});

test('add to cart updates header badge and persists across reload; cap respects cart', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, wearable.slug, `?color=${q(wearVariant.color)}&size=${q(wearVariant.size)}`);
  await expect(page.locator('[data-add]')).toBeEnabled();
  await page.locator('[data-qty-plus]').click();
  await page.locator('[data-add]').click();
  await expect(cartBadge(page)).toHaveText('2');
  await expect(page.locator('.toast-elan')).toContainText('καλάθι');
  await page.reload();
  await expect(cartBadge(page)).toHaveText('2');
  await expect(page.locator('[data-page="product"] h1')).toBeVisible();
  const input = page.locator('[data-qty-input]');
  for (let i = 0; i < wearVariant.stock; i += 1) await page.locator('[data-qty-plus]').click({ force: true });
  await expect(input).toHaveValue(String(wearVariant.stock - 2));
  expect(errors).toEqual([]);
});

test('deep link selects colour and size', async ({ page }) => {
  await open(page, wearable.slug, `?color=${q(wearVariant.color)}&size=${q(wearVariant.size)}`);
  await expect(colorBtn(page, wearVariant.color)).toHaveAttribute('aria-pressed', 'true');
  await expect(sizeBtn(page, wearVariant.size)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-add]')).toBeEnabled();
});

test('size chart modal opens and closes with Escape', async ({ page }) => {
  await open(page, wearable.slug);
  await page.locator('[data-size-chart-open]').click();
  const modal = page.locator('#sizeChartModal');
  await expect(modal).toBeVisible();
  await modalReady(page, 'sizeChartModal');
  await expect(modal).toContainText('Στήθος');
  await expect(modal.locator('tbody tr').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('size chart variants: shoes table and accessories note', async ({ page }) => {
  await open(page, shoe.slug);
  await page.locator('[data-size-chart-open]').click();
  await expect(page.locator('#sizeChartModal')).toContainText('Μήκος πέλματος');
  await modalReady(page, 'sizeChartModal');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sizeChartModal')).toBeHidden();
  await open(page, bag.slug);
  await page.locator('[data-size-chart-open]').click();
  await expect(page.locator('#sizeChartModal')).toContainText('Ενιαίο μέγεθος');
  await modalReady(page, 'sizeChartModal');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sizeChartModal')).toBeHidden();
});

test('gallery thumbnails change the main image; lightbox works by keyboard', async ({ page }) => {
  await open(page, wearable.slug);
  const main = page.locator('[data-gallery-main]');
  const thumbs = page.locator('[data-thumb]');
  expect(await thumbs.count()).toBe(wearable.images.length);
  const first = await main.getAttribute('src');
  await thumbs.nth(1).click();
  await expect(main).not.toHaveAttribute('src', first);
  await expect(main).toHaveAttribute('src', wearable.images[1]);
  await page.locator('[data-lightbox-open]').focus();
  await page.keyboard.press('Enter');
  const lb = page.locator('#lightboxModal');
  await expect(lb).toBeVisible();
  await modalReady(page, 'lightboxModal');
  const lbImg = lb.locator('[data-lightbox-img]');
  const before = await lbImg.getAttribute('src');
  await page.keyboard.press('ArrowRight');
  await expect(lbImg).not.toHaveAttribute('src', before);
  await page.keyboard.press('Escape');
  await expect(lb).toBeHidden();
});

test('reviews list, summary, and adding a review persists', async ({ page }) => {
  await open(page, reviewedProduct.slug);
  const mine = reviews.filter((r) => r.productId === reviewedProduct.id);
  await expect(page.locator('[data-review]')).toHaveCount(mine.length);
  await expect(page.locator('[data-review-count]')).toContainText(String(mine.length));

  await open(page, unreviewed.slug);
  await expect(page.locator('[data-review]')).toHaveCount(0);
  await page.locator('#reviewForm button[type="submit"]').click();
  await expect(page.locator('#reviewForm .invalid-feedback:visible').first()).toBeVisible();
  await page.locator('#reviewForm label[for="rate4"]').click();
  await page.locator('#reviewForm [name="title"]').fill('Πολύ καλό');
  await page.locator('#reviewForm [name="body"]').fill('Εξαιρετική ποιότητα και γρήγορη παράδοση.');
  await page.locator('#reviewForm [name="name"]').fill('Άννα Τ.');
  await page.locator('#reviewForm button[type="submit"]').click();
  await expect(page.locator('[data-review]')).toHaveCount(1);
  await expect(page.locator('[data-avg]')).toHaveText('4,0');
  await page.reload();
  await expect(page.locator('[data-review]')).toHaveCount(1);
  await expect(page.locator('[data-review]')).toContainText('Άννα Τ.');
  await expect(page.locator('[data-avg]')).toHaveText('4,0');
});

test('related products render 1-4 cards excluding the current one', async ({ page }) => {
  await open(page, wearable.slug);
  const cards = page.locator('[data-related] .product-card');
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(4);
  const ids = await cards.evaluateAll((els) => els.map((e) => e.dataset.productId));
  expect(ids).not.toContain(wearable.id);
});

test('sale product shows original price and discount badge', async ({ page }) => {
  await open(page, saleProduct.slug);
  const pct = Math.round((1 - saleProduct.priceCents / saleProduct.compareAtCents) * 100);
  await expect(page.locator('[data-page="product"] .price-old').first()).toBeVisible();
  await expect(page.locator('[data-discount]')).toContainText(`-${pct}%`);
});

test('wishlist button dispatches wishlist:toggle', async ({ page }) => {
  await open(page, wearable.slug);
  const evt = page.evaluate(() => new Promise((res) => {
    window.addEventListener('wishlist:toggle', (e) => res(e.detail), { once: true });
  }));
  await page.locator('[data-wish-btn]').click();
  expect(await evt).toEqual({ productId: wearable.id });
});

test('unknown slug shows a friendly not-found state', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/#/product/does-not-exist');
  await expect(page.locator('[data-page="product-not-found"] h1')).toBeVisible();
  await expect(page.locator('[data-page="product-not-found"]')).toContainText('δεν βρέθηκε');
  await expect(page.locator('.site-header')).toBeVisible();
  expect(errors).toEqual([]);
});

test('390px: no horizontal overflow and add-to-cart reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, wearable.slug);
  await expect(page.locator('[data-related] .product-card').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('[data-add]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-add]')).toBeVisible();
  await colorBtn(page, wearVariant.color).click();
  await sizeBtn(page, wearVariant.size).click();
  await page.locator('[data-add]').click();
  await expect(page.locator('.header-end [data-badge="cart"]')).toHaveText('1');
});
