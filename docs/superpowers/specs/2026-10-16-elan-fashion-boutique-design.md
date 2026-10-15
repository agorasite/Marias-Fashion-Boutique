# ÉLAN Fashion Boutique — Design Document

Date: 2026-10-16
Status: Draft for approval
Source brief: `initialprmpt.txt` (authoritative for feature scope; this document records decisions, constraints and verification)

## 1. Intent

AgoraSite needs a portfolio demo that a prospective fashion-retail client can open and use as if it were a real shop: browse, filter, choose a size/color, buy (simulated), then see the order in an admin panel and manage the shop. It runs entirely in the visitor's browser (static files + IndexedDB). It must be convincing in function first, then in look and feel, and honest that it is a demo.

Success = the 12 visitor steps and 10 admin steps of brief §16 all work, persist across reload, and are covered by automated browser tests that actually run and pass.

## 2. Goals / non-goals / anti-goals

**Goals**
- Complete storefront (home, catalog, product, cart, one-page checkout, account) and complete admin (overview, products, orders, customers, promotions, content, settings, backup/reset), mobile-first, Greek UI, EUR.
- Realistic seed: ≥36 products with per-variant stock, customers, coupons, reviews, historical orders.
- One shared pricing/quote service and transactional checkout so every screen agrees on totals and stock.
- Automated Playwright tests for the critical scenarios in `qa-gates.md` (§8).

**Non-goals**
- Real payments, real auth, email, shipping integrations, live Instagram API, multi-user sync, SEO/server rendering, i18n beyond Greek, PWA/offline caching.

**Anti-goals (a failure even if it "works")**
- Dead buttons, mock arrays separate from IndexedDB, identical/placeholder/irrelevant product images, generic unstyled Bootstrap look, any wording implying real payment/security/live Instagram, reseeding that overwrites user changes.

## 3. Constraints (decided by the user)

- HTML5, CSS3, Bootstrap 5.3+, Bootstrap Icons, vanilla JS ES modules, IndexedDB; LocalStorage for UI prefs only. No framework, no backend, no runtime build step.
- Served by any static HTTP server; hash routing (`#/…`); admin at `#/admin`.
- Customer-facing text in natural Greek; EUR; Greek VAT configurable.
- Images: Unsplash and Pexels only, license-checked, downloaded locally, converted to WebP, attributed in `assets/images/credits.json`; each product's photos must actually show that kind of item, without needless repetition; quality and mobile rendering checked before inclusion.
- Playwright installed as a **devDependency under `tests/` only**; nothing in the shop imports it or needs Node at runtime.
- Real automated tests are required; "verified" may only be claimed for tests that ran.

## 4. Architecture

Directory layout follows brief §13, with additions:

```
index.html
assets/css/{theme,storefront,admin}.css
assets/js/{app,router,db,seed}.js
assets/js/services/{products,cart,pricing,checkout,orders,customers,coupons,settings,content,backup}.js
assets/js/components/…   assets/js/pages/…   assets/js/pages/admin/…
assets/images/…          assets/images/credits.json
data/{products,catalog-meta}.json
tests/ (package.json, playwright.config, specs, helpers)
tools/ (image fetch/convert + seed validation scripts, Node)
docs/superpowers/{specs,plans}/
README.md
```

- **Data layer** (`db.js`): single IndexedDB database `agorasite-fashion1-v1`, versioned `onupgradeneeded` migrations, small promise wrapper that keeps transactions alive (no foreign awaits inside a transaction). Stores per `data-contract.md`: `categories, products, variants(sku), carts, wishlists, customers, orders, coupons, reviews, settings, content`. Order items live inside the order record as immutable snapshots (also satisfies "orders and order items").
- **Services only**: pages/components never touch IndexedDB directly; this is the seam where a real backend could replace the storage later.
- **Pricing** (`pricing.js`): one pure `quote(cartLines, coupon, shippingMethod, paymentMethod, settings)` returning integer-cent subtotal, discount, shipping, COD fee, VAT breakdown, total. Used by cart, checkout, confirmation, admin.
- **Checkout**: validate form → quote → one readwrite transaction over carts/variants/coupons/orders: recheck stock and coupon, write order snapshot, decrement stock, increment coupon use, clear purchased lines. Submit button locked against double submit; order ID collision-safe.
- **Orders**: `paymentStatus` (`pending | simulated-paid | refunded`) is separate from `fulfillmentStatus` (`pending | confirmed | processing | shipped | delivered | cancelled | returned`). Restock on cancel/return guarded by a `restocked` flag so it applies once.
- **Seed**: runs only when the DB is empty (or on confirmed reset). Startup never overwrites existing records.
- **Backup**: JSON export with schema version + store names; import validates schema and ID uniqueness in a staging step and only then replaces data in one transaction; failure leaves the DB untouched. Reset requires explicit confirmation.
- **Router**: hash routes, back/forward safe, focus moved to main heading on route change.

## 5. Design decisions made by the builder (calls to confirm)

These were not specified by the user and are my choices:

