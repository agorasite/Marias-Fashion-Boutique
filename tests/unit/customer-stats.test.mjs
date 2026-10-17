import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerStats, buildCustomerList, filterCustomers, sortCustomers, customersToCsv, CUSTOMER_CSV_COLUMNS,
  buildCustomerUpdate, normalizeEmail, customerCity, customerCsvFileName, CUSTOMERS_PAGE_SIZE,
} from '../../assets/js/services/customer-rules.js';
import { parseCsv } from './csv-helper.mjs';

const o = (id, status, total, createdAt, extra = {}) => ({
  id, customerId: 'c1', fulfillmentStatus: status, paymentStatus: 'pending', createdAt, totals: { totalCents: total }, ...extra,
});
const C = { id: 'c1', firstName: 'Ελένη', lastName: 'Γεωργίου', email: 'eleni@example.gr', phone: '6912345678', company: '', vatNumber: '', newsletter: true, orderCount: 99, totalCents: 999999, createdAt: '2026-01-01T00:00:00.000Z' };

// ------------------------------------------------------------------ customerStats
test('zero orders: everything is zero / null and all statuses are present', () => {
  const s = customerStats(C, []);
  assert.deepEqual(s, {
    orderCount: 0, spendCents: 0, avgOrderCents: 0, firstOrderAt: null, lastOrderAt: null,
    byStatus: { pending: 0, confirmed: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0, returned: 0 },
  });
  assert.deepEqual(customerStats(C, undefined).orderCount, 0);
  assert.deepEqual(customerStats(null, null).spendCents, 0);
});
test('stored aggregates on the customer are ignored: spend is computed from the orders', () => {
  const s = customerStats(C, [o('a', 'delivered', 5000, '2026-02-01T10:00:00.000Z')]);
  assert.equal(s.orderCount, 1);
  assert.equal(s.spendCents, 5000);
});
test('spend excludes cancelled and returned orders, the count includes them', () => {
  const orders = [
    o('a', 'delivered', 5000, '2026-02-01T10:00:00.000Z'),
    o('b', 'cancelled', 9000, '2026-02-02T10:00:00.000Z'),
    o('c', 'returned', 7000, '2026-02-03T10:00:00.000Z'),
    o('d', 'pending', 2500, '2026-02-04T10:00:00.000Z'),
    o('e', 'shipped', 1000, '2026-02-05T10:00:00.000Z'),
  ];
  const s = customerStats(C, orders);
  assert.equal(s.orderCount, 5);
  assert.equal(s.spendCents, 5000 + 2500 + 1000);
  assert.deepEqual(s.byStatus, { pending: 1, confirmed: 0, processing: 0, shipped: 1, delivered: 1, cancelled: 1, returned: 1 });
});
test('average order = spend over the orders that count (rounded), 0 when none count', () => {
  const orders = [o('a', 'delivered', 1000, '2026-02-01T00:00:00.000Z'), o('b', 'delivered', 1001, '2026-02-02T00:00:00.000Z'), o('c', 'cancelled', 99999, '2026-02-03T00:00:00.000Z')];
  assert.equal(customerStats(C, orders).avgOrderCents, 1001); // 2001 / 2 = 1000.5 -> 1001
  assert.equal(customerStats(C, [o('c', 'cancelled', 5000, '2026-02-03T00:00:00.000Z')]).avgOrderCents, 0);
  assert.equal(customerStats(C, [o('c', 'cancelled', 5000, '2026-02-03T00:00:00.000Z')]).spendCents, 0);
});
test('first/last order are by createdAt over ALL orders regardless of input order', () => {
  const orders = [
    o('b', 'delivered', 1, '2026-03-10T10:00:00.000Z'),
    o('c', 'cancelled', 1, '2026-04-01T08:00:00.000Z'),
    o('a', 'delivered', 1, '2026-01-05T09:00:00.000Z'),
  ];
  const s = customerStats(C, orders);
  assert.equal(s.firstOrderAt, '2026-01-05T09:00:00.000Z');
  assert.equal(s.lastOrderAt, '2026-04-01T08:00:00.000Z');
  assert.equal(customerStats(C, [...orders].reverse()).firstOrderAt, '2026-01-05T09:00:00.000Z');
});
test('malformed orders do not break the stats', () => {
  const s = customerStats(C, [{ id: 'x', fulfillmentStatus: 'pending' }, { id: 'y', fulfillmentStatus: 'weird', totals: { totalCents: 100 }, createdAt: 'nope' }]);
  assert.equal(s.orderCount, 2);
  assert.equal(s.spendCents, 100); // an unknown status is not cancelled/returned, so it counts
  assert.equal(s.firstOrderAt, null);
});

