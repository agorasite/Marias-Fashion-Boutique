// Browser-local demo customers. A customer is identified by a hash of the lowercased email
// (`c-<hash>`); there is no account or password. The "active customer" is a UI preference kept in
// localStorage only (which customer's saved details to offer at checkout / show in the account area).
import { tx, reqP, get, getAll } from '../db.js';
import { cleanForm, customerIdFromEmail, normalizePhone, normalizeAfm } from './checkout-rules.js';
import { listOrdersForCustomer } from './orders.js';

const ACTIVE_KEY = 'elan.activeCustomerId';

export function getActiveCustomerId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch (e) { return null; }
}

export function setActiveCustomerId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (e) { /* storage blocked: preference is optional */ }
}

export async function getCustomer(id) {
  if (!id) return null;
  return (await get('customers', id)) || null;
}

export async function getActiveCustomer() {
  return getCustomer(getActiveCustomerId());
}

export const setActiveCustomer = setActiveCustomerId;
export const ordersForCustomer = listOrdersForCustomer;

/** All local customers, most recently active first. */
export async function listCustomers() {
  const all = await getAll('customers');
  const stamp = (c) => c.lastOrderAt || c.updatedAt || c.createdAt || '';
  return all.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0));
}

/** Plain write of a customer record (stamps updatedAt). */
export async function saveCustomer(c) {
  const next = { ...c, updatedAt: new Date().toISOString() };
  await tx(['customers'], 'readwrite', (t) => reqP(t.objectStore('customers').put(next)));
  return next;
}

/** Read-modify-write in one transaction so a concurrent order never loses its counters. */
export async function updateCustomer(id, mutate) {
  return tx(['customers'], 'readwrite', async (t) => {
    const store = t.objectStore('customers');
    const cur = await reqP(store.get(id));
    if (!cur) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    const next = { ...(await mutate({ ...cur })), id: cur.id, updatedAt: new Date().toISOString() };
    await reqP(store.put(next));
    return next;
  });
}

/**
 * Create a profile from the account area. The id is derived exactly like a checkout does
 * (`c-<hash of lowercased email>`), so a later checkout with the same email attaches to it.
 * Returns { customer, existed }; an existing profile with that email is left untouched.
 */
export async function createLocalProfile(form, { now = new Date().toISOString() } = {}) {
  const f = cleanForm({ ...form, shippingMethod: 'pickup' });
  const id = customerIdFromEmail(f.email);
  return tx(['customers'], 'readwrite', async (t) => {
    const store = t.objectStore('customers');
    const existing = await reqP(store.get(id));
    if (existing) return { customer: existing, existed: true };
    const customer = {
      id, email: f.email, firstName: f.firstName, lastName: f.lastName, phone: f.phone, company: f.company,
      vatNumber: f.vatNumber, createdAt: now, updatedAt: now, newsletter: false,
      newsletterTopics: { collections: false, offers: false }, savedAddresses: [], orderCount: 0, totalCents: 0,
      lastOrderAt: null, rememberDetails: true,
    };
    await reqP(store.put(customer));
    return { customer, existed: false };
  });
}

/**
 * Update the profile fields. Email policy: the customer id is stable (it never changes and orders
 * stay attached); only the `email` field changes, and nothing else is re-derived. The new email may
 * not belong to another local profile (throws { code: 'EMAIL_TAKEN' }). Consequence: checkout
 * identifies customers by email hash, so a checkout with the NEW email creates a separate profile,
 * while one with the ORIGINAL email still reaches this profile.
 */
export async function updateProfile(id, form) {
  const email = String(form.email || '').trim().toLowerCase();
  const otherId = customerIdFromEmail(email);
  return tx(['customers'], 'readwrite', async (t) => {
    const store = t.objectStore('customers');
    const cur = await reqP(store.get(id));
    if (!cur) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (otherId !== id && (await reqP(store.get(otherId)))) throw Object.assign(new Error('EMAIL_TAKEN'), { code: 'EMAIL_TAKEN' });
    const next = {
      ...cur, email,
      firstName: String(form.firstName || '').trim(),
      lastName: String(form.lastName || '').trim(),
      phone: normalizePhone(form.phone),
      company: String(form.company || '').trim(),
      vatNumber: normalizeAfm(form.vatNumber),
      rememberDetails: true,
      updatedAt: new Date().toISOString(),
    };
    await reqP(store.put(next));
    return next;
  });
}

const sameAddress = (a, b) => ['address', 'city', 'postalCode', 'region']
  .every((k) => String(a[k] || '').toLowerCase() === String(b[k] || '').toLowerCase());

/**
 * Pure merge of checkout data into a customer record.
 * opts: { now (ISO), order: {totalCents} | null, saveDetails: boolean }
 */
export function mergeCustomer(existing, form, { now, order = null, saveDetails = false } = {}) {
  const f = cleanForm(form);
  const id = customerIdFromEmail(f.email);
  const base = existing || {
    id, email: f.email, createdAt: now, newsletter: false, savedAddresses: [], orderCount: 0, totalCents: 0,
    lastOrderAt: null, rememberDetails: false,
  };
  const next = {
    ...base,
    id,
    email: f.email,
    firstName: f.firstName,
    lastName: f.lastName,
    phone: f.phone,
    company: f.company,
    vatNumber: f.vatNumber,
    savedAddresses: Array.isArray(base.savedAddresses) ? base.savedAddresses.map((a) => ({ ...a })) : [],
    rememberDetails: !!saveDetails,
    updatedAt: now,
  };
  if (saveDetails && f.address) {
    const fresh = { address: f.address, city: f.city, postalCode: f.postalCode, region: f.region };
    const dup = next.savedAddresses.find((a) => sameAddress(a, fresh));
    const addr = dup ? { ...dup, ...fresh } : fresh; // a re-used address keeps its id / label / default flag
    next.savedAddresses = [addr, ...next.savedAddresses.filter((a) => !sameAddress(a, addr))].slice(0, 5);
  }
  if (order) {
    next.orderCount = (Number(base.orderCount) || 0) + 1;
    next.totalCents = (Number(base.totalCents) || 0) + (Number(order.totalCents) || 0);
    next.lastOrderAt = now;
  }
  return next;
}

/**
 * Upsert the customer for a checkout form. When `opts.t` (a readwrite transaction including
 * `customers`) is given, it runs inside it — this is how placeOrder maintains orderCount/totalCents
 * atomically with the order. Without `t` it opens its own transaction.
 */
export async function upsertCustomerFromCheckout(form, opts = {}) {
  const { t, now = new Date().toISOString(), order = null, saveDetails = false } = opts;
  const run = async (tr) => {
    const store = tr.objectStore('customers');
    const id = customerIdFromEmail(cleanForm(form).email);
    const existing = (await reqP(store.get(id))) || null;
    const next = mergeCustomer(existing, form, { now, order, saveDetails });
    await reqP(store.put(next));
    return next;
  };
  return t ? run(t) : tx(['customers'], 'readwrite', run);
}
