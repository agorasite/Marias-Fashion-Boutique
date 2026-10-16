// Admin settings (#/admin/settings): store details, logo, VAT, shipping, payments, social links.
// Rules: services/settings-rules.js (pure). Data: services/settings.js. A save is one IndexedDB write
// followed by window 'settings:changed', so the storefront (cart, checkout, product page, home banner,
// footer, header) picks the values up immediately.
import { escapeHtml as esc, toast, confirmDialog } from '../../ui.js';
import { setNavigationGuard, onPageLeave } from '../../router.js';
import { adminLayout } from './layout.js';
import { section, ctl, input, errorSummaryHtml, formBarHtml, createErrorUi } from './form-kit.js';
import { imagePickerHtml, bindImagePickers } from './image-picker.js';
import { getSettings, saveSettings, resetSettingsToDefaults } from '../../services/settings.js';
import { validateSettingsInput, settingsToForm, instagramHandleFromUrl, IRIS_MIN, IRIS_MAX } from '../../services/settings-rules.js';

const LABELS = {
  storeName: 'Επωνυμία', contactEmail: 'Email', contactPhone: 'Τηλέφωνο', contactAddress: 'Διεύθυνση', vatNumber: 'ΑΦΜ', openingHours: 'Ωράριο',
  logoText: 'Κείμενο λογοτύπου', logoSubtext: 'Υπότιτλος', logoImage: 'Εικόνα λογοτύπου', logoAlt: 'Εναλλακτικό κείμενο λογοτύπου',
  vatPercent: 'Συντελεστής ΦΠΑ', courier: 'Έξοδα courier', freeShippingThreshold: 'Όριο δωρεάν αποστολής', pickupNote: 'Σημείωση παραλαβής',
  codFee: 'Επιβάρυνση αντικαταβολής', irisInstructions: 'Οδηγίες IRIS (demo)',
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', pinterest: 'Pinterest',
};

const text = (key, value, attrs = '') => input(key, value, `autocomplete="off" ${attrs}`);
const addon = (key, value, suffix, attrs = '') => (id, desc) => `<div class="input-group">
  <input class="form-control" id="${id}" name="${key}" data-field="${key}" aria-describedby="${desc}" value="${esc(value)}" inputmode="decimal" autocomplete="off" ${attrs}>
  <span class="input-group-text">${suffix}</span></div>`;

