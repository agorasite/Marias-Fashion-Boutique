# Demo e-shop acceptance and verification

Use when reviewing or claiming implementation is complete. Record whether each result is **PASS**, **FAIL**, or **NOT TESTED**. Never convert planned tests into claimed passes.

## Critical scenarios

1. Clean profile starts with coherent seed data; refresh does not alter products, cart, orders, or edits.
2. Catalog search, category, sort, multi-filter combinations, and empty results work on stored records.
3. Product variations change availability and stock; out-of-stock options cannot be added.
4. Cart add/remove/quantity changes survive reload; checkout rejects quantities above available stock.
5. Checkout requires valid contact/shipping inputs; shipping, discount and COD surcharges update correct quote.
6. COD order records `pending` payment, not paid; IRIS path clearly simulates and never claims bank completion.
7. Successful checkout creates one order, decrements exact SKU quantities once, and removes purchased cart lines.
8. Double-click or repeated checkout submission does not create duplicate purchases.
9. Admin can locate the order; changing statuses persists; cancellation/return restock is not double-applied.
10. Admin product CRUD / price / images / stock / banners / coupon changes appear in storefront after reload.
11. Historical order snapshots do not change after product name/price edits or product archiving.
12. JSON import validation fails safely; export and restore work; reset is confirmed and restores defaults.
13. Admin metrics derive from stored orders, not hardcoded counters.
14. Browser-local storage failure and empty-state UX are understandable; no console errors on normal paths.

## UI and browser matrix

- Test viewport widths: 320, 375, 390, 430, 768, 1024, and 1440 pixels.
- Verify tap target size, menu/offcanvas open/close, modals, mobile cart indicator, checkout input keyboards, sticky elements, no horizontal overflow, text and pricing clarity.
- Keyboard test: Tab through interactive elements, Escape dismisses modal, focus remains sensible after route changes.
- Test reduced-motion preference, image loading failures, empty store/cart/wishlist, browser back/forward routing.
- Run automated Playwright tests when available. If Playwright is unavailable, execute manual tests and say so.

## Handoff template

```
Implemented: [features truly functioning]
To run: [local static server instructions]
Demo access: [storefront URL/hash and admin path]
Data persistence: [IndexedDB name and reset/export entrypoints]
Verified: [commands, viewport widths, test counts/results]
Unverified / limitations: [concrete limitations and missing items]
```

## Guardrails for external platforms

- No real banking transfers, payment processor integration, live email dispatch, identity verification, or remote multiuser collaboration.
- No scraping of Instagram or fake API responses presented as real data.
- Never claim genuine security from a browser-only admin login or hide that all visitors have their own local database.
