import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyFilters, paginate, productAvailability, normalizeText, sizeLabel } from '../../assets/js/services/products.js';

const seed = JSON.parse(readFileSync(new URL('../../data/products.json', import.meta.url), 'utf8')).products;
const meta = JSON.parse(readFileSync(new URL('../../data/catalog-meta.json', import.meta.url), 'utf8'));
const products = seed.map(({ variants, ...p }) => p);
const variants = seed.flatMap((p) => p.variants.map((v) => ({ ...v, productId: p.id })));
const categories = meta.categories;
const F = (o = {}) => ({ sort: 'newest', ...o });
const ids = (r) => r.map((p) => p.id);

// small synthetic fixture for exact semantics
const P = (id, o = {}) => ({ id, slug: id, name: id, brand: 'A', categoryId: 'women', subcategoryId: 'dresses', priceCents: 1000, images: [], flags: {}, popularity: 0, createdAt: '2026-01-01T00:00:00Z', status: 'active', description: '', ...o });
const V = (productId, size, color, stock) => ({ sku: `${productId}-${size}-${color}`, productId, size, color, colorHex: '#000', stock });
const synth = [
  P('p1', { priceCents: 3000, brand: 'A', popularity: 5, createdAt: '2026-03-01T00:00:00Z' }),
  P('p2', { priceCents: 1000, brand: 'B', popularity: 9, createdAt: '2026-02-01T00:00:00Z' }),
  P('p3', { priceCents: 2000, brand: 'A', popularity: 9, createdAt: '2026-02-01T00:00:00Z' }),
  P('p4', { priceCents: 500, status: 'archived' }),
  P('p5', { priceCents: 2000, categoryId: 'men', subcategoryId: 'shirts' }),
];
const sv = [
  V('p1', 'S', 'Red', 0), V('p1', 'M', 'Blue', 4),
  V('p2', 'S', 'Blue', 3), V('p2', 'M', 'Red', 2),
  V('p3', 'M', 'Red', 0),
  V('p4', 'S', 'Red', 5),
  V('p5', 'S', 'Red', 5),
];

test('archived products are hidden', () => {
  assert.ok(!ids(applyFilters(synth, sv, F())).includes('p4'));
  assert.equal(applyFilters(products, variants, F()).length, products.filter((p) => p.status === 'active').length);
});

test('top-level category includes its subcategories; subcategory narrows', () => {
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ categoryId: 'women' })))), new Set(['p1', 'p2', 'p3']));
  const all = applyFilters(products, variants, F({ categoryId: 'shoes' }));
  assert.equal(all.length, products.filter((p) => p.categoryId === 'shoes').length);
  const sn = applyFilters(products, variants, F({ categoryId: 'shoes', subcategoryId: 'sneakers' }));
  assert.ok(sn.length > 0 && sn.length < all.length);
  assert.ok(sn.every((p) => p.subcategoryId === 'sneakers'));
  assert.equal(applyFilters(products, variants, F({ subcategoryId: 'sneakers' })).length, sn.length);
});

test('price filter uses effective priceCents, inclusive', () => {
  assert.deepEqual(ids(applyFilters(synth, sv, F({ minCents: 1000, maxCents: 2000, sort: 'price-asc' }))), ['p2', 'p3', 'p5']);
  assert.deepEqual(ids(applyFilters(synth, sv, F({ minCents: 2500 }))), ['p1']);
  assert.deepEqual(ids(applyFilters(synth, sv, F({ maxCents: 999 }))), []);
});

test('brand filter', () => {
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ brands: ['B'] })))), new Set(['p2']));
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ brands: ['A', 'B'] })))), new Set(['p1', 'p2', 'p3', 'p5']));
});

test('size filter ignores stock unless inStockOnly', () => {
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ sizes: ['S'] })))), new Set(['p1', 'p2', 'p5']));
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ sizes: ['S'], inStockOnly: true })))), new Set(['p2', 'p5']));
});

test('color filter', () => {
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ colors: ['Blue'] })))), new Set(['p1', 'p2']));
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ colors: ['Blue'], inStockOnly: true })))), new Set(['p1', 'p2']));
  assert.deepEqual(new Set(ids(applyFilters(synth, sv, F({ colors: ['Red'], inStockOnly: true })))), new Set(['p2', 'p5']));
});

