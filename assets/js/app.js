import { onDbError } from './db.js';
import { ensureSeeded } from './seed.js';
import { route, setNotFound, start } from './router.js';
import { focusHeading, html } from './ui.js';
import { adminRoute } from './pages/admin/gate.js';
import { renderHeader, bindBadges } from './components/header.js';
import { renderFooter, applySettings, applyFooterContent } from './components/footer.js';
import { applyBrand } from './components/brand.js';
import { freeShippingPhrase } from './services/pricing.js';
import { renderBottomNav } from './components/bottom-nav.js';
import { renderDemoStrip, hideModal } from './components/modals.js';

const app = document.getElementById('app');

// Fatal start-up problems get a Greek explanation and a retry button (never a blank page).
const STARTUP_ERRORS = {
  blocked: ['Σφάλμα βάσης δεδομένων', 'Η βάση δεδομένων είναι κλειδωμένη από άλλη καρτέλα της εφαρμογής. Κλείστε τις άλλες καρτέλες και πατήστε «Δοκιμή ξανά».'],
  'seed-fetch': ['Δεν φορτώθηκαν τα δεδομένα του καταστήματος', 'Η πρώτη φόρτωση του καταλόγου απέτυχε (πρόβλημα σύνδεσης ή διακομιστή). Ελέγξτε τη σύνδεσή σας και πατήστε «Δοκιμή ξανά».'],
  unavailable: ['Σφάλμα βάσης δεδομένων', 'Δεν είναι δυνατή η χρήση του IndexedDB στον περιηγητή σας. Ελέγξτε ότι δεν βρίσκεστε σε ιδιωτική περιήγηση και ότι η αποθήκευση δεδομένων επιτρέπεται, και πατήστε «Δοκιμή ξανά».'],
};
function showError(err) {
  const [title, text] = STARTUP_ERRORS[err && err.code] || STARTUP_ERRORS.unavailable;
  app.removeAttribute('aria-busy');
  app.innerHTML = `<section class="page startup-error" data-page="error" data-startup-error="${err && STARTUP_ERRORS[err.code] ? err.code : 'unavailable'}">
    <div class="container py-5 text-center">
      <h1 class="h3" tabindex="-1"></h1>
      <p role="alert"></p>
      <button type="button" class="btn btn-dark" data-retry><i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Δοκιμή ξανά</button>
    </div>
  </section>`;
  app.querySelector('h1').textContent = title;
  app.querySelector('p').textContent = text;
  app.querySelector('[data-retry]').addEventListener('click', () => window.location.reload());
}

onDbError(showError);

// Image-load failures anywhere (offline, deleted file, bad admin URL): components with their own fallback
// (product cards, gallery, admin thumbnails) handle the error first; any <img> still left broken is swapped
// for a neutral ÉLAN tile of the same proportions instead of the browser's broken-image icon.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || 'noFallback' in img.dataset) return;
  setTimeout(() => { // after the element's own error listeners (which run later in this same dispatch)
    if (!img.isConnected || img.style.visibility === 'hidden' || (img.complete && img.naturalWidth > 0)) return;
    const tile = document.createElement('span');
    tile.className = `img-fallback ${img.className}`.trim();
    const w = Number(img.getAttribute('width')) || 4;
    const h = Number(img.getAttribute('height')) || 5;
    tile.style.aspectRatio = `${w} / ${h}`;
    const alt = img.getAttribute('alt') || '';
    if (alt) { tile.setAttribute('role', 'img'); tile.setAttribute('aria-label', alt); } else tile.setAttribute('aria-hidden', 'true');
    tile.innerHTML = '<span aria-hidden="true">É</span>';
    img.replaceWith(tile);
  }, 0);
}, true);

// Lazy page modules: each exports `default async function render(ctx)`.
const lazy = (load) => async (ctx) => (await load()).default(ctx);

route('/', lazy(() => import('./pages/home.js')));
route('/catalog', lazy(() => import('./pages/catalog.js')));
route('/catalog/:categoryId', lazy(() => import('./pages/catalog.js')));
route('/product/:slug', lazy(() => import('./pages/product.js')));
route('/cart', lazy(() => import('./pages/cart.js')));
route('/checkout', lazy(() => import('./pages/checkout.js')));
route('/order/:id', lazy(() => import('./pages/confirmation.js')));
route('/account/orders/:id', lazy(() => import('./pages/account.js')));
route('/account/*', lazy(() => import('./pages/account.js')));
// Admin (demo access gate: see pages/admin/gate.js). Unknown admin paths render the admin «not found» page.
const adminLayoutModule = () => import('./pages/admin/layout.js');
adminRoute('/admin', lazy(() => import('./pages/admin/overview.js')));
adminRoute('/admin/products', lazy(() => import('./pages/admin/products.js')));
adminRoute('/admin/products/new', lazy(() => import('./pages/admin/product-editor.js')));
adminRoute('/admin/products/:id', lazy(() => import('./pages/admin/product-editor.js')));
adminRoute('/admin/orders', lazy(() => import('./pages/admin/orders.js')));
adminRoute('/admin/orders/:id', lazy(() => import('./pages/admin/orders-detail.js')));
adminRoute('/admin/customers', lazy(() => import('./pages/admin/customers.js')));
adminRoute('/admin/customers/:id', lazy(() => import('./pages/admin/customer-detail.js')));
adminRoute('/admin/promotions', lazy(() => import('./pages/admin/coupons.js')));
adminRoute('/admin/content', lazy(() => import('./pages/admin/content.js')));
adminRoute('/admin/settings', lazy(() => import('./pages/admin/settings.js')));
adminRoute('/admin/backup', lazy(() => import('./pages/admin/backup.js')));
adminRoute('/admin/*', async (ctx) => (await adminLayoutModule()).adminNotFound(ctx));
setNotFound(lazy(() => import('./pages/not-found.js')));

