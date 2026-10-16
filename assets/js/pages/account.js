// Customer account area (browser-local demo: no login, no password).
// Routes: #/account (overview), /orders, /orders/:id, /profile, /addresses, /wishlist, /newsletter.
import { html, escapeHtml as esc, formatMoney, navigate, toast, confirmDialog } from '../ui.js';
import { accountLayout, customerName } from '../components/account-layout.js';
import {
  getCustomer, getActiveCustomerId, setActiveCustomerId, listCustomers, createLocalProfile, updateProfile,
  updateCustomer, ordersForCustomer,
} from '../services/customers.js';
import { getOrder } from '../services/orders.js';
import { listActive } from '../services/wishlist.js';
import { getSettings } from '../services/settings.js';
import { REGIONS, PAYMENT_LABELS } from '../services/checkout-rules.js';
import {
  trackingFor, fulfillmentLabel, paymentStatusLabel, validateAddress, validateProfile, normalizeAddresses,
  addAddress, updateAddress, removeAddress, setDefaultAddress, orderBelongsTo, MAX_ADDRESSES,
} from '../services/account-rules.js';
import { linesHtml, totalsHtml } from './confirmation.js';

import { smOf } from '../services/image-path.js';
const dateLong = new Intl.DateTimeFormat('el-GR', { dateStyle: 'long' });
const dateTime = new Intl.DateTimeFormat('el-GR', { dateStyle: 'long', timeStyle: 'short' });
const fmtDate = (iso, f = dateLong) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : f.format(d); };

const FULFILL_TONE = { pending: 'is-warn', confirmed: 'is-warn', processing: 'is-warn', shipped: 'is-info', delivered: 'is-ok', cancelled: 'is-bad', returned: 'is-bad' };
const PAY_TONE = { pending: 'is-warn', 'simulated-paid': 'is-ok', refunded: 'is-neutral', failed: 'is-bad', cancelled: 'is-bad' };
const fulfillBadge = (o) => `<span class="acct-badge ${FULFILL_TONE[o.fulfillmentStatus] || 'is-neutral'}" data-fulfillment-status="${esc(o.fulfillmentStatus)}"><i class="bi bi-box-seam" aria-hidden="true"></i>${esc(fulfillmentLabel(o.fulfillmentStatus))}</span>`;
const payBadge = (o) => `<span class="acct-badge ${PAY_TONE[o.paymentStatus] || 'is-neutral'}" data-payment-status="${esc(o.paymentStatus)}"><i class="bi bi-credit-card" aria-hidden="true"></i>${esc(paymentStatusLabel(o.paymentStatus))}</span>`;

const req = '<span class="co-req" aria-hidden="true">*</span>';
const opt = '<span class="co-opt">(προαιρετικό)</span>';
function field(pre, { name, label, type = 'text', autocomplete, inputmode, required = true, value = '', hint, col = 'col-12', maxlength }) {
  const id = `ac-${pre}-${name}`;
  return `<div class="${col}">
    <label class="form-label" for="${id}">${label} ${required ? req : opt}</label>
    <input class="form-control" id="${id}" name="${name}" type="${type}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}${maxlength ? ` maxlength="${maxlength}"` : ''} value="${esc(value)}" aria-describedby="${hint ? `${id}-hint ` : ''}${id}-error">
    ${hint ? `<div class="form-text" id="${id}-hint">${hint}</div>` : ''}
    <div class="co-error" id="${id}-error" data-error-for="${name}"></div>
  </div>`;
}
const regionSelect = (pre, value) => `<div class="col-12 col-sm-6">
    <label class="form-label" for="ac-${pre}-region">Περιφέρεια ${req}</label>
    <select class="form-select" id="ac-${pre}-region" name="region" aria-describedby="ac-${pre}-region-error">
      <option value="">Επιλέξτε…</option>${REGIONS.map((r) => `<option${r === value ? ' selected' : ''}>${esc(r)}</option>`).join('')}
    </select>
    <div class="co-error" id="ac-${pre}-region-error" data-error-for="region"></div>
  </div>`;

const readForm = (form) => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));