function formHtml(f, s) {
  const readonly = (id, label, value, note) => `<div class="col-12 col-md-6"><label class="form-label" for="${id}">${esc(label)}</label>
    <input class="form-control" id="${id}" value="${esc(value)}" readonly aria-describedby="${id}-note"><div class="form-text" id="${id}-note">${esc(note)}</div></div>`;
  return `<form class="admin-product-form admin-settings-form" novalidate data-settings-form aria-label="Ρυθμίσεις καταστήματος">
    ${errorSummaryHtml()}

    ${section('Στοιχεία καταστήματος', 'Εμφανίζονται στο υποσέλιδο, στα email επικοινωνίας και στις σελίδες του καταστήματος.', `<div class="row g-3">
      ${ctl({ key: 'storeName', label: 'Επωνυμία καταστήματος', required: true, col: 'col-12 col-md-6', control: text('storeName', f.storeName, 'maxlength="60"') })}
      ${ctl({ key: 'contactEmail', label: 'Email επικοινωνίας', required: true, col: 'col-12 col-md-6', control: text('contactEmail', f.contactEmail, 'type="email" inputmode="email" maxlength="254"') })}
      ${ctl({ key: 'contactPhone', label: 'Τηλέφωνο', required: true, col: 'col-12 col-md-6', control: text('contactPhone', f.contactPhone, 'type="tel" maxlength="25"') })}
      ${ctl({ key: 'contactAddress', label: 'Διεύθυνση', required: true, col: 'col-12 col-md-6', control: text('contactAddress', f.contactAddress, 'maxlength="120"') })}
      ${ctl({ key: 'vatNumber', label: 'ΑΦΜ (προαιρετικό)', col: 'col-12 col-md-6', hint: '9 ψηφία. Εμφανίζεται στο υποσέλιδο.', control: text('vatNumber', f.vatNumber, 'inputmode="numeric" maxlength="12"') })}
      ${ctl({ key: 'openingHours', label: 'Ωράριο λειτουργίας (προαιρετικό)', col: 'col-12 col-md-6', hint: 'Π.χ. Δευ–Παρ 10:00–20:00, Σάβ 10:00–16:00', control: text('openingHours', f.openingHours, 'maxlength="120"') })}
    </div>`, 'store')}

    ${section('Λογότυπο', 'Αν δεν οριστεί τίποτα, χρησιμοποιείται το προεπιλεγμένο wordmark «ÉLAN». Εμφανίζεται στην κεφαλίδα, στο υποσέλιδο και στο μενού διαχείρισης.', `<div class="row g-3">
      ${ctl({ key: 'logoText', label: 'Κείμενο (wordmark)', col: 'col-12 col-md-6', hint: 'Έως 24 χαρακτήρες. Κενό = προεπιλογή ÉLAN.', control: text('logoText', f.logoText, 'maxlength="24"') })}
      ${ctl({ key: 'logoSubtext', label: 'Υπότιτλος', col: 'col-12 col-md-6', hint: 'Έως 40 χαρακτήρες. Εμφανίζεται κάτω από το κείμενο.', control: text('logoSubtext', f.logoSubtext, 'maxlength="40"') })}
      <div class="col-12">${imagePickerHtml({ id: 'f-logoImage', label: 'Εικόνα λογοτύπου (προαιρετικό)', bind: 'logoImage', attr: 'data-field', value: f.logoImage, required: false })}</div>
      ${ctl({ key: 'logoAlt', label: 'Εναλλακτικό κείμενο εικόνας', col: 'col-12 col-md-6', hint: 'Υποχρεωτικό όταν υπάρχει εικόνα.', control: text('logoAlt', f.logoAlt, 'maxlength="120"') })}
    </div>`, 'logo')}

    ${section('Νόμισμα και ΦΠΑ', 'Το κατάστημα λειτουργεί σε ευρώ. Οι τιμές των προϊόντων περιλαμβάνουν ΦΠΑ.', `<div class="row g-3">
      ${readonly('f-currency', 'Νόμισμα', 'EUR — Ευρώ (€)', 'Σταθερό: το demo δεν υποστηρίζει πολλαπλά νομίσματα.')}
      ${ctl({ key: 'vatPercent', label: 'Συντελεστής ΦΠΑ (%)', required: true, col: 'col-12 col-md-6', hint: '0–100, έως 2 δεκαδικά (π.χ. 24 ή 13,5). Χρησιμοποιείται στη γραμμή «ΦΠΑ περιλαμβάνεται».', control: addon('vatPercent', f.vatPercent, '%') })}
      ${readonly('f-pricesIncludeVat', 'Οι τιμές περιλαμβάνουν ΦΠΑ', s.pricesIncludeVat === false ? 'Όχι' : 'Ναι', 'Σταθερό: ο υπολογισμός συνόλων υποστηρίζει μόνο τιμές με ΦΠΑ. Δεν αλλάζει από εδώ.')}
    </div>`, 'vat')}

    ${section('Αποστολή', 'Τα ποσά εφαρμόζονται άμεσα στο καλάθι, στο ταμείο και στη σελίδα προϊόντος.', `<div class="row g-3">
      ${ctl({ key: 'courier', label: 'Έξοδα courier (€)', required: true, col: 'col-12 col-md-6', hint: 'Π.χ. 3,90', control: addon('courier', f.courier, '€') })}
      ${ctl({ key: 'freeShippingThreshold', label: 'Δωρεάν αποστολή από (€)', required: true, col: 'col-12 col-md-6', hint: 'Το 0 σημαίνει ότι η αποστολή είναι πάντα δωρεάν.', control: addon('freeShippingThreshold', f.freeShippingThreshold, '€') })}
      ${ctl({ key: 'pickupNote', label: 'Σημείωση παραλαβής από το κατάστημα (προαιρετικό)', col: 'col-12', hint: 'Εμφανίζεται στο ταμείο όταν επιλεγεί παραλαβή. Έως 200 χαρακτήρες.', control: text('pickupNote', f.pickupNote, 'maxlength="200"') })}
    </div>`, 'shipping')}

    ${section('Πληρωμές', 'Όλες οι πληρωμές είναι προσομοίωση: δεν γίνεται καμία πραγματική χρέωση.', `<div class="row g-3">
      ${ctl({ key: 'codFee', label: 'Επιβάρυνση αντικαταβολής (€)', required: true, col: 'col-12 col-md-6', hint: 'Το 0 σημαίνει καμία επιβάρυνση.', control: addon('codFee', f.codFee, '€') })}
      ${ctl({ key: 'irisInstructions', label: 'Οδηγίες πληρωμής IRIS (demo)', required: true, hint: `${IRIS_MIN}–${IRIS_MAX} χαρακτήρες. Το κείμενο πρέπει να αναφέρει ρητά ότι πρόκειται για «προσομοίωση» και να μη δηλώνει ότι η παραγγελία «πληρώθηκε» ή είναι «πληρωμένη».`,
        control: (id, d) => `<textarea class="form-control" id="${id}" name="irisInstructions" data-field="irisInstructions" rows="5" maxlength="${IRIS_MAX + 200}" aria-describedby="${d} iris-count">${esc(f.irisInstructions)}</textarea>
          <div class="form-text text-end" id="iris-count" data-iris-count></div>` })}
      <div class="col-12"><p class="admin-honesty"><i class="bi bi-shield-exclamation me-1" aria-hidden="true"></i>Κανόνας ειλικρίνειας demo: ο κωδικός IRIS και οι οδηγίες είναι προσομοιωμένα· δεν υπάρχει πραγματική τραπεζική συναλλαγή.</p></div>
    </div>`, 'payments')}

    ${section('Κοινωνικά δίκτυα', 'Προαιρετικοί σύνδεσμοι https:// που εμφανίζονται στο υποσέλιδο.', `<div class="row g-3">
      ${ctl({ key: 'instagram', label: 'Instagram', col: 'col-12 col-md-6', hint: 'Π.χ. https://instagram.com/elan.boutique', control: text('instagram', f.instagram, 'type="url" inputmode="url" maxlength="200"') })}
      <div class="col-12 col-md-6"><p class="form-label mb-1">Handle Instagram (αυτόματα)</p><p class="admin-derived" data-ig-handle aria-live="polite"></p></div>
      ${ctl({ key: 'facebook', label: 'Facebook', col: 'col-12 col-md-6', control: text('facebook', f.facebook, 'type="url" inputmode="url" maxlength="200"') })}
      ${ctl({ key: 'tiktok', label: 'TikTok', col: 'col-12 col-md-6', control: text('tiktok', f.tiktok, 'type="url" inputmode="url" maxlength="200"') })}
      ${ctl({ key: 'pinterest', label: 'Pinterest', col: 'col-12 col-md-6', control: text('pinterest', f.pinterest, 'type="url" inputmode="url" maxlength="200"') })}
    </div>`, 'social')}

    ${section('Δεδομένα και ευρετήριο (IndexedDB)', '', `<div class="admin-info-box" data-index-info>
      <p class="mb-2"><i class="bi bi-hdd me-1" aria-hidden="true"></i>Όλα τα δεδομένα αυτού του καταστήματος (προϊόντα, παραγγελίες, πελάτες, περιεχόμενο και οι παρούσες ρυθμίσεις) αποθηκεύονται <strong>μόνο τοπικά, στον περιηγητή σας</strong>, σε βάση IndexedDB. Δεν υπάρχει server ούτε συγχρονισμός.</p>
      <p class="mb-0">Αν καθαρίσετε τα δεδομένα του περιηγητή ή ανοίξετε άλλον περιηγητή, το demo ξεκινά ξανά από τα αρχικά δεδομένα. Οι αλλαγές εδώ δεν επηρεάζουν άλλους επισκέπτες.</p>
    </div>`, 'index')}

    ${formBarHtml({ extra: '<button type="button" class="btn btn-outline-dark" data-reset-settings><i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Επαναφορά προεπιλογών ρυθμίσεων</button>' })}
  </form>`;
}

