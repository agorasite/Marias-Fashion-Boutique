// Admin customer profile (#/admin/customers/:id): editable contact details (same validation as the account
// page and checkout), saved addresses (read only), stats COMPUTED from the customer's orders and the
// order history linking to the admin order pages. The id never changes, whatever is edited here.
import { escapeHtml as esc, html, formatMoney, toast } from '../../ui.js';
import { adminLayout } from './layout.js';
import { fulfillmentBadge, paymentBadge } from './overview.js';
import { fullName, SPEND_NOTE } from './customers.js';
import { getCustomer, updateCustomerAdmin } from '../../services/customers.js';
import { listOrdersForCustomer } from '../../services/orders.js';
import { customerStats } from '../../services/customer-rules.js';
import { ORDER_STATUSES } from '../../services/order-rules.js';
import { pickDefaultAddress } from '../../services/account-rules.js';

const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('el-GR', { hour: '2-digit', minute: '2-digit' });
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d); };

const card = (title, icon, inner, attrs = '') => `<section class="admin-card acu-card" ${attrs}>
  <h2 class="admin-card-title acu-card-title"><i class="bi ${icon}" aria-hidden="true"></i>${esc(title)}</h2>${inner}</section>`;

function statsHtml(s) {
  const item = (key, label, value, extra = '') => `<div class="acu-stat" data-stat-wrap="${key}"><dt>${esc(label)}</dt><dd data-stat="${key}" data-value="${esc(String(extra))}">${value}</dd></div>`;
  const chips = ORDER_STATUSES.filter((st) => s.byStatus[st] > 0).map((st) => `<li data-status-count="${st}" data-count="${s.byStatus[st]}">${fulfillmentBadge(st)}<span class="acu-chip-n">${s.byStatus[st]}</span></li>`).join('');
  return `<dl class="acu-stats">
      ${item('orders', 'Παραγγελίες', String(s.orderCount), s.orderCount)}
      ${item('spend', 'Δαπάνη', esc(formatMoney(s.spendCents)), s.spendCents)}
      ${item('average', 'Μέση παραγγελία', s.avgOrderCents ? esc(formatMoney(s.avgOrderCents)) : '—', s.avgOrderCents)}
      ${item('first', 'Πρώτη παραγγελία', s.firstOrderAt ? esc(day(s.firstOrderAt)) : '—', s.firstOrderAt || '')}
      ${item('last', 'Τελευταία παραγγελία', s.lastOrderAt ? esc(day(s.lastOrderAt)) : '—', s.lastOrderAt || '')}
    </dl>
    <p class="acu-note" data-spend-note><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${esc(SPEND_NOTE)} στη δαπάνη και στη μέση παραγγελία. Οι παραγγελίες μετρούν σε κάθε κατάσταση.</p>
    ${chips ? `<ul class="acu-status-chips" data-status-counts aria-label="Παραγγελίες ανά κατάσταση">${chips}</ul>` : ''}`;
}

