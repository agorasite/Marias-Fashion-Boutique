import { get } from '../db.js';

/** Case-insensitive, trimmed coupon lookup. Resolves the coupon record or null. */
export async function getCoupon(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  return (await get('coupons', c)) || null;
}