export default async function render() {
  const { root, body } = adminLayout({ active: 'settings', title: 'Ρυθμίσεις', view: 'settings', route: '/admin/settings', crumbs: [{ label: 'Ρυθμίσεις' }],
    subtitle: 'Στοιχεία καταστήματος, ΦΠΑ, αποστολή, πληρωμές και κοινωνικά δίκτυα. Οι αλλαγές ισχύουν αμέσως στο κατάστημα.' });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';
  (async () => {
    let settings;
    try { settings = await getSettings(); } catch (err) {
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των ρυθμίσεων. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.removeAttribute('aria-busy');
    mount({ root, body, view, settings });
  })();
  return root;
}

function mount({ root, body, view, settings: initial }) {
  let settings = initial;
  let dirty = false;
  let saving = false;

  const paint = () => {
    body.innerHTML = formHtml(settingsToForm(settings), settings);
    wire();
  };
  const form = () => body.querySelector('[data-settings-form]');
  const markDirty = () => { dirty = true; form().querySelector('[data-dirty-note]').hidden = false; };
  const clean = () => { dirty = false; form().querySelector('[data-dirty-note]').hidden = true; };

  function readForm() {
    const out = {};
    form().querySelectorAll('[data-field]').forEach((el) => { out[el.dataset.field] = el.value; });
    return out;
  }

  function wire() {
    const f = form();
    const errors = createErrorUi(f, { fieldEl: (k) => f.querySelector(`[data-field="${CSS.escape(k)}"]`), labelFor: (k) => LABELS[k] || k });
    const igHandle = () => { f.querySelector('[data-ig-handle]').textContent = instagramHandleFromUrl(f.querySelector('[data-field="instagram"]').value) || 'Δεν προκύπτει handle από τη διεύθυνση.'; };
    const irisCount = () => {
      const n = f.querySelector('[data-field="irisInstructions"]').value.trim().length;
      f.querySelector('[data-iris-count]').textContent = `${n} / ${IRIS_MAX} χαρακτήρες`;
    };
    igHandle();
    irisCount();

    bindImagePickers(f, {
      apply: (el, patch) => {
        errors.clearField(el.querySelector('[data-img-src]'));
        markDirty();
      },
    });

    f.addEventListener('input', (ev) => {
      errors.clearField(ev.target);
      if (ev.target.matches('[data-field="instagram"]')) igHandle();
      if (ev.target.matches('[data-field="irisInstructions"]')) irisCount();
      if (ev.target.closest('[data-image-picker]') && ev.target.matches('[data-picker-file]')) return;
      markDirty();
    });

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (saving) return;
      const r = validateSettingsInput(readForm());
      if (!r.ok) { errors.show(r.errors); return; }
      errors.clear();
      saving = true;
      const btn = f.querySelector('[data-save]');
      btn.disabled = true;
      try {
        const patch = {
          ...r.value,
          contact: { ...(settings.contact || {}), ...r.value.contact },
        };
        settings = await saveSettings(patch);
        clean();
        toast('Οι ρυθμίσεις αποθηκεύτηκαν και ισχύουν αμέσως στο κατάστημα.', 'success');
        view.dataset.saved = String(Date.now());
      } catch (err) {
        console.warn('Settings save failed', err);
        toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
      } finally {
        saving = false;
        btn.disabled = false;
      }
    });

    f.querySelector('[data-reset-settings]').addEventListener('click', async () => {
      const ok = await confirmDialog('Θα επαναφερθούν οι αρχικές ρυθμίσεις καταστήματος (στοιχεία, ΦΠΑ, αποστολή, πληρωμές, κοινωνικά δίκτυα, λογότυπο). Τα προϊόντα, οι παραγγελίες και το περιεχόμενο δεν αλλάζουν.', {
        title: 'Επαναφορά προεπιλογών ρυθμίσεων', okLabel: 'Επαναφορά', cancelLabel: 'Άκυρο', danger: true,
      });
      if (!ok) return;
      try {
        settings = await resetSettingsToDefaults();
        dirty = false;
        paint();
        toast('Οι ρυθμίσεις επανήλθαν στις προεπιλογές.', 'success');
        view.dataset.saved = String(Date.now());
      } catch (err) {
        console.warn('Settings reset failed', err);
        toast('Η επαναφορά δεν ολοκληρώθηκε.', 'danger');
      }
    });
  }

  // Unsaved-changes guard (same pattern as the product editor).
  const leave = () => confirmDialog('Έχετε αλλαγές που δεν έχουν αποθηκευτεί. Αν αποχωρήσετε, θα χαθούν.', { title: 'Μη αποθηκευμένες αλλαγές', okLabel: 'Αποχώρηση χωρίς αποθήκευση', cancelLabel: 'Παραμονή', danger: true });
  setNavigationGuard(() => (!dirty || !root.isConnected ? true : leave()));
  const onUnload = (ev) => {
    if (!root.isConnected) { window.removeEventListener('beforeunload', onUnload); return; }
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onUnload);
  onPageLeave(() => window.removeEventListener('beforeunload', onUnload));

  paint();
  view.dataset.ready = 'true';
}
