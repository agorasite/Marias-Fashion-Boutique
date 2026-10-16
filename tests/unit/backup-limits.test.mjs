// Task 17 fix round: limits parity between editors/services and the backup import, plus import hardening.
// Rule: a backup of data the app itself accepted must ALWAYS import (the import is never stricter).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedStores } from '../../assets/js/seed.js';
import { shiftSampleData } from '../../assets/js/services/sample-data.js';
import { STORE_DEFS } from '../../assets/js/schema.js';
import { validateImport, buildBackup, MAX_ERRORS } from '../../assets/js/services/backup-rules.js';
import * as LIMITS from '../../assets/js/services/limits.js';
import { validateProductInput, MAX_DATA_URL_CHARS } from '../../assets/js/services/product-admin-rules.js';
import { validateCheckoutForm, NOTES_MAX } from '../../assets/js/services/checkout-rules.js';
import { clampQty } from '../../assets/js/services/cart-rules.js';
import { NOTE_MAX } from '../../assets/js/services/order-rules.js';
import { IRIS_MAX } from '../../assets/js/services/settings-rules.js';
import { MAX_ADDRESSES } from '../../assets/js/services/account-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const NOW = new Date('2026-10-16T12:00:00.000Z');
const SEED = buildSeedStores({
  meta: read('data/catalog-meta.json'),
  products: read('data/products.json').products,
  content: read('data/content.json'),
  reviews: read('data/reviews.json').reviews,
  sample: shiftSampleData(read('data/sample-data.json'), NOW),
}, { now: NOW });

function fixture() {
  const stores = JSON.parse(JSON.stringify(SEED));
  const v = stores.variants.find((x) => x.stock > 2);
  stores.carts.push({ id: 'local', lines: [{ sku: v.sku, qty: 2 }], couponCode: null, updatedAt: NOW.toISOString() });
  return JSON.parse(JSON.stringify(buildBackup(stores, { now: NOW })));
}
const run = (obj) => validateImport(obj, { now: NOW });
const rec = (b, store, key) => b.stores[store].find((r) => r[STORE_DEFS[store].keyPath] === key);
const settingsStore = (b) => rec(b, 'settings', 'store');
const firstOrder = (b) => b.stores.orders[0];
function rejects(obj, ...patterns) {
  const r = run(obj);
  assert.equal(r.ok, false, 'expected rejection');
  for (const p of patterns) assert.ok(r.errors.some((e) => p.test(e)), `no error matches ${p}:\n${r.errors.join('\n')}`);
  return r;
}
const productInput = (b, over = {}) => {
  const p = b.stores.products[0];
  return { ...p, variants: b.stores.variants.filter((v) => v.productId === p.id && !v.archived), ...over };
};
const productCtx = (b) => ({ existingProducts: b.stores.products, categories: b.stores.categories, editingId: b.stores.products[0].id });

// ------------------------------------------------------------------ limits parity
test('limits: the import string cap is above every editor/service cap', () => {
  for (const cap of [LIMITS.PRODUCT_NAME_MAX, LIMITS.DESCRIPTION_MAX, LIMITS.ATTRIBUTE_MAX, LIMITS.PERSON_NAME_MAX, LIMITS.COMPANY_MAX,
    LIMITS.ADDRESS_MAX, LIMITS.CITY_MAX, LIMITS.EMAIL_MAX, NOTES_MAX, NOTE_MAX, IRIS_MAX]) {
    assert.ok(cap < LIMITS.IMPORT_STRING_MAX, `${cap} < ${LIMITS.IMPORT_STRING_MAX}`);
  }
  assert.equal(LIMITS.STOCK_MAX, 1000000);
  assert.equal(LIMITS.LINE_QTY_MAX, 10000);
});

