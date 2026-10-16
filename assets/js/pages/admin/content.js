// Admin content editor (#/admin/content): one tab per content document (hero, banners, collections,
// instagram, promos, newsletter, footer). Each tab edits a draft of exactly the shape validated by
// services/content-rules.js; Save runs validateContent (per-field Greek errors + summary) and then
// saveContent(), which writes the document and dispatches 'content:changed' (home page and footer follow).
// Tabs are a keyboard-operable tablist (arrows move focus, Enter/Space activates). Unsaved changes are
// guarded when switching tabs and when leaving the page.
import { escapeHtml as esc, toast, confirmDialog } from '../../ui.js';
import { setNavigationGuard, onPageLeave } from '../../router.js';
import { adminLayout } from './layout.js';
import { createErrorUi, errorSummaryHtml, formBarHtml } from './form-kit.js';
import { imagePickerHtml, bindImagePickers } from './image-picker.js';
import { downloadCsv } from './orders.js';
import { smOf } from '../../services/image-path.js';
import { DEPARTMENTS } from '../../components/header.js';
import { DEMO_FEED_LABEL } from '../../components/shop-the-look.js';
import {
  getContent, saveContent, resetContentKey, validateContent, listSubscribers, BANNER_PLACEMENTS, cloneJson,
} from '../../services/content.js';
import {
  moveItem, removeAt, nextId, TOKEN_DOCS, FOCAL_PRESETS, toggleProductId, searchProducts, resolveProductChips,
  MAX_PRODUCTS_PER_POST, newsletterToCsv, newsletterCsvFileName, pruneEmpty, groupContentErrors, isDirty,
} from '../../services/content-admin-rules.js';
import { listProducts } from '../../services/products.js';

// ------------------------------------------------------------------ definitions
const PLACEMENT_LABELS = { promo: 'Προνόμια (αρχική, μπάνερ)', shoes: 'Παπούτσια (αρχική)', accessories: 'Αξεσουάρ (αρχική)', women: 'Γυναικεία', men: 'Ανδρικά' };
const LIMITS = { banners: 8, collections: 8, posts: 12, promos: 6, columns: 4, links: 10, notes: 6 };

const TAB_DEFS = [
  { key: 'hero', label: 'Hero', intro: 'Το μεγάλο κεντρικό banner της αρχικής σελίδας.' },
  { key: 'banners', label: 'Banners', intro: 'Μπάνερ της αρχικής σελίδας. Το «Προνόμια» εμφανίζεται πάνω από τα προϊόντα, τα «Παπούτσια» και «Αξεσουάρ» δίπλα στα αντίστοιχα προϊόντα.' },
  { key: 'collections', label: 'Συλλογές', intro: 'Οι φωτογραφίες των τμημάτων και οι προτεινόμενες συλλογές της αρχικής σελίδας.' },
  { key: 'instagram', label: 'Instagram', intro: 'Επιλεγμένες αναρτήσεις με «Shop the look». Είναι χειροποίητη επιλογή περιεχομένου, όχι ζωντανή σύνδεση με Instagram.' },
  { key: 'promos', label: 'Προνόμια', intro: 'Η λωρίδα προνομίων κάτω από το μπάνερ της αρχικής (δωρεάν αποστολή, παραλαβή κ.λπ.).' },
  { key: 'newsletter', label: 'Newsletter', intro: 'Το κουτί εγγραφής στο newsletter της αρχικής και οι τοπικές εγγραφές του demo.' },
  { key: 'footer', label: 'Υποσέλιδο', intro: 'Κείμενο, στήλες συνδέσμων και σημειώσεις στο υποσέλιδο όλων των σελίδων.' },
];

const BLANK = {
  banner: (items) => ({ id: nextId('banner', items), placement: 'promo', title: 'Νέο banner', active: true }),
  collection: (items) => ({ id: nextId('collection', items), title: 'Νέα συλλογή', href: '#/catalog', image: 'assets/images/content/collection-1.webp', imageSm: 'assets/images/content/collection-1-sm.webp', alt: 'Φωτογραφία συλλογής' }),
  post: (items) => ({ id: nextId('insta', items), image: 'assets/images/content/insta-1.webp', imageSm: 'assets/images/content/insta-1-sm.webp', alt: 'Φωτογραφία ανάρτησης', caption: '', productIds: [] }),
  promo: (items) => ({ id: nextId('promo', items), icon: 'star', title: 'Νέο προνόμιο', text: '' }),
  column: () => ({ title: 'Νέα στήλη', links: [] }),
  link: () => ({ label: 'Σύνδεσμος', href: '#/' }),
  note: () => '',
};

// ------------------------------------------------------------------ path helpers
const getPath = (obj, path) => (path === '' ? obj : path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj));
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}
const sub = (prefix, name) => (prefix ? `${prefix}.${name}` : name);