const PAGE_ERROR = () => html(`<section class="page" data-page="error" data-route="error">
  <div class="container-xl"><div class="placeholder-panel">
    <span class="eyebrow">Κάτι πήγε στραβά</span>
    <h1 class="display-title">Η σελίδα δεν φορτώθηκε</h1>
    <p class="lead-text">Παρουσιάστηκε απρόσμενο σφάλμα. Δοκιμάστε ξανά ή επιστρέψτε στην αρχική.</p>
    <div class="d-flex justify-content-center gap-2 mt-4"><a class="btn btn-dark" href="#/">Αρχική</a></div>
  </div></div>
</section>`);

function mountShell() {
  const body = document.body;
  const skip = html('<a class="skip-link" href="#app">Μετάβαση στο περιεχόμενο</a>');
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    app.setAttribute('tabindex', '-1');
    app.focus();
  });
  const header = renderHeader();
  const footer = renderFooter();
  const bottom = renderBottomNav({ onSearch: () => header.openSearch() });
  body.prepend(skip, renderDemoStrip(), header.header); // skip link is the first focusable element
  app.after(footer, bottom.nav);
  body.append(header.offcanvas);
  bindBadges({
    cart: () => import('./services/cart.js').then((m) => m.cartCount()),
    wishlist: () => import('./services/wishlist.js').then((m) => m.listActive().then((ids) => ids.length)),
  });
  return { header, bottom, footer };
}

function closeOpenModals() {
  // Includes dialogs still in their show transition (Bootstrap would ignore a plain hide() then).
  document.querySelectorAll('.modal').forEach((m) => hideModal(m));
  // Page-owned offcanvas (the admin sidebar on mobile) is replaced with the page: close it first.
  document.querySelectorAll('#app .offcanvas.show, #app .offcanvas.showing').forEach((o) => window.bootstrap.Offcanvas.getInstance(o)?.hide());
}

(async () => {
  // Shell failures are programming errors, not IndexedDB problems: let them surface.
  const shell = mountShell();
  try {
    await ensureSeeded();
  } catch (e) {
    showError(e);
    return;
  }
  let storeName = 'ÉLAN Fashion Boutique';
  // Title = «<page h1> · <store name>»; also re-applied when the settings arrive AFTER the first render
  // (a fast first paint used to keep the default store name in the tab title).
  const setTitle = () => {
    const h1 = app.querySelector('h1');
    document.title = h1 && h1.textContent && !app.querySelector('[data-route="/"]') ? `${h1.textContent.trim()} · ${storeName}` : storeName;
  };
  const refreshFooter = async () => {
    try {
      const [{ getSettings }, content] = await Promise.all([import('./services/settings.js'), import('./services/content.js')]);
      const [s, footerContent] = await Promise.all([getSettings(), content.getContent('footer')]);
      applySettings(shell.footer, s);
      applyBrand(shell.header.header, s);
      applyBrand(shell.header.offcanvas, s);
      const note = shell.header.offcanvas.querySelector('.offcanvas-note');
      if (note && Number.isFinite(s.freeShippingThresholdCents)) {
        note.textContent = freeShippingPhrase(s.freeShippingThresholdCents);
      }
      storeName = s.storeName || storeName;
      if (app.getAttribute('aria-busy') !== 'true') setTitle();
      applyFooterContent(shell.footer, footerContent, (t) => content.fillTokens(t, s));
    } catch (e) { /* defaults already shown */ }
  };
  refreshFooter();
  window.addEventListener('content:changed', (e) => { if (!e.detail?.key || e.detail.key === 'footer') refreshFooter(); });
  window.addEventListener('settings:changed', refreshFooter);
  await start({
    outlet: app,
    beforeRender({ path, query, layout }) {
      document.body.dataset.layout = layout;
      shell.header.closeOverlays(() => {
        // Bootstrap refocused the menu button on hide; return focus to the page.
        if (app.getAttribute('aria-busy') !== 'true') focusHeading(app);
      });
      closeOpenModals();
      shell.header.setActive(path);
      shell.header.syncSearch(query);
      shell.bottom.setActive(path);
    },
    afterRender({ isFirst }) {
      setTitle();
      if (!isFirst) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        focusHeading(app);
      }
    },
    renderError(err) {
      console.warn('Route render failed', err);
      return PAGE_ERROR();
    },
  });
})();
