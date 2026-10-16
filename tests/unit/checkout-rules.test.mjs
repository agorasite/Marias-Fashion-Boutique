import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCheckoutForm, isValidAfm, normalizePhone, REGIONS, customerIdFromEmail, makeOrderId,
  ORDER_ID_RE,
} from '../../assets/js/services/checkout-rules.js';

const valid = () => ({
  firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: 'maria@example.gr', phone: '6912345678',
  address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική',
  company: '', vatNumber: '', notes: '', shippingMethod: 'courier', paymentMethod: 'cod', acceptTerms: true,
});
const errs = (patch) => validateCheckoutForm({ ...valid(), ...patch }).errors;

test('a complete valid form passes', () => {
  const r = validateCheckoutForm(valid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('names are required, trimmed and at least 2 chars', () => {
  assert.ok(errs({ firstName: '' }).firstName);
  assert.ok(errs({ firstName: '   ' }).firstName);
  assert.ok(errs({ firstName: ' Μ ' }).firstName);
  assert.equal(errs({ firstName: ' Μα ' }).firstName, undefined);
  assert.ok(errs({ lastName: 'Π' }).lastName);
  assert.equal(errs({ lastName: 'Πα' }).lastName, undefined);
  assert.match(errs({ firstName: '' }).firstName, /[Α-ω]/); // Greek message
});

test('email must be valid', () => {
  for (const bad of ['', 'maria', 'maria@', 'maria@example', 'ma ria@example.gr', '@example.gr']) {
    assert.ok(errs({ email: bad }).email, bad);
  }
  for (const good of ['maria@example.gr', ' Maria.P+shop@sub.example.com ']) {
    assert.equal(errs({ email: good }).email, undefined, good);
  }
});

test('phone accepts Greek mobile/landline with prefixes, spaces and dashes', () => {
  for (const good of ['6912345678', '2101234567', '+306912345678', '00306912345678', '+30 691 234 5678',
    '210-123-4567', '0030 210 1234567', '69 1234 5678']) {
    assert.equal(errs({ phone: good }).phone, undefined, good);
    assert.match(normalizePhone(good), /^(69\d{8}|2\d{9})$/);
  }
  for (const bad of ['', '691234567', '69123456789', '6812345678', '1234567890', '+446912345678', '30691234567', 'abcdefghij', '+30 691 234 567']) {
    assert.ok(errs({ phone: bad }).phone, bad);
  }
});

test('courier requires address (>=5), city, 5-digit postal code and a listed region', () => {
  assert.ok(errs({ address: '' }).address);
  assert.ok(errs({ address: 'Ερμ ' }).address);
  assert.equal(errs({ address: 'Ερμού' }).address, undefined);
  assert.ok(errs({ city: ' ' }).city);
  for (const bad of ['', '1234', '123456', 'abcde', '10 5 63x']) assert.ok(errs({ postalCode: bad }).postalCode, bad);
  for (const good of ['10563', '105 63']) assert.equal(errs({ postalCode: good }).postalCode, undefined, good);
  assert.ok(errs({ region: '' }).region);
  assert.ok(errs({ region: 'Atlantis' }).region);
  for (const r of REGIONS) assert.equal(errs({ region: r }).region, undefined, r);
});

test('Greek regions list covers the 13 περιφέρειες', () => {
  assert.equal(REGIONS.length, 13);
  assert.ok(REGIONS.includes('Αττική'));
  assert.ok(REGIONS.includes('Κρήτη'));
});

test('pickup requires only contact fields', () => {
  const r = validateCheckoutForm({ ...valid(), shippingMethod: 'pickup', address: '', city: '', postalCode: '', region: '' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  // contact fields are still required
  const r2 = validateCheckoutForm({ ...valid(), shippingMethod: 'pickup', address: '', phone: '' });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.phone);
  assert.equal(r2.errors.address, undefined);
  // a malformed postal code is ignored for pickup (field is not used)
  assert.equal(validateCheckoutForm({ ...valid(), shippingMethod: 'pickup', postalCode: 'xx' }).ok, true);
});

test('AFM: 9 digits with a valid check digit', () => {
  assert.equal(isValidAfm('090000045'), true);
  assert.equal(isValidAfm('094014201'), true);
  assert.equal(isValidAfm('094014202'), false); // wrong check digit
  assert.equal(isValidAfm('000000000'), false);
  assert.equal(isValidAfm('12345678'), false);
  assert.equal(isValidAfm('1234567890'), false);
  assert.equal(isValidAfm('09000004a'), false);
});

test('vatNumber is optional; when present it must be a valid AFM', () => {
  assert.equal(errs({ vatNumber: '' }).vatNumber, undefined);
  assert.equal(errs({ vatNumber: '  ' }).vatNumber, undefined);
  assert.equal(errs({ vatNumber: '090000045' }).vatNumber, undefined);
  assert.equal(errs({ vatNumber: 'EL090000045' }).vatNumber, undefined);
  assert.equal(errs({ vatNumber: '090 000 045' }).vatNumber, undefined);
  assert.match(errs({ vatNumber: '12345' }).vatNumber, /9/);
  assert.ok(errs({ vatNumber: '090000046' }).vatNumber);
  assert.notEqual(errs({ vatNumber: '12345' }).vatNumber, errs({ vatNumber: '090000046' }).vatNumber);
});

test('company is optional, notes up to 500 chars', () => {
  assert.equal(errs({ company: '' }).company, undefined);
  assert.equal(errs({ notes: 'x'.repeat(500) }).notes, undefined);
  assert.ok(errs({ notes: 'x'.repeat(501) }).notes);
});

test('shipping and payment methods are restricted', () => {
  assert.ok(errs({ shippingMethod: 'drone' }).shippingMethod);
  assert.ok(errs({ shippingMethod: undefined }).shippingMethod);
  assert.ok(errs({ paymentMethod: 'card' }).paymentMethod);
  assert.equal(errs({ paymentMethod: 'iris' }).paymentMethod, undefined);
});

test('terms must be explicitly accepted (true)', () => {
  assert.ok(errs({ acceptTerms: false }).acceptTerms);
  assert.ok(errs({ acceptTerms: 'true' }).acceptTerms);
  assert.ok(errs({ acceptTerms: undefined }).acceptTerms);
});

test('validation is pure and tolerates missing input', () => {
  const r = validateCheckoutForm(undefined);
  assert.equal(r.ok, false);
  for (const f of ['firstName', 'lastName', 'email', 'phone', 'acceptTerms']) assert.ok(r.errors[f], f);
  const input = valid();
  const copy = JSON.stringify(input);
  validateCheckoutForm(input);
  assert.equal(JSON.stringify(input), copy);
});

test('customer id is deterministic from the lowercased trimmed email', () => {
  const a = customerIdFromEmail('Maria@Example.gr ');
  assert.equal(a, customerIdFromEmail('maria@example.gr'));
  assert.match(a, /^c-[0-9a-z]+$/);
  assert.notEqual(a, customerIdFromEmail('maria2@example.gr'));
});

test('order ids look like ELAN-YYYYMMDD-XXXX', () => {
  const id = makeOrderId(new Date(2026, 9, 6, 23, 59), () => 0.5);
  assert.match(id, ORDER_ID_RE);
  assert.ok(id.startsWith('ELAN-20261006-'));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(makeOrderId(new Date()));
  assert.ok(seen.size > 190);
  for (const x of seen) assert.match(x, /^ELAN-\d{8}-[0-9A-Z]{4}$/);
});
