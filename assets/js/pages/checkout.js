// One-page checkout. Prices come from the DB through the same quote rules as the cart; the order
// itself is created by services/checkout.placeOrder in a single IndexedDB transaction.
import { html, escapeHtml as esc, formatMoney, navigate } from '../ui.js';
import { getQuoteForCart } from '../services/cart.js';
import { quote } from '../services/pricing.js';
import { pricedLines, couponMessage } from '../services/cart-rules.js';
import { sizeLabel } from '../services/products.js';
import { REGIONS, FIELD_ORDER, NOTES_MAX, SHIPPING_LABELS, validateCheckoutForm, uuid } from '../services/checkout-rules.js';
import { placeOrder, CheckoutError, lineSignature } from '../services/checkout.js';
import { getActiveCustomer } from '../services/customers.js';

const smOf = (src) => src.replace(/\.webp$/, '-sm.webp');
const ADDRESS_FIELDS = ['address', 'city', 'postalCode', 'region'];
const TEXT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'postalCode', 'region', 'company', 'vatNumber', 'notes'];

const req = '<span class="co-req" aria-hidden="true">*</span>';
const opt = '<span class="co-opt">(προαιρετικό)</span>';

function field({ name, label, type = 'text', autocomplete, inputmode, required = true, hint, col = 'col-12', attrs = '' }) {
  const desc = `${hint ? `co-${name}-hint ` : ''}co-${name}-error`;
  return `<div class="${col}">
    <label class="form-label" for="co-${name}">${label} ${required ? req : opt}</label>
    <input class="form-control" id="co-${name}" name="${name}" type="${type}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}${required ? ' aria-required="true"' : ''} aria-describedby="${desc}" ${attrs}>
    ${hint ? `<div class="form-text" id="co-${name}-hint">${hint}</div>` : ''}
    <div class="co-error" id="co-${name}-error" data-error-for="${name}"></div>
  </div>`;
}

const FIELD_LABELS = {
  firstName: 'Όνομα', lastName: 'Επώνυμο', email: 'Email', phone: 'Τηλέφωνο', shippingMethod: 'Τρόπος παράδοσης',
  address: 'Διεύθυνση', city: 'Πόλη', postalCode: 'Τ.Κ.', region: 'Περιφέρεια', company: 'Εταιρεία', vatNumber: 'ΑΦΜ',
  paymentMethod: 'Τρόπος πληρωμής', notes: 'Σημειώσεις', acceptTerms: 'Όροι',
};

function refusalHtml(kind) {
  const empty = kind === 'empty';
  return `<div class="co-refusal" data-checkout-refusal="${kind}" role="${empty ? 'status' : 'alert'}">
    <i class="bi ${empty ? 'bi-bag' : 'bi-exclamation-triangle'}" aria-hidden="true"></i>
    <h2 class="h4">${empty ? 'Το καλάθι σας είναι άδειο' : 'Δεν είναι δυνατή η ολοκλήρωση της παραγγελίας'}</h2>
    <p class="text-body-secondary">${empty
      ? 'Προσθέστε προϊόντα στο καλάθι για να ολοκληρώσετε μια παραγγελία.'
      : 'Κάποια προϊόντα του καλαθιού δεν είναι διαθέσιμα στην ποσότητα που επιλέξατε ή δεν διατίθενται πλέον. Διορθώστε τα στο καλάθι και συνεχίστε.'}</p>
    <div class="d-flex flex-wrap justify-content-center gap-2">
      ${empty
        ? '<a class="btn btn-dark" href="#/catalog">Συνέχεια αγορών</a><a class="btn btn-outline-dark" href="#/cart">Μετάβαση στο καλάθι</a>'
        : '<a class="btn btn-dark" href="#/cart">Διόρθωση στο καλάθι</a>'}
    </div>
  </div>`;
}

