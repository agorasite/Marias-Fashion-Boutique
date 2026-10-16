const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let seq = 0;

/**
 * Ask the user to confirm an action in a Bootstrap modal.
 * Resolves true on OK; false on cancel, close button, backdrop click or Escape.
 * Options: `items` (bullet list under the message) and `requireText` (typed confirmation: OK stays
 * disabled until exactly that text — trimmed, case-sensitive — has been typed).
 */
export function confirmDialog(msg, { title = 'Επιβεβαίωση', okLabel = 'Επιβεβαίωση', cancelLabel = 'Άκυρο', danger = false, items = [], requireText = '' } = {}) {
  return new Promise((resolve) => {
    const id = `confirmDialog${++seq}`;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="modal fade modal-elan" id="${id}" tabindex="-1" aria-labelledby="${id}-title" aria-describedby="${id}-body">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5" id="${id}-title">${esc(title)}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
          </div>
          <div class="modal-body">
            <div id="${id}-body"><p class="mb-0">${esc(msg)}</p>${items.length ? `<ul class="confirm-items">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>
            ${requireText ? `<div class="confirm-typed"><label class="form-label" for="${id}-typed">Για επιβεβαίωση πληκτρολογήστε <strong>${esc(requireText)}</strong></label>
              <input class="form-control" id="${id}-typed" data-confirm-typed autocomplete="off" autocapitalize="characters" spellcheck="false"></div>` : ''}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-dark" data-bs-dismiss="modal">${esc(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-dark'}" data-ok${requireText ? ' disabled' : ''}>${esc(okLabel)}</button>
          </div>
        </div>
      </div>
    </div>`;
    const el = wrap.firstElementChild;
    document.body.append(el);
    const modal = window.bootstrap.Modal.getOrCreateInstance(el);
    let answer = false;
    const ok = el.querySelector('[data-ok]');
    const typed = el.querySelector('[data-confirm-typed]');
    const matches = () => !typed || typed.value.trim() === requireText;
    ok.addEventListener('click', () => {
      if (answer || !matches()) return;
      answer = true;
      modal.hide();
    });
    if (typed) {
      typed.addEventListener('input', () => { ok.disabled = !matches(); });
      typed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && matches()) { e.preventDefault(); ok.click(); } });
    }
    el.addEventListener('shown.bs.modal', () => (typed || ok).focus());
    // Keep Tab / Shift+Tab cycling inside the dialog (Bootstrap's trap lets focus escape to the browser UI).
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    el.addEventListener('hidden.bs.modal', () => {
      modal.dispose();
      el.remove();
      resolve(answer);
    });
    modal.show();
  });
}

export const DEMO_LIMITATIONS = [
  'Τα δεδομένα (προϊόντα, καλάθι, παραγγελίες) αποθηκεύονται μόνο στον περιηγητή σας, μέσω IndexedDB.',
  'Διαφορετικοί επισκέπτες δεν μοιράζονται προϊόντα ή παραγγελίες μεταξύ τους.',
  'Οι αλλαγές από τη διαχείριση δεν μεταφέρονται σε άλλους περιηγητές ή συσκευές.',
  'Η πρόσβαση διαχειριστή είναι επιδεικτική και δεν αποτελεί πραγματική, ασφαλή ταυτοποίηση.',
  'Οι πληρωμές μέσω IRIS είναι προσομοίωση· δεν γίνεται καμία χρέωση.',
  'Δεν αποστέλλονται πραγματικά email και δεν πραγματοποιούνται τραπεζικές συναλλαγές.',
  'Ζωντανά δεδομένα από το Instagram απαιτούν υποστηριζόμενη σύνδεση και διαπιστευτήρια· εδώ εμφανίζονται επιλεγμένες φωτογραφίες.',
];

