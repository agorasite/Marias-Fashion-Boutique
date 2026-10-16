import { DEPARTMENTS } from './header.js';
import { aboutDemoModal } from './modals.js';
import { applyBrand } from './brand.js';

const DEFAULTS = {
  storeName: 'ÉLAN Fashion Boutique',
  contact: { email: 'info@elan.example', phone: '+30 210 0000000', address: 'Ερμού 10, Αθήνα' },
  social: {},
};

// Shown until the `footer` content document loads (and if it ever fails to load).
const FALLBACK_CONTENT = {
  tagline: 'Σύγχρονη ευρωπαϊκή μόδα με προσεγμένες γραμμές, ποιοτικά υλικά και διαχρονικό χαρακτήρα.',
  columns: [
    { title: 'Κατάστημα', links: [...DEPARTMENTS.map((d) => ({ label: d.label, href: `#/catalog/${d.id}` })), { label: 'Όλα τα προϊόντα', href: '#/catalog' }] },
    { title: 'Εξυπηρέτηση', links: [
      { label: 'Ο λογαριασμός μου', href: '#/account' },
      { label: 'Οι παραγγελίες μου', href: '#/account/orders' },
      { label: 'Αγαπημένα', href: '#/account/wishlist' },
      { label: 'Καλάθι', href: '#/cart' },
    ] },
  ],
  notes: [],
};

const SOCIAL = [
  ['instagram', 'bi-instagram', 'Instagram'],
  ['facebook', 'bi-facebook', 'Facebook'],
  ['tiktok', 'bi-tiktok', 'TikTok'],
  ['pinterest', 'bi-pinterest', 'Pinterest'],
];

const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? u : null);
const safeHref = (u) => (/^(#\/|https:\/\/)/.test(String(u || '')) ? u : '#/');

function text(el, sel, value) {
  const node = el.querySelector(sel);
  if (node) node.textContent = value;
}

export function renderFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container-xl">
      <div class="row g-4 g-lg-5">
        <div class="col-12 col-lg-4">
          <a class="brand brand-footer" href="#/" aria-label="ÉLAN Fashion Boutique — Αρχική"><span class="brand-mark">ÉLAN</span><span class="brand-sub">Fashion Boutique</span></a>
          <p class="footer-tagline"></p>
          <ul class="footer-social list-unstyled d-flex gap-2 mb-0"></ul>
        </div>
        <div class="col-12 col-lg-5">
          <div class="row g-4" data-footer-columns></div>
        </div>
        <div class="col-12 col-lg-3">
          <h2 class="footer-heading">Επικοινωνία</h2>
          <address class="footer-contact mb-0">
            <span><i class="bi bi-geo-alt" aria-hidden="true"></i><span data-f="address"></span></span>
            <a data-f="phone" href="#"><i class="bi bi-telephone" aria-hidden="true"></i><span></span></a>
            <a data-f="email" href="#"><i class="bi bi-envelope" aria-hidden="true"></i><span></span></a>
            <span data-f-extra class="footer-contact-extra"></span>
          </address>
          <button type="button" class="btn btn-link footer-link-btn mt-2" data-about-demo><i class="bi bi-info-circle" aria-hidden="true"></i>Σχετικά με το demo</button>
        </div>
      </div>
      <ul class="footer-notes list-unstyled" data-footer-notes></ul>
      <div class="footer-bottom">
        <span data-footer-copy>© ${new Date().getFullYear()} <span data-f="name"></span></span>
        <span>Demo κατάστημα από την AgoraSite · Οι τιμές περιλαμβάνουν ΦΠΑ</span>
      </div>
    </div>`;
  footer.querySelector('[data-about-demo]').addEventListener('click', () => aboutDemoModal().show());
  applySettings(footer, DEFAULTS);
  applyFooterContent(footer, FALLBACK_CONTENT);
  return footer;
}

/**
 * Render the `footer` content document: tagline, link columns and notes.
 * `fill(text)` resolves tokens such as {freeShipping} (defaults to identity).
 */
export function applyFooterContent(footer, content, fill = (s) => s) {
  const c = content || FALLBACK_CONTENT;
  text(footer, '.footer-tagline', c.tagline || FALLBACK_CONTENT.tagline);
  const cols = footer.querySelector('[data-footer-columns]');
  cols.replaceChildren();
  for (const col of (c.columns || [])) {
    const div = document.createElement('div');
    div.className = 'col-6';
    const h = document.createElement('h2');
    h.className = 'footer-heading';
    h.textContent = col.title;
    const ul = document.createElement('ul');
    ul.className = 'list-unstyled footer-links';
    for (const l of (col.links || [])) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = safeHref(l.href);
      a.textContent = l.label;
      if (a.getAttribute('href').startsWith('https://')) { a.target = '_blank'; a.rel = 'noopener'; }
      li.append(a);
      ul.append(li);
    }
    div.append(h, ul);
    cols.append(div);
  }
  const copy = footer.querySelector('[data-footer-copy]');
  if (copy) {
    if (c.copyright) copy.textContent = fill(c.copyright);
    else copy.innerHTML = `© ${new Date().getFullYear()} <span data-f="name"></span>`;
    if (!c.copyright) copy.querySelector('[data-f="name"]').textContent = footer.dataset.storeName || DEFAULTS.storeName;
  }
  const notes = footer.querySelector('[data-footer-notes]');
  notes.replaceChildren(...(c.notes || []).map((n) => {
    const li = document.createElement('li');
    li.textContent = fill(n);
    return li;
  }));
  notes.hidden = !notes.children.length;
}

/** Fill store name, contact and social links from settings (falls back to defaults). */
export function applySettings(footer, settings) {
  const s = { ...DEFAULTS, ...(settings || {}) };
  const c = { ...DEFAULTS.contact, ...(s.contact || {}) };
  applyBrand(footer, s);
  footer.dataset.storeName = s.storeName || DEFAULTS.storeName;
  text(footer, '[data-f="name"]', s.storeName || DEFAULTS.storeName);
  const extra = footer.querySelector('[data-f-extra]');
  extra.replaceChildren();
  for (const [ic, v] of [['bi-clock', c.openingHours], ['bi-building', c.vatNumber ? `ΑΦΜ ${c.vatNumber}` : '']]) {
    if (!v) continue;
    const sp = document.createElement('span');
    sp.innerHTML = `<i class="bi ${ic}" aria-hidden="true"></i><span></span>`;
    sp.lastElementChild.textContent = v;
    extra.append(sp);
  }
  text(footer, '[data-f="address"]', c.address);
  const phone = footer.querySelector('[data-f="phone"]');
  phone.href = `tel:${String(c.phone).replace(/[^\d+]/g, '')}`;
  phone.querySelector('span').textContent = c.phone;
  const email = footer.querySelector('[data-f="email"]');
  email.href = `mailto:${c.email}`;
  email.querySelector('span').textContent = c.email;
  const social = footer.querySelector('.footer-social');
  social.replaceChildren();
  for (const [key, ic, label] of SOCIAL) {
    const url = safeUrl(s.social && s.social[key]);
    if (!url) continue;
    const li = document.createElement('li');
    li.innerHTML = `<a class="social-link" target="_blank" rel="noopener" aria-label="${label} (νέα καρτέλα)"><i class="bi ${ic}" aria-hidden="true"></i></a>`;
    li.firstElementChild.href = url;
    social.append(li);
  }
}