function formHtml(data, saved) {
  const s = data.settings;
  const pickupAddr = s.contact?.address || '';
  return `<form id="checkoutForm" class="co-form" data-checkout-form novalidate aria-describedby="coRequiredNote">
    <div class="co-error-summary" data-error-summary tabindex="-1" role="alert" aria-labelledby="coErrTitle" hidden>
      <h2 class="h6" id="coErrTitle">Ελέγξτε τα παρακάτω πεδία:</h2>
      <ul data-error-list></ul>
    </div>
    <p class="co-required-note" id="coRequiredNote">Τα πεδία με ${req.replace(' aria-hidden="true"', '')} είναι υποχρεωτικά. Δεν χρειάζεται λογαριασμός — ολοκληρώνετε ως επισκέπτης.</p>

    <fieldset class="co-section">
      <legend class="co-legend"><span class="co-step" aria-hidden="true">1</span>Στοιχεία επικοινωνίας</legend>
      ${saved ? `<div class="co-saved" data-saved-panel>
        <button type="button" class="btn btn-outline-dark btn-sm" data-fill-saved><i class="bi bi-person-check me-1" aria-hidden="true"></i>Συμπλήρωση με τα αποθηκευμένα στοιχεία</button>
        <p class="co-saved-note" data-saved-note>Τα στοιχεία σας (${esc(saved.email)}) είναι αποθηκευμένα μόνο σε αυτόν τον περιηγητή.</p>
      </div>` : ''}
      <div class="row g-3">
        ${field({ name: 'firstName', label: 'Όνομα', autocomplete: 'given-name', col: 'col-sm-6' })}
        ${field({ name: 'lastName', label: 'Επώνυμο', autocomplete: 'family-name', col: 'col-sm-6' })}
        ${field({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', col: 'col-sm-6', attrs: 'spellcheck="false" autocapitalize="off"' })}
        ${field({ name: 'phone', label: 'Τηλέφωνο', type: 'tel', autocomplete: 'tel', inputmode: 'tel', col: 'col-sm-6', hint: 'Κινητό 69… ή σταθερό 2…' })}
      </div>
    </fieldset>

    <fieldset class="co-section" id="co-shippingMethod">
      <legend class="co-legend"><span class="co-step" aria-hidden="true">2</span>Τρόπος παράδοσης</legend>
      <div class="co-choices">
        <label class="co-choice">
          <input type="radio" name="shippingMethod" value="courier" checked>
          <span class="co-choice-body">
            <span class="co-choice-title"><i class="bi bi-truck" aria-hidden="true"></i>${esc(SHIPPING_LABELS.courier)}</span>
            <span class="co-choice-desc">Παράδοση σε 1–3 εργάσιμες. Δωρεάν για παραγγελίες από ${esc(formatMoney(s.freeShippingThresholdCents))}.</span>
          </span>
          <span class="co-choice-price" data-ship-price="courier"></span>
        </label>
        <label class="co-choice">
          <input type="radio" name="shippingMethod" value="pickup">
          <span class="co-choice-body">
            <span class="co-choice-title"><i class="bi bi-shop" aria-hidden="true"></i>${esc(SHIPPING_LABELS.pickup)}</span>
            <span class="co-choice-desc">${pickupAddr ? `${esc(pickupAddr)} · ` : ''}Χωρίς διεύθυνση αποστολής.</span>
          </span>
          <span class="co-choice-price">Δωρεάν</span>
        </label>
      </div>
      <p class="co-freeship" data-freeship-note aria-live="polite"></p>
    </fieldset>

    <fieldset class="co-section" data-address-section>
      <legend class="co-legend"><span class="co-step" aria-hidden="true">3</span><span data-address-legend>Διεύθυνση αποστολής</span></legend>
      <p class="co-pickup-note" data-pickup-note hidden><i class="bi bi-info-circle" aria-hidden="true"></i>
        Για παραλαβή από το κατάστημα${pickupAddr ? ` (${esc(pickupAddr)})` : ''} χρειαζόμαστε μόνο τα στοιχεία επικοινωνίας σας. Δεν απαιτείται διεύθυνση.</p>
      <div class="row g-3" data-address-fields>
        ${field({ name: 'address', label: 'Οδός και αριθμός', autocomplete: 'shipping address-line1' })}
        ${field({ name: 'city', label: 'Πόλη', autocomplete: 'shipping address-level2', col: 'col-sm-6' })}
        ${field({ name: 'postalCode', label: 'Τ.Κ.', autocomplete: 'shipping postal-code', inputmode: 'numeric', col: 'col-sm-6', attrs: 'maxlength="6" pattern="[0-9 ]*"' })}
        <div class="col-12">
          <label class="form-label" for="co-region">Περιφέρεια ${req}</label>
          <select class="form-select" id="co-region" name="region" autocomplete="shipping address-level1" aria-required="true" aria-describedby="co-region-error">
            <option value="">Επιλέξτε περιφέρεια…</option>
            ${REGIONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
          <div class="co-error" id="co-region-error" data-error-for="region"></div>
        </div>
      </div>
      <div class="row g-3 mt-0 co-invoice">
        <p class="co-subhead col-12">Στοιχεία τιμολόγησης ${opt}</p>
        ${field({ name: 'company', label: 'Επωνυμία εταιρείας', autocomplete: 'organization', required: false, col: 'col-sm-6' })}
        ${field({ name: 'vatNumber', label: 'ΑΦΜ', inputmode: 'numeric', required: false, col: 'col-sm-6', hint: '9 ψηφία', attrs: 'autocomplete="off" maxlength="14"' })}
      </div>
    </fieldset>

    <fieldset class="co-section" id="co-paymentMethod">
      <legend class="co-legend"><span class="co-step" aria-hidden="true">4</span>Τρόπος πληρωμής</legend>
      <div class="co-choices">
        <label class="co-choice">
          <input type="radio" name="paymentMethod" value="cod" checked>
          <span class="co-choice-body">
            <span class="co-choice-title"><i class="bi bi-cash-coin" aria-hidden="true"></i>Αντικαταβολή</span>
            <span class="co-choice-desc">Πληρώνετε κατά την παραλαβή. Η πληρωμή καταγράφεται ως εκκρεμής.</span>
            <span class="co-choice-note" data-cod-note>${s.codFeeCents > 0
              ? `Επιβάρυνση αντικαταβολής ${esc(formatMoney(s.codFeeCents))} — προστίθεται στο σύνολο.`
              : 'Χωρίς επιβάρυνση αντικαταβολής.'}</span>
          </span>
          <span class="co-choice-price">${s.codFeeCents > 0 ? `+${esc(formatMoney(s.codFeeCents))}` : ''}</span>
        </label>
        <label class="co-choice">
          <input type="radio" name="paymentMethod" value="iris">
          <span class="co-choice-body">
            <span class="co-choice-title"><i class="bi bi-phone" aria-hidden="true"></i>IRIS <span class="co-sim-badge">Προσομοίωση</span></span>
            <span class="co-choice-desc">Προσομοίωση πληρωμής IRIS — καμία πραγματική συναλλαγή</span>
          </span>
          <span class="co-choice-price">Χωρίς χρέωση</span>
        </label>
      </div>
      <div class="co-iris-info" data-iris-info hidden>
        <p class="co-iris-flag"><i class="bi bi-shield-exclamation" aria-hidden="true"></i><strong>Προσομοίωση — δεν πραγματοποιείται πραγματική πληρωμή</strong></p>
        <ol class="co-iris-steps">
          <li>Υποβάλλετε την παραγγελία· καταχωρείται με πληρωμή «σε εκκρεμότητα».</li>
          <li>Στη σελίδα επιβεβαίωσης βλέπετε προσομοιωμένες οδηγίες IRIS (δικαιούχος, ποσό, αιτιολογία).</li>
          <li>Με το κουμπί «Προσομοίωση πληρωμής IRIS» η πληρωμή σημειώνεται ως προσομοιωμένη. Δεν μεταφέρονται χρήματα και δεν ζητούνται τραπεζικά στοιχεία.</li>
        </ol>
      </div>
    </fieldset>

    <fieldset class="co-section">
      <legend class="co-legend"><span class="co-step" aria-hidden="true">5</span>Σημειώσεις και επιβεβαίωση</legend>
      <label class="form-label" for="co-notes">Σημειώσεις παραγγελίας ${opt}</label>
      <textarea class="form-control" id="co-notes" name="notes" rows="3" maxlength="${NOTES_MAX + 100}" aria-describedby="co-notes-hint co-notes-error" placeholder="π.χ. κουδούνι, ώρες παράδοσης"></textarea>
      <div class="form-text" id="co-notes-hint"><span data-notes-count>0</span>/${NOTES_MAX} χαρακτήρες</div>
      <div class="co-error" id="co-notes-error" data-error-for="notes"></div>

      <div class="form-check mt-3">
        <input class="form-check-input" type="checkbox" id="co-saveDetails" name="saveDetails" aria-describedby="co-saveDetails-hint" ${saved ? 'checked' : ''}>
        <label class="form-check-label" for="co-saveDetails">Να προτείνονται αυτά τα στοιχεία για την επόμενη αγορά σε αυτόν τον περιηγητή</label>
      </div>
      <p class="form-text co-save-hint" id="co-saveDetails-hint">Η παραγγελία και τα στοιχεία επικοινωνίας σας καταχωρούνται πάντα τοπικά σε αυτόν τον περιηγητή (demo), για το ιστορικό παραγγελιών. Η επιλογή ορίζει μόνο αν θα σας προτείνονται για συμπλήρωση και αν η διεύθυνση θα μπει στις αποθηκευμένες διευθύνσεις.</p>
      <div class="form-check">
        <input class="form-check-input" type="checkbox" id="co-acceptTerms" name="acceptTerms" aria-required="true" aria-describedby="co-acceptTerms-error">
        <label class="form-check-label" for="co-acceptTerms">Αποδέχομαι τους όρους (demo) ${req}</label>
      </div>
      <div class="co-error" id="co-acceptTerms-error" data-error-for="acceptTerms"></div>
    </fieldset>
  </form>`;
}

