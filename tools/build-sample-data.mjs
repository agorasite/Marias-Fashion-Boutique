#!/usr/bin/env node
/**
 * Deterministic builder for data/sample-data.json: sample customers and historical orders so the
 * admin dashboard is populated on first launch.
 *
 * Usage: node tools/build-sample-data.mjs            (writes data/sample-data.json)
 *        node tools/build-sample-data.mjs --stdout   (prints the JSON; used by the unit test)
 *
 * Rules (validated by tests/unit/sample-data.test.mjs):
 * - Lines are snapshots of REAL products/variants from data/products.json (same fields as checkout's
 *   snapshotLine); totals come from pricing.quote with the seeded settings and coupons, at createdAt.
 * - Customer ids use the checkout derivation (customerIdFromEmail), so a storefront checkout with a
 *   sample email attaches to that customer. Emails are ASCII-safe @example.gr addresses.
 * - Customer aggregates mirror customers.mergeCustomer (placement-time accounting): orderCount and
 *   totalCents include every order placed, also ones later cancelled/returned; lastOrderAt = newest order.
 * - Status mix ≈ 55% delivered, 12% shipped, 8% processing, 8% confirmed, 7% pending, 6% cancelled,
 *   4% returned; the newest orders are the ones still in progress.
 * - Payment: COD stays 'pending' until delivery; delivered COD orders are 'simulated-paid' with a
 *   history note «Είσπραξη κατά την παράδοση (demo)»; returned COD orders are 'refunded'.
 *   IRIS: 'pending' or 'simulated-paid' while pending, 'simulated-paid' from confirmed on; cancelled →
 *   'pending' (never paid) or 'refunded' (paid, then refunded); returned → 'refunded'.
 * - Cancelled/returned orders have restocked:true. Historical orders do NOT change variant stock: the
 *   stock in products.json is the current stock.
 * - Coupon usage (couponUsage) counts every order that used a coupon (checkout increments at placement).
 * - Every timestamp is <= ANCHOR; the seed shifts all dates by whole days to the install day
 *   (assets/js/services/sample-data.js), so the file itself never needs regenerating for freshness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quote, validateCoupon } from '../assets/js/services/pricing.js';
import { customerIdFromEmail, SHIPPING_LABELS, PAYMENT_LABELS } from '../assets/js/services/checkout-rules.js';
import { fulfillmentLabel } from '../assets/js/services/account-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const { products } = read('data/products.json');
const meta = read('data/catalog-meta.json');
const S = meta.settings;
const coupons = new Map(meta.coupons.map((c) => [c.code, c]));

export const ANCHOR = '2026-10-16T08:00:00.000Z';
const anchorMs = new Date(ANCHOR).getTime();
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ORDER_COUNT = 52;

// mulberry32: small, deterministic PRNG
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261016);
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString();
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------ customers
// [firstName, lastName, email local part, address, city, postalCode, region, orders, extra]
const PEOPLE = [
  ['Ελένη', 'Γεωργίου', 'eleni.georgiou', 'Τσιμισκή 45', 'Θεσσαλονίκη', '54623', 'Κεντρική Μακεδονία', 6, { remember: true, newsletter: [true, true], second: ['Γραφείο', 'Εγνατία 120', 'Θεσσαλονίκη', '54630', 'Κεντρική Μακεδονία'] }],
  ['Κατερίνα', 'Νικολάου', 'katerina.nikolaou', 'Πατησίων 112', 'Αθήνα', '11257', 'Αττική', 5, { remember: true, newsletter: [true, false] }],
  ['Σοφία', 'Αντωνίου', 'sofia.antoniou', 'Κασσαβέτη 18', 'Κηφισιά', '14562', 'Αττική', 5, { remember: true, newsletter: [false, true] }],
  ['Δημήτρης', 'Παπαδάκης', 'dimitris.papadakis', 'Λεωφόρος Ικάρου 23', 'Ηράκλειο', '71306', 'Κρήτη', 4, { remember: true }],
  ['Χριστίνα', 'Μακρή', 'christina.makri', 'Μεταξά 9', 'Γλυφάδα', '16674', 'Αττική', 4, { remember: true, newsletter: [true, true], second: ['Γραφείο', 'Βουλιαγμένης 210', 'Άλιμος', '17456', 'Αττική'] }],
  ['Γιώργος', 'Οικονόμου', 'giorgos.oikonomou', 'Μαιζώνος 76', 'Πάτρα', '26221', 'Δυτική Ελλάδα', 4, {}],
  ['Αναστασία', 'Κωνσταντίνου', 'anastasia.konstantinou', 'Παπαναστασίου 31', 'Λάρισα', '41222', 'Θεσσαλία', 3, { remember: true, newsletter: [true, false] }],
  ['Αλέξανδρος', 'Σταθόπουλος', 'alexandros.stathopoulos', 'Ηρώων Πολυτεχνείου 40', 'Πειραιάς', '18535', 'Αττική', 3, {}],
  ['Ιωάννα', 'Δημητρίου', 'ioanna.dimitriou', 'Ιάσονος 88', 'Βόλος', '38221', 'Θεσσαλία', 3, { newsletter: [true, true] }],
  ['Μαρίνα', 'Καραγιάννη', 'marina.karagianni', 'Χάληδων 27', 'Χανιά', '73132', 'Κρήτη', 3, { remember: true }],
  ['Θεόδωρος', 'Αλεξίου', 'theodoros.alexiou', 'Ομονοίας 102', 'Καβάλα', '65302', 'Ανατολική Μακεδονία και Θράκη', 3, { company: 'Αλεξίου Concept Store', vatNumber: '090000045' }],
  ['Νικόλαος', 'Βλάχος', 'nikolaos.vlachos', 'Δωδώνης 54', 'Ιωάννινα', '45221', 'Ήπειρος', 3, {}],
  ['Βασιλική', 'Λαμπροπούλου', 'vasiliki.lampropoulou', 'Αμμοχώστου 12', 'Ρόδος', '85100', 'Νότιο Αιγαίο', 2, { remember: true, newsletter: [false, true] }],
  ['Παναγιώτης', 'Ζαχαρίου', 'panagiotis.zachariou', 'Αριστομένους 63', 'Καλαμάτα', '24100', 'Πελοπόννησος', 2, {}],
  ['Ευαγγελία', 'Ραφαηλίδου', 'evangelia.rafailidou', 'Ευγενίου Βουλγάρεως 15', 'Κέρκυρα', '49100', 'Ιόνια Νησιά', 2, { newsletter: [true, false] }],
  // Local profiles created in the account area, no purchases yet.
  ['Στέφανος', 'Μιχαηλίδης', 'stefanos.michailidis', 'Δημοκρατίας 7', 'Κοζάνη', '50100', 'Δυτική Μακεδονία', 0, { remember: true, newsletter: [true, true], profileAgeDays: 9 }],
  ['Αγγελική', 'Τσολάκη', 'angeliki.tsolaki', 'Ερμού 140', 'Μυτιλήνη', '81100', 'Βόρειο Αιγαίο', 0, { newsletter: [true, true], profileAgeDays: 3 }],
];
const ATTICA = 'Αττική';

const phone = () => `69${String(int(0, 99999999)).padStart(8, '0')}`;

const people = PEOPLE.map(([firstName, lastName, local, address, city, postalCode, region, orders, x], i) => {
  const email = `${local}@example.gr`;
  const home = { address, city, postalCode, region };
  const n = String(i + 1).padStart(2, '0');
  const saved = x.remember
    ? [{ id: `a-s${n}-1`, label: 'Σπίτι', ...home, isDefault: true },
      ...(x.second ? [{ id: `a-s${n}-2`, label: x.second[0], address: x.second[1], city: x.second[2], postalCode: x.second[3], region: x.second[4], isDefault: false }] : [])]
    : [];
  return {
    i, firstName, lastName, email, phone: phone(), company: x.company || '', vatNumber: x.vatNumber || '', home, saved,
    remember: !!x.remember, newsletter: x.newsletter || null, orders, profileAgeDays: x.profileAgeDays,
  };
});

// ------------------------------------------------------------------ order skeletons
// Ages (days before the anchor), denser recently; the oldest order is ~118 days old.
const ages = [118.3, ...Array.from({ length: ORDER_COUNT - 1 }, () => 0.04 + 116 * rand() ** 1.75)]
  .sort((a, b) => b - a);
// keep a realistic shop day: shift each order to between 08:00 and 23:30 Athens time (UTC+3 → 05:00–20:30 UTC)
const times = [];
for (const age of ages) {
  let t = anchorMs - age * DAY;
  const d = new Date(t);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (h < 5 || h > 20.5) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), int(6, 19), int(0, 59), int(0, 59));
  if (t > anchorMs - 0.5 * HOUR) t = anchorMs - between(0.6, 3) * HOUR;
  times.push(t);
}
times.sort((a, b) => a - b);
for (let i = 1; i < times.length; i += 1) if (times[i] - times[i - 1] < 60000) times[i] = times[i - 1] + int(60, 900) * 1000;

// customer for each order (deterministic shuffle of the per-customer counts)
const slots = shuffle(people.flatMap((p) => Array(p.orders).fill(p.i)));
if (slots.length !== ORDER_COUNT) throw new Error(`order slots ${slots.length} != ${ORDER_COUNT}`);

// statuses by recency: newest are in progress, the rest mostly delivered
const statusByIndex = new Array(ORDER_COUNT);
const newestFirst = Array.from({ length: ORDER_COUNT }, (_, k) => ORDER_COUNT - 1 - k);
const RECENT = [['pending', 4], ['confirmed', 4], ['processing', 4], ['shipped', 6]];
let cursor = 0;
for (const [s, n] of RECENT) for (let k = 0; k < n; k += 1) statusByIndex[newestFirst[cursor++]] = s;
const older = newestFirst.slice(cursor);
older.forEach((idx) => { statusByIndex[idx] = 'delivered'; });
const returnable = shuffle(older.filter((idx) => anchorMs - times[idx] > 18 * DAY));
returnable.slice(0, 2).forEach((idx) => { statusByIndex[idx] = 'returned'; });
shuffle(older.filter((idx) => statusByIndex[idx] === 'delivered')).slice(0, 3).forEach((idx) => { statusByIndex[idx] = 'cancelled'; });

// ------------------------------------------------------------------ lines
const weighted = products.filter((p) => p.status !== 'archived').map((p) => ({ p, w: 10 + (p.popularity || 0) }));
const totalW = weighted.reduce((s, x) => s + x.w, 0);
function pickProduct(exclude) {
  for (;;) {
    let r = rand() * totalW;
    const hit = weighted.find((x) => (r -= x.w) < 0) || weighted[weighted.length - 1];
    if (!exclude.has(hit.p.id)) return hit.p;
  }
}
function snapshot(p, v, qty) {
  return {
    sku: v.sku, productId: p.id, slug: p.slug, name: p.name, brand: p.brand || '', size: v.size ?? null, color: v.color ?? null,
    colorHex: v.colorHex ?? null, image: (p.images && p.images[0]) || null, qty, unitCents: p.priceCents,
    compareAtCents: p.compareAtCents || null, lineTotalCents: p.priceCents * qty, vatRate: S.vatRate,
  };
}

const NOTES = ['Παρακαλώ καλέστε πριν την παράδοση.', 'Είναι δώρο — χωρίς απόδειξη τιμής στη συσκευασία, ευχαριστώ.',
  'Κουδούνι «Γεωργίου», 3ος όροφος.', 'Αν γίνεται, παράδοση μετά τις 17:00.'];
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const usedSuffix = new Set();
function suffix() {
  for (;;) {
    let s = '';
    for (let k = 0; k < 4; k += 1) s += B36[Math.floor(rand() * 36)];
    if (!usedSuffix.has(s)) { usedSuffix.add(s); return s; }
  }
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const statusDetail = (s) => `Η κατάσταση άλλαξε σε «${fulfillmentLabel(s)}».`;
const IRIS_PAID = 'Προσομοίωση πληρωμής IRIS (demo) — δεν πραγματοποιήθηκε πραγματική τραπεζική συναλλαγή.';
const REFUND = 'Επιστροφή χρημάτων (προσομοίωση) — δεν πραγματοποιήθηκε πραγματική τραπεζική συναλλαγή.';
const RESTOCK = 'Το απόθεμα των προϊόντων επανήλθε.';

/** History events after creation, as [offsetMs, type, detail]; compressed to fit before the anchor. */
function timeline(status, pay, ship, irisPaid) {
  const ev = [];
  let t = 0;
  const add = (dt, type, detail) => { t += dt; ev.push([t, type, detail]); };
  if (pay === 'iris' && irisPaid) add(between(4, 40) * 60000, 'payment-simulated', IRIS_PAID);
  if (status === 'pending') return ev;
  if (status === 'cancelled') {
    if (rand() < 0.5) add(between(2, 8) * HOUR, 'status', statusDetail('confirmed'));
    add(between(3, 20) * HOUR, 'status', statusDetail('cancelled'));
    add(60000, 'restock', RESTOCK);
    if (pay === 'iris' && irisPaid) add(between(1, 5) * HOUR, 'payment-refunded', REFUND);
    return ev;
  }
  add(between(1.5, 8) * HOUR, 'status', statusDetail('confirmed'));
  if (status === 'confirmed') return ev;
  add(between(10, 30) * HOUR, 'status', statusDetail('processing'));
  if (status === 'processing') return ev;
  add(between(8, 24) * HOUR, 'status', ship === 'pickup' ? 'Η κατάσταση άλλαξε σε «Απεστάλη» · έτοιμη για παραλαβή από το κατάστημα.' : statusDetail('shipped'));
  if (status === 'shipped') return ev;
  add(between(20, 60) * HOUR, 'status', statusDetail('delivered'));
  if (pay === 'cod') add(60000, 'payment-collected', 'Είσπραξη κατά την παράδοση (demo)');
  if (status === 'delivered') return ev;
  add(between(4, 10) * DAY, 'status', statusDetail('returned'));
  add(60000, 'restock', RESTOCK);
  add(between(1, 24) * HOUR, 'payment-refunded', REFUND);
  return ev;
}

