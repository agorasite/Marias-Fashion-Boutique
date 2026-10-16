// Admin order detail (#/admin/orders/:id): status actions (only valid next steps), cancel / return with
// restock explanation, simulated payment actions, internal notes, customer and delivery info, the
// immutable line snapshot, totals, status history and a print view. Every action re-reads the order
// from IndexedDB through services/orders.js and re-renders; buttons are disabled while in flight.
import { html, escapeHtml as esc, formatMoney, toast, confirmDialog } from '../../ui.js';
import { adminLayout } from './layout.js';
import { fulfillmentBadge, paymentBadge } from './overview.js';
import { fulfillmentLabel } from '../../services/account-rules.js';
import { PAYMENT_LABELS } from '../../services/checkout-rules.js';
import { sizeLabel } from '../../services/products.js';
import { getCustomer } from '../../services/customers.js';
import { smOf } from '../../services/image-path.js';
import { totalsHtml } from '../confirmation.js';
import {
  getOrder, updateFulfillment, updatePayment, addNote, cancelOrder, returnOrder, nextFulfillmentSteps,
  canTransitionFulfillment, canTransitionPayment, NOTE_MAX,
} from '../../services/orders.js';

const dateTime = new Intl.DateTimeFormat('el-GR', { dateStyle: 'long', timeStyle: 'short' });
const fmt = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : dateTime.format(d); };

const STEP_ICON = { confirmed: 'bi-check2', processing: 'bi-box-seam', shipped: 'bi-truck', delivered: 'bi-house-check' };
const STEP_VERB = { confirmed: 'Επιβεβαίωση', processing: 'Σε προετοιμασία', shipped: 'Αποστολή', delivered: 'Παράδοση' };
const HISTORY_ICON = { created: 'bi-receipt', status: 'bi-arrow-right-circle', payment: 'bi-credit-card', 'payment-simulated': 'bi-credit-card', restock: 'bi-box-arrow-in-down', note: 'bi-sticky' };

const card = (title, body, attrs = '') => `<section class="admin-card aod-card" ${attrs}><h2 class="admin-card-title aod-card-title">${title}</h2>${body}</section>`;
const totalQty = (o) => (o.lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0);

/** Plain-language explanation of what cancel/return will do to stock (shown in the confirm dialog). */
export function restockExplanation(o) {
  if (o.sample === true) return 'Πρόκειται για δείγμα παραγγελίας (sample data): το απόθεμα ΔΕΝ θα αλλάξει, γιατί το τρέχον απόθεμα του καταλόγου δεν περιλαμβάνει αυτή την πώληση.';
  if (o.restocked === true) return 'Το απόθεμα αυτής της παραγγελίας έχει ήδη επανέλθει· δεν θα γίνει νέα επαναφορά.';
  const n = totalQty(o);
  return `Θα επανέλθουν στο απόθεμα ${n} ${n === 1 ? 'τεμάχιο' : 'τεμάχια'} (${(o.lines || []).map((l) => `${l.sku} ×${l.qty}`).join(', ')}), μία μόνο φορά. Παραλλαγές που έχουν διαγραφεί παραλείπονται· αρχειοθετημένες παραμένουν μη διαθέσιμες στο κατάστημα.`;
}

function headHtml(o) {
  return `<div class="admin-card aod-head" data-order-head>
    <div class="aod-head-main">
      <p class="aod-ref"><span class="visually-hidden">Αριθμός παραγγελίας </span><strong data-order-ref>${esc(o.id)}</strong>${o.sample ? '<span class="admin-ord-sample">δείγμα</span>' : ''}</p>
      <p class="aod-date"><time datetime="${esc(o.createdAt)}">${esc(fmt(o.createdAt))}</time> · ${totalQty(o)} τεμ. · <strong>${esc(formatMoney(o.totals?.totalCents || 0))}</strong></p>
      <div class="admin-badges" data-badges><span data-fulfillment-badge="${esc(o.fulfillmentStatus)}">${fulfillmentBadge(o.fulfillmentStatus)}</span><span data-payment-badge="${esc(o.paymentStatus)}">${paymentBadge(o.paymentStatus)}</span></div>
    </div>
    <div class="aod-head-actions" data-no-print>
      <button type="button" class="btn btn-outline-dark btn-sm" data-print><i class="bi bi-printer me-1" aria-hidden="true"></i>Εκτύπωση</button>
      <a class="btn btn-link btn-sm" href="#/admin/orders">← Όλες οι παραγγελίες</a>
    </div>
  </div>`;
}

