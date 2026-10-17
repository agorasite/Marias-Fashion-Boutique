// Pure customer-management rules (no DB, no DOM — importable from Node): computed per-customer stats,
// list search/filter/sort, CSV export and the shared profile-edit validation. services/customers.js wraps
// the edit in an IndexedDB transaction; the admin pages call these functions.
//
// AGGREGATES: the orderCount/totalCents stored on a customer record are bookkeeping written at checkout
// and include cancelled/returned orders, so they are NEVER displayed by the admin. Everything shown is
// computed here from the orders:
//   orderCount = every order of the customer, in any status
//   spendCents = sum of totals.totalCents of orders that are NOT cancelled / returned
//   avgOrderCents = spend / number of orders that count (0 when none)
//   first/last order = min/max createdAt over ALL orders
import { ORDER_STATUSES, TERMINAL, fold, csvCell, csvDocument, centsToDecimal, paginate } from './order-rules.js';
import { validateProfile, pickDefaultAddress } from './account-rules.js';
import { normalizePhone, normalizeAfm } from './checkout-rules.js';

export { paginate };
export const CUSTOMERS_PAGE_SIZE = 25;

/** Canonical form used for every email comparison: trimmed, lower-case. */
export const normalizeEmail = (v) => String(v == null ? '' : v).trim().toLowerCase();

const time = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Stats for one customer from THEIR orders (the caller passes the customer's orders; the customer record
 * is accepted for symmetry but its stored aggregates are deliberately ignored).
 * @returns {{orderCount:number, spendCents:number, avgOrderCents:number, firstOrderAt:string|null, lastOrderAt:string|null, byStatus:Object<string,number>}}
 */
export function customerStats(customer, orders) {
  const list = Array.isArray(orders) ? orders : [];
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  let spendCents = 0;
  let counted = 0;
  let first = null;
  let last = null;
  for (const o of list) {
    if (!o) continue;
    if (o.fulfillmentStatus in byStatus) byStatus[o.fulfillmentStatus] += 1;
    if (!TERMINAL.includes(o.fulfillmentStatus)) {
      spendCents += Number(o.totals && o.totals.totalCents) || 0;
      counted += 1;
    }
    const t = time(o.createdAt);
    if (t !== null) {
      if (first === null || t < first.t) first = { t, iso: o.createdAt };
      if (last === null || t > last.t) last = { t, iso: o.createdAt };
    }
  }
  return {
    orderCount: list.filter(Boolean).length,
    spendCents,
    avgOrderCents: counted ? Math.round(spendCents / counted) : 0,
    firstOrderAt: first ? first.iso : null,
    lastOrderAt: last ? last.iso : null,
    byStatus,
  };
}

const newestFirst = (a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : String(a.createdAt) > String(b.createdAt) ? -1 : 0);

/** City for the list: default saved address, else any saved address, else the latest order's shipping address. */
export function customerCity(customer, orders) {
  const saved = Array.isArray(customer && customer.savedAddresses) ? customer.savedAddresses : [];
  const a = pickDefaultAddress(saved);
  if (a && a.city) return a.city;
  const withCity = saved.find((x) => x && x.city);
  if (withCity) return withCity.city;
  const o = (Array.isArray(orders) ? orders : []).filter((x) => x && x.shippingAddress && x.shippingAddress.city).sort(newestFirst)[0];
  return o ? o.shippingAddress.city : '';
}

/** Rows for the list: { customer, stats, city } with stats computed from `orders`. */
export function buildCustomerList(customers, orders) {
  const byCustomer = new Map();
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || !o.customerId) continue;
    if (!byCustomer.has(o.customerId)) byCustomer.set(o.customerId, []);
    byCustomer.get(o.customerId).push(o);
  }
  return (Array.isArray(customers) ? customers : []).map((customer) => {
    const mine = byCustomer.get(customer.id) || [];
    return { customer, stats: customerStats(customer, mine), city: customerCity(customer, mine) };
  });
}

/**
 * Filter rows. filter: { q (name / email / phone, accent- and case-insensitive), orders: ''|'with'|'without',
 * newsletter: ''|'yes'|'no', origin: ''|'sample'|'own' }.
 */
