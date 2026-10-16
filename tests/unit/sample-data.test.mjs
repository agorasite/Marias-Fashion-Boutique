import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { quote, validateCoupon } from '../../assets/js/services/pricing.js';
import { customerIdFromEmail, ORDER_ID_RE, isValidPhone, REGIONS, validateCheckoutForm } from '../../assets/js/services/checkout-rules.js';
import { normalizeAddresses } from '../../assets/js/services/account-rules.js';
import { shiftSampleData, withCouponUsage, DAY_MS } from '../../assets/js/services/sample-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const data = read('data/sample-data.json');
const { products } = read('data/products.json');
const meta = read('data/catalog-meta.json');
const S = meta.settings;
const productById = new Map(products.map((p) => [p.id, p]));
const variantBySku = new Map(products.flatMap((p) => p.variants.map((v) => [v.sku, { ...v, productId: p.id }])));
const couponByCode = new Map(meta.coupons.map((c) => [c.code, c]));
const { orders, customers } = data;
const anchor = new Date(data.anchor).getTime();

const STATUS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
// Allowed paymentStatus per (payment method, fulfillmentStatus) — the sample-data rules.
const ALLOWED = {
  cod: { pending: ['pending'], confirmed: ['pending'], processing: ['pending'], shipped: ['pending'], delivered: ['simulated-paid'], cancelled: ['pending'], returned: ['refunded'] },
  iris: { pending: ['pending', 'simulated-paid'], confirmed: ['simulated-paid'], processing: ['simulated-paid'], shipped: ['simulated-paid'], delivered: ['simulated-paid'], cancelled: ['pending', 'refunded'], returned: ['refunded'] },
};

test('the committed file is exactly what the builder produces (deterministic)', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'tools/build-sample-data.mjs'), '--stdout'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), data);
});

test('sizes: 14-18 customers, 45-60 orders, all flagged as sample demo data', () => {
  assert.ok(customers.length >= 14 && customers.length <= 18, `${customers.length} customers`);
  assert.ok(orders.length >= 45 && orders.length <= 60, `${orders.length} orders`);
  assert.ok(orders.every((o) => o.sample === true && o.demo === true));
  assert.ok(customers.every((c) => c.sample === true));
});

test('ids are unique and well formed; customer ids use the checkout derivation', () => {
  assert.equal(new Set(orders.map((o) => o.id)).size, orders.length);
  assert.equal(new Set(orders.map((o) => o.requestId)).size, orders.length);
  assert.equal(new Set(customers.map((c) => c.id)).size, customers.length);
  assert.equal(new Set(customers.map((c) => c.email)).size, customers.length);
  for (const o of orders) {
    assert.match(o.id, ORDER_ID_RE);
    const d = new Date(o.createdAt);
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    assert.equal(o.id.slice(5, 13), ymd, `${o.id} date part`);
  }
  for (const c of customers) {
    assert.equal(c.id, customerIdFromEmail(c.email));
    assert.equal(c.email, c.email.toLowerCase());
    assert.match(c.email, /^[a-z0-9.]+@example\.gr$/);
    assert.ok(isValidPhone(c.phone), c.phone);
  }
});

test('sample emails never collide with the emails used by the e2e tests', () => {
  const testEmails = ['maria@example.gr', 'nikos@example.gr', 'a@example.gr', 'b@example.gr', 'c@example.gr', 'c2@example.gr',
    'maria2@example.gr', 'marianna@example.gr', 'other@example.gr', 'q@example.gr', 'ria@example.gr', 'x@example.gr', 'xss@example.gr'];
  for (const e of testEmails) assert.ok(!customers.some((c) => c.email === e), e);
});

test('customers: valid profile and saved addresses (normalised shape, one default)', () => {
  for (const c of customers) {
    const v = validateCheckoutForm({ ...c, shippingMethod: 'pickup', paymentMethod: 'cod', acceptTerms: true });
    assert.ok(v.ok, `${c.email}: ${JSON.stringify(v.errors)}`);
    assert.ok(Array.isArray(c.savedAddresses));
    assert.deepEqual(c.savedAddresses, normalizeAddresses(c.savedAddresses));
    for (const a of c.savedAddresses) {
      assert.ok(REGIONS.includes(a.region), a.region);
      assert.match(a.postalCode, /^\d{5}$/);
    }
    assert.equal(typeof c.newsletter, 'boolean');
    assert.ok(c.createdAt <= c.updatedAt);
  }
  assert.ok(customers.some((c) => c.savedAddresses.length > 0));
  assert.ok(customers.some((c) => c.newsletter));
  assert.ok(customers.some((c) => !c.newsletter));
});

