// Pure backup rules (no DB, no DOM — importable from Node): the export envelope, file helpers and the
// import validator. services/backup.js does the IndexedDB work; pages/admin/backup.js is the UI.
//
// DECISIONS (Task 17)
// - Envelope: { format:'elan-demo-backup', schemaVersion, dbName, exportedAt, app:{name, demo:true}, counts, stores }.
//   It is a LOCAL file, never described as a cloud backup.
// - schemaVersion must EQUAL the current SCHEMA_VERSION. Newer → rejected («δημιουργήθηκε από νεότερη έκδοση»).
//   Older → rejected too: no data migration between schema versions exists yet (add one here when v2 ships).
// - dbName must equal DB_NAME: backups of other AgoraSite demos are rejected, not "best-effort" merged.
// - stores must contain EXACTLY the 11 known stores (unknown → error, missing → error), each an array
//   (empty arrays allowed), at most MAX_RECORDS_PER_STORE records each.
// - Every record: plain object, primary key present (string, ≤ 200 chars) and unique per store.
// - The whole object is deep-scanned first: `__proto__` / `constructor` / `prototype` keys, non-JSON values
//   (functions, NaN, Infinity, class instances…), nesting deeper than MAX_DEPTH and strings longer than
//   MAX_STRING (except raster image data URLs that pass the image allow-list) are rejected.
// - Each store is checked with the SAME rule functions the app uses when editing (never duplicated):
//   products → validateProductInput (+ status/flags/createdAt), coupons → validateCouponInput + couponStatus
//   inputs, settings 'store' → validateSettingsInput(settingsToForm(..)) incl. the IRIS honesty guard
//   (a dishonest IRIS text REJECTS the whole backup: replacing it silently would hide what was in the file),
//   content → validateContent per key, newsletter emails → validateNewsletterEmail, order enums →
//   ORDER_STATUSES / PAYMENT_STATUSES, order ids → ORDER_ID_RE, images → imageSourceError.
// - Order lines: qty must be a safe positive integer ≤ MAX_LINE_QTY (planRestock trusts it), money
//   integer ≥ 0, lineTotal = qty × unit, subtotal = Σ lineTotal, total = max(0, subtotal − discount +
//   shipping + COD fee) — the same formula as pricing.quote. createdAt more than 1 day ahead → error.
// - Referential integrity: variants/reviews/wishlist → products and categories.parentId → categories are
//   ERRORS; stale cart lines (unknown SKU) and orders whose customer/coupon no longer exists are WARNINGS
//   (the cart flags unknown lines itself; orders are immutable snapshots that may outlive customers).
// - settings keys: 'store' and 'seeded' are required (without 'seeded' the next load would re-seed over the
//   import), 'newsletterSubscribers' optional, anything else → error.
// - content keys: all 7 CONTENT_KEYS required; the legacy 'editorial' record → warning and dropped; any
//   other key → error.
// - Errors are Greek, ordered (envelope, then stores in schema order, records in file order) and capped at
//   MAX_ERRORS plus a final «…και άλλα N σφάλματα».
import { SCHEMA_VERSION, DB_NAME, STORE_DEFS } from '../schema.js';
import { validateProductInput, imageSourceError, isValidHex, centsToEuros, MAX_DATA_URL_CHARS, SLUG_RE } from './product-admin-rules.js';
import { validateSettingsInput, settingsToForm, irisInstructionsError } from './settings-rules.js';
import { validateCouponInput, COUPON_CODE_RE, COUPON_TYPES } from './coupon-rules.js';
import { CONTENT_KEYS, NEWSLETTER_KEY, validateContent, validateNewsletterEmail } from './content-rules.js';
import { ORDER_STATUSES, PAYMENT_STATUSES } from './order-rules.js';
import { ORDER_ID_RE, PAYMENT_METHODS, SHIPPING_METHODS, isValidAfm, normalizeAfm } from './checkout-rules.js';
import { MAX_ADDRESSES } from './account-rules.js';
import { normalizeEmail } from './customer-rules.js';
import { normalizeText } from './products.js';

export const BACKUP_FORMAT = 'elan-demo-backup';
export const BACKUP_APP = Object.freeze({ name: 'ÉLAN Fashion Boutique', demo: true });
export const STORE_NAMES = Object.keys(STORE_DEFS);
export const MAX_RECORDS_PER_STORE = 20000;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_ERRORS = 50;
export const MAX_STRING = 20000;
export const MAX_DEPTH = 32;
export const MAX_LINE_QTY = 10000;
export const MAX_STOCK = 1000000;
export const FUTURE_TOLERANCE_MS = 86400000;

