#!/usr/bin/env node
/**
 * Manifest-driven image fetch + convert.
 *
 * Usage (from repo root):
 *   node tools/fetch-images.mjs [--only <id>] [--dry-run] [--manifest <file>] [--out-root <dir>]
 *
 * Reads tools/image-manifest.json, downloads each downloadUrl to tools/.cache,
 * converts with cwebp to <outBase>.webp (long edge 1200, or the entry's optional
 * integer maxEdge in 480..4000, q80) and
 * <outBase>-sm.webp (long edge 480, q75), and merges assets/images/credits.json.
 * Existing outputs are skipped. Needs `cwebp` on PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCES = { unsplash: 'Unsplash License', pexels: 'Pexels License' };
const USAGES = ['product', 'hero', 'banner', 'instagram'];

export const ALLOWED_HOSTS = ['images.unsplash.com', 'images.pexels.com'];
export const MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;
export const DEFAULT_MAX_EDGE = 1200;

/** Long edge for the full-size output: entry.maxEdge when set, else 1200. */
export function fullEdge(entry) {
  return entry.maxEdge ?? DEFAULT_MAX_EDGE;
}

/** true when p is a relative, forward-slash path under prefix with no .. segments. */
export function isSafeAssetPath(p, prefix = '') {
  if (typeof p !== 'string' || !p.startsWith(prefix)) return false;
  if (/^([a-zA-Z]:|[\\/])/.test(p) || p.includes('\\')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '');
}

/** Returns an error string, or null when the URL is https on an allowlisted host. */
export function checkDownloadUrl(u) {
  let url;
  try { url = new URL(u); } catch { return 'is not a valid URL'; }
  if (url.protocol !== 'https:') return 'must use https';
  if (!ALLOWED_HOSTS.includes(url.hostname)) return `host ${url.hostname} is not allowlisted`;
  return null;
}

/** An output counts as present only if it exists and is non-empty. */
export function isUsableFile(f) {
  try { return fs.statSync(f).size > 0; } catch { return false; }
}

/** Write via dest.tmp then rename; the temp file is removed on failure. */
export function atomicWrite(dest, writeFn) {
  const tmp = dest + '.tmp';
  try {
    fs.rmSync(tmp, { force: true });
    writeFn(tmp);
    if (!isUsableFile(tmp)) throw new Error(`empty output for ${dest}`);
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Download with https+allowlist on every redirect hop, timeout and byte cap. */
export async function downloadImage(url, { fetchImpl = fetch, timeoutMs = 30000, maxBytes = MAX_BYTES } = {}) {
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const bad = checkDownloadUrl(cur);
    if (bad) throw new Error(`blocked url ${cur}: ${bad}`);
    const res = await fetchImpl(cur, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      cur = new URL(res.headers.get('location'), cur).href;
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`download failed (${res.status} ${type})`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error(`file too large (${len} bytes)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`file too large (${buf.length} bytes)`);
    return buf;
  }
  throw new Error('too many redirects');
}

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
    if (e && 'maxEdge' in e && !(Number.isInteger(e.maxEdge) && e.maxEdge >= 480 && e.maxEdge <= 4000)) errors.push(`${L}: maxEdge must be an integer 480..4000`);
    if (e?.usage && !USAGES.includes(e.usage)) errors.push(`${L}: invalid usage ${e.usage}`);
    if (typeof e?.id === 'string' && !/^[\w-]+$/.test(e.id)) errors.push(`${L}: id must match [\w-]+`);
    if (typeof e?.outBase === 'string' && !isSafeAssetPath(e.outBase, 'assets/images/')) errors.push(`${L}: outBase must be relative under assets/images/ with no ..`);
    if (typeof e?.downloadUrl === 'string') { const u = checkDownloadUrl(e.downloadUrl); if (u) errors.push(`${L}: downloadUrl ${u}`); }
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
  atomicWrite(dest, (tmp) => {
    const res = spawnSync('cwebp', [...args, src, '-o', tmp], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`cwebp failed: ${res.stderr || res.error}`);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const manifestPath = path.resolve(opt('--manifest') || path.join(here, 'image-manifest.json'));
  const outRoot = path.resolve(opt('--out-root') || root);
  if (argv.includes('--only') && (!opt('--only') || opt('--only').startsWith('--'))) { console.error('--only requires an id'); process.exit(1); }
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
    if (isUsableFile(fullAbs) && isUsableFile(smallAbs)) {
      if (!credits[full] && !dry) {
        credits = mergeCredits(credits, e, today);
        fs.mkdirSync(path.dirname(creditsPath), { recursive: true });
        fs.writeFileSync(creditsPath, JSON.stringify(credits, null, 2) + '\n');
        console.log(`backfilled credits for ${e.id}`);
      } else console.log(`skip ${e.id} (exists)`);
      continue;
    }
    if (dry) { console.log(`dry-run ${e.id}: ${e.downloadUrl} -> ${full}, ${small}`); continue; }
    fs.mkdirSync(cache, { recursive: true });
    fs.mkdirSync(path.dirname(fullAbs), { recursive: true });
    const buf = await downloadImage(e.downloadUrl).catch((err) => { throw new Error(`${e.id}: ${err.message}`); });
    const orig = path.join(cache, `${e.id}.orig`);
    fs.writeFileSync(orig, buf);
    const size = imageSize(buf);
    if (!size) throw new Error(`${e.id}: unrecognised image format`);
    convert(orig, fullAbs, size, fullEdge(e), 80);
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
