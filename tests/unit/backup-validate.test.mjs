// Backup import validation (Task 17). The fixture is built from the REAL seed files with the same pure
// function the seed transaction uses (seed.js buildSeedStores), so "a fresh install exports a valid backup".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedStores } from '../../assets/js/seed.js';
import { shiftSampleData } from '../../assets/js/services/sample-data.js';
import { SCHEMA_VERSION, DB_NAME, STORE_DEFS } from '../../assets/js/schema.js';
import {
  validateImport, buildBackup, BACKUP_FORMAT, MAX_ERRORS, MAX_RECORDS_PER_STORE, backupFileName, backupSizeError,
  parseBackupText, MAX_BACKUP_BYTES, countsOf,
} from '../../assets/js/services/backup-rules.js';

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

/** Fresh valid backup (deep copy) with a cart and a wishlist so those stores are exercised too. */
function fixture() {
  const stores = JSON.parse(JSON.stringify(SEED));
  const v = stores.variants.find((x) => x.stock > 2);
  stores.carts.push({ id: 'local', lines: [{ sku: v.sku, qty: 2 }], couponCode: null, updatedAt: NOW.toISOString() });
  stores.wishlists.push({ id: 'local', productIds: [stores.products[0].id, stores.products[1].id], updatedAt: NOW.toISOString() });
  return JSON.parse(JSON.stringify(buildBackup(stores, { now: NOW })));
}
const run = (obj) => validateImport(obj, { now: NOW });
const rec = (b, store, key) => b.stores[store].find((r) => r[STORE_DEFS[store].keyPath] === key);
const settingsStore = (b) => rec(b, 'settings', 'store');
const firstOrder = (b) => b.stores.orders[0];
/** Assert the backup is rejected and that some error matches every pattern. */
function rejects(obj, ...patterns) {
  const r = run(obj);
  assert.equal(r.ok, false, 'expected rejection');
  assert.equal(r.normalized, undefined, 'no normalized data on rejection');
  for (const p of patterns) assert.ok(r.errors.some((e) => p.test(e)), `no error matches ${p}:\n${r.errors.join('\n')}`);
  return r;
}

// ------------------------------------------------------------------ the valid baseline
test('a backup of the seed data validates ok (no errors, no warnings) and counts every store', () => {
  const b = fixture();
  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(b.schemaVersion, SCHEMA_VERSION);
  assert.equal(b.dbName, DB_NAME);
  assert.deepEqual(b.app, { name: 'ÉLAN Fashion Boutique', demo: true });
  assert.equal(b.exportedAt, NOW.toISOString());
  assert.deepEqual(Object.keys(b.stores).sort(), Object.keys(STORE_DEFS).sort());
  const r = run(b);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
  assert.equal(r.summary.counts.products, 39);
  assert.equal(r.summary.counts.orders, b.stores.orders.length);
  assert.equal(r.summary.counts.carts, 1);
  assert.deepEqual(r.summary.counts, countsOf(b.stores));
  assert.deepEqual(b.counts, countsOf(b.stores));
  assert.deepEqual(r.normalized, b.stores);
});

test('normalized is a deep copy: mutating it never touches the input', () => {
  const b = fixture();
  const snapshot = JSON.stringify(b);
  const r = run(b);
  r.normalized.products[0].name = 'Χακαρισμένο';
  r.normalized.orders[0].lines[0].qty = 999;
  r.normalized.settings.push({ key: 'x' });
  assert.equal(JSON.stringify(b), snapshot);
});

test('validateImport never mutates its input, even when rejecting', () => {
  const b = fixture();
  firstOrder(b).lines[0].qty = -1;
  const snapshot = JSON.stringify(b);
  run(b);
  assert.equal(JSON.stringify(b), snapshot);
});

test('data-URL product images (local uploads) are valid and kept as-is', () => {
  const b = fixture();
  const dataUrl = `data:image/webp;base64,${'A'.repeat(30000)}`;
  b.stores.products[0].images = [dataUrl, ...b.stores.products[0].images];
  const r = run(b);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.normalized.products[0].images[0], dataUrl);
});

// ------------------------------------------------------------------ envelope
test('not an object / wrong format are rejected with a Greek message', () => {
  for (const bad of [null, 42, 'x', [], undefined]) rejects(bad, /αντίγραφο ασφαλείας/);
  const b = fixture();
  b.format = 'something-else';
  rejects(b, /μορφή/);
  const c = fixture();
  delete c.format;
  rejects(c, /μορφή/);
});

