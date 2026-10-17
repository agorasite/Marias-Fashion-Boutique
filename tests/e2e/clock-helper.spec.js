// The ELAN_TEST_DATE clock shift (support/test.js) must behave like the real Date in the page.
const { test, expect } = require('@playwright/test');
const { shiftDate } = require('./support/test');

test('shifted Date: callable without new, statics kept, instanceof and parsing intact', async ({ page }) => {
  const target = Date.parse('2026-12-31T10:00:00Z');
  await page.addInitScript(shiftDate, target - Date.now());
  await page.goto('/#/');
  const r = await page.evaluate(() => ({
    now: Date.now(),
    fresh: new Date().getTime(),
    asFunction: typeof Date(),
    fnYear: Date().includes('2026') && Date().includes('Dec'),
    fixed: new Date('2020-01-02T00:00:00Z').toISOString(),
    parts: new Date(2020, 0, 2).getFullYear(),
    parse: Date.parse('2020-01-02T00:00:00Z'),
    utc: Date.UTC(2020, 0, 2),
    inst: new Date() instanceof Date,
    ctor: new Date().constructor === Date,
  }));
  expect(Math.abs(r.now - target)).toBeLessThan(60000);
  expect(Math.abs(r.fresh - target)).toBeLessThan(60000);
  expect(r).toMatchObject({ asFunction: 'string', fnYear: true, fixed: '2020-01-02T00:00:00.000Z', parts: 2020, parse: Date.UTC(2020, 0, 2), utc: Date.UTC(2020, 0, 2), inst: true, ctor: true });
});
