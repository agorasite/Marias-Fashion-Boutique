// Demo-only admin access gate. THIS IS NOT AUTHENTICATION: the credentials below are public
// constants shown on screen, compared in plain JavaScript in the visitor's own browser, and the
// "session" is just a sessionStorage flag anyone can set from the console. It exists so the demo
// separates the storefront from the admin area; it protects nothing. All data is browser-local.
import { route, navigate } from '../../router.js';
import { html, escapeHtml } from '../../ui.js';

export const DEMO_ADMIN_EMAIL = 'admin@elan.demo';
export const DEMO_ADMIN_PASSWORD = 'demo1234'; // not a secret: displayed on the gate by design
const SESSION_KEY = 'adminSession';

export function isAdminSession() {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
}

function setSession(on) {
  try {
    if (on) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* storage blocked: the gate simply shows again */ }
}

/** Plain comparison with the public demo constants (email case-insensitive, trimmed). */
export const checkDemoCredentials = (email, password) => String(email || '').trim().toLowerCase() === DEMO_ADMIN_EMAIL
  && String(password || '') === DEMO_ADMIN_PASSWORD;

export function logout() {
  setSession(false);
  navigate('#/admin');
}

/**
 * Register an admin route: the handler runs only while sessionStorage.adminSession === '1';
 * otherwise the gate renders, and a successful entry re-renders the SAME requested route.
 */
export function adminRoute(path, handler) {
  route(path, (ctx) => (isAdminSession() ? handler(ctx) : renderGate(ctx)), { layout: 'admin' });
}

export function renderGate(ctx = {}) {
  const el = html(`<section class="page admin-gate" data-page="admin-gate" data-admin-gate data-route="/admin">
    <div class="admin-gate-inner">
      <div class="admin-gate-brand">
        <span class="admin-brand-mark" aria-hidden="true">É</span>
        <span class="admin-brand-name">ÉLAN <span>Admin</span></span>
        <span class="badge admin-demo-badge" data-demo-badge>Demo Store</span>
      </div>
      <div class="admin-card admin-gate-card">
        <h1 class="admin-gate-title">Είσοδος διαχειριστή <span class="admin-gate-title-sub">— ΜΟΝΟ DEMO, ΟΧΙ ΠΡΑΓΜΑΤΙΚΗ ΤΑΥΤΟΠΟΙΗΣΗ</span></h1>
        <div class="alert alert-warning admin-gate-disclaimer" role="note" data-gate-disclaimer>
          <i class="bi bi-shield-exclamation me-1" aria-hidden="true"></i>
          Η πρόσβαση αυτή <strong>δεν είναι ασφαλής</strong>: πρόκειται για επίδειξη χωρίς διακομιστή. Τα στοιχεία εισόδου
          είναι δημόσια και ο έλεγχος γίνεται μέσα στον περιηγητή. Όλα τα δεδομένα (προϊόντα, παραγγελίες, πελάτες)
          αποθηκεύονται τοπικά σε αυτόν τον περιηγητή και οι αλλαγές δεν φτάνουν σε άλλους επισκέπτες.
        </div>
        <div class="admin-gate-creds" aria-labelledby="agCredsTitle">
          <p class="admin-gate-creds-title" id="agCredsTitle">Demo στοιχεία εισόδου</p>
          <dl>
            <div><dt>Email</dt><dd><code data-demo-email>${escapeHtml(DEMO_ADMIN_EMAIL)}</code></dd></div>
            <div><dt>Κωδικός</dt><dd><code data-demo-password>${escapeHtml(DEMO_ADMIN_PASSWORD)}</code></dd></div>
          </dl>
          <button type="button" class="btn btn-outline-dark btn-sm" data-gate-fill><i class="bi bi-magic me-1" aria-hidden="true"></i>Συμπλήρωση</button>
        </div>
        <form class="admin-gate-form" novalidate data-gate-form>
          <div class="alert alert-danger" role="alert" data-gate-error hidden></div>
          <div class="mb-3">
            <label class="form-label" for="ag-email">Email</label>
            <input class="form-control" id="ag-email" name="email" type="email" autocomplete="off" inputmode="email" required>
          </div>
          <div class="mb-3">
            <label class="form-label" for="ag-password">Κωδικός</label>
            <input class="form-control" id="ag-password" name="password" type="password" autocomplete="off" required>
          </div>
          <button type="submit" class="btn btn-dark w-100" data-gate-submit>Είσοδος στη διαχείριση</button>
        </form>
      </div>
      <p class="admin-gate-back"><a href="#/" data-view-store><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Επιστροφή στο κατάστημα</a></p>
    </div>
  </section>`);
  const form = el.querySelector('[data-gate-form]');
  const err = el.querySelector('[data-gate-error]');
  el.querySelector('[data-gate-fill]').addEventListener('click', () => {
    form.elements.email.value = DEMO_ADMIN_EMAIL;
    form.elements.password.value = DEMO_ADMIN_PASSWORD;
    form.querySelector('[data-gate-submit]').focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!checkDemoCredentials(form.elements.email.value, form.elements.password.value)) {
      err.textContent = 'Λάθος email ή κωδικός. Χρησιμοποιήστε τα demo στοιχεία που εμφανίζονται παραπάνω.';
      err.hidden = false;
      form.elements.password.setAttribute('aria-invalid', 'true');
      form.elements.password.select();
      return;
    }
    setSession(true);
    // Continue to the admin route that was originally requested.
    const target = ctx.path && ctx.path.startsWith('/admin') ? location.hash : '#/admin';
    navigate(target, { replace: true });
  });
  return el;
}