// ------------------------------------------------------------------ markup helpers (draft + key bound)
function makeKit(key, draft) {
  const id = (path) => `c-${key}-${path.replace(/\./g, '-')}`;
  const val = (path) => getPath(draft, path);
  const field = (path, label, { type = 'text', hint = '', max, col = 'col-12', required = false, rows = 3, placeholder = '' } = {}) => {
    const v = val(path) ?? '';
    const fid = id(path);
    const common = `id="${fid}" data-bind="${esc(path)}" aria-describedby="${hint ? `hint-${fid} ` : ''}err-${fid}"${max ? ` maxlength="${max + 40}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}`;
    const control = type === 'textarea'
      ? `<textarea class="form-control" ${common} rows="${rows}">${esc(v)}</textarea>`
      : `<input class="form-control" ${common} type="text" value="${esc(v)}" autocomplete="off"${type === 'url' ? ' inputmode="url" spellcheck="false"' : ''}>`;
    return `<div class="${col}"><label class="form-label" for="${fid}">${esc(label)}${required ? ' <span class="admin-req" aria-hidden="true">*</span>' : ''}</label>${control}
      ${hint ? `<div class="form-text" id="hint-${fid}">${esc(hint)}</div>` : ''}<div class="invalid-feedback" id="err-${fid}" data-error-for="${esc(path)}"></div></div>`;
  };
  const select = (path, label, options, { col = 'col-12 col-md-6', hint = '' } = {}) => {
    const v = val(path);
    const fid = id(path);
    const opts = options.some((o) => o.value === v) || v == null ? options : [...options, { value: v, label: `${v} (τρέχουσα τιμή)` }];
    return `<div class="${col}"><label class="form-label" for="${fid}">${esc(label)}</label>
      <select class="form-select" id="${fid}" data-bind="${esc(path)}" aria-describedby="${hint ? `hint-${fid} ` : ''}err-${fid}">${opts.map((o) => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      ${hint ? `<div class="form-text" id="hint-${fid}">${esc(hint)}</div>` : ''}<div class="invalid-feedback" id="err-${fid}" data-error-for="${esc(path)}"></div></div>`;
  };
  const toggle = (path, label, { col = 'col-12', hint = '' } = {}) => {
    const fid = id(path);
    return `<div class="${col}"><div class="form-check form-switch admin-switch-row"><input class="form-check-input" type="checkbox" role="switch" id="${fid}" data-bind="${esc(path)}"${val(path) !== false ? ' checked' : ''}${hint ? ` aria-describedby="hint-${fid}"` : ''}>
      <label class="form-check-label" for="${fid}">${esc(label)}</label></div>${hint ? `<div class="form-text" id="hint-${fid}">${esc(hint)}</div>` : ''}</div>`;
  };
  const picker = (prefix, { label = 'Εικόνα', required = true } = {}) => imagePickerHtml({
    id: id(sub(prefix, 'image')), label, bind: sub(prefix, 'image'), value: val(sub(prefix, 'image')) || '', altBind: sub(prefix, 'alt'), alt: val(sub(prefix, 'alt')) || '', required,
  });
  /** One list item card with move/remove buttons. */
  const item = (listPath, idx, total, title, inner, { fixed = false } = {}) => `<li class="cms-item" data-item="${esc(`${listPath}.${idx}`)}" tabindex="-1">
    <div class="cms-item-head"><h3 class="cms-item-title">${esc(title)}</h3>
      ${fixed ? '' : `<div class="cms-item-btns" role="group" aria-label="${esc(title)}: ενέργειες">
        <button type="button" class="btn btn-sm btn-outline-dark" data-act="up" data-list="${esc(listPath)}" data-idx="${idx}" aria-label="Μετακίνηση πάνω: ${esc(title)}"${idx === 0 ? ' disabled' : ''}><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
        <button type="button" class="btn btn-sm btn-outline-dark" data-act="down" data-list="${esc(listPath)}" data-idx="${idx}" aria-label="Μετακίνηση κάτω: ${esc(title)}"${idx === total - 1 ? ' disabled' : ''}><i class="bi bi-arrow-down" aria-hidden="true"></i></button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-act="remove" data-list="${esc(listPath)}" data-idx="${idx}" aria-label="Αφαίρεση: ${esc(title)}"><i class="bi bi-trash" aria-hidden="true"></i></button>
      </div>`}</div>
    <div class="row g-3">${inner}</div>
    <div class="invalid-feedback" data-error-for="${esc(`${listPath}.${idx}`)}"></div></li>`;
  const addBtn = (listPath, factory, label, count, max) => `<div class="cms-add"><button type="button" class="btn btn-outline-dark" data-act="add" data-list="${esc(listPath)}" data-factory="${factory}"${count >= max ? ' disabled' : ''}><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>${esc(label)}</button>
    <span class="cms-count" data-count-for="${esc(listPath)}">${count} / ${max}</span></div>
    <div class="invalid-feedback" data-error-for="${esc(listPath)}"></div>`;
  return { id, val, field, select, toggle, picker, item, addBtn };
}

const tokenDocsHtml = () => `<div class="admin-info-box cms-tokens" data-token-docs><p class="mb-1 fw-semibold"><i class="bi bi-braces me-1" aria-hidden="true"></i>Διαθέσιμα placeholders</p>
  <p class="mb-2">Γράψτε τα όπως είναι (με άγκιστρα) μέσα σε τίτλους και κείμενα· αντικαθίστανται αυτόματα από τις Ρυθμίσεις.</p>
  <ul class="mb-0">${TOKEN_DOCS.map((t) => `<li><code>${esc(t.token)}</code> — ${esc(t.description)}</li>`).join('')}</ul></div>`;

