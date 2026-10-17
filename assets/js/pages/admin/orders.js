// Admin order list (#/admin/orders): search, filters (fulfillment, payment status, payment method,
// date range), sort, 25 per page, colour-coded Greek badges and CSV export of the CURRENT filtered set.
// The detail page lives in orders-detail.js. Data: services/orders.js over the same IndexedDB records
// the storefront writes.
import { escapeHtml as esc, formatMoney, toast } from '../../ui.js';
import { adminLayout } from './layout.js';
import { opt, pagerHtml, followChanges } from './list-kit.js';
import { fulfillmentBadge, paymentBadge } from './overview.js';
import { fulfillmentLabel, paymentStatusLabel } from '../../services/account-rules.js';
import { PAYMENT_LABELS } from '../../services/checkout-rules.js';
import {
  listOrders, filterOrders, paginate, ordersToCsv, csvFileName, ORDER_STATUSES, PAYMENT_STATUSES, ORDERS_PAGE_SIZE,
} from '../../services/orders.js';

const SORTS = [
  ['newest', 'Νεότερες πρώτα'],
  ['oldest', 'Παλαιότερες πρώτα'],
  ['total-desc', 'Σύνολο: φθίνουσα'],
  ['total-asc', 'Σύνολο: αύξουσα'],
];
const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('el-GR', { hour: '2-digit', minute: '2-digit' });

// Module level so the filters survive a visit to an order and back.
const DEFAULT_STATE = { q: '', fulfillmentStatus: '', paymentStatus: '', paymentMethod: '', from: '', to: '', sort: 'newest', page: 1 };
let state = { ...DEFAULT_STATE };

function toolbarHtml() {
  return `<div class="admin-card admin-ord-toolbar" data-orders-toolbar>
    <div class="admin-toolbar-top">
      <div class="admin-search">
        <label class="visually-hidden" for="ol-q">Αναζήτηση παραγγελιών</label>
        <i class="bi bi-search" aria-hidden="true"></i>
        <input class="form-control" id="ol-q" type="search" placeholder="Αριθμός, όνομα ή email πελάτη" autocomplete="off" data-filter="q" value="${esc(state.q)}">
      </div>
      <button type="button" class="btn btn-dark" data-export-csv><i class="bi bi-filetype-csv me-1" aria-hidden="true"></i>Εξαγωγή CSV</button>
    </div>
    <div class="admin-ord-filters">
      <div><label class="form-label" for="ol-fs">Κατάσταση παραγγελίας</label>
        <select class="form-select form-select-sm" id="ol-fs" data-filter="fulfillmentStatus">${opt('', 'Όλες', state.fulfillmentStatus)}${ORDER_STATUSES.map((s) => opt(s, fulfillmentLabel(s), state.fulfillmentStatus)).join('')}</select></div>
      <div><label class="form-label" for="ol-ps">Κατάσταση πληρωμής</label>
        <select class="form-select form-select-sm" id="ol-ps" data-filter="paymentStatus">${opt('', 'Όλες', state.paymentStatus)}${PAYMENT_STATUSES.map((s) => opt(s, paymentStatusLabel(s), state.paymentStatus)).join('')}</select></div>
      <div><label class="form-label" for="ol-pm">Τρόπος πληρωμής</label>
        <select class="form-select form-select-sm" id="ol-pm" data-filter="paymentMethod">${opt('', 'Όλοι', state.paymentMethod)}${opt('cod', PAYMENT_LABELS.cod, state.paymentMethod)}${opt('iris', PAYMENT_LABELS.iris, state.paymentMethod)}</select></div>
      <div><label class="form-label" for="ol-from">Από</label>
        <input class="form-control form-control-sm" id="ol-from" type="date" data-filter="from" value="${esc(state.from)}"></div>
      <div><label class="form-label" for="ol-to">Έως</label>
        <input class="form-control form-control-sm" id="ol-to" type="date" data-filter="to" value="${esc(state.to)}"></div>
      <div><label class="form-label" for="ol-sort">Ταξινόμηση</label>
        <select class="form-select form-select-sm" id="ol-sort" data-filter="sort">${SORTS.map(([v, l]) => opt(v, l, state.sort)).join('')}</select></div>
    </div>
  </div>`;
}

function rowHtml(o) {
  const d = new Date(o.createdAt);
  const c = o.customer || {};
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || '—';
  const items = (o.lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0);
  const href = `#/admin/orders/${encodeURIComponent(o.id)}`;
  return `<tr data-order-id="${esc(o.id)}" data-fulfillment="${esc(o.fulfillmentStatus)}" data-payment="${esc(o.paymentStatus)}">
    <td data-label="Παραγγελία"><div><a class="admin-order-link" href="${href}">${esc(o.id)}</a></div></td>
    <td data-label="Ημερομηνία"><div><time datetime="${esc(o.createdAt)}">${Number.isNaN(d.getTime()) ? '—' : `${esc(dateFmt.format(d))}<span class="admin-time"> ${esc(timeFmt.format(d))}</span>`}</time></div></td>
    <td data-label="Πελάτης"><div><span class="admin-cust">${esc(name)}</span><span class="admin-cust-mail">${esc(c.email || '')}</span></div></td>
    <td data-label="Σύνολο" class="text-md-end admin-num" data-cell="total">${esc(formatMoney(o.totals?.totalCents || 0))}<span class="admin-ord-items">${items} τεμ. · ${esc(PAYMENT_LABELS[o.payment?.method] || o.payment?.label || '—')}</span></td>
    <td data-label="Κατάσταση"><div class="admin-badges">${fulfillmentBadge(o.fulfillmentStatus)}${paymentBadge(o.paymentStatus)}</div></td>
    <td data-label="" class="admin-ord-go"><a class="btn btn-sm btn-outline-dark" href="${href}" aria-label="Προβολή παραγγελίας ${esc(o.id)}"><span class="admin-action-label">Προβολή</span><i class="bi bi-chevron-right" aria-hidden="true"></i></a></td>
  </tr>`;
}

