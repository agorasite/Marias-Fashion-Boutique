import { onDbError } from './db.js';
import { ensureSeeded } from './seed.js';
import { route, setNotFound, start } from './router.js';
import { focusHeading, html } from './ui.js';
import { adminRoute } from './pages/admin/gate.js';
import { renderHeader, bindBadges } from './components/header.js';
import { renderFooter, applySettings, applyFooterContent } from './components/footer.js';
import { renderBottomNav } from './components/bottom-nav.js';
import { renderDemoStrip } from './components/modals.js';

const app = document.getElementById('app');

function showError(err) {
  const blocked = err && err.code === 'blocked';
  app.innerHTML = `<div class="container py-5 text-center">
    <h1 class="h3">Σφάλμα βάσης δεδομένων</h1>
    <p>${blocked
      ? 'Η βάση δεδομένων είναι κλειδωμένη. Κλείστε τις άλλες καρτέλες της εφαρμογής και ανανεώστε τη σελίδα.'
      : 'Δεν είναι δυνατή η χρήση του IndexedDB στον περιηγητή σας. Ελέγξτε ότι δεν βρίσκεστε σε ιδιωτική περιήγηση και ανανεώστε τη σελίδα.'}</p>
  </div>`;
}

onDbError(showError);

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
// Admin (demo access gate: see pages/admin/gate.js). Sections of later tasks are «Σύντομα διαθέσιμο»
// placeholders; those tasks replace them by calling adminRoute() with the same path.
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
const ADMIN_SOON = [
  ['/admin/content', 'content', 'Περιεχόμενο', 'Αρχική σελίδα, banners, συλλογές και Instagram.'],
  ['/admin/settings', 'settings', 'Ρυθμίσεις', 'Στοιχεία καταστήματος, αποστολή, ΦΠΑ και πληρωμές.'],
  ['/admin/backup', 'backup', 'Αντίγραφα', 'Εξαγωγή, εισαγωγή και επαναφορά των τοπικών δεδομένων.'],
];
for (const [path, active, title, text] of ADMIN_SOON) {
  adminRoute(path, async () => (await adminLayoutModule()).adminPlaceholder({ active, title, route: path, text }));
}
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
  document.querySelectorAll('.modal.show').forEach((m) => window.bootstrap.Modal.getInstance(m)?.hide());
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
  const refreshFooter = async () => {
    try {
      const [{ getSettings }, content] = await Promise.all([import('./services/settings.js'), import('./services/content.js')]);
      const [s, footerContent] = await Promise.all([getSettings(), content.getContent('footer')]);
      applySettings(shell.footer, s);
      applyFooterContent(shell.footer, footerContent, (t) => content.fillTokens(t, s));
    } catch (e) { /* defaults already shown */ }
  };
  refreshFooter();
  window.addEventListener('content:changed', (e) => { if (e.detail?.key === 'footer') refreshFooter(); });
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
      const h1 = app.querySelector('h1');
      document.title = h1 && h1.textContent && !app.querySelector('[data-route="/"]')
        ? `${h1.textContent.trim()} · ÉLAN Fashion Boutique`
        : 'ÉLAN Fashion Boutique';
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
