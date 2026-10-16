// Pure coupon (promotion) rules: no DB, no DOM, importable from Node. services/coupons.js wraps them in
// IndexedDB transactions; the admin page uses the same functions for validation, status badges and the
// live discount preview. Discount MATH is never reimplemented here: previews run pricing.quote.
//
// DECISIONS (Task 15)
// - The code is IMMUTABLE once created (the stored key, the carts that hold it and the orders that
//   reference it all use it). To "rename", create a new coupon and deactivate the old one.
// - usedCount is never taken from input; saveCoupon preserves the stored value (checkout owns it).
// - Expiry is entered as a calendar day and stored as the END of that local day (23:59:59.999), so a
//   coupon valid "until 31/12" works the whole of 31/12. Creating with a past day is refused; editing an
//   already expired coupon may keep its own date.
// - Status precedence mirrors pricing.validateCoupon: inactive, expired, exhausted (min spend is
//   cart-dependent, so it is not a coupon status).
import { eurosToCents } from './product-admin-rules.js';
import { quote } from './pricing.js';

export const COUPON_CODE_RE = /^[A-Z0-9_-]{3,20}$/;
export const COUPON_TYPES = ['percent', 'fixed'];
export const COUPON_STATUSES = ['active', 'inactive', 'expired', 'exhausted'];
export const SAMPLE_CART_CENTS = 10000;

export const normalizeCode = (v) => String(v ?? '').trim().toUpperCase();

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

