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
const editorial = read('data/editorial.json');

test('real catalog passes seed validation (images and credits exist)', () => {
  const r = validateSeed(doc, meta.categories, { rootDir: root, credits, minProducts: 36 });
  assert.deepEqual(r.errors, []);
  assert.ok(doc.products.length >= 36);
});

test('editorial images exist and have credits', () => {
  const imgs = [editorial.hero.image, ...['banners', 'collections', 'instagram'].flatMap((k) => editorial[k].map((x) => x.image))];
  assert.ok(imgs.length >= 12);
  for (const im of imgs) {
    assert.ok(fs.existsSync(path.join(root, im)), `missing file ${im}`);
    assert.ok(credits[im], `no credits for ${im}`);
  }
  const ids = new Set(doc.products.map((p) => p.id));
  for (const x of editorial.instagram) for (const id of x.productIds || []) assert.ok(ids.has(id), `unknown product ${id}`);
});

test('category coverage and sale items', () => {
  for (const c of meta.categories.filter((c) => c.parentId === null)) {
    const n = doc.products.filter((p) => p.categoryId === c.id).length;
    assert.ok(n >= 3, `${c.id} has only ${n} products`);
  }
  assert.ok(doc.products.filter((p) => p.compareAtCents).length >= 8);
});
