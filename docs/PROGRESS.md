# ÉLAN Fashion Boutique — build progress (handoff)

Branch: `build/elan`. Plan: `docs/superpowers/plans/2026-10-16-elan-fashion-boutique.md`.
Spec: `docs/superpowers/specs/2026-10-16-elan-fashion-boutique-design.md`.
Execution method: superpowers:subagent-driven-development (fresh implementer per task → task review → fix rounds → commit).

## Status (end of session 1)

| # | Task | State |
|---|------|-------|
| 1 | Repo bootstrap + test harness | complete, reviewed |
| 2 | Pricing / quote service | complete, reviewed |
| 3 | IndexedDB, migrations, settings, seed | complete, reviewed |
| 4 | Image pipeline + 39-product catalog + validator (4a, 4b-1..4b-4) | complete (4a reviewed; 4b guarded by integrity test + visual spot check) |
| 5 | App shell, router, theme | complete, reviewed (1 fix round) |
| 6 | Product service + catalog page | complete, reviewed |
| 7 | Product detail page (+ minimal cart, reviews) | complete, reviewed |
| 8 | Cart + wishlist | complete, reviewed (1 fix round) |
| 9 | Transactional checkout, orders, confirmation | **IMPLEMENTED, NOT COMPLETE** — see below |
| 10–19 | Account, Home/Instagram, Admin (overview, products, orders, customers/coupons, content/settings), Backup/reset, A11y/responsive pass, README/handoff | not started |

Overall: 8 of 19 tasks complete (~42%); Task 9 implemented but with 2 failing e2e tests and no review.

## Task 9 — exact state

Committed as WIP. Test state at commit time: `npm test` (in `tests/`) 104/104 pass; `npx playwright test` 97 pass / **2 fail**, both in `tests/e2e/checkout.spec.js`:

1. `checkout.spec.js:135` "per-field validation messages, error summary and accessible attributes" — test timeout (30 s).
2. `checkout.spec.js:185` "shipping, COD and coupon change totals live and match the pricing math" — `s.shipping` is `NaN` at line 203 (the test parses the shipping amount from the DOM; for a free/«Δωρεάν» or pickup line the text is not a number, or the selector/format differs). Decide whether the test's parser or the page's text is wrong.

The implementer (opus subagent `a5ec5f27d461cac04`) was cut off by the session limit before delivering its report, so there is **no task-9 report file and no review yet**.

### To finish Task 9 (next steps, in order)
1. Fix the two failing e2e tests (investigate each failure's `test-results/*/error-context.md`; fix the page or the test, whichever is wrong).
2. Run `npm test` and `npx playwright test` in `tests/` — all green.
3. Verify the Task 8 carry-over rules in checkout: recompute with `pricedLines/isPriced`; refuse when `cart.hasProblems` or empty cart on direct navigation to `#/checkout`; `placeOrder` is one readwrite tx (carts, variants, coupons, orders, customers), idempotent by `requestId`; IRIS never shows "paid" before the simulation click.
4. Dispatch a task reviewer (spec + quality) on the diff `537915f..HEAD`; fix rounds as needed; then mark Task 9 complete.

## Next task after 9: Task 10 — Customer account
Files: `assets/js/pages/account.js`, extend `services/customers.js`; test `tests/e2e/account.spec.js`.
Routes `#/account`, `#/account/orders`, `#/account/orders/:id`; wishlist page already exists at `#/account/wishlist` (`pages/wishlist.js`) and should be embedded in the account area. Order history from `listOrdersForCustomer`, tracking steps derived from `fulfillmentStatus`, profile + saved addresses + newsletter edits persisted, "stored only in this browser" notice, switch between local customers.

## Environment / how to run
- Node 22, `cwebp` available, Playwright (chromium) installed under `tests/`.
- `cd tests && npm test` (unit) · `npx playwright test` (e2e; static server on http://127.0.0.1:4173 starts automatically).
- Dev tools: `node tools/validate-seed.mjs data/products.json`, `node tools/fetch-images.mjs`, `node tools/build-products.mjs`.
- SDD ledger (git-ignored, local): `.superpowers/sdd/2026-10-16-elan-fashion-boutique/progress.md` — contains rulings, deferred minors and per-task notes.

## Open items carried forward
- Deferred minors per task are in the ledger (search `minor (deferred)`); polish ones are meant for Task 18 (e.g. catalog search debounce teardown, loadMore/refresh race, quick-view helpers duplication, combat-boots mirrored second photo, `waitForTimeout` in shell test).
- `fashion1.zip` in the repo root is untracked and not part of the build — decide whether to delete or git-ignore it.
- Commit trailers by subagents say "Claude Opus 5.5" / mixed; cosmetic.
