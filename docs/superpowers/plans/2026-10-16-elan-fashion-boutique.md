# ÉLAN Fashion Boutique Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete browser-only ÉLAN Fashion Boutique demo (storefront + admin) with IndexedDB persistence and automated unit + Playwright tests.

**Architecture:** Static ES-module app, hash router, services-only data access over one IndexedDB database, one pure pricing/quote function shared by every screen, transactional checkout. Dev-only Node tooling under `tests/` and `tools/`.

**Tech Stack:** HTML5, CSS3, Bootstrap 5.3 + Bootstrap Icons (vendored or pinned CDN), vanilla JS ES modules, IndexedDB; dev: Node 22 (`node:test`), Playwright, `cwebp`.

**Spec:** `docs/superpowers/specs/2026-10-16-elan-fashion-boutique-design.md` (source brief `initialprmpt.txt`; contracts in `.claude/skills/agorasite-ecommerce/references/{data-contract,qa-gates,niche-blueprints}.md`). Executors read all of them.

## Global Constraints

- No framework, backend, or runtime build step; static HTTP serving only; hash routes; admin at `#/admin`.
- DB name `agorasite-fashion1-v1`; stores `categories, products, variants(keyPath sku), carts, wishlists, customers, orders, coupons, reviews, settings, content`.
- Money = integer cents; locale `el-GR`; EUR; prices VAT-inclusive at 24% (configurable); courier 390¢, pickup 0, free courier ≥ 6000¢, COD surcharge 200¢ (all in settings).
- `paymentStatus ∈ pending|simulated-paid|refunded`; `fulfillmentStatus ∈ pending|confirmed|processing|shipped|delivered|cancelled|returned`; restock guarded by `order.restocked`.
- Seed only into an empty DB or after confirmed reset; never on normal startup.
- Customer-facing text Greek; IDs/slugs/SKUs ASCII; Demo Store indicator in storefront and admin; admin gate labelled "demo access — not real authentication".
- ≥36 products, each with accurate Unsplash/Pexels photos (local WebP, `assets/images/credits.json`); never unrelated images, never fewer than 36.
- Viewports to verify: 320, 375, 390, 430, 768, 1024, 1440.
- Every task ends: tests green → fresh review → fixes → `git commit`. Update the checklist at the bottom after each task.

## Review Focus

- Double-click on "Place order" → exactly one order, one stock decrement (Task 9).
- Cart line whose SKU stock dropped/was archived after being added → user-visible message, checkout blocked, no crash (Tasks 8, 9).
- Coupon larger than subtotal → total never negative; expired/inactive/over-limit/under-min codes rejected with Greek message (Tasks 1, 9).
- Import of malformed/foreign JSON or wrong schemaVersion → DB untouched, error shown (Task 17).
- Admin edits product name/price or archives it → old orders unchanged, storefront updated after reload (Tasks 13, 14).
- Cancel then return (or repeated cancel) → stock restored once (Task 14).
- IndexedDB unavailable/blocked upgrade → readable error screen instead of blank page (Task 3).
- Unknown hash route and deep link to missing product → friendly 404 within the shell (Task 5).

---

## File Structure

```
index.html
assets/css/{theme,storefront,admin}.css
assets/js/{app,router,db,seed,ui}.js
assets/js/services/{pricing,products,cart,wishlist,coupons,checkout,orders,customers,reviews,settings,content,backup}.js
assets/js/components/{header,footer,bottom-nav,product-card,modals,toast,gallery}.js
assets/js/pages/{home,catalog,product,cart,checkout,confirmation,account,not-found}.js
assets/js/pages/admin/{gate,layout,overview,products,orders,customers,coupons,content,settings,backup}.js
data/{products.json,catalog-meta.json}
assets/images/**, assets/images/credits.json
tests/{package.json,playwright.config.js,server.js,helpers.js,unit/*.test.js,e2e/*.spec.js}
tools/{fetch-images.js,validate-seed.js,image-manifest.json}
README.md
```

---

