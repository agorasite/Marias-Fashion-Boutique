import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, dayKey, REVENUE_EXCLUDED, FULFILLMENT_STATUSES } from '../../assets/js/services/stats.js';

// Local-time fixtures so the day buckets do not depend on the machine time zone.
const NOW = new Date(2026, 9, 16, 15, 0, 0); // 16 Oct 2026 15:00 local
const daysAgo = (d, h = 10) => new Date(2026, 9, 16 - d, h, 0, 0).toISOString();

const line = (productId, qty, unitCents, extra = {}) => ({
  sku: `${productId}-M`, productId, name: `snap ${productId}`, image: `img/${productId}.webp`, qty, unitCents, lineTotalCents: qty * unitCents, ...extra,
});
const order = (id, status, totalCents, createdAt, lines = [], paymentStatus = 'pending') => ({
  id, fulfillmentStatus: status, paymentStatus, createdAt, lines, totals: { totalCents }, customer: { firstName: 'A', lastName: 'B' },
});
const product = (id, status = 'active', name = `Προϊόν ${id}`) => ({ id, name, status, images: [`assets/${id}.webp`] });
const variant = (sku, productId, stock) => ({ sku, productId, stock, size: 'M', color: 'Μαύρο' });

test('constants: revenue excludes cancelled and returned; all seven statuses are known', () => {
  assert.deepEqual([...REVENUE_EXCLUDED].sort(), ['cancelled', 'returned']);
  assert.deepEqual(FULFILLMENT_STATUSES, ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']);
});

test('empty inputs give zeros, empty lists and a zero-filled 30 day series', () => {
  const s = computeStats([], [], [], [], { now: NOW });
  assert.equal(s.totalOrders, 0);
  assert.equal(s.revenueCents, 0);
  assert.equal(s.pending, 0);
  assert.equal(s.completed, 0);
  assert.equal(s.activeProducts, 0);
  assert.equal(s.customers, 0);
  assert.deepEqual(s.recent, []);
  assert.deepEqual(s.topProducts, []);
  assert.deepEqual(s.lowStockProducts, []);
  assert.deepEqual(s.lowStockVariants, []);
  assert.equal(s.salesByDay.length, 30);
  assert.ok(s.salesByDay.every((d) => d.orders === 0 && d.revenueCents === 0));
  assert.deepEqual(s.statusCounts, Object.fromEntries(FULFILLMENT_STATUSES.map((k) => [k, 0])));
  // also tolerates undefined inputs
  assert.equal(computeStats(undefined, undefined, undefined, undefined, { now: NOW }).totalOrders, 0);
});

test('revenue excludes cancelled and returned orders; pending/completed counts; statusCounts', () => {
  const orders = [
    order('o1', 'pending', 1000, daysAgo(1)),
    order('o2', 'confirmed', 2000, daysAgo(2)),
    order('o3', 'delivered', 3000, daysAgo(3)),
    order('o4', 'delivered', 4000, daysAgo(4)),
    order('o5', 'cancelled', 50000, daysAgo(5)),
    order('o6', 'returned', 70000, daysAgo(6)),
    order('o7', 'shipped', 500, daysAgo(7)),
    order('o8', 'processing', 250, daysAgo(8)),
  ];
  const s = computeStats(orders, [], [], [{ id: 'c1' }, { id: 'c2' }], { now: NOW });
  assert.equal(s.totalOrders, 8);
  assert.equal(s.revenueCents, 1000 + 2000 + 3000 + 4000 + 500 + 250);
  assert.equal(s.pending, 1); // only 'pending' — confirmed is reported in statusCounts
  assert.equal(s.completed, 2);
  assert.equal(s.customers, 2);
  assert.deepEqual(s.statusCounts, { pending: 1, confirmed: 1, processing: 1, shipped: 1, delivered: 2, cancelled: 1, returned: 1 });
});

test('recent: newest 8 by createdAt, newest first', () => {
  const orders = Array.from({ length: 12 }, (_, i) => order(`o${i}`, 'pending', 100, daysAgo(12 - i)));
  const s = computeStats(orders.slice().reverse().concat([]).sort(() => 0), [], [], [], { now: NOW });
  assert.deepEqual(s.recent.map((o) => o.id), ['o11', 'o10', 'o9', 'o8', 'o7', 'o6', 'o5', 'o4']);
});

test('low stock: active products with total stock <= threshold; archived excluded; variants 1..2 listed', () => {
  const products = [product('a'), product('b'), product('c', 'archived'), product('d'), product('e')];
  const variants = [
    variant('a-1', 'a', 2), variant('a-2', 'a', 3), // total 5 -> low (<= 5)
    variant('b-1', 'b', 10), variant('b-2', 'b', 1), // total 11 -> not low, but b-2 is a low variant
    variant('c-1', 'c', 0), // archived -> ignored
    variant('d-1', 'd', 0), variant('d-2', 'd', 0), // total 0 -> low (sold out)
    variant('e-1', 'e', 6), // total 6 -> not low
  ];
  const s = computeStats([], products, variants, [], { now: NOW });
  assert.equal(s.activeProducts, 4);
  assert.deepEqual(s.lowStockProducts.map((p) => [p.productId, p.totalStock]), [['d', 0], ['a', 5]]);
  assert.equal(s.lowStockProducts[0].name, 'Προϊόν d');
  assert.equal(s.lowStockProducts[0].image, 'assets/d.webp');
  assert.deepEqual(s.lowStockVariants.map((v) => [v.sku, v.stock]), [['b-2', 1], ['a-1', 2]]);
  assert.equal(computeStats([], products, variants, [], { now: NOW, lowStockThreshold: 6 }).lowStockProducts.length, 3);
  // a product without any variant has total stock 0
  assert.deepEqual(computeStats([], [product('z')], [], [], { now: NOW }).lowStockProducts.map((p) => p.productId), ['z']);
});

test('topProducts: by qty from non-cancelled/returned orders, ties by revenue then name, max 5', () => {
  const products = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id) => product(id));
  const orders = [
    order('o1', 'delivered', 0, daysAgo(1), [line('p1', 2, 1000), line('p2', 3, 500)]),
    order('o2', 'pending', 0, daysAgo(2), [line('p1', 1, 1000), line('p3', 3, 900)]),
    order('o3', 'cancelled', 0, daysAgo(3), [line('p4', 50, 100)]),
    order('o4', 'returned', 0, daysAgo(4), [line('p5', 40, 100)]),
    order('o5', 'shipped', 0, daysAgo(5), [line('p6', 1, 100), line('p7', 1, 100), line('ghost', 1, 700)]),
  ];
  const s = computeStats(orders, products, [], [], { now: NOW });
  // p1: 3 qty / 3000; p3: 3 / 2700; p2: 3 / 1500; then qty 1 ties: ghost 700 > p6 100 = p7 100 (name order)
  assert.deepEqual(s.topProducts.map((p) => [p.productId, p.qty, p.revenueCents]), [
    ['p1', 3, 3000], ['p3', 3, 2700], ['p2', 3, 1500], ['ghost', 1, 700], ['p6', 1, 100],
  ]);
  assert.equal(s.topProducts[0].name, 'Προϊόν p1'); // current product name
  assert.equal(s.topProducts[0].image, 'assets/p1.webp');
  assert.equal(s.topProducts[3].name, 'snap ghost'); // deleted product falls back to the snapshot
  assert.equal(s.topProducts[3].image, 'img/ghost.webp');
});

