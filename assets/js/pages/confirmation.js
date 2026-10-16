// Order confirmation (#/order/:id). Renders entirely from the immutable order snapshot.
import { html, escapeHtml as esc, formatMoney, toast } from '../ui.js';
import { getOrder } from '../services/orders.js';
import { getSettings } from '../services/settings.js';
import { irisInstructionsError, DEFAULT_IRIS_INSTRUCTIONS } from '../services/settings-rules.js';

// Defence in depth: a stored text that fails the honesty guard (old/imported data) is never shown.
const safeIrisText = (t) => (t && irisInstructionsError(t) === '' ? t : DEFAULT_IRIS_INSTRUCTIONS);
import { confirmIrisSimulation } from '../services/checkout.js';
import { sizeLabel } from '../services/products.js';

import { smOf } from '../services/image-path.js';
const dateFmt = new Intl.DateTimeFormat('el-GR', { dateStyle: 'long', timeStyle: 'short' });

const PAYMENT_STATUS = {
  pending: { icon: 'bi-hourglass-split', cls: 'is-pending', label: (o) => `Εκκρεμεί πληρωμή${o.payment.method === 'cod' ? ' (αντικαταβολή)' : ''}` },
  'simulated-paid': { icon: 'bi-check2-circle', cls: 'is-sim-paid', label: () => 'Προσομοίωση: πληρώθηκε' },
  refunded: { icon: 'bi-arrow-counterclockwise', cls: '', label: () => 'Επιστροφή χρημάτων (προσομοίωση)' },
  failed: { icon: 'bi-x-circle', cls: 'is-failed', label: () => 'Αποτυχία πληρωμής' },
  cancelled: { icon: 'bi-slash-circle', cls: '', label: () => 'Ακυρώθηκε η πληρωμή' },
};
const UNKNOWN_STATUS = { icon: 'bi-question-circle', cls: '', label: () => 'Άγνωστη κατάσταση πληρωμής' };
const paymentLabel = (o) => (PAYMENT_STATUS[o.paymentStatus] || UNKNOWN_STATUS).label(o);

function paymentBadge(o) {
  const st = PAYMENT_STATUS[o.paymentStatus] || UNKNOWN_STATUS;
  return `<span class="conf-badge ${st.cls}" data-payment-status="${esc(o.paymentStatus)}"><i class="bi ${st.icon}" aria-hidden="true"></i>${esc(st.label(o))}</span>`;
}

const FULFILLMENT = {
  pending: 'Σε αναμονή επεξεργασίας', confirmed: 'Επιβεβαιώθηκε', processing: 'Σε επεξεργασία', shipped: 'Απεστάλη', delivered: 'Παραδόθηκε',
  cancelled: 'Ακυρώθηκε', returned: 'Επιστράφηκε',
};

function notFound(id) {
  return html(`<section class="page" data-page="confirmation" data-route="/order">
    <div class="container-xl"><div class="placeholder-panel" data-order-not-found>
      <span class="eyebrow">Παραγγελία</span>
      <h1 class="display-title">Δεν βρέθηκε η παραγγελία</h1>
      <p class="lead-text">Δεν υπάρχει παραγγελία με αριθμό <strong>${esc(id)}</strong> σε αυτόν τον περιηγητή. Οι demo παραγγελίες αποθηκεύονται μόνο τοπικά, στη συσκευή όπου δημιουργήθηκαν.</p>
      <div class="d-flex flex-wrap justify-content-center gap-2 mt-4">
        <a class="btn btn-dark" href="#/">Αρχική</a>
        <a class="btn btn-outline-dark" href="#/account/orders">Οι παραγγελίες μου</a>
      </div>
    </div></div>
  </section>`);
}

