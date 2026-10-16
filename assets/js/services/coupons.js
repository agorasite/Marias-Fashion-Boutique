import { get, reqP } from '../db.js';

const norm = (code) => String(code ?? '').trim().toUpperCase();

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
