// Browser-local demo customers. A customer is identified by a hash of the lowercased email
// (`c-<hash>`); there is no account or password. The "active customer" is a UI preference kept in
// localStorage only (which customer's saved details to offer at checkout / show in the account area).
import { tx, reqP, get } from '../db.js';
import { cleanForm, customerIdFromEmail } from './checkout-rules.js';

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
    const addr = { address: f.address, city: f.city, postalCode: f.postalCode, region: f.region };
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
