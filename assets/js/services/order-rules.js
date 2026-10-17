// Pure order-management rules (no DB, no DOM — importable from Node). services/orders.js wraps them in
// IndexedDB transactions; the admin pages use the same functions to decide what to offer.
//
// STATE MACHINE (decided by the project owner, Task 14):
// Fulfillment
//   pending → confirmed → processing → shipped → delivered   forward jumps allowed, never backward
//   pending | confirmed | processing | shipped → cancelled   only through cancelOrder()
//   delivered → returned                                      only through returnOrder()
//   cancelled, returned: TERMINAL. Same status again: no-op (no history entry).
// Payment (independent of fulfillment)
//   pending → simulated-paid   («Σήμανση ως πληρωμένη (προσομοίωση)»), refused on cancelled/returned orders
//   simulated-paid → refunded  («Προσομοίωση επιστροφής χρημάτων»), allowed also after cancel/return
//   pending → refunded: NOT allowed. refunded: TERMINAL. Same status: no-op.
//   Cancel/return never change paymentStatus by themselves; the UI offers the refund explicitly.
// Restock (cancel/return)
//   sample orders (sample:true) and orders with restocked:true never touch stock: the seeded stock
//   already reflects them. Otherwise each SKU (duplicate lines aggregated) gets its qty back exactly
//   once; a deleted variant is skipped and noted; an archived variant is restored but stays archived.
// Aggregates
//   customer.orderCount/totalCents and coupon usedCount are NOT adjusted by cancel/return (coupon usage
//   is counted at placement). The admin Customers page (Task 15) computes displayed aggregates from orders.
import { fulfillmentLabel, paymentStatusLabel } from './account-rules.js';
import { SHIPPING_LABELS, PAYMENT_LABELS } from './checkout-rules.js';

export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
export const FULFILLMENT_CHAIN = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
export const CANCELLABLE = ['pending', 'confirmed', 'processing', 'shipped'];
export const TERMINAL = ['cancelled', 'returned'];
export const PAYMENT_STATUSES = ['pending', 'simulated-paid', 'refunded'];
export const NOTE_MAX = 1000;
export const ORDERS_PAGE_SIZE = 25;
export const ADMIN_ACTOR = 'admin-demo';

export const SAMPLE_NO_RESTOCK = 'Δείγμα παραγγελίας: χωρίς επαναφορά αποθέματος';
export const ALREADY_RESTOCKED = 'Το απόθεμα είχε ήδη επανέλθει — δεν έγινε νέα επαναφορά.';
export const missingVariantNote = (sku) => `Παραλλαγή ${sku} δεν υπάρχει πλέον — δεν επαναφέρθηκε απόθεμα`;

export class OrderError extends Error {
  /** code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'INVALID_STATUS' | 'VALIDATION' */
  constructor(code, message) {
    super(message);
    this.name = 'OrderError';
    this.code = code;
  }
}

const chainIdx = (s) => FULFILLMENT_CHAIN.indexOf(s);

/** Is `from → to` a legal fulfillment transition (same status is not a transition)? */
export function canTransitionFulfillment(from, to) {
  if (!ORDER_STATUSES.includes(from) || !ORDER_STATUSES.includes(to) || from === to) return false;
  if (to === 'cancelled') return CANCELLABLE.includes(from);
  if (to === 'returned') return from === 'delivered';
  return chainIdx(from) >= 0 && chainIdx(to) > chainIdx(from);
}

/**
 * Is `from → to` a legal payment transition? With `fulfillment` given, "mark paid" is refused on
 * cancelled/returned orders (nothing is owed); a refund of a simulated payment stays possible.
 */
export function canTransitionPayment(from, to, fulfillment) {
  if (from === 'pending' && to === 'simulated-paid') return !TERMINAL.includes(fulfillment);
  return from === 'simulated-paid' && to === 'refunded';
}

/** Forward chain steps the fulfillment control may offer (cancel/return are separate actions). */
export const nextFulfillmentSteps = (from) => FULFILLMENT_CHAIN.filter((to) => canTransitionFulfillment(from, to));

const entry = (at, type, detail, extra = {}) => ({ at, type, detail, by: ADMIN_ACTOR, ...extra });
const withHistory = (o, ...entries) => ({ ...o, history: [...(Array.isArray(o.history) ? o.history : []), ...entries] });

