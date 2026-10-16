import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ORDER_STATUSES, PAYMENT_STATUSES, FULFILLMENT_CHAIN, canTransitionFulfillment, canTransitionPayment,
  nextFulfillmentSteps, planRestock, applyTerminalTransition, applyFulfillment, applyPayment, applyNote,
  ordersToCsv, CSV_COLUMNS, csvCell, centsToDecimal, filterOrders, paginate, validateNoteText, OrderError,
  isCustomerVisibleHistory,
} from '../../assets/js/services/order-rules.js';

const AT = '2026-10-16T10:00:00.000Z';
const line = (sku, qty, o = {}) => ({ sku, productId: 'p1', name: `Προϊόν ${sku}`, qty, unitCents: 1000, lineTotalCents: qty * 1000, ...o });
const order = (o = {}) => ({
  id: 'ELAN-20261016-AAAA', createdAt: '2026-10-16T09:00:00.000Z', customerId: 'c1',
  customer: { firstName: 'Ελένη', lastName: 'Παππά', email: 'eleni@example.gr', phone: '6912345678', company: '', vatNumber: '' },
  shippingAddress: { address: 'Ερμού 1', city: 'Αθήνα', postalCode: '10563', region: 'Αττική' },
  shipping: { method: 'courier', label: 'Courier στο σπίτι', costCents: 0 },
  payment: { method: 'cod', label: 'Αντικαταβολή', status: 'pending', simulated: true },
  paymentStatus: 'pending', fulfillmentStatus: 'pending',
  lines: [line('A-1', 2), line('B-1', 1)], couponCode: null,
  totals: { subtotalCents: 3000, discountCents: 0, shippingCents: 0, codFeeCents: 200, totalCents: 3200, vatIncludedCents: 619 },
  notes: '', internalNotes: [], history: [{ at: '2026-10-16T09:00:00.000Z', type: 'created', detail: 'x' }], restocked: false, demo: true,
  ...o,
});
const vmap = (...vs) => new Map(vs.map((v) => [v.sku, v]));
const v = (sku, stock, o = {}) => ({ sku, productId: 'p1', stock, size: 'M', color: 'Μαύρο', ...o });

// ------------------------------------------------------------------ transition tables
const LEGAL_FULFILLMENT = new Set([
  'pending>confirmed', 'pending>processing', 'pending>shipped', 'pending>delivered',
  'confirmed>processing', 'confirmed>shipped', 'confirmed>delivered',
  'processing>shipped', 'processing>delivered',
  'shipped>delivered',
  'pending>cancelled', 'confirmed>cancelled', 'processing>cancelled', 'shipped>cancelled',
  'delivered>returned',
]);