test('schemaVersion: newer, older, missing or non-integer are rejected', () => {
  const newer = fixture();
  newer.schemaVersion = SCHEMA_VERSION + 1;
  rejects(newer, /δημιουργήθηκε από νεότερη έκδοση/);
  const older = fixture();
  older.schemaVersion = SCHEMA_VERSION - 1;
  rejects(older, /παλαιότερη έκδοση/);
  for (const v of [undefined, '1', 1.5, null]) {
    const b = fixture();
    b.schemaVersion = v;
    rejects(b, /schemaVersion/);
  }
});

test('a backup of another AgoraSite demo (foreign dbName) is rejected', () => {
  const b = fixture();
  b.dbName = 'agorasite-beauty1-v1';
  rejects(b, /άλλη εφαρμογή/, /agorasite-beauty1-v1/);
});

test('stores: unknown, missing and non-array stores are rejected; empty arrays are fine', () => {
  const unknown = fixture();
  unknown.stores.sessions = [];
  rejects(unknown, /Άγνωστος χώρος δεδομένων «sessions»/);
  const missing = fixture();
  delete missing.stores.reviews;
  rejects(missing, /Λείπει ο χώρος δεδομένων/, /reviews/);
  const notArray = fixture();
  notArray.stores.coupons = { WELCOME10: {} };
  rejects(notArray, /πρέπει να είναι λίστα/);
  const noStores = fixture();
  noStores.stores = [];
  rejects(noStores, /stores/);
  const empty = fixture();
  empty.stores.reviews = [];
  empty.stores.carts = [];
  assert.equal(run(empty).ok, true, run(empty).errors.join('\n'));
});

test('oversized stores (> 20.000 records) are rejected before any record check', () => {
  const b = fixture();
  b.stores.reviews = new Array(MAX_RECORDS_PER_STORE + 1).fill(0).map((_, i) => ({ id: `r${i}` }));
  const r = rejects(b, /20\.000/);
  assert.ok(r.errors.length < 5, 'no per-record noise for an oversized store');
});

// ------------------------------------------------------------------ keys
test('duplicate primary keys are rejected in every keyed store', () => {
  const cases = [
    ['products', (b) => b.stores.products.push({ ...b.stores.products[3] })],
    ['variants', (b) => b.stores.variants.push({ ...b.stores.variants[5] })],
    ['coupons', (b) => b.stores.coupons.push({ ...b.stores.coupons[0] })],
    ['customers', (b) => b.stores.customers.push({ ...b.stores.customers[0], email: 'other@example.gr' })],
    ['orders', (b) => b.stores.orders.push({ ...b.stores.orders[0] })],
    ['settings', (b) => b.stores.settings.push({ ...settingsStore(b) })],
    ['content', (b) => b.stores.content.push({ ...b.stores.content[0] })],
    ['categories', (b) => b.stores.categories.push({ ...b.stores.categories[0] })],
    ['reviews', (b) => b.stores.reviews.push({ ...b.stores.reviews[0] })],
  ];
  for (const [store, mutate] of cases) {
    const b = fixture();
    mutate(b);
    rejects(b, new RegExp(`εμφανίζεται περισσότερες από μία φορές`));
  }
});

test('missing or wrongly typed primary keys are rejected', () => {
  const b = fixture();
  delete b.stores.products[0].id;
  rejects(b, /κλειδί «id»/);
  const c = fixture();
  c.stores.variants[0].sku = 12;
  rejects(c, /κλειδί «sku»/);
  const d = fixture();
  d.stores.orders.push('ELAN-1');
  rejects(d, /πρέπει να είναι αντικείμενο/);
});

// ------------------------------------------------------------------ referential integrity
test('variant or review of an unknown product is rejected; wishlist with an unknown product is rejected', () => {
  const b = fixture();
  b.stores.variants[0].productId = 'p-ghost';
  rejects(b, /προϊόν «p-ghost» που δεν υπάρχει/);
  const c = fixture();
  c.stores.reviews[0].productId = 'p-ghost';
  rejects(c, /προϊόν «p-ghost» που δεν υπάρχει/);
  const d = fixture();
  d.stores.wishlists[0].productIds.push('p-ghost');
  rejects(d, /p-ghost/);
});

test('stale cart lines and orders of deleted customers are warnings only', () => {
  const b = fixture();
  b.stores.carts[0].lines.push({ sku: 'GONE-SKU', qty: 1 });
  firstOrder(b).customerId = 'c-deleted';
  const r = run(b);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.ok(r.warnings.some((w) => /GONE-SKU/.test(w)));
  assert.ok(r.warnings.some((w) => /c-deleted/.test(w)));
});

