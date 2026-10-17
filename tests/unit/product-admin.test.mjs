import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  transliterate, slugify, eurosToCents, centsToEuros, pricingFromForm, pricingToForm, discountPercent,
  generateSku, generateVariantMatrix, normalizeProductInput, validateProductInput, filterAdminProducts,
  SIZE_PRESETS, isValidHex, withoutArchived,
} from '../../assets/js/services/product-admin-rules.js';
import { classifyLine } from '../../assets/js/services/cart-rules.js';
import { productAvailability, applyFilters } from '../../assets/js/services/products.js';
import { smOf, hasSm } from '../../assets/js/services/image-path.js';

const meta = JSON.parse(readFileSync(new URL('../../data/catalog-meta.json', import.meta.url), 'utf8'));
const categories = meta.categories;

const variant = (o = {}) => ({ size: 'M', color: 'Μαύρο', colorHex: '#111111', stock: 3, sku: '', ...o });
const good = (o = {}) => ({
  name: 'Μαύρο φόρεμα', slug: '', brand: 'Marias', categoryId: 'women', subcategoryId: 'dresses',
  description: 'Όμορφο φόρεμα.', priceCents: 5900, compareAtCents: undefined,
  images: ['assets/images/products/w-shirt-dress-mustard-1.webp'],
  attributes: { material: '', care: '', fit: '' }, flags: { featured: false, new: false, bestSeller: false }, status: 'active',
  variants: [variant()], ...o,
});
const ctx = (o = {}) => ({ existingProducts: [], existingSkus: [], categories, editingId: null, ...o });
const run = (input, c) => validateProductInput(input, ctx(c));

test('transliteration and slug generation', () => {
  assert.equal(slugify('Μαύρο φόρεμα'), 'mavro-forema');
  assert.equal(transliterate('Ψαθάκι'), 'psathaki');
  assert.equal(slugify('  Παλτό -- Wool & Co. 2026! '), 'palto-wool-co-2026');
  assert.equal(slugify('Ευχαριστώ'), 'efcharisto');
  assert.equal(slugify('Ουρανός'), 'ouranos');
  assert.equal(slugify('!!!'), '');
});

test('eurosToCents accepts comma and dot decimals and rejects junk', () => {
  assert.equal(eurosToCents('12,50'), 1250);
  assert.equal(eurosToCents('12.5'), 1250);
  assert.equal(eurosToCents('12'), 1200);
  assert.equal(eurosToCents(' 59,90 € '), 5990);
  assert.equal(eurosToCents(19.99), 1999);
  assert.equal(eurosToCents('1.234,56'), 123456);
  assert.equal(eurosToCents('0,07'), 7);
  for (const bad of ['', '  ', 'abc', '-5', '-0,5', NaN, null, undefined, '1,2,3', Infinity, '12.345', '1.005']) assert.equal(eurosToCents(bad), null, String(bad));
  assert.equal(eurosToCents(0), 0);
});

test('centsToEuros round-trips', () => {
  assert.equal(centsToEuros(1250), '12.50');
  assert.equal(centsToEuros(7), '0.07');
  assert.equal(centsToEuros(null), '');
  assert.equal(centsToEuros(undefined), '');
  for (const c of [1, 99, 100, 5990, 123456]) assert.equal(eurosToCents(centsToEuros(c)), c);
});

test('sale price mapping: regular price becomes compareAt, sale price becomes priceCents', () => {
  assert.deepEqual(pricingFromForm({ price: '80', salePrice: '59,90' }), { priceCents: 5990, compareAtCents: 8000, errors: {} });
  assert.deepEqual(pricingFromForm({ price: '80', salePrice: '' }), { priceCents: 8000, compareAtCents: undefined, errors: {} });
  const bad = pricingFromForm({ price: 'x', salePrice: '' });
  assert.equal(bad.priceCents, null);
  assert.ok(bad.errors.price);
  const badSale = pricingFromForm({ price: '80', salePrice: 'oops' });
  assert.ok(badSale.errors.salePrice);
  assert.deepEqual(pricingToForm({ priceCents: 5990, compareAtCents: 8000 }), { price: '80.00', salePrice: '59.90' });
  assert.deepEqual(pricingToForm({ priceCents: 5990 }), { price: '59.90', salePrice: '' });
  assert.equal(discountPercent(5990, 8000), 25);
  assert.equal(discountPercent(8000, undefined), 0);
  assert.equal(discountPercent(8000, 8000), 0);
});

