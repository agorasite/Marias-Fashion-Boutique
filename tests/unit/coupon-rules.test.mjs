import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCouponInput, couponStatus, previewDiscount, discountLabel, filterCoupons, endOfLocalDayIso, localDateInput,
  COUPON_CODE_RE, SAMPLE_CART_CENTS,
} from '../../assets/js/services/coupon-rules.js';
import { quote } from '../../assets/js/services/pricing.js';

const NOW = new Date(2026, 9, 16, 12, 0, 0); // local noon, 16 Oct 2026
const ok = (input, opts = {}) => validateCouponInput({ code: 'SPRING15', type: 'percent', value: '15', ...input }, { existingCodes: [], now: NOW, ...opts });
const mk = (o = {}) => ({ code: 'X', type: 'percent', value: 10, minSubtotalCents: 0, expiresAt: null, maxUses: null, usedCount: 0, active: true, ...o });

// ------------------------------------------------------------------ code
test('code is trimmed and uppercased', () => {
  const r = ok({ code: '  spring-15_a ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.code, 'SPRING-15_A');
});
test('code length 3-20 and charset A-Z 0-9 - _', () => {
  for (const bad of ['', '  ', 'AB', 'A'.repeat(21), 'ΚΩΔΙΚΟΣ', 'SPR ING', 'SPR!NG', 'A.B.C', 'ÉLAN']) {
    const r = ok({ code: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.code, JSON.stringify(bad));
  }
  for (const good of ['ABC', 'A'.repeat(20), 'A-B_C', '123', 'a1b']) assert.equal(ok({ code: good }).ok, true, good);
  assert.ok(COUPON_CODE_RE.test('ABC'));
});
test('code must be unique case-insensitively', () => {
  const r = ok({ code: ' welcome10 ' }, { existingCodes: ['WELCOME10', 'ELAN5'] });
  assert.equal(r.ok, false);
  assert.match(r.errors.code, /υπάρχει ήδη/);
  assert.equal(ok({ code: 'new1' }, { existingCodes: ['welcome10'] }).ok, true);
  assert.equal(ok({ code: 'WELCOME10' }, { existingCodes: ['welcome10'] }).ok, false);
});
test('the code is immutable once created (decision): editing cannot rename', () => {
  const r = ok({ code: 'OTHER' }, { existingCodes: ['WELCOME10'], editingCode: 'WELCOME10' });
  assert.equal(r.ok, false);
  assert.match(r.errors.code, /δεν αλλάζει/);
  const same = ok({ code: ' welcome10', value: '10' }, { existingCodes: ['WELCOME10'], editingCode: 'WELCOME10' });
  assert.equal(same.ok, true);
  assert.equal(same.value.code, 'WELCOME10');
});

// ------------------------------------------------------------------ type / value
test('type must be percent or fixed', () => {
  assert.ok(ok({ type: '' }).errors.type);
  assert.ok(ok({ type: 'bogus' }).errors.type);
  assert.ok(ok({ type: undefined }).errors.type);
});
test('percent: integer 1-100', () => {
  for (const good of ['1', '100', '15', 15, ' 20 ', '10%']) {
    const r = ok({ value: good });
    assert.equal(r.ok, true, String(good));
    assert.equal(r.value.type, 'percent');
    assert.equal(r.value.value, parseInt(String(good), 10));
  }
  for (const bad of ['', '0', '101', '-5', '10.5', '10,5', 'abc', null, undefined, NaN, '1e2']) {
    const r = ok({ value: bad });
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.errors.value, String(bad));
  }
});
test('fixed: euros with comma or dot decimals become cents (> 0)', () => {
  const cases = [['7,50', 750], ['7.5', 750], ['5', 500], ['0,01', 1], ['1.234,56', 123456], ['12 €', 1200], [7.5, 750]];
  for (const [input, cents] of cases) {
    const r = ok({ type: 'fixed', value: input });
    assert.equal(r.ok, true, String(input));
    assert.equal(r.value.value, cents, String(input));
  }
  for (const bad of ['', '0', '0,00', '-5', 'abc', '1,234', null, undefined]) {
    const r = ok({ type: 'fixed', value: bad });
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.errors.value, String(bad));
  }
});

// ------------------------------------------------------------------ min spend
test('min subtotal: optional, >= 0, euros to cents', () => {
  assert.equal(ok({}).value.minSubtotalCents, 0);
  assert.equal(ok({ minSubtotal: '' }).value.minSubtotalCents, 0);
  assert.equal(ok({ minSubtotal: '0' }).value.minSubtotalCents, 0);
  assert.equal(ok({ minSubtotal: '30,50' }).value.minSubtotalCents, 3050);
  for (const bad of ['-1', 'abc', '1,234']) {
    const r = ok({ minSubtotal: bad });
    assert.equal(r.ok, false, bad);
    assert.ok(r.errors.minSubtotal, bad);
  }
});

// ------------------------------------------------------------------ expiry
test('expiry: optional; stored as the end of that LOCAL day', () => {
  assert.equal(ok({ expiresOn: '' }).value.expiresAt, null);
  assert.equal(ok({}).value.expiresAt, null);
  const r = ok({ expiresOn: '2026-12-31' });
  assert.equal(r.ok, true);
  assert.equal(r.value.expiresAt, new Date(2026, 11, 31, 23, 59, 59, 999).toISOString());
  assert.equal(localDateInput(r.value.expiresAt), '2026-12-31');
  assert.equal(endOfLocalDayIso('2026-02-28'), new Date(2026, 1, 28, 23, 59, 59, 999).toISOString());
});
test('expiry: today is allowed, yesterday is not, garbage is not', () => {
  assert.equal(ok({ expiresOn: '2026-10-16' }).ok, true);
  const past = ok({ expiresOn: '2026-10-15' });
  assert.equal(past.ok, false);
  assert.match(past.errors.expiresOn, /παρελθόν|σήμερα/);
  for (const bad of ['2026-13-01', '2026-02-30', 'abc', '16/10/2026', '2026-1-1']) {
    assert.ok(ok({ expiresOn: bad }).errors.expiresOn, bad);
  }
});
test('expiry: an already expired coupon may keep its date when edited, but not move to another past date', () => {
  const stored = new Date(2026, 5, 30, 23, 59, 59, 999).toISOString();
  const keep = ok({ expiresOn: '2026-06-30' }, { editingCode: 'SPRING15', existingCodes: ['SPRING15'], currentExpiresAt: stored });
  assert.equal(keep.ok, true);
  assert.equal(keep.value.expiresAt, stored);
  const other = ok({ expiresOn: '2026-06-29' }, { editingCode: 'SPRING15', existingCodes: ['SPRING15'], currentExpiresAt: stored });
  assert.equal(other.ok, false);
  // creating never gets the exemption
  assert.equal(ok({ expiresOn: '2026-06-30' }, { currentExpiresAt: stored }).ok, false);
});

// ------------------------------------------------------------------ max uses
test('max uses: optional integer >= 1 and >= usedCount', () => {
  assert.equal(ok({}).value.maxUses, null);
  assert.equal(ok({ maxUses: '' }).value.maxUses, null);
  assert.equal(ok({ maxUses: '50' }).value.maxUses, 50);
  assert.equal(ok({ maxUses: 1 }).value.maxUses, 1);
  for (const bad of ['0', '-3', '2.5', 'abc', '1e1']) assert.ok(ok({ maxUses: bad }).errors.maxUses, bad);
  const low = ok({ maxUses: '5' }, { usedCount: 7, editingCode: 'SPRING15', existingCodes: ['SPRING15'] });
  assert.equal(low.ok, false);
  assert.match(low.errors.maxUses, /7/);
  assert.equal(ok({ maxUses: '7' }, { usedCount: 7, editingCode: 'SPRING15', existingCodes: ['SPRING15'] }).ok, true);
});

// ------------------------------------------------------------------ active / tamper
test('active is a boolean, defaulting to true; usedCount in the input is ignored', () => {
  assert.equal(ok({}).value.active, true);
  assert.equal(ok({ active: false }).value.active, false);
  assert.ok(ok({ active: 'yes' }).errors.active);
  const r = ok({ usedCount: 999, id: 'x', extra: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['active', 'code', 'expiresAt', 'maxUses', 'minSubtotalCents', 'type', 'value']);
});
test('several errors are reported together', () => {
  const r = validateCouponInput({ code: '!', type: 'percent', value: '0', maxUses: '0' }, { existingCodes: [], now: NOW });
  assert.deepEqual(Object.keys(r.errors).sort(), ['code', 'maxUses', 'value']);
});

// ------------------------------------------------------------------ status
test('couponStatus matrix', () => {
  const past = new Date(2026, 9, 15, 23, 59, 59).toISOString();
  const future = new Date(2026, 11, 1).toISOString();
  assert.equal(couponStatus(mk(), NOW), 'active');
  assert.equal(couponStatus(mk({ expiresAt: future }), NOW), 'active');
  assert.equal(couponStatus(mk({ active: false }), NOW), 'inactive');
  assert.equal(couponStatus(mk({ expiresAt: past }), NOW), 'expired');
  assert.equal(couponStatus(mk({ maxUses: 5, usedCount: 5 }), NOW), 'exhausted');
  assert.equal(couponStatus(mk({ maxUses: 5, usedCount: 6 }), NOW), 'exhausted');
  assert.equal(couponStatus(mk({ maxUses: 5, usedCount: 4 }), NOW), 'active');
  // precedence follows pricing.validateCoupon: inactive, then expired, then exhausted
  assert.equal(couponStatus(mk({ active: false, expiresAt: past, maxUses: 1, usedCount: 1 }), NOW), 'inactive');
  assert.equal(couponStatus(mk({ expiresAt: past, maxUses: 1, usedCount: 1 }), NOW), 'expired');
  // the boundary instant is not yet expired (pricing uses a strict <)
  assert.equal(couponStatus(mk({ expiresAt: NOW.toISOString() }), NOW), 'active');
});

// ------------------------------------------------------------------ preview (always through pricing)
test('discountLabel', () => {
  const money = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
  assert.equal(discountLabel(mk({ value: 10 }), money), '10%');
  assert.equal(discountLabel(mk({ type: 'fixed', value: 500 }), money), '5,00 €');
});
test('previewDiscount runs the real pricing quote on a €100 sample cart', () => {
  assert.equal(SAMPLE_CART_CENTS, 10000);
  assert.deepEqual(previewDiscount(mk({ value: 10 })), { subtotalCents: 10000, discountCents: 1000, totalCents: 9000, error: null });
  assert.equal(previewDiscount(mk({ value: 17 })).discountCents, 1700);
  assert.equal(previewDiscount(mk({ type: 'fixed', value: 750 })).discountCents, 750);
  // a fixed coupon larger than the cart is capped by pricing
  assert.equal(previewDiscount(mk({ type: 'fixed', value: 25000 })).discountCents, 10000);
  assert.equal(previewDiscount(mk({ value: 100 })).discountCents, 10000);
});
test('previewDiscount agrees with pricing.quote for rounding (non-round subtotal)', () => {
  for (const [value, sub] of [[15, 3333], [7, 999], [33, 10001], [12, 4999]]) {
    const direct = quote({
      lines: [{ sku: 's', unitCents: sub, qty: 1 }], coupon: mk({ value }), shipping: null, payment: 'iris',
      settings: { vatRate: 0.24, courierCents: 0, freeShippingThresholdCents: 0, codFeeCents: 0 },
    });
    assert.equal(previewDiscount(mk({ value }), sub).discountCents, direct.discountCents, `${value}% of ${sub}`);
  }
  assert.equal(previewDiscount(mk({ value: 15 }), 3333).discountCents, 500); // Math.round(499.95)
});
test('previewDiscount reports a min-spend shortfall instead of a discount', () => {
  const r = previewDiscount(mk({ value: 10, minSubtotalCents: 15000 }));
  assert.equal(r.discountCents, 0);
  assert.equal(r.error, 'min-spend');
});
test('previewDiscount ignores active/expiry/usage so the form shows the pure discount math', () => {
  assert.equal(previewDiscount(mk({ value: 10, active: false })).discountCents, 1000);
  assert.equal(previewDiscount(mk({ value: 10, expiresAt: '2000-01-01T00:00:00.000Z' })).discountCents, 1000);
  assert.equal(previewDiscount(mk({ value: 10, maxUses: 1, usedCount: 1 })).discountCents, 1000);
});

// ------------------------------------------------------------------ list filter
test('filterCoupons: search by code, status filter, sorted by code', () => {
  const past = new Date(2026, 5, 1).toISOString();
  const list = [
    mk({ code: 'ZETA' }), mk({ code: 'ALPHA', active: false }), mk({ code: 'OLD', expiresAt: past }),
    mk({ code: 'FULL', maxUses: 2, usedCount: 2 }), mk({ code: 'ALPHA2' }),
  ];
  assert.deepEqual(filterCoupons(list, {}, NOW).map((c) => c.code), ['ALPHA', 'ALPHA2', 'FULL', 'OLD', 'ZETA']);
  assert.deepEqual(filterCoupons(list, { q: ' alp ' }, NOW).map((c) => c.code), ['ALPHA', 'ALPHA2']);
  assert.deepEqual(filterCoupons(list, { status: 'active' }, NOW).map((c) => c.code), ['ALPHA2', 'ZETA']);
  assert.deepEqual(filterCoupons(list, { status: 'inactive' }, NOW).map((c) => c.code), ['ALPHA']);
  assert.deepEqual(filterCoupons(list, { status: 'expired' }, NOW).map((c) => c.code), ['OLD']);
  assert.deepEqual(filterCoupons(list, { status: 'exhausted' }, NOW).map((c) => c.code), ['FULL']);
  assert.deepEqual(filterCoupons(list, { q: 'alp', status: 'active' }, NOW).map((c) => c.code), ['ALPHA2']);
  assert.deepEqual(filterCoupons(list, { q: 'nothing' }, NOW), []);
});
