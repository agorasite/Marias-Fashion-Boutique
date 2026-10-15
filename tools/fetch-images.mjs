#!/usr/bin/env node
/**
 * Manifest-driven image fetch + convert.
 *
 * Usage (from repo root):
 *   node tools/fetch-images.mjs [--only <id>] [--dry-run] [--manifest <file>] [--out-root <dir>]
 *
 * Reads tools/image-manifest.json, downloads each downloadUrl to tools/.cache,
 * converts with cwebp to <outBase>.webp (long edge 1200, q80) and
 * <outBase>-sm.webp (long edge 480, q75), and merges assets/images/credits.json.
 * Existing outputs are skipped. Needs `cwebp` on PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCES = { unsplash: 'Unsplash License', pexels: 'Pexels License' };
const USAGES = ['product', 'hero', 'banner', 'instagram'];

export function validateManifest(m) {
  const errors = [];
  if (!m || !Array.isArray(m.images)) return ['manifest.images must be an array'];
  const seen = new Set(), bases = new Set();
  m.images.forEach((e, i) => {
    const L = `images[${i}] ${e && e.id ? e.id : '?'}`;
    for (const f of ['id', 'source', 'pageUrl', 'downloadUrl', 'photographer', 'photographerUrl', 'license', 'licenseUrl', 'alt', 'usage', 'outBase']) {
      if (typeof e?.[f] !== 'string' || !e[f].trim()) errors.push(`${L}: missing ${f}`);
    }
    if (e?.source && !SOURCES[e.source]) errors.push(`${L}: invalid source ${e.source}`);
    else if (e?.license && e.license !== SOURCES[e.source]) errors.push(`${L}: license ${e.license} does not match source ${e.source}`);
    if (e?.usage && !USAGES.includes(e.usage)) errors.push(`${L}: invalid usage ${e.usage}`);
    if (e?.id) { if (seen.has(e.id)) errors.push(`${L}: duplicate id`); seen.add(e.id); }
    if (e?.outBase) { if (bases.has(e.outBase)) errors.push(`${L}: duplicate outBase`); bases.add(e.outBase); }
  });
  return errors;
}

export function outputPaths(outBase) {
  return { full: `${outBase}.webp`, small: `${outBase}-sm.webp` };
}

export function mergeCredits(existing, entry, retrievedAt) {
  const { full } = outputPaths(entry.outBase);
  return {
    ...existing,
    [full]: {
      id: entry.id, source: entry.source, pageUrl: entry.pageUrl, sourceUrl: entry.pageUrl,
      photographer: entry.photographer, photographerUrl: entry.photographerUrl,
      license: entry.license, licenseUrl: entry.licenseUrl, alt: entry.alt, retrievedAt,
    },
  };
}

/** cwebp -resize args constraining the long edge; null when source already fits (no upscale). */
export function fitSize(w, h, long) {
  if (Math.max(w, h) <= long) return null;
  return w >= h ? { w: long, h: 0 } : { w: 0, h: long };
}

/** Read width/height from a JPEG, PNG or WebP buffer. */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const t = buf.toString('latin1', 12, 16);
    if (t === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (t === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

function convert(src, dest, size, long, q) {
  const r = fitSize(size.w, size.h, long);
  const args = ['-quiet', '-q', String(q), '-m', '6'];
  if (r) args.push('-resize', String(r.w), String(r.h));
  args.push(src, '-o', dest);
  const res = spawnSync('cwebp', args, { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`cwebp failed: ${res.stderr || res.error}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const manifestPath = path.resolve(opt('--manifest') || path.join(here, 'image-manifest.json'));
  const outRoot = path.resolve(opt('--out-root') || root);
  const only = opt('--only'), dry = argv.includes('--dry-run');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errs = validateManifest(manifest);
  if (errs.length) { errs.forEach((e) => console.error('ERROR ' + e)); process.exit(1); }
  const entries = manifest.images.filter((e) => !only || e.id === only);
  if (only && !entries.length) { console.error(`no manifest entry with id ${only}`); process.exit(1); }
  const cache = path.join(here, '.cache');
  const creditsPath = path.join(outRoot, 'assets/images/credits.json');
  let credits = fs.existsSync(creditsPath) ? JSON.parse(fs.readFileSync(creditsPath, 'utf8')) : {};
  const today = new Date().toISOString().slice(0, 10);
  for (const e of entries) {
    const { full, small } = outputPaths(e.outBase);
    const fullAbs = path.join(outRoot, full), smallAbs = path.join(outRoot, small);
    if (fs.existsSync(fullAbs) && fs.existsSync(smallAbs)) { console.log(`skip ${e.id} (exists)`); continue; }
    if (dry) { console.log(`dry-run ${e.id}: ${e.downloadUrl} -> ${full}, ${small}`); continue; }
    fs.mkdirSync(cache, { recursive: true });
    fs.mkdirSync(path.dirname(fullAbs), { recursive: true });
    const res = await fetch(e.downloadUrl, { redirect: 'follow' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`${e.id}: download failed (${res.status} ${type})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const orig = path.join(cache, `${e.id}.orig`);
    fs.writeFileSync(orig, buf);
    const size = imageSize(buf);
    if (!size) throw new Error(`${e.id}: unrecognised image format`);
    convert(orig, fullAbs, size, 1200, 80);
    convert(orig, smallAbs, size, 480, 75);
    credits = mergeCredits(credits, e, today);
    fs.mkdirSync(path.dirname(creditsPath), { recursive: true });
    fs.writeFileSync(creditsPath, JSON.stringify(credits, null, 2) + '\n');
    console.log(`ok ${e.id} ${size.w}x${size.h} -> ${full}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