test('SKU generation is deterministic and unique', () => {
  const taken = new Set();
  const a = generateSku('mavro-forema', 'M', 'Μαύρο', taken);
  assert.match(a, /^[A-Z0-9]+-M-[A-Z0-9]+$/);
  taken.add(a);
  const b = generateSku('mavro-forema', 'M', 'Μαύρο', taken);
  assert.notEqual(a, b);
  assert.ok(!taken.has(b));
  assert.equal(generateSku('x', '42', 'Red', new Set()), 'X-42-RED');
});

test('variant matrix generation: sizes x colors, keeps existing rows, no duplicates', () => {
  const colors = [{ name: 'Μαύρο', hex: '#111111' }, { name: 'Λευκό', hex: '#ffffff' }];
  const rows = generateVariantMatrix({ sizes: ['S', 'M'], colors, slug: 'p', stock: 4 });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => `${r.size}/${r.color}`), ['S/Μαύρο', 'S/Λευκό', 'M/Μαύρο', 'M/Λευκό']);
  assert.ok(rows.every((r) => r.stock === 4 && /^#[0-9a-f]{6}$/i.test(r.colorHex)));
  assert.equal(new Set(rows.map((r) => r.sku)).size, 4);
  const existing = [{ sku: 'OLD-1', size: 'S', color: 'Μαύρο', colorHex: '#111111', stock: 9 }];
  const again = generateVariantMatrix({ sizes: ['S', 'M'], colors: [colors[0]], slug: 'p', existing, stock: 0 });
  assert.equal(again.length, 2);
  assert.equal(again.find((r) => r.size === 'S').sku, 'OLD-1');
  assert.equal(again.find((r) => r.size === 'S').stock, 9);
  assert.equal(generateVariantMatrix({ sizes: ['S'], colors: [], slug: 'p' }).length, 0);
  assert.ok(SIZE_PRESETS.clothing.includes('XS') && SIZE_PRESETS.clothing.includes('XL'));
  assert.equal(SIZE_PRESETS.shoes[0], '36');
  assert.equal(SIZE_PRESETS.shoes.at(-1), '46');
  assert.deepEqual(SIZE_PRESETS.one, ['ONE']);
});

test('isValidHex', () => {
  assert.ok(isValidHex('#a1B2c3'));
  for (const b of ['#fff', 'a1b2c3', '#12345g', '', null]) assert.ok(!isValidHex(b), String(b));
});

test('valid input passes; slug and SKU are auto-generated', () => {
  const r = run(good());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.slug, 'mavro-forema');
  assert.match(r.value.variants[0].sku, /-M-/);
  assert.equal(r.value.name, 'Μαύρο φόρεμα');
});

test('name rule', () => {
  assert.ok(run(good({ name: '' })).errors.name);
  assert.ok(run(good({ name: ' a ' })).errors.name);
  assert.ok(!run(good({ name: 'Πα' })).errors.name);
});

test('slug rules: charset and uniqueness (ignoring the edited product)', () => {
  assert.ok(run(good({ slug: 'Has Space' })).errors.slug);
  assert.ok(run(good({ slug: 'ελληνικό' })).errors.slug);
  assert.ok(run(good({ slug: '-lead' })).errors.slug);
  assert.ok(!run(good({ slug: 'ok-slug-1' })).errors.slug);
  const existingProducts = [{ id: 'p1', slug: 'taken' }];
  assert.ok(run(good({ slug: 'taken' }), { existingProducts }).errors.slug);
  assert.ok(!run(good({ slug: 'taken' }), { existingProducts, editingId: 'p1' }).errors.slug);
  assert.ok(run(good(), { existingProducts: [{ id: 'z', slug: 'mavro-forema' }] }).errors.slug);
});