test('cart line quantities must be safe positive integers', () => {
  for (const qty of [0, -1, 1.5, '2', 1e9]) {
    const b = fixture();
    b.stores.carts[0].lines[0].qty = qty;
    rejects(b, /ποσότητα/);
  }
});

// ------------------------------------------------------------------ orders
test('order line qty must be a safe positive integer (≤ 10.000)', () => {
  for (const qty of [0, -1, 1.5, '2', 'NaN', 1e9, null]) {
    const b = fixture();
    firstOrder(b).lines[0].qty = qty;
    rejects(b, /ποσότητα/);
  }
  // Not representable in JSON; a programmatic import is stopped by the structural scan.
  for (const qty of [Infinity, NaN]) {
    const b = fixture();
    firstOrder(b).lines[0].qty = qty;
    rejects(b, /μη πεπερασμένος αριθμός/, /lines\[0\]\.qty/);
  }
});

test('order totals must add up (line totals, subtotal, grand total)', () => {
  const a = fixture();
  firstOrder(a).lines[0].lineTotalCents += 1;
  rejects(a, /σύνολο γραμμής/);
  const b = fixture();
  firstOrder(b).totals.subtotalCents += 100;
  rejects(b, /υποσύνολο/);
  const c = fixture();
  firstOrder(c).totals.totalCents += 1;
  rejects(c, /τελικό σύνολο/);
  const d = fixture();
  firstOrder(d).totals.discountCents = -5;
  rejects(d, /ακέραιο/);
  const e = fixture();
  firstOrder(e).lines[0].unitCents = 10.5;
  rejects(e, /ακέραιο/);
});

test('order status enums, payment method, restocked flag and history are checked', () => {
  const a = fixture();
  firstOrder(a).fulfillmentStatus = 'teleported';
  rejects(a, /κατάσταση/);
  const b = fixture();
  firstOrder(b).paymentStatus = 'paid';
  rejects(b, /κατάσταση πληρωμής/);
  const c = fixture();
  firstOrder(c).payment.method = 'card';
  rejects(c, /τρόπος πληρωμής/);
  const d = fixture();
  firstOrder(d).restocked = 'yes';
  rejects(d, /restocked/);
  const e = fixture();
  firstOrder(e).history = 'none';
  rejects(e, /ιστορικό/);
  const f = fixture();
  firstOrder(f).history.push({ at: 'never', type: 'status', detail: 'x' });
  rejects(f, /ιστορικό/);
  const g = fixture();
  firstOrder(g).internalNotes = {};
  rejects(g, /εσωτερικές σημειώσεις/);
});

test('order id format and createdAt (valid, not more than a day in the future)', () => {
  const a = fixture();
  const o = firstOrder(a);
  a.stores.orders[0] = { ...o, id: 'ORDER-1' };
  rejects(a, /κωδικός παραγγελίας/);
  const b = fixture();
  firstOrder(b).createdAt = new Date(NOW.getTime() + 2 * 86400000).toISOString();
  rejects(b, /μέλλον/);
  const c = fixture();
  firstOrder(c).createdAt = 'yesterday';
  rejects(c, /ημερομηνία/);
  const ok = fixture();
  firstOrder(ok).createdAt = new Date(NOW.getTime() + 3600000).toISOString(); // clock skew tolerated
  assert.equal(run(ok).ok, true, run(ok).errors.join('\n'));
});

test('order line image must pass the image allow-list', () => {
  const b = fixture();
  firstOrder(b).lines[0].image = 'javascript:alert(1)';
  rejects(b, /εικόνας/);
});

// ------------------------------------------------------------------ products / categories / variants
test('product image allow-list: javascript:, svg data URLs and path traversal are rejected', () => {
  for (const [src, re] of [
    ['javascript:alert(1)', /Μη έγκυρη διεύθυνση εικόνας/],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', /WebP, JPEG και PNG/],
    ['assets/../../etc/passwd.webp', /«\.\.»/],
  ]) {
    const b = fixture();
    b.stores.products[0].images = [src];
    rejects(b, re);
  }
});

test('product price rules: integer > 0, compareAt above the price', () => {
  const a = fixture();
  a.stores.products[0].priceCents = 0;
  rejects(a, /θετικός αριθμός/);
  const b = fixture();
  b.stores.products[0].priceCents = 19.99;
  rejects(b, /θετικός αριθμός/);
  const c = fixture();
  c.stores.products[0].compareAtCents = c.stores.products[0].priceCents;
  rejects(c, /τιμή προσφοράς/);
});