/** Fill error slots, flag invalid inputs and focus the first one (in DOM order). */
function showErrors(form, errors) {
  let first = null;
  form.querySelectorAll('[data-error-for]').forEach((slot) => {
    const msg = errors[slot.dataset.errorFor] || '';
    slot.textContent = msg;
    const input = form.elements[slot.dataset.errorFor];
    if (input) {
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      if (msg && !first) first = input;
    }
  });
  if (first) first.focus();
  return !first;
}

const card = (title, inner, extra = '') => `<section class="conf-card acct-card" ${extra}><h2 class="conf-card-title">${title}</h2>${inner}</section>`;

// ---------------------------------------------------------------- no profile / create profile
function createForm({ cancelHref } = {}) {
  const el = html(`<form class="acct-create" data-profile-create novalidate>
    <div class="row g-3">
      ${field('new', { name: 'firstName', label: 'Όνομα', autocomplete: 'given-name', col: 'col-12 col-sm-6' })}
      ${field('new', { name: 'lastName', label: 'Επώνυμο', autocomplete: 'family-name', col: 'col-12 col-sm-6' })}
      ${field('new', { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}
      ${field('new', { name: 'phone', label: 'Τηλέφωνο', type: 'tel', autocomplete: 'tel', inputmode: 'tel', hint: 'Κινητό 69xxxxxxxx ή σταθερό 2xxxxxxxxx.' })}
    </div>
    <div class="d-flex flex-wrap gap-2 mt-3">
      <button type="submit" class="btn btn-dark" data-create-submit>Δημιουργία τοπικού προφίλ</button>
      ${cancelHref ? `<a class="btn btn-outline-dark" href="${cancelHref}">Άκυρο</a>` : ''}
    </div>
  </form>`);
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readForm(el);
    const res = validateProfile(v);
    if (!showErrors(el, res.errors)) return;
    const { customer, existed } = await createLocalProfile(v);
    setActiveCustomerId(customer.id);
    toast(existed ? 'Υπάρχει ήδη τοπικό προφίλ με αυτό το email· έγινε ενεργό.' : 'Το τοπικό προφίλ δημιουργήθηκε.', existed ? 'info' : 'success');
    navigate('#/account');
  });
  return el;
}

function emptyState() {
  const el = html(`<div class="acct-empty" data-account-empty>
    <i class="bi bi-person-circle" aria-hidden="true"></i>
    <h2 class="h4">Δεν υπάρχει τοπικό προφίλ ακόμη</h2>
    <p class="text-body-secondary">Ένα προφίλ δημιουργείται αυτόματα όταν ολοκληρώσετε μια παραγγελία. Μπορείτε επίσης να φτιάξετε ένα τώρα· θα αποθηκευτεί μόνο σε αυτόν τον περιηγητή.</p>
    <a class="btn btn-dark" href="#/catalog">Δείτε τον κατάλογο</a>
    <hr>
    <h3 class="h5">Δημιουργία τοπικού προφίλ</h3>
    <div class="acct-create-wrap" data-create-slot></div>
  </div>`);
  el.querySelector('[data-create-slot]').append(createForm());
  return el;
}

// ---------------------------------------------------------------- overview
async function overview(c) {
  const [orders, wished] = await Promise.all([ordersForCustomer(c.id), listActive().catch(() => [])]);
  const last = orders[0];
  const el = html(`<div class="acct-overview">
    <h2 class="acct-greeting" data-account-greeting>Γεια σας, ${esc(c.firstName || customerName(c))}!</h2>
    <p class="text-body-secondary">${esc(c.email)}</p>
    <div class="acct-stats">
      <a class="acct-stat" href="#/account/orders" data-overview-orders><strong>${orders.length}</strong><span>${orders.length === 1 ? 'παραγγελία' : 'παραγγελίες'}</span></a>
      <a class="acct-stat" href="#/account/wishlist" data-overview-wishlist><strong>${wished.length}</strong><span>${wished.length === 1 ? 'αγαπημένο' : 'αγαπημένα'}</span></a>
    </div>
    ${card('Τελευταία παραγγελία', last
    ? `<p class="mb-1"><a href="#/account/orders/${esc(last.id)}"><strong>${esc(last.id)}</strong></a> · ${esc(fmtDate(last.createdAt))}</p>
       <p class="mb-2">${esc(formatMoney(last.totals.totalCents))}</p>
       <div class="acct-badges">${fulfillBadge(last)}${payBadge(last)}</div>
       <a class="btn btn-outline-dark btn-sm mt-3" href="#/account/orders/${esc(last.id)}">Προβολή παραγγελίας</a>`
    : '<p class="mb-3">Δεν έχετε κάνει παραγγελία ακόμη.</p><a class="btn btn-dark btn-sm" href="#/catalog">Ξεκινήστε τις αγορές</a>', 'data-last-order')}
    <ul class="acct-quick list-unstyled" data-quick-links>
      <li><a href="#/account/orders"><i class="bi bi-box-seam" aria-hidden="true"></i>Οι παραγγελίες μου</a></li>
      <li><a href="#/account/profile"><i class="bi bi-person" aria-hidden="true"></i>Επεξεργασία προφίλ</a></li>
      <li><a href="#/account/addresses"><i class="bi bi-geo-alt" aria-hidden="true"></i>Διευθύνσεις</a></li>
      <li><a href="#/account/newsletter"><i class="bi bi-envelope-paper" aria-hidden="true"></i>Newsletter</a></li>
      <li><a href="#/catalog"><i class="bi bi-bag" aria-hidden="true"></i>Συνέχεια αγορών</a></li>
    </ul>
  </div>`);
  return el;
}

