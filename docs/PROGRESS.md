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
| 14 | Admin order management | complete (pending review) |
| 15 | Admin customers and coupons | complete (pending review) |
| 16 | Admin content and settings | complete, reviewed (1 fix round) |
| 17–19 | Admin customers+coupons, content+settings; Backup/reset; A11y/responsive pass (incl. flaky-test stability); README/handoff | not started |

Overall: 16 of 19 tasks complete (~84%). Tests: unit 289, e2e 278, all green (known rare flakes: catalog.spec.js:226 and :206 — to be fixed in Task 18).

## Task 9 — done
Commits 46120e9 (WIP), ec5dc42, a94ec07. Reviewed; IRIS wording and checkout hardening fixed. Notes for later tasks: pickup orders have `shippingAddress: null`; `confirmIrisSimulation` refuses cancelled/returned orders.

## Task 14 — done
State machine, restock and CSV rules live in `services/order-rules.js` (pure, decision block at the top); `services/orders.js` wraps them in one-tx mutations. Sample orders and `restocked:true` orders never touch stock; deleted variants are skipped with a history note; archived variants get stock back but stay archived. Cancel/return do not change paymentStatus or customer/coupon aggregates. Internal history entries (note/restock) are hidden on the customer account page. `/admin/customers/:id` is a placeholder for Task 15 (linked from order detail). Report: `.superpowers/sdd/2026-10-16-elan-fashion-boutique/task-14-report.md`.

## Next task: Task 17 — Backup, import, reset
Files: `assets/js/services/backup.js`, `assets/js/pages/admin/backup.js` (route `#/admin/backup`, currently a placeholder in app.js); tests `tests/unit/backup-validate.test.mjs`, `tests/e2e/backup.spec.js`.
API: `exportAll(): {schemaVersion, exportedAt, stores:{[name]:any[]}}` (all 11 stores; metadata incl. DB name; labelled as a local backup, NOT a cloud backup), `validateImport(obj): {ok, errors[]}` (schemaVersion, known store names only, arrays, unique keys per store, referential checks variants→products, orders lines qty = safe positive integers (planRestock accepts negatives/fractions — carry from Task 14), status enums, restocked flags boolean, coupon shape via coupon-rules, settings via settings-rules incl. IRIS honesty guard, content via content-rules validators, image allow-list for products/content), `importAll(obj)` stage-validate then ONE readwrite tx clearing and replacing all stores (failure leaves DB untouched), `resetToSeed()` exists in seed.js (needs confirm UI; dispatches content:changed/settings:changed after commit already; ensure catalog:changed/cart:changed/wishlist:changed/orders:changed/coupons:changed so open pages refresh). UI: Export JSON download (filename elan-backup-YYYY-MM-DD.json), Import (file input; show validation errors; preview counts of what will be replaced; typed confirmation before destructive replace), Reset demo (typed confirmation «ΕΠΑΝΑΦΟΡΑ»), clear statement that data lives only in this browser. Include customers/orders `sample` flags; imports of foreign/malformed JSON must fail safely with Greek errors.

## Environment / how to run
- Node 22, `cwebp` available, Playwright (chromium) installed under `tests/`.
- `cd tests && npm test` (unit) · `npx playwright test` (e2e; static server on http://127.0.0.1:4173 starts automatically).
- Dev tools: `node tools/validate-seed.mjs data/products.json`, `node tools/fetch-images.mjs`, `node tools/build-products.mjs`.
- SDD ledger (git-ignored, local): `.superpowers/sdd/2026-10-16-elan-fashion-boutique/progress.md` — contains rulings, deferred minors and per-task notes.

## Open items carried forward
- Deferred minors per task are in the ledger (search `minor (deferred)`); polish ones are meant for Task 18 (e.g. catalog search debounce teardown, loadMore/refresh race, quick-view helpers duplication, combat-boots mirrored second photo, `waitForTimeout` in shell test).
- `fashion1.zip` in the repo root is untracked and not part of the build — decide whether to delete or git-ignore it.
- Commit trailers by subagents say "Claude Opus 5.5" / mixed; cosmetic.
