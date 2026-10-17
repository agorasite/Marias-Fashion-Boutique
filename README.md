# ÉLAN Fashion Boutique

Static, browser-only demo e-shop (HTML, Bootstrap 5, vanilla JS). No build step.

## Tests

    cd tests
    npm install
    npx playwright install chromium
    npm test        # unit
    npm run e2e     # Playwright (starts node server.js on 127.0.0.1:4173)

Notes for e2e runs:

- 6 workers by default; `PW_WORKERS=12 npm run e2e` raises it (no retries are configured — a failure is a bug).
- Playwright REUSES a server already listening on 127.0.0.1:4173. Kill any stale one first (an old
  `node server.js` from an earlier day serves stale code and degrades under load):
  PowerShell `Get-NetTCPConnection -LocalPort 4173 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`.
- Calendar-dependent specs can be run on another date: `ELAN_TEST_DATE=2026-12-31 npx playwright test e2e/admin-orders.spec.js`
  (see `tests/e2e/support/test.js`).
- Avoid running other heavy processes during a full run: socket-buffer exhaustion on Windows shows up as
  `net::ERR_NO_BUFFER_SPACE`.