// ---------------------------------------------------------------- orders list
function orderRow(o) {
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const thumbs = lines.slice(0, 4).map((l) => (l.image ? `<img src="${esc(smOf(l.image))}" alt="" width="48" height="64" loading="lazy">` : '')).join('');
  const more = lines.length > 4 ? `<span class="acct-thumb-more">+${lines.length - 4}</span>` : '';
  const items = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  return `<li><article class="acct-order" data-order-row data-order-id="${esc(o.id)}">
    <div class="acct-order-head">
      <a class="acct-order-ref" href="#/account/orders/${esc(o.id)}" data-order-link aria-label="Παραγγελία ${esc(o.id)}"><span data-order-ref>${esc(o.id)}</span></a>
      <span class="acct-order-date" data-order-date>${esc(fmtDate(o.createdAt))}</span>
    </div>
    <div class="acct-badges">${fulfillBadge(o)}${payBadge(o)}</div>
    <div class="acct-order-foot">
      <span class="acct-thumbs" aria-hidden="true">${thumbs}${more}</span>
      <span class="acct-order-sum"><span class="text-body-secondary">${items} ${items === 1 ? 'τεμάχιο' : 'τεμάχια'}</span> <strong data-order-total>${esc(formatMoney(o.totals.totalCents))}</strong></span>
    </div>
  </article></li>`;
}

async function ordersPage(c) {
  const orders = await ordersForCustomer(c.id);
  if (!orders.length) {
    return html(`<div class="acct-empty" data-orders-empty>
      <i class="bi bi-box-seam" aria-hidden="true"></i>
      <h2 class="h4">Δεν έχετε παραγγελίες ακόμη</h2>
      <p class="text-body-secondary">Οι παραγγελίες που κάνετε σε αυτόν τον περιηγητή θα εμφανίζονται εδώ.</p>
      <a class="btn btn-dark" href="#/catalog">Δείτε τον κατάλογο</a>
    </div>`);
  }
  return html(`<div><p class="text-body-secondary" data-orders-count>${orders.length} ${orders.length === 1 ? 'παραγγελία' : 'παραγγελίες'} · πρώτες οι πιο πρόσφατες</p>
    <ul class="acct-orders list-unstyled">${orders.map(orderRow).join('')}</ul></div>`);
}

// ---------------------------------------------------------------- order detail
function notFoundOrder(id) {
  return html(`<div class="acct-empty" data-order-not-found>
    <i class="bi bi-search" aria-hidden="true"></i>
    <h2 class="h4">Δεν βρέθηκε η παραγγελία</h2>
    <p class="text-body-secondary">Η παραγγελία <strong>${esc(id)}</strong> δεν βρέθηκε ή δεν ανήκει σε αυτό το προφίλ. Οι demo παραγγελίες αποθηκεύονται μόνο τοπικά, σε αυτόν τον περιηγητή.</p>
    <a class="btn btn-dark" href="#/account/orders">Οι παραγγελίες μου</a>
  </div>`);
}