function actionsHtml(o) {
  const steps = nextFulfillmentSteps(o.fulfillmentStatus);
  const canCancel = canTransitionFulfillment(o.fulfillmentStatus, 'cancelled');
  const canReturn = canTransitionFulfillment(o.fulfillmentStatus, 'returned');
  const terminal = ['cancelled', 'returned'].includes(o.fulfillmentStatus);
  const stepBtns = steps.map((s, i) => `<button type="button" class="btn btn-sm ${i === 0 ? 'btn-dark' : 'btn-outline-dark'}" data-set-status="${s}">
      <i class="bi ${STEP_ICON[s]} me-1" aria-hidden="true"></i>${esc(STEP_VERB[s])}<span class="visually-hidden"> (νέα κατάσταση: ${esc(fulfillmentLabel(s))})</span></button>`).join('');
  const fulfil = `<div class="aod-action-group" data-fulfillment-actions>
      <p class="aod-action-label">Κατάσταση παραγγελίας: <strong>${esc(fulfillmentLabel(o.fulfillmentStatus))}</strong></p>
      ${steps.length ? `<div class="aod-btns" role="group" aria-label="Επόμενα βήματα">${stepBtns}</div>` : ''}
      ${terminal ? '<p class="aod-muted mb-0" data-terminal-note>Τελική κατάσταση — δεν επιτρέπονται άλλες αλλαγές παράδοσης.</p>' : ''}
      ${canCancel || canReturn ? `<div class="aod-btns">
        ${canCancel ? '<button type="button" class="btn btn-sm btn-outline-danger" data-cancel-order><i class="bi bi-x-circle me-1" aria-hidden="true"></i>Ακύρωση παραγγελίας</button>' : ''}
        ${canReturn ? '<button type="button" class="btn btn-sm btn-outline-danger" data-return-order><i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Καταχώριση επιστροφής</button>' : ''}
      </div>` : ''}
    </div>`;
  const canPay = canTransitionPayment(o.paymentStatus, 'simulated-paid', o.fulfillmentStatus);
  const canRefund = canTransitionPayment(o.paymentStatus, 'refunded', o.fulfillmentStatus);
  const refundPrompt = canRefund && terminal
    ? '<p class="aod-prompt" data-refund-prompt><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Η παραγγελία έχει πληρωθεί (προσομοίωση). Καταχωρίστε επιστροφή χρημάτων αν χρειάζεται.</p>' : '';
  const pay = `<div class="aod-action-group" data-payment-actions>
      <p class="aod-action-label">Πληρωμή: <strong>${esc(PAYMENT_LABELS[o.payment?.method] || o.payment?.label || '—')}</strong> <span class="co-sim-badge">Προσομοίωση</span></p>
      ${refundPrompt}
      ${canPay || canRefund ? `<div class="aod-btns">
        ${canPay ? '<button type="button" class="btn btn-sm btn-outline-dark" data-mark-paid><i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Σήμανση ως πληρωμένη (προσομοίωση)</button>' : ''}
        ${canRefund ? `<button type="button" class="btn btn-sm ${terminal ? 'btn-dark' : 'btn-outline-dark'}" data-refund><i class="bi bi-arrow-return-left me-1" aria-hidden="true"></i>Προσομοίωση επιστροφής χρημάτων</button>` : ''}
      </div>` : `<p class="aod-muted mb-0" data-payment-final>${o.paymentStatus === 'refunded' ? 'Η επιστροφή χρημάτων καταγράφηκε (προσομοίωση).' : 'Δεν υπάρχουν διαθέσιμες ενέργειες πληρωμής.'}</p>`}
      <p class="aod-muted mb-0">Καμία ενέργεια δεν μεταφέρει πραγματικά χρήματα· όλα είναι καταγραφές demo.</p>
    </div>`;
  return card('<i class="bi bi-lightning-charge" aria-hidden="true"></i>Ενέργειες', `${fulfil}${pay}`, 'data-actions data-no-print');
}