### Task 1: Repo bootstrap and test harness

**Files:** Create `.gitignore`, `tests/package.json`, `tests/playwright.config.js`, `tests/server.js`, `tests/e2e/smoke.spec.js`, `index.html` (shell with `<main id="app">`), `README.md` stub.

**Interfaces:**
- Produces: `npm test` (unit) and `npm run e2e` in `tests/`; static server on `http://127.0.0.1:4173` serving repo root; Playwright `baseURL` = that origin.

- [ ] **Step 1:** `git init`; `.gitignore` ignores `node_modules`, `test-results`, `playwright-report`.
- [ ] **Step 2:** Write `tests/e2e/smoke.spec.js` `test('shell loads without console errors')` asserting `#app` exists, title contains "ÉLAN".
- [ ] **Step 3:** Run `npm i -D @playwright/test && npx playwright install chromium` in `tests/`; implement `server.js` with `node:http` (static files, correct MIME for `.js/.json/.webp/.css`) and `webServer` config.
- [ ] **Step 4:** `npx playwright test` → PASS. Commit "chore: bootstrap repo and test harness".

### Task 2: Pricing / quote service (pure)

**Files:** Create `assets/js/services/pricing.js`; Test `tests/unit/pricing.test.js`.

**Interfaces:**
- Produces: `formatMoney(cents:number): string` (el-GR EUR); `quote({lines:[{sku,unitCents,qty}], coupon:Coupon|null, shipping:{method:'courier'|'pickup'}, payment:'cod'|'iris', settings}): Quote` where `Quote = {subtotalCents, discountCents, shippingCents, codFeeCents, totalCents, vatIncludedCents, freeShippingRemainingCents, couponError:string|null}`; `validateCoupon(coupon, subtotalCents, now:Date): {ok:boolean, reason?:string}`.

- [ ] **Step 1:** Tests: percentage and fixed discount; discount capped so `totalCents ≥ 0`; free courier at exactly threshold, not below; pickup 0; COD adds `codFeeCents` only for `cod`; VAT = `total − round(total/1.24)`; expired / inactive / min-spend / `usedCount>=maxUses` each rejected with a distinct `reason`; shipping not discounted away.
- [ ] **Step 2:** Run → FAIL. Implement; run → PASS. Commit.

### Task 3: Database, migrations, settings, seed loader

**Files:** Create `assets/js/db.js`, `assets/js/seed.js`, `assets/js/services/settings.js`, `data/catalog-meta.json` (categories, settings defaults, coupons, content defaults); Test `tests/e2e/persistence.spec.js`, `tests/unit/db-schema.test.js` (schema map only).

**Interfaces:**
- Produces: `openDb(): Promise<IDBDatabase>`; `tx(stores:string[], mode:'readonly'|'readwrite', fn:(t)=>Promise<T>): Promise<T>` (fn may only await requests on `t`); `getAll(store)`, `get(store,key)`, `put(store,val)`, `del(store,key)`; `ensureSeeded(): Promise<boolean>` (true when it seeded); `resetToSeed(): Promise<void>`; `getSettings(): Promise<Settings>`, `saveSettings(patch)`; `DB_NAME`, `SCHEMA_VERSION=1`; `onDbError(cb)` renders a full-page Greek error when IndexedDB is unavailable/blocked.

- [ ] **Step 1:** E2E: first load seeds (settings + categories present); modify a setting, reload → value kept and seed did not re-run (spy via counter in `settings.seededAt` unchanged).
- [ ] **Step 2:** Implement stores/indexes (variants by `productId`; orders by `customerId`, `createdAt`; products by `categoryId`, `slug`). Seed reads `data/*.json`; products may be a small fixture until Task 4 replaces `products.json`.
- [ ] **Step 3:** Tests pass; commit.

### Task 4: Image pipeline and 36+ product catalog

**Files:** Create `tools/fetch-images.js`, `tools/image-manifest.json`, `tools/validate-seed.js`, `data/products.json`, `assets/images/**`, `assets/images/credits.json`; Test `tests/unit/seed-validation.test.js`.

