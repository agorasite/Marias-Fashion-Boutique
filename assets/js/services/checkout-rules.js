// Pure checkout rules (no DB, no DOM): form validation, ids and labels. Importable in Node.
import { PERSON_NAME_MAX, COMPANY_MAX, ADDRESS_MAX, CITY_MAX, EMAIL_MAX } from './limits.js';

/** The 13 Greek administrative regions (περιφέρειες), offered in the checkout select. */
export const REGIONS = [
  'Αττική',
  'Κεντρική Μακεδονία',
  'Ανατολική Μακεδονία και Θράκη',
  'Δυτική Μακεδονία',
  'Ήπειρος',
  'Θεσσαλία',
  'Ιόνια Νησιά',
  'Δυτική Ελλάδα',
  'Στερεά Ελλάδα',
  'Πελοπόννησος',
  'Βόρειο Αιγαίο',
  'Νότιο Αιγαίο',
  'Κρήτη',
];

export const SHIPPING_METHODS = ['courier', 'pickup'];
export const PAYMENT_METHODS = ['cod', 'iris'];
export const SHIPPING_LABELS = { courier: 'Courier στο σπίτι', pickup: 'Παραλαβή από το κατάστημα' };
export const PAYMENT_LABELS = { cod: 'Αντικαταβολή', iris: 'IRIS (προσομοίωση)' };
export const NOTES_MAX = 500;
export const ORDER_ID_RE = /^ELAN-\d{8}-[0-9A-Z]{4}$/;

/** Fields in the order the form shows them (used for the error summary). */
export const FIELD_ORDER = ['firstName', 'lastName', 'email', 'phone', 'shippingMethod', 'address', 'city',
  'postalCode', 'region', 'company', 'vatNumber', 'paymentMethod', 'notes', 'acceptTerms'];

const str = (v) => (v == null ? '' : String(v)).trim();

/** Strip separators and +30/0030 prefix; returns the bare 10-digit candidate. */
export function normalizePhone(v) {
  let s = str(v).replace(/[\s\-.()/]/g, '');
  if (s.startsWith('+30')) s = s.slice(3);
  else if (s.startsWith('0030')) s = s.slice(4);
  return s;
}
export const isValidPhone = (v) => /^(69\d{8}|2\d{9})$/.test(normalizePhone(v));

export const normalizeAfm = (v) => str(v).replace(/^EL/i, '').replace(/[\s.-]/g, '');

