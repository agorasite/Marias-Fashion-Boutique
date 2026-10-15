import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, outputPaths, mergeCredits, fitSize } from '../../tools/fetch-images.mjs';

const entry = () => ({
  id: 'a', source: 'unsplash', pageUrl: 'https://unsplash.com/photos/a', downloadUrl: 'https://images.unsplash.com/a',
  photographer: 'P', photographerUrl: 'https://unsplash.com/@p', license: 'Unsplash License',
  licenseUrl: 'https://unsplash.com/license', alt: 'Φόρεμα', usage: 'product', outBase: 'assets/images/products/dress-1',
});

test('valid manifest', () => assert.deepEqual(validateManifest({ images: [entry()] }), []));
test('manifest errors', () => {
  assert.ok(validateManifest({}).length);
  const e = entry(); delete e.alt;
  assert.ok(validateManifest({ images: [e] }).some((x) => /alt/.test(x)));
  const b = entry(); b.source = 'flickr';
  assert.ok(validateManifest({ images: [b] }).some((x) => /source/.test(x)));
  const l = entry(); l.license = 'Pexels License';
  assert.ok(validateManifest({ images: [l] }).some((x) => /license/.test(x)));
  assert.ok(validateManifest({ images: [entry(), entry()] }).some((x) => /duplicate/i.test(x)));
  const u = entry(); u.usage = 'x';
  assert.ok(validateManifest({ images: [u] }).some((x) => /usage/.test(x)));
});
test('outputPaths', () => {
  assert.deepEqual(outputPaths('assets/images/products/dress-1'), {
    full: 'assets/images/products/dress-1.webp', small: 'assets/images/products/dress-1-sm.webp',
  });
});
test('mergeCredits adds and updates, keeps others', () => {
  const existing = { 'a.webp': { id: 'old' }, 'z.webp': { id: 'z' } };
  const out = mergeCredits(existing, entry(), '2026-10-16');
  assert.equal(out['z.webp'].id, 'z');
  const c = out['assets/images/products/dress-1.webp'];
  assert.equal(c.id, 'a'); assert.equal(c.retrievedAt, '2026-10-16'); assert.equal(c.photographer, 'P');
  assert.equal(c.sourceUrl, c.pageUrl);
  assert.equal(existing['a.webp'].id, 'old');
});
test('fitSize constrains long edge, never upscales', () => {
  assert.deepEqual(fitSize(4000, 2000, 1200), { w: 1200, h: 0 });
  assert.deepEqual(fitSize(2000, 4000, 1200), { w: 0, h: 1200 });
  assert.deepEqual(fitSize(800, 600, 1200), null);
});