function paymentStatusFor(status, pay, irisPaid) {
  if (status === 'returned') return 'refunded';
  if (pay === 'cod') return status === 'delivered' ? 'simulated-paid' : 'pending';
  if (status === 'cancelled') return irisPaid ? 'refunded' : 'pending';
  return irisPaid ? 'simulated-paid' : 'pending';
}

const pickupAddress = S.contact.address;
const ordersOut = [];
const firstOrderDone = new Set();
const couponUsage = {};

for (let idx = 0; idx < ORDER_COUNT; idx += 1) {
  const person = people[slots[idx]];
  const createdMs = times[idx];
  const createdAt = iso(createdMs);
  const now = new Date(createdAt);
  const status = statusByIndex[idx];

  const nLines = rand() < 0.55 ? 1 : rand() < 0.78 ? 2 : 3;
  const seen = new Set();
  const lines = [];
  for (let k = 0; k < nLines; k += 1) {
    const p = pickProduct(seen);
    seen.add(p.id);
    lines.push(snapshot(p, pickOne(p.variants), rand() < 0.86 ? 1 : 2));
  }
  const sub = lines.reduce((s, l) => s + l.unitCents * l.qty, 0);

  const ship = person.home.region === ATTICA && rand() < 0.35 ? 'pickup' : 'courier';
  const pay = rand() < 0.6 ? 'cod' : 'iris';
  let coupon = null;
  const first = !firstOrderDone.has(person.i);
  if (first && rand() < 0.6 && validateCoupon(coupons.get('WELCOME10'), sub, now).ok) coupon = coupons.get('WELCOME10');
  else if (!first && rand() < 0.22 && validateCoupon(coupons.get('MARIAS5'), sub, now).ok) coupon = coupons.get('MARIAS5');
  firstOrderDone.add(person.i);
  if (coupon) couponUsage[coupon.code] = (couponUsage[coupon.code] || 0) + 1;

  const q = quote({ lines, coupon, shipping: { method: ship }, payment: pay, settings: S, now });
  if (q.couponError) throw new Error(`coupon error ${q.couponError}`);

  const irisPaid = pay === 'iris' && (['confirmed', 'processing', 'shipped', 'delivered', 'returned'].includes(status) || rand() < 0.5);
  const shipLabel = ship === 'pickup' ? `${SHIPPING_LABELS.pickup} (${pickupAddress})` : SHIPPING_LABELS.courier;
  const useSecond = ship === 'courier' && person.saved.length > 1 && rand() < 0.35;
  const addr = useSecond ? person.saved[1] : person.home;

  // fit the timeline before the anchor (10 minutes margin)
  let ev = timeline(status, pay, ship, irisPaid);
  const room = anchorMs - 10 * 60000 - createdMs;
  const last = ev.length ? ev[ev.length - 1][0] : 0;
  if (last > room) ev = ev.map(([o, ty, de]) => [Math.floor((o * room) / last), ty, de]);
  const history = [
    { at: createdAt, type: 'created', detail: `Η παραγγελία καταχωρήθηκε · ${PAYMENT_LABELS[pay]} · ${shipLabel}` },
    ...ev.map(([o, type, detail]) => ({ at: iso(createdMs + o), type, detail })),
  ];
  const paymentStatus = paymentStatusFor(status, pay, irisPaid);
  const paidEv = history.find((h) => h.type === 'payment-simulated');

  ordersOut.push({
    id: `MARIAS-${ymd(createdMs)}-${suffix()}`,
    requestId: `sample-${String(idx + 1).padStart(3, '0')}`,
    customerId: customerIdFromEmail(person.email),
    createdAt,
    customer: {
      firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, company: person.company, vatNumber: person.vatNumber,
    },
    shippingAddress: ship === 'pickup' ? null : { address: addr.address, city: addr.city, postalCode: addr.postalCode, region: addr.region },
    shipping: { method: ship, label: shipLabel, costCents: q.shippingCents, ...(ship === 'pickup' ? { pickupAddress } : {}) },
    payment: { method: pay, label: PAYMENT_LABELS[pay], status: paymentStatus, simulated: true, ...(paidEv ? { simulatedAt: paidEv.at } : {}) },
    fulfillmentStatus: status,
    paymentStatus,
    lines,
    couponCode: coupon ? coupon.code : null,
    totals: {
      subtotalCents: q.subtotalCents, discountCents: q.discountCents, shippingCents: q.shippingCents,
      codFeeCents: q.codFeeCents, totalCents: q.totalCents, vatIncludedCents: q.vatIncludedCents,
    },
    vatRate: S.vatRate,
    notes: rand() < 0.12 ? pickOne(NOTES) : '',
    internalNotes: [],
    history,
    restocked: status === 'cancelled' || status === 'returned',
    demo: true,
    sample: true,
  });
}