/** Greek tax number (ΑΦΜ): 9 digits, check digit = (Σ d_i·2^(9-i) mod 11) mod 10. */
export function isValidAfm(v) {
  const s = String(v ?? '');
  if (!/^\d{9}$/.test(s) || /^0{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(s[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(s[8]);
}

export const normalizePostalCode = (v) => str(v).replace(/\s+/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate the checkout form. Pure. For store pickup only the contact fields are required
 * (address, city, postal code and region are ignored).
 * @returns {{ok:boolean, errors:Object<string,string>}}
 */
export function validateCheckoutForm(data) {
  const d = data || {};
  const errors = {};
  const ship = d.shippingMethod;
  const needsAddress = ship !== 'pickup';

  const name = (field, label) => {
    const v = str(d[field]);
    if (!v) errors[field] = `Συμπληρώστε το ${label}.`;
    else if (v.length < 2) errors[field] = `Το ${label} πρέπει να έχει τουλάχιστον 2 χαρακτήρες.`;
    else if (v.length > PERSON_NAME_MAX) errors[field] = `Το ${label} μπορεί να έχει έως ${PERSON_NAME_MAX} χαρακτήρες.`;
  };
  name('firstName', 'όνομα');
  name('lastName', 'επώνυμο');

  const email = str(d.email);
  if (!email) errors.email = 'Συμπληρώστε το email σας.';
  else if (email.length > EMAIL_MAX) errors.email = `Το email μπορεί να έχει έως ${EMAIL_MAX} χαρακτήρες.`;
  else if (!EMAIL_RE.test(email)) errors.email = 'Το email δεν είναι έγκυρο (π.χ. maria@example.gr).';

  if (!str(d.phone)) errors.phone = 'Συμπληρώστε το τηλέφωνό σας.';
  else if (!isValidPhone(d.phone)) {
    errors.phone = 'Το τηλέφωνο δεν είναι έγκυρο: κινητό 69xxxxxxxx ή σταθερό 2xxxxxxxxx (προαιρετικά με +30).';
  }

  if (!SHIPPING_METHODS.includes(ship)) errors.shippingMethod = 'Επιλέξτε τρόπο παράδοσης.';

  if (needsAddress) {
    const address = str(d.address);
    if (!address) errors.address = 'Συμπληρώστε τη διεύθυνση αποστολής.';
    else if (address.length < 5) errors.address = 'Η διεύθυνση πρέπει να έχει τουλάχιστον 5 χαρακτήρες (οδός και αριθμός).';
    else if (address.length > ADDRESS_MAX) errors.address = `Η διεύθυνση μπορεί να έχει έως ${ADDRESS_MAX} χαρακτήρες.`;
    if (!str(d.city)) errors.city = 'Συμπληρώστε την πόλη.';
    else if (str(d.city).length > CITY_MAX) errors.city = `Η πόλη μπορεί να έχει έως ${CITY_MAX} χαρακτήρες.`;
    const pc = normalizePostalCode(d.postalCode);
    if (!pc) errors.postalCode = 'Συμπληρώστε τον ταχυδρομικό κώδικα.';
    else if (!/^\d{5}$/.test(pc)) errors.postalCode = 'Ο ταχυδρομικός κώδικας πρέπει να έχει 5 ψηφία.';
    if (!str(d.region)) errors.region = 'Επιλέξτε περιφέρεια.';
    else if (!REGIONS.includes(str(d.region))) errors.region = 'Επιλέξτε περιφέρεια από τη λίστα.';
  }

  if (str(d.company).length > COMPANY_MAX) errors.company = `Η επωνυμία εταιρείας μπορεί να έχει έως ${COMPANY_MAX} χαρακτήρες.`;

  const afm = normalizeAfm(d.vatNumber);
  if (afm) {
    if (!/^\d{9}$/.test(afm)) errors.vatNumber = 'Ο ΑΦΜ πρέπει να έχει 9 ψηφία.';
    else if (!isValidAfm(afm)) errors.vatNumber = 'Ο ΑΦΜ δεν είναι έγκυρος (λάθος ψηφίο ελέγχου).';
  }

  if (str(d.notes).length > NOTES_MAX) errors.notes = `Οι σημειώσεις μπορούν να έχουν έως ${NOTES_MAX} χαρακτήρες.`;

  if (!PAYMENT_METHODS.includes(d.paymentMethod)) errors.paymentMethod = 'Επιλέξτε τρόπο πληρωμής.';

  if (d.acceptTerms !== true) errors.acceptTerms = 'Για να συνεχίσετε πρέπει να αποδεχτείτε τους όρους.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Trimmed / normalised copy of the form, as stored on the order and customer. */
export function cleanForm(d = {}) {
  const pickup = d.shippingMethod === 'pickup';
  return {
    firstName: str(d.firstName),
    lastName: str(d.lastName),
    email: str(d.email).toLowerCase(),
    phone: normalizePhone(d.phone),
    company: str(d.company),
    vatNumber: normalizeAfm(d.vatNumber),
    address: pickup ? '' : str(d.address),
    city: pickup ? '' : str(d.city),
    postalCode: pickup ? '' : normalizePostalCode(d.postalCode),
    region: pickup ? '' : str(d.region),
    notes: str(d.notes),
  };
}

/** Deterministic 53-bit string hash (cyrb53), base36. */
export function hash36(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const customerIdFromEmail = (email) => `c-${hash36(str(email).toLowerCase())}`;

const pad = (n) => String(n).padStart(2, '0');
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** ELAN-YYYYMMDD-XXXX using the local calendar date and 4 random base36 characters. */
export function makeOrderId(date = new Date(), rand = Math.random) {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += B36[Math.floor(rand() * 36) % 36];
  return `ELAN-${ymd}-${suffix}`;
}

/** RFC 4122 v4-ish id for idempotency keys. */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });
}