test('category and subcategory consistency', () => {
  assert.ok(run(good({ categoryId: '' })).errors.categoryId);
  assert.ok(run(good({ categoryId: 'nope' })).errors.categoryId);
  assert.ok(run(good({ subcategoryId: 'nope' })).errors.subcategoryId);
  assert.ok(run(good({ categoryId: 'men', subcategoryId: 'dresses' })).errors.subcategoryId);
  assert.ok(run(good({ subcategoryId: '' })).errors.subcategoryId);
  assert.ok(!run(good({ categoryId: 'women', subcategoryId: 'dresses' })).errors.subcategoryId);
  assert.ok(run(good({ subcategoryId: 'women' })).errors.subcategoryId);
});

test('price rules', () => {
  for (const bad of [0, -100, 12.5, NaN, null, undefined, '59']) assert.ok(run(good({ priceCents: bad })).errors.priceCents, String(bad));
  assert.ok(!run(good({ priceCents: 1 })).errors.priceCents);
});

test('compareAt (regular price) must exceed the sale price', () => {
  assert.ok(!run(good({ priceCents: 5000, compareAtCents: 8000 })).errors.compareAtCents);
  assert.ok(run(good({ priceCents: 5000, compareAtCents: 5000 })).errors.compareAtCents);
  assert.ok(run(good({ priceCents: 5000, compareAtCents: 4000 })).errors.compareAtCents);
  assert.ok(run(good({ priceCents: 5000, compareAtCents: 80.5 })).errors.compareAtCents);
  assert.ok(!run(good({ priceCents: 5000, compareAtCents: null })).errors.compareAtCents);
});

test('images, description and brand are required', () => {
  assert.ok(run(good({ images: [] })).errors.images);
  assert.ok(run(good({ images: ['', '  '] })).errors.images);
  assert.ok(run(good({ description: '   ' })).errors.description);
  assert.ok(run(good({ brand: '' })).errors.brand);
});