**Interfaces:**
- Produces: `data/products.json` = `{products:[{id,slug,name,brand,categoryId,subcategoryId,description,priceCents,compareAtCents?,images:[path],attributes:{material,care,fit},featured,newArrival,bestSeller,popularity,status:'active'|'archived',variants:[{sku,size,color,colorHex,stock}]}]}`; `validate-seed.js <path>` exits non-zero on: <36 products, duplicate id/slug/SKU, negative stock/price, missing image file, image lacking `credits.json` entry (photographer, sourceUrl, license, retrievedAt), category not in `catalog-meta.json`.

- [ ] **Step 1:** Write the validator test with a deliberately broken fixture for each rule → FAIL; implement validator → PASS.
- [ ] **Step 2:** Research images (WebSearch/WebFetch on Unsplash/Pexels). For each product slot choose real photos that show that item; verify license page, relevance, framing at 390px; record in manifest. Target distribution: women (dresses, tops, jackets, jeans), men (shirts, jackets, jeans, tees), shoes (sneakers, boots, heels/flats), accessories (bags, belts, sunglasses, scarves). Also hero, banners, Instagram tiles. If a slot has no genuine match, change the product in that slot, not the image rule.
- [ ] **Step 3:** `fetch-images.js` downloads, resizes (≈1200px and ≈480px long edge) and converts via `cwebp`; writes `credits.json`. Keep photos per product ≥2 where available.
- [ ] **Step 4:** Author `products.json` (Greek copy, realistic prices, size runs XS–XL / 36–45, per-variant stock incl. some zero and low stock, 6+ sale items). Run validator → PASS. Visually review a contact sheet at mobile width (screenshot via Playwright) and fix mismatches. Commit.

### Task 5: App shell, router, theme, shared components

**Files:** Create `assets/js/{app,router,ui}.js`, `assets/js/components/{header,footer,bottom-nav,toast,modals}.js`, `assets/js/pages/not-found.js`, `assets/css/{theme,storefront}.css`; Test `tests/e2e/shell.spec.js`.

**Interfaces:**
- Produces: `route(pattern, handler)`, `navigate(hash)`, handler signature `(ctx:{params,query}) => Promise<void|HTMLElement>`; `toast(msg,type)`; `confirmDialog(msg): Promise<boolean>`; header badges update from `cart:changed` / `wishlist:changed` window events; Demo Store strip + "about this demo" modal; Bootstrap offcanvas nav.

- [ ] **Step 1:** E2E: all header/footer/bottom-nav links resolve (no 404 view); unknown hash shows not-found inside the shell; back/forward works; no horizontal overflow at 320; Escape closes offcanvas; focus moves to `<h1>` on route change.
- [ ] **Step 2:** Implement; apply boutique theme (warm off-white, charcoal, beige, black buttons, taupe/gold accents; serif display + sans body; reduced-motion respected). Tests pass; commit.

### Task 6: Product service and catalog page

**Files:** Create `assets/js/services/products.js`, `assets/js/components/product-card.js`, `assets/js/pages/catalog.js`; Test `tests/unit/product-filter.test.js`, `tests/e2e/catalog.spec.js`.

**Interfaces:**
- Produces: `listProducts(filter:{categoryId?,subcategoryId?,q?,minCents?,maxCents?,sizes?,colors?,brands?,inStockOnly?,sort:'newest'|'popular'|'price-asc'|'price-desc',page,pageSize}): Promise<{items,total}>`; `getProduct(idOrSlug)`; `productAvailability(product): {inStock,lowStock,minPriceCents}`; pure `applyFilters(products,variants,filter)` used by both.

- [ ] **Step 1:** Unit tests for each filter and combination (size+color uses the same variant), sort orders, empty result, archived hidden, accent-insensitive Greek search ("φορεμα" finds "Φόρεμα").
- [ ] **Step 2:** E2E: category nav, instant search, price/size/color/brand/availability filters (mobile offcanvas), sort, load-more, quick-view modal, wishlist heart, empty state, filter state in URL query.
- [ ] **Step 3:** Implement; pass; commit.

