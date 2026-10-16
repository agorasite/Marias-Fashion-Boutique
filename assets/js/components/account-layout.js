// Account area chrome: title, persistent demo notice, local-profile switcher and the section nav
// (left column on desktop, scrollable tab strip on mobile). Pages fill the `[data-account-body]` slot.
import { html, escapeHtml as esc } from '../ui.js';

export const NOTICE = 'Ο λογαριασμός είναι demo: τα στοιχεία σας αποθηκεύονται μόνο σε αυτόν τον περιηγητή και δεν συγχρονίζονται με άλλες συσκευές. Δεν υπάρχει πραγματική σύνδεση/ταυτοποίηση.';

export const TABS = [
  { key: 'overview', href: '#/account', icon: 'bi-grid-1x2', label: 'Επισκόπηση' },
  { key: 'orders', href: '#/account/orders', icon: 'bi-box-seam', label: 'Παραγγελίες' },
  { key: 'profile', href: '#/account/profile', icon: 'bi-person', label: 'Προφίλ' },
  { key: 'addresses', href: '#/account/addresses', icon: 'bi-geo-alt', label: 'Διευθύνσεις' },
  { key: 'wishlist', href: '#/account/wishlist', icon: 'bi-heart', label: 'Αγαπημένα' },
  { key: 'newsletter', href: '#/account/newsletter', icon: 'bi-envelope-paper', label: 'Newsletter' },
];

export const customerName = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;

/**
 * @param {{tab:string,title:string,customers:object[],active:object|null,onSwitch:(id:string)=>void}} o
 * @returns {{root:HTMLElement, body:HTMLElement}}
 */
export function accountLayout({ tab, title, customers = [], active = null, onSwitch }) {
  const root = html(`<section class="page account-page" data-page="account" data-route="/account" data-tab="${esc(tab)}">
    <div class="container-xl">
      <header class="acct-head">
        <span class="eyebrow">Ο λογαριασμός μου</span>
        <h1 class="display-title acct-title"></h1>
      </header>
      <div class="alert alert-info acct-notice" role="note" data-account-notice data-no-print>${esc(NOTICE)}</div>
      <div class="acct-switch" data-no-print hidden>
        <div class="acct-switch-field" data-switch-field hidden>
          <label class="form-label" for="acct-switch">Ενεργό προφίλ (τοπικό)</label>
          <select class="form-select" id="acct-switch" data-account-switch></select>
        </div>
        <a class="btn btn-outline-dark btn-sm" href="#/account?new=1" data-new-profile><i class="bi bi-person-plus me-1" aria-hidden="true"></i>Νέο τοπικό προφίλ</a>
      </div>
      <div class="acct-layout">
        <nav class="acct-nav" aria-label="Ενότητες λογαριασμού" data-account-nav data-no-print>
          <ul class="list-unstyled">${TABS.map((t) => `<li><a href="${t.href}" data-tab="${t.key}"${t.key === tab ? ' aria-current="page"' : ''}><i class="bi ${t.icon}" aria-hidden="true"></i><span>${t.label}</span></a></li>`).join('')}</ul>
        </nav>
        <div class="acct-body" data-account-body></div>
      </div>
    </div>
  </section>`);
  root.querySelector('h1').textContent = title;

  if (active) {
    root.querySelector('.acct-switch').hidden = false;
    if (customers.length > 1) {
      const field = root.querySelector('[data-switch-field]');
      field.hidden = false;
      const sel = root.querySelector('[data-account-switch]');
      sel.innerHTML = customers.map((c) => `<option value="${esc(c.id)}"${c.id === active.id ? ' selected' : ''}>${esc(customerName(c))} (${esc(c.email)})</option>`).join('');
      sel.addEventListener('change', () => onSwitch?.(sel.value));
    }
  }
  return { root, body: root.querySelector('[data-account-body]') };
}
