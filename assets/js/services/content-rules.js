// Pure content rules (no DB, no DOM): content keys, shape validators, token filling and
// newsletter helpers. Importable in Node; re-exported by content.js.
import { formatMoney, freeShippingPhrase, freeShippingCondition } from './pricing.js';
import { imageSourceError } from './product-admin-rules.js';

export const CONTENT_KEYS = ['hero', 'banners', 'collections', 'instagram', 'promos', 'newsletter', 'footer'];
export const DEPARTMENT_IDS = ['women', 'men', 'shoes', 'accessories'];
export const BANNER_PLACEMENTS = ['promo', 'shoes', 'accessories', 'women', 'men'];
/** Feed modes. Only 'curated' renders today; the shape leaves room for an official embed/API source later. */
export const INSTAGRAM_MODES = ['curated'];
/** Newsletter subscribers live in the settings store under this key: { key, list: [{ email, createdAt }] }. */
export const NEWSLETTER_KEY = 'newsletterSubscribers';

// ---------------------------------------------------------------- validation (pure)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const IMAGE_RE = /^(assets\/images\/[A-Za-z0-9_\-/]+\.(webp|jpe?g|png|avif)|https:\/\/[^\s"'<>]+)$/;
const HASH_RE = /^#\/[^\s"'<>]*$/;
const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/;
const FOCAL_RE = /^(\d{1,3}%|left|center|right) (\d{1,3}%|top|center|bottom)$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;

function checker() {
  const errors = [];
  const at = (p, msg) => errors.push(`${p}: ${msg}`);
  const c = {
    errors,
    text(obj, field, p, { required = true, max = 200 } = {}) {
      const v = obj[field];
      if (v === undefined || v === null || v === '') {
        if (required) at(`${p}.${field}`, 'υποχρεωτικό');
        return;
      }
      if (!isStr(v)) return at(`${p}.${field}`, 'πρέπει να είναι κείμενο');
      if (required && !v.trim()) return at(`${p}.${field}`, 'υποχρεωτικό');
      if (v.length > max) at(`${p}.${field}`, `έως ${max} χαρακτήρες`);
    },
    match(obj, field, p, re, { required = true, label = 'μη έγκυρη τιμή' } = {}) {
      const v = obj[field];
      if (v === undefined || v === null || v === '') {
        if (required) at(`${p}.${field}`, 'υποχρεωτικό');
        return;
      }
      if (!isStr(v) || !re.test(v)) at(`${p}.${field}`, label);
    },
    link(obj, field, p, opts = {}) {
      const v = obj[field];
      const ok = isStr(v) && (HASH_RE.test(v) || HTTPS_RE.test(v));
      if (v === undefined || v === null || v === '') {
        if (opts.required !== false) at(`${p}.${field}`, 'υποχρεωτικό');
        return;
      }
      if (!ok) at(`${p}.${field}`, 'ο σύνδεσμος πρέπει να ξεκινά με #/ ή https://');
    },
    // Seeded paths and https URLs, plus raster data URLs from local uploads (same allow-list as product images).
    imageSrc(obj, field, p, { required = true, allowData = true } = {}) {
      const v = obj[field];
      if (v === undefined || v === null || v === '') { if (required) at(p + '.' + field, 'υποχρεωτικό'); return; }
      if (!isStr(v)) return at(p + '.' + field, 'μη έγκυρη διαδρομή εικόνας');
      if (v.startsWith('data:') && !allowData) return at(p + '.' + field, 'δεν επιτρέπεται data: URL');
      if (v.startsWith('data:')) { const e = imageSourceError(v); if (e) at(p + '.' + field, e); return; }
      if (!IMAGE_RE.test(v)) at(p + '.' + field, 'μη έγκυρη διαδρομή εικόνας');
    },
    image(obj, p, { required = true } = {}) {
      if (!obj.image && !required) return;
      c.imageSrc(obj, 'image', p);
      c.imageSrc(obj, 'imageSm', p, { required: false, allowData: false });
      c.text(obj, 'alt', p, { max: 300 });
      for (const d of ['width', 'height']) {
        if (obj[d] !== undefined && !(Number.isInteger(obj[d]) && obj[d] > 0 && obj[d] <= 10000)) at(`${p}.${d}`, 'θετικός ακέραιος');
      }
    },
    bool(obj, field, p) {
      if (obj[field] !== undefined && typeof obj[field] !== 'boolean') at(`${p}.${field}`, 'true ή false');
    },
    list(obj, field, p, { max = 12, required = true } = {}) {
      const v = obj[field];
      if (v === undefined && !required) return [];
      if (!Array.isArray(v)) { at(`${p}.${field}`, 'πρέπει να είναι λίστα'); return []; }
      if (v.length > max) at(`${p}.${field}`, `έως ${max} στοιχεία`);
      return v;
    },
    items(arr, p, fn) {
      const seen = new Set();
      arr.forEach((it, i) => {
        const ip = `${p}[${i}]`;
        if (!isObj(it)) return at(ip, 'πρέπει να είναι αντικείμενο');
        if (it.id !== undefined || fn.needsId) {
          if (!isStr(it.id) || !ID_RE.test(it.id)) at(`${ip}.id`, 'μη έγκυρο αναγνωριστικό');
          else if (seen.has(it.id)) at(`${ip}.id`, 'διπλό αναγνωριστικό');
          else seen.add(it.id);
        }
        fn(it, ip);
      });
    },
    pair(obj, labelField, hrefField, p) {
      const hasL = obj[labelField] !== undefined && obj[labelField] !== '';
      const hasH = obj[hrefField] !== undefined && obj[hrefField] !== '';
      if (hasL !== hasH) at(p, `${labelField} και ${hrefField} συμπληρώνονται μαζί`);
      if (hasL) c.text(obj, labelField, p, { max: 60 });
      if (hasH) c.link(obj, hrefField, p);
    },
  };
  return c;
}

