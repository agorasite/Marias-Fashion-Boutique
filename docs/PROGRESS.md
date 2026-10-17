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
| 14 | Admin order management | complete, reviewed (no fix round) |
| 15 | Admin customers and coupons | complete, reviewed (no fix round) |
| 16 | Admin content and settings | complete, reviewed (1 fix round) |
| 17 | Backup, import, reset | complete, reviewed (2 fix rounds) |
| 18 | Accessibility, responsive and resilience pass (incl. flaky-test stability, deferred minors) | not started |
| 19 | README, full regression, handoff report (qa-gates 1–14) | not started |

Overall: 17 of 19 tasks complete (~89%). Tests: unit 336, e2e 293, all green (known rare flakes: catalog.spec.js:226 and :206 — to be fixed in Task 18).

## Task 9 — done
Commits 46120e9 (WIP), ec5dc42, a94ec07. Reviewed; IRIS wording and checkout hardening fixed. Notes for later tasks: pickup orders have `shippingAddress: null`; `confirmIrisSimulation` refuses cancelled/returned orders.

## Task 14 — done
State machine, restock and CSV rules live in `services/order-rules.js` (pure, decision block at the top); `services/orders.js` wraps them in one-tx mutations. Sample orders and `restocked:true` orders never touch stock; deleted variants are skipped with a history note; archived variants get stock back but stay archived. Cancel/return do not change paymentStatus or customer/coupon aggregates. Internal history entries (note/restock) are hidden on the customer account page. `/admin/customers/:id` is a placeholder for Task 15 (linked from order detail). Report: `.superpowers/sdd/2026-10-16-elan-fashion-boutique/task-14-report.md`.

## Next task: Task 18 — Accessibility, responsive and resilience pass
Files: tests `tests/e2e/responsive.spec.js`, `tests/e2e/a11y.spec.js`, `tests/e2e/resilience.spec.js`; fixes across CSS/components as needed.
1. Viewport matrix 320/375/390/430/768/1024/1440 over the main storefront and admin routes: no horizontal overflow, header/bottom-nav/offcanvas/modal usable, tap targets ≥ 44px on mobile, no console errors/failed requests (incl. images).
2. Keyboard: Tab order through catalog → PDP → cart → checkout; Escape closes modals; labels/aria on forms; `prefers-reduced-motion`; image-error fallback; IndexedDB-unavailable error screen.
3. FLAKES: catalog.spec.js:226 (filter state URL back/forward) and :206 (heart without wishlist listener) fail rarely in full runs but pass in isolation — reproduce with the whole suite under `--repeat-each` / reduced workers, find the race (suspect router history tracking `elanIdx`/pushState in catalog or shared state), fix root cause, then run the full e2e suite 5 times green.
4. Deferred minors worth fixing here (see ledger `minor (deferred)` lines): account tab strip scrolls sideways at 390 (Προφίλ cut off); catalog search debounce timer not cleared on teardown / loadMore-vs-refresh race; quickView helpers duplicate sizeLabel/compareSizes/raw Intl; combat boots image 2 is a mirrored duplicate (drop it from data/products.json + manifest/credits consistency); hero mobile `sizes` downloads 1920w on phones; mobile-menu free-shipping phrases duplicated inline in app.js (use freeShippingPhrase); migrateContent/seed optional files failure tolerance already done; shop-the-look old modal not disposed; admin lists don’t listen to orders:changed/coupons:changed; saveCoupon no-expiresOn already fixed.

## Environment / how to run
- Node 22, `cwebp` available, Playwright (chromium) installed under `tests/`.
- `cd tests && npm test` (unit) · `npx playwright test` (e2e; static server on http://127.0.0.1:4173 starts automatically; 6 workers by default, `PW_WORKERS=<n>` to change; kill a stale server on :4173 first — Playwright reuses it; `ELAN_TEST_DATE=YYYY-MM-DD` runs the calendar-dependent specs on another date).
- Dev tools: `node tools/validate-seed.mjs data/products.json`, `node tools/fetch-images.mjs`, `node tools/build-products.mjs`.
- SDD ledger (git-ignored, local): `.superpowers/sdd/2026-10-16-elan-fashion-boutique/progress.md` — contains rulings, deferred minors and per-task notes.

## Open items carried forward
- Deferred minors per task are in the ledger (search `minor (deferred)`); polish ones are meant for Task 18 (e.g. catalog search debounce teardown, loadMore/refresh race, quick-view helpers duplication, combat-boots mirrored second photo, `waitForTimeout` in shell test).
- `fashion1.zip` in the repo root is untracked and not part of the build — decide whether to delete or git-ignore it.
- Commit trailers by subagents say "Claude Opus 5.5" / mixed; cosmetic.
