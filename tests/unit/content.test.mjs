import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_KEYS, validateContent, resolveContent, fillTokens,
  validateNewsletterEmail, addSubscriber, NEWSLETTER_KEY, planContentMigration,
} from '../../assets/js/services/content.js';
import { selectHomeSections } from '../../assets/js/services/home-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const defaults = read('data/content.json');
const { products } = read('data/products.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

test('content keys are exactly the seven homepage documents', () => {
  assert.deepEqual(CONTENT_KEYS, ['hero', 'banners', 'collections', 'instagram', 'promos', 'newsletter', 'footer']);
  assert.deepEqual(Object.keys(defaults).sort(), [...CONTENT_KEYS].sort());
});

test('every seeded default validates', () => {
  for (const key of CONTENT_KEYS) {
    const r = validateContent(key, defaults[key]);
    assert.deepEqual(r.errors, [], key);
    assert.equal(r.ok, true, key);
  }
});

test('unknown key and non-object values are rejected', () => {
  assert.equal(validateContent('editorial', {}).ok, false);
  assert.equal(validateContent('hero', null).ok, false);
  assert.equal(validateContent('hero', []).ok, false);
});

test('hero validation: required fields, safe links, image path and focal point', () => {
  const ok = clone(defaults.hero);
  assert.equal(ok.focal, '65% center');
  assert.equal(validateContent('hero', { ...ok, title: '' }).ok, false);
  assert.equal(validateContent('hero', { ...ok, alt: '  ' }).ok, false);
  assert.equal(validateContent('hero', { ...ok, ctaHref: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateContent('hero', { ...ok, ctaHref: '#/shop' }).ok, true, 'any internal hash route is structurally fine');
  assert.equal(validateContent('hero', { ...ok, image: '../../etc/passwd' }).ok, false);
  assert.equal(validateContent('hero', { ...ok, image: 'https://images.example.com/a.webp' }).ok, true);
  assert.equal(validateContent('hero', { ...ok, focal: 'url(x)' }).ok, false);
  assert.equal(validateContent('hero', { ...ok, focal: '30% 40%' }).ok, true);
  assert.equal(validateContent('hero', { ...ok, width: -1 }).ok, false);
  assert.equal(validateContent('hero', { ...ok, secondaryLabel: 'X', secondaryHref: '' }).ok, false, 'label needs a link');
  const { secondaryLabel, secondaryHref, eyebrow, ...minimal } = ok;
  assert.equal(validateContent('hero', minimal).ok, true, 'optional fields may be omitted');
  assert.equal(validateContent('hero', { ...ok, title: 'x'.repeat(200) }).ok, false);
});

test('list documents: banners, collections, promos validate item shape and unique ids', () => {
  const b = clone(defaults.banners);
  assert.equal(validateContent('banners', { items: 'nope' }).ok, false);
  assert.equal(validateContent('banners', { items: [] }).ok, true);
  b.items[1].id = b.items[0].id;
  assert.equal(validateContent('banners', b).ok, false, 'duplicate ids');
  const b2 = clone(defaults.banners);
  b2.items[0].placement = 'sidebar';
  assert.equal(validateContent('banners', b2).ok, false, 'unknown placement');
  const c = clone(defaults.collections);
  assert.equal(c.items.length, 4);
  c.items[0].href = 'http://evil.example';
  assert.equal(validateContent('collections', c).ok, false, 'http link rejected');
  const c2 = clone(defaults.collections);
  c2.departments[0].id = 'kids';
  assert.equal(validateContent('collections', c2).ok, false, 'unknown department');
  const p = clone(defaults.promos);
  p.items[0].title = '';
  assert.equal(validateContent('promos', p).ok, false);
  const p2 = clone(defaults.promos);
  p2.items[0].icon = 'truck"><script>';
  assert.equal(validateContent('promos', p2).ok, false, 'icon must be a plain bootstrap-icons name');
});

test('instagram feed config: curated mode, posts with productIds, optional https permalink', () => {
  const ig = clone(defaults.instagram);
  assert.equal(ig.mode, 'curated');
  assert.equal(ig.posts.length, 9);
  assert.ok(ig.posts.every((x) => Array.isArray(x.productIds) && x.productIds.length >= 1));
  assert.equal(validateContent('instagram', { ...ig, mode: 'scrape' }).ok, false);
  assert.equal(validateContent('instagram', { ...ig, profileUrl: 'ftp://x' }).ok, false);
  assert.equal(validateContent('instagram', { ...ig, profileUrl: 'https://instagram.com/elan' }).ok, true);
  const withLink = clone(ig);
  withLink.posts[0].permalink = 'https://www.instagram.com/p/abc123/';
  assert.equal(validateContent('instagram', withLink).ok, true);
  withLink.posts[0].permalink = 'javascript:void(0)';
  assert.equal(validateContent('instagram', withLink).ok, false);
  const badIds = clone(ig);
  badIds.posts[0].productIds = 'w-1';
  assert.equal(validateContent('instagram', badIds).ok, false);
  const ids = new Set(products.map((x) => x.id));
  for (const post of ig.posts) for (const id of post.productIds) assert.ok(ids.has(id), `${post.id} -> ${id}`);
});

test('newsletter and footer documents', () => {
  assert.equal(validateContent('newsletter', { ...defaults.newsletter, enabled: 'yes' }).ok, false);
  assert.equal(validateContent('newsletter', { ...defaults.newsletter, title: '' }).ok, false);
  const f = clone(defaults.footer);
  assert.ok(f.columns.flatMap((c) => c.links).some((l) => l.href === '#/catalog/women'));
  f.columns[0].links[0].href = 'javascript:x';
  assert.equal(validateContent('footer', f).ok, false);
  const f2 = clone(defaults.footer);
  f2.notes = [1];
  assert.equal(validateContent('footer', f2).ok, false);
});

test('resolveContent returns the stored doc without its key, or the default when missing/invalid', () => {
  const stored = { key: 'hero', ...defaults.hero, title: 'Άλλος τίτλος' };
  const r = resolveContent('hero', stored, defaults);
  assert.equal(r.title, 'Άλλος τίτλος');
  assert.equal('key' in r, false);
  assert.deepEqual(resolveContent('hero', undefined, defaults), defaults.hero);
  // legacy first-draft shape (catalog-meta.json) is not valid -> default
  assert.deepEqual(resolveContent('hero', { key: 'hero', title: 'x', subtitle: 'y', cta: 'z', link: '#/shop' }, defaults), defaults.hero);
  const copy = resolveContent('hero', undefined, defaults);
  copy.title = 'mutated';
  assert.notEqual(defaults.hero.title, 'mutated', 'defaults are not shared by reference');
  assert.throws(() => resolveContent('nope', undefined, defaults));
});

test('fillTokens formats the free-shipping threshold from settings', () => {
  assert.equal(fillTokens('άνω των {freeShipping}', { freeShippingThresholdCents: 6000 }).replace(/\s/g, ' '), 'άνω των 60,00 €');
  assert.equal(fillTokens('άνω των {freeShipping}', { freeShippingThresholdCents: 7550 }).replace(/\s/g, ' '), 'άνω των 75,50 €');
  assert.equal(fillTokens('χωρίς token', {}), 'χωρίς token');
  assert.equal(fillTokens('{storeName}', { storeName: 'Marias' }), 'Marias');
  assert.equal(fillTokens('{unknown}', {}), '{unknown}');
});

test('newsletter email validation', () => {
  assert.deepEqual(validateNewsletterEmail('  Maria@Example.GR '), { ok: true, email: 'maria@example.gr' });
  for (const bad of ['', '   ', 'maria', 'maria@', 'maria@example', 'a b@example.gr', null, 'x'.repeat(250) + '@a.gr']) {
    const r = validateNewsletterEmail(bad);
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.error);
  }
});

test('addSubscriber adds, detects duplicates case-insensitively and rejects invalid', () => {
  const now = '2026-10-16T10:00:00.000Z';
  const a = addSubscriber([], 'maria@example.gr', now);
  assert.equal(a.status, 'added');
  assert.deepEqual(a.list, [{ email: 'maria@example.gr', createdAt: now }]);
  const b = addSubscriber(a.list, 'MARIA@example.gr ', '2026-10-17T00:00:00.000Z');
  assert.equal(b.status, 'duplicate');
  assert.equal(b.list, a.list, 'list unchanged on duplicate');
  const c = addSubscriber(a.list, 'nope', now);
  assert.equal(c.status, 'invalid');
  assert.ok(c.error);
  assert.equal(addSubscriber(undefined, 'x@y.gr', now).status, 'added');
  assert.equal(NEWSLETTER_KEY, 'newsletterSubscribers');
});

test('planContentMigration drops legacy editorial, repairs malformed docs and keeps valid edits', () => {
  const edited = { key: 'hero', ...defaults.hero, title: 'Επεξεργασμένο' };
  const records = [
    { key: 'editorial', hero: {}, banners: [] },
    edited,
    { key: 'promos', items: [{ title: 'Κωδικός WELCOME10', text: '10%' }] },
    ...['banners', 'collections', 'instagram', 'newsletter'].map((k) => ({ key: k, ...defaults[k] })),
  ];
  const plan = planContentMigration(records, defaults);
  assert.deepEqual(plan.deletes, ['editorial']);
  assert.deepEqual(plan.puts.map((r) => r.key).sort(), ['footer', 'promos']);
  assert.deepEqual(plan.puts.find((r) => r.key === 'promos'), { ...defaults.promos, key: 'promos' });
  const clean = planContentMigration(CONTENT_KEYS.map((k) => ({ key: k, ...defaults[k] })), defaults);
  assert.deepEqual(clean, { deletes: [], puts: [] });
});

test('selectHomeSections: flags, ordering, limits, de-duplication and archived exclusion', () => {
  const s = selectHomeSections(products);
  assert.ok(s.newCollection.length > 0 && s.newCollection.length <= 8);
  assert.ok(s.newCollection.every((p) => p.flags.new));
  for (let i = 1; i < s.newCollection.length; i += 1) assert.ok(s.newCollection[i - 1].popularity >= s.newCollection[i].popularity);
  for (const d of ['women', 'men', 'shoes', 'accessories']) {
    assert.equal(s.departments[d].length, 4, d);
    assert.ok(s.departments[d].every((p) => p.categoryId === d));
  }
  assert.ok(s.bestSellers.length === 4 && s.bestSellers.every((p) => p.flags.bestSeller));
  for (let i = 1; i < s.bestSellers.length; i += 1) assert.ok(s.bestSellers[i - 1].popularity >= s.bestSellers[i].popularity);
  assert.equal(s.newArrivals.length, 4);
  for (let i = 1; i < s.newArrivals.length; i += 1) assert.ok(Date.parse(s.newArrivals[i - 1].createdAt) >= Date.parse(s.newArrivals[i].createdAt));
  const nc = new Set(s.newCollection.map((p) => p.id));
  assert.ok(s.newArrivals.every((p) => !nc.has(p.id)), 'arrivals do not repeat the new collection');

  const noBest = products.map((p) => ({ ...p, flags: { ...p.flags, bestSeller: false } }));
  assert.deepEqual(selectHomeSections(noBest).bestSellers, []);
  const archived = products.map((p) => (p.categoryId === 'shoes' ? { ...p, status: 'archived' } : p));
  assert.deepEqual(selectHomeSections(archived).departments.shoes, []);
  assert.deepEqual(selectHomeSections([]).newArrivals, []);
});