### Task 7: Product detail page

**Files:** Create `assets/js/pages/product.js`, `assets/js/components/gallery.js`, `assets/js/services/reviews.js`; Test `tests/e2e/product.spec.js`.

**Interfaces:**
- Consumes: `getProduct`, `getVariant(sku)`.
- Produces: `getVariant(productId,size,color): Promise<Variant|null>`; `listReviews(productId)`, `addReview({productId,rating,title,body,name})`; page emits `cart:add` through `cart.addLine(sku,qty)` (Task 8).

- [ ] **Step 1:** E2E: changing color updates available sizes; sold-out size disabled with label; stock text updates ("Μόνο 2 διαθέσιμα"); Add-to-cart disabled until valid variant; quantity capped at stock; size chart modal; gallery thumbnails + lightbox; reviews list and add-review persists; related products; discount badge and original price.
- [ ] **Step 2:** Implement; pass; commit.

### Task 8: Cart and wishlist

**Files:** Create `assets/js/services/{cart,wishlist}.js`, `assets/js/pages/cart.js`; Test `tests/unit/cart-rules.test.js`, `tests/e2e/cart.spec.js`.

**Interfaces:**
- Produces: `getCart(): Promise<{lines:[{sku,qty,productId,name,image,size,color,unitCents,available,problem?:'out-of-stock'|'insufficient'|'archived'}]}>`; `addLine(sku,qty)`; `setQty(sku,qty)`; `changeVariant(oldSku,newSku)`; `removeLine(sku)`; `applyCoupon(code)`; `getQuoteForCart(shippingMethod,payment)` (calls `pricing.quote`); wishlist `toggle(productId)`, `list()`; both dispatch window events.

- [ ] **Step 1:** Tests: quantity can't exceed stock; merging same SKU; reload persistence; change variant keeps qty clipped to new stock; invalid coupon message; free-shipping progress bar value; line with `problem` blocks checkout CTA.
- [ ] **Step 2:** Implement + UI (image, totals, coupon box, free-shipping indicator, continue shopping). Pass; commit.

### Task 9: Coupons service and transactional checkout

**Files:** Create `assets/js/services/{coupons,checkout,customers}.js`, `assets/js/pages/{checkout,confirmation}.js`; Test `tests/unit/checkout-validation.test.js`, `tests/e2e/checkout.spec.js`.

**Interfaces:**
- Consumes: `pricing.quote`, `cart.getCart`.
- Produces: `validateCheckoutForm(data): {ok,errors:{field:msg}}` (Greek mobile/landline phone, 5-digit postal code, email, VAT 9 digits when provided); `placeOrder({form,shipping,payment}): Promise<Order>` — single readwrite transaction over `carts,variants,coupons,orders,customers`, rechecks stock/coupon, throws `CheckoutError{code:'STOCK'|'COUPON'|'EMPTY'|'VALIDATION'}`; `Order = {id:'ELAN-YYYYMMDD-XXXX',customerId,lines:[snapshot],totals:Quote,shipping,payment:{method,status},fulfillmentStatus,restocked:false,notes:[],createdAt,history:[]}`; `confirmIrisSimulation(orderId)` sets `simulated-paid` (labelled simulation).

- [ ] **Step 1:** E2E: validation errors per field; shipping/COD/coupon change totals live; COD → `paymentStatus pending`; IRIS shows explanation + simulation button, never "paid" wording before simulation; success → one order, exact SKU decrement, cart cleared of purchased lines; double-click submit → one order; stock lowered in another tab → checkout blocked with message and no order; confirmation page and print view; saved details reused for returning local customer.
- [ ] **Step 2:** Implement; pass; commit.

### Task 10: Customer account

**Files:** Create `assets/js/pages/account.js`; extend `customers.js`; Test `tests/e2e/account.spec.js`.