function trackingHtml(o) {
  const t = trackingFor(o.fulfillmentStatus);
  const terminal = t.terminal
    ? `<div class="acct-terminal is-${t.terminal}" data-tracking-terminal="${t.terminal}" role="status"><i class="bi ${t.terminal === 'cancelled' ? 'bi-x-octagon' : 'bi-arrow-return-left'}" aria-hidden="true"></i>
        <span>${t.terminal === 'cancelled' ? 'Ακυρώθηκε — η παραγγελία δεν θα αποσταλεί.' : 'Επιστράφηκε — η παραγγελία έχει επιστραφεί.'}</span></div>` : '';
  const stateText = { done: 'ολοκληρώθηκε', current: 'τρέχον στάδιο', upcoming: 'επόμενο στάδιο' };
  const steps = t.steps.length ? `<ol class="acct-steps" aria-label="Στάδια παραγγελίας">${t.steps.map((s, i) => `<li data-step="${s.key}" data-state="${s.state}"${s.state === 'current' ? ' aria-current="step"' : ''}>
      <span class="acct-step-dot" aria-hidden="true">${s.state === 'done' ? '<i class="bi bi-check-lg"></i>' : i + 1}</span>
      <span class="acct-step-label">${s.label}<span class="visually-hidden"> (${stateText[s.state]})</span></span></li>`).join('')}</ol>` : '';
  return `<div data-tracking>${terminal}${steps}</div>`;
}

function historyHtml(o) {
  const h = (Array.isArray(o.history) ? o.history : []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!h.length) return '<p class="conf-muted mb-0">Δεν υπάρχουν καταγεγραμμένα συμβάντα.</p>';
  return `<ol class="acct-timeline" data-history>${h.map((e) => `<li><time datetime="${esc(e.at)}">${esc(fmtDate(e.at, dateTime))}</time><span>${esc(e.detail || e.type || '')}</span></li>`).join('')}</ol>`;
}

function paymentInfoHtml(o) {
  const method = o.payment?.method;
  const label = PAYMENT_LABELS[method] || o.payment?.label || '—';
  const note = method === 'iris'
    ? 'Προσομοίωση: δεν έγινε πραγματική χρέωση ή τραπεζική συναλλαγή.'
    : 'Δεν έγινε καμία online χρέωση· η πληρωμή γίνεται με αντικαταβολή στην παράδοση (demo).';
  return `<p class="mb-2"><strong>${esc(label)}</strong></p>
    <div class="acct-badges mb-2">${payBadge(o)}</div>
    <p class="conf-muted mb-0">${note}</p>`;
}

function deliveryHtml(o, settings) {
  const a = o.shippingAddress;
  const c = o.customer || {};
  const pickup = o.shipping?.method === 'pickup' || !a;
  const store = o.shipping?.pickupAddress || settings?.contact?.address || '';
  return `<p class="mb-1"><strong>${esc(o.shipping?.label || '')}</strong></p>
    ${pickup
    ? `<p class="mb-2" data-pickup-text>Παραλαβή από το κατάστημα${store ? ` (${esc(store)})` : ''}. Δεν απαιτείται διεύθυνση αποστολής.</p>`
    : `<address class="mb-2" data-shipping-address>${esc(c.firstName)} ${esc(c.lastName)}<br>${esc(a.address)}<br>${esc(a.postalCode)} ${esc(a.city)}<br>${esc(a.region)}</address>`}
    <p class="conf-muted mb-0">${esc(c.email || '')}${c.phone ? ` · ${esc(c.phone)}` : ''}</p>
    ${o.notes ? `<p class="conf-notes mt-2 mb-0"><strong>Σημειώσεις:</strong> ${esc(o.notes)}</p>` : ''}`;
}