/** Save `text` as a UTF-8 CSV with BOM (Excel-friendly) via Blob + a[download]. */
export function downloadCsv(text, filename) {
  downloadBlob(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }), filename);
}

/** Save a Blob as a file via an object URL + a[download] (no server involved). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const currentFilter = () => ({ ...state });

export default async function render() {
  const { root, body } = adminLayout({
    active: 'orders', title: 'Παραγγελίες', view: 'orders', route: '/admin/orders', crumbs: [{ label: 'Παραγγελίες' }],
    subtitle: 'Όλες οι demo παραγγελίες αυτού του περιηγητή: αναζήτηση, φίλτρα, αλλαγή κατάστασης και εξαγωγή.',
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';

  (async () => {
    let all;
    try { all = await listOrders(); } catch (err) {
      console.warn('Order list load failed', err);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των παραγγελιών. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.innerHTML = `${toolbarHtml()}<div class="admin-card admin-ord-results" data-results aria-live="polite"></div>`;
    body.removeAttribute('aria-busy');
    const results = body.querySelector('[data-results]');

    let filtered = [];
    function paint() {
      filtered = filterOrders(all, currentFilter());
      const r = paginate(filtered, state.page, ORDERS_PAGE_SIZE);
      state.page = r.page;
      const range = state.from && state.to && state.from > state.to
        ? '<p class="admin-ord-hint" role="note" data-range-hint><i class="bi bi-exclamation-circle me-1" aria-hidden="true"></i>Η ημερομηνία «Από» είναι μετά την «Έως».</p>' : '';
      const counts = `<p class="admin-count" data-count data-total="${all.length}" data-matching="${r.total}" data-query="${esc(state.q)}"><strong>${r.total}</strong> ${r.total === 1 ? 'παραγγελία' : 'παραγγελίες'}${
        r.total !== all.length ? ` από ${all.length}` : ''}</p>`;
      body.querySelector('[data-export-csv]').disabled = r.total === 0;
      if (!all.length) {
        results.innerHTML = `<div class="admin-empty" data-empty><i class="bi bi-receipt" aria-hidden="true"></i><p>Δεν υπάρχουν ακόμη παραγγελίες σε αυτόν τον περιηγητή.</p><a class="btn btn-dark btn-sm" href="#/catalog">Δοκιμαστική αγορά στο κατάστημα</a></div>`;
        return;
      }
      if (!r.total) {
        results.innerHTML = `${counts}${range}<div class="admin-empty" data-empty><i class="bi bi-search" aria-hidden="true"></i><p>Καμία παραγγελία δεν ταιριάζει με την αναζήτηση ή τα φίλτρα.</p><button type="button" class="btn btn-outline-dark btn-sm" data-clear-filters>Καθαρισμός φίλτρων</button></div>`;
        return;
      }
      results.innerHTML = `${counts}${range}<div class="admin-table-wrap admin-ord-wrap"><table class="table admin-table admin-table-stack admin-ord-table" data-orders-table>
        <caption class="visually-hidden">Παραγγελίες</caption>
        <thead><tr><th scope="col">Παραγγελία</th><th scope="col">Ημερομηνία</th><th scope="col">Πελάτης</th><th scope="col" class="text-md-end">Σύνολο</th><th scope="col">Κατάσταση</th><th scope="col"><span class="visually-hidden">Ενέργειες</span></th></tr></thead>
        <tbody>${r.items.map(rowHtml).join('')}</tbody></table></div>${pagerHtml(r, 'Σελίδες παραγγελιών')}`;
    }

    let timer = null;
    body.addEventListener('input', (e) => {
      const el = e.target.closest('[data-filter="q"]');
      if (!el) return;
      // state follows the input at once (it survives navigating away); only the repaint is debounced
      state.q = el.value;
      state.page = 1;
      clearTimeout(timer);
      timer = setTimeout(paint, 150);
    });
    body.addEventListener('change', (e) => {
      const el = e.target.closest('[data-filter]');
      if (!el || el.dataset.filter === 'q') return;
      state[el.dataset.filter] = el.value;
      state.page = 1;
      paint();
    });
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-export-csv]')) {
        if (!filtered.length) return;
        try {
          downloadCsv(ordersToCsv(filtered), csvFileName());
          toast(`Εξήχθησαν ${filtered.length} ${filtered.length === 1 ? 'παραγγελία' : 'παραγγελίες'} σε CSV.`, 'success');
        } catch (err) {
          console.warn('CSV export failed', err);
          toast('Η εξαγωγή CSV δεν ολοκληρώθηκε.', 'danger');
        }
        return;
      }
      if (e.target.closest('[data-clear-filters]')) {
        state = { ...DEFAULT_STATE, sort: state.sort };
        body.querySelector('[data-orders-toolbar]').outerHTML = toolbarHtml();
        paint();
        body.querySelector('#ol-q').focus();
        return;
      }
      const pg = e.target.closest('[data-goto]');
      if (pg && !pg.disabled) {
        state.page = Number(pg.dataset.goto);
        paint();
        results.scrollIntoView({ block: 'start' });
      }
    });

    // status changes, cancellations, imports and new checkouts (also from the detail page or the console)
    followChanges(body, ['orders:changed'], async () => { all = await listOrders(); paint(); });

    paint();
    view.dataset.ready = 'true';
  })();
  return root;
}
