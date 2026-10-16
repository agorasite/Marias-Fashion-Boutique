// Coupons: storefront lookup/usage (checkout) plus the admin CRUD (Task 15). The rules (validation,
// status, previews) are pure and live in coupon-rules.js; every mutation here re-reads the stored record
// inside ONE readwrite transaction and dispatches window 'coupons:changed' {code}.
import { tx, get, reqP } from '../db.js';
import { validateCouponInput, normalizeCode } from './coupon-rules.js';

export {
  validateCouponInput, couponStatus, previewDiscount, discountLabel, filterCoupons, normalizeCode, STATUS_LABELS,
  COUPON_STATUSES, COUPON_CODE_RE, SAMPLE_CART_CENTS, endOfLocalDayIso, localDateInput,
} from './coupon-rules.js';

const norm = normalizeCode;

/** Case-insensitive, trimmed coupon lookup. Resolves the coupon record or null. */
export async function getCoupon(code) {
  const c = norm(code);
  if (!c) return null;
  return (await get('coupons', c)) || null;
}

/**
 * Increment a coupon's usedCount inside the caller's readwrite transaction `t`
 * (which must include the `coupons` store). Resolves the updated record, or null if missing.
 */
export async function incrementUsage(t, code) {
  const store = t.objectStore('coupons');
  const rec = await reqP(store.get(norm(code)));
  if (!rec) return null;
  const next = { ...rec, usedCount: (Number(rec.usedCount) || 0) + 1 };
  await reqP(store.put(next));
  return next;
}

export class CouponError extends Error {
  /** code: 'invalid' (errors = field map) | 'not-found' */
  constructor(code, message, errors = {}) {
    super(message);
    this.name = 'CouponError';
    this.code = code;
    this.errors = errors;
  }
}

function emitChanged(code) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('coupons:changed', { detail: { code } }));
}

/** All coupons, sorted by code. */
export async function listCoupons() {
  const all = await tx(['coupons'], 'readonly', (t) => reqP(t.objectStore('coupons').getAll()));
  return all.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * Create or update. `input.editingCode` set = update that coupon (its code cannot change); otherwise
 * create (a code that already exists, in any letter case, is refused). The stored record is re-read inside
 * the transaction; usedCount is ALWAYS taken from the stored record (0 for a new one) — never from input.
 * Throws CouponError('invalid', …, errors) with a field -> message map.
 */
export async function saveCoupon(input, { now = new Date() } = {}) {
  const editingCode = input && input.editingCode ? norm(input.editingCode) : null;
  const saved = await tx(['coupons'], 'readwrite', async (t) => {
    const store = t.objectStore('coupons');
    const existing = editingCode ? (await reqP(store.get(editingCode))) || null : null;
    if (editingCode && !existing) throw new CouponError('not-found', 'Το κουπόνι δεν βρέθηκε.');
    const existingCodes = (await reqP(store.getAllKeys())).map(String);
    const r = validateCouponInput(input, {
      existingCodes, editingCode, usedCount: existing ? Number(existing.usedCount) || 0 : 0, currentExpiresAt: existing ? existing.expiresAt : null, now,
    });
    if (!r.ok) throw new CouponError('invalid', 'Το κουπόνι δεν είναι έγκυρο.', r.errors);
    const next = { ...(existing || {}), ...r.value, usedCount: existing ? Number(existing.usedCount) || 0 : 0 };
    await reqP(store.put(next));
    return next;
  });
  emitChanged(saved.code);
  return saved;
}

/** Activate / deactivate one coupon (one transaction). Resolves the updated record. */
export async function setCouponActive(code, active) {
  const c = norm(code);
  const next = await tx(['coupons'], 'readwrite', async (t) => {
    const store = t.objectStore('coupons');
    const cur = await reqP(store.get(c));
    if (!cur) throw new CouponError('not-found', 'Το κουπόνι δεν βρέθηκε.');
    const rec = { ...cur, active: !!active };
    if (rec.active !== cur.active) await reqP(store.put(rec));
    return rec;
  });
  emitChanged(next.code);
  return next;
}

/**
 * Delete a coupon that was never used. Refused with reason 'used' when usedCount > 0 OR any order
 * references the code (checked in the same transaction): the UI then offers deactivating instead.
 * @returns {Promise<{deleted:boolean, reason?:'used'|'not-found'}>}
 */
export async function deleteCoupon(code) {
  const c = norm(code);
  const r = await tx(['coupons', 'orders'], 'readwrite', async (t) => {
    const store = t.objectStore('coupons');
    const cur = await reqP(store.get(c));
    if (!cur) return { deleted: false, reason: 'not-found' };
    const orders = await reqP(t.objectStore('orders').getAll());
    if ((Number(cur.usedCount) || 0) > 0 || orders.some((o) => o && norm(o.couponCode) === c)) return { deleted: false, reason: 'used' };
    await reqP(store.delete(c));
    return { deleted: true };
  });
  if (r.deleted) emitChanged(c);
  return r;
}