async function orderDetail(c, id) {
  const o = await getOrder(id);
  if (!orderBelongsTo(o, c.id)) return { title: 'Η παραγγελία δεν βρέθηκε', el: notFoundOrder(id) };
  const settings = await getSettings().catch(() => ({}));
  const items = o.lines.reduce((n, l) => n + l.qty, 0);
  const el = html(`<div class="acct-detail" data-order-detail data-order-id="${esc(o.id)}">
    <p class="print-only conf-print-head">${esc(settings.storeName || 'ÉLAN Fashion Boutique')} — Παραγγελία ${esc(o.id)} (demo)</p>
    <div class="acct-detail-head">
      <p class="mb-1">Ημερομηνία: <strong>${esc(fmtDate(o.createdAt, dateTime))}</strong></p>
      <div class="acct-badges">${fulfillBadge(o)}${payBadge(o)}</div>
      <div class="acct-actions" data-no-print>
        <button type="button" class="btn btn-dark btn-sm" data-print><i class="bi bi-printer me-2" aria-hidden="true"></i>Εκτύπωση</button>
        <a class="btn btn-outline-dark btn-sm" href="#/order/${esc(o.id)}" data-confirmation-link>Προβολή επιβεβαίωσης</a>
        <a class="btn btn-link btn-sm" href="#/account/orders">← Όλες οι παραγγελίες</a>
      </div>
    </div>
    ${card('<i class="bi bi-truck" aria-hidden="true"></i>Παρακολούθηση παραγγελίας', trackingHtml(o))}
    <div class="conf-grid acct-detail-grid">
      <div class="conf-main">
        ${card(`<i class="bi bi-bag" aria-hidden="true"></i>Προϊόντα (${items})`, `<ul class="co-lines list-unstyled mb-0">${linesHtml(o)}</ul>`)}
        ${card('<i class="bi bi-clock-history" aria-hidden="true"></i>Ιστορικό', historyHtml(o))}
      </div>
      <aside class="conf-side">
        ${card('<i class="bi bi-receipt" aria-hidden="true"></i>Σύνολα', totalsHtml(o))}
        ${card('<i class="bi bi-credit-card" aria-hidden="true"></i>Πληρωμή (demo)', paymentInfoHtml(o), 'data-payment-info')}
        ${card(`<i class="bi bi-geo-alt" aria-hidden="true"></i>${o.shipping?.method === 'pickup' ? 'Παραλαβή' : 'Αποστολή'}`, deliveryHtml(o, settings))}
      </aside>
    </div>
  </div>`);
  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  return { title: `Παραγγελία ${o.id}`, el };
}

// ---------------------------------------------------------------- profile
function profilePage(c) {
  const el = html(`<form class="acct-form" data-profile-form novalidate>
    <p class="co-required-note"><span class="co-req" aria-hidden="true">*</span> Υποχρεωτικά πεδία. Τα στοιχεία αποθηκεύονται μόνο σε αυτόν τον περιηγητή.</p>
    <div class="row g-3">
      ${field('pf', { name: 'firstName', label: 'Όνομα', autocomplete: 'given-name', value: c.firstName, col: 'col-12 col-sm-6' })}
      ${field('pf', { name: 'lastName', label: 'Επώνυμο', autocomplete: 'family-name', value: c.lastName, col: 'col-12 col-sm-6' })}
      ${field('pf', { name: 'email', label: 'Email', type: 'email', autocomplete: 'email', value: c.email, hint: 'Η αλλαγή αφορά μόνο αυτό το προφίλ: οι παραγγελίες σας παραμένουν συνδεδεμένες. Στο checkout η αναγνώριση γίνεται με το email, οπότε μια παραγγελία με νέο email θα δημιουργήσει ξεχωριστό τοπικό προφίλ.' })}
      ${field('pf', { name: 'phone', label: 'Τηλέφωνο', type: 'tel', autocomplete: 'tel', inputmode: 'tel', value: c.phone, hint: 'Κινητό 69xxxxxxxx ή σταθερό 2xxxxxxxxx.' })}
      ${field('pf', { name: 'company', label: 'Εταιρεία', autocomplete: 'organization', value: c.company, required: false, col: 'col-12 col-sm-6' })}
      ${field('pf', { name: 'vatNumber', label: 'ΑΦΜ', inputmode: 'numeric', value: c.vatNumber, required: false, col: 'col-12 col-sm-6', hint: '9 ψηφία (για τιμολόγιο).' })}
    </div>
    <div class="mt-3"><button type="submit" class="btn btn-dark" data-profile-save>Αποθήκευση</button></div>
  </form>`);
  let busy = false;
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const v = readForm(el);
    if (!showErrors(el, validateProfile(v).errors)) return;
    busy = true;
    try {
      await updateProfile(c.id, v);
      toast('Το προφίλ αποθηκεύτηκε.');
      navigate(location.hash); // re-render so the profile switcher label reflects the new name/email
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') showErrors(el, { email: 'Αυτό το email υπάρχει ήδη σε άλλο τοπικό προφίλ.' });
      else { console.warn('Profile save failed', err); toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger'); }
    } finally { busy = false; }
  });
  return el;
}