function customerHtml(o, profileExists = true) {
  const c = o.customer || {};
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || '—';
  const body = `<dl class="aod-dl">
      <div><dt>Όνομα</dt><dd data-customer-name>${esc(name)}</dd></div>
      <div><dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd></div>
      <div><dt>Τηλέφωνο</dt><dd>${esc(c.phone || '—')}</dd></div>
      ${c.company ? `<div><dt>Εταιρεία</dt><dd>${esc(c.company)}</dd></div>` : ''}
      ${c.vatNumber ? `<div><dt>ΑΦΜ</dt><dd>${esc(c.vatNumber)}</dd></div>` : ''}
    </dl>
    ${o.customerId && profileExists ? `<a class="admin-card-link aod-link" href="#/admin/customers/${encodeURIComponent(o.customerId)}" data-customer-link data-no-print>Καρτέλα πελάτη <i class="bi bi-arrow-right" aria-hidden="true"></i></a>` : '<p class="aod-muted mb-0 mt-2" data-customer-gone>Η καρτέλα αυτού του πελάτη δεν υπάρχει πλέον· εμφανίζονται τα στοιχεία της παραγγελίας.</p>'}`;
  return card('<i class="bi bi-person" aria-hidden="true"></i>Πελάτης', body, 'data-customer-card');
}

function deliveryHtml(o) {
  const a = o.shippingAddress;
  const c = o.customer || {};
  const pickup = o.shipping?.method === 'pickup' || !a;
  const body = `<p class="mb-1"><strong>${esc(o.shipping?.label || (pickup ? 'Παραλαβή από το κατάστημα' : 'Αποστολή'))}</strong></p>
    ${pickup
    ? `<p class="mb-0" data-pickup-text>Παραλαβή από το κατάστημα${o.shipping?.pickupAddress ? ` (${esc(o.shipping.pickupAddress)})` : ''}. Δεν υπάρχει διεύθυνση αποστολής.</p>`
    : `<address class="mb-0" data-shipping-address>${esc(`${c.firstName || ''} ${c.lastName || ''}`.trim())}<br>${esc(a.address || '')}<br>${esc(a.postalCode || '')} ${esc(a.city || '')}<br>${esc(a.region || '')}</address>`}
    <p class="aod-muted mt-2 mb-0">Μεταφορικά: ${o.shipping?.costCents ? esc(formatMoney(o.shipping.costCents)) : 'Δωρεάν'}</p>
    ${o.notes ? `<p class="aod-customer-note mt-2 mb-0" data-customer-notes><strong>Σημειώσεις πελάτη:</strong> ${esc(o.notes)}</p>` : ''}`;
  return card(`<i class="bi bi-geo-alt" aria-hidden="true"></i>${pickup ? 'Παραλαβή' : 'Αποστολή'}`, body, 'data-delivery-card');
}

function itemsHtml(o) {
  const rows = (o.lines || []).map((l) => `<tr data-item="${esc(l.sku)}">
      <td data-label="Προϊόν"><div class="admin-prod">
        ${l.image ? `<img class="admin-thumb" src="${esc(smOf(l.image))}" alt="" width="40" height="52" loading="lazy">` : '<span class="admin-thumb admin-thumb-empty" aria-hidden="true">É</span>'}
        <div class="admin-prod-text"><span class="admin-prod-name">${esc(l.name || l.sku)}</span>
          <span class="admin-prod-meta">${[l.brand, l.color, l.size == null ? '' : sizeLabel(l.size)].filter(Boolean).map(esc).join(' · ')}</span>
          <span class="admin-prod-meta">SKU ${esc(l.sku)}</span></div>
      </div></td>
      <td data-label="Ποσότητα" class="admin-num text-md-center" data-cell="qty">${Number(l.qty) || 0}</td>
      <td data-label="Τιμή μονάδας" class="admin-num text-md-end">${esc(formatMoney(l.unitCents || 0))}</td>
      <td data-label="Σύνολο" class="admin-num text-md-end">${esc(formatMoney(l.lineTotalCents ?? (l.unitCents || 0) * (l.qty || 0)))}</td>
    </tr>`).join('');
  return card(`<i class="bi bi-bag" aria-hidden="true"></i>Προϊόντα (${totalQty(o)})`, `<div class="admin-table-wrap aod-items-wrap"><table class="table admin-table admin-table-stack aod-items" data-items>
      <caption class="visually-hidden">Προϊόντα παραγγελίας (στιγμιότυπο τη στιγμή της αγοράς)</caption>
      <thead><tr><th scope="col">Προϊόν</th><th scope="col" class="text-md-center">Ποσ.</th><th scope="col" class="text-md-end">Τιμή</th><th scope="col" class="text-md-end">Σύνολο</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Δεν υπάρχουν γραμμές.</td></tr>'}</tbody></table></div>
      <p class="aod-muted aod-snapshot-note mb-0">Στιγμιότυπο της στιγμής της αγοράς: αλλαγές στον κατάλογο δεν το επηρεάζουν.</p>`, 'data-items-card');
}