function linesHtml(lines) {
  return lines.map((l) => `<li class="co-line" data-summary-line data-sku="${esc(l.sku)}">
    <span class="co-line-media">
      ${l.image ? `<img src="${esc(smOf(l.image))}" alt="" width="64" height="85" loading="lazy">` : ''}
      <span class="co-line-qty" aria-hidden="true">${l.qty}</span>
    </span>
    <span class="co-line-main">
      <span class="co-line-name">${esc(l.name)}</span>
      <span class="co-line-variant">${[l.color, l.size == null ? '' : sizeLabel(l.size)].filter(Boolean).map(esc).join(' · ')} · <span class="visually-hidden">Ποσότητα </span>${l.qty} τεμ.</span>
    </span>
    <span class="co-line-total">${esc(formatMoney(l.unitCents * l.qty))}</span>
  </li>`).join('');
}

function totalsHtml(q, data) {
  const { couponCode, coupon, settings } = data;
  let couponRow = '';
  if (couponCode && !q.couponError) {
    couponRow = `<div class="is-discount" data-sum-coupon><dt>Κουπόνι <strong>${esc(couponCode)}</strong>
      <a class="co-inline-link" href="#/cart">αφαίρεση στο καλάθι</a></dt><dd data-sum-discount>−${esc(formatMoney(q.discountCents))}</dd></div>`;
  } else if (couponCode) {
    couponRow = `<div class="co-coupon-warn" data-sum-coupon><dt>Ο κωδικός <strong>${esc(couponCode)}</strong> δεν ισχύει: ${esc(couponMessage(q.couponError, coupon, formatMoney))}
      <a class="co-inline-link" href="#/cart">Αφαίρεση στο καλάθι</a></dt><dd></dd></div>`;
  }
  return `<dl class="cart-totals co-totals">
    <div><dt>Υποσύνολο</dt><dd data-sum-subtotal>${esc(formatMoney(q.subtotalCents))}</dd></div>
    ${couponRow}
    <div><dt>Μεταφορικά</dt><dd data-sum-shipping>${q.shippingCents ? esc(formatMoney(q.shippingCents)) : 'Δωρεάν'}</dd></div>
    ${q.codFeeCents ? `<div><dt>Επιβάρυνση αντικαταβολής</dt><dd data-sum-cod>${esc(formatMoney(q.codFeeCents))}</dd></div>` : ''}
    <div class="cart-total-row"><dt>Σύνολο</dt><dd data-sum-total>${esc(formatMoney(q.totalCents))}</dd></div>
    <div class="cart-vat"><dt>Συμπεριλαμβάνεται ΦΠΑ ${Math.round(settings.vatRate * 100)}%</dt><dd data-sum-vat>${esc(formatMoney(q.vatIncludedCents))}</dd></div>
  </dl>`;
}