/** Customer-facing pages hide internal notes and stock bookkeeping. */
export const isCustomerVisibleHistory = (h) => !!h && !h.internal && h.type !== 'note' && h.type !== 'restock';

function aggregate(lines) {
  const map = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || !l.sku) continue;
    const q = Number(l.qty) || 0;
    map.set(l.sku, (map.get(l.sku) || 0) + q);
  }
  return [...map].filter(([, q]) => q > 0).map(([sku, qty]) => ({ sku, qty }));
}

/**
 * Pure restock plan for cancelling/returning `order`.
 * @param {Map|object} variantsBySku current variant records (missing key = variant deleted)
 * @returns {{updates:{sku:string,add:number,archived?:true}[], skipped:{sku:string,reason:'missing'}[], skipAll?:'sample'|'already-restocked'}}
 */
export function planRestock(order, variantsBySku) {
  if (order && order.sample === true) return { updates: [], skipped: [], skipAll: 'sample' };
  if (order && order.restocked === true) return { updates: [], skipped: [], skipAll: 'already-restocked' };
  const lookup = (sku) => (variantsBySku instanceof Map ? variantsBySku.get(sku) : variantsBySku && variantsBySku[sku]) || null;
  const updates = [];
  const skipped = [];
  for (const { sku, qty } of aggregate(order && order.lines)) {
    const v = lookup(sku);
    if (!v) skipped.push({ sku, reason: 'missing' });
    else updates.push(v.archived ? { sku, add: qty, archived: true } : { sku, add: qty });
  }
  return { updates, skipped };
}

/** Skus whose variants a cancel/return needs to read. */
export const restockSkus = (order) => aggregate(order && order.lines).map((l) => l.sku);

/**
 * Core of cancelOrder/returnOrder. Returns { changed, order, variantPuts } where variantPuts are the
 * full variant records to write. Idempotent: an order already in `target` comes back unchanged.
 */
export function applyTerminalTransition(order, target, variantsBySku, at) {
  if (!TERMINAL.includes(target)) throw new OrderError('INVALID_STATUS', 'Μη έγκυρη κατάσταση παραγγελίας.');
  const from = order.fulfillmentStatus;
  if (from === target) return { changed: false, order, variantPuts: [] };
  if (!canTransitionFulfillment(from, target)) {
    throw new OrderError('INVALID_TRANSITION', target === 'cancelled'
      ? `Η παραγγελία σε κατάσταση «${fulfillmentLabel(from)}» δεν μπορεί να ακυρωθεί.`
      : `Επιστροφή επιτρέπεται μόνο για παραδομένες παραγγελίες (τρέχουσα κατάσταση: «${fulfillmentLabel(from)}»).`);
  }
  const plan = planRestock(order, variantsBySku);
  const lookup = (sku) => (variantsBySku instanceof Map ? variantsBySku.get(sku) : variantsBySku[sku]);
  const variantPuts = plan.updates.map((u) => {
    const cur = lookup(u.sku);
    return { ...cur, stock: (Number(cur.stock) || 0) + u.add };
  });
  const entries = [entry(at, 'status', `Η κατάσταση άλλαξε σε «${fulfillmentLabel(target)}».`)];
  if (plan.skipAll === 'sample') entries.push(entry(at, 'restock', SAMPLE_NO_RESTOCK, { internal: true }));
  else if (plan.skipAll === 'already-restocked') entries.push(entry(at, 'restock', ALREADY_RESTOCKED, { internal: true }));
  else {
    if (plan.updates.length) {
      entries.push(entry(at, 'restock', `Επαναφορά αποθέματος: ${plan.updates.map((u) => `${u.sku} +${u.add}${u.archived ? ' (αρχειοθετημένη παραλλαγή)' : ''}`).join(', ')}.`, { internal: true }));
    }
    for (const s of plan.skipped) entries.push(entry(at, 'restock', missingVariantNote(s.sku), { internal: true }));
  }
  const next = withHistory({ ...order, fulfillmentStatus: target, ...(plan.skipAll ? {} : { restocked: true }) }, ...entries);
  return { changed: true, order: next, variantPuts, plan };
}

