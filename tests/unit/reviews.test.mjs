import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeReviews, validateReview } from '../../assets/js/services/reviews.js';
import { sizeChartFor } from '../../assets/js/services/size-charts.js';
import { pickRelated, findVariant } from '../../assets/js/services/products.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const products = read('data/products.json').products;
const reviews = read('data/reviews.json').reviews;

test('summarizeReviews: average, count and distribution', () => {
  const s = summarizeReviews([{ rating: 5 }, { rating: 4 }, { rating: 4 }, { rating: 3 }]);
  assert.equal(s.count, 4);
  assert.equal(s.average, 4);
  assert.deepEqual(s.distribution, { 1: 0, 2: 0, 3: 1, 4: 2, 5: 1 });
  assert.equal(summarizeReviews([{ rating: 5 }, { rating: 4 }, { rating: 4 }]).average, 4.3);
});

test('summarizeReviews: empty list and invalid ratings are ignored', () => {
  assert.deepEqual(summarizeReviews([]), { count: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  assert.equal(summarizeReviews([{ rating: 9 }, { rating: 'x' }]).count, 0);
});

test('validateReview: requires rating, title, body and name', () => {
  const bad = validateReview({ rating: 0, title: '', body: 'x', name: '' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['body', 'name', 'rating', 'title']);
  const ok = validateReview({ rating: '5', title: ' Τέλειο ', body: 'Πολύ ωραίο προϊόν.', name: 'Μαρία Κ.' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.rating, 5);
  assert.equal(ok.value.title, 'Τέλειο');
});

test('seed reviews: at least 50, valid ratings, every productId exists', () => {
  const ids = new Set(products.map((p) => p.id));
  assert.ok(reviews.length >= 50);
  const unique = new Set(reviews.map((r) => r.id));
  assert.equal(unique.size, reviews.length);
  for (const r of reviews) {
    assert.ok(ids.has(r.productId), `unknown product ${r.productId}`);
    assert.ok(r.rating >= 3 && r.rating <= 5);
    assert.ok(r.title && r.body && r.author && !Number.isNaN(Date.parse(r.createdAt)));
  }
});

test('sizeChartFor chooses by category', () => {
  const by = (id) => products.find((p) => p.id === id);
  const first = (pred) => products.find(pred);
  assert.equal(sizeChartFor(first((p) => p.subcategoryId === 'dresses')).kind, 'clothing');
  assert.equal(sizeChartFor(first((p) => p.subcategoryId === 'jeans')).kind, 'jeans');
  assert.equal(sizeChartFor(first((p) => p.categoryId === 'shoes')).kind, 'shoes');
  const bag = sizeChartFor(first((p) => p.subcategoryId === 'bags'));
  assert.equal(bag.kind, 'single');
  assert.match(bag.note, /Ενιαίο μέγεθος/);
  assert.ok(sizeChartFor(first((p) => p.categoryId === 'women')).rows.length >= 5);
  assert.ok(by(products[0].id));
});

test('pickRelated: same subcategory first, excludes self, max 4', () => {
  const p = products.find((x) => x.subcategoryId === 'shirts');
  const rel = pickRelated(p, products, 4);
  assert.ok(rel.length >= 1 && rel.length <= 4);
  assert.ok(rel.every((r) => r.id !== p.id));
  assert.equal(rel[0].subcategoryId, 'shirts');
  const lonely = products.find((x) => x.subcategoryId === 'belts');
  const rel2 = pickRelated(lonely, products, 4);
  assert.ok(rel2.every((r) => r.categoryId === 'accessories' && r.id !== lonely.id));
});

test('findVariant matches size and colour', () => {
  const p = products[0];
  const v = p.variants[0];
  assert.equal(findVariant(p.variants, v.size, v.color).sku, v.sku);
  assert.equal(findVariant(p.variants, 'nope', v.color), null);
});
