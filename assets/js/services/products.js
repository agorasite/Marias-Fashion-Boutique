// Product service: pure filtering (applyFilters) plus thin IndexedDB-backed queries.
import { getAll, tx, reqP } from '../db.js';

export const LOW_STOCK_TOTAL = 5;

/** Lowercase, strip accents/diacritics, fold the Greek final sigma. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .trim();
}

/** Display label for a variant size ("ONE" is the accessories single size). */
export const sizeLabel = (size) => (size === 'ONE' ? 'Μία διάσταση' : String(size));

const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
export function compareSizes(a, b) {
  const rank = (s) => {
    if (s === 'ONE') return [3, 0, s];
    const li = LETTER_SIZES.indexOf(s);
    if (li >= 0) return [0, li, s];
    const n = parseFloat(s);
    if (!Number.isNaN(n)) return [1, n, s];
    return [2, 0, s];
  };
  const [ga, na, sa] = rank(a);
  const [gb, nb, sb] = rank(b);
  return ga - gb || na - nb || String(sa).localeCompare(String(sb));
}

const groupByProduct = (variants) => {
  const m = new Map();
  for (const v of variants || []) {
    if (!m.has(v.productId)) m.set(v.productId, []);
    m.get(v.productId).push(v);
  }
  return m;
};

export function productAvailability(product, variants) {
  const own = (variants || []).filter((v) => v.productId === product.id);
  const total = own.reduce((s, v) => s + Math.max(0, v.stock || 0), 0);
  const inStock = total > 0;
  return {
    inStock,
    lowStock: inStock && total <= LOW_STOCK_TOTAL,
    minPriceCents: product.priceCents,
  };
}

const SORTERS = {
  newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
  popular: (a, b) => (b.popularity || 0) - (a.popularity || 0),
  'price-asc': (a, b) => a.priceCents - b.priceCents,
  'price-desc': (a, b) => b.priceCents - a.priceCents,
};

function searchHaystack(p, catName) {
  return normalizeText([
    p.name, p.brand, p.description,
    catName(p.subcategoryId), catName(p.categoryId),
  ].join(' '));
}

/**
 * Pure filter + sort. `filter.categories` (optional) supplies category names
 * so search can match category / subcategory names.
 * Returns the full, sorted result list (no pagination).
 */
export function applyFilters(products, variants, filter = {}) {
  const f = filter || {};
  const byProduct = groupByProduct(variants);
  const names = new Map((f.categories || []).map((c) => [c.id, c.name]));
  const catName = (id) => names.get(id) || '';
  const tokens = normalizeText(f.q).split(/\s+/).filter(Boolean);
  const sizes = f.sizes && f.sizes.length ? new Set(f.sizes.map(String)) : null;
  const colors = f.colors && f.colors.length ? new Set(f.colors) : null;
  const brands = f.brands && f.brands.length ? new Set(f.brands) : null;

  const out = [];
  products.forEach((p, index) => {
    if (p.status === 'archived') return;
    if (f.categoryId && p.categoryId !== f.categoryId && p.subcategoryId !== f.categoryId) return;
    if (f.subcategoryId && p.subcategoryId !== f.subcategoryId) return;
    if (f.minCents != null && f.minCents !== '' && p.priceCents < f.minCents) return;
    if (f.maxCents != null && f.maxCents !== '' && p.priceCents > f.maxCents) return;
    if (brands && !brands.has(p.brand)) return;
    if (tokens.length) {
      const hay = searchHaystack(p, catName);
      if (!tokens.every((t) => hay.includes(t))) return;
    }
    const own = byProduct.get(p.id) || [];
    if (sizes || colors || f.inStockOnly) {
      const ok = own.some((v) => (!sizes || sizes.has(String(v.size)))
        && (!colors || colors.has(v.color))
        && (!f.inStockOnly || v.stock > 0));
      if (!ok) return;
    }
    out.push({ p, index });
  });
  const cmp = SORTERS[f.sort] || SORTERS.newest;
  out.sort((a, b) => cmp(a.p, b.p) || a.index - b.index);
  return out.map((o) => o.p);
}

export function paginate(list, page = 1, pageSize = 12) {
  const size = Math.max(1, pageSize | 0);
  const total = list.length;
  const pageCount = Math.ceil(total / size);
  const pg = Math.max(1, page | 0);
  return {
    items: list.slice((pg - 1) * size, pg * size),
    total,
    page: pg,
    pageCount,
    hasMore: pg < pageCount,
  };
}

/** Facets over the set scoped by category + search only (so choices stay visible while filtering). */
export function computeFacets(products, variants, filter = {}) {
  const scoped = applyFilters(products, variants, {
    categoryId: filter.categoryId, subcategoryId: filter.subcategoryId, q: filter.q, categories: filter.categories, sort: 'newest',
  });
  const byProduct = groupByProduct(variants);
  const sizes = new Set();
  const colors = new Map();
  const brands = new Set();
  let min = Infinity;
  let max = -Infinity;
  for (const p of scoped) {
    brands.add(p.brand);
    min = Math.min(min, p.priceCents);
    max = Math.max(max, p.priceCents);
    for (const v of byProduct.get(p.id) || []) {
      sizes.add(String(v.size));
      if (!colors.has(v.color)) colors.set(v.color, v.colorHex);
    }
  }
  return {
    sizes: [...sizes].sort(compareSizes),
    colors: [...colors].map(([name, hex]) => ({ name, hex })).sort((a, b) => a.name.localeCompare(b.name, 'el')),
    brands: [...brands].sort((a, b) => a.localeCompare(b, 'el')),
    priceRange: scoped.length ? { minCents: min, maxCents: max } : { minCents: 0, maxCents: 0 },
  };
}

async function loadAll() {
  const [products, variants, categories] = await Promise.all([getAll('products'), getAll('variants'), getAll('categories')]);
  return { products, variants, categories };
}

export async function listCategories() {
  const cats = await getAll('categories');
  return cats.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

export async function listProducts(filter = {}) {
  const { products, variants, categories } = await loadAll();
  const f = { ...filter, categories };
  const all = applyFilters(products, variants, f);
  const { items, total } = paginate(all, filter.page || 1, filter.pageSize || 12);
  const byProduct = groupByProduct(variants);
  return {
    items: items.map((p) => ({
      ...p,
      variants: byProduct.get(p.id) || [],
      availability: productAvailability(p, byProduct.get(p.id) || []),
    })),
    total,
    facets: computeFacets(products, variants, f),
  };
}

/** Fetch by id, falling back to slug. Returns the product with its variants and availability, or null. */
export async function getProduct(idOrSlug) {
  if (!idOrSlug) return null;
  const result = await tx(['products', 'variants'], 'readonly', async (t) => {
    let p = await reqP(t.objectStore('products').get(idOrSlug));
    if (!p) p = await reqP(t.objectStore('products').index('slug').get(idOrSlug));
    if (!p) return null;
    const vs = await reqP(t.objectStore('variants').index('productId').getAll(p.id));
    return { p, vs };
  });
  if (!result) return null;
  return { ...result.p, variants: result.vs, availability: productAvailability(result.p, result.vs) };
}