test('product status, flags, createdAt, category and slug uniqueness are checked', () => {
  const a = fixture();
  a.stores.products[0].status = 'deleted';
  rejects(a, /κατάσταση/);
  const b = fixture();
  b.stores.products[0].flags.featured = 'yes';
  rejects(b, /flags/);
  const c = fixture();
  c.stores.products[0].createdAt = 'soon';
  rejects(c, /ημερομηνία/);
  const d = fixture();
  d.stores.products[0].categoryId = 'robots';
  rejects(d, /Μη έγκυρη κατηγορία/);
  const e = fixture();
  e.stores.products[1].slug = e.stores.products[0].slug;
  rejects(e, /slug/);
  const f = fixture();
  f.stores.categories.find((x) => x.parentId).parentId = 'nowhere';
  rejects(f, /nowhere/);
});

test('variant fields: stock integer ≥ 0, colour hex, archived boolean', () => {
  for (const [field, value, re] of [['stock', -1, /stock/], ['stock', 2.5, /stock/], ['stock', '5', /stock/], ['colorHex', 'red', /χρώμα/], ['archived', 'no', /archived/]]) {
    const b = fixture();
    b.stores.variants[0][field] = value;
    rejects(b, re);
  }
});

// ------------------------------------------------------------------ coupons / customers
test('coupon rules: code format, type, value range, usedCount vs maxUses, expiry date', () => {
  const cases = [
    [(c) => { c.code = 'bad code!'; }, /κωδικός/],
    [(c) => { c.type = 'bogo'; }, /τύπο έκπτωσης/],
    [(c) => { c.type = 'percent'; c.value = 150; }, /ποσοστό/],
    [(c) => { c.type = 'fixed'; c.value = 0; }, /μεγαλύτερο από 0/],
    [(c) => { c.maxUses = 2; c.usedCount = 5; }, /χρήσεις/],
    [(c) => { c.usedCount = -1; }, /usedCount/],
    [(c) => { c.expiresAt = 'tomorrow'; }, /ημερομηνία/],
    [(c) => { c.active = 'yes'; }, /κατάσταση/],
  ];
  for (const [mutate, re] of cases) {
    const b = fixture();
    mutate(b.stores.coupons[0]);
    rejects(b, re);
  }
  const lower = fixture();
  lower.stores.coupons[0].code = lower.stores.coupons[0].code.toLowerCase();
  rejects(lower, /κωδικός/);
});

test('customer emails are unique case-insensitively; address list, aggregates and AFM are checked', () => {
  const a = fixture();
  const [c0, c1] = a.stores.customers;
  c1.email = c0.email.toUpperCase();
  rejects(a, /χρησιμοποιείται ήδη/);
  const b = fixture();
  b.stores.customers[0].savedAddresses = new Array(6).fill(0).map((_, i) => ({ id: `a${i}`, address: 'Οδός 1', city: 'Αθήνα', postalCode: '10552', region: 'Αττική' }));
  rejects(b, /διευθύνσεις/);
  const c = fixture();
  c.stores.customers[0].orderCount = -2;
  rejects(c, /orderCount/);
  const d = fixture();
  d.stores.customers[0].email = 'not-an-email';
  rejects(d, /email/);
  const e = fixture();
  e.stores.customers[0].vatNumber = '123456789';
  rejects(e, /ΑΦΜ/);
});

// ------------------------------------------------------------------ settings / content
test('a dishonest IRIS text is rejected (also when disguised with a zero-width character)', () => {
  for (const text of [
    'Η πληρωμή σας μέσω IRIS ολοκληρώθηκε και η παραγγελία πληρώθηκε. Ευχαριστούμε για την προσομοίωση.',
    'Προσομοίωση IRIS: η παραγγελία πλη​ρώθηκε επιτυχώς και θα αποσταλεί άμεσα.',
    'Η παραγγελία σας εξοφλήθηκε μέσω IRIS. Ευχαριστούμε!',
  ]) {
    const b = fixture();
    settingsStore(b).irisInstructions = text;
    rejects(b, /IRIS/, /απορρίφθηκαν/);
  }
});