// ------------------------------------------------------------------ customer records (mirror mergeCustomer)
const customersOut = people.map((p) => {
  const mine = ordersOut.filter((o) => o.customer.email === p.email);
  const createdAt = mine.length ? mine[0].createdAt : iso(anchorMs - (p.profileAgeDays || 5) * DAY - int(1, 9) * HOUR);
  const updatedAt = mine.length ? mine[mine.length - 1].createdAt : createdAt;
  const nl = p.newsletter;
  return {
    id: customerIdFromEmail(p.email),
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone,
    company: p.company,
    vatNumber: p.vatNumber,
    createdAt,
    updatedAt,
    newsletter: !!nl,
    newsletterTopics: { collections: !!(nl && nl[0]), offers: !!(nl && nl[1]) },
    savedAddresses: p.saved,
    orderCount: mine.length,
    totalCents: mine.reduce((s, o) => s + o.totals.totalCents, 0),
    lastOrderAt: mine.length ? mine[mine.length - 1].createdAt : null,
    rememberDetails: p.remember || p.orders === 0,
    sample: true,
  };
});

const out = {
  version: 1,
  generatedBy: 'tools/build-sample-data.mjs',
  anchor: ANCHOR,
  note: 'Demo sample data (fictional customers, @example.gr emails). Dates are shifted to the install day by the seed.',
  couponUsage: Object.fromEntries(Object.entries(couponUsage).sort()),
  customers: customersOut,
  orders: ordersOut,
};
const json = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes('--stdout')) process.stdout.write(json);
else {
  fs.writeFileSync(path.join(root, 'data/sample-data.json'), json);
  const mix = {};
  ordersOut.forEach((o) => { mix[o.fulfillmentStatus] = (mix[o.fulfillmentStatus] || 0) + 1; });
  console.log(`data/sample-data.json: ${customersOut.length} customers, ${ordersOut.length} orders`, mix, couponUsage);
}
