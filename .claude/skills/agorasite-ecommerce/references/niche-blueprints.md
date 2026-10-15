# Niche blueprints and UX decisions

Use when translating a store brief into a demo product dataset, product options, merchandising, filters, and detail views. Share underlying services across niches; only UI copy, attributes, visuals, and rules should change.

## Universal storefront

- Mobile-first nav, sticky cart feedback, responsive grid, localized search, category navigation, price and stock filters, favorites, cart, one-page simulated checkout, order history, and admin panel.
- Functional empty states, skeleton/loading states, keyboard-accessible modals, accessible form validation, browser-local persistence, media aspect-ratio consistency.
- Use product-specific real-looking copy and non-duplicated licensed/demo-safe photography with graceful image fallbacks. Never invent image licenses.
- Greek market default: Greek UI, EUR with locale `el-GR`, Greek address labels, configurable courier and store-pickup delivery.

## Fashion / shoes

- Size and color swatches; valid size/color combinations; in-stock variation indicator.
- Chart modal for clothing, shoe size system, material and care info, multiple gallery images, Instagram-inspired curated feed.
- Collections: new arrivals, seasonal picks, best sellers, accessories; sophisticated editorial typography and restrained spacing.
- Suggested fashion QA: changing color must update available sizes; deleting variants must not strand cart orders.

## Beauty / cosmetics

- Options: shade, volume, scent; display shade codes and ingredient/usage copy.
- Filters: skin type or concern, finish, price, category. Do not make medical claims about cosmetics.
- Sample labels: cruelty-free only when sourced in demo brief, otherwise omit.

## Electronics

- Options: capacity, finish, connector/model; compatibility and spec comparisons.
- Filters: brand, specs, storage, price, availability. Technical specifications must be internally consistent.
- Surface warranty/returns as demo policy copy, not invented legal guarantees.

## Furniture / home

- Options: finish, fabric, dimensions; material, measurements, estimated delivery.
- Filters: size, color, material, room, price, stock. Display measurements clearly and consistently.

## Admin common minimum

Products and variants CRUD, category/content/banner edits, settings, coupons, orders, customer demo records, status changes, export/import/reset, low-stock alerts, real derived dashboard metrics. All forms require save/cancel feedback; reload must keep changes.

## Instagram boundary

Use manually configured profile link and curated tiles (with source/rights attribution as appropriate). Optional compliant public embeds may be blocked by privacy or origin policies. Provide an attractive fallback; label it as curated inspiration rather than a live API feed.
