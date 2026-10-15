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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDownloadUrl, isSafeAssetPath, isUsableFile, atomicWrite, downloadImage } from '../../tools/fetch-images.mjs';

test('manifest rejects unsafe outBase, id and url', () => {
  for (const ob of ['../x/a', '/abs/a', 'C:/a', 'assets/images/../../x', 'other/a', 'assets\\images\\a']) {
    const e = entry(); e.outBase = ob;
    assert.ok(validateManifest({ images: [e] }).some((x) => /outBase/.test(x)), ob);
  }
  const i = entry(); i.id = '../evil';
  assert.ok(validateManifest({ images: [i] }).some((x) => /id must/.test(x)));
  const h = entry(); h.downloadUrl = 'http://images.unsplash.com/a';
  assert.ok(validateManifest({ images: [h] }).some((x) => /https/.test(x)));
  const o = entry(); o.downloadUrl = 'https://evil.example/a.jpg';
  assert.ok(validateManifest({ images: [o] }).some((x) => /allowlisted/.test(x)));
  assert.equal(checkDownloadUrl('https://images.pexels.com/a.jpg'), null);
  assert.equal(isSafeAssetPath('assets/images/products/a'), true);
});
test('zero-size file counts as missing; atomicWrite cleans up and renames', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-'));
  const z = path.join(d, 'z.webp'); fs.writeFileSync(z, '');
  assert.equal(isUsableFile(z), false);
  assert.equal(isUsableFile(path.join(d, 'none')), false);
  const dest = path.join(d, 'a.webp');
  assert.throws(() => atomicWrite(dest, (t) => { fs.writeFileSync(t, 'partial'); throw new Error('boom'); }));
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(dest + '.tmp'), false);
  atomicWrite(dest, (t) => fs.writeFileSync(t, 'ok'));
  assert.equal(fs.readFileSync(dest, 'utf8'), 'ok');
  assert.equal(fs.existsSync(dest + '.tmp'), false);
  assert.throws(() => atomicWrite(dest, (t) => fs.writeFileSync(t, '')));
  fs.rmSync(d, { recursive: true });
});
test('downloadImage: redirect allowlist, size cap, manual redirects + timeout signal', async () => {
  const hdr = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
  const redirectEvil = async () => ({ status: 302, ok: false, headers: hdr({ location: 'https://evil.example/x' }) });
  await assert.rejects(downloadImage('https://images.unsplash.com/a', { fetchImpl: redirectEvil }), /blocked/);
  const big = async () => ({ status: 200, ok: true, headers: hdr({ 'content-type': 'image/jpeg', 'content-length': '999999999' }) });
  await assert.rejects(downloadImage('https://images.unsplash.com/a', { fetchImpl: big }), /too large/);
  let calls = 0;
  const hop = async (u, o) => {
    assert.equal(o.redirect, 'manual'); assert.ok(o.signal);
    return calls++ === 0
      ? { status: 301, ok: false, headers: hdr({ location: 'https://images.pexels.com/b' }) }
      : { status: 200, ok: true, headers: hdr({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  assert.equal((await downloadImage('https://images.unsplash.com/a', { fetchImpl: hop })).length, 3);
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('CLI backfills credits when outputs exist; --only without value errors (no network)', () => {
  const cli = fileURLToPath(new URL('../../tools/fetch-images.mjs', import.meta.url));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-cli-'));
  const e = entry();
  const m = path.join(d, 'm.json');
  fs.writeFileSync(m, JSON.stringify({ images: [e] }));
  fs.mkdirSync(path.join(d, 'assets/images/products'), { recursive: true });
  fs.writeFileSync(path.join(d, 'assets/images/products/dress-1.webp'), 'x');
  fs.writeFileSync(path.join(d, 'assets/images/products/dress-1-sm.webp'), 'x');
  const r = spawnSync(process.execPath, [cli, '--manifest', m, '--out-root', d], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const credits = JSON.parse(fs.readFileSync(path.join(d, 'assets/images/credits.json'), 'utf8'));
  assert.equal(credits['assets/images/products/dress-1.webp'].id, 'a');
  const r2 = spawnSync(process.execPath, [cli, '--manifest', m, '--out-root', d, '--only'], { encoding: 'utf8' });
  assert.notEqual(r2.status, 0);
  fs.rmSync(d, { recursive: true });
});
