import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute, parseHash } from '../../assets/js/router.js';

test('static patterns match exactly (trailing slash tolerated)', () => {
  assert.deepEqual(matchRoute('/', '/'), {});
  assert.deepEqual(matchRoute('/catalog', '/catalog'), {});
  assert.deepEqual(matchRoute('/catalog', '/catalog/'), {});
  assert.equal(matchRoute('/catalog', '/cart'), null);
  assert.equal(matchRoute('/', '/catalog'), null);
  assert.equal(matchRoute('/catalog', '/catalog/women'), null);
});

test('named params are extracted and decoded', () => {
  assert.deepEqual(matchRoute('/catalog/:categoryId', '/catalog/women'), { categoryId: 'women' });
  assert.deepEqual(matchRoute('/product/:slug', '/product/linen%20dress'), { slug: 'linen dress' });
  assert.deepEqual(matchRoute('/account/orders/:id', '/account/orders/ELN-1001'), { id: 'ELN-1001' });
  assert.equal(matchRoute('/product/:slug', '/product'), null);
  assert.equal(matchRoute('/product/:slug', '/product/a/b'), null);
});

test('wildcard matches the base and any sub-path', () => {
  assert.deepEqual(matchRoute('/admin/*', '/admin'), { '*': '' });
  assert.deepEqual(matchRoute('/admin/*', '/admin/orders/5'), { '*': 'orders/5' });
  assert.equal(matchRoute('/admin/*', '/administrator'), null);
  assert.equal(matchRoute('/account/*', '/cart'), null);
});

test('malformed percent-encoding does not throw', () => {
  assert.deepEqual(matchRoute('/product/:slug', '/product/%E0%A4%A'), { slug: '%E0%A4%A' });
});

test('parseHash splits path and query', () => {
  assert.deepEqual(parseHash(''), { path: '/', query: {} });
  assert.deepEqual(parseHash('#'), { path: '/', query: {} });
  assert.deepEqual(parseHash('#/'), { path: '/', query: {} });
  assert.deepEqual(parseHash('#/catalog?sort=price-asc'), { path: '/catalog', query: { sort: 'price-asc' } });
  assert.deepEqual(parseHash('#/catalog?q=%CF%86%CF%8C%CF%81%CE%B5%CE%BC%CE%B1&page=2'), {
    path: '/catalog',
    query: { q: 'φόρεμα', page: '2' },
  });
  assert.deepEqual(parseHash('#/catalog?q=a+b'), { path: '/catalog', query: { q: 'a b' } });
  assert.deepEqual(parseHash('/cart'), { path: '/cart', query: {} });
  assert.deepEqual(parseHash('#cart'), { path: '/cart', query: {} });
});
