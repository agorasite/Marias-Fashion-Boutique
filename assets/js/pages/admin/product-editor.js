// Admin product editor (create + edit): `#/admin/products/new` and `#/admin/products/:id`.
// Sections: Βασικά, Τιμές, Εικόνες, Χαρακτηριστικά, Παραλλαγές. Validation uses the same pure rules
// as saveProduct() (services/product-admin-rules.js), shown inline with an error summary.
import { escapeHtml as esc, formatMoney, toast, confirmDialog, navigate } from '../../ui.js';
import { setNavigationGuard } from '../../router.js';
import { adminLayout } from './layout.js';
import { fileToDataUrl, probeImage } from './image-upload.js';
import { smOf } from '../../services/image-path.js';
import { compareSizes } from '../../services/products.js';
import {
  loadAdminCatalog, getAdminProduct, saveProduct, validateProductInput, pricingFromForm, pricingToForm, discountPercent,
  slugify, generateVariantMatrix, isValidHex, SIZE_PRESETS,
} from '../../services/product-admin.js';

const FIELD_LABELS = {
  name: 'Όνομα', slug: 'Slug', brand: 'Brand', categoryId: 'Κατηγορία', subcategoryId: 'Υποκατηγορία', description: 'Περιγραφή',
  price: 'Τιμή', salePrice: 'Τιμή προσφοράς', images: 'Φωτογραφίες', variants: 'Παραλλαγές',
};
const VARIANT_LABELS = { size: 'Μέγεθος', color: 'Χρώμα', colorHex: 'Κωδικός χρώματος', sku: 'SKU', stock: 'Stock' };

const idKey = (key) => key.replace(/\W+/g, '-').replace(/^-|-$/g, '');
const blankRow = () => ({ sku: '', size: '', color: '', colorHex: '#222222', stock: 0 });
let rowSeq = 0;

function labelFor(key) {
  const m = /^variants\[(\d+)\]\.(\w+)$/.exec(key);
  if (m) return `Παραλλαγή ${Number(m[1]) + 1} · ${VARIANT_LABELS[m[2]] || m[2]}`;
  return FIELD_LABELS[key] || key;
}

function section(title, sub, inner, key) {
  return `<section class="admin-card admin-form-section" aria-labelledby="sec-${key}" data-section="${key}">
    <div class="admin-card-head"><div><h2 class="admin-card-title" id="sec-${key}">${esc(title)}</h2>${sub ? `<p class="admin-card-sub">${esc(sub)}</p>` : ''}</div></div>
    ${inner}</section>`;
}

/** Text-like control with label, optional hint and an error slot wired through aria-describedby. */
function ctl({ key, label, control, hint = '', col = 'col-12', required = false }) {
  const id = `f-${idKey(key)}`;
  const desc = `${hint ? `hint-${idKey(key)} ` : ''}err-${idKey(key)}`;
  return `<div class="${col}"><label class="form-label" for="${id}">${esc(label)}${required ? ' <span class="admin-req" aria-hidden="true">*</span>' : ''}</label>
    ${control(id, desc)}
    ${hint ? `<div class="form-text" id="hint-${idKey(key)}">${esc(hint)}</div>` : ''}
    <div class="invalid-feedback" id="err-${idKey(key)}" data-error-for="${esc(key)}"></div></div>`;
}
const input = (key, value = '', attrs = '') => (id, desc) => `<input class="form-control" id="${id}" name="${key}" data-field="${key}" aria-describedby="${desc}" value="${esc(value)}" ${attrs}>`;