const withId = (fn) => Object.assign(fn, { needsId: true });

const VALIDATORS = {
  hero(v, c) {
    c.text(v, 'eyebrow', 'hero', { required: false, max: 80 });
    c.text(v, 'title', 'hero', { max: 120 });
    c.text(v, 'subtitle', 'hero', { required: false, max: 260 });
    c.text(v, 'ctaLabel', 'hero', { max: 60 });
    c.link(v, 'ctaHref', 'hero');
    c.pair(v, 'secondaryLabel', 'secondaryHref', 'hero');
    c.image(v, 'hero');
    c.match(v, 'focal', 'hero', FOCAL_RE, { required: false, label: 'π.χ. «65% center»' });
  },
  banners(v, c) {
    c.items(c.list(v, 'items', 'banners', { max: 8 }), 'banners.items', withId((it, p) => {
      if (!BANNER_PLACEMENTS.includes(it.placement)) c.errors.push(`${p}.placement: μία από ${BANNER_PLACEMENTS.join(', ')}`);
      c.bool(it, 'active', p);
      c.text(it, 'eyebrow', p, { required: false, max: 80 });
      c.text(it, 'title', p, { max: 140 });
      c.text(it, 'text', p, { required: false, max: 300 });
      c.pair(it, 'ctaLabel', 'ctaHref', p);
      c.image(it, p, { required: false });
    }));
  },
  collections(v, c) {
    c.items(c.list(v, 'departments', 'collections', { max: 4, required: false }), 'collections.departments', withId((it, p) => {
      if (!DEPARTMENT_IDS.includes(it.id)) c.errors.push(`${p}.id: άγνωστο τμήμα`);
      c.image(it, p);
    }));
    c.items(c.list(v, 'items', 'collections', { max: 8 }), 'collections.items', withId((it, p) => {
      c.text(it, 'title', p, { max: 80 });
      c.text(it, 'text', p, { required: false, max: 200 });
      c.link(it, 'href', p);
      c.image(it, p);
    }));
  },
  instagram(v, c) {
    if (!INSTAGRAM_MODES.includes(v.mode)) c.errors.push(`instagram.mode: μία από ${INSTAGRAM_MODES.join(', ')}`);
    c.match(v, 'handle', 'instagram', /^@?[A-Za-z0-9._]{1,30}$/, { label: 'π.χ. @marias.boutique' });
    c.match(v, 'profileUrl', 'instagram', HTTPS_RE, { required: false, label: 'πρέπει να ξεκινά με https://' });
    c.text(v, 'title', 'instagram', { required: false, max: 120 });
    c.text(v, 'text', 'instagram', { required: false, max: 300 });
    c.items(c.list(v, 'posts', 'instagram', { max: 12 }), 'instagram.posts', withId((it, p) => {
      c.image(it, p);
      c.text(it, 'caption', p, { required: false, max: 300 });
      c.match(it, 'permalink', p, HTTPS_RE, { required: false, label: 'πρέπει να ξεκινά με https://' });
      if (!Array.isArray(it.productIds) || it.productIds.some((id) => !isStr(id) || !id)) c.errors.push(`${p}.productIds: λίστα κωδικών προϊόντων`);
      else if (it.productIds.length > 6) c.errors.push(`${p}.productIds: έως 6 προϊόντα`);
    }));
  },
  promos(v, c) {
    c.items(c.list(v, 'items', 'promos', { max: 6 }), 'promos.items', withId((it, p) => {
      c.match(it, 'icon', p, ICON_RE, { required: false, label: 'όνομα εικονιδίου bootstrap-icons' });
      c.text(it, 'title', p, { max: 60 });
      c.text(it, 'text', p, { required: false, max: 140 });
    }));
  },
  newsletter(v, c) {
    c.bool(v, 'enabled', 'newsletter');
    c.text(v, 'eyebrow', 'newsletter', { required: false, max: 60 });
    c.text(v, 'title', 'newsletter', { max: 120 });
    c.text(v, 'text', 'newsletter', { required: false, max: 300 });
    c.text(v, 'buttonLabel', 'newsletter', { max: 40 });
    c.text(v, 'successText', 'newsletter', { required: false, max: 200 });
    c.text(v, 'privacyNote', 'newsletter', { required: false, max: 300 });
  },
  footer(v, c) {
    c.text(v, 'tagline', 'footer', { max: 240 });
    c.text(v, 'copyright', 'footer', { required: false, max: 120 });
    c.items(c.list(v, 'columns', 'footer', { max: 4 }), 'footer.columns', (col, p) => {
      c.text(col, 'title', p, { max: 40 });
      c.list(col, 'links', p, { max: 10 }).forEach((l, i) => {
        if (!isObj(l)) return c.errors.push(`${p}.links[${i}]: αντικείμενο`);
        c.text(l, 'label', `${p}.links[${i}]`, { max: 60 });
        c.link(l, 'href', `${p}.links[${i}]`);
      });
    });
    c.list(v, 'notes', 'footer', { max: 6, required: false }).forEach((n, i) => {
      if (!isStr(n) || !n.trim() || n.length > 240) c.errors.push(`footer.notes[${i}]: κείμενο έως 240 χαρακτήρες`);
    });
  },
};

