# Marias Fashion Boutique — AgoraSite demo e-shop

**Static demo, not a real payment-enabled store.** HTML5, Bootstrap 5, vanilla JavaScript and IndexedDB. Greek storefront, EUR prices, 39 curated fashion products and local WebP photography. No backend, build step, database server or production authentication.

## Open the demo on Windows

1. Extract this project into a folder (keep the folder structure).
2. **Double-click `START-DEMO.cmd`**. Node.js 22+ must be installed.
3. Open <http://127.0.0.1:4173/#/> (the script also opens it automatically).
4. Admin dashboard: <http://127.0.0.1:4173/#/admin>.

Admin **demo** credentials: **`admin@marias.demo` / `demo1234`** (they are public and provide no real security).

To stop the demo, close the black command window or press Ctrl+C. Do **not** double-click `index.html` to open it as a `file://` URL: IndexedDB, imports and fetches need HTTP. A typical static HTTP hosting account can serve the app; `START-DEMO.cmd` is only for a local Windows demonstration.

**Internet is needed for Bootstrap, Bootstrap Icons and Google Fonts loaded from CDNs.** Product photos are local. If you need a fully offline demonstration, vendor these CDN assets locally first.

## What can visitors do?

Browse and search products; filter by price, size, color and availability; select variants; use size charts; add to cart or wishlist; apply coupons; place **simulated** cash-on-delivery or IRIS orders; see order confirmations and local order history. The homepage includes a curated Instagram-style feed (not a live Instagram API connection).

## What can the demo admin do?

Manage products, images, stock, orders, order and payment statuses, customers, coupons, banners, store settings and demo data. Export/import local browser data and reset the demo from the **Admin → Backup** section (confirmation required).

## Browser storage and limitations

- Data is stored in IndexedDB named **`agorasite-fashion1-v1`**. Refreshing the page normally keeps your cart, edits and orders.
- This Marias edition retains the same browser database and automatically updates the original ÉLAN demo branding on previously seeded browsers. Your custom store name and historical order IDs are preserved.
- **Every browser/profile has a different local database.** Admin edits and orders do not synchronize between devices or other visitors; clearing site storage erases the data unless you exported a backup first.
- All purchases, payment confirmations and IRIS screens are **simulations**. No money is transferred; no emails are sent. The demo admin gate does not authenticate real users or protect private information.
- This is for presentations, **not** a production webshop. Do not collect real customer information or financial details through it.
- Product images carry individual photographer/source credits in `assets/images/credits.json` and the demo footer.

## For developers / tests

```bash
node tests/server.js           # serve on 127.0.0.1:4173
node tools/validate-seed.mjs   # validates products and image references
cd tests
npm ci                        # only for development testing
npm test                      # Node unit tests
npx playwright install chromium
npm run e2e                   # Playwright browser suite
```

`PW_WORKERS=2` (macOS/Linux) or `$env:PW_WORKERS=2` (PowerShell) reduces Playwright parallelism on busy machines. `CHROMIUM_EXECUTABLE_PATH` optionally selects a system Chromium binary for tests. Browser tests need local HTTP access. Tests are not required to *run the shop*.

Implementation specifications and the Claude Code task history live under `docs/superpowers/` and `.superpowers/sdd/`. See `docs/VERIFICATION.md` for verified results and limits.
