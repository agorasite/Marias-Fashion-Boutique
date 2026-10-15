import { onDbError } from './db.js';
import { ensureSeeded } from './seed.js';
import { route, setNotFound, start } from './router.js';
import { focusHeading, html, placeholderPage } from './ui.js';
import { renderHeader, bindBadges } from './components/header.js';
import { renderFooter, applySettings } from './components/footer.js';
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
route('/admin/*', async () => placeholderPage({
  route: '/admin',
  title: 'Διαχείριση καταστήματος',
  text: 'Ο πίνακας διαχείρισης (παραγγελίες, προϊόντα, πελάτες, προωθήσεις, περιεχόμενο) ετοιμάζεται.',
  links: [{ href: '#/', label: 'Επιστροφή στο κατάστημα', primary: true }],
}));
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
  // Badge counts: add loaders here once services/cart.js and services/wishlist.js exist,
  // e.g. bindBadges({ cart: async () => (await import('./services/cart.js')).getCartCount() }).
  bindBadges();
  return { header, bottom, footer };
}

function closeOpenModals() {
  document.querySelectorAll('.modal.show').forEach((m) => window.bootstrap.Modal.getInstance(m)?.hide());
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
  import('./services/settings.js')
    .then((m) => m.getSettings())
    .then((s) => applySettings(shell.footer, s))
    .catch(() => { /* defaults already shown */ });
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