1. **Admin gate**: a simple frontend gate with prefilled demo credentials shown on the screen and the label "demo access — not real authentication". Session flag in `sessionStorage`.
2. **Customer "account"**: no login. A local profile is created/updated at checkout or in the account page; order history is shown for the local customer(s) in this browser, with a "stored only in this browser" notice.
3. **VAT model**: prices are VAT-inclusive at 24% (configurable); the quote shows the included-VAT breakdown.
4. **Shipping defaults**: courier €3.90, pickup €0, free courier above €60 (all configurable); COD surcharge €2.00 (configurable).
5. **Seed coupons** (examples): `WELCOME10` (10%, min €30), `ELAN5` (€5 fixed, min €40), one expired and one inactive coupon for testing.
6. **Product images**: 2–4 WebP images per product (≈1200px long edge, plus a smaller ≈480px for grids), product `alt` text in Greek; broken-image fallback is a neutral branded tile.
7. **Instagram**: curated tiles drawn from the same licensed image set, linked to products ("shop the look"); admin can edit the profile URL and tiles; optional public post URL field is stored for future embeds but rendered as a link, not scraped.
8. **Size chart**: static per-category tables (clothing, shoes) in a modal.
9. **Pagination**: "load more" in the catalog.
10. **Demo-store indicator**: slim top strip in the storefront and a badge in the admin header, linking to a "about this demo" modal listing the limitations of brief §15.

## 6. Image sourcing plan

- A Node tool under `tools/` takes a curated manifest (product slot → source page URL, photographer, license page) and downloads, resizes and converts via `cwebp` (available locally) into `assets/images/`.
- Candidates are found by searching Unsplash/Pexels, and each is reviewed (relevance to the item, quality, framing at ~390px width) before being added to the manifest. Licenses are checked against each site's current license page; `credits.json` stores photographer, source URL, license name, retrieval date.
- Known risk: some categories (e.g. men's jeans, boots, bags) have fewer good free photos. **Approved by the user (2026-10-16): ≥36 products AND accurate, high-quality images are both mandatory.** If a product cannot get a genuinely matching image, the product selection is adjusted (a different item in that category is chosen to fit what is legally available), never an unrelated photo and never fewer than 36.
- Image downloading requires network access at build time only.

## 7. Delivery slices

1. **Foundation**: structure, theme, router, db + migrations, settings, seed loader, pricing service (pure, unit-tested), image pipeline + curated catalog.
2. **Storefront browse**: header/footer/bottom nav, home, catalog with filters/sort/search/load-more, quick view, product page with variants, size chart, gallery/lightbox, wishlist, reviews.
3. **Cart & checkout**: persistent cart, coupons, shipping, COD/IRIS simulation, transactional order creation, confirmation + print view, account/order history.
4. **Admin**: gate, overview metrics, product CRUD + variants/stock, orders (statuses, notes, cancel/return, CSV, print), customers, coupons, content, settings, backup/restore/reset.
5. **Polish & verification**: accessibility pass, reduced motion, error/empty states, viewport matrix, README, handoff.

Each slice ends with its Playwright tests passing before the next begins.

## 8. Verification

- **Unit tests** (Node built-in test runner) for pricing/quote, coupon validation, restock idempotency logic, import schema validation.
- **Playwright** end-to-end specs covering `qa-gates.md` critical scenarios 1–14: seed stability on reload, catalog filters, variant stock, cart persistence and stock limits, checkout validation, COD and IRIS paths, single order/one decrement, double-submit, admin status + restock once, admin CRUD visible in storefront, snapshot immutability, import/export/reset, derived metrics, no console errors on main paths.
- **Viewport matrix** specs at 320/375/390/430/768/1024/1440 assert no horizontal overflow and working nav/offcanvas/modals; keyboard (Tab/Escape) and reduced-motion checks.
- **Seed validation** script in Node (the skill's Python validator can't run here: no Python installed) checks product/variant structure, unique SKUs, image files exist, credits entry per image.
- Final handoff uses the `qa-gates.md` template; any scenario not run is reported NOT TESTED.

## 9. Left to the builder

Visual details (typography pairing, spacing, hero composition), exact product names/descriptions/prices within realistic Greek retail ranges, CSS architecture, component granularity, test file organization, microcopy.

## 10a. Resolved after builder check

- **Referenced contracts**: `data-contract.md` (store schemas, quote/checkout/restock rules), `qa-gates.md` (scenarios 1–14, viewport matrix, handoff template) and `niche-blueprints.md` live in `.claude/skills/agorasite-ecommerce/references/` and are binding for the plan. The skill's `validate_seed.py` is Python and cannot run here; its checks are re-implemented in Node.
- **Environment**: Node 22, `cwebp`, `curl` and network access to Unsplash were confirmed available. Playwright and its browsers will be installed as a devDependency in `tests/` (user approved).
- **Test server** (builder's call): a tiny static server written with Node's built-in `http` module in `tests/`, no extra dependency; Playwright `webServer` starts it on a fixed port.
- **Identifiers** (builder's call): slugs, SKUs and IDs are Latin transliterations/ASCII; display names and copy are Greek.
- **Category tree** (builder's call): top level Γυναικεία, Ανδρικά, Παπούτσια, Αξεσουάρ; subcategories include Φορέματα, Μπουφάν, Πουκάμισα, Τζιν, Sneakers, Μπότες, Τσάντες, Αξεσουάρ. The homepage sections map to these.
- **Customers** (builder's call): each distinct checkout email creates/updates a local customer; the account page works with the customer last used in this browser and offers switching between local customers.
- **Image budget**: the image count includes hero, banners and Instagram tiles, not only product photos.

## 10. Risks

- Image supply for niche categories (see §6).
- IndexedDB transaction lifetime bugs → mitigated by a single wrapper and checkout concurrency tests.
- Scope size (~40 screens/flows) → mitigated by slices with tests gating each.
- Unsplash/Pexels license terms can change; recorded retrieval date in `credits.json`.