**Interfaces:**
- Produces: `listCustomers()`, `saveCustomer(c)`, `setActiveCustomer(id)`, `ordersForCustomer(id)`; routes `#/account`, `#/account/orders`, `#/account/orders/:id`.

- [ ] **Step 1:** E2E: after checkout the order shows in history with tracking steps derived from `fulfillmentStatus`; edit profile and saved addresses persist; newsletter preference; wishlist view; "stored only in this browser" notice; switch local customer.
- [ ] **Step 2:** Implement; pass; commit.

### Task 11: Homepage, content and Instagram section

**Files:** Create `assets/js/pages/home.js`, `assets/js/services/content.js`; Test `tests/e2e/home.spec.js`.

**Interfaces:**
- Produces: `getContent(key)`/`saveContent(key,val)` for `hero, banners, collections, instagram, promos, newsletter, footer`; home renders sections from stored content + live product queries (new collection, per-department, best sellers, new arrivals).

- [ ] **Step 1:** E2E: every section renders with non-broken images (`naturalWidth>0`); every CTA navigates to a populated route; newsletter demo form validates and stores subscription; Instagram tiles link to products ("shop the look") and profile URL; footer shows demo limitations.
- [ ] **Step 2:** Implement; pass; commit.

### Task 12: Admin shell, gate and overview

**Files:** Create `assets/js/pages/admin/{gate,layout,overview}.js`, `assets/css/admin.css`; Test `tests/e2e/admin-overview.spec.js`.

**Interfaces:**
- Produces: `adminRoute(path, handler)` guarded by `sessionStorage.adminSession`; `computeStats(orders,products,customers): {totalOrders,revenueCents,pending,completed,products,lowStock,customers,recent,topProducts,salesByDay}` (pure, unit-tested in `tests/unit/stats.test.js`).

- [ ] **Step 1:** Tests: stats derived from fixtures; E2E: gate shows demo credentials + disclaimer; wrong creds rejected; sidebar collapses on mobile; creating an order via storefront changes overview numbers; cancelled orders excluded from revenue.
- [ ] **Step 2:** Implement; pass; commit.

### Task 13: Admin product management

**Files:** Create `assets/js/pages/admin/products.js`; extend `products.js` service with `saveProduct(p)`, `archiveProduct(id)`, `deleteProduct(id)`; Test `tests/e2e/admin-products.spec.js`.

**Interfaces:**
- Produces: product form (name, slug, descriptions, category, price/sale, images by URL or local file → data URL, sizes/colors matrix with per-variant stock, featured, visibility); delete is allowed only if no orders reference it, otherwise archive.

- [ ] **Step 1:** E2E: create product → visible in storefront catalog after reload; edit price → PDP updated; stock edit → variant availability; archive hides from storefront; product with orders can't be hard-deleted; old order snapshot unchanged; validation (duplicate SKU/slug, negative price).
- [ ] **Step 2:** Implement; pass; commit.

### Task 14: Admin order management

**Files:** Create `assets/js/pages/admin/orders.js`; extend `services/orders.js`; Test `tests/unit/restock.test.js`, `tests/e2e/admin-orders.spec.js`.

**Interfaces:**
- Produces: `listOrders(filter)`, `updateFulfillment(id,status)`, `updatePayment(id,status)`, `addNote(id,text)`, `cancelOrder(id)`, `returnOrder(id)` (both run in one transaction and restock exactly once via `restocked`), `ordersToCsv(orders): string` (RFC-4180 escaping, UTF-8 BOM).

- [ ] **Step 1:** Tests: cancel twice → stock restored once; cancel then return → still once; invalid transition (delivered→pending) rejected; CSV escapes commas/quotes/Greek.
- [ ] **Step 2:** E2E: find new order by reference/email, change statuses, persist after reload, notes, print view, refund simulation sets `refunded`; implement; pass; commit.

### Task 15: Admin customers and coupons

**Files:** Create `assets/js/pages/admin/{customers,coupons}.js`; Test `tests/e2e/admin-coupons.spec.js`.

