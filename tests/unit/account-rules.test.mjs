import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK_STEPS, trackingFor, fulfillmentLabel, paymentStatusLabel, validateAddress, validateProfile,
  normalizeAddresses, pickDefaultAddress, addAddress, updateAddress, removeAddress, setDefaultAddress,
  orderBelongsTo, MAX_ADDRESSES,
} from '../../assets/js/services/account-rules.js';

const addr = (o = {}) => ({ address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', ...o });
const states = (t) => t.steps.map((s) => s.state).join(',');

test('tracking steps are the five Greek stages in order', () => {
  assert.deepEqual(TRACK_STEPS.map((s) => s.label), ['Παραλήφθηκε', 'Επιβεβαίωση', 'Προετοιμασία', 'Απεστάλη', 'Παραδόθηκε']);
});

test('trackingFor derives the current step from fulfillmentStatus', () => {
  assert.equal(states(trackingFor('pending')), 'current,upcoming,upcoming,upcoming,upcoming');
  assert.equal(states(trackingFor('confirmed')), 'done,current,upcoming,upcoming,upcoming');
  assert.equal(states(trackingFor('processing')), 'done,done,current,upcoming,upcoming');
  assert.equal(states(trackingFor('shipped')), 'done,done,done,current,upcoming');
  assert.equal(states(trackingFor('delivered')), 'done,done,done,done,done');
  assert.equal(trackingFor('shipped').terminal, null);
  assert.equal(trackingFor('shipped').currentKey, 'shipped');
});

test('cancelled and returned are terminal states', () => {
  const c = trackingFor('cancelled');
  assert.equal(c.terminal, 'cancelled');
  assert.equal(c.steps.length, 0);
  const r = trackingFor('returned');
  assert.equal(r.terminal, 'returned');
  assert.equal(states(r), 'done,done,done,done,done');
});

test('unknown / missing status falls back to the first step', () => {
  assert.equal(states(trackingFor('weird')), 'current,upcoming,upcoming,upcoming,upcoming');
  assert.equal(states(trackingFor(undefined)), 'current,upcoming,upcoming,upcoming,upcoming');
});

test('Greek labels exist for every status, including refunded', () => {
  for (const s of ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']) {
    assert.match(fulfillmentLabel(s), /[Α-Ωα-ω]/);
  }
  for (const s of ['pending', 'simulated-paid', 'refunded']) assert.match(paymentStatusLabel(s), /[Α-Ωα-ω]/);
  assert.match(paymentStatusLabel('refunded'), /Επιστροφή/);
  assert.match(paymentStatusLabel('simulated-paid'), /Προσομοίωση/);
  assert.match(paymentStatusLabel('mystery'), /Άγνωστη/);
});

test('validateAddress reuses the checkout rules', () => {
  assert.equal(validateAddress(addr()).ok, true);
  const bad = validateAddress(addr({ address: '', city: '', postalCode: '123', region: 'Ατλαντίδα' }));
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['address', 'city', 'postalCode', 'region']);
  assert.match(validateAddress(addr({ postalCode: '1234' })).errors.postalCode, /5 ψηφία/);
  assert.equal(validateAddress(addr({ postalCode: '105 63' })).ok, true);
  assert.match(validateAddress(addr({ label: 'x'.repeat(31) })).errors.label, /30/);
});

test('validateProfile checks only profile fields', () => {
  const ok = { firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.gr', phone: '6912345678', company: '', vatNumber: '' };
  assert.equal(validateProfile(ok).ok, true);
  const bad = validateProfile({ ...ok, email: 'nope', phone: '123', vatNumber: '123456789' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['email', 'phone', 'vatNumber']);
  assert.equal(validateProfile({ ...ok, vatNumber: '090000045' }).ok, true);
  assert.equal(validateProfile({ ...ok, firstName: '' }).ok, false);
});

test('normalizeAddresses assigns ids and keeps exactly one default', () => {
  const n = normalizeAddresses([addr(), addr({ city: 'Β' })]);
  assert.equal(n.length, 2);
  assert.ok(n.every((a) => a.id));
  assert.equal(n.filter((a) => a.isDefault).length, 1);
  assert.equal(n[0].isDefault, true);
  const m = normalizeAddresses([addr({ id: 'a', isDefault: true }), addr({ id: 'b', isDefault: true })]);
  assert.deepEqual(m.map((a) => a.isDefault), [true, false]);
  assert.deepEqual(normalizeAddresses(undefined), []);
});

test('pickDefaultAddress prefers the flagged one, else the first', () => {
  assert.equal(pickDefaultAddress([]), null);
  assert.equal(pickDefaultAddress([addr({ city: 'A' }), addr({ city: 'B', isDefault: true })]).city, 'B');
  assert.equal(pickDefaultAddress([addr({ city: 'A' }), addr({ city: 'B' })]).city, 'A');
});

test('add / update / remove / setDefault keep the default invariant', () => {
  let l = addAddress([], addr());
  assert.equal(l.length, 1);
  assert.equal(l[0].isDefault, true);
  l = addAddress(l, addr({ city: 'Πάτρα' }));
  assert.equal(l[1].isDefault, false);
  l = addAddress(l, addr({ city: 'Βόλος' }), { makeDefault: true });
  assert.equal(l.filter((a) => a.isDefault).length, 1);
  assert.equal(l[2].isDefault, true);
  l = setDefaultAddress(l, l[1].id);
  assert.equal(l[1].isDefault, true);
  assert.equal(l.filter((a) => a.isDefault).length, 1);
  l = updateAddress(l, l[1].id, addr({ city: 'Πάτρα 2' }));
  assert.equal(l[1].city, 'Πάτρα 2');
  assert.equal(l[1].isDefault, true);
  l = removeAddress(l, l[1].id);
  assert.equal(l.length, 2);
  assert.equal(l.filter((a) => a.isDefault).length, 1);
  assert.deepEqual(removeAddress([], 'x'), []);
});

test('address list is capped', () => {
  let l = [];
  for (let i = 0; i < MAX_ADDRESSES; i++) l = addAddress(l, addr({ city: `Π${i}` }));
  assert.throws(() => addAddress(l, addr()), /MAX/);
});

test('orderBelongsTo compares customerId strictly', () => {
  assert.equal(orderBelongsTo({ customerId: 'c-1' }, 'c-1'), true);
  assert.equal(orderBelongsTo({ customerId: 'c-1' }, 'c-2'), false);
  assert.equal(orderBelongsTo(null, 'c-1'), false);
  assert.equal(orderBelongsTo({ customerId: 'c-1' }, null), false);
});