// ------------------------------------------------------------------ tab renderers
const TABS = {
  hero(k, d) {
    return `<div class="row g-3">
      ${k.field('eyebrow', 'Επικεφαλίδα (eyebrow)', { col: 'col-12 col-md-6', max: 80 })}
      ${k.field('title', 'Τίτλος', { col: 'col-12 col-md-6', max: 120, required: true })}
      ${k.field('subtitle', 'Υπότιτλος', { type: 'textarea', max: 260, rows: 2 })}
      ${k.field('ctaLabel', 'Κουμπί: κείμενο', { col: 'col-12 col-md-6', max: 60, required: true })}
      ${k.field('ctaHref', 'Κουμπί: σύνδεσμος', { col: 'col-12 col-md-6', type: 'url', required: true, hint: 'Μόνο #/… ή https://…', placeholder: '#/catalog' })}
      ${k.field('secondaryLabel', 'Δεύτερο κουμπί: κείμενο', { col: 'col-12 col-md-6', max: 60, hint: 'Προαιρετικό — συμπληρώνεται μαζί με τον σύνδεσμο.' })}
      ${k.field('secondaryHref', 'Δεύτερο κουμπί: σύνδεσμος', { col: 'col-12 col-md-6', type: 'url', placeholder: '#/catalog/women' })}
      <div class="col-12">${k.picker('', { label: 'Φωτογραφία hero' })}</div>
      ${k.select('focal', 'Εστίαση φωτογραφίας (focal point)', FOCAL_PRESETS, { hint: 'Ποιο σημείο της φωτογραφίας μένει ορατό όταν κόβεται σε στενές οθόνες.' })}
    </div>
    <div class="cms-preview" data-hero-preview aria-live="polite"><p class="cms-preview-label">Προεπισκόπηση</p>
      <div class="cms-preview-stage"><img alt="" data-prev-img><div class="cms-preview-copy"><p data-prev-eyebrow></p><h3 data-prev-title></h3><p data-prev-sub></p><span class="cms-preview-cta" data-prev-cta></span></div></div></div>`;
  },

  banners(k, d) {
    const items = d.items || [];
    return `${tokenDocsHtml()}
      <ol class="cms-list list-unstyled" aria-label="Banners">${items.map((b, i) => k.item('items', i, items.length, `Banner ${i + 1}${b.title ? `: ${b.title}` : ''}`, `
        ${k.select(`items.${i}.placement`, 'Θέση', BANNER_PLACEMENTS.map((p) => ({ value: p, label: PLACEMENT_LABELS[p] || p })))}
        ${k.toggle(`items.${i}.active`, 'Ενεργό (εμφανίζεται στην αρχική)', { col: 'col-12 col-md-6' })}
        ${k.field(`items.${i}.eyebrow`, 'Επικεφαλίδα', { col: 'col-12 col-md-6', max: 80 })}
        ${k.field(`items.${i}.title`, 'Τίτλος', { col: 'col-12 col-md-6', max: 140, required: true })}
        ${k.field(`items.${i}.text`, 'Κείμενο', { type: 'textarea', rows: 2, max: 300 })}
        ${k.field(`items.${i}.ctaLabel`, 'Κουμπί: κείμενο', { col: 'col-12 col-md-6', max: 60 })}
        ${k.field(`items.${i}.ctaHref`, 'Κουμπί: σύνδεσμος', { col: 'col-12 col-md-6', type: 'url', placeholder: '#/catalog' })}
        <div class="col-12">${k.picker(`items.${i}`, { label: 'Εικόνα (προαιρετική)', required: false })}</div>`)).join('')}</ol>
      ${items.length ? '' : '<p class="admin-empty-line">Δεν υπάρχουν banners. Προσθέστε το πρώτο.</p>'}
      ${k.addBtn('items', 'banner', 'Προσθήκη banner', items.length, LIMITS.banners)}`;
  },

  collections(k, d) {
    const deps = d.departments || [];
    const items = d.items || [];
    const depLabel = (id) => DEPARTMENTS.find((x) => x.id === id)?.label || id;
    return `<h3 class="cms-subhead">Φωτογραφίες τμημάτων</h3>
      <p class="admin-card-sub mb-2">Τα τέσσερα τμήματα έχουν σταθερή θέση· αλλάζει μόνο η φωτογραφία τους.</p>
      <ul class="cms-list list-unstyled" aria-label="Τμήματα">${deps.map((x, i) => k.item('departments', i, deps.length, `Τμήμα: ${depLabel(x.id)}`, `<div class="col-12">${k.picker(`departments.${i}`, { label: `Φωτογραφία (${depLabel(x.id)})` })}</div>`, { fixed: true })).join('')}</ul>
      <h3 class="cms-subhead">Προτεινόμενες συλλογές</h3>
      <ol class="cms-list list-unstyled" aria-label="Προτεινόμενες συλλογές">${items.map((c, i) => k.item('items', i, items.length, `Συλλογή ${i + 1}${c.title ? `: ${c.title}` : ''}`, `
        ${k.field(`items.${i}.title`, 'Τίτλος', { col: 'col-12 col-md-6', max: 80, required: true })}
        ${k.field(`items.${i}.href`, 'Σύνδεσμος', { col: 'col-12 col-md-6', type: 'url', required: true, placeholder: '#/catalog?sort=newest', hint: 'Μόνο #/… ή https://…' })}
        ${k.field(`items.${i}.text`, 'Περιγραφή', { type: 'textarea', rows: 2, max: 200 })}
        <div class="col-12">${k.picker(`items.${i}`, { label: 'Εικόνα εξωφύλλου' })}</div>`)).join('')}</ol>
      ${items.length ? '' : '<p class="admin-empty-line">Δεν υπάρχουν συλλογές. Η ενότητα κρύβεται στην αρχική.</p>'}
      ${k.addBtn('items', 'collection', 'Προσθήκη συλλογής', items.length, LIMITS.collections)}`;
  },

  instagram(k, d) {
    const posts = d.posts || [];
    return `<div class="admin-info-box mb-3" data-insta-note><p class="mb-2"><i class="bi bi-info-circle me-1" aria-hidden="true"></i><strong>Επιλεγμένο περιεχόμενο, όχι ζωντανό feed.</strong> Οι αναρτήσεις επιλέγονται χειροκίνητα εδώ. Δεν γίνεται scraping ούτε σύνδεση με το Instagram.</p>
      <p class="mb-0">Μια πραγματική ενσωμάτωση αργότερα θα απαιτούσε άδειες από τη Meta (Instagram Graph API) και διαπιστευτήρια στον server· δεν είναι διαθέσιμα σε αυτό το στατικό demo.</p></div>
      <div class="row g-3 mb-3">
        ${k.field('handle', 'Handle', { col: 'col-12 col-md-6', required: true, max: 31, placeholder: '@elan.boutique' })}
        ${k.field('profileUrl', 'Σύνδεσμος προφίλ', { col: 'col-12 col-md-6', type: 'url', hint: 'Μόνο https://… (προαιρετικό)', placeholder: 'https://instagram.com/elan.boutique' })}
        ${k.field('title', 'Τίτλος ενότητας', { col: 'col-12 col-md-6', max: 120 })}
        ${k.field('text', 'Κείμενο ενότητας', { col: 'col-12 col-md-6', max: 300 })}
        <div class="col-12 col-md-6"><label class="form-label" for="c-instagram-mode">Λειτουργία (mode)</label>
          <input class="form-control" id="c-instagram-mode" value="curated — επιλεγμένο περιεχόμενο" readonly aria-describedby="hint-c-instagram-mode">
          <div class="form-text" id="hint-c-instagram-mode">Σταθερή: μόνο η χειροκίνητη επιλογή υποστηρίζεται.</div></div>
        <div class="col-12 col-md-6"><p class="form-label mb-1">Ετικέτα στο κατάστημα (σταθερή)</p>
          <p class="admin-derived" data-insta-label>${esc(DEMO_FEED_LABEL)}</p></div>
      </div>
      <h3 class="cms-subhead">Αναρτήσεις</h3>
      <ol class="cms-list list-unstyled" aria-label="Αναρτήσεις Instagram">${posts.map((p, i) => k.item('posts', i, posts.length, `Ανάρτηση ${i + 1}`, `
        <div class="col-12">${k.picker(`posts.${i}`, { label: 'Φωτογραφία' })}</div>
        ${k.field(`posts.${i}.caption`, 'Λεζάντα', { type: 'textarea', rows: 2, max: 300 })}
        ${k.field(`posts.${i}.permalink`, 'Σύνδεσμος ανάρτησης (προαιρετικό)', { type: 'url', hint: 'Μόνο https://…', placeholder: 'https://instagram.com/p/…' })}
        <div class="col-12 cms-products" data-post="${i}"></div>`)).join('')}</ol>
      ${posts.length ? '' : '<p class="admin-empty-line">Δεν υπάρχουν αναρτήσεις. Η ενότητα κρύβεται στην αρχική.</p>'}
      ${k.addBtn('posts', 'post', 'Προσθήκη ανάρτησης', posts.length, LIMITS.posts)}`;
  },

  promos(k, d) {
    const items = d.items || [];
    return `${tokenDocsHtml()}
      <ol class="cms-list list-unstyled" aria-label="Προνόμια">${items.map((p, i) => k.item('items', i, items.length, `Προνόμιο ${i + 1}${p.title ? `: ${p.title}` : ''}`, `
        ${k.field(`items.${i}.title`, 'Τίτλος', { col: 'col-12 col-md-6', max: 60, required: true })}
        ${k.field(`items.${i}.icon`, 'Εικονίδιο (bootstrap-icons)', { col: 'col-12 col-md-6', max: 40, hint: 'Π.χ. truck, shop, gift, credit-card-2-front', placeholder: 'truck' })}
        ${k.field(`items.${i}.text`, 'Κείμενο', { type: 'textarea', rows: 2, max: 140 })}`)).join('')}</ol>
      ${items.length ? '' : '<p class="admin-empty-line">Δεν υπάρχουν προνόμια.</p>'}
      ${k.addBtn('items', 'promo', 'Προσθήκη προνομίου', items.length, LIMITS.promos)}`;
  },

  newsletter(k, d) {
    return `<div class="row g-3">
      ${k.toggle('enabled', 'Εμφάνιση του newsletter στην αρχική σελίδα', { hint: 'Αν απενεργοποιηθεί, η ενότητα κρύβεται. Οι υπάρχουσες εγγραφές διατηρούνται.' })}
      ${k.field('eyebrow', 'Επικεφαλίδα (eyebrow)', { col: 'col-12 col-md-6', max: 60 })}
      ${k.field('title', 'Τίτλος', { col: 'col-12 col-md-6', max: 120, required: true })}
      ${k.field('text', 'Κείμενο', { type: 'textarea', rows: 2, max: 300 })}
      ${k.field('buttonLabel', 'Κουμπί εγγραφής', { col: 'col-12 col-md-6', max: 40, required: true })}
      ${k.field('successText', 'Μήνυμα επιτυχίας', { col: 'col-12 col-md-6', max: 200 })}
      ${k.field('privacyNote', 'Σημείωση απορρήτου (προαιρετική)', { type: 'textarea', rows: 2, max: 300, hint: 'Εμφανίζεται κάτω από το πεδίο email, πέρα από την υποχρεωτική σημείωση demo.' })}
    </div>
    <div class="cms-subscribers" data-subscribers><h3 class="cms-subhead">Τοπικές εγγραφές (demo)</h3><div data-subscribers-body></div></div>`;
  },

  footer(k, d) {
    const cols = d.columns || [];
    const notes = d.notes || [];
    return `${tokenDocsHtml()}
      <div class="row g-3 mb-3">
        ${k.field('tagline', 'Σλόγκαν υποσέλιδου', { type: 'textarea', rows: 2, max: 240, required: true })}
        ${k.field('copyright', 'Κείμενο πνευματικών δικαιωμάτων (προαιρετικό)', { max: 120, hint: 'Αν μείνει κενό: «© έτος + επωνυμία καταστήματος».' })}
      </div>
      <h3 class="cms-subhead">Στήλες συνδέσμων</h3>
      <ol class="cms-list list-unstyled" aria-label="Στήλες υποσέλιδου">${cols.map((c, i) => {
        const links = c.links || [];
        return k.item('columns', i, cols.length, `Στήλη ${i + 1}${c.title ? `: ${c.title}` : ''}`, `
          ${k.field(`columns.${i}.title`, 'Τίτλος στήλης', { col: 'col-12 col-md-6', max: 40, required: true })}
          <div class="col-12"><p class="form-label mb-1">Σύνδεσμοι</p>
            <ul class="cms-links list-unstyled" aria-label="Σύνδεσμοι στήλης ${i + 1}">${links.map((l, j) => `<li class="cms-link-row" data-item="columns.${i}.links.${j}" tabindex="-1">
              ${k.field(`columns.${i}.links.${j}.label`, `Σύνδεσμος ${j + 1}: κείμενο`, { col: 'cms-link-f', max: 60 })}
              ${k.field(`columns.${i}.links.${j}.href`, `Σύνδεσμος ${j + 1}: διεύθυνση`, { col: 'cms-link-f', type: 'url', placeholder: '#/catalog' })}
              <div class="cms-item-btns" role="group" aria-label="Σύνδεσμος ${j + 1}: ενέργειες">
                <button type="button" class="btn btn-sm btn-outline-dark" data-act="up" data-list="columns.${i}.links" data-idx="${j}" aria-label="Μετακίνηση πάνω: σύνδεσμος ${j + 1} της στήλης ${i + 1}"${j === 0 ? ' disabled' : ''}><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
                <button type="button" class="btn btn-sm btn-outline-dark" data-act="down" data-list="columns.${i}.links" data-idx="${j}" aria-label="Μετακίνηση κάτω: σύνδεσμος ${j + 1} της στήλης ${i + 1}"${j === links.length - 1 ? ' disabled' : ''}><i class="bi bi-arrow-down" aria-hidden="true"></i></button>
                <button type="button" class="btn btn-sm btn-outline-danger" data-act="remove" data-list="columns.${i}.links" data-idx="${j}" aria-label="Αφαίρεση: σύνδεσμος ${j + 1} της στήλης ${i + 1}"><i class="bi bi-trash" aria-hidden="true"></i></button>
              </div></li>`).join('')}</ul>
            ${k.addBtn(`columns.${i}.links`, 'link', 'Προσθήκη συνδέσμου', links.length, LIMITS.links)}</div>`);
      }).join('')}</ol>
      ${k.addBtn('columns', 'column', 'Προσθήκη στήλης', cols.length, LIMITS.columns)}
      <h3 class="cms-subhead">Σημειώσεις πληρωμών και αποστολής</h3>
      <ul class="cms-notes list-unstyled" aria-label="Σημειώσεις υποσέλιδου">${notes.map((n, i) => `<li class="cms-note-row" data-item="notes.${i}" tabindex="-1">
        ${k.field(`notes.${i}`, `Σημείωση ${i + 1}`, { col: 'cms-link-f', max: 240 })}
        <div class="cms-item-btns" role="group" aria-label="Σημείωση ${i + 1}: ενέργειες">
          <button type="button" class="btn btn-sm btn-outline-dark" data-act="up" data-list="notes" data-idx="${i}" aria-label="Μετακίνηση πάνω: σημείωση ${i + 1}"${i === 0 ? ' disabled' : ''}><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
          <button type="button" class="btn btn-sm btn-outline-dark" data-act="down" data-list="notes" data-idx="${i}" aria-label="Μετακίνηση κάτω: σημείωση ${i + 1}"${i === notes.length - 1 ? ' disabled' : ''}><i class="bi bi-arrow-down" aria-hidden="true"></i></button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-act="remove" data-list="notes" data-idx="${i}" aria-label="Αφαίρεση: σημείωση ${i + 1}"><i class="bi bi-trash" aria-hidden="true"></i></button>
        </div></li>`).join('')}</ul>
      ${k.addBtn('notes', 'note', 'Προσθήκη σημείωσης', notes.length, LIMITS.notes)}`;
  },
};

