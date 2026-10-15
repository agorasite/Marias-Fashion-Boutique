#!/usr/bin/env node
/**
 * Seed validator for data/products.json.
 *
 * Usage: node tools/validate-seed.mjs [data/products.json]   (exit 1 on errors)
 *
 * Canonical product shape (ruling):
 *   {id, slug, name, brand, categoryId, subcategoryId, description,
 *    priceCents (int>0), compareAtCents? (int > priceCents),
 *    images:[path,...]  (relative, e.g. assets/images/products/<slug>-1.webp),
 *    attributes:{material,care,fit?...},
 *    flags:{featured:bool,new:bool,bestSeller:bool},
 *    popularity:int, createdAt: ISO string, status:'active'|'archived',
 *    variants:[{sku,size,color,colorHex,stock:int>=0}]}
 * credits.json (assets/images/credits.json) is keyed by image path with
 *   {photographer, sourceUrl, license, retrievedAt, source:'unsplash'|'pexels'}.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isInt = (n) => Number.isInteger(n);
const isStr = (s) => typeof s === 'string' && s.trim() !== '';

export function validateSeed(doc, categories, { rootDir = null, credits = {}, minProducts = 36 } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);
  const products = doc && Array.isArray(doc.products) ? doc.products : null;
  if (!products) return { ok: false, errors: ['products array missing'] };
  if (products.length < minProducts) err(`only ${products.length} products; minimum is ${minProducts}`);
  const catById = new Map((categories || []).map((c) => [c.id, c]));
  const ids = new Set(), slugs = new Set(), skus = new Set(), imageOwner = new Map();
  credits = credits || {};

  products.forEach((p, idx) => {
    const L = `product[${idx}] ${p && p.id ? p.id : '?'}`;
    if (!p || typeof p !== 'object') return err(`${L}: not an object`);
    for (const f of ['id', 'slug', 'name', 'brand', 'categoryId', 'subcategoryId', 'description', 'createdAt']) {
      if (!isStr(p[f])) err(`${L}: missing or empty required field ${f}`);
    }
    if (isStr(p.id)) { if (ids.has(p.id)) err(`${L}: duplicate id ${p.id}`); ids.add(p.id); }
    if (isStr(p.slug)) { if (slugs.has(p.slug)) err(`${L}: duplicate slug ${p.slug}`); slugs.add(p.slug); }
    if (!isInt(p.priceCents) || p.priceCents <= 0) err(`${L}: priceCents must be an integer > 0`);
    if (p.compareAtCents !== undefined && p.compareAtCents !== null) {
      if (!isInt(p.compareAtCents) || !isInt(p.priceCents) || p.compareAtCents <= p.priceCents) {
        err(`${L}: compareAtCents must be an integer > priceCents`);
      }
    }
    if (!isInt(p.popularity)) err(`${L}: popularity must be an integer`);
    if (p.createdAt && Number.isNaN(Date.parse(p.createdAt))) err(`${L}: createdAt is not a valid date`);
    if (!['active', 'archived'].includes(p.status)) err(`${L}: status must be active|archived`);
    if (!p.attributes || typeof p.attributes !== 'object') err(`${L}: attributes missing`);
    else for (const f of ['material', 'care']) if (!isStr(p.attributes[f])) err(`${L}: attributes.${f} missing`);
    if (!p.flags || typeof p.flags !== 'object') err(`${L}: flags missing`);
    else for (const f of ['featured', 'new', 'bestSeller']) if (typeof p.flags[f] !== 'boolean') err(`${L}: flags.${f} must be boolean`);

    const cat = catById.get(p.categoryId);
    if (isStr(p.categoryId) && !cat) err(`${L}: categoryId ${p.categoryId} not in categories`);
    const sub = catById.get(p.subcategoryId);
    if (isStr(p.subcategoryId)) {
      if (!sub) err(`${L}: subcategoryId ${p.subcategoryId} not in categories`);
      else if (sub.parentId !== p.categoryId) err(`${L}: subcategoryId ${p.subcategoryId} parent is ${sub.parentId}, not categoryId ${p.categoryId}`);
    }

    if (!Array.isArray(p.images) || p.images.length === 0) err(`${L}: product has no images`);
    else p.images.forEach((im) => {
      if (!isStr(im)) return err(`${L}: invalid image path`);
      if (/^([a-zA-Z]:|[\\/])/.test(im) || im.includes('\\') || im.split('/').includes('..')) return err(`${L}: image path must be relative with no ..: ${im}`);
      const owner = imageOwner.get(im);
      if (owner && owner !== p.id) err(`${L}: image ${im} is reused by more than one product (also ${owner})`);
      else imageOwner.set(im, p.id);
      if (rootDir && !fs.existsSync(path.join(rootDir, im))) err(`${L}: image file does not exist: ${im}`);
      const c = credits[im];
      if (!c) err(`${L}: image ${im} has no credits entry`);
      else {
        for (const f of ['photographer', 'sourceUrl', 'license', 'retrievedAt']) {
          if (!isStr(c[f])) err(`${L}: credits for ${im} missing ${f}`);
        }
        if (!['unsplash', 'pexels'].includes(c.source)) err(`${L}: credits for ${im} has invalid source ${c.source}`);
      }
    });

    if (!Array.isArray(p.variants) || p.variants.length === 0) err(`${L}: variants must be non-empty`);
    else p.variants.forEach((v, vi) => {
      const VL = `${L} variant[${vi}]`;
      for (const f of ['sku', 'size', 'color', 'colorHex']) if (!isStr(v && v[f])) err(`${VL}: missing ${f}`);
      if (!v || !isInt(v.stock) || v.stock < 0) err(`${VL}: stock must be an integer >= 0`);
      if (v && isStr(v.sku)) { if (skus.has(v.sku)) err(`${VL}: duplicate sku ${v.sku}`); skus.add(v.sku); }
    });
  });
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.resolve(process.argv[2] || path.join(root, 'data/products.json'));
  const read = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
  const doc = read(file, null);
  if (!doc) { console.error(`cannot read ${file}`); process.exit(1); }
  const meta = read(path.join(root, 'data/catalog-meta.json'), { categories: [] });
  const credits = read(path.join(root, 'assets/images/credits.json'), {});
  const r = validateSeed(doc, meta.categories, { rootDir: root, credits });
  if (!r.ok) { r.errors.forEach((e) => console.error('ERROR ' + e)); console.error(`${r.errors.length} error(s)`); process.exit(1); }
  console.log(`OK: ${doc.products.length} products valid`);
}
