// Pure account rules (no DB, no DOM): tracking steps, status labels, profile/address validation and
// the saved-address list operations. Validation reuses checkout-rules.js so both flows agree.
import { validateCheckoutForm, hash36 } from './checkout-rules.js';

export const MAX_ADDRESSES = 10;
export const LABEL_MAX = 30;

export const TRACK_STEPS = [
  { key: 'pending', label: 'Παραλήφθηκε' },
  { key: 'confirmed', label: 'Επιβεβαίωση' },
  { key: 'processing', label: 'Προετοιμασία' },
  { key: 'shipped', label: 'Απεστάλη' },
  { key: 'delivered', label: 'Παραδόθηκε' },
];

const FULFILLMENT_LABELS = {
  pending: 'Παραλήφθηκε', confirmed: 'Επιβεβαιώθηκε', processing: 'Σε προετοιμασία', shipped: 'Απεστάλη',
  delivered: 'Παραδόθηκε', cancelled: 'Ακυρώθηκε', returned: 'Επιστράφηκε',
};
export const fulfillmentLabel = (s) => FULFILLMENT_LABELS[s] || 'Άγνωστη κατάσταση';

// Payment labels never imply a real charge: IRIS is a simulation, COD stays pending until delivery.
const PAYMENT_LABELS = {
  pending: 'Εκκρεμεί πληρωμή',
  'simulated-paid': 'Προσομοίωση: πληρώθηκε',
  refunded: 'Επιστροφή χρημάτων (προσομοίωση)',
  failed: 'Αποτυχία πληρωμής',
  cancelled: 'Ακυρώθηκε η πληρωμή',
};
export const paymentStatusLabel = (s) => PAYMENT_LABELS[s] || 'Άγνωστη κατάσταση πληρωμής';

/**
 * Derive the tracking stepper from a fulfillment status.
 * @returns {{terminal: null|'cancelled'|'returned', currentKey: string|null,
 *   steps: {key:string,label:string,state:'done'|'current'|'upcoming'}[]}}
 */
export function trackingFor(status) {
  if (status === 'cancelled') return { terminal: 'cancelled', currentKey: null, steps: [] };
  const all = (state) => TRACK_STEPS.map((s) => ({ ...s, state }));
  if (status === 'returned') return { terminal: 'returned', currentKey: null, steps: all('done') };
  let idx = TRACK_STEPS.findIndex((s) => s.key === status);
  if (idx < 0) idx = 0;
  if (status === 'delivered') return { terminal: null, currentKey: 'delivered', steps: all('done') };
  return {
    terminal: null,
    currentKey: TRACK_STEPS[idx].key,
    steps: TRACK_STEPS.map((s, i) => ({ ...s, state: i < idx ? 'done' : i === idx ? 'current' : 'upcoming' })),
  };
}

export const orderBelongsTo = (order, customerId) => !!(order && customerId && order.customerId === customerId);

const pick = (errors, keys) => Object.fromEntries(Object.entries(errors).filter(([k]) => keys.includes(k)));
const ADDRESS_KEYS = ['address', 'city', 'postalCode', 'region'];
const PROFILE_KEYS = ['firstName', 'lastName', 'email', 'phone', 'vatNumber'];

/** Address validation = the checkout address rules (postal code 5 digits, region from REGIONS) + optional label. */
export function validateAddress(a) {
  const d = a || {};
  const errors = pick(validateCheckoutForm({ ...d, shippingMethod: 'courier' }).errors, ADDRESS_KEYS);
  if (String(d.label || '').trim().length > LABEL_MAX) errors.label = `Η ονομασία μπορεί να έχει έως ${LABEL_MAX} χαρακτήρες.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Profile validation = the checkout contact rules + AFM check (company is free text). */
export function validateProfile(f) {
  const errors = pick(validateCheckoutForm({ ...(f || {}), shippingMethod: 'pickup' }).errors, PROFILE_KEYS);
  return { ok: Object.keys(errors).length === 0, errors };
}

const newAddressId = () => `a-${Date.now().toString(36)}-${hash36(String(Math.random())).slice(0, 5)}`;

const cleanAddress = (a, id) => ({
  id: a.id || id || newAddressId(),
  label: String(a.label || '').trim(),
  address: String(a.address || '').trim(),
  city: String(a.city || '').trim(),
  postalCode: String(a.postalCode || '').replace(/\s+/g, ''),
  region: String(a.region || '').trim(),
  isDefault: !!a.isDefault,
});

/** Give every address an id and guarantee exactly one default (the first flagged, else the first). */
export function normalizeAddresses(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const out = list.map((a, i) => cleanAddress(a, a.id || `a-legacy-${i}`));
  const first = out.findIndex((a) => a.isDefault);
  return out.map((a, i) => ({ ...a, isDefault: i === (first < 0 ? 0 : first) }));
}

export function pickDefaultAddress(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((a) => a.isDefault) || list[0];
}

export function addAddress(list, addr, { makeDefault = false } = {}) {
  const cur = normalizeAddresses(list);
  if (cur.length >= MAX_ADDRESSES) throw new Error('MAX_ADDRESSES');
  const first = cur.length === 0;
  const next = cleanAddress({ ...addr, id: undefined, isDefault: first || makeDefault });
  const base = next.isDefault ? cur.map((a) => ({ ...a, isDefault: false })) : cur;
  return [...base, next];
}

export function updateAddress(list, id, addr, { makeDefault = false } = {}) {
  const cur = normalizeAddresses(list);
  const out = cur.map((a) => (a.id === id ? cleanAddress({ ...addr, id, isDefault: a.isDefault || makeDefault }) : a));
  return makeDefault ? setDefaultAddress(out, id) : out;
}

export function setDefaultAddress(list, id) {
  const cur = normalizeAddresses(list);
  if (!cur.some((a) => a.id === id)) return cur;
  return cur.map((a) => ({ ...a, isDefault: a.id === id }));
}

export function removeAddress(list, id) {
  return normalizeAddresses(normalizeAddresses(list).filter((a) => a.id !== id));
}
