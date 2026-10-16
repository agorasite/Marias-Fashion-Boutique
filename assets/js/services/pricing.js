// Pure pricing / quote service. Money is integer cents; prices are VAT-inclusive.

const fmt = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });

export function formatMoney(cents) {
  return fmt.format(cents / 100);
}

export function validateCoupon(coupon, subtotalCents, now = new Date()) {
  if (!coupon || !coupon.active) return { ok: false, reason: 'inactive' };
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (subtotalCents < (coupon.minSubtotalCents || 0)) return { ok: false, reason: 'min-spend' };
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return { ok: false, reason: 'max-uses' };
  }
  return { ok: true };
}

/** Sum of unitCents * qty. The single subtotal definition used by quote and the cart. */
export const subtotalCents = (lines) => lines.reduce((s, l) => s + l.unitCents * l.qty, 0);

export function quote({ lines, coupon = null, shipping, payment, settings, now = new Date() }) {
  const { vatRate, courierCents, freeShippingThresholdCents, codFeeCents } = settings;
  const sub = subtotalCents(lines);

  let discountCents = 0;
  let couponError = null;
  if (coupon) {
    const v = validateCoupon(coupon, sub, now);
    if (!v.ok) {
      couponError = v.reason;
    } else {
      const raw = coupon.type === 'percent'
        ? Math.round(sub * coupon.value / 100)
        : coupon.value;
      discountCents = Math.max(0, Math.min(raw, sub));
    }
  }

  const afterDiscount = sub - discountCents;
  let shippingCents = 0;
  let freeShippingRemainingCents = 0;
  if (shipping && shipping.method === 'courier') {
    if (afterDiscount >= freeShippingThresholdCents) {
      shippingCents = 0;
    } else {
      shippingCents = courierCents;
      freeShippingRemainingCents = Math.max(0, freeShippingThresholdCents - afterDiscount);
    }
  }
  const fee = payment === 'cod' ? codFeeCents : 0;
  const totalCents = Math.max(0, afterDiscount + shippingCents + fee);
  const vatIncludedCents = totalCents - Math.round(totalCents / (1 + vatRate));

  return {
    subtotalCents: sub, discountCents, shippingCents, codFeeCents: fee,
    totalCents, vatIncludedCents, freeShippingRemainingCents, couponError,
  };
}

/** Storefront wording for the free-shipping rule; a 0 threshold means EVERY order ships free (never «άνω των 0,00 €»). */
export function freeShippingPhrase(thresholdCents) {
  return Number(thresholdCents) > 0
    ? `Δωρεάν αποστολή για αγορές άνω των ${formatMoney(thresholdCents)}`
    : 'Δωρεάν αποστολή σε όλες τις παραγγελίες';
}

/** Condition-only variant for strips that already carry the «Δωρεάν αποστολή» title. */
export function freeShippingCondition(thresholdCents) {
  return Number(thresholdCents) > 0 ? `Για αγορές άνω των ${formatMoney(thresholdCents)}` : 'Για όλες τις παραγγελίες';
}