function paymentHtml(o, settings) {
  const total = esc(formatMoney(o.totals.totalCents));
  if (o.payment.method === 'cod') {
    const where = o.shipping.method === 'pickup' ? 'στο κατάστημα κατά την παραλαβή' : 'στον courier κατά την παράδοση';
    return `<div class="conf-card" data-payment-block="cod">
      <h2 class="conf-card-title"><i class="bi bi-cash-coin" aria-hidden="true"></i>Πληρωμή με αντικαταβολή</h2>
      <p>Θα πληρώσετε <strong>${total}</strong> ${where} (μετρητά ή κάρτα).${o.totals.codFeeCents ? ` Το ποσό περιλαμβάνει επιβάρυνση αντικαταβολής ${esc(formatMoney(o.totals.codFeeCents))}.` : ''}</p>
      <p class="conf-muted mb-0">Η πληρωμή καταγράφεται ως εκκρεμής μέχρι την παράδοση.</p>
    </div>`;
  }
  const closed = ['cancelled', 'returned'].includes(o.fulfillmentStatus);
  const pending = o.paymentStatus === 'pending' && !closed;
  let after = '<p class="conf-sim-done mb-0" data-iris-done><i class="bi bi-check2-circle" aria-hidden="true"></i> Η πληρωμή καταγράφηκε ως <strong>προσομοίωση</strong> — δεν έγινε πραγματική τραπεζική συναλλαγή.</p>';
  if (closed) after = '<p class="conf-muted mb-0" data-iris-closed>Η παραγγελία έχει ακυρωθεί ή επιστραφεί· δεν απαιτείται πληρωμή.</p>';
  else if (o.paymentStatus !== 'simulated-paid') after = `<p class="conf-muted mb-0">Κατάσταση πληρωμής: ${esc(paymentLabel(o))}.</p>`;
  return `<div class="conf-card conf-iris" data-payment-block="iris">
    <h2 class="conf-card-title"><i class="bi bi-phone" aria-hidden="true"></i>Πληρωμή με IRIS <span class="co-sim-badge">Προσομοίωση</span></h2>
    <p class="co-iris-flag"><i class="bi bi-shield-exclamation" aria-hidden="true"></i><strong>Προσομοίωση — δεν πραγματοποιείται πραγματική πληρωμή</strong></p>
    <p data-iris-instructions>${esc(safeIrisText(settings.irisInstructions))}</p>
    <dl class="conf-iris-details">
      <div><dt>Δικαιούχος</dt><dd>${esc(settings.storeName || 'ÉLAN Fashion Boutique')} (demo)</dd></div>
      <div><dt>Ποσό</dt><dd>${total}</dd></div>
      <div><dt>Αιτιολογία</dt><dd>${esc(o.id)}</dd></div>
      <div><dt>Κωδικός πληρωμής (προσομοίωση)</dt><dd>IRIS-DEMO-${esc(o.id.slice(-4))}</dd></div>
    </dl>
    <div data-iris-action>${pending
      ? `<button type="button" class="btn btn-dark" data-iris-simulate data-no-print>
          <span class="spinner-border spinner-border-sm me-2" aria-hidden="true" hidden data-spinner></span>Προσομοίωση πληρωμής IRIS</button>
         <p class="conf-muted mt-2 mb-0">Το κουμπί απλώς σημειώνει την πληρωμή ως προσομοιωμένη σε αυτό το demo. Δεν μεταφέρονται χρήματα.</p>`
      : after}</div>
  </div>`;
}

export function linesHtml(o) {
  return o.lines.map((l) => `<li class="co-line" data-order-line>
    <span class="co-line-media">${l.image ? `<img src="${esc(smOf(l.image))}" alt="" width="64" height="85" loading="lazy">` : ''}
      <span class="co-line-qty" aria-hidden="true">${l.qty}</span></span>
    <span class="co-line-main">
      <span class="co-line-brand">${esc(l.brand)}</span>
      <span class="co-line-name">${esc(l.name)}</span>
      <span class="co-line-variant">${[l.color, l.size == null ? '' : sizeLabel(l.size)].filter(Boolean).map(esc).join(' · ')} · ${l.qty} × ${esc(formatMoney(l.unitCents))}</span>
      <span class="co-line-sku">SKU ${esc(l.sku)}</span>
    </span>
    <span class="co-line-total">${esc(formatMoney(l.lineTotalCents))}</span>
  </li>`).join('');
}

export function totalsHtml(o) {
  const t = o.totals;
  const rate = o.vatRate ?? o.lines[0]?.vatRate ?? 0.24;
  return `<dl class="cart-totals co-totals">
    <div><dt>Υποσύνολο</dt><dd>${esc(formatMoney(t.subtotalCents))}</dd></div>
    ${t.discountCents ? `<div class="is-discount"><dt>Έκπτωση${o.couponCode ? ` (${esc(o.couponCode)})` : ''}</dt><dd>−${esc(formatMoney(t.discountCents))}</dd></div>` : ''}
    <div><dt>Μεταφορικά</dt><dd>${t.shippingCents ? esc(formatMoney(t.shippingCents)) : 'Δωρεάν'}</dd></div>
    ${t.codFeeCents ? `<div><dt>Επιβάρυνση αντικαταβολής</dt><dd>${esc(formatMoney(t.codFeeCents))}</dd></div>` : ''}
    <div class="cart-total-row"><dt>Σύνολο</dt><dd data-total>${esc(formatMoney(t.totalCents))}</dd></div>
    <div class="cart-vat"><dt>Συμπεριλαμβάνεται ΦΠΑ ${Math.round(rate * 100)}%</dt><dd>${esc(formatMoney(t.vatIncludedCents))}</dd></div>
  </dl>`;
}