function summaryHtml(data) {
  return `<div class="co-summary-card">
    <div class="d-flex align-items-baseline justify-content-between gap-2">
      <h2 class="co-summary-title" id="coSummaryTitle">Η παραγγελία σας</h2>
      <a class="co-inline-link" href="#/cart">Επεξεργασία</a>
    </div>
    <ul class="co-lines list-unstyled">${linesHtml(data.lines)}</ul>
    <div data-totals></div>
    <button type="submit" form="checkoutForm" class="btn btn-dark btn-lg w-100 co-submit" data-place-order>
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true" hidden data-spinner></span>
      <span data-submit-label>Υποβολή παραγγελίας</span>
    </button>
    <p class="co-fine-print"><i class="bi bi-lock" aria-hidden="true"></i> Demo κατάστημα: δεν γίνεται χρέωση και δεν ζητούνται στοιχεία κάρτας ή τραπεζικού λογαριασμού.</p>
  </div>`;
}

function errorBannerHtml(err) {
  const d = err.details || {};
  let title = 'Η παραγγελία δεν ολοκληρώθηκε';
  let body = 'Δεν έγινε καμία αλλαγή σε απόθεμα ή καλάθι. Δοκιμάστε ξανά.';
  let link = '';
  switch (err.code) {
    case 'STOCK':
      title = 'Το διαθέσιμο απόθεμα άλλαξε';
      body = `Δεν καταχωρήθηκε παραγγελία. ${(d.lines || []).map((l) => (l.available > 0
        ? `${esc(l.name)}: ζητήσατε ${l.requested}, διαθέσιμα ${l.available}.`
        : `${esc(l.name)}: εξαντλήθηκε.`)).join(' ')}`;
      link = '<a href="#/cart" class="btn btn-sm btn-dark">Διόρθωση στο καλάθι</a>';
      break;
    case 'COUPON':
      title = `Ο κωδικός ${esc(d.code || '')} δεν ισχύει πλέον`;
      body = `${esc(couponMessage(d.reason, d.coupon, formatMoney))} Δεν καταχωρήθηκε παραγγελία.`;
      link = '<a href="#/cart" class="btn btn-sm btn-dark">Αφαίρεση κωδικού στο καλάθι</a>';
      break;
    case 'PROBLEMS':
      title = 'Κάποια προϊόντα δεν είναι πλέον διαθέσιμα';
      body = 'Δεν καταχωρήθηκε παραγγελία. Αφαιρέστε τα μη διαθέσιμα προϊόντα από το καλάθι.';
      link = '<a href="#/cart" class="btn btn-sm btn-dark">Μετάβαση στο καλάθι</a>';
      break;
    case 'EMPTY':
      title = 'Το καλάθι σας είναι άδειο';
      body = 'Ίσως η παραγγελία ολοκληρώθηκε σε άλλη καρτέλα.';
      link = '<a href="#/cart" class="btn btn-sm btn-dark">Μετάβαση στο καλάθι</a>';
      break;
    case 'PRICE':
      title = 'Το καλάθι ή οι τιμές άλλαξαν';
      body = 'Δεν καταχωρήθηκε παραγγελία. Η σύνοψη ενημερώθηκε με τα τρέχοντα προϊόντα και τιμές — ελέγξτε τη και υποβάλετε ξανά.';
      break;
    default:
  }
  return `<div class="co-banner" role="alert" tabindex="-1" data-checkout-error="${esc(err.code || 'ERROR')}">
    <i class="bi bi-exclamation-octagon" aria-hidden="true"></i>
    <div><p class="co-banner-title">${title}</p><p class="mb-2">${body}</p>${link}</div>
  </div>`;
}

