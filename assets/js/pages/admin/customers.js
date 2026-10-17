// Admin customer list (#/admin/customers): search (name / email / phone), sort, filters, 25 per page and
// CSV export of the CURRENT filtered set. Orders and spend are COMPUTED from the orders (cancelled and
// returned orders count as orders but not as spend); the aggregates stored on the customer record are not
// shown. Rules: services/customer-rules.js. The profile page is customer-detail.js.
import { escapeHtml as esc, formatMoney, toast } from '../../ui.js';
import { adminLayout } from './layout.js';
import { opt, pagerHtml, followChanges } from './list-kit.js';
import { downloadCsv } from './orders.js';
import { loadCustomersAndOrders } from '../../services/customers.js';
import {
  buildCustomerList, filterCustomers, sortCustomers, paginate, customersToCsv, customerCsvFileName, CUSTOMERS_PAGE_SIZE,
} from '../../services/customer-rules.js';

export const SPEND_NOTE = 'Δεν περιλαμβάνονται ακυρωμένες/επιστραμμένες';
const SORTS = [
  ['name', 'Όνομα (Α–Ω)'],
  ['newest', 'Νεότεροι πρώτα'],
  ['orders', 'Περισσότερες παραγγελίες'],
  ['spend', 'Μεγαλύτερη δαπάνη'],
];
const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });

// Module level so the filters survive a visit to a profile and back.
const DEFAULT_STATE = { q: '', sort: 'name', orders: '', newsletter: '', origin: '', page: 1 };
let state = { ...DEFAULT_STATE };

export const fullName = (c) => `${c.firstName || ''} ${c.lastName || ''}`.trim() || '—';
export const profileHref = (id) => `#/admin/customers/${encodeURIComponent(id)}`;

function toolbarHtml() {
  return `<div class="admin-card admin-cu-toolbar" data-customers-toolbar>
    <div class="admin-toolbar-top">
      <div class="admin-search">
        <label class="visually-hidden" for="cu-q">Αναζήτηση πελατών</label>
        <i class="bi bi-search" aria-hidden="true"></i>
        <input class="form-control" id="cu-q" type="search" placeholder="Όνομα, email ή τηλέφωνο" autocomplete="off" data-filter="q" value="${esc(state.q)}">
      </div>
      <button type="button" class="btn btn-dark" data-export-csv><i class="bi bi-filetype-csv me-1" aria-hidden="true"></i>Εξαγωγή CSV</button>
    </div>
    <div class="admin-cu-filters">
      <div><label class="form-label" for="cu-sort">Ταξινόμηση</label>
        <select class="form-select form-select-sm" id="cu-sort" data-filter="sort">${SORTS.map(([v, l]) => opt(v, l, state.sort)).join('')}</select></div>
      <div><label class="form-label" for="cu-orders">Παραγγελίες</label>
        <select class="form-select form-select-sm" id="cu-orders" data-filter="orders">${opt('', 'Όλοι', state.orders)}${opt('with', 'Με παραγγελίες', state.orders)}${opt('without', 'Χωρίς παραγγελίες', state.orders)}</select></div>
      <div><label class="form-label" for="cu-news">Newsletter</label>
        <select class="form-select form-select-sm" id="cu-news" data-filter="newsletter">${opt('', 'Όλοι', state.newsletter)}${opt('yes', 'Εγγεγραμμένοι', state.newsletter)}${opt('no', 'Μη εγγεγραμμένοι', state.newsletter)}</select></div>
      <div><label class="form-label" for="cu-origin">Προέλευση</label>
        <select class="form-select form-select-sm" id="cu-origin" data-filter="origin">${opt('', 'Όλοι', state.origin)}${opt('sample', 'Δείγμα (demo)', state.origin)}${opt('own', 'Δικοί μου', state.origin)}</select></div>
    </div>
  </div>`;
}

function rowHtml({ customer: c, stats, city }) {
  const last = stats.lastOrderAt ? new Date(stats.lastOrderAt) : null;
  const href = profileHref(c.id);
  return `<tr data-customer-id="${esc(c.id)}" data-orders="${stats.orderCount}" data-spend="${stats.spendCents}" data-newsletter="${c.newsletter ? 'yes' : 'no'}" data-sample="${c.sample === true}">
    <td data-label="Πελάτης"><div><a class="admin-order-link admin-cu-name" href="${href}">${esc(fullName(c))}</a>${c.sample === true ? '<span class="admin-ord-sample" data-sample-badge>Δείγμα</span>' : ''}<span class="admin-cust-mail">${esc(c.email || '')}</span></div></td>
    <td data-label="Πόλη" data-cell="city">${city ? esc(city) : '<span class="admin-cp-none">—</span>'}</td>
    <td data-label="Παραγγελίες" class="admin-num text-md-end" data-cell="orders">${stats.orderCount}</td>
    <td data-label="Δαπάνη" class="admin-num text-md-end" data-cell="spend" title="${esc(SPEND_NOTE)}">${esc(formatMoney(stats.spendCents))}</td>
    <td data-label="Τελευταία παραγγελία" data-cell="last">${last && !Number.isNaN(last.getTime()) ? `<time datetime="${esc(stats.lastOrderAt)}">${esc(dateFmt.format(last))}</time>` : '<span class="admin-cp-none">—</span>'}</td>
    <td data-label="Newsletter">${c.newsletter ? '<span class="admin-badge cu-news-yes" data-news-badge="yes"><i class="bi bi-envelope-check" aria-hidden="true"></i>Εγγεγραμμένος</span>' : '<span class="admin-cp-none" data-news-badge="no">—</span>'}</td>
    <td data-label="" class="admin-ord-go"><a class="btn btn-sm btn-outline-dark" href="${href}" aria-label="Προβολή πελάτη ${esc(fullName(c))}"><span class="admin-action-label">Προβολή</span><i class="bi bi-chevron-right" aria-hidden="true"></i></a></td>
  </tr>`;
}

