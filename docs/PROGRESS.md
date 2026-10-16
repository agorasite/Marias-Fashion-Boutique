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
| 16–19 | Admin customers+coupons, content+settings; Backup/reset; A11y/responsive pass (incl. flaky-test stability); README/handoff | not started |

Overall: 15 of 19 tasks complete (~79%). Tests: unit 244, e2e 229 (known rare flake: catalog.spec.js:226), all green.

## Task 9 — done
Commits 46120e9 (WIP), ec5dc42, a94ec07. Reviewed; IRIS wording and checkout hardening fixed. Notes for later tasks: pickup orders have `shippingAddress: null`; `confirmIrisSimulation` refuses cancelled/returned orders.

## Task 14 — done
State machine, restock and CSV rules live in `services/order-rules.js` (pure, decision block at the top); `services/orders.js` wraps them in one-tx mutations. Sample orders and `restocked:true` orders never touch stock; deleted variants are skipped with a history note; archived variants get stock back but stay archived. Cancel/return do not change paymentStatus or customer/coupon aggregates. Internal history entries (note/restock) are hidden on the customer account page. `/admin/customers/:id` is a placeholder for Task 15 (linked from order detail). Report: `.superpowers/sdd/2026-10-16-elan-fashion-boutique/task-14-report.md`.

## Next task: Task 16 — Admin content and settings
Files: `assets/js/pages/admin/{content,settings}.js`; test `tests/e2e/admin-content-settings.spec.js`.
Content editors (use `services/content.js` getContent/saveContent + `content-rules.js` validators; keys hero, banners, collections, instagram, promos, newsletter, footer): hero title/subtitle/CTA/link/image/focal, banners, featured collections (title/image/link), Instagram demo feed (profile URL, handle, posts: image, caption, permalink, productIds), homepage promo sections, newsletter display, footer content; links must pass the validators (only `#/` or `https://`). Settings editor (services/settings.js getSettings/saveSettings): store name, contact, logo configuration, currency (display), VAT rate, shipping fees (courier), free-shipping threshold, COD surcharge, demo IRIS instructions (Greek; must keep the honesty rule: never imply real payment), social links. Changes must show immediately in the storefront (home, cart free-shipping indicator, checkout totals, footer) and persist after reload; validation (money in EUR with comma/dot → cents, VAT 0–100%, URLs). Routes `#/admin/content`, `#/admin/settings` (currently placeholders in app.js loop). Reminder: resetToSeed does not dispatch content:changed/settings:changed (fix here or in Task 17 where reset UI lives); settings saves must dispatch `settings:changed`.

## Environment / how to run
- Node 22, `cwebp` available, Playwright (chromium) installed under `tests/`.
- `cd tests && npm test` (unit) · `npx playwright test` (e2e; static server on http://127.0.0.1:4173 starts automatically).
- Dev tools: `node tools/validate-seed.mjs data/products.json`, `node tools/fetch-images.mjs`, `node tools/build-products.mjs`.
- SDD ledger (git-ignored, local): `.superpowers/sdd/2026-10-16-elan-fashion-boutique/progress.md` — contains rulings, deferred minors and per-task notes.

## Open items carried forward
- Deferred minors per task are in the ledger (search `minor (deferred)`); polish ones are meant for Task 18 (e.g. catalog search debounce teardown, loadMore/refresh race, quick-view helpers duplication, combat-boots mirrored second photo, `waitForTimeout` in shell test).
- `fashion1.zip` in the repo root is untracked and not part of the build — decide whether to delete or git-ignore it.
- Commit trailers by subagents say "Claude Opus 5.5" / mixed; cosmetic.
