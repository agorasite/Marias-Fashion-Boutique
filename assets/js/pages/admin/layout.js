// Admin shell: responsive sidebar (Bootstrap `offcanvas-lg`: an offcanvas below 992px, a fixed
// column from 992px), top bar with the store name, the always-visible «Demo Store» badge, a link to
// the storefront and logout; breadcrumbs + page title above the content area.
import { html, escapeHtml } from '../../ui.js';
import { logout } from './gate.js';
import { applyAdminBrand } from '../../components/brand.js';
import { getSettings } from '../../services/settings.js';

export const ADMIN_NAV = [
  { key: 'overview', href: '#/admin', label: 'Επισκόπηση', icon: 'bi-grid-1x2' },
  { key: 'products', href: '#/admin/products', label: 'Προϊόντα', icon: 'bi-bag' },
  { key: 'orders', href: '#/admin/orders', label: 'Παραγγελίες', icon: 'bi-receipt' },
  { key: 'customers', href: '#/admin/customers', label: 'Πελάτες', icon: 'bi-people' },
  { key: 'promotions', href: '#/admin/promotions', label: 'Προωθήσεις', icon: 'bi-ticket-perforated' },
  { key: 'content', href: '#/admin/content', label: 'Περιεχόμενο', icon: 'bi-easel' },
  { key: 'settings', href: '#/admin/settings', label: 'Ρυθμίσεις', icon: 'bi-sliders' },
  { key: 'backup', href: '#/admin/backup', label: 'Αντίγραφα', icon: 'bi-cloud-arrow-down' },
];

const STORE_NAME = 'Marias Fashion Boutique';

function hideSidebar(el) {
  const sidebar = el.querySelector('#adminSidebar');
  const inst = sidebar && window.bootstrap?.Offcanvas.getInstance(sidebar);
  if (inst) inst.hide();
}

/**
 * @param {{active:string, title:string, view:string, route:string, crumbs?:{href?:string,label:string}[], actions?:string}} o
 * @returns {{root:HTMLElement, body:HTMLElement}}
 */
