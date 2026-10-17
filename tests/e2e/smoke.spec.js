const { test, expect } = require('@playwright/test');

test('shell loads without console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveCount(1);
  await expect(page).toHaveTitle(/Marias/);
  expect(errors).toEqual([]);
});