/** Forward fulfillment change (never cancelled/returned: use cancelOrder/returnOrder). */
export function applyFulfillment(order, status, at) {
  if (!ORDER_STATUSES.includes(status)) throw new OrderError('INVALID_STATUS', 'Μη έγκυρη κατάσταση παραγγελίας.');
  if (TERMINAL.includes(status)) {
    throw new OrderError('INVALID_TRANSITION', 'Η ακύρωση και η επιστροφή γίνονται μόνο από τις ειδικές ενέργειες (με επαναφορά αποθέματος).');
  }
  const from = order.fulfillmentStatus;
  if (from === status) return { changed: false, order };
  if (!canTransitionFulfillment(from, status)) {
    throw new OrderError('INVALID_TRANSITION', `Δεν επιτρέπεται η αλλαγή από «${fulfillmentLabel(from)}» σε «${fulfillmentLabel(status)}».`);
  }
  return { changed: true, order: withHistory({ ...order, fulfillmentStatus: status }, entry(at, 'status', `Η κατάσταση άλλαξε σε «${fulfillmentLabel(status)}».`)) };
}

const PAYMENT_DETAIL = {
  'simulated-paid': 'Σήμανση ως πληρωμένη (προσομοίωση) — δεν έγινε πραγματική συναλλαγή.',
  refunded: 'Προσομοίωση επιστροφής χρημάτων — δεν μεταφέρθηκαν πραγματικά χρήματα.',
};

export function applyPayment(order, status, at) {
  if (!PAYMENT_STATUSES.includes(status)) throw new OrderError('INVALID_STATUS', 'Μη έγκυρη κατάσταση πληρωμής.');
  const from = order.paymentStatus;
  if (from === status) return { changed: false, order };
  if (!canTransitionPayment(from, status, order.fulfillmentStatus)) {
    const why = status === 'simulated-paid' && TERMINAL.includes(order.fulfillmentStatus)
      ? ' Η παραγγελία έχει ακυρωθεί ή επιστραφεί.' : '';
    throw new OrderError('INVALID_TRANSITION', `Δεν επιτρέπεται η αλλαγή πληρωμής από «${paymentStatusLabel(from)}» σε «${paymentStatusLabel(status)}».${why}`);
  }
  const payment = { ...(order.payment || {}), status, ...(status === 'refunded' ? { refundedAt: at } : { simulatedAt: at }) };
  return { changed: true, order: withHistory({ ...order, paymentStatus: status, payment }, entry(at, 'payment', PAYMENT_DETAIL[status])) };
}

export function validateNoteText(text) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, value: t, error: 'Γράψτε μια σημείωση.' };
  if (t.length > NOTE_MAX) return { ok: false, value: t, error: `Η σημείωση μπορεί να έχει έως ${NOTE_MAX} χαρακτήρες.` };
  return { ok: true, value: t };
}

export function applyNote(order, text, at) {
  const v = validateNoteText(text);
  if (!v.ok) throw new OrderError('VALIDATION', v.error);
  const notes = [...(Array.isArray(order.internalNotes) ? order.internalNotes : []), { at, text: v.value, by: ADMIN_ACTOR }];
  return { changed: true, order: withHistory({ ...order, internalNotes: notes }, entry(at, 'note', 'Προστέθηκε εσωτερική σημείωση.', { internal: true })) };
}

// ------------------------------------------------------------------ list filtering
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (d) => (DAY_RE.test(d || '') ? new Date(`${d}T00:00:00`).getTime() : null);
const dayEnd = (d) => (DAY_RE.test(d || '') ? new Date(`${d}T23:59:59.999`).getTime() : null);
const total = (o) => Number(o && o.totals && o.totals.totalCents) || 0;
const created = (o) => String((o && o.createdAt) || '');

export const ORDER_SORTS = {
  newest: (a, b) => (created(a) < created(b) ? 1 : created(a) > created(b) ? -1 : 0),
  oldest: (a, b) => (created(a) < created(b) ? -1 : created(a) > created(b) ? 1 : 0),
  'total-desc': (a, b) => total(b) - total(a) || ORDER_SORTS.newest(a, b),
  'total-asc': (a, b) => total(a) - total(b) || ORDER_SORTS.newest(a, b),
};

/**
 * Filter + sort (pure). filter: { q (reference / name / email / phone, accent- and case-insensitive),
 * customerId, fulfillmentStatus, paymentStatus, paymentMethod, from, to (YYYY-MM-DD, local days,
 * inclusive), sort: newest|oldest|total-desc|total-asc }.
 */
