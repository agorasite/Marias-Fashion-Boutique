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

export function quote({ lines, coupon = null, shipping, payment, settings, now = new Date() }) {
  const { vatRate, courierCents, freeShippingThresholdCents, codFeeCents } = settings;
  const subtotalCents = lines.reduce((s, l) => s + l.unitCents * l.qty, 0);

  let discountCents = 0;
  let couponError = null;
  if (coupon) {
    const v = validateCoupon(coupon, subtotalCents, now);
    if (!v.ok) {
      couponError = v.reason;
    } else {
      const raw = coupon.type === 'percent'
        ? Math.round(subtotalCents * coupon.value / 100)
        : coupon.value;
      discountCents = Math.max(0, Math.min(raw, subtotalCents));
    }
  }

  const afterDiscount = subtotalCents - discountCents;
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
    subtotalCents, discountCents, shippingCents, codFeeCents: fee,
    totalCents, vatIncludedCents, freeShippingRemainingCents, couponError,
  };
}