// ------------------------------------------------------------------ list building / filtering / sorting
const customers = [
  { id: 'c1', firstName: 'Ελένη', lastName: 'Γεωργίου', email: 'eleni@example.gr', phone: '6912345678', newsletter: true, sample: true, createdAt: '2026-01-01T00:00:00.000Z', savedAddresses: [{ id: 'a1', city: 'Θεσσαλονίκη', isDefault: true }] },
  { id: 'c2', firstName: 'Άννα', lastName: 'Αντωνίου', email: 'anna@example.gr', phone: '2101234567', newsletter: false, sample: true, createdAt: '2026-03-01T00:00:00.000Z', savedAddresses: [] },
  { id: 'c3', firstName: 'Ζωή', lastName: 'Μπράουν', email: 'zoe@example.gr', phone: '6900000000', newsletter: true, createdAt: '2026-06-01T00:00:00.000Z', savedAddresses: [] },
];
const orders = [
  o('o1', 'delivered', 10000, '2026-02-01T00:00:00.000Z'),
  o('o2', 'cancelled', 90000, '2026-02-02T00:00:00.000Z'),
  { ...o('o3', 'delivered', 3000, '2026-04-01T00:00:00.000Z'), customerId: 'c2', shippingAddress: { city: 'Λάρισα' } },
];
const rows = buildCustomerList(customers, orders);

test('buildCustomerList attaches computed stats and city', () => {
  const by = Object.fromEntries(rows.map((r) => [r.customer.id, r]));
  assert.equal(by.c1.stats.orderCount, 2);
  assert.equal(by.c1.stats.spendCents, 10000);
  assert.equal(by.c2.stats.spendCents, 3000);
  assert.equal(by.c3.stats.orderCount, 0);
  assert.equal(by.c1.city, 'Θεσσαλονίκη');
  assert.equal(by.c2.city, 'Λάρισα'); // falls back to the latest order's address
  assert.equal(by.c3.city, '');
  assert.equal(customerCity(customers[0], []), 'Θεσσαλονίκη');
});
test('search: name (any order), email and phone; accent- and case-insensitive', () => {
  const ids = (f) => filterCustomers(rows, f).map((r) => r.customer.id);
  assert.deepEqual(ids({ q: 'ελενη' }), ['c1']);
  assert.deepEqual(ids({ q: 'ΓΕΩΡΓΙΟΥ ελένη' }), ['c1']);
  assert.deepEqual(ids({ q: 'ελενη γεωργιου' }), ['c1']);
  assert.deepEqual(ids({ q: 'anna@' }), ['c2']);
  assert.deepEqual(ids({ q: '210123' }), ['c2']);
  assert.deepEqual(ids({ q: '+30 210 123' }), ['c2']);
  assert.deepEqual(ids({ q: 'nobody' }), []);
  assert.deepEqual(ids({ q: '  ' }), ['c1', 'c2', 'c3']);
});
test('filters: has orders, newsletter, sample vs own', () => {
  const ids = (f) => filterCustomers(rows, f).map((r) => r.customer.id);
  assert.deepEqual(ids({ orders: 'with' }), ['c1', 'c2']);
  assert.deepEqual(ids({ orders: 'without' }), ['c3']);
  assert.deepEqual(ids({ newsletter: 'yes' }), ['c1', 'c3']);
  assert.deepEqual(ids({ newsletter: 'no' }), ['c2']);
  assert.deepEqual(ids({ origin: 'sample' }), ['c1', 'c2']);
  assert.deepEqual(ids({ origin: 'own' }), ['c3']);
  assert.deepEqual(ids({ orders: 'with', newsletter: 'yes', origin: 'sample' }), ['c1']);
});
test('sort: name (Greek collation), newest, orders, spend', () => {
  const ids = (sort) => sortCustomers(rows, sort).map((r) => r.customer.id);
  assert.deepEqual(ids('name'), ['c2', 'c1', 'c3']); // Αντωνίου, Γεωργίου, Μπράουν
  assert.deepEqual(ids('newest'), ['c3', 'c2', 'c1']);
  assert.deepEqual(ids('orders'), ['c1', 'c2', 'c3']);
  assert.deepEqual(ids('spend'), ['c1', 'c2', 'c3']);
  assert.deepEqual(ids('bogus'), ids('name'));
  // does not mutate its input
  assert.deepEqual(rows.map((r) => r.customer.id), ['c1', 'c2', 'c3']);
});
test('sort by spend uses the COMPUTED spend, not the stored aggregate', () => {
  const inflated = buildCustomerList([{ ...customers[0], totalCents: 1 }, { ...customers[1], totalCents: 99999999 }], orders);
  assert.deepEqual(sortCustomers(inflated, 'spend').map((r) => r.customer.id), ['c1', 'c2']);
});
test('page size is 25', () => assert.equal(CUSTOMERS_PAGE_SIZE, 25));