export const STORE_LABELS = {
  categories: 'Κατηγορίες', products: 'Προϊόντα', variants: 'Παραλλαγές', carts: 'Καλάθι', wishlists: 'Αγαπημένα',
  customers: 'Πελάτες', orders: 'Παραγγελίες', coupons: 'Κουπόνια', reviews: 'Κριτικές', settings: 'Ρυθμίσεις', content: 'Περιεχόμενο',
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MONEY_LIMIT = 1e11; // 1 δισ. € in cents: anything above is not a demo value

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPlain = (v) => {
  if (!isObj(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isIntIn = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const isCents = (v) => isIntIn(v, 0, MONEY_LIMIT);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const time = (v) => (isStr(v) || (typeof v === 'number' && Number.isFinite(v)) ? new Date(v).getTime() : NaN);
const validDate = (v) => !Number.isNaN(time(v));
const quote = (v) => `«${String(v).slice(0, 80)}»`;

// ------------------------------------------------------------------ envelope + file helpers

/** { store: count } for a stores map. */
export const countsOf = (stores) => Object.fromEntries(STORE_NAMES.map((s) => [s, Array.isArray(stores && stores[s]) ? stores[s].length : 0]));

/** The export envelope around `stores` (records are taken as they are; JSON-serialise with serializeBackup). */
export function buildBackup(stores, { now = new Date(), schemaVersion = SCHEMA_VERSION, dbName = DB_NAME } = {}) {
  const ordered = Object.fromEntries(STORE_NAMES.map((s) => [s, Array.isArray(stores && stores[s]) ? stores[s] : []]));
  return {
    format: BACKUP_FORMAT,
    schemaVersion,
    dbName,
    exportedAt: now.toISOString(),
    app: { ...BACKUP_APP },
    counts: countsOf(ordered),
    stores: ordered,
  };
}

export const serializeBackup = (obj) => JSON.stringify(obj, null, 2);

/** Local-date file name: elan-backup-YYYY-MM-DD.json */
export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `elan-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/** '' when a file of `bytes` may be read; a Greek error otherwise (checked BEFORE reading/parsing). */
export function backupSizeError(bytes) {
  if (!(Number(bytes) > 0)) return 'Το αρχείο είναι κενό.';
  if (bytes > MAX_BACKUP_BYTES) return `Το αρχείο είναι πολύ μεγάλο (${(bytes / 1048576).toFixed(1).replace('.', ',')} MB). Το όριο είναι 50 MB.`;
  return '';
}

/** JSON.parse in a try/catch: { ok:true, value } or { ok:false, error (Greek) }. */
export function parseBackupText(text) {
  try {
    return { ok: true, value: JSON.parse(String(text ?? '')) };
  } catch (e) {
    return { ok: false, error: 'Το αρχείο δεν είναι έγκυρο JSON (ίσως είναι κατεστραμμένο ή δεν είναι αντίγραφο ασφαλείας του ÉLAN).' };
  }
}

// ------------------------------------------------------------------ deep scan + safe copy

/**
 * Walk the whole value once: reject forbidden keys, non-JSON values, excessive depth and long strings,
 * and build a deep copy at the same time (so the result can never share references with the input).
 */
function scanAndCopy(value, err) {
  let reported = 0;
  const report = (msg) => { if (reported < MAX_ERRORS + 1) { reported += 1; err(msg); } };
  const walk = (v, p, depth) => {
    if (depth > MAX_DEPTH) { report(`${p}: υπερβολικό βάθος εμφώλευσης δεδομένων.`); return null; }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) { report(`${p}: μη υποστηριζόμενη τιμή (μη πεπερασμένος αριθμός).`); return null; }
      return v;
    }
    if (typeof v === 'string') {
      if (v.length > MAX_STRING && !(v.startsWith('data:image/') && v.length <= MAX_DATA_URL_CHARS && !imageSourceError(v))) {
        report(`${p}: το κείμενο ξεπερνά τους ${fmtInt(MAX_STRING)} χαρακτήρες.`);
        return '';
      }
      return v;
    }
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i += 1) out[i] = walk(v[i], `${p}[${i}]`, depth + 1);
      return out;
    }
    if (!isPlain(v)) { report(`${p}: μη υποστηριζόμενη τιμή (${typeof v}).`); return null; }
    const out = {};
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) { report(`${p}: μη επιτρεπτό κλειδί «${k}».`); continue; }
      out[k] = walk(v[k], `${p}.${k}`, depth + 1);
    }
    // Own keys hidden from Object.keys (e.g. a non-enumerable __proto__) are suspicious too.
    for (const k of Object.getOwnPropertyNames(v)) if (FORBIDDEN_KEYS.has(k) && !Object.keys(v).includes(k)) report(`${p}: μη επιτρεπτό κλειδί «${k}».`);
    return out;
  };
  return walk(value, 'αρχείο', 0);
}

// ------------------------------------------------------------------ per-store validators
// Each gets (rec, ctx) and reports through ctx.err(msg) / ctx.warn(msg) (messages are prefixed by the caller).

function checkDate(ctx, rec, field, { required = true, label = field } = {}) {
  if (rec[field] === undefined || rec[field] === null) {
    if (required) ctx.err(`λείπει η ημερομηνία «${label}».`);
    return;
  }
  if (!validDate(rec[field])) ctx.err(`μη έγκυρη ημερομηνία «${label}».`);
}

const optionalBool = (ctx, obj, field, label = field) => {
  if (obj[field] !== undefined && !isBool(obj[field])) ctx.err(`το πεδίο «${label}» πρέπει να είναι true ή false.`);
};
const optionalStr = (ctx, obj, field, max = MAX_STRING) => {
  if (obj[field] !== undefined && obj[field] !== null && (!isStr(obj[field]) || obj[field].length > max)) ctx.err(`το πεδίο «${field}» πρέπει να είναι κείμενο.`);
};

function validateCategory(c, ctx) {
  if (!isStr(c.name) || !c.name.trim()) ctx.err('λείπει το όνομα της κατηγορίας.');
  if (c.slug !== undefined && (!isStr(c.slug) || !SLUG_RE.test(c.slug))) ctx.err('μη έγκυρο slug κατηγορίας.');
  if (c.parentId !== null && c.parentId !== undefined) {
    const parent = ctx.byId.categories.get(c.parentId);
    if (!parent) ctx.err(`η γονική κατηγορία ${quote(c.parentId)} δεν υπάρχει στο αντίγραφο.`);
    else if (parent.parentId) ctx.err('η γονική κατηγορία πρέπει να είναι κύρια κατηγορία.');
  }
  if (c.sort !== undefined && !(typeof c.sort === 'number' && Number.isFinite(c.sort))) ctx.err('το πεδίο «sort» πρέπει να είναι αριθμός.');
}

function validateProduct(p, ctx) {
  const variants = (ctx.variantsByProduct.get(p.id) || []).filter((v) => !v.archived);
  const r = validateProductInput({ ...p, variants }, { existingProducts: ctx.stores.products, categories: ctx.stores.categories, editingId: p.id });
  for (const [field, msg] of Object.entries(r.errors)) {
    if (field.startsWith('variants[')) continue; // variant fields are checked per record in the variants store
    ctx.err(msg);
  }
  if (!['active', 'archived'].includes(p.status)) ctx.err('μη έγκυρη κατάσταση προϊόντος (active ή archived).');
  if (p.flags !== undefined) {
    if (!isObj(p.flags)) ctx.err('το πεδίο «flags» πρέπει να είναι αντικείμενο.');
    else for (const f of ['featured', 'new', 'bestSeller']) if (p.flags[f] !== undefined && !isBool(p.flags[f])) ctx.err(`το πεδίο «flags.${f}» πρέπει να είναι true ή false.`);
  }
  if (!Array.isArray(p.images)) ctx.err('το πεδίο «images» πρέπει να είναι λίστα.');
  else if (p.images.some((s) => !isStr(s))) ctx.err('κάθε εικόνα πρέπει να είναι διαδρομή κειμένου.');
  if (p.popularity !== undefined && !(typeof p.popularity === 'number' && Number.isFinite(p.popularity))) ctx.err('το πεδίο «popularity» πρέπει να είναι αριθμός.');
  if (p.attributes !== undefined && !isObj(p.attributes)) ctx.err('το πεδίο «attributes» πρέπει να είναι αντικείμενο.');
  for (const f of ['name', 'brand', 'description', 'slug', 'categoryId', 'subcategoryId']) if (p[f] !== undefined && !isStr(p[f])) ctx.err(`το πεδίο «${f}» πρέπει να είναι κείμενο.`);
  checkDate(ctx, p, 'createdAt');
  checkDate(ctx, p, 'updatedAt', { required: false });
}

const comboKey = (v) => `${String(v.size).trim().toUpperCase()}|${normalizeText(v.color)}`;

function validateVariant(v, ctx) {
  if (!SKU_RE.test(v.sku)) ctx.err('το SKU επιτρέπει γράμματα, αριθμούς, τελείες και παύλες (έως 40 χαρακτήρες).');
  if (!isStr(v.productId) || !ctx.byId.products.has(v.productId)) ctx.err(`αναφέρεται σε προϊόν ${quote(v.productId)} που δεν υπάρχει στο αντίγραφο.`);
  if (!isStr(v.size) || !v.size.trim()) ctx.err('λείπει το μέγεθος.');
  if (!isStr(v.color) || !v.color.trim()) ctx.err('λείπει το χρώμα.');
  if (!isValidHex(v.colorHex)) ctx.err('μη έγκυρο χρώμα (μορφή #rrggbb).');
  if (!isIntIn(v.stock, 0, MAX_STOCK)) ctx.err('το stock πρέπει να είναι ακέραιος αριθμός ≥ 0.');
  optionalBool(ctx, v, 'archived');
  if (!v.archived && isStr(v.size) && isStr(v.color) && isStr(v.productId)) {
    const k = `${v.productId}|${comboKey(v)}`;
    if (ctx.combos.has(k)) ctx.err('ο συνδυασμός μεγέθους και χρώματος υπάρχει ήδη σε άλλη ενεργή παραλλαγή του προϊόντος.');
    ctx.combos.add(k);
  }
}

function validateCart(c, ctx) {
  if (!Array.isArray(c.lines)) { ctx.err('το πεδίο «lines» πρέπει να είναι λίστα.'); return; }
  if (c.lines.length > 500) ctx.err('το καλάθι έχει υπερβολικά πολλές γραμμές.');
  c.lines.forEach((l, i) => {
    const n = i + 1;
    if (!isObj(l) || !isStr(l.sku) || !l.sku) { ctx.err(`η γραμμή ${n} δεν έχει έγκυρο SKU.`); return; }
    if (!isIntIn(l.qty, 1, MAX_LINE_QTY)) ctx.err(`η ποσότητα της γραμμής ${n} (${l.sku}) πρέπει να είναι θετικός ακέραιος έως ${fmtInt(MAX_LINE_QTY)}.`);
    if (!ctx.byId.variants.has(l.sku)) ctx.warn(`η γραμμή ${n} αναφέρεται στο SKU ${quote(l.sku)} που δεν υπάρχει· το καλάθι θα τη σημειώσει ως μη διαθέσιμη.`);
  });
  if (c.couponCode !== undefined && c.couponCode !== null && !isStr(c.couponCode)) ctx.err('μη έγκυρος κωδικός κουπονιού.');
}

function validateWishlist(w, ctx) {
  if (!Array.isArray(w.productIds)) { ctx.err('το πεδίο «productIds» πρέπει να είναι λίστα.'); return; }
  if (w.productIds.length > 2000) ctx.err('υπερβολικά πολλά αγαπημένα προϊόντα.');
  for (const id of w.productIds) {
    if (!isStr(id) || !ctx.byId.products.has(id)) ctx.err(`αναφέρεται σε προϊόν ${quote(id)} που δεν υπάρχει στο αντίγραφο.`);
  }
}

function validateCustomer(c, ctx) {
  const email = normalizeEmail(c.email);
  if (!isStr(c.email) || !email || email.length > 254 || !EMAIL_RE.test(email)) ctx.err('μη έγκυρο email πελάτη.');
  else if (ctx.emails.has(email)) ctx.err(`το email ${quote(email)} χρησιμοποιείται ήδη από άλλον πελάτη (${quote(ctx.emails.get(email))}) — χωρίς διάκριση κεφαλαίων/πεζών.`);
  else ctx.emails.set(email, c.id);
  for (const f of ['firstName', 'lastName', 'phone', 'company']) optionalStr(ctx, c, f, 200);
  if (c.vatNumber !== undefined && c.vatNumber !== null && c.vatNumber !== '') {
    if (!isStr(c.vatNumber) || !isValidAfm(normalizeAfm(c.vatNumber))) ctx.err('μη έγκυρο ΑΦΜ.');
  }
  if (c.savedAddresses !== undefined) {
    if (!Array.isArray(c.savedAddresses)) ctx.err('το πεδίο «savedAddresses» πρέπει να είναι λίστα.');
    else {
      if (c.savedAddresses.length > MAX_ADDRESSES) ctx.err(`έως ${MAX_ADDRESSES} αποθηκευμένες διευθύνσεις ανά πελάτη.`);
      if (c.savedAddresses.some((a) => !isObj(a))) ctx.err('κάθε αποθηκευμένη διεύθυνση πρέπει να είναι αντικείμενο.');
    }
  }
  for (const f of ['orderCount', 'totalCents']) if (c[f] !== undefined && !isCents(c[f])) ctx.err(`το πεδίο «${f}» πρέπει να είναι ακέραιος ≥ 0.`);
  for (const f of ['newsletter', 'rememberDetails', 'sample']) optionalBool(ctx, c, f);
  for (const f of ['createdAt', 'updatedAt', 'lastOrderAt']) checkDate(ctx, c, f, { required: false });
}

function validateOrder(o, ctx) {
  if (!ORDER_ID_RE.test(o.id)) ctx.err('μη έγκυρος κωδικός παραγγελίας (μορφή ELAN-ΕΕΕΕΜΜΗΗ-XXXX).');
  checkDate(ctx, o, 'createdAt');
  if (validDate(o.createdAt) && time(o.createdAt) > ctx.now.getTime() + FUTURE_TOLERANCE_MS) ctx.err('η ημερομηνία δημιουργίας είναι στο μέλλον.');
  if (!ORDER_STATUSES.includes(o.fulfillmentStatus)) ctx.err(`μη έγκυρη κατάσταση εκτέλεσης ${quote(o.fulfillmentStatus)}.`);
  if (!PAYMENT_STATUSES.includes(o.paymentStatus)) ctx.err(`μη έγκυρη κατάσταση πληρωμής ${quote(o.paymentStatus)}.`);
  if (!isObj(o.payment) || !PAYMENT_METHODS.includes(o.payment.method)) ctx.err('μη έγκυρος τρόπος πληρωμής (cod ή iris).');
  else if (o.payment.status !== undefined && !PAYMENT_STATUSES.includes(o.payment.status)) ctx.err('μη έγκυρη κατάσταση πληρωμής στο πεδίο «payment.status».');
  if (!isObj(o.shipping) || !SHIPPING_METHODS.includes(o.shipping.method)) ctx.err('μη έγκυρος τρόπος αποστολής (courier ή pickup).');
  else if (o.shipping.costCents !== undefined && !isCents(o.shipping.costCents)) ctx.err('τα έξοδα αποστολής πρέπει να είναι ακέραιο ποσό ≥ 0.');
  if (o.shippingAddress !== null && !isObj(o.shippingAddress)) ctx.err('η διεύθυνση αποστολής πρέπει να είναι αντικείμενο ή null.');
  if (!isObj(o.customer)) ctx.err('λείπουν τα στοιχεία πελάτη της παραγγελίας.');
  if (!isBool(o.restocked)) ctx.err('το πεδίο «restocked» πρέπει να είναι true ή false.');
  for (const f of ['sample', 'demo']) optionalBool(ctx, o, f);
  for (const f of ['notes', 'requestId']) optionalStr(ctx, o, f);
  if (o.customerId !== undefined && o.customerId !== null) {
    if (!isStr(o.customerId)) ctx.err('μη έγκυρο αναγνωριστικό πελάτη.');
    else if (!ctx.byId.customers.has(o.customerId)) ctx.warn(`ο πελάτης ${quote(o.customerId)} δεν υπάρχει στο αντίγραφο· η παραγγελία εισάγεται ως έχει (στιγμιότυπο).`);
  }
  if (o.couponCode !== undefined && o.couponCode !== null) {
    if (!isStr(o.couponCode)) ctx.err('μη έγκυρος κωδικός κουπονιού.');
    else if (!ctx.byId.coupons.has(o.couponCode)) ctx.warn(`το κουπόνι ${quote(o.couponCode)} δεν υπάρχει στο αντίγραφο.`);
  }

  if (!Array.isArray(o.history)) ctx.err('το ιστορικό πρέπει να είναι λίστα.');
  else if (o.history.some((h) => !isObj(h) || !validDate(h.at) || !isStr(h.type) || !isStr(h.detail))) ctx.err('μη έγκυρη εγγραφή στο ιστορικό (απαιτούνται at, type, detail).');
  if (o.internalNotes !== undefined) {
    if (!Array.isArray(o.internalNotes) || o.internalNotes.some((n) => !isObj(n) || !isStr(n.text) || !validDate(n.at))) ctx.err('μη έγκυρες εσωτερικές σημειώσεις (λίστα με at και text).');
  }

  if (!Array.isArray(o.lines) || !o.lines.length) { ctx.err('η παραγγελία πρέπει να έχει τουλάχιστον μία γραμμή.'); return; }
  let sum = 0;
  let linesOk = true;
  o.lines.forEach((l, i) => {
    const n = i + 1;
    if (!isObj(l)) { ctx.err(`η γραμμή ${n} πρέπει να είναι αντικείμενο.`); linesOk = false; return; }
    if (!isStr(l.sku) || !l.sku) ctx.err(`η γραμμή ${n} δεν έχει SKU.`);
    if (!isStr(l.name)) ctx.err(`η γραμμή ${n} δεν έχει όνομα προϊόντος.`);
    if (!isIntIn(l.qty, 1, MAX_LINE_QTY)) { ctx.err(`η ποσότητα της γραμμής ${n} πρέπει να είναι θετικός ακέραιος έως ${fmtInt(MAX_LINE_QTY)}.`); linesOk = false; }
    if (!isCents(l.unitCents)) { ctx.err(`η τιμή μονάδας της γραμμής ${n} πρέπει να είναι ακέραιο ποσό ≥ 0.`); linesOk = false; }
    if (!isCents(l.lineTotalCents)) { ctx.err(`το σύνολο γραμμής ${n} πρέπει να είναι ακέραιο ποσό ≥ 0.`); linesOk = false; }
    else if (linesOk && l.lineTotalCents !== l.qty * l.unitCents) { ctx.err(`το σύνολο γραμμής ${n} δεν ισούται με ποσότητα × τιμή μονάδας.`); linesOk = false; }
    if (l.compareAtCents !== undefined && l.compareAtCents !== null && !isCents(l.compareAtCents)) ctx.err(`η αρχική τιμή της γραμμής ${n} πρέπει να είναι ακέραιο ποσό ≥ 0.`);
    if (l.image !== undefined && l.image !== null && l.image !== '') {
      const e = isStr(l.image) ? imageSourceError(l.image) : 'Μη έγκυρη διεύθυνση εικόνας.';
      if (e) ctx.err(`γραμμή ${n}: ${e}`);
    }
    if (isCents(l.lineTotalCents)) sum += l.lineTotalCents;
  });

  const t = o.totals;
  if (!isObj(t)) { ctx.err('λείπουν τα σύνολα της παραγγελίας.'); return; }
  const fields = ['subtotalCents', 'discountCents', 'shippingCents', 'codFeeCents', 'totalCents'];
  const bad = fields.filter((f) => !isCents(t[f]));
  if (t.vatIncludedCents !== undefined && !isCents(t.vatIncludedCents)) bad.push('vatIncludedCents');
  if (bad.length) { ctx.err(`τα σύνολα (${bad.join(', ')}) πρέπει να είναι ακέραιο ποσό ≥ 0.`); return; }
  if (linesOk && t.subtotalCents !== sum) ctx.err('το υποσύνολο δεν ισούται με το άθροισμα των γραμμών.');
  if (t.discountCents > t.subtotalCents) ctx.err('η έκπτωση ξεπερνά το υποσύνολο.');
  if (t.totalCents !== Math.max(0, t.subtotalCents - t.discountCents + t.shippingCents + t.codFeeCents)) {
    ctx.err('το τελικό σύνολο δεν ισούται με υποσύνολο − έκπτωση + αποστολή + αντικαταβολή.');
  }
}

function validateCoupon(c, ctx) {
  if (!isStr(c.code) || !COUPON_CODE_RE.test(c.code)) ctx.err('ο κωδικός πρέπει να έχει 3–20 κεφαλαία λατινικά γράμματα, αριθμούς, παύλα ή κάτω παύλα.');
  if (!isIntIn(c.usedCount, 0, 1e9)) { ctx.err('το πεδίο «usedCount» πρέπει να είναι ακέραιος ≥ 0.'); return; }
  if (!COUPON_TYPES.includes(c.type)) { ctx.err('Επιλέξτε τύπο έκπτωσης (percent ή fixed).'); return; }
  if (!Number.isSafeInteger(c.value)) { ctx.err(c.type === 'percent' ? 'Το ποσοστό πρέπει να είναι ακέραιος αριθμός από 1 έως 100.' : 'Συμπληρώστε ποσό μεγαλύτερο από 0 (ακέραια λεπτά).'); return; }
  if (!isCents(c.minSubtotalCents ?? 0)) ctx.err('η ελάχιστη αξία πρέπει να είναι ακέραιο ποσό ≥ 0.');
  if (c.maxUses !== null && c.maxUses !== undefined && !isIntIn(c.maxUses, 1, 1e9)) ctx.err('Το όριο χρήσεων πρέπει να είναι ακέραιος αριθμός από 1.');
  if (c.expiresAt !== null && c.expiresAt !== undefined && !validDate(c.expiresAt)) { ctx.err('μη έγκυρη ημερομηνία λήξης.'); return; }
  if (!isBool(c.active)) { ctx.err('Μη έγκυρη κατάσταση (active: true ή false).'); return; }
  // Same rules as the admin form, in "editing" mode so an already expired coupon keeps its own date.
  const r = validateCouponInput({
    code: c.code,
    type: c.type,
    value: c.type === 'percent' ? String(c.value) : centsToEuros(c.value),
    minSubtotal: centsToEuros(c.minSubtotalCents ?? 0),
    expiresAt: c.expiresAt ?? null,
    maxUses: c.maxUses ?? '',
    active: c.active,
  }, { editingCode: c.code, usedCount: c.usedCount, currentExpiresAt: c.expiresAt ?? null, now: ctx.now });
  for (const msg of Object.values(r.errors)) ctx.err(msg);
}

function validateReviewRecord(r, ctx) {
  if (!isStr(r.productId) || !ctx.byId.products.has(r.productId)) ctx.err(`αναφέρεται σε προϊόν ${quote(r.productId)} που δεν υπάρχει στο αντίγραφο.`);
  if (!isIntIn(r.rating, 1, 5)) ctx.err('η βαθμολογία πρέπει να είναι ακέραιος από 1 έως 5.');
  for (const f of ['title', 'body', 'author']) if (!isStr(r[f])) ctx.err(`το πεδίο «${f}» πρέπει να είναι κείμενο.`);
  checkDate(ctx, r, 'createdAt');
}

const SETTINGS_LABELS = {
  storeName: 'επωνυμία', contactEmail: 'email επικοινωνίας', contactPhone: 'τηλέφωνο', contactAddress: 'διεύθυνση', vatNumber: 'ΑΦΜ',
  openingHours: 'ωράριο', logoText: 'κείμενο λογοτύπου', logoSubtext: 'υπότιτλος λογοτύπου', logoImage: 'εικόνα λογοτύπου', logoAlt: 'εναλλακτικό κείμενο λογοτύπου',
  vatPercent: 'ΦΠΑ', courier: 'έξοδα courier', freeShippingThreshold: 'όριο δωρεάν αποστολής', pickupNote: 'σημείωση παραλαβής', codFee: 'επιβάρυνση αντικαταβολής',
};

function validateStoreSettings(s, ctx) {
  // The IRIS honesty guard first, with its own explicit message: the whole backup is refused.
  const iris = irisInstructionsError(isStr(s.irisInstructions) ? s.irisInstructions : '');
  if (!isStr(s.irisInstructions) || iris) {
    ctx.err(`οι οδηγίες IRIS απορρίφθηκαν — ${iris || 'λείπει το κείμενο.'} Το αντίγραφο δεν εισάγεται, ώστε το demo να μη δηλώνει ψευδώς πραγματική πληρωμή.`);
  }
  if (!(typeof s.vatRate === 'number' && s.vatRate >= 0 && s.vatRate <= 1)) ctx.err('ΦΠΑ: ο συντελεστής πρέπει να είναι αριθμός από 0 έως 1 (π.χ. 0.24).');
  for (const f of ['courierCents', 'freeShippingThresholdCents', 'codFeeCents']) if (!isCents(s[f])) ctx.err(`το ποσό «${f}» πρέπει να είναι ακέραιο ποσό ≥ 0.`);
  if (s.contact !== undefined && !isObj(s.contact)) ctx.err('το πεδίο «contact» πρέπει να είναι αντικείμενο.');
  if (s.social !== undefined && !isObj(s.social)) ctx.err('το πεδίο «social» πρέπει να είναι αντικείμενο.');
  if (s.logo !== undefined && s.logo !== null && !isObj(s.logo)) ctx.err('το πεδίο «logo» πρέπει να είναι αντικείμενο ή null.');
  for (const f of ['storeName', 'pickupNote', 'currency']) optionalStr(ctx, s, f, 1000);
  if (s.pricesIncludeVat !== undefined && s.pricesIncludeVat !== true) ctx.err('το demo υποστηρίζει μόνο τιμές με ΦΠΑ (pricesIncludeVat: true).');
  if (s.currency !== undefined && s.currency !== 'EUR') ctx.err('το demo υποστηρίζει μόνο νόμισμα EUR.');
  // Same validation as the settings form (round trip through its form representation).
  const r = validateSettingsInput(settingsToForm(s));
  for (const [field, msg] of Object.entries(r.errors)) {
    if (field === 'irisInstructions') continue; // reported above
    ctx.err(`${SETTINGS_LABELS[field] || field}: ${msg}`);
  }
}

function validateSettingsRecord(s, ctx) {
  if (s.key === 'store') validateStoreSettings(s, ctx);
  else if (s.key === 'seeded') {
    if (!validDate(s.seededAt)) ctx.err('μη έγκυρη τιμή «seededAt».');
  } else if (s.key === NEWSLETTER_KEY) {
    if (!Array.isArray(s.list)) { ctx.err('η λίστα εγγραφών newsletter πρέπει να είναι λίστα.'); return; }
    const seen = new Set();
    s.list.forEach((x, i) => {
      const v = isObj(x) && isStr(x.email) ? validateNewsletterEmail(x.email) : { ok: false };
      if (!v.ok || v.email !== x.email) ctx.err(`newsletter: μη έγκυρο email στην εγγραφή ${i + 1}.`);
      else if (seen.has(v.email)) ctx.err(`newsletter: διπλό email ${quote(v.email)}.`);
      else seen.add(v.email);
      if (isObj(x) && x.createdAt !== undefined && !validDate(x.createdAt)) ctx.err(`newsletter: μη έγκυρη ημερομηνία στην εγγραφή ${i + 1}.`);
    });
  } else ctx.err(`άγνωστη ρύθμιση ${quote(s.key)}.`);
}

function validateContentRecord(c, ctx) {
  if (c.key === 'editorial') return; // handled by the caller (warning + dropped)
  if (!CONTENT_KEYS.includes(c.key)) { ctx.err(`άγνωστο κλειδί περιεχομένου ${quote(c.key)}.`); return; }
  const { key, ...doc } = c;
  const r = validateContent(key, doc);
  for (const e of r.errors) ctx.err(e);
}

const VALIDATORS = {
  categories: validateCategory, products: validateProduct, variants: validateVariant, carts: validateCart, wishlists: validateWishlist,
  customers: validateCustomer, orders: validateOrder, coupons: validateCoupon, reviews: validateReviewRecord, settings: validateSettingsRecord, content: validateContentRecord,
};

// ------------------------------------------------------------------ validateImport

function capped(list, noun) {
  if (list.length <= MAX_ERRORS) return list;
  return [...list.slice(0, MAX_ERRORS), `…και άλλα ${list.length - MAX_ERRORS} ${noun}`];
}

/**
 * Validate a parsed backup object. Pure; never mutates `obj`.
 * @returns {{ok:boolean, errors:string[], warnings:string[], summary:{counts:Object<string,number>}, normalized?:Object<string,any[]>}}
 *   normalized (only when ok) is a deep copy of the stores, ready to be written (legacy content dropped).
 */
export function validateImport(obj, { now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const done = () => {
    const ok = errors.length === 0;
    return { ok, errors: capped(errors, 'σφάλματα'), warnings: capped(warnings, 'προειδοποιήσεις'), summary: { counts: summaryCounts }, ...(ok ? { normalized } : {}) };
  };
  let summaryCounts = {};
  let normalized;

  if (!isPlain(obj)) {
    errors.push('Το αρχείο δεν είναι αντίγραφο ασφαλείας του ÉLAN Fashion Boutique (δεν περιέχει αντικείμενο JSON).');
    return done();
  }
  // Structure-level safety first: nothing else is looked at in a hostile object.
  const copy = scanAndCopy(obj, (m) => errors.push(m));
  if (errors.length) return done();

  if (copy.format !== BACKUP_FORMAT) {
    errors.push('Μη αναγνωρισμένη μορφή αρχείου: δεν είναι αντίγραφο ασφαλείας του ÉLAN Fashion Boutique (λείπει ή διαφέρει το πεδίο «format»).');
    return done();
  }
  if (!Number.isInteger(copy.schemaVersion)) errors.push('Λείπει ή δεν είναι έγκυρη η έκδοση σχήματος (schemaVersion).');
  else if (copy.schemaVersion > SCHEMA_VERSION) errors.push(`Το αντίγραφο δημιουργήθηκε από νεότερη έκδοση της εφαρμογής (σχήμα v${copy.schemaVersion}· η τρέχουσα είναι v${SCHEMA_VERSION}) και δεν μπορεί να εισαχθεί.`);
  else if (copy.schemaVersion < SCHEMA_VERSION) errors.push(`Το αντίγραφο έχει παλαιότερη έκδοση σχήματος (v${copy.schemaVersion}) για την οποία δεν υπάρχει μετατροπή· η τρέχουσα είναι v${SCHEMA_VERSION}.`);
  if (copy.dbName !== DB_NAME) errors.push(`Το αντίγραφο προέρχεται από άλλη εφαρμογή ή demo (${quote(copy.dbName ?? '—')}) και δεν μπορεί να εισαχθεί εδώ.`);
  if (copy.exportedAt !== undefined && !validDate(copy.exportedAt)) warnings.push('Μη έγκυρη ημερομηνία εξαγωγής (exportedAt).');
  if (errors.length) return done();

  const stores = copy.stores;
  if (!isObj(stores)) {
    errors.push('Λείπει το πεδίο «stores» με τα δεδομένα του αντιγράφου.');
    return done();
  }
  for (const name of Object.keys(stores)) if (!STORE_NAMES.includes(name)) errors.push(`Άγνωστος χώρος δεδομένων ${quote(name)}.`);
  for (const name of STORE_NAMES) {
    const label = `${STORE_LABELS[name]} (${name})`;
    if (!has(stores, name)) errors.push(`Λείπει ο χώρος δεδομένων ${label}.`);
    else if (!Array.isArray(stores[name])) errors.push(`Ο χώρος δεδομένων ${label} πρέπει να είναι λίστα.`);
    else if (stores[name].length > MAX_RECORDS_PER_STORE) errors.push(`Ο χώρος δεδομένων ${label} έχει ${fmtInt(stores[name].length)} εγγραφές· το όριο είναι ${fmtInt(MAX_RECORDS_PER_STORE)}.`);
  }
  if (errors.length) return done();
  summaryCounts = countsOf(stores);

  // Keys: present, string, unique per store. Indexes for the referential checks.
  const byId = {};
  const validRecords = {};
  for (const name of STORE_NAMES) {
    const keyPath = STORE_DEFS[name].keyPath;
    const map = new Map();
    const list = [];
    stores[name].forEach((r, i) => {
      const where = `${STORE_LABELS[name]} (εγγραφή ${i + 1})`;
      if (!isObj(r)) { errors.push(`${where}: πρέπει να είναι αντικείμενο.`); return; }
      const k = r[keyPath];
      if (!isStr(k) || !k || k.length > 200) { errors.push(`${where}: λείπει ή δεν είναι έγκυρο το κλειδί «${keyPath}».`); return; }
      if (map.has(k)) { errors.push(`${STORE_LABELS[name]}: το κλειδί ${quote(k)} εμφανίζεται περισσότερες από μία φορές.`); return; }
      map.set(k, r);
      list.push(r);
    });
    byId[name] = map;
    validRecords[name] = list;
  }

  const variantsByProduct = new Map();
  for (const v of validRecords.variants) {
    if (!variantsByProduct.has(v.productId)) variantsByProduct.set(v.productId, []);
    variantsByProduct.get(v.productId).push(v);
  }
  const ctxBase = { now, stores: validRecords, byId, variantsByProduct, emails: new Map(), combos: new Set() };
  for (const name of STORE_NAMES) {
    const keyPath = STORE_DEFS[name].keyPath;
    for (const rec of validRecords[name]) {
      const prefix = `${STORE_LABELS[name]} ${quote(rec[keyPath])}: `;
      const ctx = { ...ctxBase, err: (m) => errors.push(prefix + m), warn: (m) => warnings.push(prefix + m) };
      VALIDATORS[name](rec, ctx);
    }
  }

  // Required singleton records.
  for (const key of ['store', 'seeded']) if (!byId.settings.has(key)) errors.push(`Ρυθμίσεις: λείπει η εγγραφή ${quote(key)}.`);
  for (const key of CONTENT_KEYS) if (!byId.content.has(key)) errors.push(`Περιεχόμενο: λείπει το έγγραφο ${quote(key)}.`);
  if (byId.content.has('editorial')) warnings.push('Περιεχόμενο «editorial»: παλαιό έγγραφο περιεχομένου που δεν χρησιμοποιείται πλέον· παραλείπεται κατά την εισαγωγή.');

  if (!errors.length) {
    normalized = Object.fromEntries(STORE_NAMES.map((s) => [s, stores[s]]));
    normalized.content = normalized.content.filter((c) => c.key !== 'editorial');
  }
  return done();
}