function totalsCard(o) {
  const method = o.payment?.method;
  const payNote = method === 'iris'
    ? 'IRIS — προσομοίωση: δεν έγινε πραγματική χρέωση ή τραπεζική συναλλαγή.'
    : `Αντικαταβολή — πληρωμή ${o.shipping?.method === 'pickup' ? 'στο κατάστημα κατά την παραλαβή' : 'στον courier κατά την παράδοση'} (demo).`;
  const safe = { ...o, totals: { subtotalCents: 0, discountCents: 0, shippingCents: 0, codFeeCents: 0, totalCents: 0, vatIncludedCents: 0, ...(o.totals || {}) }, lines: o.lines || [] };
  return card('<i class="bi bi-receipt" aria-hidden="true"></i>Σύνολα', `${totalsHtml(safe)}
    ${o.couponCode ? `<p class="aod-muted mb-1" data-coupon>Κουπόνι: <strong>${esc(o.couponCode)}</strong></p>` : ''}
    <p class="aod-muted mb-0" data-pay-note>${esc(payNote)}</p>`, 'data-totals-card');
}

function historyHtml(o) {
  const h = (Array.isArray(o.history) ? o.history : []).slice().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const body = h.length
    ? `<ol class="aod-timeline" data-history>${h.map((e) => `<li data-type="${esc(e.type || '')}">
        <span class="aod-tl-dot" aria-hidden="true"><i class="bi ${HISTORY_ICON[e.type] || 'bi-dot'}"></i></span>
        <div><p class="aod-tl-text">${esc(e.detail || e.type || '')}</p>
        <p class="aod-tl-meta"><time datetime="${esc(e.at)}">${esc(fmt(e.at))}</time>${e.by ? ' · διαχείριση (demo)' : ''}${e.internal ? ' · εσωτερικό' : ''}</p></div></li>`).join('')}</ol>`
    : '<p class="aod-muted mb-0">Δεν υπάρχουν καταγεγραμμένα συμβάντα.</p>';
  return card('<i class="bi bi-clock-history" aria-hidden="true"></i>Ιστορικό', body, 'data-history-card');
}

function notesHtml(o) {
  const notes = Array.isArray(o.internalNotes) ? o.internalNotes : [];
  const list = notes.length
    ? `<ul class="aod-notes" data-notes>${notes.slice().reverse().map((n) => `<li><p class="aod-note-text">${esc(n.text)}</p><p class="aod-tl-meta"><time datetime="${esc(n.at)}">${esc(fmt(n.at))}</time></p></li>`).join('')}</ul>`
    : '<p class="aod-muted" data-notes-empty>Δεν υπάρχουν εσωτερικές σημειώσεις.</p>';
  return card('<i class="bi bi-sticky" aria-hidden="true"></i>Εσωτερικές σημειώσεις', `${list}
    <form class="aod-note-form" data-note-form novalidate data-no-print>
      <label class="form-label" for="od-note">Νέα σημείωση <span class="aod-muted">(δεν εμφανίζεται στον πελάτη)</span></label>
      <textarea class="form-control" id="od-note" name="note" rows="3" maxlength="${NOTE_MAX + 200}" aria-describedby="od-note-help od-note-error"></textarea>
      <div class="d-flex justify-content-between align-items-start gap-2 mt-1">
        <p class="aod-muted mb-0" id="od-note-help">Έως ${NOTE_MAX} χαρακτήρες.</p>
        <p class="aod-count mb-0" data-note-count aria-hidden="true">0/${NOTE_MAX}</p>
      </div>
      <p class="invalid-feedback d-block mb-0" id="od-note-error" data-note-error hidden></p>
      <button type="submit" class="btn btn-dark btn-sm mt-2" data-note-submit>Προσθήκη σημείωσης</button>
    </form>`, 'data-notes-card');
}

