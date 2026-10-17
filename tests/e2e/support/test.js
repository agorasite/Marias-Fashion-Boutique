// `test` / `expect` for specs that depend on the calendar (the sample orders are re-dated to the install day).
// With ELAN_TEST_DATE=YYYY-MM-DD (e.g. `ELAN_TEST_DATE=2026-12-31 npx playwright test e2e/admin-orders.spec.js`)
// every page sees that date (Date / Date.now shifted by a fixed offset; timers untouched), proving the suite
// passes on any day — not only on the day data/sample-data.json was generated. Unset: plain Playwright.
const base = require('@playwright/test');

const target = process.env.ELAN_TEST_DATE ? Date.parse(`${process.env.ELAN_TEST_DATE}T10:00:00Z`) : null;
if (process.env.ELAN_TEST_DATE && !Number.isFinite(target)) throw new Error(`Bad ELAN_TEST_DATE ${process.env.ELAN_TEST_DATE}`);

function shiftDate(offset) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  class ShiftedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(realNow() + offset); }
    static now() { return realNow() + offset; }
  }
  window.Date = ShiftedDate;
}

const test = base.test.extend({
  context: async ({ context }, use) => {
    if (target !== null) await context.addInitScript(shiftDate, target - Date.now());
    await use(context);
  },
});

/** "Now" as the pages see it (the shifted date when ELAN_TEST_DATE is set). */
const pageNow = () => (target !== null ? target + (Date.now() - startedAt) : Date.now());
const startedAt = Date.now();

module.exports = { ...base, test, expect: base.expect, pageNow };
