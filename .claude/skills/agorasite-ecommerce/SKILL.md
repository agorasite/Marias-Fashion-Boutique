---
name: agorasite-ecommerce
description: Build, extend, audit, and demonstrate AgoraSite static demo e-shops using HTML, Bootstrap 5, vanilla JavaScript, and IndexedDB. Use for AgoraSite storefronts, niche-specific shop demos (fashion, beauty, electronics, homeware), product catalogs, variants, cart, one-page simulated checkout, browser-local orders, and admin dashboards. Apply when creating or improving browser-only e-commerce portfolio demos, not real production shops.
---

# AgoraSite E-commerce Demo

Build convincing, functional **browser-only** e-commerce demonstrations, reusable across retail niches. Treat **demo** as an architectural boundary, not an excuse for dead UI.

## 1. Establish the brief

Inspect the current repository before editing. Preserve existing work. Determine niche, brand/look, language, currency, initial product count, expected views, and any domain-specific options. Prefer explicit user requirements. If information is missing, choose sensible defaults and state them briefly; ask only about material blockers.

Defaults when unspecified: Greek storefront, EUR, mobile-first premium-but-minimal Bootstrap UI, 24+ diverse products, 320px-1440px coverage, static browser-only app, local admin dashboard, simulated payment methods. Adapt to the niche; do not reuse fashion attributes for electronics or furniture.

Read `references/niche-blueprints.md` when tailoring the catalog or UI to a specific niche.

## 2. Apply the stack and its boundaries

- Use **HTML5, CSS3, Bootstrap 5.3+, ES modules / vanilla JavaScript**, and **IndexedDB** for structured data.
- Use LocalStorage only for non-sensitive UI preferences such as theme or dismissal state.
- Run from a static HTTP server; do not require PHP, Node backend, React, Vue, database server, or build tooling at runtime.
- Modularize database access, business rules, components, pages, admin, and router. Prefer hash routing to avoid static host rewrite requirements.
- Store monetary values as **integer cents**, not floating-point EUR; centralize formatting, tax rules, and totals.
- Give each demo its **own IndexedDB database name** to prevent collisions with other AgoraSite demos.
- Do not add real payment, shipping, login, mail, Meta API, or cross-browser promises unless the user explicitly requests a different (non-demo) architecture. This skill is only for demos.

Refer to `references/data-contract.md` before changing storage, prices, checkout, or inventory.

## 3. Plan and implement complete journeys

Use Superpowers brainstorming, planning, test-driven-development, and verification workflows when available, **without duplicating their instructions**.

Prioritize vertical slices rather than isolated polished screens:

1. Initialize schema and seed data once.
2. Render responsive homepage, catalog, search/filter/sort, detail gallery, and valid product options.
3. Add persistent wishlist and cart with quantity / availability checks.
4. Implement one-page **simulated** checkout, coupon math, shipping, COD, demo IRIS, and order confirmation.
5. Implement real browser-local admin CRUD, order statuses, promotions, content, and settings.
6. Add realistic content, storefront polish, accessibility, and browser automation tests.

Every visible CTA must work or be explicitly labeled as a demo simulation. Admin data must feed storefront views, not separate mock arrays. For niche-specific attribute selectors, create canonical variations (size/color for fashion; capacity/finish for gadgets; dimensions/finish for furniture).

## 4. Data rules

- Seed only on first launch or explicit user-confirmed reset; never reseed on refresh.
- Build versioned IndexedDB migrations; handle unavailable storage, failed transactions, and quota errors with clear UI feedback.
- Preserve unique product and variant identifiers (SKU per variant). Track stock per variant.
- In a *single suitable readwrite transaction*, validate stock, create the order snapshot, decrement stock, update coupon usage as applicable, and update the cart. Avoid `await` on unrelated asynchronous work while an IndexedDB transaction is open.
- Reject out-of-stock variants, negative totals, invalid promo codes, and quantities above availability.
- Make refunds/cancellations and inventory restoration idempotent, avoiding duplicate restocks.
- Order snapshots preserve purchased names, variants, unit prices, taxes, discounts, and shipping independent of future product edits.
- Support JSON export/import with schema checks, safe failure, and explicit destructive reset confirmation.
- Keep quote/order math in a shared pure service so catalog, cart, checkout, order summary, and admin agree.

## 5. Honest demo experience and privacy

- Display a discreet yet clear **Demo Store** indicator in storefront and admin.
- Mark IRIS and COD orders as **simulations**. COD is only a recorded demo order; IRIS must never imply payment occurred. Distinguish payment status from fulfillment status.
- Never request real card numbers, bank credentials, or private API tokens. Avoid persisting real visitor identity if sample data will do; label the local nature of any demo customer information.
- State: data is only in the current browser/profile, does not synchronize, and may disappear if site data is cleared.
- Label frontend admin access as demonstration only, **not actual authentication** or authorization.
- Instagram: curated demo feed with optional official supported embeds; never fake a live API connection or scrape social platforms.
- Do not silently claim production readiness, security, real transactions, or real integrations.

## 6. Quality gates and handoff

Read `references/qa-gates.md` before claiming done. For each feature: test navigation, operations, persistence after reload, price and stock integrity, error states, and mobile rendering. Use Playwright if available; otherwise provide exact manual test steps and report gaps honestly.

For product seeds following the included schema, run:

`python <installed-skill-directory>/scripts/validate_seed.py <project-path-to-products.json>`

Finish with a concise handoff: what works, how to launch, admin route, demo checkout methods, tests actually run, limitations, and unresolved items. Do not mark untested actions as verified.

## Quick project bootstrap

When starting a new demo, first create a short implementation plan and optional `store-brief.json` using `assets/store-brief.template.json` as an example. The template is **not** a runtime dependency; adapt defaults to the user's current brief.
