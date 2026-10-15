import test from 'node:test';
import assert from 'node:assert/strict';
import { clampQty, mergeLine, changeVariantLines, classifyLine, couponMessage, freeShippingProgress, pricedLines, isPriced } from '../../assets/js/services/cart-rules.js';

test('clampQty clamps to [0, stock] and floors', () => {
  assert.equal(clampQty(5, 3), 3);
  assert.equal(clampQty(2.9, 10), 2);
  assert.equal(clampQty(-4, 10), 0);
  assert.equal(clampQty('x', 10), 0);
  assert.equal(clampQty(4, 0), 0);
  assert.equal(clampQty(4, undefined), 0);
});

test('mergeLine adds a new line or sums quantities without mutating', () => {
  const a = [{ sku: 'a', qty: 1 }];
  const b = mergeLine(a, 'a', 2);
  assert.deepEqual(b, [{ sku: 'a', qty: 3 }]);
  assert.deepEqual(a, [{ sku: 'a', qty: 1 }]);
  assert.deepEqual(mergeLine(b, 'c', 1), [{ sku: 'a', qty: 3 }, { sku: 'c', qty: 1 }]);
});

test('changeVariantLines swaps the SKU in place and clips qty to the new stock', () => {
  const lines = [{ sku: 'a', qty: 4 }, { sku: 'z', qty: 1 }];
  const r = changeVariantLines(lines, 'a', 'b', 3);
  assert.deepEqual(r.lines, [{ sku: 'b', qty: 3 }, { sku: 'z', qty: 1 }]);
  assert.equal(r.qty, 3);
  assert.equal(r.clipped, true);
  assert.equal(r.merged, false);
});

test('changeVariantLines merges into an existing line, clipping the sum', () => {
  const lines = [{ sku: 'a', qty: 2 }, { sku: 'b', qty: 2 }];
  const r = changeVariantLines(lines, 'a', 'b', 3);
  assert.deepEqual(r.lines, [{ sku: 'b', qty: 3 }]);
  assert.equal(r.merged, true);
  assert.equal(r.clipped, true);
  const r2 = changeVariantLines(lines, 'a', 'b', 10);
  assert.deepEqual(r2.lines, [{ sku: 'b', qty: 4 }]);
  assert.equal(r2.clipped, false);
});

test('changeVariantLines refuses unknown line or out-of-stock target', () => {
  assert.equal(changeVariantLines([{ sku: 'a', qty: 1 }], 'q', 'b', 5).ok, false);
  const r = changeVariantLines([{ sku: 'a', qty: 1 }], 'a', 'b', 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out-of-stock');
});

test('classifyLine reports problems', () => {
  const ok = { sku: 'a', stock: 5 };
  const prod = { status: 'active' };
  assert.deepEqual(classifyLine({ qty: 2, variant: ok, product: prod }), { available: 5, problem: undefined });
  assert.equal(classifyLine({ qty: 6, variant: ok, product: prod }).problem, 'insufficient');
  assert.equal(classifyLine({ qty: 1, variant: { stock: 0 }, product: prod }).problem, 'out-of-stock');
  assert.equal(classifyLine({ qty: 1, variant: ok, product: { status: 'archived' } }).problem, 'archived');
  assert.equal(classifyLine({ qty: 1, variant: ok, product: { status: 'archived' } }).available, 0);
  assert.equal(classifyLine({ qty: 1, variant: null, product: null }).problem, 'unknown');
});

test('couponMessage gives Greek text per reason', () => {
  const f = (c) => `${c / 100} €`;
  assert.equal(couponMessage('not-found', null, f), 'Ο κωδικός δεν βρέθηκε');
  assert.equal(couponMessage('expired', null, f), 'Ο κωδικός έχει λήξει');
  assert.match(couponMessage('inactive', null, f), /δεν είναι ενεργός/);
  assert.match(couponMessage('min-spend', { minSubtotalCents: 3000 }, f), /Ελάχιστη αξία παραγγελίας 30 €/);
  assert.match(couponMessage('max-uses', null, f), /χρήσεις/);
});

test('freeShippingProgress derives pct from the quote remaining amount', () => {
  assert.deepEqual(freeShippingProgress(3000, 6000), { pct: 50, remainingCents: 3000, free: false });
  assert.deepEqual(freeShippingProgress(0, 6000), { pct: 100, remainingCents: 0, free: true });
  assert.equal(freeShippingProgress(6000, 6000).pct, 0);
  assert.equal(freeShippingProgress(0, 0).free, true);
});

test('pricedLines excludes lines that cannot be bought', () => {
  const lines = [
    { sku: 'a', qty: 2, unitCents: 100 },
    { sku: 'b', qty: 1, unitCents: 100, problem: 'out-of-stock' },
    { sku: 'c', qty: 1, unitCents: 100, problem: 'archived' },
    { sku: 'd', qty: 1, unitCents: 100, problem: 'unknown' },
    { sku: 'e', qty: 3, unitCents: 50, problem: 'insufficient' },
  ];
  assert.deepEqual(pricedLines(lines), [
    { sku: 'a', unitCents: 100, qty: 2 },
    { sku: 'e', unitCents: 50, qty: 3 },
  ]);
  assert.equal(isPriced('archived'), false);
  assert.equal(isPriced(undefined), true);
});
