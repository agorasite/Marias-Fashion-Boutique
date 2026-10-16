// Pure cart rules (no DB, no DOM): shared by services/cart.js and unit tests.
import { LINE_QTY_MAX } from './limits.js';

export const clampQty = (qty, stock) => {
  const n = Math.floor(Number(qty));
  const s = Math.max(0, Math.floor(Number(stock) || 0));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(n, s, LINE_QTY_MAX)); // one line never exceeds LINE_QTY_MAX (orders / restock rely on it)
};

/** Add qty to the line for `sku` (or append). Returns a new array. */
export function mergeLine(lines, sku, qty) {
  const out = lines.map((l) => ({ ...l }));
  const hit = out.find((l) => l.sku === sku);
  if (hit) hit.qty += qty;
  else out.push({ sku, qty });
  return out;
}

/**
 * Swap `oldSku` for `newSku` keeping the line position; if `newSku` already has a line the
 * two merge. The resulting quantity is clipped to `newStock`.
 * Returns { ok, lines, qty, merged, clipped } or { ok:false, reason }.
 */
export function changeVariantLines(lines, oldSku, newSku, newStock) {
  const idx = lines.findIndex((l) => l.sku === oldSku);
  if (idx < 0) return { ok: false, reason: 'not-in-cart' };
  if (!(newStock > 0)) return { ok: false, reason: 'out-of-stock' };
  const existing = lines.find((l) => l.sku === newSku && l.sku !== oldSku);
  const wanted = lines[idx].qty + (existing ? existing.qty : 0);
  const qty = clampQty(wanted, newStock);
  const out = [];
  lines.forEach((l, i) => {
    if (i === idx) out.push({ ...l, sku: newSku, qty });
    else if (existing && l.sku === newSku) return;
    else out.push({ ...l });
  });
  // Keep the earliest of the two positions when merging.
  return { ok: true, lines: out, qty, merged: !!existing, clipped: qty < wanted };
}

/** { available, problem } for a cart line given its variant and product records. */
export function classifyLine({ qty, variant, product }) {
  if (!variant || !product) return { available: 0, problem: 'unknown' };
  if ((product.status && product.status !== 'active') || variant.archived) return { available: 0, problem: 'archived' };
  const stock = Math.max(0, Number(variant.stock) || 0);
  if (stock <= 0) return { available: 0, problem: 'out-of-stock' };
  if (qty > stock) return { available: stock, problem: 'insufficient' };
  return { available: stock, problem: undefined };
}

export function couponMessage(reason, coupon, formatMoney) {
  switch (reason) {
    case 'empty': return 'Εισάγετε έναν κωδικό κουπονιού.';
    case 'not-found': return 'Ο κωδικός δεν βρέθηκε';
    case 'inactive': return 'Ο κωδικός δεν είναι ενεργός.';
    case 'expired': return 'Ο κωδικός έχει λήξει';
    case 'min-spend': return `Ελάχιστη αξία παραγγελίας ${formatMoney((coupon && coupon.minSubtotalCents) || 0)} για αυτόν τον κωδικό.`;
    case 'max-uses': return 'Ο κωδικός έχει εξαντλήσει τις διαθέσιμες χρήσεις του.';
    default: return 'Ο κωδικός δεν μπορεί να εφαρμοστεί.';
  }
}

/** Lines in these states cannot be bought and are left out of the quote. */
export const isPriced = (problem) => !(problem === 'out-of-stock' || problem === 'archived' || problem === 'unknown');

/** Cart lines (with unitCents/qty/problem) -> the lines handed to pricing.quote. */
export function pricedLines(lines) {
  return lines.filter((l) => isPriced(l.problem)).map((l) => ({ sku: l.sku, unitCents: l.unitCents, qty: l.qty }));
}

/** Progress derived from the quote's own freeShippingRemainingCents (no recomputation of the discount). */
export function freeShippingProgress(remainingCents, thresholdCents) {
  const t = Math.max(0, thresholdCents || 0);
  const rem = Math.max(0, remainingCents || 0);
  if (t === 0 || rem === 0) return { pct: 100, remainingCents: 0, free: true };
  return { pct: Math.max(0, Math.min(100, Math.floor(((t - rem) / t) * 100))), remainingCents: rem, free: false };
}
