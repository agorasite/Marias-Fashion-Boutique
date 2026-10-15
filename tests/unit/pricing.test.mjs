import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, quote, validateCoupon } from '../../assets/js/services/pricing.js';

const settings = { vatRate: 0.24, courierCents: 390, freeShippingThresholdCents: 6000, codFeeCents: 200 };
const NOW = new Date('2026-10-16T12:00:00Z');
const mk = (o = {}) => ({ code: 'X', type: 'percent', value: 10, minSubtotalCents: 0, expiresAt: null, maxUses: null, usedCount: 0, active: true, ...o });
const q = (o = {}) => quote({ lines: [{ sku: 'a', unitCents: 2000, qty: 2 }], coupon: null, shipping: { method: 'courier' }, payment: 'iris', settings, ...o });

test('formatMoney el-GR EUR', () => {
  const s = formatMoney(1234);
  assert.match(s, /12,34/);
  assert.match(s, /€/);
});
test('percent discount', () => {
  const r = q({ coupon: mk({ value: 10 }) });
  assert.equal(r.subtotalCents, 4000);
  assert.equal(r.discountCents, 400);
  assert.equal(r.totalCents, 3600 + 390);
});
test('fixed discount', () => {
  const r = q({ coupon: mk({ type: 'fixed', value: 500 }) });
  assert.equal(r.discountCents, 500);
});
test('discount capped, total never negative', () => {
  const r = q({ coupon: mk({ type: 'fixed', value: 99999 }), shipping: { method: 'pickup' } });
  assert.equal(r.discountCents, 4000);
  assert.equal(r.totalCents, 0);
});
test('shipping is not discounted away', () => {
  const r = q({ coupon: mk({ type: 'fixed', value: 99999 }) });
  assert.equal(r.shippingCents, 390);
  assert.equal(r.totalCents, 390);
});
test('free courier at exactly threshold, not below', () => {
  const at = q({ lines: [{ sku: 'a', unitCents: 6000, qty: 1 }] });
  assert.equal(at.shippingCents, 0);
  assert.equal(at.freeShippingRemainingCents, 0);
  const below = q({ lines: [{ sku: 'a', unitCents: 5999, qty: 1 }] });
  assert.equal(below.shippingCents, 390);
  assert.equal(below.freeShippingRemainingCents, 1);
});
test('threshold uses subtotal after discount', () => {
  const r = q({ lines: [{ sku: 'a', unitCents: 6000, qty: 1 }], coupon: mk({ value: 10 }) });
  assert.equal(r.shippingCents, 390);
  assert.equal(r.freeShippingRemainingCents, 600);
});
test('pickup is 0 shipping and 0 remaining', () => {
  const r = q({ shipping: { method: 'pickup' } });
  assert.equal(r.shippingCents, 0);
  assert.equal(r.freeShippingRemainingCents, 0);
});
test('COD fee only for cod', () => {
  assert.equal(q({ payment: 'cod' }).codFeeCents, 200);
  assert.equal(q({ payment: 'iris' }).codFeeCents, 0);
  assert.equal(q({ payment: 'cod' }).totalCents, 4000 + 390 + 200);
});
test('VAT included', () => {
  const r = q({ payment: 'iris' });
  assert.equal(r.vatIncludedCents, r.totalCents - Math.round(r.totalCents / 1.24));
});
test('coupon rejection reasons are distinct', () => {
  assert.deepEqual(validateCoupon(mk({ active: false }), 5000, NOW), { ok: false, reason: 'inactive' });
  assert.deepEqual(validateCoupon(mk({ expiresAt: '2026-01-01T00:00:00Z' }), 5000, NOW), { ok: false, reason: 'expired' });
  assert.deepEqual(validateCoupon(mk({ minSubtotalCents: 9000 }), 5000, NOW), { ok: false, reason: 'min-spend' });
  assert.deepEqual(validateCoupon(mk({ maxUses: 3, usedCount: 3 }), 5000, NOW), { ok: false, reason: 'max-uses' });
  assert.deepEqual(validateCoupon(mk(), 5000, NOW), { ok: true });
});
test('invalid coupon in quote yields couponError and 0 discount', () => {
  const r = q({ coupon: mk({ active: false }) });
  assert.equal(r.couponError, 'inactive');
  assert.equal(r.discountCents, 0);
  assert.equal(q().couponError, null);
});
