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
| 9 | Transactional checkout, orders, confirmation | complete, reviewed (1 fix round) |
| 10 | Customer account, order history, tracking | complete, reviewed (1 fix round) |
| 11 | Homepage, content service, Instagram | complete, reviewed (no fix round) |
| 12 | Admin shell, demo gate, overview, sample data | complete, reviewed (no fix round) |
| 13 | Admin product management | complete, reviewed (1 fix round) |
| 14–19 | Admin orders, customers+coupons, content+settings; Backup/reset; A11y/responsive pass (incl. flaky-test stability); README/handoff | not started |

Overall: 13 of 19 tasks complete (~68%). Tests: unit 183, e2e 185 (one intermittent flake noted: catalog.spec.js:226), all otherwise green.

## Task 9 — done
Commits 46120e9 (WIP), ec5dc42, a94ec07. Reviewed; IRIS wording and checkout hardening fixed. Notes for later tasks: pickup orders have `shippingAddress: null`; `confirmIrisSimulation` refuses cancelled/returned orders.

## Next task: Task 14 — Admin order management
Files: `assets/js/pages/admin/orders.js`; extend `services/orders.js`; tests `tests/unit/restock.test.mjs`, `tests/e2e/admin-orders.spec.js`.
API: `listOrders(filter)`, `updateFulfillment(id,status)`, `updatePayment(id,status)`, `addNote(id,text)`, `cancelOrder(id)`, `returnOrder(id)` (one tx each; restock exactly once via `order.restocked`), `ordersToCsv(orders)` (RFC-4180, UTF-8 BOM). Order list with search/filters, detail view (customer info, snapshot, history, internal notes), status/payment updates (valid transitions only; payment and fulfillment separate), cancel + simulated refund/return workflow, print summary, CSV export, route `#/admin/orders` and `#/admin/orders/:id` (currently a placeholder registered in app.js).
CARRY-OVER DECISIONS (see ledger): (1) sample cancelled/returned orders already have restocked:true; cancelling/returning a sample NON-restocked order must not inflate stock for units never decremented — decide (e.g. skip restock for `sample:true` orders) and document; (2) restock must handle archived/deleted variants (skip deleted; archived variants: restore stock but they stay non-purchasable); (3) customer aggregates (orderCount/totalCents) and coupon usedCount: decide whether cancel/return adjusts them so the customers page agrees with revenue (revenue excludes cancelled/returned); (4) paymentStatus on cancel/return: refund simulation sets `refunded` only if it was `simulated-paid`.

## Environment / how to run
- Node 22, `cwebp` available, Playwright (chromium) installed under `tests/`.
- `cd tests && npm test` (unit) · `npx playwright test` (e2e; static server on http://127.0.0.1:4173 starts automatically).
- Dev tools: `node tools/validate-seed.mjs data/products.json`, `node tools/fetch-images.mjs`, `node tools/build-products.mjs`.
- SDD ledger (git-ignored, local): `.superpowers/sdd/2026-10-16-elan-fashion-boutique/progress.md` — contains rulings, deferred minors and per-task notes.

## Open items carried forward
- Deferred minors per task are in the ledger (search `minor (deferred)`); polish ones are meant for Task 18 (e.g. catalog search debounce teardown, loadMore/refresh race, quick-view helpers duplication, combat-boots mirrored second photo, `waitForTimeout` in shell test).
- `fashion1.zip` in the repo root is untracked and not part of the build — decide whether to delete or git-ignore it.
- Commit trailers by subagents say "Claude Opus 5.5" / mixed; cosmetic.