/** The "about this demo" modal, created once and reused. */
export function aboutDemoModal() {
  let el = document.getElementById('aboutDemoModal');
  if (!el) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="modal fade modal-elan" id="aboutDemoModal" tabindex="-1" aria-labelledby="aboutDemoTitle">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h4" id="aboutDemoTitle">Σχετικά με αυτό το demo</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
          </div>
          <div class="modal-body">
            <p>Το ÉLAN Fashion Boutique είναι ένα φανταστικό κατάστημα επίδειξης της AgoraSite. Λειτουργεί εξ ολοκλήρου στον περιηγητή σας και δεν αποτελεί παραγωγική υποδομή.</p>
            <ul class="demo-limits">${DEMO_LIMITATIONS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            <p class="small text-body-secondary mb-0">Μπορείτε να δοκιμάσετε ελεύθερα αγορές και διαχείριση· τίποτα δεν αποστέλλεται εκτός της συσκευής σας.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-dark" data-bs-dismiss="modal">Κατάλαβα</button>
          </div>
        </div>
      </div>
    </div>`;
    el = wrap.firstElementChild;
    document.body.append(el);
  }
  return window.bootstrap.Modal.getOrCreateInstance(el);
}

/** Thin top strip shown on every route (storefront and admin). */
export function renderDemoStrip() {
  const strip = document.createElement('div');
  strip.className = 'demo-strip';
  strip.innerHTML = `<div class="container-xl d-flex align-items-center justify-content-center gap-2">
      <span class="demo-strip-text"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Demo κατάστημα · Οι παραγγελίες είναι προσομοίωση</span>
      <button type="button" class="btn btn-link demo-strip-btn" aria-haspopup="dialog">Πληροφορίες</button>
    </div>`;
  strip.querySelector('button').addEventListener('click', () => aboutDemoModal().show());
  return strip;
}

/**
 * Quick-view dialog for a catalog product (info only; add-to-cart arrives with the cart task).
 * `product` carries `variants` and `availability`. Returns the Bootstrap modal instance.
 */
export function quickViewModal(product, { returnFocus } = {}) {
  const sizeLabel = (s) => (s === 'ONE' ? 'Μία διάσταση' : s);
  const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
  const rank = (x) => (order.includes(x) ? order.indexOf(x) : (x === 'ONE' ? 1e6 : 100 + parseFloat(x) || 1e5));
  const sizes = [...new Set((product.variants || []).map((v) => v.size))].sort((a, b) => rank(a) - rank(b));
  const colorMap = new Map();
  (product.variants || []).forEach((v) => { if (!colorMap.has(v.color)) colorMap.set(v.color, v.colorHex); });
  const money = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
  const sale = product.compareAtCents && product.compareAtCents > product.priceCents;
  const inStock = product.availability ? product.availability.inStock : true;
  const id = `quickView${++seq}`;
  const src = (product.images && product.images[0]) || '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="modal fade modal-elan quick-view" id="${id}" tabindex="-1" aria-labelledby="${id}-title" data-quick-view>
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <p class="eyebrow mb-0">Γρήγορη προβολή</p>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
        </div>
        <div class="modal-body">
          <div class="row g-4">
            <div class="col-5">
              <div class="quick-view-media">${src ? `<img src="${esc(src)}" alt="${esc(product.name)}" width="800" height="1200">` : ''}</div>
            </div>
            <div class="col-7">
              <p class="product-card-brand">${esc(product.brand)}</p>
              <h2 class="h4 mb-2" id="${id}-title">${esc(product.name)}</h2>
              <p class="mb-3 price ${sale ? 'price-sale' : ''}"><span>${esc(money.format(product.priceCents / 100))}</span>${sale ? `<span class="price-old">${esc(money.format(product.compareAtCents / 100))}</span>` : ''}</p>
              <p class="small ${inStock ? 'text-success' : 'text-body-secondary'} mb-3">${inStock ? 'Διαθέσιμο' : 'Εξαντλημένο'}</p>
              ${colorMap.size ? `<p class="eyebrow mb-1">Χρώματα</p><ul class="list-inline qv-colors mb-3">${[...colorMap].map(([n, h]) => `<li class="list-inline-item"><span class="swatch" style="background:${esc(h)}"></span> <span class="small">${esc(n)}</span></li>`).join('')}</ul>` : ''}
              ${sizes.length ? `<p class="eyebrow mb-1">Μεγέθη</p><ul class="list-inline qv-sizes mb-3">${sizes.map((s) => `<li class="list-inline-item"><span class="qv-size">${esc(sizeLabel(s))}</span></li>`).join('')}</ul>` : ''}
              <a class="btn btn-dark" href="#/product/${esc(product.slug)}" data-qv-link>Δες το προϊόν</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const el = wrap.firstElementChild;
  document.body.append(el);
  const modal = window.bootstrap.Modal.getOrCreateInstance(el);
  el.querySelector('[data-qv-link]').addEventListener('click', () => modal.hide());
  const img = el.querySelector('.quick-view-media img');
  if (img) {
    img.addEventListener('error', () => {
      img.replaceWith(Object.assign(document.createElement('div'), { className: 'product-card-fallback', innerHTML: '<span>ÉLAN</span>' }));
    }, { once: true });
  }
  el.addEventListener('hidden.bs.modal', () => {
    modal.dispose();
    el.remove();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  });
  modal.show();
  return modal;
}
