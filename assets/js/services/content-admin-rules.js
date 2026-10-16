// Pure helpers for the admin content editor (no DB, no DOM). Importable in Node.
import { csvCell, csvDocument, fold } from './order-rules.js';

export const MAX_PRODUCTS_PER_POST = 6;
export const LIBRARY_PREFIX = 'assets/images/content/';

/** Placeholders understood by fillTokens() (services/content-rules.js) on the storefront. */
export const TOKEN_DOCS = [
  { token: '{freeShipping}', description: 'Το όριο δωρεάν αποστολής από τις Ρυθμίσεις (π.χ. 60,00 €).' },
  { token: '{storeName}', description: 'Η επωνυμία του καταστήματος από τις Ρυθμίσεις.' },
];

/** Focal point of the hero photo (CSS object-position, validated by the content rules). */
export const FOCAL_PRESETS = [
  { value: '50% 50%', label: 'Κέντρο' },
  { value: '65% center', label: 'Δεξιά του κέντρου (προεπιλογή)' },
  { value: '35% center', label: 'Αριστερά του κέντρου' },
  { value: 'left center', label: 'Αριστερά' },
  { value: 'right center', label: 'Δεξιά' },
  { value: '50% top', label: 'Επάνω' },
  { value: '50% bottom', label: 'Κάτω' },
];

// ---------------------------------------------------------------- lists
/** New array with item `idx` moved by `dir` (-1 up / +1 down). Out-of-range moves return a copy. */
export function moveItem(list, idx, dir) {
  const a = [...(list || [])];
  const to = idx + dir;
  if (!(idx >= 0 && idx < a.length) || to < 0 || to >= a.length) return a;
  [a[idx], a[to]] = [a[to], a[idx]];
  return a;
}

export function removeAt(list, idx) {
  const a = [...(list || [])];
  if (idx >= 0 && idx < a.length) a.splice(idx, 1);
  return a;
}

/** Next unused «prefix-N» id for a list of { id } items. */
export function nextId(prefix, items) {
  let n = 0;
  for (const it of items || []) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(it && it.id));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${prefix}-${n + 1}`;
}

export const isDirty = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

/** Deep copy without empty-string values (optional fields left blank in the form). */
export function pruneEmpty(v) {
  if (Array.isArray(v)) return v.map(pruneEmpty);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === '') continue;
      out[k] = pruneEmpty(x);
    }
    return out;
  }
  return v;
}

// ---------------------------------------------------------------- errors
/** «banners.items[0].title: υποχρεωτικό» → { bind: 'items.0.title', message: 'υποχρεωτικό' } (key prefix removed). */
export function parseErrorPath(error, key) {
  const s = String(error);
  const i = s.indexOf(': ');
  const path = i >= 0 ? s.slice(0, i) : '';
  const message = i >= 0 ? s.slice(i + 2) : s;
  let bind = path.replace(/\[(\d+)\]/g, '.$1');
  if (bind === key) bind = '';
  else if (bind.startsWith(`${key}.`)) bind = bind.slice(key.length + 1);
  return { bind, message };
}

export const groupContentErrors = (errors, key) => (errors || []).map((e) => parseErrorPath(e, key));

// ---------------------------------------------------------------- instagram product picker
export function toggleProductId(ids, id, max = MAX_PRODUCTS_PER_POST) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.includes(id)) return { ids: list.filter((x) => x !== id) };
  if (list.length >= max) return { ids: [...list], error: `Μέχρι ${max} προϊόντα ανά ανάρτηση.` };
  return { ids: [...list, id] };
}

/** Active (non-archived) products matching the query on name, id, slug or SKU; empty query lists all. */
export function searchProducts(products, query, limit = 24) {
  const q = fold(query);
  return (products || [])
    .filter((p) => p && p.status !== 'archived')
    .filter((p) => !q || [p.name, p.id, p.slug, p.sku, p.brand].some((x) => fold(x).includes(q)))
    .slice(0, limit);
}

/** Selected ids → chips with name/thumbnail; ids no longer in the catalogue are flagged `missing`. */
export function resolveProductChips(ids, products) {
  const byId = new Map((products || []).map((p) => [p.id, p]));
  return (ids || []).map((id) => {
    const p = byId.get(id);
    return p ? { id, name: p.name, image: p.images?.[0] || '', missing: false } : { id, name: id, image: '', missing: true };
  });
}

// ---------------------------------------------------------------- image library
/** Editorial images available in the picker: base files in credits.json under assets/images/content/. */
export function libraryImages(credits) {
  return Object.keys(credits || {})
    .filter((k) => k.startsWith(LIBRARY_PREFIX) && !/-sm\.webp$/.test(k))
    .map((path) => ({ path, sm: path.replace(/\.webp$/, '-sm.webp'), name: path.slice(LIBRARY_PREFIX.length) }));
}

// ---------------------------------------------------------------- newsletter CSV
export function newsletterToCsv(list) {
  const lines = [['email', 'createdAt'].map(csvCell).join(',')];
  for (const s of list || []) lines.push([csvCell(s.email), csvCell(s.createdAt || '')].join(','));
  return csvDocument(lines);
}

export function newsletterCsvFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `elan-newsletter-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
