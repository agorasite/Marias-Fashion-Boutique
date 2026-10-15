const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let seq = 0;

/**
 * Ask the user to confirm an action in a Bootstrap modal.
 * Resolves true on OK; false on cancel, close button, backdrop click or Escape.
 */
export function confirmDialog(msg, { title = 'Επιβεβαίωση', okLabel = 'Επιβεβαίωση', cancelLabel = 'Άκυρο', danger = false } = {}) {
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
          <div class="modal-body" id="${id}-body"><p class="mb-0">${esc(msg)}</p></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-dark" data-bs-dismiss="modal">${esc(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-dark'}" data-ok>${esc(okLabel)}</button>
          </div>
        </div>
      </div>
    </div>`;
    const el = wrap.firstElementChild;
    document.body.append(el);
    const modal = window.bootstrap.Modal.getOrCreateInstance(el);
    let answer = false;
    el.querySelector('[data-ok]').addEventListener('click', () => {
      answer = true;
      modal.hide();
    });
    el.addEventListener('shown.bs.modal', () => el.querySelector('[data-ok]').focus());
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
