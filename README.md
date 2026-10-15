# ÉLAN Fashion Boutique

Static, browser-only demo e-shop (HTML, Bootstrap 5, vanilla JS). No build step.

## Tests

    cd tests
    npm install
    npx playwright install chromium
    npm test        # unit
    npm run e2e     # Playwright (starts node server.js on 127.0.0.1:4173)