// ---------------------------------------------------------------- addresses
function addressesPage(c0) {
  let c = c0;
  let editing = null; // null | 'new' | address id
  const wrap = html('<div class="acct-addresses"></div>');

  // Mutate the list inside one DB transaction. A target id that no longer exists (e.g. deleted in
  // another tab) throws ADDRESS_GONE so the caller never reports a save that did not happen.
  const persist = async (fn, targetId = null) => {
    c = await updateCustomer(c.id, (cur) => {
      const list = normalizeAddresses(cur.savedAddresses);
      if (targetId && !list.some((a) => a.id === targetId)) throw Object.assign(new Error('ADDRESS_GONE'), { code: 'ADDRESS_GONE' });
      return { ...cur, savedAddresses: fn(list), rememberDetails: true };
    });
  };
  // Run a mutation; on failure toast an error, reload the record from the DB and redraw.
  const attempt = async (fn, targetId, okMsg, focusSel) => {
    try {
      await persist(fn, targetId);
    } catch (err) {
      toast(err.code === 'ADDRESS_GONE' ? 'Η διεύθυνση δεν υπάρχει πια (ίσως διαγράφηκε αλλού). Η λίστα ανανεώθηκε.'
        : err.message === 'MAX_ADDRESSES' ? `Μπορείτε να αποθηκεύσετε έως ${MAX_ADDRESSES} διευθύνσεις.`
          : 'Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
      c = (await getCustomer(c.id)) || c;
      editing = null;
      draw('[data-address-add]');
      return false;
    }
    toast(okMsg);
    draw(focusSel);
    return true;
  };

  const formHtml = (a) => `<form class="acct-form acct-address-form" data-address-form novalidate aria-labelledby="ac-ad-title">
    <h3 class="h5" id="ac-ad-title" tabindex="-1">${editing === 'new' ? 'Νέα διεύθυνση' : 'Επεξεργασία διεύθυνσης'}</h3>
    <div class="row g-3">
      ${field('ad', { name: 'label', label: 'Ονομασία (π.χ. Σπίτι)', required: false, value: a.label, maxlength: 40 })}
      ${field('ad', { name: 'address', label: 'Διεύθυνση', autocomplete: 'street-address', value: a.address })}
      ${field('ad', { name: 'city', label: 'Πόλη', autocomplete: 'address-level2', value: a.city, col: 'col-12 col-sm-6' })}
      ${field('ad', { name: 'postalCode', label: 'Τ.Κ.', autocomplete: 'postal-code', inputmode: 'numeric', value: a.postalCode, col: 'col-12 col-sm-6' })}
      ${regionSelect('ad', a.region)}
      <div class="col-12"><div class="form-check">
        <input class="form-check-input" type="checkbox" id="ac-ad-isDefault" name="isDefault"${a.isDefault ? ' checked disabled' : ''}>
        <label class="form-check-label" for="ac-ad-isDefault">Προεπιλεγμένη διεύθυνση</label>
      </div></div>
    </div>
    <div class="d-flex flex-wrap gap-2 mt-3">
      <button type="submit" class="btn btn-dark" data-address-save>Αποθήκευση διεύθυνσης</button>
      <button type="button" class="btn btn-outline-dark" data-address-cancel>Άκυρο</button>
    </div>
  </form>`;

  const draw = (focusSel) => {
    const list = normalizeAddresses(c.savedAddresses);
    const cur = editing && editing !== 'new' ? list.find((a) => a.id === editing) : null;
    const blank = { label: '', address: '', city: '', postalCode: '', region: '', isDefault: list.length === 0 };
    wrap.innerHTML = `<p class="text-body-secondary">Οι διευθύνσεις αποθηκεύονται μόνο σε αυτόν τον περιηγητή. Η προεπιλεγμένη προτείνεται στο checkout.</p>
      ${list.length ? `<ul class="acct-address-list list-unstyled">${list.map((a, i) => `<li class="acct-address" data-address-card data-address-id="${esc(a.id)}">
        <div class="acct-address-top"><strong>${esc(a.label || `Διεύθυνση ${i + 1}`)}</strong>${a.isDefault ? '<span class="acct-badge is-ok" data-default-badge><i class="bi bi-check2" aria-hidden="true"></i>Προεπιλεγμένη</span>' : ''}</div>
        <address class="mb-2">${esc(a.address)}<br>${esc(a.postalCode)} ${esc(a.city)}<br>${esc(a.region)}</address>
        <div class="acct-address-actions">
          <button type="button" class="btn btn-outline-dark btn-sm" data-address-edit="${esc(a.id)}" aria-label="Επεξεργασία διεύθυνσης ${esc(a.label || i + 1)}">Επεξεργασία</button>
          ${a.isDefault ? '' : `<button type="button" class="btn btn-outline-dark btn-sm" data-address-default="${esc(a.id)}">Ορισμός ως προεπιλογή</button>`}
          <button type="button" class="btn btn-link btn-sm text-danger" data-address-delete="${esc(a.id)}">Διαγραφή</button>
        </div></li>`).join('')}</ul>`
    : '<div class="acct-empty" data-addresses-empty><i class="bi bi-geo-alt" aria-hidden="true"></i><h2 class="h5">Δεν έχετε αποθηκευμένες διευθύνσεις</h2><p class="text-body-secondary mb-0">Προσθέστε μία για πιο γρήγορο checkout.</p></div>'}
      ${editing ? formHtml(cur || blank) : (list.length >= MAX_ADDRESSES
    ? `<p class="conf-muted" data-addresses-full>Φτάσατε το όριο των ${MAX_ADDRESSES} αποθηκευμένων διευθύνσεων. Διαγράψτε μία για να προσθέσετε νέα.</p>`
    : '<button type="button" class="btn btn-dark mt-3" data-address-add><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Νέα διεύθυνση</button>')}`;
    if (focusSel) wrap.querySelector(focusSel)?.focus();
  };

  wrap.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-address-add]')) { editing = 'new'; draw('#ac-ad-title'); return; }
    if (t.matches('[data-address-cancel]')) { editing = null; draw('[data-address-add]'); return; }
    if (t.dataset.addressEdit) { editing = t.dataset.addressEdit; draw('#ac-ad-title'); return; }
    if (t.dataset.addressDefault) {
      const id = t.dataset.addressDefault;
      await attempt((l) => setDefaultAddress(l, id), id, 'Η προεπιλεγμένη διεύθυνση άλλαξε.', `[data-address-id="${id}"] [data-address-edit]`);
      return;
    }
    if (t.dataset.addressDelete) {
      const id = t.dataset.addressDelete;
      if (!(await confirmDialog('Θέλετε να διαγράψετε αυτή τη διεύθυνση;', { title: 'Διαγραφή διεύθυνσης', okLabel: 'Διαγραφή', danger: true }))) return;
      if (editing === id) editing = null;
      await attempt((l) => removeAddress(l, id), id, 'Η διεύθυνση διαγράφηκε.', '[data-address-add]');
    }
  });

  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target.closest('[data-address-form]');
    if (!form) return;
    const v = readForm(form);
    if (!showErrors(form, validateAddress(v).errors)) return;
    const makeDefault = form.elements.isDefault.checked || form.elements.isDefault.disabled;
    const id = editing;
    editing = null;
    await attempt((l) => (id === 'new' ? addAddress(l, v, { makeDefault }) : updateAddress(l, id, v, { makeDefault })),
      id === 'new' ? null : id, 'Η διεύθυνση αποθηκεύτηκε.', '[data-address-add]');
  });

  draw();
  return wrap;
}

