// Pure admin product rules (no DB, no DOM): validation, price/slug/SKU helpers, variant matrix
// generation and the admin list filter. Importable in Node; re-exported by services/product-admin.js.
import { normalizeText, compareSizes, LOW_STOCK_TOTAL } from './products.js';

// ---------------------------------------------------------------------------------- transliteration

const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const VOICED_OR_VOWEL = new Set([...'βγδζλμνραεηιουω']);

/** Greek (ELOT-style) → Latin, lower case. Other characters are kept (accents stripped). */
export function transliterate(input) {
  const s = String(input ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    const n = s[i + 1];
    if (c === 'ο' && n === 'υ') { out += 'ou'; i += 1; continue; }
    if ((c === 'α' || c === 'ε' || c === 'η') && n === 'υ') {
      const after = s[i + 2];
      const voiced = after === undefined ? true : VOICED_OR_VOWEL.has(after) || !/[α-ω]/.test(after);
      out += `${GREEK[c]}${voiced ? 'v' : 'f'}`;
      i += 1;
      continue;
    }
    if (c === 'γ' && n === 'γ') { out += 'ng'; i += 1; continue; }
    if (c === 'μ' && n === 'π') { out += 'b'; i += 1; continue; }
    out += GREEK[c] ?? c;
  }
  return out;
}

/** URL slug: lower-case ASCII letters/digits separated by single hyphens. */
export const slugify = (input) => transliterate(input).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidHex = (h) => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h);

// ---------------------------------------------------------------------------------- money

/**
 * Euros typed by an admin («59,90», «59.9», «1.234,56», «12 €», 19.99) → integer cents.
 * Returns null for empty, negative, NaN, non-numeric or more than two decimals.
 */
export function eurosToCents(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number' && !Number.isFinite(input)) return null;
  let s = String(input).replace(/[€\s ]/g, '');
  if (!s || s.startsWith('-') || s.startsWith('+')) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    if (s.split(decimalSep).length > 2) return null;
    s = s.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    if (s.split(',').length > 2) return null;
    s = s.replace(',', '.');
  } else if (s.split('.').length > 2) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Integer cents → plain decimal string with a dot («59.90»); '' when not a number. */
export function centsToEuros(cents) {
  if (cents === null || cents === undefined || cents === '' || !Number.isFinite(Number(cents))) return '';
  const n = Math.round(Number(cents));
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * Form → stored prices. «Τιμή» is the regular price; «Τιμή προσφοράς» is optional. With a sale price,
 * priceCents = sale price and compareAtCents = regular price (the storefront shows compareAt struck through);
 * without it priceCents = regular price and compareAtCents is absent.
 */
export function pricingFromForm({ price, salePrice }) {
  const errors = {};
  const regular = eurosToCents(price);
  if (regular === null) errors.price = String(price ?? '').trim() ? 'Μη έγκυρη τιμή (π.χ. 59,90).' : 'Συμπληρώστε την τιμή.';
  const hasSale = String(salePrice ?? '').trim() !== '';
  const sale = hasSale ? eurosToCents(salePrice) : null;
  if (hasSale && sale === null) errors.salePrice = 'Μη έγκυρη τιμή προσφοράς (π.χ. 49,90).';
  if (hasSale && sale !== null) return { priceCents: regular === null ? null : sale, compareAtCents: regular, errors };
  return { priceCents: regular, compareAtCents: undefined, errors };
}

/** Stored prices → form strings (inverse of pricingFromForm). */
export function pricingToForm(p) {
  if (p && p.compareAtCents > p.priceCents) return { price: centsToEuros(p.compareAtCents), salePrice: centsToEuros(p.priceCents) };
  return { price: centsToEuros(p && p.priceCents), salePrice: '' };
}

export function discountPercent(priceCents, compareAtCents) {
  if (!(compareAtCents > priceCents) || !(priceCents >= 0)) return 0;
  return Math.round((1 - priceCents / compareAtCents) * 100);
}

// ---------------------------------------------------------------------------------- SKUs & matrix

export const SIZE_PRESETS = {
  clothing: ['XS', 'S', 'M', 'L', 'XL'],
  shoes: Array.from({ length: 11 }, (_, i) => String(36 + i)),
  one: ['ONE'],
};

const upperAlnum = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** `<slug prefix>-<SIZE>-<COLOR>` made unique against `taken` (a Set of SKUs) with a numeric suffix. */
export function generateSku(slug, size, color, taken = new Set()) {
  const words = String(slug || 'item').split('-').filter(Boolean);
  const prefix = (words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 6) : (words[0] || 'item').slice(0, 4)).toUpperCase();
  const sz = upperAlnum(size) || 'X';
  const col = upperAlnum(slugify(color)).slice(0, 3) || 'X';
  const base = `${prefix}-${sz}-${col}`;
  let sku = base;
  for (let n = 2; taken.has(sku); n += 1) sku = `${base}-${n}`;
  return sku;
}

