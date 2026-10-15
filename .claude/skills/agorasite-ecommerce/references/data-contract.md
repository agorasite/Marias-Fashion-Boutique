# IndexedDB and pricing contract

Read this reference when building storage services, inventory, cart, pricing, checkout, returns, admin changes, backup or import.

## Canonical initial data model

Use a database name unique to the demo, e.g. `agorasite-fashion1-v1`.

Suggested object stores:

| Store | Primary key | Notes |
| --- | --- | --- |
| `categories` | `id` | nested `parentId` optional |
| `products` | `id` | stable product identity, description, priceCents, images, active |
| `variants` | `sku` | `productId`, option values, stock integer |
| `carts` | `id` | local session/customer cart, line items referencing SKU |
| `wishlists` | `id` | product or variant IDs |
| `customers` | `id` | demo-only local profile |
| `orders` | `id` | line-item snapshots, sums, statuses, timestamps |
| `coupons` | `code` | rules, valid period, limits, usage count |
| `reviews` | `id` | demo content or browser-local additions |
| `settings` | `key` | shipping, tax regime, branding, links |
| `content` | `key` | banners, featured collections, social feed |

Do not needlessly change an existing valid project schema. Record migrations and keep service-level contracts stable.

## Example product shape in the seed file

The bundled validator accepts `{ "products": [ ... ] }` or `[ ... ]` with product records like:

```json
{
  "id": "dress-001",
  "name": "Midi φόρεμα",
  "categoryId": "dresses",
  "priceCents": 6900,
  "images": ["assets/images/dress-001.webp"],
  "variants": [
    {"sku": "dress-001-s-black", "size": "S", "color": "Black", "stock": 4}
  ]
}
```

If the app has separate `variants` store, transform the seed entries into that store on first initialization. The validator checks seed structure, not live IndexedDB.

## Transactional checkout rules

1. Produce a deterministic price quote (integer cents) and validate form inputs before transaction.
2. In one `readwrite` transaction covering required stores, re-read cart lines, variants, and coupon state.
3. Recheck stock and discount eligibility at commit time.
4. Save immutable order line snapshots and totals; decrement relevant stock; increment coupon use; clear purchased cart lines.
5. On any failure, abort all changes. Prevent double-submit and duplicate order IDs.

Do not use network calls or arbitrary async timers while an IndexedDB transaction is active. If native IndexedDB APIs are used, remember an open transaction may auto-commit when no request is pending; carefully chain requests or use a well-tested wrapper that preserves transaction lifetime.

## Prices, shipping, VAT and coupons

- Use integer cents for all money. Round to cents deliberately.
- Define if catalog prices are VAT-inclusive. For Greece demos, default to configurable VAT-inclusive prices; do not hardcode VAT globally for every category.
- For included VAT, `taxIncludedCents = grossCents - round(grossCents/(1+rate))` is an illustrative breakdown; define discount allocation and rounding consistently.
- Compute subtotal, eligible discount, shipment, COD fees, taxes, and grand total through one pure quote function.
- Validate coupon expiration, max uses, min spend, compatible categories, and stacking rules.
- Never let discounts make payable amount negative.
- Display grand total consistently on cart, checkout, confirmation, and admin.

## Persistence and migrations

- Initialize once; version upgrades with `onupgradeneeded` and idempotent migration strategy.
- Explicit reset must confirm it will erase local demo data.
- Import must validate incoming JSON against schema, check ID uniqueness, and reject invalid data without corrupting the existing database.
- Export should include schema version and store name metadata; don't promise it is a cloud backup.
- Detect blocked upgrades and report how to close other tabs if necessary.
- Prevent stale cart items from referencing deleted/unavailable SKUs without user feedback.

## Admin data consistency

Admin CRUD must read/write the same IndexedDB records the storefront consumes. Re-render or invalidate derived client-side views after writes. Soft-delete/archive products tied to historical orders; do not mutate historical snapshots. Distinguish `paymentStatus` (unpaid / simulated-paid / refunded) from `fulfillmentStatus` (pending / processing / shipped / delivered / cancelled / returned).