test('limits parity: an export holding the editors’ MAXIMUM allowed values imports', () => {
  const b = fixture();
  const p = b.stores.products[0];
  p.name = 'Ν'.repeat(LIMITS.PRODUCT_NAME_MAX);
  p.description = 'Π'.repeat(LIMITS.DESCRIPTION_MAX);
  p.attributes = { material: 'Μ'.repeat(LIMITS.ATTRIBUTE_MAX), care: 'Φ'.repeat(LIMITS.ATTRIBUTE_MAX), fit: 'Ε'.repeat(LIMITS.ATTRIBUTE_MAX) };
  p.images = [`data:image/jpeg;base64,${'A'.repeat(MAX_DATA_URL_CHARS - 40)}`, ...new Array(9).fill(0).map((_, i) => `assets/images/products/x-${i + 1}.webp`)];
  p.priceCents = 99999999999; // eurosToCents maximum (9 integer digits)
  delete p.compareAtCents;
  const vs = b.stores.variants.filter((v) => v.productId === p.id);
  vs[0].stock = LIMITS.STOCK_MAX;
  vs[1].stock = LIMITS.STOCK_MAX + 5000; // a restock after cancel/return may lift stock above the editor cap
  const ed = validateProductInput(productInput(b, { variants: productInput(b).variants.map((v) => ({ ...v, stock: Math.min(v.stock, LIMITS.STOCK_MAX) })) }), productCtx(b));
  assert.equal(ed.ok, true, `the editor accepts these values: ${JSON.stringify(ed.errors)}`);
  const c = b.stores.customers[0];
  c.firstName = 'Α'.repeat(LIMITS.PERSON_NAME_MAX);
  c.lastName = 'Β'.repeat(LIMITS.PERSON_NAME_MAX);
  c.company = 'Γ'.repeat(LIMITS.COMPANY_MAX);
  c.savedAddresses = new Array(MAX_ADDRESSES).fill(0).map((_, i) => ({
    id: `a-${i}`, label: 'Λ'.repeat(30), address: 'Δ'.repeat(LIMITS.ADDRESS_MAX), city: 'Π'.repeat(LIMITS.CITY_MAX), postalCode: '10552', region: 'Αττική', isDefault: i === 0,
  }));
  c.totalCents = Number.MAX_SAFE_INTEGER;
  const o = firstOrder(b);
  o.notes = 'Σ'.repeat(NOTES_MAX);
  o.internalNotes = [{ at: NOW.toISOString(), text: 'Ε'.repeat(NOTE_MAX), by: 'admin-demo' }];
  o.lines = [{ ...o.lines[0], qty: LIMITS.LINE_QTY_MAX, unitCents: 99999999999, lineTotalCents: LIMITS.LINE_QTY_MAX * 99999999999 }];
  const sub = o.lines[0].lineTotalCents;
  o.totals = { subtotalCents: sub, discountCents: 0, shippingCents: 0, codFeeCents: o.totals.codFeeCents, totalCents: sub + o.totals.codFeeCents };
  o.totals.vatIncludedCents = o.totals.totalCents - Math.round(o.totals.totalCents / (1 + o.vatRate));
  o.shipping.costCents = 0;
  b.stores.carts[0].lines[0].qty = LIMITS.LINE_QTY_MAX;
  b.stores.coupons[0].usedCount = 5000000000;
  settingsStore(b).irisInstructions = `Προσομοίωση IRIS, καμία πραγματική χρέωση. ${'α'.repeat(IRIS_MAX - 60)}`;
  const r = run(b);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('limits: editors and services reject values beyond the caps with a Greek message naming the limit', () => {
  const b = fixture();
  const check = (over, field, re) => {
    const r = validateProductInput(productInput(b, over), productCtx(b));
    assert.equal(r.ok, false, field);
    assert.match(r.errors[field] || '', re, field);
  };
  check({ name: 'Ν'.repeat(LIMITS.PRODUCT_NAME_MAX + 1) }, 'name', /200 χαρακτήρες/);
  check({ description: 'Π'.repeat(LIMITS.DESCRIPTION_MAX + 1) }, 'description', /5\.000 χαρακτήρες/);
  check({ attributes: { material: 'Μ'.repeat(LIMITS.ATTRIBUTE_MAX + 1) } }, 'material', /1\.000 χαρακτήρες/);
  const vs = productInput(b).variants.map((v, i) => (i === 0 ? { ...v, stock: LIMITS.STOCK_MAX + 1 } : v));
  check({ variants: vs }, 'variants[0].stock', /1\.000\.000/);
  const form = {
    firstName: 'Μαρία', lastName: 'Παπά', email: 'm@example.gr', phone: '6912345678', shippingMethod: 'courier', paymentMethod: 'cod',
    address: 'Ερμού 25', city: 'Αθήνα', postalCode: '10563', region: 'Αττική', acceptTerms: true,
  };
  assert.equal(validateCheckoutForm(form).ok, true);
  for (const [field, value, re] of [
    ['firstName', 'Α'.repeat(LIMITS.PERSON_NAME_MAX + 1), /60 χαρακτήρες/],
    ['lastName', 'Α'.repeat(LIMITS.PERSON_NAME_MAX + 1), /60 χαρακτήρες/],
    ['company', 'Α'.repeat(LIMITS.COMPANY_MAX + 1), /120 χαρακτήρες/],
    ['address', 'Α'.repeat(LIMITS.ADDRESS_MAX + 1), /120 χαρακτήρες/],
    ['city', 'Α'.repeat(LIMITS.CITY_MAX + 1), /60 χαρακτήρες/],
    ['email', `${'a'.repeat(250)}@example.gr`, /254 χαρακτήρες/],
  ]) {
    const r = validateCheckoutForm({ ...form, [field]: value });
    assert.match(r.errors[field] || '', re, field);
  }
  assert.equal(clampQty(50000, 2000000), LIMITS.LINE_QTY_MAX);
});

// ------------------------------------------------------------------ minors
test('error count: the «…και άλλα N» suffix is the true remainder (structural errors included)', () => {
  const b = fixture();
  b.stores.orders.forEach((o) => { o.lines[0].qty = 0; });
  b.stores.variants.slice(0, 10).forEach((v) => { v.stock = -1; });
  const r = run(b);
  assert.equal(r.errors.length, MAX_ERRORS + 1);
  assert.equal(r.errors[MAX_ERRORS], `…και άλλα ${b.stores.orders.length + 10 - MAX_ERRORS} σφάλματα`);
  const json = JSON.stringify(fixture()).replace('"products":[', `"products":[${new Array(70).fill('{"__proto__":1}').join(',')},`);
  const r2 = run(JSON.parse(json));
  assert.equal(r2.errors[MAX_ERRORS], '…και άλλα 20 σφάλματα');
});

test('dates must be ISO-8601 strings', () => {
  const cases = [
    [(b) => { firstOrder(b).createdAt = Date.now(); }, /ημερομηνία/],
    [(b) => { firstOrder(b).createdAt = 'October 1, 2026'; }, /ημερομηνία/],
    [(b) => { b.stores.products[0].createdAt = '2026-08-03'; }, /ημερομηνία/],
    [(b) => { b.stores.coupons[0].expiresAt = '2026/12/31'; }, /ημερομηνία/],
    [(b) => { rec(b, 'settings', 'seeded').seededAt = Date.now(); }, /seededAt/],
    [(b) => { firstOrder(b).history[0].at = 'Mon Oct 05 2026 10:00:00'; }, /ιστορικό/],
    [(b) => { b.exportedAt = 'yesterday'; }, /exportedAt/],
    [(b) => { b.stores.reviews[0].createdAt = 1700000000000; }, /ημερομηνία/],
  ];
  for (const [mutate, re] of cases) {
    const b = fixture();
    mutate(b);
    rejects(b, re);
  }
  for (const iso of ['2026-12-31T23:59:59Z', new Date(2026, 11, 31, 23, 59, 59, 999).toISOString(), '2026-12-31T23:59:59+02:00']) {
    const ok = fixture();
    ok.stores.coupons[0].expiresAt = iso;
    assert.equal(run(ok).ok, true, `${iso}: ${run(ok).errors.join('\n')}`);
  }
});

test('order cross-checks: VAT included, shipping cost mirror, pickup ships free', () => {
  const a = fixture();
  firstOrder(a).totals.vatIncludedCents += 1;
  rejects(a, /ΦΠΑ/);
  const b = fixture();
  firstOrder(b).shipping.costCents += 100;
  rejects(b, /έξοδα αποστολής/);
  const c = fixture();
  const o = c.stores.orders.find((x) => x.shipping.method === 'pickup');
  o.shipping.costCents = 390;
  o.totals.shippingCents = 390;
  o.totals.totalCents += 390;
  o.totals.vatIncludedCents = o.totals.totalCents - Math.round(o.totals.totalCents / (1 + o.vatRate));
  rejects(c, /παραλαβή/);
});

test('settings leaves must be strings or null', () => {
  for (const mutate of [
    (s) => { s.social.instagram = ['https://instagram.com/x']; },
    (s) => { s.contact.openingHours = { from: 10 }; },
    (s) => { s.contact.email = ['info@elan.example']; },
    (s) => { s.logo = { text: 'ÉLAN', alt: 5 }; },
  ]) {
    const b = fixture();
    mutate(settingsStore(b));
    rejects(b, /κείμενο/);
  }
});

test('hostile property names are truncated in error messages', () => {
  const b = fixture();
  b.stores.products[0].attributes = { ['κ'.repeat(5000)]: 'x'.repeat(LIMITS.IMPORT_STRING_MAX + 1) };
  const r = rejects(b, /χαρακτήρες/);
  assert.ok(r.errors.every((e) => e.length < 400), r.errors.map((e) => e.length).join(','));
  assert.ok(r.errors.some((e) => e.includes('…')));
});