export function filterCustomers(rows, filter = {}) {
  const q = fold(filter.q);
  const qPhone = normalizePhone(filter.q);
  const phoneQuery = /^\d{3,}$/.test(qPhone) ? qPhone : '';
  return (Array.isArray(rows) ? rows : []).filter(({ customer: c, stats }) => {
    if (filter.orders === 'with' && stats.orderCount === 0) return false;
    if (filter.orders === 'without' && stats.orderCount > 0) return false;
    if (filter.newsletter === 'yes' && !c.newsletter) return false;
    if (filter.newsletter === 'no' && c.newsletter) return false;
    if (filter.origin === 'sample' && c.sample !== true) return false;
    if (filter.origin === 'own' && c.sample === true) return false;
    if (q) {
      const hay = [`${c.firstName || ''} ${c.lastName || ''}`, `${c.lastName || ''} ${c.firstName || ''}`, c.email].map(fold);
      const hit = hay.some((s) => s.includes(q)) || (phoneQuery && normalizePhone(c.phone).includes(phoneQuery)) || fold(c.phone).includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

const nameKey = (c) => `${c.lastName || ''} ${c.firstName || ''}`.trim();
const byName = (a, b) => nameKey(a.customer).localeCompare(nameKey(b.customer), 'el') || (a.customer.id < b.customer.id ? -1 : 1);
export const CUSTOMER_SORTS = {
  name: byName,
  newest: (a, b) => newestFirst(a.customer, b.customer) || byName(a, b),
  orders: (a, b) => b.stats.orderCount - a.stats.orderCount || byName(a, b),
  spend: (a, b) => b.stats.spendCents - a.stats.spendCents || byName(a, b),
};

/** Sorted copy (never mutates). Unknown sort = name. */
export function sortCustomers(rows, sort = 'name') {
  return [...(Array.isArray(rows) ? rows : [])].sort(CUSTOMER_SORTS[sort] || CUSTOMER_SORTS.name);
}

// ------------------------------------------------------------------ CSV (same RFC 4180 helpers as orders)
export const CUSTOMER_CSV_COLUMNS = ['ID', 'Όνομα', 'Επώνυμο', 'Email', 'Τηλέφωνο', 'Εταιρεία', 'ΑΦΜ', 'Πόλη', 'Παραγγελίες',
  'Δαπάνη', 'Τελευταία παραγγελία', 'Newsletter', 'Δείγμα', 'Δημιουργήθηκε'];

const yesNo = (v) => (v ? 'Ναι' : 'Όχι');

/** CSV text for list rows. Spend is the COMPUTED spend; text cells get the formula-injection prefix. */
export function customersToCsv(rows) {
  const lines = [CUSTOMER_CSV_COLUMNS.map(csvCell).join(',')];
  for (const { customer: c, stats, city } of Array.isArray(rows) ? rows : []) {
    lines.push([
      csvCell(c.id), csvCell(c.firstName), csvCell(c.lastName), csvCell(c.email), csvCell(c.phone), csvCell(c.company),
      csvCell(c.vatNumber), csvCell(city), String(stats.orderCount), centsToDecimal(stats.spendCents),
      csvCell(stats.lastOrderAt || ''), csvCell(yesNo(c.newsletter)), csvCell(yesNo(c.sample === true)), csvCell(c.createdAt || ''),
    ].join(','));
  }
  return csvDocument(lines);
}

/** Local-date file name: marias-customers-YYYY-MM-DD.csv */
export function customerCsvFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `marias-customers-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}

// ------------------------------------------------------------------ editing
export const EDITABLE_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'company', 'vatNumber', 'newsletter'];

/**
 * Validate + normalise an admin edit of customer `cur`. Only EDITABLE_FIELDS are read from `patch` (the
 * id, aggregates, addresses, sample flag… can never be changed here). Validation is the account/checkout
 * rule set (validateProfile), so both UIs agree. Email uniqueness needs the other customers and is
 * checked by the service inside its transaction.
 * @returns {{ok:boolean, errors:Object<string,string>, value?:object}}
 */
export function buildCustomerUpdate(cur, patch) {
  const base = cur || {};
  const p = patch || {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(p, k) ? p[k] : base[k]);
  const merged = {
    firstName: pick('firstName'), lastName: pick('lastName'), email: pick('email'), phone: pick('phone'), company: pick('company'), vatNumber: pick('vatNumber'),
  };
  const v = validateProfile(merged);
  if (!v.ok) return { ok: false, errors: v.errors };
  return {
    ok: true,
    errors: {},
    value: {
      firstName: String(merged.firstName || '').trim(),
      lastName: String(merged.lastName || '').trim(),
      email: normalizeEmail(merged.email),
      phone: normalizePhone(merged.phone),
      company: String(pick('company') || '').trim(),
      vatNumber: normalizeAfm(merged.vatNumber),
      newsletter: Object.prototype.hasOwnProperty.call(p, 'newsletter') ? !!p.newsletter : !!base.newsletter,
    },
  };
}
