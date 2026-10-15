import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeed } from '../../tools/validate-seed.mjs';

const cats = [
  { id: 'women', parentId: null }, { id: 'men', parentId: null },
  { id: 'dresses', parentId: 'women' }, { id: 'shirts', parentId: 'men' },
];
const mk = (i) => ({
  id: `p${i}`, slug: `prod-${i}`, name: `P${i}`, brand: 'B', categoryId: 'women', subcategoryId: 'dresses',
  description: 'd', priceCents: 1000, images: [`assets/images/products/prod-${i}-1.webp`],
  attributes: { material: 'x', care: 'y' }, flags: { featured: false, new: false, bestSeller: false },
  popularity: 1, createdAt: '2026-01-01T00:00:00.000Z', status: 'active',
  variants: [{ sku: `SKU-${i}-M`, size: 'M', color: 'Black', colorHex: '#000000', stock: 3 }],
});
const credit = { photographer: 'A', sourceUrl: 'https://x', license: 'Unsplash License', retrievedAt: '2026-01-01', source: 'unsplash' };
const good = () => {
  const products = Array.from({ length: 36 }, (_, i) => mk(i));
  const credits = {};
  for (const p of products) for (const im of p.images) credits[im] = { ...credit };
  return { doc: { products }, credits };
};
const run = (doc, credits, extra = {}) => validateSeed(doc, cats, { rootDir: null, credits, ...extra });
const broken = (mut, re) => {
  const { doc, credits } = good();
  const c = mut(doc, credits) || credits;
  const r = run(doc, c);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => re.test(e)), `no error matching ${re}: ${r.errors.join('|')}`);
};

test('valid 36-product fixture passes', () => {
  const { doc, credits } = good();
  const r = run(doc, credits);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});
test('fewer than minProducts', () => broken((d) => { d.products.pop(); }, /minimum|at least|36/i));
test('duplicate id', () => broken((d) => { d.products[1].id = 'p0'; }, /duplicate.*id/i));
test('duplicate slug', () => broken((d) => { d.products[1].slug = 'prod-0'; }, /duplicate.*slug/i));
test('duplicate sku', () => broken((d) => { d.products[1].variants[0].sku = 'SKU-0-M'; }, /duplicate.*sku/i));
test('negative stock', () => broken((d) => { d.products[0].variants[0].stock = -1; }, /stock/i));
test('non-integer stock', () => broken((d) => { d.products[0].variants[0].stock = 1.5; }, /stock/i));
test('negative price', () => broken((d) => { d.products[0].priceCents = -5; }, /priceCents/));
test('non-integer price', () => broken((d) => { d.products[0].priceCents = 10.5; }, /priceCents/));
test('compareAt <= price', () => broken((d) => { d.products[0].compareAtCents = 1000; }, /compareAtCents/));
test('missing required field', () => broken((d) => { delete d.products[0].brand; }, /brand/));
test('unknown category', () => broken((d) => { d.products[0].categoryId = 'nope'; }, /categoryId/));
test('subcategory parent mismatch', () => broken((d) => { d.products[0].subcategoryId = 'shirts'; }, /subcategoryId/));
test('image lacks credits', () => broken((d, c) => { const x = { ...c }; delete x[d.products[0].images[0]]; return x; }, /credit/i));
test('credits entry incomplete', () => broken((d, c) => { delete c[d.products[0].images[0]].photographer; }, /photographer/));
test('credits bad source', () => broken((d, c) => { c[d.products[0].images[0]].source = 'flickr'; }, /source/));
test('zero images', () => broken((d) => { d.products[0].images = []; }, /image/i));
test('image reused across products', () => broken((d, c) => { d.products[1].images = [d.products[0].images[0]]; }, /reused|shared|more than one/i));
test('empty variants', () => broken((d) => { d.products[0].variants = []; }, /variants/));
test('missing file under rootDir', () => {
  const { doc, credits } = good();
  const r = validateSeed(doc, cats, { rootDir: 'C:/definitely/not/here', credits });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /does not exist|missing file/i.test(e)));
});