test('salesByDay: last 30 local days ending today, zero-filled, cancelled/returned count as orders but not revenue', () => {
  const orders = [
    order('today', 'pending', 1500, daysAgo(0, 9)),
    order('today2', 'cancelled', 9999, daysAgo(0, 11)),
    order('d3', 'delivered', 2000, daysAgo(3)),
    order('d29', 'delivered', 700, daysAgo(29, 0)), // first day of the window
    order('d30', 'delivered', 800, daysAgo(30, 23)), // outside the window
    order('future', 'pending', 600, daysAgo(-1)), // after now: ignored
  ];
  const s = computeStats(orders, [], [], [], { now: NOW });
  assert.equal(s.salesByDay.length, 30);
  assert.equal(s.salesByDay[29].date, dayKey(NOW));
  assert.equal(s.salesByDay[29].date, '2026-10-16');
  assert.equal(s.salesByDay[0].date, '2026-09-17');
  assert.deepEqual(s.salesByDay[29], { date: '2026-10-16', orders: 2, revenueCents: 1500 });
  assert.deepEqual(s.salesByDay[26], { date: '2026-10-13', orders: 1, revenueCents: 2000 });
  assert.deepEqual(s.salesByDay[0], { date: '2026-09-17', orders: 1, revenueCents: 700 });
  assert.equal(s.salesByDay.reduce((n, d) => n + d.orders, 0), 4);
  // dates are consecutive
  for (let i = 1; i < 30; i += 1) {
    const a = new Date(`${s.salesByDay[i - 1].date}T12:00:00`);
    const b = new Date(`${s.salesByDay[i].date}T12:00:00`);
    assert.equal(Math.round((b - a) / 86400000), 1);
  }
});

test('orders with unknown status or missing totals do not break the stats', () => {
  const s = computeStats([{ id: 'x', createdAt: daysAgo(1), fulfillmentStatus: 'weird' }], [], [], [], { now: NOW });
  assert.equal(s.totalOrders, 1);
  assert.equal(s.revenueCents, 0);
  assert.equal(s.statusCounts.weird, undefined);
});
