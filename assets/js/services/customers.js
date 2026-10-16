// Browser-local demo customers. A new customer gets the id `c-<hash of lowercased email>` (suffixed
// -2, -3… if that id is taken); email is unique by the stored field. There is no account or password. The "active customer" is a UI preference kept in
// localStorage only (which customer's saved details to offer at checkout / show in the account area).
import { tx, reqP, get, getAll } from '../db.js';
import { cleanForm, customerIdFromEmail, normalizePhone, normalizeAfm } from './checkout-rules.js';
import { listOrdersForCustomer } from './orders.js';
import { MAX_ADDRESSES } from './account-rules.js';
import { normalizeEmail, buildCustomerUpdate } from './customer-rules.js';

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

export const ordersForCustomer = listOrdersForCustomer;

// normalizeEmail (trimmed, lower-case: the canonical form for every email comparison) lives in customer-rules.js.
export { normalizeEmail };

/** All local customers, most recently active first. */
export async function listCustomers() {
  const all = await getAll('customers');
  const stamp = (c) => c.lastOrderAt || c.updatedAt || c.createdAt || '';
  return all.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0));
}

/**
 * Email is unique across local customers by the stored `email` FIELD (not by id hash, because a
 * profile edit keeps the id while changing the email). Scans inside the given transaction store.
 */
async function findByEmail(store, email, exceptId = null) {
  const want = normalizeEmail(email);
  const all = await reqP(store.getAll());
  return all.find((c) => c.id !== exceptId && normalizeEmail(c.email) === want) || null;
}

/** An id for a brand-new customer: `c-<hash>`, or `c-<hash>-2`, -3… if that id is held by a record with another email. */
async function freshId(store, email) {
  const base = customerIdFromEmail(email);
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!(await reqP(store.get(id)))) return id;
  }
}

/**
 * Resolve which customer a checkout with this email belongs to (inside transaction `t`):
 * the existing record whose current email matches, else a new, never-colliding id.
 * @returns {Promise<{id:string, existing:object|null}>}
 */
export async function resolveCheckoutCustomer(t, email) {
  const store = t.objectStore('customers');
  const existing = await findByEmail(store, email);
  if (existing) return { id: existing.id, existing };
  return { id: await freshId(store, email), existing: null };
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
  return tx(['customers'], 'readwrite', async (t) => {
    const store = t.objectStore('customers');
    const { id, existing } = await resolveCheckoutCustomer(t, f.email);
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
 * not be held by another local profile (throws { code: 'EMAIL_TAKEN' }). Checkout looks customers
 * up by their current email field, so after A -> B a checkout with B attaches here, while one with
 * A creates a separate customer (with a distinct id if the hash id is still held by this record).
 */
export async function updateProfile(id, form) {
  const email = normalizeEmail(form.email);
  return tx(['customers'], 'readwrite', async (t) => {
    const store = t.objectStore('customers');
    const cur = await reqP(store.get(id));
    if (!cur) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (await findByEmail(store, email, id)) throw Object.assign(new Error('EMAIL_TAKEN'), { code: 'EMAIL_TAKEN' });
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
 * opts: { now (ISO), order: {totalCents} | null, saveDetails: boolean, id (for a new record),
 *        info (object; gets addressSkipped=true when the address list was full) }
 * An existing record keeps its id AND its email (an email is only ever changed by updateProfile).
 */
export function mergeCustomer(existing, form, { now, order = null, saveDetails = false, id: newId = null, info = null } = {}) {
  const f = cleanForm(form);
  const id = existing ? existing.id : (newId || customerIdFromEmail(f.email));
  const base = existing || {
    id, email: f.email, createdAt: now, newsletter: false, savedAddresses: [], orderCount: 0, totalCents: 0,
    lastOrderAt: null, rememberDetails: false,
  };
  const next = {
    ...base,
    id,
    email: base.email,
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
    const i = next.savedAddresses.findIndex((a) => sameAddress(a, fresh));
    if (i >= 0) next.savedAddresses[i] = { ...next.savedAddresses[i], ...fresh }; // re-used: keeps id / label / default flag
    else if (next.savedAddresses.length < MAX_ADDRESSES) next.savedAddresses = [fresh, ...next.savedAddresses];
    else if (info) info.addressSkipped = true; // full: never drop existing addresses or the default
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
  const { t, now = new Date().toISOString(), order = null, saveDetails = false, info = null } = opts;
  const run = async (tr) => {
    const store = tr.objectStore('customers');
    const target = opts.target || (await resolveCheckoutCustomer(tr, cleanForm(form).email));
    const next = mergeCustomer(target.existing, form, { now, order, saveDetails, id: target.id, info });
    await reqP(store.put(next));
    return next;
  };
  return t ? run(t) : tx(['customers'], 'readwrite', run);
}

/**
 * Admin edit of a customer profile (Task 15): validation is the shared account/checkout rule set
 * (customer-rules.buildCustomerUpdate), the email must stay unique across customers by the stored field
 * (case/whitespace-insensitive), and the read-modify-write happens in ONE readwrite transaction. The id,
 * aggregates, addresses and sample flag are never touched. Throws { code: 'invalid', errors } or
 * { code: 'NOT_FOUND' }; dispatches window 'customers:changed' {id}.
 */
export async function updateCustomerAdmin(id, patch) {
  const next = await tx(['customers'], 'readwrite', async (t) => {
    const store = t.objectStore('customers');
    const cur = await reqP(store.get(id));
    if (!cur) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    const r = buildCustomerUpdate(cur, patch);
    if (!r.ok) throw Object.assign(new Error('INVALID'), { code: 'invalid', errors: r.errors });
    if (await findByEmail(store, r.value.email, cur.id)) {
      throw Object.assign(new Error('INVALID'), { code: 'invalid', errors: { email: 'Αυτό το email ανήκει ήδη σε άλλον πελάτη.' } });
    }
    const updated = { ...cur, ...r.value, id: cur.id, updatedAt: new Date().toISOString() };
    await reqP(store.put(updated));
    return updated;
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('customers:changed', { detail: { id } }));
  return next;
}

/** Every customer and every order in one read, for the admin list (stats are computed in customer-rules). */
export async function loadCustomersAndOrders() {
  return tx(['customers', 'orders'], 'readonly', async (t) => {
    const [customers, orders] = await Promise.all([reqP(t.objectStore('customers').getAll()), reqP(t.objectStore('orders').getAll())]);
    return { customers, orders };
  });
}