// ------------------------------------------------------------------ CSV
test('customer CSV: header, rows, Greek text, computed spend, formula-injection prefix, RFC 4180 quoting', () => {
  const tricky = buildCustomerList([
    { ...customers[0], firstName: '=cmd|"x"', lastName: 'Μ, Ν', phone: '+306912345678', company: '@evil' },
    { ...customers[2] },
  ], orders);
  const csv = customersToCsv(tricky);
  assert.ok(csv.endsWith('\r\n'));
  const table = parseCsv(csv);
  assert.deepEqual(table[0], CUSTOMER_CSV_COLUMNS);
  assert.equal(table.length, 3);
  const h = (n) => CUSTOMER_CSV_COLUMNS.indexOf(n);
  assert.equal(table[1][h('Όνομα')], "'=cmd|\"x\"");
  assert.equal(table[1][h('Επώνυμο')], 'Μ, Ν');
  assert.equal(table[1][h('Τηλέφωνο')], "'+306912345678");
  assert.equal(table[1][h('Εταιρεία')], "'@evil");
  assert.equal(table[1][h('Παραγγελίες')], '2');
  assert.equal(table[1][h('Δαπάνη')], '100.00'); // the cancelled 900 EUR order is excluded
  assert.equal(table[1][h('Newsletter')], 'Ναι');
  assert.equal(table[1][h('Δείγμα')], 'Ναι');
  assert.equal(table[2][h('Δείγμα')], 'Όχι');
  assert.equal(table[2][h('Παραγγελίες')], '0');
  assert.equal(table[2][h('Δαπάνη')], '0.00');
  assert.equal(table[2][h('Τελευταία παραγγελία')], '');
  assert.equal(customersToCsv([]).trim(), CUSTOMER_CSV_COLUMNS.join(','));
});
test('customer CSV file name is local-date based', () => {
  assert.equal(customerCsvFileName(new Date(2026, 9, 5)), 'marias-customers-2026-10-05.csv');
});

// ------------------------------------------------------------------ edit rules (shared with the account page)
test('normalizeEmail trims and lowercases', () => assert.equal(normalizeEmail('  Anna@Example.GR '), 'anna@example.gr'));
test('buildCustomerUpdate: valid patch is normalised and the id/aggregates are untouched', () => {
  const r = buildCustomerUpdate(C, { firstName: '  Μαρία ', email: '  Maria@Example.GR ', phone: '+30 691 234 5678', vatNumber: 'EL 094259216', company: ' ACME ', newsletter: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    firstName: 'Μαρία', lastName: 'Γεωργίου', email: 'maria@example.gr', phone: '6912345678', company: 'ACME', vatNumber: '094259216', newsletter: false,
  });
});
test('buildCustomerUpdate rejects what checkout/profile reject (same rules)', () => {
  const bad = (patch) => buildCustomerUpdate(C, patch).errors;
  assert.ok(bad({ email: 'nope' }).email);
  assert.ok(bad({ email: '' }).email);
  assert.ok(bad({ phone: '123' }).phone);
  assert.ok(bad({ phone: '' }).phone);
  assert.ok(bad({ vatNumber: '123456789' }).vatNumber); // wrong check digit
  assert.ok(bad({ vatNumber: '12345' }).vatNumber);
  assert.ok(bad({ firstName: 'A' }).firstName);
  assert.ok(bad({ lastName: '' }).lastName);
  assert.equal(buildCustomerUpdate(C, { vatNumber: '' }).ok, true); // optional
});
test('buildCustomerUpdate ignores fields that must not be edited (id, aggregates, sample flag)', () => {
  const r = buildCustomerUpdate(C, { id: 'evil', orderCount: 5, totalCents: 1, sample: true, savedAddresses: [], createdAt: 'x', firstName: 'Νίκη' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['company', 'email', 'firstName', 'lastName', 'newsletter', 'phone', 'vatNumber']);
});