/** Pure shape check for one content document. Returns { ok, errors }. */
export function validateContent(key, value) {
  if (!CONTENT_KEYS.includes(key)) return { ok: false, errors: [`άγνωστο κλειδί περιεχομένου: ${key}`] };
  if (!isObj(value)) return { ok: false, errors: [`${key}: πρέπει να είναι αντικείμενο`] };
  const c = checker();
  VALIDATORS[key](value, c);
  return { ok: c.errors.length === 0, errors: c.errors };
}

export const cloneJson = (o) => JSON.parse(JSON.stringify(o));
const clone = cloneJson;
/** Drop the IndexedDB key path from a stored record. */
export const stripKey = (rec) => {
  if (!rec) return rec;
  const { key, ...rest } = rec;
  return rest;
};
const strip = stripKey;

/**
 * Pure migration plan for content records written before the unified model:
 * returns { deletes: [keys], puts: [records] } (legacy `editorial` removed,
 * malformed or missing documents replaced by defaults).
 */
export function planContentMigration(records, defaults) {
  const deletes = [];
  const puts = [];
  const list = records || [];
  for (const rec of list) {
    if (!CONTENT_KEYS.includes(rec.key)) {
      if (rec.key === 'editorial') deletes.push(rec.key);
    } else if (!validateContent(rec.key, strip(rec)).ok) {
      puts.push({ ...clone(defaults[rec.key]), key: rec.key });
    }
  }
  for (const key of CONTENT_KEYS) {
    if (!list.some((r) => r.key === key)) puts.push({ ...clone(defaults[key]), key });
  }
  return { deletes, puts };
}

/** Pure: the stored document (without its key) when valid, otherwise a copy of the default. */
export function resolveContent(key, stored, defaults) {
  if (!CONTENT_KEYS.includes(key)) throw new Error(`Unknown content key: ${key}`);
  const doc = strip(stored);
  if (doc && validateContent(key, doc).ok) return doc;
  return clone(defaults[key]);
}

/** Replace {freeShipping} / {storeName} tokens with live settings values. Unknown tokens stay. */
export function fillTokens(text, settings = {}) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, name) => {
    const t = settings.freeShippingThresholdCents;
    if ((name === 'freeShipping' || name === 'freeShippingThreshold') && Number.isFinite(t)) return formatMoney(t);
    if (name === 'freeShippingText' && Number.isFinite(t)) return freeShippingPhrase(t);
    if (name === 'freeShippingCondition' && Number.isFinite(t)) return freeShippingCondition(t);
    if (name === 'storeName' && settings.storeName) return settings.storeName;
    return m;
  });
}

// ---------------------------------------------------------------- newsletter (pure)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateNewsletterEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Συμπληρώστε το email σας.' };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: 'Το email δεν είναι έγκυρο (π.χ. maria@example.gr).' };
  return { ok: true, email };
}

/** Pure: add a subscriber. status is 'added' | 'duplicate' | 'invalid'; the list is unchanged unless added. */
export function addSubscriber(list, rawEmail, now = new Date().toISOString()) {
  const current = Array.isArray(list) ? list : [];
  const v = validateNewsletterEmail(rawEmail);
  if (!v.ok) return { status: 'invalid', error: v.error, list: current };
  if (current.some((s) => String(s.email).toLowerCase() === v.email)) return { status: 'duplicate', email: v.email, list: current };
  return { status: 'added', email: v.email, list: [...current, { email: v.email, createdAt: now }] };
}