export function adminLayout({ active, title, view, route, crumbs = [], subtitle = '' }) {
  const nav = ADMIN_NAV.map((n) => `<li><a class="admin-nav-link${n.key === active ? ' active' : ''}" href="${n.href}"${n.key === active ? ' aria-current="page"' : ''}>
      <i class="bi ${n.icon}" aria-hidden="true"></i><span>${escapeHtml(n.label)}</span></a></li>`).join('');
  const trail = [{ href: '#/admin', label: 'Διαχείριση' }, ...crumbs];
  const crumbHtml = trail.map((c, i) => (i === trail.length - 1 || !c.href
    ? `<li class="breadcrumb-item active" aria-current="page">${escapeHtml(c.label)}</li>`
    : `<li class="breadcrumb-item"><a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a></li>`)).join('');

  const root = html(`<section class="page admin-page" data-page="admin" data-route="${escapeHtml(route)}">
    <div class="admin-shell" data-admin-shell>
      <aside class="admin-sidebar offcanvas-lg offcanvas-start" id="adminSidebar" tabindex="-1" aria-labelledby="adminSidebarLabel">
        <div class="admin-sidebar-head">
          <a class="admin-brand" href="#/admin" id="adminSidebarLabel">
            <span class="admin-brand-mark" aria-hidden="true">M</span>
            <span class="admin-brand-name">Marias <span>Admin</span></span>
          </a>
          <button type="button" class="btn-close btn-close-white d-lg-none" data-bs-dismiss="offcanvas" data-bs-target="#adminSidebar" aria-label="Κλείσιμο μενού"></button>
        </div>
        <nav class="admin-nav" aria-label="Διαχείριση">
          <p class="admin-nav-title">Κατάστημα</p>
          <ul>${nav}</ul>
        </nav>
        <div class="admin-sidebar-foot">
          <p class="admin-sidebar-note"><i class="bi bi-hdd me-1" aria-hidden="true"></i>Τα δεδομένα είναι τοπικά σε αυτόν τον περιηγητή (IndexedDB).</p>
          <a class="admin-nav-link" href="#/" data-view-store><i class="bi bi-shop" aria-hidden="true"></i><span>Προβολή καταστήματος</span></a>
          <button type="button" class="admin-nav-link" data-admin-logout><i class="bi bi-box-arrow-right" aria-hidden="true"></i><span>Αποσύνδεση</span></button>
        </div>
      </aside>
      <div class="admin-main">
        <header class="admin-topbar" data-admin-topbar>
          <button type="button" class="btn admin-menu-toggle d-lg-none" data-admin-menu-toggle data-bs-toggle="offcanvas" data-bs-target="#adminSidebar" aria-controls="adminSidebar" aria-label="Άνοιγμα μενού διαχείρισης">
            <i class="bi bi-list" aria-hidden="true"></i>
          </button>
          <div class="admin-topbar-store">
            <span class="admin-topbar-name">${escapeHtml(STORE_NAME)}</span>
            <span class="badge admin-demo-badge" data-demo-badge title="Κατάστημα επίδειξης: τα δεδομένα είναι τοπικά και οι πληρωμές προσομοίωση">Demo Store</span>
          </div>
          <div class="admin-topbar-actions">
            <a class="btn btn-sm btn-outline-dark admin-topbar-btn" href="#/" data-view-store><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i><span class="d-none d-md-inline ms-1">Προβολή καταστήματος</span><span class="visually-hidden d-md-none">Προβολή καταστήματος</span></a>
            <button type="button" class="btn btn-sm btn-dark admin-topbar-btn" data-admin-logout><i class="bi bi-box-arrow-right" aria-hidden="true"></i><span class="d-none d-md-inline ms-1">Αποσύνδεση</span><span class="visually-hidden d-md-none">Αποσύνδεση</span></button>
          </div>
        </header>
        <div class="admin-content" data-admin-view="${escapeHtml(view)}">
          <nav aria-label="Διαδρομή" class="admin-crumbs"><ol class="breadcrumb">${crumbHtml}</ol></nav>
          <div class="admin-page-head">
            <h1 class="admin-title"></h1>
            ${subtitle ? `<p class="admin-subtitle">${escapeHtml(subtitle)}</p>` : ''}
          </div>
          <div class="admin-body" data-admin-body></div>
        </div>
      </div>
    </div>
  </section>`);
  root.querySelector('.admin-title').textContent = title;
  // Brand follows the configured logo/wordmark (Ρυθμίσεις → Λογότυπο), live while the page is open.
  const paintBrand = () => getSettings().then((s) => { if (root.isConnected || !root.parentNode) applyAdminBrand(root, s); }).catch(() => {});
  paintBrand();
  const onSettings = () => { if (!root.isConnected) { window.removeEventListener('settings:changed', onSettings); return; } paintBrand(); };
  window.addEventListener('settings:changed', onSettings);
  root.querySelectorAll('[data-admin-logout]').forEach((b) => b.addEventListener('click', () => { hideSidebar(root); logout(); }));
  // Close the mobile offcanvas when a link inside it is followed.
  root.querySelector('#adminSidebar').addEventListener('click', (e) => { if (e.target.closest('a[href]')) hideSidebar(root); });
  return { root, body: root.querySelector('[data-admin-body]') };
}


export function adminNotFound(ctx) {
  const { root, body } = adminLayout({ active: null, title: 'Η σελίδα δεν βρέθηκε', view: 'not-found', route: ctx.path, crumbs: [{ label: 'Δεν βρέθηκε' }] });
  body.append(html(`<div class="admin-card admin-soon">
    <span class="admin-soon-icon" aria-hidden="true"><i class="bi bi-signpost-split"></i></span>
    <p class="admin-soon-text">Η διεύθυνση <code></code> δεν αντιστοιχεί σε κάποια ενότητα της διαχείρισης.</p>
    <a class="btn btn-dark btn-sm" href="#/admin">Επιστροφή στην επισκόπηση</a>
  </div>`));
  body.querySelector('code').textContent = `#${ctx.path}`;
  return root;
}