const comboKey = (size, color) => `${String(size ?? '').trim().toUpperCase()}|${normalizeText(color)}`;

/**
 * Sizes × colours → variant rows. Existing rows are kept untouched (SKU and stock preserved); missing
 * combinations are appended with a unique generated SKU and `stock`.
 */
export function generateVariantMatrix({ sizes = [], colors = [], slug = '', stock = 0, existing = [] }) {
  const rows = existing.map((v) => ({ ...v }));
  const have = new Set(rows.map((v) => comboKey(v.size, v.color)));
  const taken = new Set(rows.map((v) => v.sku).filter(Boolean));
  for (const size of sizes) {
    for (const c of colors) {
      const k = comboKey(size, c.name);
      if (have.has(k)) continue;
      have.add(k);
      const sku = generateSku(slug, size, c.name, taken);
      taken.add(sku);
      rows.push({ sku, size: String(size), color: String(c.name).trim(), colorHex: c.hex, stock: Math.max(0, Math.floor(Number(stock) || 0)) });
    }
  }
  return rows;
}

export const withoutArchived = (variants) => (variants || []).filter((v) => !v.archived);

// ---------------------------------------------------------------------------------- images

export const MAX_IMAGES = 10;
export const MAX_DATA_URL_CHARS = 2.5 * 1024 * 1024;
const DATA_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const REL_RE = /^assets\/[^\s"'<>\\]+$/;
const HTTP_RE = /^https?:\/\/[^\s"'<>\\]+$/;

/** Greek error for one image reference, or '' when it is allowed (relative assets/ path, http(s) URL, raster data URL). */
export function imageSourceError(src) {
  const s = String(src ?? '');
  if (s.startsWith('data:')) {
    if (!DATA_RE.test(s)) return 'Μη αποδεκτή εικόνα: επιτρέπονται μόνο WebP, JPEG και PNG.';
    if (s.length > MAX_DATA_URL_CHARS) return 'Η εικόνα είναι πολύ μεγάλη (έως περίπου 2,5 MB μετά τη μετατροπή).';
    return '';
  }
  if (REL_RE.test(s)) return s.split('/').includes('..') ? 'Η διαδρομή εικόνας δεν επιτρέπεται να περιέχει «..».' : '';
  if (HTTP_RE.test(s)) return '';
  return 'Μη έγκυρη διεύθυνση εικόνας: χρησιμοποιήστε διαδρομή assets/…, διεύθυνση http(s):// ή τοπικό αρχείο.';
}

// ---------------------------------------------------------------------------------- normalise + validate

const str = (v) => String(v ?? '').trim();

function skuSet(existingSkus, editingId) {
  const out = new Set();
  for (const e of existingSkus || []) {
    if (e && typeof e === 'object') { if (!editingId || e.productId !== editingId) out.add(e.sku); } else out.add(e);
  }
  return out;
}

const parseStock = (v) => {
  if (typeof v === 'number') return v;
  const s = str(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
};

/** Trim everything, derive the slug and missing SKUs. Does not validate. */
export function normalizeProductInput(input, { existingSkus = [], editingId = null } = {}) {
  const i = input || {};
  const name = str(i.name);
  const slug = str(i.slug) || slugify(name);
  const taken = skuSet(existingSkus, editingId);
  const rawVariants = Array.isArray(i.variants) ? i.variants : [];
  rawVariants.forEach((v) => { if (str(v && v.sku)) taken.add(str(v.sku)); });
  const variants = rawVariants.map((v) => {
    const size = str(v && v.size);
    const color = str(v && v.color);
    let sku = str(v && v.sku);
    if (!sku && size && color) { sku = generateSku(slug, size, color, taken); taken.add(sku); }
    const { archived, ...rest } = v || {};
    return { ...rest, sku, size, color, colorHex: str(v && v.colorHex).toLowerCase(), stock: parseStock(v && v.stock) };
  });
  const attrs = i.attributes || {};
  const flags = i.flags || {};
  const out = {
    ...i,
    name,
    slug,
    brand: str(i.brand),
    categoryId: str(i.categoryId),
    subcategoryId: str(i.subcategoryId),
    description: str(i.description),
    images: (Array.isArray(i.images) ? i.images : []).map(str).filter(Boolean),
    attributes: { ...attrs, material: str(attrs.material), care: str(attrs.care), fit: str(attrs.fit) },
    flags: { featured: !!flags.featured, new: !!flags.new, bestSeller: !!flags.bestSeller },
    status: i.status === 'archived' ? 'archived' : 'active',
    variants,
  };
  if (i.compareAtCents === null || i.compareAtCents === undefined || i.compareAtCents === '') delete out.compareAtCents;
  return out;
}

const isInt = (n) => Number.isInteger(n);

/**
 * @returns {{ok:boolean, errors:Object<string,string>, value:object}} errors keyed by field or
 *   `variants[i].field`; `value` is the normalised input (slug and SKUs filled in).
 */
export function validateProductInput(input, { existingProducts = [], existingSkus = [], categories = [], editingId = null } = {}) {
  const value = normalizeProductInput(input, { existingSkus, editingId });
  const errors = {};

  if (value.name.length < 2) errors.name = 'Το όνομα πρέπει να έχει τουλάχιστον 2 χαρακτήρες.';

  if (!value.slug) errors.slug = 'Δεν είναι δυνατή η δημιουργία slug από το όνομα· συμπληρώστε το χειροκίνητα.';
  else if (!SLUG_RE.test(value.slug)) errors.slug = 'Το slug επιτρέπει μόνο μικρά λατινικά γράμματα, αριθμούς και παύλες (π.χ. mavro-forema).';
  else if ((existingProducts || []).some((p) => p.id !== editingId && p.slug === value.slug)) errors.slug = 'Υπάρχει ήδη προϊόν με αυτό το slug.';

  if (!value.brand) errors.brand = 'Συμπληρώστε το brand.';

  const cat = (categories || []).find((c) => c.id === value.categoryId);
  if (!value.categoryId) errors.categoryId = 'Επιλέξτε κατηγορία.';
  else if (!cat || cat.parentId) errors.categoryId = 'Μη έγκυρη κατηγορία.';
  const sub = (categories || []).find((c) => c.id === value.subcategoryId);
  if (!value.subcategoryId) errors.subcategoryId = 'Επιλέξτε υποκατηγορία.';
  else if (!sub || sub.parentId !== value.categoryId) errors.subcategoryId = 'Η υποκατηγορία δεν ανήκει στην επιλεγμένη κατηγορία.';

  if (!value.description) errors.description = 'Συμπληρώστε περιγραφή.';

  if (!isInt(value.priceCents) || value.priceCents <= 0) errors.priceCents = 'Η τιμή πρέπει να είναι θετικός αριθμός.';
  if (value.compareAtCents !== undefined) {
    if (!isInt(value.compareAtCents) || (isInt(value.priceCents) && value.compareAtCents <= value.priceCents)) {
      errors.compareAtCents = 'Η τιμή προσφοράς πρέπει να είναι μικρότερη από την κανονική τιμή.';
    }
  }

  if (!value.images.length) errors.images = 'Προσθέστε τουλάχιστον μία φωτογραφία.';
  else if (value.images.length > MAX_IMAGES) errors.images = `Έως ${MAX_IMAGES} φωτογραφίες ανά προϊόν.`;
  else {
    const bad = value.images.map(imageSourceError).find(Boolean);
    if (bad) errors.images = bad;
  }

  if (!value.variants.length) errors.variants = 'Προσθέστε τουλάχιστον μία παραλλαγή (μέγεθος και χρώμα).';
  const taken = skuSet(existingSkus, editingId);
  const seenSku = new Set();
  const seenCombo = new Set();
  value.variants.forEach((v, i) => {
    const k = (f) => `variants[${i}].${f}`;
    if (!v.size) errors[k('size')] = 'Συμπληρώστε μέγεθος.';
    if (!v.color) errors[k('color')] = 'Συμπληρώστε χρώμα.';
    if (!isValidHex(v.colorHex)) errors[k('colorHex')] = 'Μη έγκυρο χρώμα (μορφή #rrggbb).';
    if (!isInt(v.stock) || v.stock < 0) errors[k('stock')] = 'Το stock πρέπει να είναι ακέραιος αριθμός ≥ 0.';
    if (v.originalSku && v.originalSku !== v.sku) errors[k('sku')] = 'Το SKU υπάρχουσας παραλλαγής δεν αλλάζει. Αφαιρέστε την παραλλαγή και προσθέστε νέα.';
    else if (!v.sku) errors[k('sku')] = 'Συμπληρώστε SKU.';
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v.sku)) errors[k('sku')] = 'Το SKU επιτρέπει γράμματα, αριθμούς, τελείες και παύλες (έως 40 χαρακτήρες).';
    else if (seenSku.has(v.sku)) errors[k('sku')] = 'Το SKU υπάρχει ήδη σε άλλη παραλλαγή αυτού του προϊόντος.';
    else if (taken.has(v.sku)) errors[k('sku')] = 'Το SKU χρησιμοποιείται ήδη σε άλλο προϊόν.';
    if (v.sku) seenSku.add(v.sku);
    if (v.size && v.color) {
      const ck = comboKey(v.size, v.color);
      if (seenCombo.has(ck)) errors[k('color')] = 'Ο συνδυασμός μεγέθους και χρώματος υπάρχει ήδη.';
      seenCombo.add(ck);
    }
  });

  return { ok: Object.keys(errors).length === 0, errors, value };
}

// ---------------------------------------------------------------------------------- admin list

export const ADMIN_PAGE_SIZE = 25;

const NAME_CMP = (a, b) => String(a.name).localeCompare(String(b.name), 'el');
const ADMIN_SORTERS = {
  newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
  name: NAME_CMP,
  'price-asc': (a, b) => a.priceCents - b.priceCents,
  'price-desc': (a, b) => b.priceCents - a.priceCents,
  'stock-asc': (a, b) => a.totalStock - b.totalStock,
  'stock-desc': (a, b) => b.totalStock - a.totalStock,
};

/** Search / filter / sort / paginate the admin product table. Items carry totalStock, skuCount and skus. */
export function filterAdminProducts(products, variants, categories, f = {}) {
  const byProduct = new Map();
  for (const v of withoutArchived(variants)) {
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId).push(v);
  }
  const tokens = normalizeText(f.q).split(/\s+/).filter(Boolean);
  const rows = [];
  (products || []).forEach((p, index) => {
    const vs = byProduct.get(p.id) || [];
    const totalStock = vs.reduce((s, v) => s + Math.max(0, Number(v.stock) || 0), 0);
    const row = { ...p, totalStock, skuCount: vs.length, skus: vs.map((v) => v.sku) };
    if (f.status && (p.status || 'active') !== f.status) return;
    if (f.categoryId && p.categoryId !== f.categoryId && p.subcategoryId !== f.categoryId) return;
    if (f.lowStock && totalStock > LOW_STOCK_TOTAL) return;
    if (f.featured && !(p.flags && p.flags.featured)) return;
    if (tokens.length) {
      const hay = normalizeText([p.name, p.brand, p.slug, ...row.skus].join(' '));
      if (!tokens.every((t) => hay.includes(t))) return;
    }
    rows.push({ row, index });
  });
  const cmp = ADMIN_SORTERS[f.sort] || ADMIN_SORTERS.newest;
  rows.sort((a, b) => cmp(a.row, b.row) || a.index - b.index);
  const size = Math.max(1, Math.floor(f.pageSize) || ADMIN_PAGE_SIZE);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(f.page) || 1), pageCount);
  return { items: rows.slice((page - 1) * size, page * size).map((r) => r.row), total, page, pageCount, pageSize: size };
}

export { compareSizes };