function contentHtml(o, profileExists = true) {
  return `<div class="aod" data-order-detail="${esc(o.id)}">
    <p class="print-only aod-print-head">ÉLAN Fashion Boutique — Σύνοψη παραγγελίας ${esc(o.id)} (demo)</p>
    ${headHtml(o)}
    <div class="aod-grid">
      <div class="aod-main">${itemsHtml(o)}${totalsCard(o)}${historyHtml(o)}${notesHtml(o)}</div>
      <aside class="aod-side">${actionsHtml(o)}${customerHtml(o, profileExists)}${deliveryHtml(o)}</aside>
    </div>
  </div>`;
}

function notFoundView(id) {
  const { root, body } = adminLayout({
    active: 'orders', title: 'Η παραγγελία δεν βρέθηκε', view: 'order-not-found', route: '/admin/orders/:id',
    crumbs: [{ href: '#/admin/orders', label: 'Παραγγελίες' }, { label: 'Δεν βρέθηκε' }],
  });
  body.append(html(`<div class="admin-card admin-soon" data-order-not-found>
    <span class="admin-soon-icon" aria-hidden="true"><i class="bi bi-search"></i></span>
    <p class="admin-soon-text">Δεν υπάρχει παραγγελία με αριθμό <strong></strong> σε αυτόν τον περιηγητή.</p>
    <a class="btn btn-dark btn-sm" href="#/admin/orders">Όλες οι παραγγελίες</a>
  </div>`));
  body.querySelector('.admin-soon-text strong').textContent = id;
  return root;
}

const ERROR_TEXT = {
  INVALID_TRANSITION: null, // service message is already Greek and specific
  NOT_FOUND: 'Η παραγγελία δεν βρέθηκε πλέον.',
};

