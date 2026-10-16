import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  moveItem, removeAt, nextId, TOKEN_DOCS, toggleProductId, searchProducts, resolveProductChips, MAX_PRODUCTS_PER_POST,
  newsletterToCsv, newsletterCsvFileName, pruneEmpty, parseErrorPath, groupContentErrors, FOCAL_PRESETS, isDirty, libraryImages,
} from '../../assets/js/services/content-admin-rules.js';
import { fillTokens, validateContent, resolveContent, CONTENT_KEYS } from '../../assets/js/services/content-rules.js';
import { parseCsv } from './csv-helper.mjs';

const defaults = JSON.parse(readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8'));

test('moveItem swaps neighbours without mutating, clamps at the ends', () => {
  const a = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(a, 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(a, 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(moveItem(a, 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(a, 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(a, 9, 1), ['a', 'b', 'c']);
  assert.deepEqual(a, ['a', 'b', 'c']);
});
test('removeAt', () => {
  assert.deepEqual(removeAt(['a', 'b', 'c'], 1), ['a', 'c']);
  assert.deepEqual(removeAt(['a'], 5), ['a']);
});
test('nextId is unique and valid', () => {
  assert.equal(nextId('banner', []), 'banner-1');
  assert.equal(nextId('banner', [{ id: 'banner-1' }, { id: 'banner-3' }]), 'banner-4');
  assert.equal(nextId('x', [{ id: 'x-1' }, { id: 'x-2' }]), 'x-3');
});

test('every documented token is really replaced by fillTokens', () => {
  assert.ok(TOKEN_DOCS.length >= 2);
  const settings = { freeShippingThresholdCents: 6000, storeName: 'Μαγαζί' };
  for (const t of TOKEN_DOCS) {
    assert.match(t.token, /^\{\w+\}$/);
    assert.notEqual(fillTokens(t.token, settings), t.token, t.token);
    assert.ok(t.description);
  }
  assert.equal(fillTokens('{nope}', settings), '{nope}');
});

test('toggleProductId adds, removes and caps at 6', () => {
  assert.deepEqual(toggleProductId([], 'a').ids, ['a']);
  assert.deepEqual(toggleProductId(['a', 'b'], 'a').ids, ['b']);
  const full = ['1', '2', '3', '4', '5', '6'];
  const r = toggleProductId(full, '7');
  assert.deepEqual(r.ids, full);
  assert.match(r.error, /6/);
  assert.equal(MAX_PRODUCTS_PER_POST, 6);
});
const prods = [
  { id: 'w-1', name: 'Καμπαρντίνα μαύρη', sku: 'TR-1', status: 'active' },
  { id: 'm-1', name: 'Πουκάμισο Oxford', sku: 'OX-1', status: 'active' },
  { id: 'm-2', name: 'ΠΑΛΤΟ', sku: 'PA-1', status: 'archived' },
];
test('searchProducts is accent/case insensitive and skips archived', () => {
  assert.deepEqual(searchProducts(prods, 'καμπαρντινα').map((p) => p.id), ['w-1']);
  assert.deepEqual(searchProducts(prods, 'OXFORD').map((p) => p.id), ['m-1']);
  assert.deepEqual(searchProducts(prods, 'ox-1').map((p) => p.id), ['m-1']);
  assert.deepEqual(searchProducts(prods, 'παλτο').map((p) => p.id), []);
  assert.equal(searchProducts(prods, '').length, 2);
});
test('resolveProductChips flags unknown ids', () => {
  const c = resolveProductChips(['w-1', 'gone'], prods);
  assert.equal(c[0].name, 'Καμπαρντίνα μαύρη');
  assert.equal(c[1].missing, true);
});

test('newsletter CSV: header, rows, formula injection, parseable', () => {
  const csv = newsletterToCsv([{ email: 'a@b.gr', createdAt: '2026-10-16T10:00:00.000Z' }, { email: '=cmd@x.gr', createdAt: 'x,"y"' }]);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ['email', 'createdAt']);
  assert.deepEqual(rows[1], ['a@b.gr', '2026-10-16T10:00:00.000Z']);
  assert.equal(rows[2][0], "'=cmd@x.gr");
  assert.equal(rows[2][1], 'x,"y"');
  assert.ok(csv.endsWith('\r\n'));
  assert.deepEqual(parseCsv(newsletterToCsv([])), [['email', 'createdAt']]);
  assert.equal(newsletterCsvFileName(new Date(2026, 9, 5)), 'elan-newsletter-2026-10-05.csv');
});

test('pruneEmpty drops empty strings recursively but keeps false/0/arrays', () => {
  assert.deepEqual(pruneEmpty({ a: '', b: ' x ', c: { d: '', e: false }, f: [{ g: '', h: 0 }], i: [] }), { b: ' x ', c: { e: false }, f: [{ h: 0 }], i: [] });
});
test('parseErrorPath maps validator messages to bind paths', () => {
  assert.deepEqual(parseErrorPath('banners.items[0].title: υποχρεωτικό', 'banners'), { bind: 'items.0.title', message: 'υποχρεωτικό' });
  assert.deepEqual(parseErrorPath('hero.ctaHref: ο σύνδεσμος πρέπει να ξεκινά με #/ ή https://', 'hero'), { bind: 'ctaHref', message: 'ο σύνδεσμος πρέπει να ξεκινά με #/ ή https://' });
  assert.deepEqual(parseErrorPath('footer.columns[1].links[2].href: x', 'footer'), { bind: 'columns.1.links.2.href', message: 'x' });
  assert.deepEqual(parseErrorPath('banners.items[0]: ctaLabel και ctaHref συμπληρώνονται μαζί', 'banners'), { bind: 'items.0', message: 'ctaLabel και ctaHref συμπληρώνονται μαζί' });
  const g = groupContentErrors(['hero.title: υποχρεωτικό', 'hero.ctaHref: κακό'], 'hero');
  assert.deepEqual(g.map((e) => e.bind), ['title', 'ctaHref']);
});

test('per-key reset yields exactly the seeded default for every key', () => {
  for (const key of CONTENT_KEYS) {
    const changed = { ...JSON.parse(JSON.stringify(defaults[key])), junk: true };
    const reset = resolveContent(key, undefined, defaults);
    assert.deepEqual(reset, defaults[key], key);
    assert.equal(validateContent(key, reset).ok, true, key);
    assert.equal(isDirty(reset, changed), true);
    assert.equal(isDirty(reset, JSON.parse(JSON.stringify(reset))), false);
  }
});
test('focal presets satisfy the validator', () => {
  for (const f of FOCAL_PRESETS) assert.equal(validateContent('hero', { ...defaults.hero, focal: f.value }).ok, true, f.value);
  assert.ok(FOCAL_PRESETS.some((f) => f.value === '50% 50%'));
  assert.ok(FOCAL_PRESETS.some((f) => f.value === '65% center'));
});
test('libraryImages lists only base content images from credits', () => {
  const credits = { 'assets/images/content/hero-1.webp': {}, 'assets/images/products/x-1.webp': {}, 'assets/images/content/insta-1.webp': {} };
  const l = libraryImages(credits);
  assert.deepEqual(l.map((i) => i.path), ['assets/images/content/hero-1.webp', 'assets/images/content/insta-1.webp']);
  assert.equal(l[0].sm, 'assets/images/content/hero-1-sm.webp');
});
test('content validator accepts uploaded data URLs and still rejects svg/javascript', () => {
  const ok = validateContent('hero', { ...defaults.hero, image: 'data:image/webp;base64,AAAA', imageSm: undefined });
  assert.equal(ok.ok, true, ok.errors.join('|'));
  assert.equal(validateContent('hero', { ...defaults.hero, image: 'data:image/svg+xml;base64,AAAA' }).ok, false);
  assert.equal(validateContent('hero', { ...defaults.hero, image: 'javascript:alert(1)' }).ok, false);
});
