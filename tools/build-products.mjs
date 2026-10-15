#!/usr/bin/env node
// Concatenates tools/seed-parts/*.json into data/products.json (fails on id/slug/SKU collisions).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['women', 'men', 'shoes', 'accessories'];
const products = [];
for (const part of ORDER) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'tools/seed-parts', `${part}.json`), 'utf8'));
  products.push(...(Array.isArray(doc) ? doc : doc.products));
}
const seen = { id: new Set(), slug: new Set(), sku: new Set() };
const errors = [];
const take = (kind, v, who) => { if (seen[kind].has(v)) errors.push(`duplicate ${kind} ${v} (${who})`); seen[kind].add(v); };
for (const p of products) {
  take('id', p.id, p.id);
  take('slug', p.slug, p.id);
  (p.variants || []).forEach((v) => take('sku', v.sku, p.id));
}
if (errors.length) { errors.forEach((e) => console.error('ERROR ' + e)); process.exit(1); }
fs.writeFileSync(path.join(root, 'data/products.json'), JSON.stringify({ products }, null, 2) + '\n');
console.log(`wrote data/products.json: ${products.length} products`);
