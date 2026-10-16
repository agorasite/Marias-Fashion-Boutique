import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCustomer } from '../../assets/js/services/customers.js';
import { MAX_ADDRESSES } from '../../assets/js/services/account-rules.js';

const form = (o = {}) => ({
  firstName: 'Μαρία', lastName: 'Π', email: 'a@example.gr', phone: '6912345678', address: 'Νέα 1', city: 'Αθήνα',
  postalCode: '10563', region: 'Αττική', shippingMethod: 'courier', ...o,
});
const addr = (i, def = false) => ({ id: `a${i}`, address: `Οδός ${i}`, city: 'Αθήνα', postalCode: '10563', region: 'Αττική', isDefault: def });
const full = () => ({ id: 'c-x', email: 'b@example.gr', createdAt: 't', savedAddresses: [0, 1, 2, 3, 4].map((i) => addr(i, i === 4)), orderCount: 1, totalCents: 100 });

test('shared cap is 5', () => assert.equal(MAX_ADDRESSES, 5));

test('merge never overwrites an existing record email or id', () => {
  const n = mergeCustomer(full(), form({ email: 'a@example.gr' }), { now: 'n', order: { totalCents: 50 } });
  assert.equal(n.email, 'b@example.gr');
  assert.equal(n.id, 'c-x');
  assert.equal(n.orderCount, 2);
});

test('new record takes the provided id', () => {
  const n = mergeCustomer(null, form(), { now: 'n', id: 'c-h-2' });
  assert.equal(n.id, 'c-h-2');
  assert.equal(n.email, 'a@example.gr');
});

test('full list: new address skipped, nothing dropped, default kept, info flagged', () => {
  const info = {};
  const n = mergeCustomer(full(), form(), { now: 'n', saveDetails: true, info });
  assert.deepEqual(n.savedAddresses.map((a) => a.id), ['a0', 'a1', 'a2', 'a3', 'a4']);
  assert.equal(n.savedAddresses.find((a) => a.isDefault).id, 'a4');
  assert.equal(info.addressSkipped, true);
});

test('full list: a re-used identical address keeps its id and default', () => {
  const info = {};
  const n = mergeCustomer(full(), form({ address: 'οδός 4' }), { now: 'n', saveDetails: true, info });
  assert.equal(n.savedAddresses.length, 5);
  assert.equal(n.savedAddresses[4].id, 'a4');
  assert.equal(n.savedAddresses[4].isDefault, true);
  assert.equal(info.addressSkipped, undefined);
});

test('list with room: new address added without touching the default', () => {
  const c = full();
  c.savedAddresses.pop();
  c.savedAddresses[3].isDefault = true;
  const n = mergeCustomer(c, form(), { now: 'n', saveDetails: true });
  assert.equal(n.savedAddresses.length, 5);
  assert.equal(n.savedAddresses.find((a) => a.isDefault).id, 'a3');
});