// ---------------------------------------------------------------- newsletter
function newsletterPage(c) {
  const topics = c.newsletterTopics || {};
  const el = html(`<form class="acct-form" data-newsletter-form novalidate>
    <p class="alert alert-info" role="note" data-newsletter-demo>Demo: δεν αποστέλλονται πραγματικά email. Οι προτιμήσεις αποθηκεύονται μόνο σε αυτόν τον περιηγητή.</p>
    <div class="form-check form-switch mb-3">
      <input class="form-check-input" type="checkbox" role="switch" id="ac-nl-enabled" name="enabled"${c.newsletter ? ' checked' : ''}>
      <label class="form-check-label" for="ac-nl-enabled">Θέλω να λαμβάνω το newsletter</label>
    </div>
    <fieldset class="acct-topics" aria-describedby="ac-nl-topics-hint">
      <legend class="h6">Θέματα ενδιαφέροντος</legend>
      <p class="conf-muted" id="ac-nl-topics-hint">Ενεργοποιούνται όταν είναι ανοιχτό το newsletter.</p>
      <div class="form-check"><input class="form-check-input" type="checkbox" id="ac-nl-collections" name="collections"${topics.collections ? ' checked' : ''}><label class="form-check-label" for="ac-nl-collections">Νέες συλλογές</label></div>
      <div class="form-check"><input class="form-check-input" type="checkbox" id="ac-nl-offers" name="offers"${topics.offers ? ' checked' : ''}><label class="form-check-label" for="ac-nl-offers">Προσφορές</label></div>
    </fieldset>
    <div class="mt-3"><button type="submit" class="btn btn-dark" data-newsletter-save>Αποθήκευση προτιμήσεων</button></div>
  </form>`);
  const enabled = el.querySelector('#ac-nl-enabled');
  const boxes = [el.querySelector('#ac-nl-collections'), el.querySelector('#ac-nl-offers')];
  const sync = () => boxes.forEach((b) => { b.disabled = !enabled.checked; });
  enabled.addEventListener('change', sync);
  sync();
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = { collections: boxes[0].checked, offers: boxes[1].checked };
    try {
      await updateCustomer(c.id, (cur) => ({ ...cur, newsletter: enabled.checked, newsletterTopics: next }));
      toast('Οι προτιμήσεις αποθηκεύτηκαν.');
    } catch (err) {
      console.warn('Newsletter save failed', err);
      toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
    }
  });
  return el;
}