function historyHtml(orders) {
  if (!orders.length) return '<div class="admin-empty" data-orders-empty><i class="bi bi-receipt" aria-hidden="true"></i><p>Ο πελάτης δεν έχει παραγγελίες ακόμη.</p></div>';
  const rows = orders.map((o) => {
    const d = new Date(o.createdAt);
    const href = `#/admin/orders/${encodeURIComponent(o.id)}`;
    return `<tr data-order-id="${esc(o.id)}" data-fulfillment="${esc(o.fulfillmentStatus)}">
      <td data-label="Παραγγελία"><div><a class="admin-order-link" href="${href}">${esc(o.id)}</a></div></td>
      <td data-label="Ημερομηνία"><div>${Number.isNaN(d.getTime()) ? '—' : `<time datetime="${esc(o.createdAt)}">${esc(dateFmt.format(d))}<span class="admin-time"> ${esc(timeFmt.format(d))}</span></time>`}</div></td>
      <td data-label="Κατάσταση"><div class="admin-badges">${fulfillmentBadge(o.fulfillmentStatus)}${paymentBadge(o.paymentStatus)}</div></td>
      <td data-label="Σύνολο" class="admin-num text-md-end">${esc(formatMoney(o.totals?.totalCents || 0))}</td>
    </tr>`;
  }).join('');
  return `<div class="admin-table-wrap acu-orders-wrap"><table class="table admin-table admin-table-stack acu-orders" data-orders-table>
    <caption class="visually-hidden">Ιστορικό παραγγελιών</caption>
    <thead><tr><th scope="col">Παραγγελία</th><th scope="col">Ημερομηνία</th><th scope="col">Κατάσταση</th><th scope="col" class="text-md-end">Σύνολο</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function addressesHtml(list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return '<p class="acu-muted mb-0" data-addresses-empty>Δεν υπάρχουν αποθηκευμένες διευθύνσεις.</p>';
  const def = pickDefaultAddress(items);
  return `<ul class="acu-addresses" data-addresses>${items.map((a) => `<li data-address-id="${esc(a.id || '')}">
    <p class="acu-addr-head"><strong>${esc(a.label || 'Διεύθυνση')}</strong>${a === def ? '<span class="admin-ord-sample acu-default">Προεπιλογή</span>' : ''}</p>
    <p class="mb-0">${esc(a.address || '')}, ${esc(a.postalCode || '')} ${esc(a.city || '')}${a.region ? `, ${esc(a.region)}` : ''}</p></li>`).join('')}</ul>
    <p class="acu-muted mt-2 mb-0">Οι διευθύνσεις διαχειρίζονται από τον ίδιο τον πελάτη στον λογαριασμό του.</p>`;
}

const FIELDS = [
  ['firstName', 'Όνομα', { col: 'col-12 col-sm-6', autocomplete: 'off' }],
  ['lastName', 'Επώνυμο', { col: 'col-12 col-sm-6', autocomplete: 'off' }],
  ['email', 'Email', { col: 'col-12', type: 'email', hint: 'Η αλλαγή αφορά μόνο το email του προφίλ· το αναγνωριστικό και οι παραγγελίες παραμένουν ίδια.' }],
  ['phone', 'Τηλέφωνο', { col: 'col-12 col-sm-6', type: 'tel', inputmode: 'tel', hint: 'Κινητό 69xxxxxxxx ή σταθερό 2xxxxxxxxx.' }],
  ['company', 'Εταιρεία', { col: 'col-12 col-sm-6' }],
  ['vatNumber', 'ΑΦΜ', { col: 'col-12 col-sm-6', inputmode: 'numeric', hint: '9 ψηφία (προαιρετικό).' }],
];

function formHtml(c) {
  const inputs = FIELDS.map(([key, label, o]) => `<div class="${o.col}" data-field-wrap="${key}">
      <label class="form-label" for="cf-${key}">${esc(label)}</label>
      <input class="form-control" id="cf-${key}" name="${key}" data-field="${key}" type="${o.type || 'text'}"${o.inputmode ? ` inputmode="${o.inputmode}"` : ''} autocomplete="off" spellcheck="false" aria-describedby="${o.hint ? `cf-${key}-hint ` : ''}cf-${key}-err" value="${esc(c[key] ?? '')}">
      ${o.hint ? `<div class="form-text" id="cf-${key}-hint">${esc(o.hint)}</div>` : ''}
      <div class="invalid-feedback" id="cf-${key}-err" data-error-for="${key}"></div></div>`).join('');
  return `<form data-customer-form novalidate>
    <div class="row g-3">${inputs}
      <div class="col-12"><div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" role="switch" id="cf-newsletter" name="newsletter" data-field="newsletter"${c.newsletter ? ' checked' : ''}>
        <label class="form-check-label" for="cf-newsletter">Εγγεγραμμένος στο newsletter</label></div></div>
    </div>
    <div class="acu-form-foot"><button type="submit" class="btn btn-dark" data-save>Αποθήκευση</button>
      <span class="acu-muted" data-id-note>Αναγνωριστικό: <code data-customer-id>${esc(c.id)}</code> (δεν αλλάζει)</span></div>
  </form>`;
}

function notFoundView(id) {
  const { root, body } = adminLayout({
    active: 'customers', title: 'Ο πελάτης δεν βρέθηκε', view: 'customer-not-found', route: '/admin/customers/:id',
    crumbs: [{ href: '#/admin/customers', label: 'Πελάτες' }, { label: 'Δεν βρέθηκε' }],
  });
  body.append(html(`<div class="admin-card admin-soon" data-customer-not-found>
    <span class="admin-soon-icon" aria-hidden="true"><i class="bi bi-person-x"></i></span>
    <p class="admin-soon-text">Δεν υπάρχει πελάτης με αναγνωριστικό <strong></strong> σε αυτόν τον περιηγητή. Μπορεί να έχει διαγραφεί ή να προέρχεται από άλλον περιηγητή.</p>
    <a class="btn btn-dark btn-sm" href="#/admin/customers">Επιστροφή στους πελάτες</a>
  </div>`));
  body.querySelector('strong').textContent = id;
  root.querySelector('[data-admin-view]').dataset.ready = 'true';
  return root;
}

export default async function render(ctx) {
  const id = String(ctx.params.id || '');
  let c = await getCustomer(id);
  if (!c) return notFoundView(id);
  const orders = await listOrdersForCustomer(id);

  const { root, body } = adminLayout({
    active: 'customers', title: fullName(c), view: 'customer-detail', route: '/admin/customers/:id',
    crumbs: [{ href: '#/admin/customers', label: 'Πελάτες' }, { label: fullName(c) }],
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.customerId = c.id;
  const title = root.querySelector('.admin-title');
  const sample = c.sample === true ? '<span class="admin-ord-sample acu-sample" data-sample-badge>Δείγμα</span>' : '';
  const stats = customerStats(c, orders);

  body.innerHTML = `<div class="acu" data-customer-profile="${esc(c.id)}">
    <div class="acu-grid">
      <div class="acu-area-stats">${card('Στατιστικά', 'bi-graph-up', statsHtml(stats), 'data-stats-card')}</div>
      <div class="acu-area-contact">${card('Στοιχεία επικοινωνίας', 'bi-person-lines-fill', `${sample ? `<p class="acu-sample-note">${sample} Πελάτης από τα δεδομένα επίδειξης.</p>` : ''}${formHtml(c)}`, 'data-contact-card')}</div>
      <div class="acu-area-addresses">${card('Αποθηκευμένες διευθύνσεις', 'bi-geo-alt', addressesHtml(c.savedAddresses), 'data-addresses-card')}</div>
      <div class="acu-area-history">${card(`Ιστορικό παραγγελιών (${orders.length})`, 'bi-clock-history', historyHtml(orders), 'data-history-card')}</div>
    </div>
    <div class="visually-hidden" role="status" aria-live="polite" data-announce></div>
  </div>`;

  const form = body.querySelector('[data-customer-form]');
  const live = body.querySelector('[data-announce]');
  const read = () => Object.fromEntries([...FIELDS.map(([k]) => [k, form.querySelector(`[data-field="${k}"]`).value]), ['newsletter', form.querySelector('[data-field="newsletter"]').checked]]);
  const clear = () => {
    form.querySelectorAll('.is-invalid').forEach((el) => { el.classList.remove('is-invalid'); el.removeAttribute('aria-invalid'); });
    form.querySelectorAll('[data-error-for]').forEach((s) => { s.textContent = ''; s.classList.remove('d-block'); });
  };
  function showErrors(errors) {
    clear();
    const keys = FIELDS.map(([k]) => k).filter((k) => errors[k]);
    keys.forEach((k) => {
      const input = form.querySelector(`[data-field="${k}"]`);
      const slot = form.querySelector(`[data-error-for="${k}"]`);
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      slot.textContent = errors[k];
      slot.classList.add('d-block');
    });
    if (keys.length) {
      form.querySelector(`[data-field="${keys[0]}"]`).focus();
      live.textContent = `Η φόρμα έχει ${keys.length} ${keys.length === 1 ? 'σφάλμα' : 'σφάλματα'}.`;
    }
    return !keys.length;
  }
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('is-invalid')) {
      t.classList.remove('is-invalid');
      t.removeAttribute('aria-invalid');
      form.querySelector(`[data-error-for="${t.dataset.field}"]`)?.classList.remove('d-block');
    }
  });
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const btn = form.querySelector('[data-save]');
    btn.disabled = true;
    try {
      c = await updateCustomerAdmin(id, read());
      clear();
      // show the stored (normalised) values back in the form
      for (const [k] of FIELDS) form.querySelector(`[data-field="${k}"]`).value = c[k] ?? '';
      title.textContent = fullName(c);
      root.querySelector('.breadcrumb-item.active').textContent = fullName(c);
      toast('Τα στοιχεία του πελάτη αποθηκεύτηκαν.', 'success');
      live.textContent = 'Τα στοιχεία του πελάτη αποθηκεύτηκαν.';
    } catch (err) {
      if (err && err.code === 'invalid') showErrors(err.errors || {});
      else if (err && err.code === 'NOT_FOUND') toast('Ο πελάτης δεν βρέθηκε πλέον.', 'danger');
      else { console.warn('Customer save failed', err); toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger'); }
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });

  view.dataset.ready = 'true';
  return root;
}