/** «YYYY-MM-DD» -> ISO instant of 23:59:59.999 local time that day, or null when not a real date. */
export function endOfLocalDayIso(ymd) {
  const m = DAY_RE.exec(String(ymd ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString();
}

/** ISO instant -> local «YYYY-MM-DD» for a date input ('' when empty/invalid). */
export function localDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Validate the admin form / saveCoupon input. Pure.
 * input: { code, type, value, minSubtotal (EUR text), expiresOn (YYYY-MM-DD), maxUses, active }
 *   - value: percent integer 1–100, or fixed EUR text ("7,50", "7.5") converted to cents
 *   - usedCount (and anything else) in the input is ignored
 * opts: { existingCodes, editingCode (set when editing: the code may not change), usedCount (stored,
 *   editing), currentExpiresAt (stored, editing), now }
 * @returns {{ok:boolean, errors:Object<string,string>, value?:{code,type,value,minSubtotalCents,expiresAt,maxUses,active}}}
 */
export function validateCouponInput(input, { existingCodes = [], editingCode = null, usedCount = 0, currentExpiresAt = null, now = new Date() } = {}) {
  const d = input || {};
  const errors = {};
  const editing = editingCode ? normalizeCode(editingCode) : null;

  // code
  let code = normalizeCode(d.code);
  if (editing) {
    if (code !== editing) errors.code = 'Ο κωδικός δεν αλλάζει μετά τη δημιουργία. Δημιουργήστε νέο κουπόνι και απενεργοποιήστε το παλιό.';
    code = editing;
  } else if (!code) errors.code = 'Συμπληρώστε τον κωδικό του κουπονιού.';
  else if (!COUPON_CODE_RE.test(code)) errors.code = 'Ο κωδικός πρέπει να έχει 3–20 χαρακτήρες: λατινικά γράμματα, αριθμούς, παύλα ή κάτω παύλα.';
  else if (existingCodes.some((c) => normalizeCode(c) === code)) errors.code = 'Ο κωδικός υπάρχει ήδη (δεν έχει σημασία η γραφή με κεφαλαία/πεζά).';

  // type + value
  const type = d.type;
  let value = null;
  if (!COUPON_TYPES.includes(type)) errors.type = 'Επιλέξτε τύπο έκπτωσης.';
  else if (type === 'percent') {
    const s = String(d.value ?? '').trim().replace(/%$/, '').trim();
    if (!/^\d{1,3}$/.test(s) || Number(s) < 1 || Number(s) > 100) errors.value = 'Το ποσοστό πρέπει να είναι ακέραιος αριθμός από 1 έως 100.';
    else value = Number(s);
  } else {
    const cents = blank(d.value) ? null : eurosToCents(d.value);
    if (cents === null || cents <= 0) errors.value = 'Συμπληρώστε ποσό μεγαλύτερο από 0 (π.χ. 7,50).';
    else value = cents;
  }

  // min spend
  let minSubtotalCents = 0;
  if (!blank(d.minSubtotal)) {
    const cents = eurosToCents(d.minSubtotal);
    if (cents === null) errors.minSubtotal = 'Μη έγκυρο ποσό (π.χ. 30 ή 30,50). Αφήστε κενό για καμία ελάχιστη αξία.';
    else minSubtotalCents = cents;
  }

  // expiry
  let expiresAt = null;
  const expiresOn = d.expiresOn !== undefined ? String(d.expiresOn ?? '').trim()
    : d.expiresAt !== undefined ? localDateInput(d.expiresAt)
    : (editing ? localDateInput(currentExpiresAt) : ''); // key absent while editing: keep the stored expiry
  if (expiresOn) {
    const end = endOfLocalDayIso(expiresOn);
    if (!end) errors.expiresOn = 'Μη έγκυρη ημερομηνία λήξης.';
    else if (editing && currentExpiresAt && localDateInput(currentExpiresAt) === expiresOn) expiresAt = currentExpiresAt;
    else if (new Date(end).getTime() < now.getTime()) errors.expiresOn = 'Η ημερομηνία λήξης δεν μπορεί να είναι στο παρελθόν (από σήμερα και μετά).';
    else expiresAt = end;
  }

  // usage limit
  let maxUses = null;
  if (!blank(d.maxUses)) {
    const s = String(d.maxUses).trim();
    if (!/^\d{1,9}$/.test(s) || Number(s) < 1) errors.maxUses = 'Το όριο χρήσεων πρέπει να είναι ακέραιος αριθμός από 1. Αφήστε κενό για απεριόριστες.';
    else if (Number(s) < usedCount) errors.maxUses = `Το όριο δεν μπορεί να είναι μικρότερο από τις χρήσεις που έγιναν ήδη (${usedCount}).`;
    else maxUses = Number(s);
  }

  // active
  let active = true;
  if (d.active !== undefined) {
    if (typeof d.active !== 'boolean') errors.active = 'Μη έγκυρη κατάσταση.';
    else active = d.active;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, value: { code, type, value, minSubtotalCents, expiresAt, maxUses, active } };
}

/** 'active' | 'inactive' | 'expired' | 'exhausted' (same precedence/comparisons as pricing.validateCoupon). */
export function couponStatus(coupon, now = new Date()) {
  if (!coupon || !coupon.active) return 'inactive';
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now.getTime()) return 'expired';
  if (coupon.maxUses != null && (Number(coupon.usedCount) || 0) >= coupon.maxUses) return 'exhausted';
  return 'active';
}

export const STATUS_LABELS = { active: 'Ενεργό', inactive: 'Ανενεργό', expired: 'Έληξε', exhausted: 'Εξαντλήθηκε' };

/** «10%» or «5,00 €» (formatMoney is passed in so this module stays DOM-free). */
export function discountLabel(coupon, formatMoney) {
  return coupon.type === 'percent' ? `${coupon.value}%` : formatMoney(coupon.value);
}

const PREVIEW_SETTINGS = { vatRate: 0, courierCents: 0, freeShippingThresholdCents: 0, codFeeCents: 0 };

/**
 * What the coupon takes off a sample cart, computed by pricing.quote (never reimplemented). Active /
 * expiry / usage are neutralised so the form shows the pure discount; a min-spend shortfall is reported.
 * @returns {{subtotalCents:number, discountCents:number, totalCents:number, error:string|null}}
 */
export function previewDiscount(coupon, subtotalCents = SAMPLE_CART_CENTS) {
  const candidate = { ...coupon, active: true, expiresAt: null, maxUses: null, usedCount: 0 };
  const q = quote({
    lines: [{ sku: 'sample', unitCents: subtotalCents, qty: 1 }], coupon: candidate, shipping: null, payment: 'iris', settings: PREVIEW_SETTINGS,
  });
  return { subtotalCents: q.subtotalCents, discountCents: q.discountCents, totalCents: q.totalCents, error: q.couponError };
}

/** Search by code (trimmed, case-insensitive substring) + status filter; sorted by code. */
export function filterCoupons(list, { q = '', status = '' } = {}, now = new Date()) {
  const needle = normalizeCode(q);
  return (Array.isArray(list) ? list : [])
    .filter((c) => (!needle || normalizeCode(c.code).includes(needle)) && (!status || couponStatus(c, now) === status))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