function deliveryHtml(o) {
  const c = o.customer;
  const a = o.shippingAddress;
  return `<div class="conf-card">
    <h2 class="conf-card-title"><i class="bi bi-geo-alt" aria-hidden="true"></i>${o.shipping.method === 'pickup' ? 'Παραλαβή' : 'Αποστολή'}</h2>
    <p class="mb-1"><strong>${esc(o.shipping.label)}</strong></p>
    ${a ? `<address class="mb-2">${esc(c.firstName)} ${esc(c.lastName)}<br>${esc(a.address)}<br>${esc(a.postalCode)} ${esc(a.city)}<br>${esc(a.region)}</address>`
      : `<p class="mb-2">Θα σας ειδοποιήσουμε όταν η παραγγελία είναι έτοιμη για παραλαβή${o.shipping.pickupAddress ? ` από ${esc(o.shipping.pickupAddress)}` : ''}.</p>`}
    <p class="conf-muted mb-0">${esc(c.email)} · ${esc(c.phone)}${c.company ? `<br>${esc(c.company)}` : ''}${c.vatNumber ? ` · ΑΦΜ ${esc(c.vatNumber)}` : ''}</p>
    ${o.notes ? `<p class="conf-notes mt-2 mb-0"><strong>Σημειώσεις:</strong> ${esc(o.notes)}</p>` : ''}
  </div>`;
}

export default async function render(ctx) {
  const id = String(ctx.params.id || '');
  const [order, settings] = await Promise.all([getOrder(id), getSettings()]);
  if (!order) return notFound(id);
  let o = order;

  const root = html(`<section class="page confirmation-page" data-page="confirmation" data-route="/order">
    <div class="container-xl">
      <p class="print-only conf-print-head">${esc(settings.storeName || 'ÉLAN Fashion Boutique')} — Σύνοψη παραγγελίας (demo)</p>
      <header class="conf-hero">
        <span class="conf-check" aria-hidden="true"><i class="bi bi-check2"></i></span>
        <span class="eyebrow">Demo παραγγελία</span>
        <h1 class="display-title conf-title">Ευχαριστούμε, ${esc(o.customer.firstName)}!</h1>
        <p class="conf-ref">Αριθμός παραγγελίας <strong data-order-ref>${esc(o.id)}</strong></p>
        <p class="conf-date">${esc(dateFmt.format(new Date(o.createdAt)))}</p>
        <div class="conf-badges">
          <span data-payment-slot>${paymentBadge(o)}</span>
          <span class="conf-badge" data-fulfillment-status="${esc(o.fulfillmentStatus)}"><i class="bi bi-box-seam" aria-hidden="true"></i>${esc(FULFILLMENT[o.fulfillmentStatus] || o.fulfillmentStatus)}</span>
        </div>
        <div class="conf-actions" data-no-print>
          <button type="button" class="btn btn-dark" data-print><i class="bi bi-printer me-2" aria-hidden="true"></i>Εκτύπωση</button>
          <a class="btn btn-outline-dark" href="#/account/orders">Οι παραγγελίες μου</a>
          <a class="btn btn-link" href="#/catalog">Συνέχεια αγορών</a>
        </div>
      </header>
      <div class="alert alert-info conf-demo" role="note">
        <strong>Demo κατάστημα.</strong> Η παραγγελία αποθηκεύτηκε μόνο σε αυτόν τον περιηγητή. Δεν στάλθηκε email, δεν έγινε χρέωση και δεν θα αποσταλούν προϊόντα.
        Μπορείτε να τη δείτε ξανά από το <a href="#/account/orders">ιστορικό παραγγελιών</a>.
      </div>
      <div class="visually-hidden" role="status" aria-live="polite" data-announce></div>
      <div class="conf-grid">
        <div class="conf-main">
          <div data-payment-wrap>${paymentHtml(o, settings)}</div>
          <div class="conf-card">
            <h2 class="conf-card-title"><i class="bi bi-bag" aria-hidden="true"></i>Προϊόντα (${o.lines.reduce((n, l) => n + l.qty, 0)})</h2>
            <ul class="co-lines list-unstyled mb-0">${linesHtml(o)}</ul>
          </div>
        </div>
        <aside class="conf-side">
          <div class="conf-card">
            <h2 class="conf-card-title"><i class="bi bi-receipt" aria-hidden="true"></i>Σύνολα</h2>
            ${totalsHtml(o)}
            <p class="conf-muted mb-0">Τρόπος πληρωμής: ${esc(o.payment.label || o.payment.method)}</p>
          </div>
          ${deliveryHtml(o)}
        </aside>
      </div>
    </div>
  </section>`);

  root.querySelector('[data-print]').addEventListener('click', () => window.print());

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-iris-simulate]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.querySelector('[data-spinner]').hidden = false;
    try {
      o = await confirmIrisSimulation(o.id);
      root.querySelector('[data-payment-slot]').innerHTML = paymentBadge(o);
      root.querySelector('[data-payment-wrap]').innerHTML = paymentHtml(o, settings);
      root.querySelector('[data-announce]').textContent = 'Η πληρωμή IRIS καταγράφηκε ως προσομοίωση.';
      root.querySelector('[data-iris-done]')?.setAttribute('tabindex', '-1');
      root.querySelector('[data-iris-done]')?.focus();
    } catch (err) {
      console.warn('IRIS simulation failed', err);
      btn.disabled = false;
      btn.querySelector('[data-spinner]').hidden = true;
      toast('Η προσομοίωση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
    }
  });

  return root;
}
