// Pure admin statistics (no DB, no DOM): everything the overview dashboard shows is derived here
// from the stored orders, products, variants and customers. Importable in Node.
//
// Definitions (also shown as tooltips in the admin overview):
// - totalOrders: every stored order, whatever its status.
// - revenueCents ("demo revenue"): sum of totals.totalCents of orders whose fulfillmentStatus is NOT
//   'cancelled' or 'returned'. Payment status is ignored (COD orders are collected on delivery).
// - pending: orders whose fulfillmentStatus is exactly 'pending' (confirmed/processing are in statusCounts).
// - completed: orders whose fulfillmentStatus is 'delivered'.
// - activeProducts: products whose status is not 'archived'.
// - lowStockProducts: active products whose TOTAL stock over all variants is <= lowStockThreshold
//   (default 5; includes fully sold-out products), lowest first.
// - lowStockVariants: in-stock variants (1..LOW_VARIANT_STOCK units) of active products, lowest first.
// - topProducts: top 5 products by quantity sold in orders that count as revenue (not cancelled/returned);
//   ties broken by revenue, then name. Name/image come from the current product, else the order snapshot.
// - salesByDay: the last 30 local calendar days ending today (zero-filled). `orders` counts every order
//   placed that day; `revenueCents` uses the revenue definition above. Orders after `now` are ignored.

export const FULFILLMENT_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
export const REVENUE_EXCLUDED = new Set(['cancelled', 'returned']);
export const LOW_VARIANT_STOCK = 2;
export const RECENT_COUNT = 8;
export const TOP_COUNT = 5;
export const SALES_DAYS = 30;

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date 'YYYY-MM-DD'. */
export const dayKey = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

export const countsAsRevenue = (o) => !!o && !REVENUE_EXCLUDED.has(o.fulfillmentStatus);
const total = (o) => Number(o?.totals?.totalCents) || 0;
const byNewest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : String(b.id).localeCompare(String(a.id)));
const cmpName = (a, b) => String(a || '').localeCompare(String(b || ''), 'el');

export function computeStats(orders = [], products = [], variants = [], customers = [], { now = new Date(), lowStockThreshold = 5 } = {}) {
  const os = Array.isArray(orders) ? orders : [];
  const ps = Array.isArray(products) ? products : [];
  const vs = Array.isArray(variants) ? variants : [];
  const nowDate = now instanceof Date ? now : new Date(now);

  const statusCounts = Object.fromEntries(FULFILLMENT_STATUSES.map((k) => [k, 0]));
  let revenueCents = 0;
  for (const o of os) {
    if (Object.hasOwn(statusCounts, o.fulfillmentStatus)) statusCounts[o.fulfillmentStatus] += 1;
    if (countsAsRevenue(o)) revenueCents += total(o);
  }

  const active = ps.filter((p) => p && p.status !== 'archived');
  const activeById = new Map(active.map((p) => [p.id, p]));
  const stockByProduct = new Map(active.map((p) => [p.id, 0]));
  const lowStockVariants = [];
  for (const v of vs) {
    const p = activeById.get(v.productId);
    if (!p || v.archived) continue;
    const stock = Number(v.stock) || 0;
    stockByProduct.set(p.id, stockByProduct.get(p.id) + stock);
    if (stock > 0 && stock <= LOW_VARIANT_STOCK) {
      lowStockVariants.push({ sku: v.sku, productId: p.id, name: p.name, size: v.size ?? null, color: v.color ?? null, stock });
    }
  }
  lowStockVariants.sort((a, b) => a.stock - b.stock || cmpName(a.name, b.name) || String(a.sku).localeCompare(String(b.sku)));
  const lowStockProducts = active
    .map((p) => ({ productId: p.id, name: p.name, image: (p.images && p.images[0]) || null, totalStock: stockByProduct.get(p.id) }))
    .filter((p) => p.totalStock <= lowStockThreshold)
    .sort((a, b) => a.totalStock - b.totalStock || cmpName(a.name, b.name));

  const allById = new Map(ps.map((p) => [p.id, p]));
  const sold = new Map();
  for (const o of os) {
    if (!countsAsRevenue(o)) continue;
    for (const l of o.lines || []) {
      const qty = Number(l.qty) || 0;
      const cur = sold.get(l.productId) || { productId: l.productId, name: l.name, image: l.image || null, qty: 0, revenueCents: 0 };
      cur.qty += qty;
      cur.revenueCents += Number(l.lineTotalCents ?? (l.unitCents * qty)) || 0;
      sold.set(l.productId, cur);
    }
  }
  const topProducts = [...sold.values()].map((t) => {
    const p = allById.get(t.productId);
    return p ? { ...t, name: p.name, image: (p.images && p.images[0]) || t.image } : t;
  }).sort((a, b) => b.qty - a.qty || b.revenueCents - a.revenueCents || cmpName(a.name, b.name)).slice(0, TOP_COUNT);

  const start = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - (SALES_DAYS - 1));
  const salesByDay = [];
  const index = new Map();
  for (let i = 0; i < SALES_DAYS; i += 1) {
    const key = dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    index.set(key, salesByDay.length);
    salesByDay.push({ date: key, orders: 0, revenueCents: 0 });
  }
  for (const o of os) {
    const at = new Date(o.createdAt);
    if (Number.isNaN(at.getTime()) || at < start || at > nowDate) continue;
    const i = index.get(dayKey(at));
    if (i === undefined) continue;
    salesByDay[i].orders += 1;
    if (countsAsRevenue(o)) salesByDay[i].revenueCents += total(o);
  }

  return {
    totalOrders: os.length,
    revenueCents,
    pending: statusCounts.pending,
    completed: statusCounts.delivered,
    activeProducts: active.length,
    lowStockProducts,
    lowStockVariants,
    customers: Array.isArray(customers) ? customers.length : 0,
    recent: os.slice().sort(byNewest).slice(0, RECENT_COUNT),
    topProducts,
    salesByDay,
    statusCounts,
  };
}