export default async function render(ctx) {
  const id = String(ctx.params.id || '');
  let o = await getOrder(id);
  if (!o) return notFoundView(id);

  const { root, body } = adminLayout({
    active: 'orders', title: `Παραγγελία ${o.id}`, view: 'order-detail', route: '/admin/orders/:id',
    crumbs: [{ href: '#/admin/orders', label: 'Παραγγελίες' }, { label: o.id }],
  });
  const view = root.querySelector('[data-admin-view]');
  const live = html('<div class="visually-hidden" role="status" aria-live="polite" data-announce></div>');
  let busy = false;
  // The order keeps its own customer snapshot; the profile link only shows while the customer record exists.
  const profileExists = !!(o.customerId && await getCustomer(o.customerId).catch(() => null));

  function paint(focusSel) {
    body.innerHTML = contentHtml(o, profileExists);
    body.append(live);
    view.dataset.fulfillment = o.fulfillmentStatus;
    view.dataset.payment = o.paymentStatus;
    if (focusSel) {
      const el = body.querySelector(focusSel) || body.querySelector('[data-actions] .admin-card-title');
      if (el) { if (!el.matches('button, a, textarea')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    }
  }

  function setBusy(on) {
    busy = on;
    view.dataset.busy = on ? 'true' : 'false';
    body.querySelectorAll('[data-actions] button, [data-note-form] button').forEach((b) => { b.disabled = on; });
  }

  async function run(action, successMsg, focusSel) {
    if (busy) return;
    setBusy(true);
    try {
      const before = o;
      o = await action();
      paint(focusSel);
      const msg = typeof successMsg === 'function' ? successMsg(before, o) : successMsg;
      if (msg) { toast(msg, 'success'); live.textContent = msg; }
    } catch (err) {
      if (!err || !err.code) console.warn('Order action failed', err);
      const text = (err && err.code && (ERROR_TEXT[err.code] || err.message)) || 'Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά.';
      // Re-read so the panel never shows a stale state after a rejected action.
      o = (await getOrder(o.id).catch(() => null)) || o;
      paint();
      toast(text, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const unchanged = (b, a) => b.history?.length === a.history?.length;

  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-print]');
    if (!t || t.disabled) return;
    if (t.matches('[data-print]')) { window.print(); return; }
    if (busy) return;
    if (t.matches('[data-set-status]')) {
      const s = t.dataset.setStatus;
      run(() => updateFulfillment(o.id, s), (b, a) => (unchanged(b, a)
        ? `Η παραγγελία ήταν ήδη σε κατάσταση «${fulfillmentLabel(s)}».`
        : `Η κατάσταση άλλαξε σε «${fulfillmentLabel(s)}».`), '[data-actions] .admin-card-title');
    } else if (t.matches('[data-cancel-order], [data-return-order]')) {
      const isCancel = t.matches('[data-cancel-order]');
      const ok = await confirmDialog(`${isCancel ? 'Η παραγγελία θα ακυρωθεί οριστικά.' : 'Η παραγγελία θα καταχωριστεί ως επιστραμμένη (οριστικά).'} ${restockExplanation(o)}${
        o.paymentStatus === 'simulated-paid' ? ' Η πληρωμή δεν αλλάζει αυτόματα: μπορείτε μετά να καταχωρίσετε προσομοίωση επιστροφής χρημάτων.' : ''}`, {
        title: isCancel ? `Ακύρωση παραγγελίας ${o.id}` : `Επιστροφή παραγγελίας ${o.id}`,
        okLabel: isCancel ? 'Ακύρωση παραγγελίας' : 'Καταχώριση επιστροφής',
        cancelLabel: 'Πίσω',
        danger: true,
      });
      if (!ok || !body.isConnected) return;
      run(() => (isCancel ? cancelOrder(o.id) : returnOrder(o.id)), (b, a) => {
        if (unchanged(b, a)) return 'Η παραγγελία είχε ήδη ενημερωθεί· δεν έγινε καμία αλλαγή.';
        const base = isCancel ? 'Η παραγγελία ακυρώθηκε.' : 'Η επιστροφή καταχωρίστηκε.';
        if (a.sample) return `${base} Δείγμα παραγγελίας: το απόθεμα δεν άλλαξε.`;
        return `${base} Το απόθεμα ενημερώθηκε.`;
      }, '[data-actions] .admin-card-title');
    } else if (t.matches('[data-mark-paid]')) {
      run(() => updatePayment(o.id, 'simulated-paid'), 'Η πληρωμή σημειώθηκε ως πληρωμένη (προσομοίωση).', '[data-payment-actions]');
    } else if (t.matches('[data-refund]')) {
      const ok = await confirmDialog('Θα καταγραφεί προσομοίωση επιστροφής χρημάτων. Δεν μεταφέρονται πραγματικά χρήματα. Η ενέργεια είναι οριστική.', {
        title: 'Προσομοίωση επιστροφής χρημάτων', okLabel: 'Καταγραφή επιστροφής χρημάτων', cancelLabel: 'Πίσω',
      });
      if (!ok || !body.isConnected) return;
      run(() => updatePayment(o.id, 'refunded'), 'Η επιστροφή χρημάτων καταγράφηκε (προσομοίωση).', '[data-payment-actions]');
    }
  });

  body.addEventListener('input', (e) => {
    if (e.target.id !== 'od-note') return;
    const n = e.target.value.trim().length;
    const c = body.querySelector('[data-note-count]');
    c.textContent = `${n}/${NOTE_MAX}`;
    c.classList.toggle('is-over', n > NOTE_MAX);
  });

  body.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-note-form]');
    if (!form) return;
    e.preventDefault();
    if (busy) return;
    const ta = form.elements.note;
    const err = form.querySelector('[data-note-error]');
    const text = ta.value.trim();
    const problem = !text ? 'Γράψτε μια σημείωση.' : text.length > NOTE_MAX ? `Η σημείωση μπορεί να έχει έως ${NOTE_MAX} χαρακτήρες.` : '';
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      ta.classList.add('is-invalid');
      ta.setAttribute('aria-invalid', 'true');
      ta.focus();
      return;
    }
    run(() => addNote(o.id, text), 'Η σημείωση αποθηκεύτηκε.', '#od-note');
  });

  body.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'admin-thumb admin-thumb-empty', textContent: 'É' }));
  }, true);

  paint();
  view.dataset.ready = 'true';
  return root;
}