test('size + color must match the SAME variant', () => {
  // p1 has S (Red) and M (Blue): size S and color Blue exist, but never together
  assert.deepEqual(ids(applyFilters(synth, sv, F({ sizes: ['S'], colors: ['Blue'] }))), ['p2']);
  // out-of-stock variant counts when inStockOnly is off, not when on
  assert.ok(ids(applyFilters(synth, sv, F({ sizes: ['S'], colors: ['Red'] }))).includes('p1'));
  assert.ok(!ids(applyFilters(synth, sv, F({ sizes: ['S'], colors: ['Red'], inStockOnly: true }))).includes('p1'));
});

test('inStockOnly drops products without any stocked variant', () => {
  const r = ids(applyFilters(synth, sv, F({ inStockOnly: true })));
  assert.ok(!r.includes('p3'));
  assert.ok(r.includes('p1'));
});

test('combinations narrow monotonically', () => {
  const r = applyFilters(synth, sv, F({ categoryId: 'women', brands: ['A'], sizes: ['M'], colors: ['Blue'], minCents: 2500, inStockOnly: true }));
  assert.deepEqual(ids(r), ['p1']);
  const real = applyFilters(products, variants, F({ categoryId: 'women', sizes: ['M'], inStockOnly: true }));
  assert.ok(real.length > 0 && real.every((p) => p.categoryId === 'women'));
});

test('sorts, with stable ties', () => {
  const s = (sort) => ids(applyFilters(synth, sv, F({ sort })));
  assert.deepEqual(s('newest'), ['p1', 'p2', 'p3', 'p5']); // p2/p3 tie keeps input order
  assert.deepEqual(s('popular'), ['p2', 'p3', 'p1', 'p5']);
  assert.deepEqual(s('price-asc'), ['p2', 'p3', 'p5', 'p1']);
  assert.deepEqual(s('price-desc'), ['p1', 'p3', 'p5', 'p2']);
  const prices = applyFilters(products, variants, F({ sort: 'price-asc' })).map((p) => p.priceCents);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test('empty result', () => {
  assert.deepEqual(applyFilters(synth, sv, F({ q: 'zzzzqq' })), []);
  assert.deepEqual(applyFilters(synth, sv, F({ brands: ['Nope'] })), []);
});

test('search is accent, case and final-sigma insensitive', () => {
  assert.equal(normalizeText('ΦΌΡΕΜΑ'), normalizeText('φορεμα'));
  assert.equal(normalizeText('Όλος'), normalizeText('ολοσ'));
  const r = applyFilters(products, variants, F({ q: 'φορεμα', categories }));
  assert.ok(r.length >= 4);
  assert.ok(r.some((p) => p.subcategoryId === 'dresses'));
  assert.equal(
    applyFilters(products, variants, F({ q: 'ΦΟΡΕΜΑΤΑ', categories })).length,
    applyFilters(products, variants, F({ q: 'φορέματα', categories })).length,
  );
  // brand and category-name search
  assert.ok(applyFilters(products, variants, F({ q: 'nordica', categories })).length > 0);
  assert.ok(applyFilters(products, variants, F({ q: 'γυναικεια', categories })).length >= 12);
  // all tokens must match
  assert.equal(applyFilters(products, variants, F({ q: 'φορεμα zzzz', categories })).length, 0);
});

test('search matches description text', () => {
  const p = [P('d1', { name: 'Alpha', description: 'Ιδανικό για καλοκαίρι' })];
  assert.equal(applyFilters(p, [], F({ q: 'ΚΑΛΟΚΑΙΡΙ' })).length, 1);
});

test('pagination math', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(paginate(list, 1, 12), { items: list.slice(0, 12), total: 30, page: 1, pageCount: 3, hasMore: true });
  assert.equal(paginate(list, 3, 12).items.length, 6);
  assert.equal(paginate(list, 3, 12).hasMore, false);
  assert.equal(paginate(list, 9, 12).items.length, 0);
  assert.deepEqual(paginate([], 1, 12), { items: [], total: 0, page: 1, pageCount: 0, hasMore: false });
});

test('productAvailability', () => {
  assert.deepEqual(productAvailability(synth[0], sv), { inStock: true, lowStock: true, minPriceCents: 3000 });
  assert.deepEqual(productAvailability(synth[2], sv), { inStock: false, lowStock: false, minPriceCents: 2000 });
  const big = [V('x', 'S', 'R', 50)];
  assert.equal(productAvailability(P('x'), big).lowStock, false);
  assert.equal(productAvailability(P('none'), []).inStock, false);
});

test('sizeLabel maps ONE to Greek', () => {
  assert.equal(sizeLabel('ONE'), 'Μία διάσταση');
  assert.equal(sizeLabel('42'), '42');
});