test('at least one variant', () => {
  const r = run(good({ variants: [] }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.variants);
});

test('variant rules: size, colour, hex, stock', () => {
  const r = run(good({ variants: [variant({ size: ' ', color: '', colorHex: 'red', stock: -1 })] }));
  assert.ok(r.errors['variants[0].size']);
  assert.ok(r.errors['variants[0].color']);
  assert.ok(r.errors['variants[0].colorHex']);
  assert.ok(r.errors['variants[0].stock']);
  for (const s of [1.5, NaN, '2.5', undefined]) assert.ok(run(good({ variants: [variant({ stock: s })] })).errors['variants[0].stock'], String(s));
  assert.ok(!run(good({ variants: [variant({ stock: 0 })] })).errors['variants[0].stock']);
  assert.ok(!run(good({ variants: [variant({ stock: '7' })] })).errors['variants[0].stock']);
});

test('SKU uniqueness: global and within the product; size+colour unique', () => {
  const dup = run(good({ variants: [variant({ sku: 'A-1' }), variant({ size: 'L', sku: 'A-1' })] }));
  assert.ok(dup.errors['variants[1].sku']);
  const global = run(good({ variants: [variant({ sku: 'TAKEN' })] }), { existingSkus: ['TAKEN'] });
  assert.ok(global.errors['variants[0].sku']);
  const ownOk = run(good({ variants: [variant({ sku: 'MINE' })] }), { existingSkus: [{ sku: 'MINE', productId: 'p1' }], editingId: 'p1' });
  assert.ok(!ownOk.errors['variants[0].sku']);
  const otherBad = run(good({ variants: [variant({ sku: 'MINE' })] }), { existingSkus: [{ sku: 'MINE', productId: 'p2' }], editingId: 'p1' });
  assert.ok(otherBad.errors['variants[0].sku']);
  const combo = run(good({ variants: [variant({ sku: 'A' }), variant({ sku: 'B' })] }));
  assert.ok(combo.errors['variants[1].size'] || combo.errors['variants[1].color']);
  const caseCombo = run(good({ variants: [variant({ sku: 'A', color: 'Μαύρο' }), variant({ sku: 'B', color: ' μαύρο ' })] }));
  assert.ok(caseCombo.errors['variants[1].color']);
  assert.ok(run(good({ variants: [variant({ sku: 'bad sku!' })] })).errors['variants[0].sku']);
});

test('auto-generated SKUs never collide with existing ones', () => {
  const first = normalizeProductInput(good(), { existingSkus: [] }).variants[0].sku;
  const r = run(good(), { existingSkus: [first] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.notEqual(r.value.variants[0].sku, first);
});

test('normalizeProductInput trims, parses stock and keeps flags', () => {
  const v = normalizeProductInput(good({ name: '  Φόρεμα  ', variants: [variant({ stock: '5', sku: ' abc-1 ' })], images: [' a.webp ', ''] }), { existingSkus: [] });
  assert.equal(v.name, 'Φόρεμα');
  assert.equal(v.variants[0].stock, 5);
  assert.equal(v.variants[0].sku, 'abc-1');
  assert.deepEqual(v.images, ['a.webp']);
});

test('archived variants are ignored by availability, filters and cart classification', () => {
  const p = { id: 'p', status: 'active', priceCents: 1000, name: 'p', slug: 'p', brand: 'b', categoryId: 'women', subcategoryId: 'dresses', createdAt: '2026-01-01' };
  const vs = [{ sku: 'a', productId: 'p', size: 'S', color: 'R', stock: 0, archived: true }, { sku: 'b', productId: 'p', size: 'M', color: 'R', stock: 0 }];
  assert.equal(productAvailability(p, [{ ...vs[0], stock: 5 }]).inStock, false);
  assert.equal(applyFilters([p], [{ ...vs[0], stock: 9 }], { sizes: ['S'] }).length, 0);
  assert.equal(applyFilters([p], vs, { sizes: ['M'] }).length, 1);
  assert.equal(classifyLine({ qty: 1, variant: vs[0], product: p }).problem, 'archived');
  assert.deepEqual(withoutArchived(vs).map((v) => v.sku), ['b']);
});

test('image path helpers fall back to the same URL for non-seeded images', () => {
  assert.equal(smOf('assets/images/products/a-1.webp'), 'assets/images/products/a-1-sm.webp');
  assert.equal(smOf('assets/images/products/a-1-sm.webp'), 'assets/images/products/a-1-sm.webp');
  const data = 'data:image/webp;base64,AAAA';
  assert.equal(smOf(data), data);
  assert.equal(smOf('https://x.test/a.webp'), 'https://x.test/a.webp');
  assert.ok(hasSm('assets/images/products/a-1.webp'));
  assert.ok(!hasSm(data));
});

test('filterAdminProducts: search, filters, sort, pagination', () => {
  const P = (id, o = {}) => ({ id, slug: id, name: id, brand: 'A', categoryId: 'women', subcategoryId: 'dresses', priceCents: 1000, flags: { featured: false }, createdAt: '2026-01-01T00:00:00Z', status: 'active', ...o });
  const V = (productId, sku, stock, o = {}) => ({ sku, productId, size: 'M', color: 'x', stock, ...o });
  const products = [
    P('a', { name: 'Φόρεμα Alpha', priceCents: 3000, createdAt: '2026-03-01T00:00:00Z', flags: { featured: true } }),
    P('b', { name: 'Μπλούζα Beta', brand: 'Zed', priceCents: 1000, categoryId: 'men', subcategoryId: 'shirts', createdAt: '2026-02-01T00:00:00Z' }),
    P('c', { name: 'Γάμμα', status: 'archived', priceCents: 2000 }),
  ];
  const variants = [V('a', 'AL-M', 2), V('a', 'AL-L', 1), V('b', 'BE-M', 40), V('c', 'GA-M', 0)];
  const f = (o) => filterAdminProducts(products, variants, categories, o);
  assert.equal(f({}).total, 3);
  assert.deepEqual(f({ q: 'φορεμα' }).items.map((r) => r.id), ['a']);
  assert.deepEqual(f({ q: 'zed' }).items.map((r) => r.id), ['b']);
  assert.deepEqual(f({ q: 'be-m' }).items.map((r) => r.id), ['b']);
  assert.deepEqual(f({ status: 'archived' }).items.map((r) => r.id), ['c']);
  assert.deepEqual(f({ status: 'active', categoryId: 'men' }).items.map((r) => r.id), ['b']);
  assert.deepEqual(f({ lowStock: true }).items.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(f({ featured: true }).items.map((r) => r.id), ['a']);
  assert.deepEqual(f({ sort: 'price-asc' }).items.map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(f({ sort: 'price-desc' }).items.map((r) => r.id), ['a', 'c', 'b']);
  assert.deepEqual(f({ sort: 'stock-asc' }).items.map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(f({ sort: 'name' }).items.map((r) => r.id), ['c', 'b', 'a']);
  assert.deepEqual(f({ sort: 'newest' }).items.map((r) => r.id), ['a', 'b', 'c']);
  const a = f({}).items.find((r) => r.id === 'a');
  assert.equal(a.totalStock, 3);
  assert.equal(a.skuCount, 2);
  const pg = f({ pageSize: 2, page: 2 });
  assert.equal(pg.items.length, 1);
  assert.equal(pg.pageCount, 2);
  assert.equal(pg.total, 3);
  assert.equal(f({ page: 99, pageSize: 2 }).page, 2);
});

test('image allow-list: relative assets paths, http(s) URLs and raster data URLs only', async () => {
  const { imageSourceError, MAX_IMAGES } = await import('../../assets/js/services/product-admin-rules.js');
  const ok = ['assets/images/products/a-1.webp', 'https://cdn.example.com/a.jpg?x=1', 'http://example.com/a.png', 'data:image/webp;base64,AAAA', 'data:image/jpeg;base64,AAAA==', 'data:image/png;base64,iVBOR'];
  for (const s of ok) assert.equal(imageSourceError(s), '', s);
  const bad = ['javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'data:image/webp;base64,AA AA', 'assets/../secret.png', `assets${String.fromCharCode(92)}x.png`,
    '/etc/passwd', 'ftp://x/a.png', 'https://x.com/a b.png', 'https://x.com/a".png', "https://x.com/a'.png", 'file:///c:/a.png', 'vbscript:x', '//evil.com/a.png', 'assets/a b.png', 'data:image/webp;base64,'];
  for (const s of bad) assert.notEqual(imageSourceError(s), '', s);
  assert.notEqual(imageSourceError(`data:image/webp;base64,${'A'.repeat(2.6 * 1024 * 1024)}`), '');
  assert.equal(imageSourceError(`data:image/webp;base64,${'A'.repeat(2 * 1024 * 1024)}`), '');
  assert.equal(MAX_IMAGES, 10);
});

test('validator applies the image allow-list and the 10 image cap', () => {
  assert.ok(run(good({ images: ['javascript:alert(1)'] })).errors.images);
  assert.ok(run(good({ images: ['assets/images/a-1.webp', 'data:image/svg+xml;base64,AAAA'] })).errors.images);
  assert.ok(run(good({ images: Array.from({ length: 11 }, (_, i) => `assets/images/p-${i}.webp`) })).errors.images);
  assert.ok(!run(good({ images: Array.from({ length: 10 }, (_, i) => `assets/images/p-${i}.webp`) })).errors.images);
});

test('SKU of an existing variant is immutable', () => {
  const r = run(good({ variants: [variant({ sku: 'NEW-1', originalSku: 'OLD-1' })] }));
  assert.ok(r.errors['variants[0].sku']);
  assert.ok(!run(good({ variants: [variant({ sku: 'SAME', originalSku: 'SAME' })] })).errors['variants[0].sku']);
});

test('-sm.webp siblings are only assumed for seeded product photos', () => {
  assert.ok(hasSm('assets/images/products/w-shirt-dress-mustard-1.webp'));
  assert.ok(!hasSm('assets/images/hero/banner.webp'));
  assert.ok(!hasSm('assets/other/a-1.webp'));
  assert.ok(!hasSm('https://x.com/assets/images/products/a-1.webp'));
});

test('upload file rules: only png/jpeg/webp/gif up to 5 MB', async () => {
  const { imageFileError } = await import('../../assets/js/pages/admin/image-upload.js');
  const f = (type, size = 10, name = 'a') => ({ type, size, name });
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) assert.equal(imageFileError(f(t)), '');
  for (const t of ['image/svg+xml', 'text/html', 'application/javascript', '', 'image/tiff']) assert.notEqual(imageFileError(f(t)), '', t);
  assert.notEqual(imageFileError(f('image/png', 5 * 1024 * 1024 + 1)), '');
});