test('every line references a real product/variant and carries a correct snapshot', () => {
  for (const o of orders) {
    assert.ok(o.lines.length >= 1);
    assert.equal(new Set(o.lines.map((l) => l.sku)).size, o.lines.length, `${o.id}: duplicate sku`);
    for (const l of o.lines) {
      const v = variantBySku.get(l.sku);
      assert.ok(v, `${o.id}: unknown sku ${l.sku}`);
      const p = productById.get(l.productId);
      assert.ok(p && v.productId === p.id, `${o.id}: ${l.sku} product`);
      assert.deepEqual(l, {
        sku: v.sku, productId: p.id, slug: p.slug, name: p.name, brand: p.brand || '', size: v.size ?? null, color: v.color ?? null,
        colorHex: v.colorHex ?? null, image: p.images[0], qty: l.qty, unitCents: p.priceCents, compareAtCents: p.compareAtCents || null,
        lineTotalCents: p.priceCents * l.qty, vatRate: S.vatRate,
      });
      assert.ok(Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= 3);
    }
  }
});

test('totals recompute exactly (independent math) and match pricing.quote', () => {
  for (const o of orders) {
    const sub = o.lines.reduce((s, l) => s + l.unitCents * l.qty, 0);
    let disc = 0;
    if (o.couponCode) {
      const c = couponByCode.get(o.couponCode);
      assert.ok(c, o.couponCode);
      assert.ok(['WELCOME10', 'ELAN5'].includes(c.code));
      assert.ok(sub >= c.minSubtotalCents, `${o.id}: coupon below min spend`);
      assert.ok(validateCoupon(c, sub, new Date(o.createdAt)).ok);
      disc = c.type === 'percent' ? Math.round(sub * c.value / 100) : Math.min(c.value, sub);
    }
    const after = sub - disc;
    const ship = o.shipping.method === 'courier' && after < S.freeShippingThresholdCents ? S.courierCents : 0;
    const cod = o.payment.method === 'cod' ? S.codFeeCents : 0;
    const totalCents = after + ship + cod;
    const expected = { subtotalCents: sub, discountCents: disc, shippingCents: ship, codFeeCents: cod, totalCents, vatIncludedCents: totalCents - Math.round(totalCents / (1 + S.vatRate)) };
    assert.deepEqual(o.totals, expected, o.id);
    assert.equal(o.shipping.costCents, ship);
    const q = quote({ lines: o.lines, coupon: o.couponCode ? couponByCode.get(o.couponCode) : null, shipping: { method: o.shipping.method }, payment: o.payment.method, settings: S, now: new Date(o.createdAt) });
    assert.equal(q.totalCents, o.totals.totalCents);
    assert.equal(q.couponError, null);
    assert.equal(o.vatRate, S.vatRate);
  }
});

test('shipping: courier orders carry the address, pickup orders do not', () => {
  for (const o of orders) {
    assert.ok(['courier', 'pickup'].includes(o.shipping.method));
    if (o.shipping.method === 'pickup') {
      assert.equal(o.shippingAddress, null);
      assert.equal(o.shipping.pickupAddress, S.contact.address);
    } else {
      assert.ok(REGIONS.includes(o.shippingAddress.region));
      assert.match(o.shippingAddress.postalCode, /^\d{5}$/);
    }
  }
  assert.ok(orders.some((o) => o.shipping.method === 'pickup'));
  assert.ok(orders.some((o) => o.shipping.method === 'courier' && o.totals.shippingCents === 0));
  assert.ok(orders.some((o) => o.totals.shippingCents === S.courierCents));
  assert.ok(orders.some((o) => o.couponCode === 'WELCOME10') && orders.some((o) => o.couponCode === 'ELAN5'));
});

test('status mix is realistic and payment status combinations are valid', () => {
  const n = orders.length;
  const count = Object.fromEntries(STATUS.map((s) => [s, orders.filter((o) => o.fulfillmentStatus === s).length]));
  assert.equal(Object.values(count).reduce((a, b) => a + b, 0), n);
  const share = (s) => count[s] / n;
  assert.ok(share('delivered') >= 0.45 && share('delivered') <= 0.65, `delivered ${count.delivered}`);
  for (const s of STATUS) assert.ok(count[s] >= 2, `${s}: ${count[s]}`);
  for (const o of orders) {
    assert.ok(['cod', 'iris'].includes(o.payment.method));
    assert.ok(ALLOWED[o.payment.method][o.fulfillmentStatus].includes(o.paymentStatus), `${o.id} ${o.payment.method}/${o.fulfillmentStatus}/${o.paymentStatus}`);
    assert.equal(o.payment.status, o.paymentStatus);
    assert.equal(o.payment.simulated, true);
    assert.equal(o.restocked, ['cancelled', 'returned'].includes(o.fulfillmentStatus), o.id);
    if (o.payment.method === 'cod' && o.fulfillmentStatus === 'delivered') {
      assert.ok(o.history.some((h) => h.detail === 'Είσπραξη κατά την παράδοση (demo)'), `${o.id}: COD collection note`);
    }
  }
  assert.ok(orders.some((o) => o.payment.method === 'iris' && o.paymentStatus === 'pending'));
});

