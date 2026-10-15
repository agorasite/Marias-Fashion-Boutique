import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_DEFS, DB_NAME, SCHEMA_VERSION } from '../../assets/js/schema.js';

test('db name and version', () => {
  assert.equal(DB_NAME, 'agorasite-fashion1-v1');
  assert.equal(SCHEMA_VERSION, 1);
});
test('all stores defined with correct keyPaths', () => {
  const names = ['categories', 'products', 'variants', 'carts', 'wishlists', 'customers', 'orders', 'coupons', 'reviews', 'settings', 'content'];
  assert.deepEqual(Object.keys(STORE_DEFS).sort(), [...names].sort());
  assert.equal(STORE_DEFS.variants.keyPath, 'sku');
  assert.equal(STORE_DEFS.coupons.keyPath, 'code');
  assert.equal(STORE_DEFS.settings.keyPath, 'key');
  assert.equal(STORE_DEFS.content.keyPath, 'key');
  for (const n of ['categories', 'products', 'carts', 'wishlists', 'customers', 'orders', 'reviews']) assert.equal(STORE_DEFS[n].keyPath, 'id');
});
test('indexes', () => {
  const idx = (s) => STORE_DEFS[s].indexes.map((i) => i.name).sort();
  assert.deepEqual(idx('variants'), ['productId']);
  assert.deepEqual(idx('orders'), ['createdAt', 'customerId']);
  assert.deepEqual(idx('products'), ['categoryId', 'slug']);
});