export default async function render() {
  const { root, body } = adminLayout({
    active: 'customers', title: 'Πελάτες', view: 'customers', route: '/admin/customers', crumbs: [{ label: 'Πελάτες' }],
    subtitle: 'Οι τοπικοί πελάτες demo αυτού του περιηγητή, με παραγγελίες και δαπάνη υπολογισμένες από τις παραγγελίες τους.',
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';

  (async () => {
    let all;
    try {
      const { customers, orders } = await loadCustomersAndOrders();
      all = buildCustomerList(customers, orders);
    } catch (err) {
      console.warn('Customer list load failed', err);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των πελατών. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.innerHTML = `${toolbarHtml()}<div class="admin-card admin-cu-results" data-results aria-live="polite"></div>`;
    body.removeAttribute('aria-busy');
    const results = body.querySelector('[data-results]');

    let filtered = [];
    function paint() {
      filtered = sortCustomers(filterCustomers(all, state), state.sort);
      const r = paginate(filtered, state.page, CUSTOMERS_PAGE_SIZE);
      state.page = r.page;
      const counts = `<p class="admin-count" data-count data-total="${all.length}" data-matching="${r.total}" data-query="${esc(state.q)}"><strong>${r.total}</strong> ${r.total === 1 ? 'πελάτης' : 'πελάτες'}${
        r.total !== all.length ? ` από ${all.length}` : ''} <span>· ${esc(SPEND_NOTE)} στη δαπάνη</span></p>`;
      body.querySelector('[data-export-csv]').disabled = r.total === 0;
      if (!all.length) {
        results.innerHTML = '<div class="admin-empty" data-empty><i class="bi bi-people" aria-hidden="true"></i><p>Δεν υπάρχουν ακόμη πελάτες σε αυτόν τον περιηγητή.</p><a class="btn btn-dark btn-sm" href="#/catalog">Δοκιμαστική αγορά στο κατάστημα</a></div>';
        return;
      }
      if (!r.total) {
        results.innerHTML = `${counts}<div class="admin-empty" data-empty><i class="bi bi-search" aria-hidden="true"></i><p>Κανένας πελάτης δεν ταιριάζει με την αναζήτηση ή τα φίλτρα.</p><button type="button" class="btn btn-outline-dark btn-sm" data-clear-filters>Καθαρισμός φίλτρων</button></div>`;
        return;
      }
      results.innerHTML = `${counts}<div class="admin-table-wrap admin-cu-wrap"><table class="table admin-table admin-table-stack admin-cu-table" data-customers-table>
        <caption class="visually-hidden">Πελάτες</caption>
        <thead><tr><th scope="col">Πελάτης</th><th scope="col">Πόλη</th><th scope="col" class="text-md-end">Παραγγελίες</th><th scope="col" class="text-md-end" title="${esc(SPEND_NOTE)}">Δαπάνη <i class="bi bi-info-circle" aria-hidden="true"></i><span class="visually-hidden"> (${esc(SPEND_NOTE)})</span></th><th scope="col">Τελευταία παραγγελία</th><th scope="col">Newsletter</th><th scope="col"><span class="visually-hidden">Ενέργειες</span></th></tr></thead>
        <tbody>${r.items.map(rowHtml).join('')}</tbody></table></div>${pagerHtml(r, 'Σελίδες πελατών')}`;
    }

    let timer = null;
    body.addEventListener('input', (e) => {
      const el = e.target.closest('[data-filter="q"]');
      if (!el) return;
      state.q = el.value; // follows the input at once (survives navigating away); only the repaint is debounced
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
          downloadCsv(customersToCsv(filtered), customerCsvFileName());
          toast(`Εξήχθησαν ${filtered.length} ${filtered.length === 1 ? 'πελάτης' : 'πελάτες'} σε CSV.`, 'success');
        } catch (err) {
          console.warn('CSV export failed', err);
          toast('Η εξαγωγή CSV δεν ολοκληρώθηκε.', 'danger');
        }
        return;
      }
      if (e.target.closest('[data-clear-filters]')) {
        state = { ...DEFAULT_STATE, sort: state.sort };
        body.querySelector('[data-customers-toolbar]').outerHTML = toolbarHtml();
        paint();
        body.querySelector('#cu-q').focus();
        return;
      }
      const pg = e.target.closest('[data-goto]');
      if (pg && !pg.disabled) {
        state.page = Number(pg.dataset.goto);
        paint();
        results.scrollIntoView({ block: 'start' });
      }
    });

    // spend/order counts derive from orders; profiles change from checkout, the account area or the admin
    followChanges(body, ['customers:changed', 'orders:changed'], async () => {
      const { customers, orders } = await loadCustomersAndOrders();
      all = buildCustomerList(customers, orders);
      paint();
    });

    paint();
    view.dataset.ready = 'true';
  })();
  return root;
}