// ---------------------------------------------------------------- router entry
const TITLES = {
  overview: 'Ο λογαριασμός μου', orders: 'Οι παραγγελίες μου', profile: 'Προφίλ', addresses: 'Διευθύνσεις',
  wishlist: 'Αγαπημένα', newsletter: 'Newsletter',
};
const TABS_WITH_PAGES = ['orders', 'profile', 'addresses', 'wishlist', 'newsletter'];

// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  const parts = ctx.path.split('/').filter(Boolean).slice(1); // after 'account'
  const tab = parts[0] || 'overview';
  if (parts.length > 2 || (parts.length === 2 && tab !== 'orders') || (tab !== 'overview' && !TABS_WITH_PAGES.includes(tab))) {
    return (await import('./not-found.js')).default(ctx);
  }

  // Seeded sample customers (`sample: true`) are store data for the admin demo, not profiles of this
  // visitor: they are never offered in the switcher or as a fallback, unless this browser is already
  // using one (a checkout with a sample email attaches to it and makes it active).
  const activeId = getActiveCustomerId();
  const customers = (await listCustomers()).filter((c) => !c.sample || c.id === activeId);
  let active = await getCustomer(activeId);
  if (!active && customers.length) { // stale/missing preference: fall back to the most recently active profile
    [active] = customers;
    setActiveCustomerId(active.id);
  }

  const onSwitch = (id) => { setActiveCustomerId(id); navigate(location.hash); };
  const make = (title) => accountLayout({ tab, title, customers, active, onSwitch });

  if (tab === 'wishlist') {
    const { root, body } = make(TITLES.wishlist);
    body.append(await (await import('./wishlist.js')).default({ embedded: true }));
    return root;
  }

  if (!active) {
    const { root, body } = make(TITLES[tab]);
    body.append(emptyState());
    return root;
  }

  if (tab === 'overview' && ctx.query && ctx.query.new) {
    const { root, body } = make('Νέο τοπικό προφίλ');
    body.append(html('<p class="text-body-secondary">Δημιουργήστε ένα ακόμη προφίλ σε αυτόν τον περιηγητή. Μπορείτε να εναλλάσσεστε μεταξύ των προφίλ οποιαδήποτε στιγμή.</p>'), createForm({ cancelHref: '#/account' }));
    return root;
  }

  let title = TITLES[tab];
  let node;
  if (tab === 'overview') node = await overview(active);
  else if (tab === 'orders' && parts[1]) ({ title, el: node } = await orderDetail(active, ctx.params.id || parts[1]));
  else if (tab === 'orders') node = await ordersPage(active);
  else if (tab === 'profile') node = profilePage(active);
  else if (tab === 'addresses') node = addressesPage(active);
  else node = newsletterPage(active);

  const { root, body } = make(title);
  body.append(node);
  return root;
}