export default async function render() {
  const root = html(`<section class="page checkout-page" data-page="checkout" data-route="/checkout">
    <div class="container-xl">
      <a class="co-back" href="#/cart"><i class="bi bi-arrow-left" aria-hidden="true"></i> Επιστροφή στο καλάθι</a>
      <h1 class="display-title co-title">Ολοκλήρωση παραγγελίας</h1>
      <p class="co-lead"><i class="bi bi-info-circle" aria-hidden="true"></i> Demo: η παραγγελία αποθηκεύεται μόνο σε αυτόν τον περιηγητή — δεν γίνεται πραγματική πληρωμή.</p>
      <div class="visually-hidden" role="status" aria-live="polite" data-announce></div>
      <div data-checkout-body aria-busy="true">
        <div class="cart-skeleton" aria-hidden="true"><span class="skeleton cart-skel-line"></span><span class="skeleton cart-skel-line"></span></div>
      </div>
    </div>
  </section>`);
  const body = root.querySelector('[data-checkout-body]');
  const announce = root.querySelector('[data-announce]');

  const [data, saved] = await Promise.all([
    getQuoteForCart('courier', 'cod'),
    getActiveCustomer().catch(() => null),
  ]);
  body.removeAttribute('aria-busy');
  if (!data.lines.length) {
    body.innerHTML = refusalHtml('empty');
    return root;
  }
  if (data.hasProblems) {
    body.innerHTML = refusalHtml('problems');
    return root;
  }

  const savedCustomer = saved && saved.rememberDetails ? saved : null;
  body.innerHTML = `<div data-banner-slot></div>
    <div class="co-grid">
      <div class="co-main">${formHtml(data, savedCustomer)}</div>
      <aside class="co-summary" aria-labelledby="coSummaryTitle">${summaryHtml(data)}</aside>
    </div>`;

  const form = body.querySelector('[data-checkout-form]');
  const errSummary = body.querySelector('[data-error-summary]');
  const bannerSlot = body.querySelector('[data-banner-slot]');
  const submitBtn = body.querySelector('[data-place-order]');
  let requestId = uuid();
  let inFlight = false;
  let state = data; // latest DB snapshot used for display
  let current = null; // latest quote shown
  const shown = new Set(); // fields currently showing an error

  const el = (name) => form.elements.namedItem(name);
  const shipMethod = () => (form.querySelector('input[name="shippingMethod"]:checked')?.value) || 'courier';
  const payMethod = () => (form.querySelector('input[name="paymentMethod"]:checked')?.value) || 'cod';

  function readForm() {
    const out = {};
    for (const f of TEXT_FIELDS) out[f] = el(f).value;
    out.shippingMethod = shipMethod();
    out.paymentMethod = payMethod();
    out.acceptTerms = el('acceptTerms').checked;
    return out;
  }

  function inputFor(f) {
    return form.querySelector(`#co-${f}`);
  }

  function setFieldError(f, msg) {
    const box = form.querySelector(`#co-${f}-error`);
    const input = inputFor(f);
    if (!box) return;
    box.textContent = msg || '';
    if (input && input.matches('input, select, textarea')) {
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        input.classList.add('is-invalid');
      } else {
        input.removeAttribute('aria-invalid');
        input.classList.remove('is-invalid');
      }
    }
    if (msg) shown.add(f); else shown.delete(f);
  }

  function showErrors(errors) {
    for (const f of FIELD_ORDER) setFieldError(f, errors[f]);
    const list = errSummary.querySelector('[data-error-list]');
    const keys = FIELD_ORDER.filter((f) => errors[f]);
    list.innerHTML = keys.map((f) => `<li><a href="#co-${f}" data-jump="${f}">${esc(FIELD_LABELS[f])}: ${esc(errors[f])}</a></li>`).join('');
    errSummary.hidden = keys.length === 0;
  }

  function validateOne(f) {
    const { errors } = validateCheckoutForm(readForm());
    setFieldError(f, errors[f]);
    if (!errSummary.hidden) {
      // keep the summary in sync with what the fields show
      const visible = {};
      shown.forEach((k) => { if (errors[k]) visible[k] = errors[k]; });
      showErrors(visible);
    }
  }

  function computeQuote() {
    return quote({
      lines: pricedLines(state.lines),
      coupon: state.coupon,
      shipping: { method: shipMethod() },
      payment: payMethod(),
      settings: state.settings,
    });
  }

  function updateSummary({ speak = false } = {}) {
    const q = computeQuote();
    current = q;
    body.querySelector('[data-totals]').innerHTML = totalsHtml(q, state);
    const s = state.settings;
    const pickup = shipMethod() === 'pickup';
    const courierQ = pickup ? quote({ lines: pricedLines(state.lines), coupon: state.coupon, shipping: { method: 'courier' }, payment: payMethod(), settings: s }) : q;
    const freeCourier = courierQ.shippingCents === 0;
    form.querySelector('[data-ship-price="courier"]').textContent = freeCourier ? 'Δωρεάν' : formatMoney(s.courierCents);
    const note = form.querySelector('[data-freeship-note]');
    if (pickup) note.textContent = '';
    else if (freeCourier) note.innerHTML = '<i class="bi bi-gift" aria-hidden="true"></i> Η παραγγελία σας δικαιούται δωρεάν αποστολή με courier.';
    else note.textContent = `Προσθέστε ${formatMoney(courierQ.freeShippingRemainingCents)} ακόμη για δωρεάν αποστολή με courier.`;
    note.hidden = !note.textContent;
    if (speak) announce.textContent = `Νέο σύνολο παραγγελίας: ${formatMoney(q.totalCents)}`;
  }

  function syncShipping() {
    const pickup = shipMethod() === 'pickup';
    form.querySelector('[data-address-fields]').hidden = pickup;
    form.querySelector('[data-pickup-note]').hidden = !pickup;
    form.querySelector('[data-address-legend]').textContent = pickup ? 'Παραλαβή και τιμολόγηση' : 'Διεύθυνση αποστολής';
    if (pickup) ADDRESS_FIELDS.forEach((f) => setFieldError(f, ''));
    form.querySelector('[data-iris-info]').hidden = payMethod() !== 'iris';
    form.querySelectorAll('.co-choice').forEach((c) => c.classList.toggle('is-selected', c.querySelector('input').checked));
  }

  function setBusy(on) {
    submitBtn.disabled = on;
    submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    submitBtn.querySelector('[data-spinner]').hidden = !on;
    submitBtn.querySelector('[data-submit-label]').textContent = on ? 'Καταχώρηση παραγγελίας…' : 'Υποβολή παραγγελίας';
  }

  function showBanner(err) {
    bannerSlot.innerHTML = errorBannerHtml(err);
    const b = bannerSlot.firstElementChild;
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    b.focus({ preventScroll: true });
  }

  async function refreshData() {
    try {
      const fresh = await getQuoteForCart('courier', 'cod');
      if (fresh.lines.length && !fresh.hasProblems) {
        state = fresh;
        body.querySelector('.co-lines').innerHTML = linesHtml(state.lines);
        updateSummary();
      }
    } catch (e) { console.warn('checkout refresh failed', e); }
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'shippingMethod' || e.target.name === 'paymentMethod') {
      syncShipping();
      updateSummary({ speak: true });
    } else if (e.target.name === 'acceptTerms' && shown.has('acceptTerms')) {
      validateOne('acceptTerms');
    } else if (e.target.name === 'region' && shown.has('region')) {
      validateOne('region');
    }
  });

  form.addEventListener('focusout', (e) => {
    const f = e.target.name;
    if (!TEXT_FIELDS.includes(f)) return;
    // Validate on leave once the user has typed something, or to clear an existing error.
    if (e.target.value.trim() || shown.has(f)) validateOne(f);
  });

  form.addEventListener('input', (e) => {
    if (e.target.name === 'notes') form.querySelector('[data-notes-count]').textContent = String(e.target.value.length);
  });

  errSummary.addEventListener('click', (e) => {
    const a = e.target.closest('[data-jump]');
    if (!a) return;
    e.preventDefault(); // keep the route hash intact
    const target = inputFor(a.dataset.jump) || form.querySelector(`#co-${a.dataset.jump} input`);
    if (target) {
      const focusEl = target.matches('fieldset') ? target.querySelector('input') : target;
      focusEl.focus();
      focusEl.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  });

  const fillBtn = form.querySelector('[data-fill-saved]');
  if (fillBtn) {
    fillBtn.addEventListener('click', () => {
      const c = savedCustomer;
      const a = (c.savedAddresses && c.savedAddresses[0]) || {};
      const values = {
        firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, company: c.company,
        vatNumber: c.vatNumber, address: a.address, city: a.city, postalCode: a.postalCode, region: a.region,
      };
      for (const [k, v] of Object.entries(values)) if (v != null && el(k)) el(k).value = v;
      el('saveDetails').checked = true;
      for (const k of Object.keys(values)) if (shown.has(k)) validateOne(k);
      announce.textContent = 'Τα αποθηκευμένα στοιχεία συμπληρώθηκαν.';
      el('firstName').focus();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight) return;
    const values = readForm();
    const v = validateCheckoutForm(values);
    showErrors(v.errors);
    if (!v.ok) {
      errSummary.focus();
      errSummary.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    bannerSlot.innerHTML = '';
    inFlight = true;
    setBusy(true);
    try {
      const order = await placeOrder({
        form: values,
        shippingMethod: values.shippingMethod,
        paymentMethod: values.paymentMethod,
        requestId,
        saveDetails: el('saveDetails').checked,
        expectedTotalCents: current ? current.totalCents : undefined,
        expectedSignature: lineSignature(pricedLines(state.lines)),
      });
      navigate(`/order/${encodeURIComponent(order.id)}`);
    } catch (err) {
      requestId = uuid(); // a failed attempt wrote nothing; the next one is a new request
      inFlight = false;
      setBusy(false);
      if (err instanceof CheckoutError && err.code === 'VALIDATION') {
        showErrors(err.details.errors || {});
        errSummary.focus();
        return;
      }
      if (!(err instanceof CheckoutError)) console.warn('placeOrder failed', err);
      showBanner(err instanceof CheckoutError ? err : { code: 'ERROR', details: {} });
      if (err && err.code === 'PRICE') await refreshData();
    }
  });

  syncShipping();
  updateSummary();
  return root;
}
