// Pure homepage product selection (no DB, no DOM). Importable in Node.

const time = (p) => Date.parse(p.createdAt) || 0;
const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0);
const byNewest = (a, b) => time(b) - time(a) || byPopularity(a, b);
const inStockFirst = (a, b) => Number(b.availability?.inStock !== false) - Number(a.availability?.inStock !== false);

/**
 * Pick the products for each homepage section from the full product list.
 * - newCollection: flags.new, most popular first
 * - departments: per top-level category, featured first then popularity
 * - bestSellers: flags.bestSeller ordered by popularity
 * - newArrivals: newest by createdAt, skipping items already in newCollection when enough remain
 * Archived products never appear. Empty arrays mean "hide the section".
 */
export function selectHomeSections(products, { newLimit = 8, deptLimit = 4, bestLimit = 4, arrivalsLimit = 4 } = {}) {
  const live = (products || []).filter((p) => p && p.status !== 'archived');
  const newCollection = live.filter((p) => p.flags?.new).sort((a, b) => inStockFirst(a, b) || byPopularity(a, b)).slice(0, newLimit);
  const departments = {};
  for (const d of ['women', 'men', 'shoes', 'accessories']) {
    departments[d] = live
      .filter((p) => p.categoryId === d)
      .sort((a, b) => inStockFirst(a, b) || Number(Boolean(b.flags?.featured)) - Number(Boolean(a.flags?.featured)) || byPopularity(a, b))
      .slice(0, deptLimit);
  }
  const bestSellers = live.filter((p) => p.flags?.bestSeller).sort(byPopularity).slice(0, bestLimit);
  const shown = new Set(newCollection.map((p) => p.id));
  const newest = [...live].sort(byNewest);
  const fresh = newest.filter((p) => !shown.has(p.id));
  const newArrivals = (fresh.length >= arrivalsLimit ? fresh : newest).slice(0, arrivalsLimit);
  return { newCollection, departments, bestSellers, newArrivals };
}