test('status constants', () => {
  assert.deepEqual(ORDER_STATUSES, ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']);
  assert.deepEqual(PAYMENT_STATUSES, ['pending', 'simulated-paid', 'refunded']);
  assert.deepEqual(FULFILLMENT_CHAIN, ['pending', 'confirmed', 'processing', 'shipped', 'delivered']);
});

test('fulfillment transition table: every ordered pair', () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      assert.equal(canTransitionFulfillment(from, to), LEGAL_FULFILLMENT.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
  assert.equal(canTransitionFulfillment('pending', 'bogus'), false);
  assert.equal(canTransitionFulfillment('bogus', 'confirmed'), false);
  assert.equal(canTransitionFulfillment(undefined, 'confirmed'), false);
});

test('payment transition table: every ordered pair', () => {
  const legal = new Set(['pending>simulated-paid', 'simulated-paid>refunded']);
  for (const from of PAYMENT_STATUSES) {
    for (const to of PAYMENT_STATUSES) {
      assert.equal(canTransitionPayment(from, to), legal.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
  assert.equal(canTransitionPayment('pending', 'refunded'), false);
  assert.equal(canTransitionPayment('refunded', 'pending'), false);
  // context: no "mark paid" on a cancelled/returned order, but a refund is still possible there
  assert.equal(canTransitionPayment('pending', 'simulated-paid', 'cancelled'), false);
  assert.equal(canTransitionPayment('pending', 'simulated-paid', 'returned'), false);
  assert.equal(canTransitionPayment('simulated-paid', 'refunded', 'cancelled'), true);
  assert.equal(canTransitionPayment('simulated-paid', 'refunded', 'returned'), true);
});

test('nextFulfillmentSteps offers only forward chain steps (cancel/return are separate actions)', () => {
  assert.deepEqual(nextFulfillmentSteps('pending'), ['confirmed', 'processing', 'shipped', 'delivered']);
  assert.deepEqual(nextFulfillmentSteps('shipped'), ['delivered']);
  assert.deepEqual(nextFulfillmentSteps('delivered'), []);
  assert.deepEqual(nextFulfillmentSteps('cancelled'), []);
  assert.deepEqual(nextFulfillmentSteps('returned'), []);
});

// ------------------------------------------------------------------ applyFulfillment / applyPayment
test('applyFulfillment: forward moves add one history entry; same status is a no-op; backward/terminal throw', () => {
  const r = applyFulfillment(order(), 'shipped', AT);
  assert.equal(r.changed, true);
  assert.equal(r.order.fulfillmentStatus, 'shipped');
  assert.equal(r.order.history.length, 2);
  assert.deepEqual(r.order.history[1], { at: AT, type: 'status', detail: 'Η κατάσταση άλλαξε σε «Απεστάλη».', by: 'admin-demo' });
  const again = applyFulfillment(r.order, 'shipped', AT);
  assert.equal(again.changed, false);
  assert.equal(again.order, r.order);
  for (const to of ['pending', 'confirmed', 'processing']) {
    assert.throws(() => applyFulfillment(r.order, to, AT), (e) => e instanceof OrderError && e.code === 'INVALID_TRANSITION' && /[α-ω]/.test(e.message));
  }
  assert.throws(() => applyFulfillment(order({ fulfillmentStatus: 'delivered' }), 'pending', AT), { code: 'INVALID_TRANSITION' });
  // dedicated functions only
  assert.throws(() => applyFulfillment(order(), 'cancelled', AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyFulfillment(order({ fulfillmentStatus: 'delivered' }), 'returned', AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyFulfillment(order({ fulfillmentStatus: 'cancelled' }), 'delivered', AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyFulfillment(order(), 'nope', AT), { code: 'INVALID_STATUS' });
});

test('applyPayment: pending -> simulated-paid -> refunded, no-op on same, refund from pending rejected', () => {
  const paid = applyPayment(order(), 'simulated-paid', AT);
  assert.equal(paid.changed, true);
  assert.equal(paid.order.paymentStatus, 'simulated-paid');
  assert.equal(paid.order.payment.status, 'simulated-paid');
  assert.match(paid.order.history.at(-1).detail, /προσομοίωση/i);
  assert.equal(paid.order.history.at(-1).by, 'admin-demo');
  assert.equal(applyPayment(paid.order, 'simulated-paid', AT).changed, false);
  const ref = applyPayment(paid.order, 'refunded', AT);
  assert.equal(ref.order.paymentStatus, 'refunded');
  assert.match(ref.order.history.at(-1).detail, /προσομοίωση/i);
  assert.throws(() => applyPayment(order(), 'refunded', AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyPayment(ref.order, 'simulated-paid', AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyPayment(ref.order, 'pending', AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyPayment(order(), 'paid', AT), { code: 'INVALID_STATUS' });
  // a cancelled simulated-paid order can still be refunded; a cancelled pending one cannot be marked paid
  assert.equal(applyPayment(order({ fulfillmentStatus: 'cancelled', paymentStatus: 'simulated-paid' }), 'refunded', AT).order.paymentStatus, 'refunded');
  assert.throws(() => applyPayment(order({ fulfillmentStatus: 'cancelled' }), 'simulated-paid', AT), { code: 'INVALID_TRANSITION' });
  // fulfillment untouched
  assert.equal(ref.order.fulfillmentStatus, 'pending');
});

// ------------------------------------------------------------------ planRestock
test('planRestock: normal order restocks all lines', () => {
  const p = planRestock(order(), vmap(v('A-1', 3), v('B-1', 0)));
  assert.equal(p.skipAll, undefined);
  assert.deepEqual(p.updates, [{ sku: 'A-1', add: 2 }, { sku: 'B-1', add: 1 }]);
  assert.deepEqual(p.skipped, []);
});

test('planRestock: duplicate SKU lines are aggregated', () => {
  const p = planRestock(order({ lines: [line('A-1', 2), line('B-1', 1), line('A-1', 3)] }), vmap(v('A-1', 0), v('B-1', 0)));
  assert.deepEqual(p.updates, [{ sku: 'A-1', add: 5 }, { sku: 'B-1', add: 1 }]);
});

test('planRestock: sample and already-restocked orders skip everything', () => {
  const s = planRestock(order({ sample: true }), vmap(v('A-1', 3), v('B-1', 0)));
  assert.equal(s.skipAll, 'sample');
  assert.deepEqual(s.updates, []);
  const r = planRestock(order({ restocked: true }), vmap(v('A-1', 3), v('B-1', 0)));
  assert.equal(r.skipAll, 'already-restocked');
  assert.deepEqual(r.updates, []);
});

test('planRestock: a missing (deleted) variant is skipped with a reason; an archived variant is still restored', () => {
  const p = planRestock(order(), vmap(v('B-1', 0, { archived: true })));
  assert.deepEqual(p.updates, [{ sku: 'B-1', add: 1, archived: true }]);
  assert.deepEqual(p.skipped, [{ sku: 'A-1', reason: 'missing' }]);
  // accepts a plain object too
  assert.deepEqual(planRestock(order(), { 'A-1': v('A-1', 1), 'B-1': v('B-1', 1) }).updates.map((u) => u.sku), ['A-1', 'B-1']);
  // zero / invalid quantities are ignored
  assert.deepEqual(planRestock(order({ lines: [line('A-1', 0)] }), vmap(v('A-1', 1))).updates, []);
});

// ------------------------------------------------------------------ applyTerminalTransition (cancel / return core)
test('cancel: stock restored once, restocked flag set, history entries; second cancel is a no-op', () => {
  const variants = vmap(v('A-1', 3), v('B-1', 0));
  const r1 = applyTerminalTransition(order(), 'cancelled', variants, AT);
  assert.equal(r1.changed, true);
  assert.equal(r1.order.fulfillmentStatus, 'cancelled');
  assert.equal(r1.order.restocked, true);
  assert.deepEqual(r1.variantPuts.map((x) => [x.sku, x.stock]), [['A-1', 5], ['B-1', 1]]);
  const added = r1.order.history.slice(1);
  assert.equal(added[0].type, 'status');
  assert.match(added[0].detail, /Ακυρώθηκε/);
  assert.ok(added.some((h) => h.type === 'restock' && /A-1/.test(h.detail)));
  assert.ok(added.every((h) => h.by === 'admin-demo' && h.at === AT));
  // apply the puts, then cancel again: nothing happens
  const after = vmap(...r1.variantPuts);
  const r2 = applyTerminalTransition(r1.order, 'cancelled', after, AT);
  assert.equal(r2.changed, false);
  assert.deepEqual(r2.variantPuts, []);
  assert.equal(r2.order, r1.order);
  // cancel then return is rejected
  assert.throws(() => applyTerminalTransition(r1.order, 'returned', after, AT), { code: 'INVALID_TRANSITION' });
  // payment untouched
  assert.equal(r1.order.paymentStatus, 'pending');
});

test('return: only from delivered; restocks once; return on returned is a no-op; cancel on returned rejected', () => {
  const variants = vmap(v('A-1', 0), v('B-1', 0));
  for (const st of ['pending', 'confirmed', 'processing', 'shipped']) {
    assert.throws(() => applyTerminalTransition(order({ fulfillmentStatus: st }), 'returned', variants, AT), { code: 'INVALID_TRANSITION' });
  }
  assert.throws(() => applyTerminalTransition(order({ fulfillmentStatus: 'delivered' }), 'cancelled', variants, AT), { code: 'INVALID_TRANSITION' });
  const r = applyTerminalTransition(order({ fulfillmentStatus: 'delivered', paymentStatus: 'simulated-paid' }), 'returned', variants, AT);
  assert.equal(r.order.fulfillmentStatus, 'returned');
  assert.equal(r.order.paymentStatus, 'simulated-paid'); // refund is a separate, explicit action
  assert.deepEqual(r.variantPuts.map((x) => [x.sku, x.stock]), [['A-1', 2], ['B-1', 1]]);
  assert.equal(applyTerminalTransition(r.order, 'returned', vmap(...r.variantPuts), AT).changed, false);
  assert.throws(() => applyTerminalTransition(r.order, 'cancelled', variants, AT), { code: 'INVALID_TRANSITION' });
  assert.throws(() => applyTerminalTransition(order(), 'shipped', variants, AT), { code: 'INVALID_STATUS' });
});

test('cancel of a sample order or an already-restocked order never touches stock and says so', () => {
  const variants = vmap(v('A-1', 3), v('B-1', 0));
  const s = applyTerminalTransition(order({ sample: true }), 'cancelled', variants, AT);
  assert.equal(s.changed, true);
  assert.deepEqual(s.variantPuts, []);
  assert.ok(s.order.history.some((h) => h.detail === 'Δείγμα παραγγελίας: χωρίς επαναφορά αποθέματος'));
  const r = applyTerminalTransition(order({ restocked: true }), 'cancelled', variants, AT);
  assert.deepEqual(r.variantPuts, []);
  assert.equal(r.order.restocked, true);
});

test('cancel with a deleted variant skips it with a history note; archived variant keeps archived flag', () => {
  const r = applyTerminalTransition(order(), 'cancelled', vmap(v('B-1', 0, { archived: true })), AT);
  assert.deepEqual(r.variantPuts, [{ sku: 'B-1', productId: 'p1', stock: 1, size: 'M', color: 'Μαύρο', archived: true }]);
  assert.ok(r.order.history.some((h) => h.detail === 'Παραλλαγή A-1 δεν υπάρχει πλέον — δεν επαναφέρθηκε απόθεμα'));
  assert.equal(r.order.restocked, true);
});

// ------------------------------------------------------------------ notes
test('notes: trimmed, 1..1000 chars, appended with timestamp; history entry is internal', () => {
  assert.equal(validateNoteText('   ').ok, false);
  assert.equal(validateNoteText('a'.repeat(1001)).ok, false);
  assert.equal(validateNoteText(` ${'a'.repeat(1000)} `).ok, true);
  const r = applyNote(order(), '  Τηλεφώνησε ο πελάτης  ', AT);
  assert.deepEqual(r.order.internalNotes, [{ at: AT, text: 'Τηλεφώνησε ο πελάτης', by: 'admin-demo' }]);
  assert.equal(r.order.history.at(-1).type, 'note');
  assert.equal(isCustomerVisibleHistory(r.order.history.at(-1)), false);
  assert.equal(isCustomerVisibleHistory({ type: 'status', detail: 'x' }), true);
  assert.equal(isCustomerVisibleHistory({ type: 'restock', detail: 'x' }), false);
  assert.throws(() => applyNote(order(), '', AT), { code: 'VALIDATION' });
  // tolerates orders without internalNotes
  const legacy = order();
  delete legacy.internalNotes;
  assert.equal(applyNote(legacy, 'ok', AT).order.internalNotes.length, 1);
});

// ------------------------------------------------------------------ CSV
/** Minimal RFC-4180 parser (CRLF records, quoted fields, doubled quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('CSV: header only for an empty list, CRLF line endings, no BOM in the string', () => {
  const csv = ordersToCsv([]);
  assert.equal(csv, `${CSV_COLUMNS.join(',')}\r\n`);
  assert.deepEqual(CSV_COLUMNS, ['Αριθμός', 'Ημερομηνία (ISO)', 'Πελάτης', 'Email', 'Τηλέφωνο', 'Τρόπος αποστολής', 'Τρόπος πληρωμής',
    'Κατάσταση παραγγελίας', 'Κατάσταση πληρωμής', 'Κουπόνι', 'Υποσύνολο', 'Έκπτωση', 'Μεταφορικά', 'Αντικαταβολή', 'ΦΠΑ', 'Σύνολο', 'Προϊόντα']);
  assert.notEqual(csv.charCodeAt(0), 0xfeff);
});

test('CSV: escapes commas, quotes, newlines; Greek kept; dot decimals; products joined', () => {
  const o = order({
    customer: { firstName: 'Γιάννης, "Τζον"', lastName: 'Ο\'Μπράιαν', email: 'a@b.gr', phone: '6912345678' },
    notes: 'ignored',
    lines: [line('A-1', 2, { name: 'Φόρεμα\nμίντι' }), line('B-1', 1, { name: 'Τσάντα' })],
    couponCode: 'WELCOME10',
    totals: { subtotalCents: 3000, discountCents: 300, shippingCents: 350, codFeeCents: 200, totalCents: 3250, vatIncludedCents: 629 },
  });
  const csv = ordersToCsv([o]);
  assert.ok(csv.endsWith('\r\n'));
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  const r = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, rows[1][i]]));
  assert.equal(rows[1].length, CSV_COLUMNS.length);
  assert.equal(r['Αριθμός'], o.id);
  assert.equal(r['Ημερομηνία (ISO)'], o.createdAt);
  assert.equal(r['Πελάτης'], 'Γιάννης, "Τζον" Ο\'Μπράιαν');
  assert.equal(r['Τρόπος αποστολής'], 'Courier στο σπίτι');
  assert.equal(r['Τρόπος πληρωμής'], 'Αντικαταβολή');
  assert.equal(r['Κατάσταση παραγγελίας'], 'Παραλήφθηκε');
  assert.equal(r['Κατάσταση πληρωμής'], 'Εκκρεμεί πληρωμή');
  assert.equal(r['Κουπόνι'], 'WELCOME10');
  assert.equal(r['Υποσύνολο'], '30.00');
  assert.equal(r['Έκπτωση'], '3.00');
  assert.equal(r['Μεταφορικά'], '3.50');
  assert.equal(r['Αντικαταβολή'], '2.00');
  assert.equal(r['ΦΠΑ'], '6.29');
  assert.equal(r['Σύνολο'], '32.50');
  assert.equal(r['Προϊόντα'], 'Φόρεμα\nμίντι x 2 | Τσάντα x 1');
  // raw escaping
  assert.ok(csv.includes('"Γιάννης, ""Τζον"" Ο\'Μπράιαν"'));
  assert.ok(csv.includes('"Φόρεμα\nμίντι x 2 | Τσάντα x 1"'));
});

test('CSV: formula-injection defence on text cells; numbers are never prefixed', () => {
  for (const bad of ['=SUM(A1:A2)', '+30 69', '-2+3', '@cmd', '\tx', '\rx']) assert.ok(csvCell(bad).replace(/^"/, '').startsWith("'"), JSON.stringify(bad));
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('=1,1'), '"\'=1,1"');
  assert.equal(csvCell('safe'), 'safe');
  assert.equal(csvCell(''), '');
  assert.equal(csvCell(null), '');
  const csv = ordersToCsv([order({ customer: { firstName: '=HYPERLINK("x")', lastName: '', email: '@evil', phone: '+306912345678' } })]);
  const row = parseCsv(csv)[1];
  assert.equal(row[2], '\'=HYPERLINK("x")');
  assert.equal(row[3], "'@evil");
  assert.equal(row[4], "'+306912345678");
  assert.equal(centsToDecimal(-150), '-1.50');
  assert.equal(centsToDecimal(5), '0.05');
  assert.equal(centsToDecimal(undefined), '0.00');
  assert.equal(centsToDecimal(123456), '1234.56');
});

test('CSV: null-safe for pickup orders and missing fields', () => {
  const o = order({ shippingAddress: null, shipping: { method: 'pickup', label: 'Παραλαβή από το κατάστημα (Αθήνα, Ερμού 1)', costCents: 0 }, payment: { method: 'iris' }, couponCode: null, totals: {} });
  const row = parseCsv(ordersToCsv([o, { id: 'X' }]));
  assert.equal(row.length, 3);
  assert.equal(row[1][5], 'Παραλαβή από το κατάστημα');
  assert.equal(row[1][6], 'IRIS (προσομοίωση)');
  assert.equal(row[1][15], '0.00');
  assert.equal(row[2][0], 'X');
  assert.equal(row[2].length, CSV_COLUMNS.length);
});

// ------------------------------------------------------------------ filters / sort / pagination
test('filterOrders: search, filters, inclusive local date range, sorts', () => {
  const at = (d, h = 12) => new Date(2026, 9, d, h, 0, 0).toISOString();
  const list = [
    order({ id: 'ELAN-1', createdAt: at(1), customer: { firstName: 'Άννα', lastName: 'Ζαχαρίου', email: 'anna@x.gr' }, totals: { totalCents: 500 } }),
    order({ id: 'ELAN-2', createdAt: at(5, 0), fulfillmentStatus: 'shipped', paymentStatus: 'simulated-paid', payment: { method: 'iris' }, totals: { totalCents: 9000 } }),
    order({ id: 'ELAN-3', createdAt: at(9, 23), fulfillmentStatus: 'cancelled', totals: { totalCents: 3000 } }),
  ];
  assert.deepEqual(filterOrders(list, {}).map((o) => o.id), ['ELAN-3', 'ELAN-2', 'ELAN-1']);
  assert.deepEqual(filterOrders(list, { sort: 'oldest' }).map((o) => o.id), ['ELAN-1', 'ELAN-2', 'ELAN-3']);
  assert.deepEqual(filterOrders(list, { sort: 'total-desc' }).map((o) => o.id), ['ELAN-2', 'ELAN-3', 'ELAN-1']);
  assert.deepEqual(filterOrders(list, { sort: 'total-asc' }).map((o) => o.id), ['ELAN-1', 'ELAN-3', 'ELAN-2']);
  assert.deepEqual(filterOrders(list, { q: 'elan-2' }).map((o) => o.id), ['ELAN-2']);
  assert.deepEqual(filterOrders(list, { q: 'ΖΑΧΑΡ' }).map((o) => o.id), ['ELAN-1']);
  assert.deepEqual(filterOrders(list, { q: 'άννα ζαχ' }).map((o) => o.id), ['ELAN-1']);
  assert.deepEqual(filterOrders(list, { q: 'anna@x' }).map((o) => o.id), ['ELAN-1']);
  assert.deepEqual(filterOrders(list, { fulfillmentStatus: 'cancelled' }).map((o) => o.id), ['ELAN-3']);
  assert.deepEqual(filterOrders(list, { paymentStatus: 'simulated-paid' }).map((o) => o.id), ['ELAN-2']);
  assert.deepEqual(filterOrders(list, { paymentMethod: 'cod' }).map((o) => o.id), ['ELAN-3', 'ELAN-1']);
  assert.deepEqual(filterOrders(list, { from: '2026-10-05', to: '2026-10-09' }).map((o) => o.id), ['ELAN-3', 'ELAN-2']);
  assert.deepEqual(filterOrders(list, { from: '2026-10-06' }).map((o) => o.id), ['ELAN-3']);
  assert.deepEqual(filterOrders(list, { to: '2026-10-04' }).map((o) => o.id), ['ELAN-1']);
  assert.deepEqual(filterOrders(list, { from: 'garbage' }).length, 3);
  assert.deepEqual(filterOrders(list, { customerId: 'nobody' }), []);
  assert.deepEqual(filterOrders(undefined, {}), []);
});

test('paginate: 25 per page, clamps the page', () => {
  const items = Array.from({ length: 52 }, (_, i) => i);
  assert.deepEqual(paginate(items, 1), { items: items.slice(0, 25), page: 1, pageCount: 3, total: 52, pageSize: 25 });
  assert.equal(paginate(items, 3).items.length, 2);
  assert.equal(paginate(items, 9).page, 3);
  assert.equal(paginate(items, 0).page, 1);
  assert.deepEqual(paginate([], 1), { items: [], page: 1, pageCount: 1, total: 0, pageSize: 25 });
});

test('seeded sample orders: every cancelled/returned sample order is already restocked', () => {
  const sample = JSON.parse(readFileSync(new URL('../../data/sample-data.json', import.meta.url), 'utf8'));
  for (const o of sample.orders) {
    assert.equal(o.sample, true);
    if (['cancelled', 'returned'].includes(o.fulfillmentStatus)) assert.equal(o.restocked, true, o.id);
    // and a non-restocked sample order never restocks when cancelled
    if (!o.restocked) assert.equal(planRestock(o, new Map()).skipAll, 'sample');
  }
});