// ------------------------------------------------------------------ page
export default async function render() {
  const { root, body } = adminLayout({ active: 'content', title: 'Περιεχόμενο', view: 'content', route: '/admin/content', crumbs: [{ label: 'Περιεχόμενο' }],
    subtitle: 'Επεξεργασία της αρχικής σελίδας και του υποσέλιδου. Οι αλλαγές εμφανίζονται αμέσως στο κατάστημα.' });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';
  mount({ root, body, view }).catch((err) => {
    console.warn('Content editor failed', err);
    body.removeAttribute('aria-busy');
    body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η φόρτωση του περιεχομένου. Ανανεώστε τη σελίδα.</div>';
  });
  return root;
}

async function mount({ root, body, view }) {
  let key = 'hero';
  let saved = null;
  let draft = null;
  let products = null;
  let subscribers = [];
  let saving = false;
  const queries = new Map(); // instagram post index -> search text

  body.removeAttribute('aria-busy');
  body.innerHTML = `<div class="admin-card cms-card">
    <div class="nav nav-tabs cms-tabs" role="tablist" aria-label="Ενότητες περιεχομένου">${TAB_DEFS.map((t) => `<button type="button" class="nav-link" role="tab" id="tab-${t.key}" data-tab="${t.key}" aria-controls="cms-panel" aria-selected="false" tabindex="-1">${esc(t.label)}</button>`).join('')}</div>
    <div class="cms-panel" id="cms-panel" role="tabpanel" tabindex="0" data-panel></div>
  </div>`;
  const panel = body.querySelector('[data-panel]');
  const tabs = [...body.querySelectorAll('[role="tab"]')];

  const errors = createErrorUi(panel, {
    fieldEl: (bind) => panel.querySelector(`[data-bind="${CSS.escape(bind)}"]`) || panel.querySelector(`[data-focus-for="${CSS.escape(bind)}"]`) || panel.querySelector(`[data-item="${CSS.escape(bind)}"]`),
    labelFor: (bind) => {
      const el = panel.querySelector(`[data-bind="${CSS.escape(bind)}"]`);
      if (!el) return bind === '' ? 'Ενότητα' : (panel.querySelector(`[data-item="${CSS.escape(bind)}"] .cms-item-title`)?.textContent || bind);
      const lab = el.id && panel.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const head = el.closest('.cms-item')?.querySelector('.cms-item-title')?.textContent;
      return [head, lab && lab.textContent.replace('*', '').trim()].filter(Boolean).join(' · ') || bind;
    },
  });

  const dirty = () => isDirty(pruneEmpty(saved), pruneEmpty(draft));
  const refreshDirty = () => { const n = panel.querySelector('[data-dirty-note]'); if (n) n.hidden = !dirty(); };
  const kit = () => makeKit(key, draft);

  // ---------------------------------------------------------------- hero preview
  function updatePreview() {
    const pv = panel.querySelector('[data-hero-preview]');
    if (!pv) return;
    const img = pv.querySelector('[data-prev-img]');
    if (draft.image && img.getAttribute('src') !== draft.image) img.setAttribute('src', draft.image);
    if (!draft.image) img.removeAttribute('src');
    img.alt = draft.alt || '';
    img.style.objectPosition = /^[\w% ]+$/.test(draft.focal || '') ? draft.focal : '65% center';
    pv.querySelector('[data-prev-eyebrow]').textContent = draft.eyebrow || '';
    pv.querySelector('[data-prev-title]').textContent = draft.title || '';
    pv.querySelector('[data-prev-sub]').textContent = draft.subtitle || '';
    pv.querySelector('[data-prev-cta]').textContent = draft.ctaLabel || '';
  }

  // ---------------------------------------------------------------- instagram product picker
  const thumb = (p) => (p.images?.[0] ? `<img src="${esc(smOf(p.images[0]))}" alt="" width="32" height="42" loading="lazy">` : '<span class="cms-noimg"></span>');
  const resultsInner = (found, ids) => (found.length ? found.map((p) => `<li><button type="button" class="cms-result" data-toggle-product="${esc(p.id)}" aria-pressed="${ids.includes(p.id)}">
    ${thumb(p)}<span class="cms-result-name">${esc(p.name)}</span><span class="cms-result-state" aria-hidden="true">${ids.includes(p.id) ? '<i class="bi bi-check-lg"></i>' : '<i class="bi bi-plus-lg"></i>'}</span></button></li>`).join('')
    : '<li class="cms-chip-empty">Δεν βρέθηκαν προϊόντα.</li>');
  const productsHtml = (i) => {
    const post = (draft.posts || [])[i] || {};
    const ids = post.productIds || [];
    const chips = resolveProductChips(ids, products || []);
    const q = queries.get(i) || '';
    const found = searchProducts(products || [], q, 8);
    return `<p class="form-label mb-1" id="prod-label-${i}">Προϊόντα στην εικόνα (έως ${MAX_PRODUCTS_PER_POST})</p>
      <ul class="cms-chips list-unstyled" data-chips aria-labelledby="prod-label-${i}">${chips.length ? chips.map((c) => `<li class="cms-chip${c.missing ? ' is-missing' : ''}" data-chip="${esc(c.id)}">
        ${c.image ? `<img src="${esc(smOf(c.image))}" alt="" width="28" height="36">` : ''}<span>${esc(c.name)}${c.missing ? ' (δεν βρέθηκε)' : ''}</span>
        <button type="button" data-toggle-product="${esc(c.id)}" aria-label="Αφαίρεση προϊόντος: ${esc(c.name)}"><i class="bi bi-x-lg" aria-hidden="true"></i></button></li>`).join('') : '<li class="cms-chip-empty">Κανένα προϊόν επιλεγμένο.</li>'}</ul>
      <label class="form-label" for="prod-search-${i}">Αναζήτηση προϊόντος για προσθήκη</label>
      <input class="form-control" id="prod-search-${i}" type="search" data-product-search data-focus-for="posts.${i}.productIds" value="${esc(q)}" placeholder="Όνομα, brand ή κωδικός" autocomplete="off" aria-describedby="prod-msg-${i}">
      <p class="form-text mb-1" id="prod-msg-${i}" data-product-msg role="status"></p>
      <ul class="cms-results list-unstyled" data-results aria-label="Αποτελέσματα αναζήτησης">${resultsInner(found, ids)}</ul>
      <div class="invalid-feedback" data-error-for="posts.${i}.productIds"></div>`;
  };
  const paintProducts = (only) => {
    panel.querySelectorAll('[data-post]').forEach((el) => {
      const i = Number(el.dataset.post);
      if (only !== undefined && only !== i) return;
      el.innerHTML = productsHtml(i);
    });
  };

  // ---------------------------------------------------------------- subscribers
  function paintSubscribers() {
    const host = panel.querySelector('[data-subscribers-body]');
    if (!host) return;
    const fmt = new Intl.DateTimeFormat('el-GR', { dateStyle: 'medium', timeStyle: 'short' });
    host.innerHTML = `<p class="admin-card-sub" data-subscriber-count>${subscribers.length} ${subscribers.length === 1 ? 'εγγραφή' : 'εγγραφές'} (αποθηκευμένες μόνο σε αυτόν τον περιηγητή· δεν στέλνεται κανένα email).</p>
      ${subscribers.length ? `<div class="cms-sub-wrap"><table class="table table-sm admin-table cms-sub-table"><thead><tr><th scope="col">Email</th><th scope="col">Ημερομηνία</th></tr></thead>
        <tbody>${subscribers.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.createdAt ? fmt.format(new Date(s.createdAt)) : '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-empty-line">Δεν υπάρχουν εγγραφές ακόμη.</p>'}
      <button type="button" class="btn btn-outline-dark mt-2" data-export-subscribers${subscribers.length ? '' : ' disabled'}><i class="bi bi-filetype-csv me-1" aria-hidden="true"></i>Εξαγωγή CSV</button>`;
  }

  // ---------------------------------------------------------------- render
  function paintTab() {
    const def = TAB_DEFS.find((t) => t.key === key);
    tabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `tab-${key}`);
    panel.dataset.panelTab = key;
    panel.innerHTML = `<form class="admin-product-form cms-form" novalidate data-content-form="${key}" aria-label="${esc(def.label)}">
      <p class="admin-card-sub cms-intro">${esc(def.intro)}</p>
      ${errorSummaryHtml()}
      <div data-tab-body>${TABS[key](kit(), draft)}</div>
      ${formBarHtml({ extra: '<button type="button" class="btn btn-outline-dark" data-reset-tab><i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Επαναφορά αυτής της ενότητας</button>' })}
    </form>`;
    if (key === 'instagram') paintProducts();
    if (key === 'hero') updatePreview();
    if (key === 'newsletter') paintSubscribers();
    refreshDirty();
  }

  async function openTab(next) {
    key = next;
    saved = await getContent(key);
    draft = cloneJson(saved);
    queries.clear();
    if (key === 'instagram' && !products) products = (await listProducts({ pageSize: 10000 }).catch(() => ({ items: [] }))).items;
    if (key === 'newsletter') subscribers = await listSubscribers().catch(() => []);
    paintTab();
    view.dataset.tab = key;
  }

  // ---------------------------------------------------------------- tabs
  const leaveMsg = () => confirmDialog(`Η ενότητα «${TAB_DEFS.find((t) => t.key === key).label}» έχει αλλαγές που δεν έχουν αποθηκευτεί. Αν συνεχίσετε, θα χαθούν.`, {
    title: 'Μη αποθηκευμένες αλλαγές', okLabel: 'Απόρριψη αλλαγών', cancelLabel: 'Παραμονή', danger: true,
  });
  async function switchTab(next) {
    if (next === key) return;
    if (dirty() && !(await leaveMsg())) return;
    await openTab(next);
  }
  body.querySelector('[role="tablist"]').addEventListener('click', (e) => {
    const t = e.target.closest('[role="tab"]');
    if (t) switchTab(t.dataset.tab);
  });
  body.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    tabs.forEach((t, j) => { t.tabIndex = j === to ? 0 : -1; });
    tabs[to].focus();
  });

  // ---------------------------------------------------------------- editing
  const rerender = (focusSel) => {
    const top = window.scrollY;
    panel.querySelector('[data-tab-body]').innerHTML = TABS[key](kit(), draft);
    if (key === 'instagram') paintProducts();
    if (key === 'hero') updatePreview();
    if (key === 'newsletter') paintSubscribers();
    errors.clear();
    refreshDirty();
    const t = focusSel && panel.querySelector(focusSel);
    if (t) t.focus({ preventScroll: false }); else window.scrollTo({ top });
  };

  panel.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-product-search]')) {
      const i = Number(el.closest('[data-post]').dataset.post);
      queries.set(i, el.value);
      el.closest('[data-post]').querySelector('[data-results]').innerHTML = resultsInner(searchProducts(products || [], el.value, 8), draft.posts[i].productIds || []);
      return;
    }
    if (!el.dataset.bind) return;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    setPath(draft, el.dataset.bind, v);
    errors.clearField(el);
    if (key === 'hero') updatePreview();
    refreshDirty();
  });
  panel.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('select[data-bind], input[type="checkbox"][data-bind]')) {
      setPath(draft, el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
      if (key === 'hero') updatePreview();
      refreshDirty();
    }
  });

  bindImagePickers(panel, {
    apply(el, patch) {
      const srcInput = el.querySelector('[data-img-src]');
      const bind = srcInput.dataset.bind;
      const objPath = bind === 'image' ? '' : bind.replace(/\.image$/, '');
      const obj = getPath(draft, objPath);
      if (!obj) return;
      if (patch.image === '') {
        ['image', 'imageSm', 'width', 'height', 'alt'].forEach((f) => delete obj[f]);
        const alt = el.querySelector('[data-bind$="alt"]');
        if (alt) alt.value = '';
      } else {
        obj.image = patch.image;
        ['imageSm', 'width', 'height'].forEach((f) => { if (patch[f] === undefined) delete obj[f]; else obj[f] = patch[f]; });
      }
      errors.clearField(srcInput);
      if (key === 'hero') updatePreview();
      refreshDirty();
    },
  });

  panel.addEventListener('click', async (e) => {
    const prod = e.target.closest('[data-toggle-product]');
    if (prod) {
      const host = prod.closest('[data-post]');
      const i = Number(host.dataset.post);
      const post = draft.posts[i];
      const r = toggleProductId(post.productIds || [], prod.dataset.toggleProduct);
      host.querySelector('[data-product-msg]').textContent = r.error || '';
      if (!r.error) {
        post.productIds = r.ids;
        const had = prod.dataset.toggleProduct;
        const q = host.querySelector('[data-product-search]').value;
        paintProducts(i);
        host.querySelector('[data-product-search]').value = q;
        host.querySelector(`[data-results] [data-toggle-product="${CSS.escape(had)}"]`)?.focus();
        if (!host.contains(document.activeElement)) host.querySelector('[data-product-search]').focus();
        errors.clearField(host.querySelector('[data-product-search]'));
        refreshDirty();
      }
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      const listPath = act.dataset.list;
      const idx = Number(act.dataset.idx);
      const list = getPath(draft, listPath) || [];
      const sel = (a, n) => `[data-act="${a}"][data-list="${CSS.escape(listPath)}"][data-idx="${n}"]:not(:disabled)`;
      let focus;
      if (act.dataset.act === 'add') {
        setPath(draft, listPath, [...list, BLANK[act.dataset.factory](list)]);
        focus = [`[data-item="${CSS.escape(`${listPath}.${list.length}`)}"]`];
      } else if (act.dataset.act === 'remove') {
        setPath(draft, listPath, removeAt(list, idx));
        focus = [`[data-act="add"][data-list="${CSS.escape(listPath)}"]`];
      } else {
        const dir = act.dataset.act === 'up' ? -1 : 1;
        setPath(draft, listPath, moveItem(list, idx, dir));
        focus = [sel(act.dataset.act, idx + dir), sel(act.dataset.act === 'up' ? 'down' : 'up', idx + dir)];
      }
      rerender();
      const target = focus.map((q) => panel.querySelector(q)).find(Boolean);
      if (target) target.focus();
      return;
    }
    if (e.target.closest('[data-export-subscribers]')) {
      try {
        downloadCsv(newsletterToCsv(subscribers), newsletterCsvFileName());
        toast(`Εξήχθησαν ${subscribers.length} εγγραφές σε CSV.`, 'success');
      } catch (err) {
        console.warn('Newsletter CSV failed', err);
        toast('Η εξαγωγή CSV δεν ολοκληρώθηκε.', 'danger');
      }
      return;
    }
    if (e.target.closest('[data-reset-tab]')) {
      const label = TAB_DEFS.find((t) => t.key === key).label;
      const ok = await confirmDialog(`Η ενότητα «${label}» θα επανέλθει στο αρχικό (προεπιλεγμένο) περιεχόμενο. Οι τρέχουσες αλλαγές της ενότητας θα χαθούν.`, {
        title: 'Επαναφορά ενότητας', okLabel: 'Επαναφορά', cancelLabel: 'Άκυρο', danger: true,
      });
      if (!ok) return;
      try {
        draft = cloneJson(await resetContentKey(key));
        saved = cloneJson(draft);
        queries.clear();
        paintTab();
        toast(`Η ενότητα «${label}» επανήλθε στις προεπιλογές.`, 'success');
        view.dataset.saved = String(Date.now());
      } catch (err) {
        console.warn('Content reset failed', err);
        toast('Η επαναφορά δεν ολοκληρώθηκε.', 'danger');
      }
    }
  });

  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const value = pruneEmpty(draft);
    const r = validateContent(key, value);
    if (!r.ok) {
      const map = {};
      groupContentErrors(r.errors, key).forEach(({ bind, message }) => { map[bind] = map[bind] ? `${map[bind]}; ${message}` : message; });
      errors.show(map);
      return;
    }
    errors.clear();
    saving = true;
    const btn = panel.querySelector('[data-save]');
    btn.disabled = true;
    try {
      const clean = await saveContent(key, value);
      saved = cloneJson(clean);
      draft = cloneJson(clean);
      refreshDirty();
      toast('Το περιεχόμενο αποθηκεύτηκε και εμφανίζεται αμέσως στο κατάστημα.', 'success');
      view.dataset.saved = String(Date.now());
    } catch (err) {
      if (err && err.code === 'invalid') {
        const map = {};
        groupContentErrors(err.errors, key).forEach(({ bind, message }) => { map[bind] = message; });
        errors.show(map);
      } else if (err && err.name === 'QuotaExceededError') {
        toast('Δεν υπάρχει αρκετός χώρος αποθήκευσης στον περιηγητή. Μικρύνετε τις εικόνες.', 'danger');
      } else {
        console.warn('Content save failed', err);
        toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
      }
    } finally {
      saving = false;
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- unsaved-changes guard (page leave)
  setNavigationGuard(() => (!saved || !dirty() || !root.isConnected ? true : leaveMsg()));
  const onUnload = (ev) => {
    if (!root.isConnected) { window.removeEventListener('beforeunload', onUnload); return; }
    if (saved && dirty()) { ev.preventDefault(); ev.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onUnload);
  onPageLeave(() => window.removeEventListener('beforeunload', onUnload));

  await openTab('hero');
  view.dataset.ready = 'true';
}
