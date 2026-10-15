import { DEPARTMENTS } from './header.js';
import { aboutDemoModal } from './modals.js';

const DEFAULTS = {
  storeName: 'ÉLAN Fashion Boutique',
  contact: { email: 'info@elan.example', phone: '+30 210 0000000', address: 'Ερμού 10, Αθήνα' },
  social: {},
};

const SOCIAL = [
  ['instagram', 'bi-instagram', 'Instagram'],
  ['facebook', 'bi-facebook', 'Facebook'],
  ['tiktok', 'bi-tiktok', 'TikTok'],
];

const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? u : null);

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
          <p class="footer-tagline">Σύγχρονη ευρωπαϊκή μόδα με προσεγμένες γραμμές, ποιοτικά υλικά και διαχρονικό χαρακτήρα.</p>
          <ul class="footer-social list-unstyled d-flex gap-2 mb-0"></ul>
        </div>
        <div class="col-6 col-lg-2">
          <h2 class="footer-heading">Κατάστημα</h2>
          <ul class="list-unstyled footer-links">
            ${DEPARTMENTS.map((d) => `<li><a href="#/catalog/${d.id}">${d.label}</a></li>`).join('')}
            <li><a href="#/catalog">Όλα τα προϊόντα</a></li>
          </ul>
        </div>
        <div class="col-6 col-lg-3">
          <h2 class="footer-heading">Εξυπηρέτηση</h2>
          <ul class="list-unstyled footer-links">
            <li><a href="#/account">Ο λογαριασμός μου</a></li>
            <li><a href="#/account/orders">Οι παραγγελίες μου</a></li>
            <li><a href="#/account/wishlist">Αγαπημένα</a></li>
            <li><a href="#/cart">Καλάθι</a></li>
            <li><button type="button" class="btn btn-link footer-link-btn" data-about-demo>Σχετικά με το demo</button></li>
          </ul>
        </div>
        <div class="col-12 col-lg-3">
          <h2 class="footer-heading">Επικοινωνία</h2>
          <address class="footer-contact mb-0">
            <span><i class="bi bi-geo-alt" aria-hidden="true"></i><span data-f="address"></span></span>
            <a data-f="phone" href="#"><i class="bi bi-telephone" aria-hidden="true"></i><span></span></a>
            <a data-f="email" href="#"><i class="bi bi-envelope" aria-hidden="true"></i><span></span></a>
          </address>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} <span data-f="name"></span></span>
        <span>Demo κατάστημα από την AgoraSite · Οι τιμές περιλαμβάνουν ΦΠΑ</span>
      </div>
    </div>`;
  footer.querySelector('[data-about-demo]').addEventListener('click', () => aboutDemoModal().show());
  applySettings(footer, DEFAULTS);
  return footer;
}

/** Fill store name, contact and social links from settings (falls back to defaults). */
export function applySettings(footer, settings) {
  const s = { ...DEFAULTS, ...(settings || {}) };
  const c = { ...DEFAULTS.contact, ...(s.contact || {}) };
  text(footer, '[data-f="name"]', s.storeName || DEFAULTS.storeName);
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