test('dates: createdAt strictly increasing, within ~120 days before the anchor, history ordered, nothing in the future', () => {
  for (let i = 1; i < orders.length; i += 1) assert.ok(orders[i - 1].createdAt < orders[i].createdAt, `order ${i} not after ${i - 1}`);
  const first = new Date(orders[0].createdAt).getTime();
  assert.ok(anchor - first <= 125 * DAY_MS && anchor - first >= 90 * DAY_MS, 'spread over ~120 days');
  const recent = orders.filter((o) => anchor - new Date(o.createdAt).getTime() <= 30 * DAY_MS).length;
  assert.ok(recent / orders.length > 0.3, `denser recently (${recent} in last 30 days)`);
  for (const o of orders) {
    assert.ok(new Date(o.createdAt).getTime() <= anchor);
    assert.equal(o.history[0].type, 'created');
    assert.equal(o.history[0].at, o.createdAt);
    for (let i = 1; i < o.history.length; i += 1) assert.ok(o.history[i - 1].at <= o.history[i].at, `${o.id} history order`);
    assert.ok(o.history.every((h) => new Date(h.at).getTime() <= anchor && h.detail && h.type));
  }
  for (const c of customers) assert.ok(new Date(c.updatedAt).getTime() <= anchor);
});

test('customer aggregates match the orders (placement-time accounting, like checkout)', () => {
  const byCustomer = new Map(customers.map((c) => [c.id, c]));
  for (const o of orders) {
    const c = byCustomer.get(o.customerId);
    assert.ok(c, `${o.id}: unknown customer`);
    assert.deepEqual(o.customer, { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, company: c.company, vatNumber: c.vatNumber });
    assert.ok(c.createdAt <= o.createdAt);
  }
  for (const c of customers) {
    const mine = orders.filter((o) => o.customerId === c.id);
    assert.equal(c.orderCount, mine.length, c.email);
    assert.equal(c.totalCents, mine.reduce((s, o) => s + o.totals.totalCents, 0), c.email);
    assert.equal(c.lastOrderAt, mine.length ? mine[mine.length - 1].createdAt : null, c.email);
  }
  assert.ok(customers.filter((c) => c.orderCount >= 3).length >= 3, 'some repeat customers');
});

test('coupon usage equals the orders that used each coupon', () => {
  const used = {};
  for (const o of orders) if (o.couponCode) used[o.couponCode] = (used[o.couponCode] || 0) + 1;
  assert.deepEqual(data.couponUsage, used);
  const merged = withCouponUsage(meta.coupons, data.couponUsage);
  assert.equal(merged.find((c) => c.code === 'WELCOME10').usedCount, used.WELCOME10);
  assert.equal(merged.find((c) => c.code === 'VIP15').usedCount, 0);
  assert.equal(meta.coupons.find((c) => c.code === 'WELCOME10').usedCount, 0, 'input not mutated');
});

test('shiftSampleData moves every timestamp by whole days so the newest order is not in the future', () => {
  const now = new Date(anchor + 40 * DAY_MS + 5 * 3600000); // 40 days and 5 hours after the anchor
  const shifted = shiftSampleData(data, now);
  assert.notEqual(shifted, data);
  assert.equal(data.orders[0].createdAt, orders[0].createdAt, 'input not mutated');
  const d = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
  for (let i = 0; i < orders.length; i += 1) {
    const a = orders[i];
    const b = shifted.orders[i];
    assert.equal(d(a.createdAt, b.createdAt), 40);
    assert.match(b.id, ORDER_ID_RE);
    assert.equal(b.id.slice(14), a.id.slice(14), 'suffix kept');
    assert.equal(b.id.slice(5, 13), b.createdAt.slice(0, 10).replace(/-/g, ''));
    assert.ok(b.history.every((h, j) => d(a.history[j].at, h.at) === 40));
    assert.ok(new Date(b.createdAt) <= now);
    assert.deepEqual(b.lines, a.lines);
    assert.deepEqual(b.totals, a.totals);
  }
  assert.equal(new Set(shifted.orders.map((o) => o.id)).size, orders.length);
  for (let i = 0; i < customers.length; i += 1) {
    assert.equal(d(customers[i].createdAt, shifted.customers[i].createdAt), 40);
    if (customers[i].lastOrderAt) assert.equal(shifted.customers[i].lastOrderAt, shifted.orders.filter((o) => o.customerId === customers[i].id).pop().createdAt);
  }
  // same day as the anchor: no shift; clock before the anchor: shifted back
  assert.deepEqual(shiftSampleData(data, new Date(anchor + 3600000)).orders, orders);
  const back = shiftSampleData(data, new Date(anchor - 2 * DAY_MS));
  assert.equal(d(orders[0].createdAt, back.orders[0].createdAt), -2);
  assert.ok(back.orders.every((o) => new Date(o.createdAt) <= new Date(anchor - 2 * DAY_MS)));
});