test('store settings must pass the settings rules; seeded/newsletter records are checked; unknown keys rejected', () => {
  const a = fixture();
  settingsStore(a).courierCents = -5;
  rejects(a, /courier|ποσό/i);
  const b = fixture();
  settingsStore(b).contact.email = 'nope';
  rejects(b, /email/);
  const c = fixture();
  settingsStore(c).vatRate = 24;
  rejects(c, /ΦΠΑ/);
  const d = fixture();
  d.stores.settings = d.stores.settings.filter((s) => s.key !== 'seeded');
  rejects(d, /seeded/);
  const e = fixture();
  rec(e, 'settings', 'seeded').seededAt = 'whenever';
  rejects(e, /seededAt/);
  const f = fixture();
  f.stores.settings.push({ key: 'newsletterSubscribers', list: [{ email: 'bad', createdAt: NOW.toISOString() }] });
  rejects(f, /newsletter|email/i);
  const g = fixture();
  g.stores.settings.push({ key: 'adminPassword', value: 'x' });
  rejects(g, /adminPassword/);
  const h = fixture();
  h.stores.settings = h.stores.settings.filter((s) => s.key !== 'store');
  rejects(h, /store/);
  const ok = fixture();
  ok.stores.settings.push({ key: 'newsletterSubscribers', list: [{ email: 'maria@example.gr', createdAt: NOW.toISOString() }] });
  assert.equal(run(ok).ok, true, run(ok).errors.join('\n'));
});

test('content documents use the content validators: javascript: links rejected; all 7 keys required; legacy editorial dropped', () => {
  const a = fixture();
  rec(a, 'content', 'hero').ctaHref = 'javascript:alert(1)';
  rejects(a, /#\/ ή https:\/\//);
  const b = fixture();
  b.stores.content = b.stores.content.filter((c) => c.key !== 'footer');
  rejects(b, /footer/);
  const c = fixture();
  c.stores.content.push({ key: 'popup', text: 'x' });
  rejects(c, /popup/);
  const d = fixture();
  d.stores.content.push({ key: 'editorial', items: [] });
  const r = run(d);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.ok(r.warnings.some((w) => /editorial/.test(w)));
  assert.ok(!r.normalized.content.some((x) => x.key === 'editorial'));
});

// ------------------------------------------------------------------ hostile structure
test('__proto__ / constructor / prototype keys anywhere are rejected (prototype-pollution defence)', () => {
  for (const json of [
    (s) => s.replace('"format":', '"__proto__":{"polluted":1},"format":'),
    (s) => s.replace('"slug":', '"constructor":{"prototype":{"x":1}},"slug":'),
    (s) => s.replace('"lines":[', '"lines":[{"__proto__":{"admin":true},"sku":"X","qty":1},'),
  ]) {
    const obj = JSON.parse(json(JSON.stringify(fixture())));
    rejects(obj, /μη επιτρεπτό κλειδί/);
    assert.equal(({}).polluted, undefined);
    assert.equal(({}).admin, undefined);
  }
});

test('non-JSON values and absurd strings are rejected', () => {
  const a = fixture();
  a.stores.products[0].description = 'x'.repeat(20001);
  rejects(a, /20\.000 χαρακτήρες/);
  const b = fixture();
  b.stores.products[0].popularity = () => 1;
  rejects(b, /μη υποστηριζόμενη τιμή/);
  const c = fixture();
  let deep = {};
  const top = deep;
  for (let i = 0; i < 100; i++) { deep.x = {}; deep = deep.x; }
  c.stores.products[0].attributes = top;
  rejects(c, /βάθος/);
});

// ------------------------------------------------------------------ error list
test('error list is ordered (envelope, then stores in schema order) and capped at 50 + «…και άλλα N»', () => {
  const b = fixture();
  b.stores.orders.forEach((o) => { o.lines[0].qty = 0; });
  b.stores.variants[0].stock = -1;
  const r = rejects(b, /ποσότητα/);
  assert.equal(r.errors.length, MAX_ERRORS + 1);
  assert.match(r.errors[MAX_ERRORS], /^…και άλλα \d+ σφάλματα$/);
  const total = Number(/\d+/.exec(r.errors[MAX_ERRORS])[0]) + MAX_ERRORS;
  assert.ok(total >= b.stores.orders.length + 1);
  assert.match(r.errors[0], /Παραλλαγές/); // variants come before orders in schema order
});

// ------------------------------------------------------------------ helpers
test('file helpers: file name, size guard, JSON parse errors in Greek', () => {
  assert.equal(backupFileName(new Date(2026, 9, 6, 23, 30)), 'elan-backup-2026-10-06.json');
  assert.equal(backupSizeError(1000), '');
  assert.match(backupSizeError(MAX_BACKUP_BYTES + 1), /50 MB/);
  assert.match(backupSizeError(0), /κενό/);
  const bad = parseBackupText('{"format": ');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /JSON/);
  const ok = parseBackupText(JSON.stringify(fixture()));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.format, BACKUP_FORMAT);
});
