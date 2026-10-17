// `test` / `expect` for specs that depend on the calendar (the sample orders are re-dated to the install day).
// With ELAN_TEST_DATE=YYYY-MM-DD (e.g. `ELAN_TEST_DATE=2026-12-31 npx playwright test e2e/admin-orders.spec.js`)
// every page sees that date (Date / Date.now shifted by a fixed offset; timers untouched), proving the suite
// passes on any day — not only on the day data/sample-data.json was generated. Unset: plain Playwright.
const base = require('@playwright/test');

const target = process.env.ELAN_TEST_DATE ? Date.parse(`${process.env.ELAN_TEST_DATE}T10:00:00Z`) : null;
if (process.env.ELAN_TEST_DATE && !Number.isFinite(target)) throw new Error(`Bad ELAN_TEST_DATE ${process.env.ELAN_TEST_DATE}`);
const startedAt = Date.now();

/** Runs in the page: replace Date with a shifted twin (callable without `new`, statics and prototype kept). */
function shiftDate(offset) {
  if (window.__elanDateShifted) return; // the default context may get the script twice (fixture + newContext hook)
  window.__elanDateShifted = true;
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(realNow() + offset).toString(); // Date() called as a function
    return args.length ? new RealDate(...args) : new RealDate(realNow() + offset);
  }
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = () => realNow() + offset;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  Object.defineProperty(RealDate.prototype, 'constructor', { value: ShiftedDate, writable: true, configurable: true });
  window.Date = ShiftedDate;
}

const offset = () => target - Date.now();

const test = base.test.extend({
  context: async ({ context }, use) => {
    if (target !== null) await context.addInitScript(shiftDate, offset());
    await use(context);
  },
  // contexts a test creates itself (browser.newContext()) get the same clock
  browser: [async ({ browser }, use) => {
    if (target === null) { await use(browser); return; }
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const ctx = await newContext(...args);
      await ctx.addInitScript(shiftDate, offset());
      return ctx;
    };
    await use(browser);
    browser.newContext = newContext;
  }, { scope: 'worker' }],
});

/** "Now" as the pages see it (the shifted date when ELAN_TEST_DATE is set). */
const pageNow = () => (target !== null ? target + (Date.now() - startedAt) : Date.now());

module.exports = { ...base, test, expect: base.expect, pageNow, shiftDate };