**Interfaces:**
- Produces: coupon CRUD `{code,type:'percent'|'fixed',value,minSubtotalCents,expiresAt,maxUses,usedCount,active}`; customer list/profile/edit with order totals.

- [ ] **Step 1:** E2E: create coupon in admin → applies in cart with correct math; deactivate → rejected; expiry and usage limit enforced; customer search and edit persist.
- [ ] **Step 2:** Implement; pass; commit.

### Task 16: Admin content and settings

**Files:** Create `assets/js/pages/admin/{content,settings}.js`; Test `tests/e2e/admin-content-settings.spec.js`.

**Interfaces:**
- Produces: editors for banners/hero/collections/Instagram tiles/footer/newsletter and settings (store info, VAT, shipping, free threshold, COD fee, IRIS instructions, socials).

- [ ] **Step 1:** E2E: change hero title → homepage shows it after reload; change free-shipping threshold → cart indicator and quote change immediately; change COD fee → checkout total; Instagram tile edit reflected.
- [ ] **Step 2:** Implement; pass; commit.

### Task 17: Backup, import, reset

**Files:** Create `assets/js/services/backup.js`, `assets/js/pages/admin/backup.js`; Test `tests/unit/backup-validate.test.js`, `tests/e2e/backup.spec.js`.

**Interfaces:**
- Produces: `exportAll(): Promise<{schemaVersion,exportedAt,stores:{[name]:any[]}}>`; `validateImport(obj): {ok,errors[]}` (schemaVersion, known store names, array types, unique keys, referential check variants→products); `importAll(obj)` one transaction; `resetToSeed()` after confirmation.

- [ ] **Step 1:** Tests: malformed JSON, wrong version, duplicate SKU, unknown store → rejected; E2E: export → mutate → import restores; bad file leaves data intact with error message; reset requires confirm and restores seed products.
- [ ] **Step 2:** Implement; pass; commit.

### Task 18: Accessibility, responsive and resilience pass

**Files:** Modify CSS/components as needed; Test `tests/e2e/responsive.spec.js`, `tests/e2e/a11y.spec.js`, `tests/e2e/resilience.spec.js`.

- [ ] **Step 1:** Parametrized over 320/375/390/430/768/1024/1440 and the main storefront and admin routes: no horizontal overflow, header/bottom-nav/offcanvas/modal usable, tap targets ≥ 44px on mobile; no console errors or failed requests (incl. images).
- [ ] **Step 2:** Keyboard: Tab order through catalog → PDP → cart → checkout; Escape closes modals; labels/aria on forms; `prefers-reduced-motion` disables transitions; image-error fallback renders; IndexedDB-unavailable path shows error screen.
- [ ] **Step 3:** Fix findings; all suites green; commit.

### Task 19: README, full regression and handoff

**Files:** Complete `README.md`; Create `docs/VERIFICATION.md`.

- [ ] **Step 1:** README: run (`node tests/server.js` or any static server), routes, admin demo credentials, DB name and reset/export, browser-only limitations, image credits note.
- [ ] **Step 2:** Run unit + full Playwright suites on a clean profile; map results to `qa-gates.md` scenarios 1–14 as PASS/FAIL/NOT TESTED in `VERIFICATION.md`; fix failures; final whole-branch review.
- [ ] **Step 3:** Commit; produce the final handoff report in the `qa-gates.md` template.

---

## Progress Checklist

- [ ] 1 Bootstrap · [ ] 2 Pricing · [ ] 3 DB/seed · [ ] 4 Images/catalog · [ ] 5 Shell/router · [ ] 6 Catalog · [ ] 7 PDP · [ ] 8 Cart/wishlist · [ ] 9 Checkout · [ ] 10 Account · [ ] 11 Home/Instagram · [ ] 12 Admin overview · [ ] 13 Admin products · [ ] 14 Admin orders · [ ] 15 Admin customers/coupons · [ ] 16 Admin content/settings · [ ] 17 Backup/reset · [ ] 18 A11y/responsive · [ ] 19 README/handoff
