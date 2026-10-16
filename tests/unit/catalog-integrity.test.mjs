import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSeed } from '../../tools/validate-seed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const doc = read('data/products.json');
const meta = read('data/catalog-meta.json');
const credits = read('assets/images/credits.json');
const content = read('data/content.json');

test('real catalog passes seed validation (images and credits exist)', () => {
  const r = validateSeed(doc, meta.categories, { rootDir: root, credits, minProducts: 36 });
  assert.deepEqual(r.errors, []);
  assert.ok(doc.products.length >= 36);
});

test('content images exist (with -sm siblings) and have credits; tagged products exist', () => {
  const docs = [content.hero, ...content.banners.items, ...content.collections.departments,
    ...content.collections.items, ...content.instagram.posts].filter((d) => d.image);
  const imgs = docs.map((d) => d.image);
  assert.ok(imgs.length >= 21);
  for (const d of docs) {
    assert.ok(fs.existsSync(path.join(root, d.image)), `missing file ${d.image}`);
    assert.ok(credits[d.image], `no credits for ${d.image}`);
    assert.ok(d.alt && d.alt.trim(), `no alt for ${d.image}`);
    assert.ok(d.width > 0 && d.height > 0, `no dimensions for ${d.image}`);
    if (d.imageSm) assert.ok(fs.existsSync(path.join(root, d.imageSm)), `missing file ${d.imageSm}`);
  }
  const editorialSet = ['hero-1', 'banner-1', 'banner-2', 'banner-3', 'collection-1', 'collection-2', 'collection-3', 'collection-4',
    ...Array.from({ length: 9 }, (_, i) => `insta-${i + 1}`)];
  for (const n of editorialSet) assert.ok(imgs.includes(`assets/images/content/${n}.webp`), `${n} is not used by the content model`);
  const ids = new Set(doc.products.map((p) => p.id));
  for (const x of content.instagram.posts) {
    assert.ok(x.productIds.length >= 1, x.id);
    for (const id of x.productIds) assert.ok(ids.has(id), `unknown product ${id}`);
  }
  assert.equal(meta.content, undefined, 'catalog-meta.json no longer carries a duplicate content block');
  assert.equal(fs.existsSync(path.join(root, 'data/editorial.json')), false, 'editorial.json merged into content.json');
});

test('category coverage and sale items', () => {
  for (const c of meta.categories.filter((c) => c.parentId === null)) {
    const n = doc.products.filter((p) => p.categoryId === c.id).length;
    assert.ok(n >= 3, `${c.id} has only ${n} products`);
  }
  assert.ok(doc.products.filter((p) => p.compareAtCents).length >= 8);
});

test('every seed review references an existing product', () => {
  const ids = new Set(doc.products.map((p) => p.id));
  const { reviews } = read('data/reviews.json');
  assert.ok(reviews.length >= 50);
  for (const r of reviews) assert.ok(ids.has(r.productId), `review ${r.id} -> unknown product ${r.productId}`);
});