export async function renderEditor(ctx) {
  const productId = ctx.params && ctx.params.id;
  const isNew = !productId;
  const { root, body } = adminLayout({
    active: 'products', title: isNew ? 'Νέο προϊόν' : 'Επεξεργασία προϊόντος', view: 'product-editor',
    route: isNew ? '/admin/products/new' : '/admin/products/:id',
    crumbs: [{ href: '#/admin/products', label: 'Προϊόντα' }, { label: isNew ? 'Νέο προϊόν' : 'Επεξεργασία' }],
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';

  (async () => {
    let catalog;
    let existing = null;
    try {
      catalog = await loadAdminCatalog();
      if (!isNew) existing = await getAdminProduct(productId);
    } catch (err) {
      console.warn('Editor load failed', err);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των δεδομένων. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.removeAttribute('aria-busy');
    if (!isNew && !existing) {
      root.querySelector('.admin-title').textContent = 'Το προϊόν δεν βρέθηκε';
      body.innerHTML = `<div class="admin-card admin-soon" data-product-missing><span class="admin-soon-icon" aria-hidden="true"><i class="bi bi-bag-x"></i></span>
        <p class="admin-soon-text">Δεν υπάρχει προϊόν με κωδικό <code></code>. Ίσως διαγράφηκε.</p>
        <a class="btn btn-dark btn-sm" href="#/admin/products">Επιστροφή στα προϊόντα</a></div>`;
      body.querySelector('code').textContent = productId;
      view.dataset.ready = 'true';
      return;
    }
    mountForm({ root, body, view, catalog, existing });
  })();
  return root;
}

function mountForm({ root, body, view, catalog, existing }) {
  const isNew = !existing;
  const cats = catalog.categories;
  const tops = cats.filter((c) => !c.parentId);
  if (existing) root.querySelector('.admin-title').textContent = existing.name;

  const activeVariants = (existing ? existing.variants : []).filter((v) => !v.archived);
  const st = {
    images: existing ? [...existing.images] : [],
    variants: [...activeVariants].sort((x, y) => compareSizes(String(x.size), String(y.size)) || String(x.color).localeCompare(String(y.color), 'el')).map((v) => ({ ...v, persisted: true })),
    sizes: [...new Set(activeVariants.map((v) => String(v.size)))].sort(compareSizes),
    colors: [...new Map(activeVariants.map((v) => [v.color, v.colorHex])).entries()].map(([name, hex]) => ({ name, hex })),
  };
  const price = existing ? pricingToForm(existing) : { price: '', salePrice: '' };
  const e = existing || { name: '', slug: '', brand: 'ÉLAN', categoryId: '', subcategoryId: '', description: '', attributes: {}, flags: {}, status: 'active' };
  const a = e.attributes || {};
  const flags = e.flags || {};
  let slugTouched = !isNew;
  let dirty = false;
  let saving = false;

  const subOptions = (catId, selected) => `<option value="">Επιλέξτε υποκατηγορία</option>${cats.filter((c) => c.parentId === catId)
    .map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}`;

  const storeLink = existing
    ? `<p class="admin-store-link" data-store-link><i class="bi bi-shop me-1" aria-hidden="true"></i>Εμφανίζεται στο κατάστημα:
        <a href="#/product/${esc(existing.slug)}" target="_blank" rel="noopener" data-store-link-a>#/product/${esc(existing.slug)}<span class="visually-hidden"> (ανοίγει σε νέα καρτέλα)</span></a>
        ${existing.status === 'archived' ? '<span class="admin-badge st-archived ms-1">Αρχειοθετημένο: δεν είναι ορατό</span>' : ''}</p>` : '';

  body.innerHTML = `<form class="admin-product-form" novalidate data-product-form aria-label="${isNew ? 'Νέο προϊόν' : 'Επεξεργασία προϊόντος'}">
    ${storeLink}
    <div class="alert alert-danger admin-error-summary" role="alert" tabindex="-1" data-error-summary hidden></div>

    ${section('Βασικά', 'Όνομα, κατηγορία, περιγραφή και ορατότητα.', `<div class="row g-3">
      ${ctl({ key: 'name', label: 'Όνομα προϊόντος', required: true, col: 'col-12 col-md-6', control: input('name', e.name, 'autocomplete="off" maxlength="120"') })}
      ${ctl({ key: 'slug', label: 'Slug (διεύθυνση)', col: 'col-12 col-md-6', hint: isNew ? 'Συμπληρώνεται αυτόματα από το όνομα (ελληνικά → λατινικά).' : 'Η αλλαγή του slug αλλάζει τη διεύθυνση του προϊόντος στο κατάστημα.', control: input('slug', e.slug, 'autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="120"') })}
      ${ctl({ key: 'brand', label: 'Brand', required: true, col: 'col-12 col-md-4', control: input('brand', e.brand, 'autocomplete="off" maxlength="60"') })}
      ${ctl({ key: 'categoryId', label: 'Κατηγορία', required: true, col: 'col-12 col-md-4', control: (id, d) => `<select class="form-select" id="${id}" name="categoryId" data-field="categoryId" aria-describedby="${d}">
        <option value="">Επιλέξτε κατηγορία</option>${tops.map((c) => `<option value="${esc(c.id)}"${c.id === e.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` })}
      ${ctl({ key: 'subcategoryId', label: 'Υποκατηγορία', required: true, col: 'col-12 col-md-4', control: (id, d) => `<select class="form-select" id="${id}" name="subcategoryId" data-field="subcategoryId" aria-describedby="${d}">${subOptions(e.categoryId, e.subcategoryId)}</select>` })}
      ${ctl({ key: 'description', label: 'Περιγραφή', required: true, control: (id, d) => `<textarea class="form-control" id="${id}" name="description" data-field="description" rows="5" aria-describedby="${d}">${esc(e.description)}</textarea>` })}
      <div class="col-12"><div class="admin-switch-row">
        <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="f-visible" name="visible" data-field="visible"${e.status === 'archived' ? '' : ' checked'}>
          <label class="form-check-label" for="f-visible">Εμφανίζεται στο κατάστημα</label></div>
        <p class="form-text mb-0">Αν το απενεργοποιήσετε, το προϊόν αρχειοθετείται και κρύβεται από τον κατάλογο, την αναζήτηση και την αρχική.</p>
      </div></div>
      <div class="col-12"><fieldset class="admin-flags"><legend class="form-label">Σημάνσεις</legend>
        ${[['featured', 'Προβεβλημένο (αρχική σελίδα)'], ['new', 'Νέο'], ['bestSeller', 'Best seller']].map(([k, l]) => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="f-flag-${k}" name="flag-${k}" data-flag="${k}"${flags[k] ? ' checked' : ''}><label class="form-check-label" for="f-flag-${k}">${l}</label></div>`).join('')}
      </fieldset></div>
    </div>`, 'basic')}

    ${section('Τιμές', 'Η «Τιμή» είναι η κανονική τιμή. Αν ορίσετε «Τιμή προσφοράς», αυτή χρεώνεται και η κανονική εμφανίζεται διαγραμμένη.', `<div class="row g-3">
      ${ctl({ key: 'price', label: 'Τιμή (€)', required: true, col: 'col-12 col-sm-6', hint: 'Π.χ. 79,90', control: input('price', price.price, 'inputmode="decimal" autocomplete="off"') })}
      ${ctl({ key: 'salePrice', label: 'Τιμή προσφοράς (€)', col: 'col-12 col-sm-6', hint: 'Προαιρετικό· πρέπει να είναι μικρότερη από την τιμή.', control: input('salePrice', price.salePrice, 'inputmode="decimal" autocomplete="off"') })}
      <div class="col-12"><p class="admin-discount" data-discount-preview aria-live="polite"></p></div>
    </div>`, 'pricing')}

    ${section('Εικόνες', 'Η πρώτη εικόνα είναι η κύρια. Προσθέστε με διεύθυνση URL ή ανεβάστε αρχείο (αποθηκεύεται τοπικά στον περιηγητή).', `
      <ul class="admin-images list-unstyled" data-images aria-label="Φωτογραφίες προϊόντος"></ul>
      <div class="admin-image-add">
        <div class="admin-image-url">
          <label class="form-label" for="f-images">Προσθήκη με URL ή διαδρομή</label>
          <div class="input-group">
            <input class="form-control" id="f-images" type="text" data-field="images" autocomplete="off" spellcheck="false" placeholder="https://… ή assets/images/products/…" aria-describedby="err-images hint-images">
            <button type="button" class="btn btn-outline-dark" data-add-image>Προσθήκη</button>
          </div>
          <div class="form-text" id="hint-images">Η προεπισκόπηση εμφανίζεται αυτόματα.</div>
          <div class="admin-url-preview" data-url-preview hidden></div>
        </div>
        <div class="admin-image-file">
          <label class="form-label" for="f-imageFile">Ανέβασμα αρχείου</label>
          <input class="form-control" id="f-imageFile" type="file" accept="image/*" multiple data-image-file>
          <div class="form-text">Έως 5 MB· μετατρέπεται σε WebP έως 1200px.</div>
        </div>
      </div>
      <div class="invalid-feedback" id="err-images" data-error-for="images"></div>
      <p class="admin-image-msg" data-image-msg role="alert" hidden></p>`, 'images')}

    ${section('Χαρακτηριστικά', 'Εμφανίζονται στη σελίδα του προϊόντος.', `<div class="row g-3">
      ${ctl({ key: 'material', label: 'Υλικό', col: 'col-12 col-md-4', control: input('material', a.material || '', 'autocomplete="off"') })}
      ${ctl({ key: 'care', label: 'Φροντίδα', col: 'col-12 col-md-4', control: input('care', a.care || '', 'autocomplete="off"') })}
      ${ctl({ key: 'fit', label: 'Εφαρμογή', col: 'col-12 col-md-4', control: input('fit', a.fit || '', 'autocomplete="off"') })}
    </div>`, 'attributes')}

    ${section('Παραλλαγές', 'Μεγέθη × χρώματα, με SKU και stock ανά παραλλαγή.', `
      <div class="admin-matrix">
        <div class="admin-matrix-col">
          <p class="admin-matrix-title" id="mx-sizes">Μεγέθη</p>
          <ul class="admin-chips list-unstyled" data-size-chips aria-labelledby="mx-sizes"></ul>
          <div class="admin-presets" role="group" aria-label="Έτοιμα σετ μεγεθών">
            <button type="button" class="btn btn-sm btn-outline-dark" data-preset="clothing">Ρούχα XS–XL</button>
            <button type="button" class="btn btn-sm btn-outline-dark" data-preset="shoes">Παπούτσια 36–46</button>
            <button type="button" class="btn btn-sm btn-outline-dark" data-preset="one">Ένα μέγεθος (ONE)</button>
          </div>
          <div class="input-group input-group-sm mt-2">
            <label class="visually-hidden" for="f-sizeInput">Νέο μέγεθος</label>
            <input class="form-control" id="f-sizeInput" type="text" data-size-input data-field="variants" aria-describedby="err-variants" placeholder="π.χ. 38 ή XXL" autocomplete="off" maxlength="12">
            <button type="button" class="btn btn-outline-dark" data-add-size>Προσθήκη μεγέθους</button>
          </div>
        </div>
        <div class="admin-matrix-col">
          <p class="admin-matrix-title" id="mx-colors">Χρώματα</p>
          <ul class="admin-chips list-unstyled" data-color-chips aria-labelledby="mx-colors"></ul>
          <div class="input-group input-group-sm">
            <label class="visually-hidden" for="f-colorName">Όνομα χρώματος</label>
            <input class="form-control" id="f-colorName" type="text" data-color-name placeholder="π.χ. Μαύρο" autocomplete="off" maxlength="30">
            <label class="visually-hidden" for="f-colorHexPick">Επιλογή απόχρωσης</label>
            <input class="form-control form-control-color" id="f-colorHexPick" type="color" value="#222222" data-color-pick title="Επιλογή απόχρωσης">
            <button type="button" class="btn btn-outline-dark" data-add-color>Προσθήκη χρώματος</button>
          </div>
        </div>
      </div>
      <div class="admin-matrix-actions">
        <button type="button" class="btn btn-dark btn-sm" data-generate><i class="bi bi-grid-3x3-gap me-1" aria-hidden="true"></i>Δημιουργία συνδυασμών</button>
        <button type="button" class="btn btn-outline-dark btn-sm" data-add-row><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Προσθήκη γραμμής</button>
        <div class="admin-bulk"><label class="visually-hidden" for="f-bulkStock">Stock για όλες τις παραλλαγές</label>
          <input class="form-control form-control-sm" id="f-bulkStock" type="number" min="0" step="1" value="10" data-bulk-stock>
          <button type="button" class="btn btn-outline-dark btn-sm" data-bulk-apply>Ορισμός stock για όλα</button></div>
      </div>
      <div class="invalid-feedback" id="err-variants" data-error-for="variants"></div>
      <div class="admin-table-wrap admin-variants-wrap" data-variants-wrap></div>`, 'variants')}

    <div class="admin-formbar" data-formbar>
      <p class="admin-dirty" data-dirty-note hidden><i class="bi bi-dot" aria-hidden="true"></i>Μη αποθηκευμένες αλλαγές</p>
      <div class="admin-formbar-btns">
        <button type="button" class="btn btn-outline-dark" data-cancel>Ακύρωση</button>
        <button type="submit" class="btn btn-dark" data-save><span class="spinner-border spinner-border-sm me-2" aria-hidden="true" hidden data-spinner></span><span data-save-label>${isNew ? 'Δημιουργία προϊόντος' : 'Αποθήκευση αλλαγών'}</span></button>
      </div>
    </div>
  </form>`;

  const form = body.querySelector('[data-product-form]');
  const $ = (sel) => form.querySelector(sel);
  const nameEl = $('[data-field="name"]');
  const slugEl = $('[data-field="slug"]');
  const catEl = $('[data-field="categoryId"]');
  const subEl = $('[data-field="subcategoryId"]');

  function markDirty() {
    dirty = true;
    $('[data-dirty-note]').hidden = false;
  }

  // ---- errors -------------------------------------------------------------------------------
  function clearErrors() {
    form.querySelectorAll('.is-invalid').forEach((el) => { el.classList.remove('is-invalid'); el.removeAttribute('aria-invalid'); });
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; el.classList.remove('d-block'); });
    const sum = $('[data-error-summary]');
    sum.hidden = true;
    sum.innerHTML = '';
  }
  function fieldEl(key) { return form.querySelector(`[data-field="${key}"]`); }
  function showErrors(errors) {
    clearErrors();
    const keys = Object.keys(errors);
    keys.forEach((key) => {
      const el = fieldEl(key);
      const slot = form.querySelector(`[data-error-for="${key}"]`);
      if (slot) { slot.textContent = errors[key]; slot.classList.add('d-block'); }
      if (el) {
        el.classList.add('is-invalid');
        el.setAttribute('aria-invalid', 'true');
        if (slot && slot.id) {
          const cur = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
          if (!cur.includes(slot.id)) el.setAttribute('aria-describedby', [...cur, slot.id].join(' '));
        }
      }
    });
    const sum = $('[data-error-summary]');
    sum.innerHTML = `<p class="fw-semibold mb-1">Διορθώστε ${keys.length} ${keys.length === 1 ? 'πεδίο' : 'πεδία'} πριν την αποθήκευση:</p>
      <ul class="mb-0">${keys.map((k) => `<li><button type="button" class="btn btn-link p-0 admin-error-link" data-focus-field="${esc(k)}">${esc(labelFor(k))}</button>: ${esc(errors[k])}</li>`).join('')}</ul>`;
    sum.hidden = false;
    const first = keys.map(fieldEl).find(Boolean);
    if (first) first.focus();
    else sum.focus();
  }
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-focus-field]');
    if (b) fieldEl(b.dataset.focusField)?.focus();
  });
  form.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains('is-invalid')) {
      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
      const slot = form.querySelector(`[data-error-for="${el.dataset.field}"]`);
      if (slot) { slot.textContent = ''; slot.classList.remove('d-block'); }
    }
  });

  // ---- basic -------------------------------------------------------------------------------
  nameEl.addEventListener('input', () => { if (!slugTouched) slugEl.value = slugify(nameEl.value); });
  slugEl.addEventListener('input', () => { slugTouched = slugEl.value.trim() !== ''; });
  catEl.addEventListener('change', () => { subEl.innerHTML = subOptions(catEl.value, ''); });
  const currentSlug = () => slugEl.value.trim() || slugify(nameEl.value) || 'item';

  // ---- price preview -------------------------------------------------------------------------
  const preview = $('[data-discount-preview]');
  function updateDiscount() {
    const p = pricingFromForm({ price: $('[data-field="price"]').value, salePrice: $('[data-field="salePrice"]').value });
    const pct = discountPercent(p.priceCents, p.compareAtCents);
    if (pct) preview.textContent = `Έκπτωση ${pct}% — οι πελάτες πληρώνουν ${formatMoney(p.priceCents)} αντί για ${formatMoney(p.compareAtCents)}.`;
    else if (p.compareAtCents && p.priceCents && p.compareAtCents <= p.priceCents) preview.textContent = 'Η τιμή προσφοράς πρέπει να είναι μικρότερη από την τιμή.';
    else preview.textContent = p.priceCents ? `Τιμή πώλησης: ${formatMoney(p.priceCents)}` : '';
  }
  form.addEventListener('input', (ev) => { if (ev.target.matches('[data-field="price"], [data-field="salePrice"]')) updateDiscount(); });
  updateDiscount();

  // ---- images --------------------------------------------------------------------------------
  const imagesEl = $('[data-images]');
  const imageMsg = $('[data-image-msg]');
  const urlInput = $('[data-field="images"]');
  const urlPreview = $('[data-url-preview]');
  const isData = (s) => s.startsWith('data:');
  const imgLabel = (s) => (isData(s) ? 'Τοπικό αρχείο (αποθηκεύτηκε στον περιηγητή)' : s);

  function renderImages(focus) {
    imagesEl.innerHTML = st.images.length ? st.images.map((src, i) => `<li class="admin-image" data-image-index="${i}">
      <img class="admin-image-thumb" src="${esc(smOf(src))}" alt="Φωτογραφία ${i + 1}" width="64" height="85">
      <div class="admin-image-info"><span class="admin-image-n">${i === 0 ? 'Κύρια φωτογραφία' : `Φωτογραφία ${i + 1}`}</span><span class="admin-image-src" title="${isData(src) ? '' : esc(src)}">${esc(imgLabel(src))}</span></div>
      <div class="admin-image-btns">
        <button type="button" class="btn btn-sm btn-outline-dark" data-img-up="${i}" aria-label="Μετακίνηση της φωτογραφίας ${i + 1} πιο πάνω"${i === 0 ? ' disabled' : ''}><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
        <button type="button" class="btn btn-sm btn-outline-dark" data-img-down="${i}" aria-label="Μετακίνηση της φωτογραφίας ${i + 1} πιο κάτω"${i === st.images.length - 1 ? ' disabled' : ''}><i class="bi bi-arrow-down" aria-hidden="true"></i></button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-img-remove="${i}" aria-label="Αφαίρεση της φωτογραφίας ${i + 1}"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      </div></li>`).join('') : '<li class="admin-image-empty">Δεν έχουν προστεθεί φωτογραφίες.</li>';
    imagesEl.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => {
      im.replaceWith(Object.assign(document.createElement('span'), { className: 'admin-image-thumb admin-image-broken', textContent: 'Δεν φορτώθηκε' }));
    }, { once: true }));
    if (focus) imagesEl.querySelector(focus)?.focus();
  }
  imagesEl.addEventListener('click', (ev) => {
    const up = ev.target.closest('[data-img-up]');
    const down = ev.target.closest('[data-img-down]');
    const rm = ev.target.closest('[data-img-remove]');
    if (up) { const i = Number(up.dataset.imgUp); [st.images[i - 1], st.images[i]] = [st.images[i], st.images[i - 1]]; markDirty(); renderImages(`[data-img-up="${i - 1}"]:not(:disabled), [data-img-down="${i - 1}"]`); }
    else if (down) { const i = Number(down.dataset.imgDown); [st.images[i + 1], st.images[i]] = [st.images[i], st.images[i + 1]]; markDirty(); renderImages(`[data-img-down="${i + 1}"]:not(:disabled), [data-img-up="${i + 1}"]`); }
    else if (rm) { st.images.splice(Number(rm.dataset.imgRemove), 1); markDirty(); renderImages(); urlInput.focus(); }
  });
  const say = (msg) => { imageMsg.textContent = msg; imageMsg.hidden = !msg; };
  let previewSeq = 0;
  async function updateUrlPreview() {
    const v = urlInput.value.trim();
    const seq = ++previewSeq;
    if (!v) { urlPreview.hidden = true; urlPreview.innerHTML = ''; return; }
    urlPreview.hidden = false;
    urlPreview.className = 'admin-url-preview is-loading';
    urlPreview.textContent = 'Φόρτωση προεπισκόπησης…';
    const ok = await probeImage(v);
    if (seq !== previewSeq) return;
    if (ok) {
      urlPreview.className = 'admin-url-preview is-ok';
      urlPreview.innerHTML = '<img alt="Προεπισκόπηση εικόνας" width="48" height="64"><span>Η εικόνα φορτώθηκε.</span>';
      urlPreview.querySelector('img').src = v;
    } else {
      urlPreview.className = 'admin-url-preview is-error';
      urlPreview.innerHTML = '<i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span>Η εικόνα δεν φορτώθηκε. Ελέγξτε τη διεύθυνση.</span>';
    }
  }
  let urlTimer = null;
  urlInput.addEventListener('input', () => { clearTimeout(urlTimer); say(''); urlTimer = setTimeout(updateUrlPreview, 300); });
  async function addUrl() {
    const v = urlInput.value.trim();
    say('');
    if (!v) { say('Εισάγετε πρώτα μια διεύθυνση εικόνας.'); urlInput.focus(); return; }
    if (!(await probeImage(v))) { await updateUrlPreview(); say('Η εικόνα δεν φορτώθηκε, οπότε δεν προστέθηκε.'); urlInput.focus(); return; }
    st.images.push(v);
    urlInput.value = '';
    previewSeq += 1;
    urlPreview.hidden = true;
    urlPreview.innerHTML = '';
    markDirty();
    renderImages();
    const slot = $('[data-error-for="images"]');
    slot.textContent = ''; slot.classList.remove('d-block'); urlInput.classList.remove('is-invalid'); urlInput.removeAttribute('aria-invalid');
  }
  $('[data-add-image]').addEventListener('click', addUrl);
  urlInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addUrl(); } });
  $('[data-image-file]').addEventListener('change', async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    const problems = [];
    for (const f of files) {
      try { st.images.push(await fileToDataUrl(f)); markDirty(); } catch (err) { problems.push(err.message); }
    }
    renderImages();
    say(problems.join(' '));
    if (files.length && !problems.length) { const slot = $('[data-error-for="images"]'); slot.textContent = ''; slot.classList.remove('d-block'); }
  });
  renderImages();

  // ---- variants -----------------------------------------------------------------------------
  const sizeChips = $('[data-size-chips]');
  const colorChips = $('[data-color-chips]');
  const variantsWrap = $('[data-variants-wrap]');

  function renderChips() {
    sizeChips.innerHTML = st.sizes.length ? st.sizes.map((s, i) => `<li class="admin-chip"><span>${esc(s)}</span><button type="button" data-rm-size="${i}" aria-label="Αφαίρεση μεγέθους ${esc(s)}"><i class="bi bi-x" aria-hidden="true"></i></button></li>`).join('') : '<li class="admin-chip-empty">Κανένα μέγεθος ακόμη</li>';
    colorChips.innerHTML = st.colors.length ? st.colors.map((c, i) => `<li class="admin-chip"><span class="swatch" style="background:${esc(c.hex)}" aria-hidden="true"></span><span>${esc(c.name)}</span><button type="button" data-rm-color="${i}" aria-label="Αφαίρεση χρώματος ${esc(c.name)}"><i class="bi bi-x" aria-hidden="true"></i></button></li>`).join('') : '<li class="admin-chip-empty">Κανένα χρώμα ακόμη</li>';
  }
  function addSizes(list) {
    for (const s of list) { const v = String(s).trim().toUpperCase() === 'ONE' ? 'ONE' : String(s).trim(); if (v && !st.sizes.includes(v)) st.sizes.push(v); }
    st.sizes.sort(compareSizes);
    renderChips();
    markDirty();
  }
  form.addEventListener('click', (ev) => {
    const preset = ev.target.closest('[data-preset]');
    if (preset) { addSizes(SIZE_PRESETS[preset.dataset.preset]); return; }
    if (ev.target.closest('[data-add-size]')) { const i = $('[data-size-input]'); addSizes(i.value.split(/[\s,;]+/)); i.value = ''; i.focus(); return; }
    const rs = ev.target.closest('[data-rm-size]');
    if (rs) { st.sizes.splice(Number(rs.dataset.rmSize), 1); renderChips(); markDirty(); return; }
    const rc = ev.target.closest('[data-rm-color]');
    if (rc) { st.colors.splice(Number(rc.dataset.rmColor), 1); renderChips(); markDirty(); return; }
    if (ev.target.closest('[data-add-color]')) {
      const n = $('[data-color-name]');
      const name = n.value.trim();
      if (!name) { n.focus(); toast('Δώστε όνομα χρώματος.', 'danger'); return; }
      if (!st.colors.some((c) => c.name.toLowerCase() === name.toLowerCase())) st.colors.push({ name, hex: $('[data-color-pick]').value });
      n.value = '';
      renderChips();
      markDirty();
      n.focus();
      return;
    }
    if (ev.target.closest('[data-generate]')) {
      if (!st.sizes.length || !st.colors.length) { toast('Προσθέστε τουλάχιστον ένα μέγεθος και ένα χρώμα.', 'danger'); return; }
      st.variants = generateVariantMatrix({ sizes: st.sizes, colors: st.colors, slug: currentSlug(), existing: st.variants, stock: 0 });
      markDirty();
      renderVariants();
      return;
    }
    if (ev.target.closest('[data-add-row]')) { st.variants.push(blankRow()); markDirty(); renderVariants(`[data-variant-index="${st.variants.length - 1}"] input`); return; }
    if (ev.target.closest('[data-bulk-apply]')) {
      const n = Number($('[data-bulk-stock]').value);
      if (!Number.isInteger(n) || n < 0) { toast('Το stock πρέπει να είναι ακέραιος αριθμός ≥ 0.', 'danger'); return; }
      st.variants.forEach((v) => { v.stock = n; });
      markDirty();
      renderVariants();
      return;
    }
    const rm = ev.target.closest('[data-rm-variant]');
    if (rm) {
      const i = Number(rm.dataset.rmVariant);
      st.variants.splice(i, 1);
      markDirty();
      renderVariants();
      $('[data-add-row]').focus();
    }
  });
  $('[data-size-input]').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('[data-add-size]').click(); } });
  $('[data-color-name]').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('[data-add-color]').click(); } });

  function renderVariants(focusSel) {
    if (!st.variants.length) {
      variantsWrap.innerHTML = '<p class="admin-empty-line" data-no-variants>Δεν υπάρχουν παραλλαγές. Επιλέξτε μεγέθη και χρώματα και πατήστε «Δημιουργία συνδυασμών».</p>';
      return;
    }
    const cell = (i, f, label, inner) => `<td data-label="${label}"><div>${inner}<div class="invalid-feedback" id="err-v${i}-${f}" data-error-for="variants[${i}].${f}"></div></div></td>`;
    variantsWrap.innerHTML = `<table class="table admin-table admin-table-stack admin-variants-table" data-variants-table>
      <caption class="visually-hidden">Παραλλαγές προϊόντος</caption>
      <thead><tr><th scope="col">Μέγεθος</th><th scope="col">Χρώμα</th><th scope="col">Κωδικός χρώματος</th><th scope="col">SKU</th><th scope="col">Stock</th><th scope="col"><span class="visually-hidden">Αφαίρεση</span></th></tr></thead>
      <tbody>${st.variants.map((v, i) => {
    const f = (name) => `data-vf="${name}" data-field="variants[${i}].${name}" aria-label="${VARIANT_LABELS[name]} παραλλαγής ${i + 1}" aria-describedby="err-v${i}-${name}"`;
    return `<tr data-variant-index="${i}">
        ${cell(i, 'size', 'Μέγεθος', `<input class="form-control form-control-sm" type="text" value="${esc(v.size)}" maxlength="12" ${f('size')}>`)}
        ${cell(i, 'color', 'Χρώμα', `<input class="form-control form-control-sm" type="text" value="${esc(v.color)}" maxlength="30" ${f('color')}>`)}
        ${cell(i, 'colorHex', 'Κωδικός χρώματος', `<div class="admin-hex"><input class="form-control form-control-color form-control-sm" type="color" tabindex="-1" aria-hidden="true" value="${isValidHex(v.colorHex) ? esc(v.colorHex) : '#222222'}" data-vpick><input class="form-control form-control-sm" type="text" value="${esc(v.colorHex)}" maxlength="7" spellcheck="false" ${f('colorHex')}></div>`)}
        ${cell(i, 'sku', 'SKU', `<input class="form-control form-control-sm" type="text" value="${esc(v.sku)}" maxlength="40" spellcheck="false" placeholder="αυτόματο"${v.persisted ? ' readonly title="Το SKU υπάρχουσας παραλλαγής δεν αλλάζει"' : ''} ${f('sku')}>`)}
        ${cell(i, 'stock', 'Stock', `<input class="form-control form-control-sm" type="number" min="0" step="1" inputmode="numeric" value="${esc(v.stock)}" ${f('stock')}>`)}
        <td data-label="Ενέργειες"><button type="button" class="btn btn-sm btn-outline-danger" data-rm-variant="${i}" aria-label="Αφαίρεση παραλλαγής ${i + 1}${v.size && v.color ? `: ${esc(v.size)} / ${esc(v.color)}` : ''}"><i class="bi bi-trash3" aria-hidden="true"></i><span class="admin-action-label">Αφαίρεση</span></button></td>
      </tr>`;
  }).join('')}</tbody></table>`;
    if (focusSel) variantsWrap.querySelector(focusSel)?.focus();
  }
  variantsWrap.addEventListener('input', (ev) => {
    const el = ev.target;
    const tr = el.closest('tr[data-variant-index]');
    if (!tr) return;
    const row = st.variants[Number(tr.dataset.variantIndex)];
    if (el.matches('[data-vpick]')) {
      row.colorHex = el.value;
      tr.querySelector('[data-vf="colorHex"]').value = el.value;
      return;
    }
    const f = el.dataset.vf;
    if (!f) return;
    row[f] = el.value;
    if (f === 'colorHex' && isValidHex(el.value)) tr.querySelector('[data-vpick]').value = el.value;
  });

  // ---- save ---------------------------------------------------------------------------------
  function collect() {
    const pr = pricingFromForm({ price: $('[data-field="price"]').value, salePrice: $('[data-field="salePrice"]').value });
    const attrs = { ...(existing ? existing.attributes : {}) };
    for (const k of ['material', 'care', 'fit']) {
      const v = $(`[data-field="${k}"]`).value.trim();
      if (v) attrs[k] = v; else delete attrs[k];
    }
    const input = {
      id: existing ? existing.id : undefined,
      name: nameEl.value,
      slug: slugEl.value,
      brand: $('[data-field="brand"]').value,
      categoryId: catEl.value,
      subcategoryId: subEl.value,
      description: $('[data-field="description"]').value,
      priceCents: pr.priceCents,
      compareAtCents: pr.compareAtCents,
      images: [...st.images],
      attributes: attrs,
      flags: Object.fromEntries(['featured', 'new', 'bestSeller'].map((k) => [k, $(`[data-flag="${k}"]`).checked])),
      status: $('[data-field="visible"]').checked ? 'active' : 'archived',
      variants: st.variants.map(({ persisted, ...v }) => v),
    };
    return { input, priceErrors: pr.errors };
  }
  const toFormErrors = (errs) => {
    const out = {};
    for (const [k, v] of Object.entries(errs)) out[k === 'priceCents' ? 'price' : k === 'compareAtCents' ? 'salePrice' : k] = v;
    return out;
  };

  const saveBtn = $('[data-save]');
  const setSaving = (on) => {
    saving = on;
    saveBtn.disabled = on;
    $('[data-spinner]').hidden = !on;
    $('[data-save-label]').textContent = on ? 'Αποθήκευση…' : (isNew ? 'Δημιουργία προϊόντος' : 'Αποθήκευση αλλαγών');
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saving) return;
    const { input, priceErrors } = collect();
    const others = catalog.products.filter((p) => !existing || p.id !== existing.id);
    const res = validateProductInput(input, {
      existingProducts: others,
      existingSkus: catalog.variants.map((v) => ({ sku: v.sku, productId: v.productId })),
      categories: cats,
      editingId: existing ? existing.id : null,
    });
    const errors = { ...toFormErrors(res.errors), ...priceErrors };
    if (Object.keys(errors).length) { showErrors(errors); return; }
    clearErrors();
    setSaving(true);
    try {
      const saved = await saveProduct(input);
      dirty = false;
      toast(isNew ? `Το προϊόν «${saved.name}» δημιουργήθηκε.` : `Οι αλλαγές στο «${saved.name}» αποθηκεύτηκαν.`, 'success');
      navigate(`#/admin/products/${saved.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (err && err.code === 'invalid') showErrors(toFormErrors(err.errors));
      else { console.warn('Save failed', err); toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger'); }
    }
  });

  // ---- unsaved-changes guard ---------------------------------------------------------------
  const leave = (msg) => confirmDialog(msg, { title: 'Μη αποθηκευμένες αλλαγές', okLabel: 'Αποχώρηση χωρίς αποθήκευση', cancelLabel: 'Παραμονή', danger: true });
  const LEAVE_MSG = 'Έχετε αλλαγές που δεν έχουν αποθηκευτεί. Αν αποχωρήσετε, θα χαθούν.';
  $('[data-cancel]').addEventListener('click', async () => {
    if (dirty && !(await leave(LEAVE_MSG))) return;
    dirty = false;
    navigate('#/admin/products');
  });
  // The router asks before replacing this page (links, breadcrumbs, back/forward); reload/close use beforeunload.
  setNavigationGuard(() => (!dirty || !root.isConnected ? true : leave(LEAVE_MSG)));
  const onUnload = (ev) => {
    if (!root.isConnected) { window.removeEventListener('beforeunload', onUnload); return; }
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onUnload);

  form.addEventListener('input', (ev) => { if (!ev.target.matches('[data-image-file], [data-bulk-stock], [data-size-input], [data-color-name], [data-color-pick], #f-images')) markDirty(); });
  form.addEventListener('change', (ev) => { if (ev.target.matches('select, [type="checkbox"]')) markDirty(); });

  renderChips();
  renderVariants();
  view.dataset.ready = 'true';
}

export default renderEditor;