export function filterOrders(orders, filter = {}) {
  const q = fold(filter.q);
  const from = dayStart(filter.from);
  const to = dayEnd(filter.to);
  const out = (Array.isArray(orders) ? orders : []).filter((o) => {
    if (filter.customerId && o.customerId !== filter.customerId) return false;
    if (filter.fulfillmentStatus && o.fulfillmentStatus !== filter.fulfillmentStatus) return false;
    if (filter.paymentStatus && o.paymentStatus !== filter.paymentStatus) return false;
    if (filter.paymentMethod && !(o.payment && o.payment.method === filter.paymentMethod)) return false;
    if (from !== null || to !== null) {
      const t = new Date(o.createdAt).getTime();
      if (Number.isNaN(t) || (from !== null && t < from) || (to !== null && t > to)) return false;
    }
    if (q) {
      const c = o.customer || {};
      const hay = [o.id, c.email, c.phone, `${c.firstName || ''} ${c.lastName || ''}`, `${c.lastName || ''} ${c.firstName || ''}`].map(fold);
      if (!hay.some((s) => s.includes(q))) return false;
    }
    return true;
  });
  return out.sort(ORDER_SORTS[filter.sort] || ORDER_SORTS.newest);
}

export function paginate(items, page = 1, pageSize = ORDERS_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const p = Math.min(pageCount, Math.max(1, Math.floor(Number(page) || 1)));
  return { items: list.slice((p - 1) * pageSize, p * pageSize), page: p, pageCount, total: list.length, pageSize };
}

// ------------------------------------------------------------------ CSV (RFC 4180)
export const CSV_COLUMNS = ['Αριθμός', 'Ημερομηνία (ISO)', 'Πελάτης', 'Email', 'Τηλέφωνο', 'Τρόπος αποστολής', 'Τρόπος πληρωμής',
  'Κατάσταση παραγγελίας', 'Κατάσταση πληρωμής', 'Κουπόνι', 'Υποσύνολο', 'Έκπτωση', 'Μεταφορικά', 'Αντικαταβολή', 'ΦΠΑ', 'Σύνολο', 'Προϊόντα'];

/** Money as a dot-decimal string with 2 decimals ("1234.56"): locale-neutral for spreadsheets. */
export function centsToDecimal(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * One text cell. Formula-injection defence: a value starting with = + - @ (or TAB / CR) gets a leading
 * single quote so spreadsheet apps treat it as text. Then RFC 4180 quoting when it contains a comma,
 * quote, LF or CR (inner quotes doubled).
 */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Numeric cells are generated by us (centsToDecimal) and are never prefixed. */
const numCell = (cents) => centsToDecimal(cents);

/** Join already-encoded CSV lines (CRLF line ends, trailing CRLF). Shared by the orders and customers exports. */
export const csvDocument = (lines) => `${lines.join('\r\n')}\r\n`;

/** CSV text for `orders` (CRLF line ends, no BOM — the download helper prepends U+FEFF). */
export function ordersToCsv(orders) {
  const rows = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const o of Array.isArray(orders) ? orders : []) {
    const c = o.customer || {};
    const t = o.totals || {};
    const ship = o.shipping || {};
    const pay = o.payment || {};
    rows.push([
      csvCell(o.id),
      csvCell(o.createdAt),
      csvCell(`${c.firstName || ''} ${c.lastName || ''}`.trim()),
      csvCell(c.email),
      csvCell(c.phone),
      csvCell(SHIPPING_LABELS[ship.method] || ship.label || ''),
      csvCell(PAYMENT_LABELS[pay.method] || pay.label || ''),
      csvCell(o.fulfillmentStatus ? fulfillmentLabel(o.fulfillmentStatus) : ''),
      csvCell(o.paymentStatus ? paymentStatusLabel(o.paymentStatus) : ''),
      csvCell(o.couponCode || ''),
      numCell(t.subtotalCents),
      numCell(t.discountCents),
      numCell(t.shippingCents),
      numCell(t.codFeeCents),
      numCell(t.vatIncludedCents),
      numCell(t.totalCents),
      csvCell((Array.isArray(o.lines) ? o.lines : []).map((l) => `${l.name || l.sku || ''} x ${Number(l.qty) || 0}`).join(' | ')),
    ].join(','));
  }
  return csvDocument(rows);
}

/** Local-date file name: marias-orders-YYYY-MM-DD.csv */
export function csvFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `marias-orders-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
