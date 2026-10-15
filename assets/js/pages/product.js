import { getAll } from '../db.js';
import { html, escapeHtml as esc, formatMoney, toast } from '../ui.js';
import { getProduct, listRelated, compareSizes, sizeLabel, findVariant } from '../services/products.js';
import { getSettings } from '../services/settings.js';
import { addLine, getCartRecord } from '../services/cart.js';
import { listReviews, addReview, summarizeReviews, validateReview } from '../services/reviews.js';
import { sizeChartFor } from '../services/size-charts.js';
import { productCard, discountPercent, priceHtml, wishIds, bindWishlistEvents } from '../components/product-card.js';
import { quickViewModal } from '../components/modals.js';
import { createGallery } from '../components/gallery.js';

const LOW_STOCK = 5;
const ATTR_LABELS = {
  material: 'Υλικό', composition: 'Σύνθεση', fit: 'Εφαρμογή', length: 'Μήκος', sleeve: 'Μανίκι',
  sole: 'Σόλα', lining: 'Φόδρα', heel: 'Τακούνι', dimensions: 'Διαστάσεις', lens: 'Φακοί',
};

const fmtAvg = (n) => n.toFixed(1).replace('.', ',');
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('el-GR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
};
const stars = (n) => `<span class="stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="bi ${i <= Math.round(n) ? 'bi-star-fill' : 'bi-star'}"></i>`).join('')}</span>`;

function notFound() {
  return html(`<section class="page" data-page="product-not-found" data-route="/product">
    <div class="container-xl"><div class="placeholder-panel">
      <span class="eyebrow">Το προϊόν δεν είναι διαθέσιμο</span>
      <h1 class="display-title">Το προϊόν δεν βρέθηκε</h1>
      <p class="lead-text">Το προϊόν που αναζητάτε δεν υπάρχει ή δεν είναι πλέον διαθέσιμο. Συνεχίστε την περιήγηση στον κατάλογο.</p>
      <div class="d-flex flex-wrap justify-content-center gap-2 mt-4">
        <a class="btn btn-dark" href="#/catalog">Δείτε τον κατάλογο</a>
        <a class="btn btn-outline-dark" href="#/">Αρχική</a>
      </div>
    </div></div>
  </section>`);
}

function sizeChartModal(product) {
  const c = sizeChartFor(product);
  const table = c.rows.length
    ? `<div class="table-responsive"><table class="table table-sm size-table">
        <thead><tr>${c.headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${c.rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`
    : '';
  return html(`<div class="modal fade modal-elan" id="sizeChartModal" tabindex="-1" aria-labelledby="sizeChartTitle" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h5" id="sizeChartTitle">${esc(c.title)}</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
        </div>
        <div class="modal-body">
          ${table}
          <p class="${c.rows.length ? 'small text-body-secondary mt-3' : 'lead-text'} mb-0">${esc(c.note)}</p>
        </div>
      </div>
    </div>
  </div>`);
}

export default async function render(ctx) {
  const slug = ctx.params.slug;
  const query = ctx.query || {};
  const product = await getProduct(slug);
  if (!product || product.status === 'archived') return notFound();

  const [categories, settings, cart, related] = await Promise.all([
    getAll('categories'),
    getSettings(),
    getCartRecord(),
    listRelated(product, 4),
  ]);
  bindWishlistEvents();

  const catName = (id) => categories.find((c) => c.id === id)?.name;
  const variants = product.variants;
  const colors = [];
  for (const v of variants) if (!colors.find((c) => c.name === v.color)) colors.push({ name: v.color, hex: v.colorHex });
  const sizes = [...new Set(variants.map((v) => String(v.size)))].sort(compareSizes);
  const cartQty = (sku) => cart.lines.find((l) => l.sku === sku)?.qty || 0;
  const colorInStock = (c) => variants.some((v) => v.color === c && v.stock > 0);

  // ---- state ----
  let color = colors.find((c) => c.name === query.color)?.name
    || (colors.find((c) => colorInStock(c.name)) || colors[0] || {}).name;
  let size = null;
  const initialSize = query.size != null ? String(query.size) : null;
  if (initialSize && findVariant(variants, initialSize, color)?.stock > 0) size = initialSize;
  else if (sizes.length === 1 && findVariant(variants, sizes[0], color)?.stock > 0) size = sizes[0];
  let qty = 1;

  const pct = discountPercent(product);
  const gallery = createGallery({ images: product.images || [], name: product.name });
  const chartModal = sizeChartModal(product);

  const catId = product.categoryId;
  const subId = product.subcategoryId;
  const attrs = Object.entries(product.attributes || {}).filter(([k, v]) => k !== 'care' && v);
  const care = product.attributes?.care;

  const root = html(`<section class="page pdp" data-page="product" data-route="/product" data-product-id="${esc(product.id)}">
    <div class="container-xl">
      <nav aria-label="Breadcrumb"><ol class="breadcrumb pdp-crumbs">
        <li class="breadcrumb-item"><a href="#/">Αρχική</a></li>
        ${catName(catId) ? `<li class="breadcrumb-item"><a href="#/catalog/${esc(catId)}">${esc(catName(catId))}</a></li>` : ''}
        ${subId && catName(subId) ? `<li class="breadcrumb-item"><a href="#/catalog/${esc(catId)}?sub=${esc(subId)}">${esc(catName(subId))}</a></li>` : ''}
        <li class="breadcrumb-item active" aria-current="page">${esc(product.name)}</li>
      </ol></nav>
      <div class="pdp-layout">
        <div data-gallery-slot></div>
        <div class="pdp-info">
          <p class="product-card-brand">${esc(product.brand)}</p>
          <h1 class="pdp-title">${esc(product.name)}</h1>
          <a class="pdp-rating-link" href="#reviews" data-rating-link></a>
          <div class="pdp-price">
            ${priceHtml(product, true)}
            ${pct ? `<span class="badge-elan badge-sale" data-discount>-${pct}%</span>` : ''}
          </div>
          <p class="price-note small text-body-secondary">Οι τιμές περιλαμβάνουν ΦΠΑ.</p>

          <div class="pdp-group">
            <p class="pdp-label">Χρώμα: <strong data-color-name></strong></p>
            <div class="pdp-colors" role="group" aria-label="Επιλογή χρώματος">
              ${colors.map((c) => `<button type="button" class="pdp-color" data-color="${esc(c.name)}" aria-pressed="false" aria-label="Χρώμα ${esc(c.name)}" title="${esc(c.name)}"><span class="swatch" style="background:${esc(c.hex)}"></span></button>`).join('')}
            </div>
          </div>

          <div class="pdp-group">
            <div class="d-flex justify-content-between align-items-baseline">
              <p class="pdp-label mb-2" id="sizeLabel">Μέγεθος</p>
              <button type="button" class="btn btn-link pdp-chart-link" data-size-chart-open aria-haspopup="dialog">Οδηγός μεγεθών</button>
            </div>
            <div class="pdp-sizes" role="group" aria-labelledby="sizeLabel" data-sizes></div>
          </div>

          <p class="pdp-stock" data-stock role="status" aria-live="polite"></p>

          <div class="pdp-buy">
            <div class="qty-stepper" role="group" aria-label="Ποσότητα">
              <button type="button" class="qty-btn" data-qty-minus aria-label="Μείωση ποσότητας"><i class="bi bi-dash" aria-hidden="true"></i></button>
              <input class="qty-input" data-qty-input type="number" inputmode="numeric" min="1" value="1" aria-label="Ποσότητα">
              <button type="button" class="qty-btn" data-qty-plus aria-label="Αύξηση ποσότητας"><i class="bi bi-plus" aria-hidden="true"></i></button>
            </div>
            <button type="button" class="btn btn-dark btn-lg pdp-add" data-add>Προσθήκη στο καλάθι</button>
            <button type="button" class="pdp-wish" data-wish-btn aria-pressed="false" aria-label="Προσθήκη στα αγαπημένα"><i class="bi bi-heart" aria-hidden="true"></i></button>
          </div>
          <p class="pdp-hint" data-hint hidden></p>

          <div class="pdp-trust">
            <span><i class="bi bi-truck" aria-hidden="true"></i> Δωρεάν αποστολή άνω των ${esc(formatMoney(settings.freeShippingThresholdCents ?? 6000))}</span>
            <span><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Επιστροφές εντός 14 ημερών (demo)</span>
          </div>
        </div>
      </div>

      <div class="pdp-details">
        <section aria-labelledby="descTitle" class="pdp-block">
          <h2 class="pdp-h2" id="descTitle">Περιγραφή</h2>
          <p>${esc(product.description || '')}</p>
        </section>
        <section aria-labelledby="specTitle" class="pdp-block" data-specs>
          <h2 class="pdp-h2" id="specTitle">Χαρακτηριστικά</h2>
          <dl class="pdp-specs">
            ${attrs.map(([k, v]) => `<div><dt>${esc(ATTR_LABELS[k] || k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
          </dl>
        </section>
        <section aria-labelledby="careTitle" class="pdp-block" data-care>
          <h2 class="pdp-h2" id="careTitle">Υλικά και φροντίδα</h2>
          <p class="mb-1"><strong>Υλικό:</strong> ${esc(product.attributes?.composition || product.attributes?.material || '—')}</p>
          <p class="mb-0"><strong>Φροντίδα:</strong> ${esc(care || 'Ακολουθήστε τις οδηγίες της ετικέτας.')}</p>
        </section>
        <section aria-labelledby="shipTitle" class="pdp-block" data-shipping>
          <h2 class="pdp-h2" id="shipTitle">Αποστολή και επιστροφές</h2>
          <ul class="pdp-list">
            <li>Αποστολή με courier: ${esc(formatMoney(settings.courierCents ?? 390))}.</li>
            <li>Δωρεάν αποστολή για παραγγελίες άνω των ${esc(formatMoney(settings.freeShippingThresholdCents ?? 6000))}.</li>
            <li>Παράδοση σε 1–3 εργάσιμες ημέρες (ενδεικτικά).</li>
            <li>Επιστροφές εντός 14 ημερών από την παραλαβή, με τα προϊόντα αχρησιμοποίητα και στην αρχική τους συσκευασία.</li>
          </ul>
          <p class="small text-body-secondary mb-0"><i class="bi bi-info-circle" aria-hidden="true"></i> Η πολιτική επιστροφών είναι ενδεικτική και ισχύει μόνο για το demo.</p>
        </section>
      </div>

      <section class="pdp-reviews" id="reviews" aria-labelledby="reviewsTitle" data-reviews>
        <h2 class="pdp-h2" id="reviewsTitle">Κριτικές πελατών</h2>
        <div class="pdp-reviews-grid">
          <div data-review-summary></div>
          <div>
            <div data-review-list></div>
            <form class="review-form" id="reviewForm" novalidate>
              <h3 class="h5">Γράψε κριτική</h3>
              <p class="small text-body-secondary">Οι κριτικές αποθηκεύονται μόνο σε αυτόν τον περιηγητή (demo) και δεν αποστέλλονται πουθενά.</p>
              <fieldset class="mb-3">
                <legend class="form-label">Βαθμολογία</legend>
                <div class="rating-input">
                  ${[1, 2, 3, 4, 5].map((i) => `<input class="visually-hidden" type="radio" name="rating" id="rate${i}" value="${i}"><label for="rate${i}" title="${i} από 5"><i class="bi bi-star-fill" aria-hidden="true"></i><span class="visually-hidden">${i} από 5</span></label>`).join('')}
                </div>
                <div class="invalid-feedback" data-err="rating"></div>
              </fieldset>
              <div class="mb-3">
                <label class="form-label" for="rvTitle">Τίτλος</label>
                <input class="form-control" id="rvTitle" name="title" maxlength="80" autocomplete="off">
                <div class="invalid-feedback" data-err="title"></div>
              </div>
              <div class="mb-3">
                <label class="form-label" for="rvBody">Η κριτική σας</label>
                <textarea class="form-control" id="rvBody" name="body" rows="3" maxlength="1000"></textarea>
                <div class="invalid-feedback" data-err="body"></div>
              </div>
              <div class="mb-3">
                <label class="form-label" for="rvName">Όνομα</label>
                <input class="form-control" id="rvName" name="name" maxlength="40" autocomplete="given-name">
                <div class="invalid-feedback" data-err="name"></div>
              </div>
              <button class="btn btn-dark" type="submit">Υποβολή κριτικής</button>
            </form>
          </div>
        </div>
      </section>

      ${related.length ? `<section class="pdp-related" aria-labelledby="relTitle">
        <h2 class="pdp-h2" id="relTitle">Μπορεί επίσης να σας αρέσουν</h2>
        <div class="product-grid pdp-related-grid" data-related></div>
      </section>` : ''}
    </div>
  </section>`);

  root.querySelector('[data-gallery-slot]').replaceWith(gallery.el);
  root.append(gallery.lightbox, chartModal);

  const $ = (sel) => root.querySelector(sel);
  const sizesEl = $('[data-sizes]');
  const stockEl = $('[data-stock]');
  const hintEl = $('[data-hint]');
  const addBtn = $('[data-add]');
  const qtyInput = $('[data-qty-input]');
  const plus = $('[data-qty-plus]');
  const minus = $('[data-qty-minus]');

  const current = () => (size != null ? findVariant(variants, size, color) : null);
  const remaining = () => {
    const v = current();
    return v ? Math.max(0, v.stock - cartQty(v.sku)) : 0;
  };

  function syncUrl() {
    const params = new URLSearchParams();
    if (colors.length > 1 && color) params.set('color', color);
    if (size != null) params.set('size', size);
    const qs = params.toString();
    history.replaceState(history.state, '', `#/product/${encodeURIComponent(product.slug)}${qs ? `?${qs}` : ''}`);
  }

  function update() {
    root.querySelectorAll('[data-color]').forEach((b) => {
      const on = b.dataset.color === color;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-soldout', !colorInStock(b.dataset.color));
    });
    $('[data-color-name]').textContent = color || '';

    sizesEl.innerHTML = sizes.map((s) => {
      const v = findVariant(variants, s, color);
      const state = !v ? 'na' : v.stock <= 0 ? 'out' : 'ok';
      const label = state === 'out' ? 'Εξαντλημένο' : state === 'na' ? 'Μη διαθέσιμο' : '';
      const on = size === s;
      return `<button type="button" class="pdp-size${on ? ' is-selected' : ''}${state !== 'ok' ? ' is-disabled' : ''}" data-size="${esc(s)}"
        aria-pressed="${on}" ${state !== 'ok' ? 'disabled' : ''}>
        <span>${esc(sizeLabel(s))}</span>${label ? `<small>${label}</small>` : ''}
      </button>`;
    }).join('');

    const v = current();
    const rem = remaining();
    if (v) {
      if (v.stock <= 0) stockEl.textContent = 'Εξαντλημένο';
      else if (v.stock <= LOW_STOCK) stockEl.textContent = v.stock === 1 ? 'Μόνο 1 διαθέσιμο' : `Μόνο ${v.stock} διαθέσιμα`;
      else stockEl.textContent = 'Διαθέσιμο';
      stockEl.className = `pdp-stock ${v.stock <= 0 ? 'is-out' : v.stock <= LOW_STOCK ? 'is-low' : 'is-ok'}`;
    } else if (!colorInStock(color)) {
      stockEl.textContent = 'Εξαντλημένο';
      stockEl.className = 'pdp-stock is-out';
    } else {
      stockEl.textContent = 'Επιλέξτε μέγεθος για να δείτε τη διαθεσιμότητα';
      stockEl.className = 'pdp-stock';
    }

    qty = Math.min(Math.max(1, qty), Math.max(1, rem));
    qtyInput.value = String(qty);
    qtyInput.max = String(Math.max(1, rem));
    qtyInput.disabled = !v || rem <= 0;
    minus.disabled = !v || rem <= 0 || qty <= 1;
    plus.disabled = !v || rem <= 0 || qty >= rem;

    const canAdd = !!v && rem > 0;
    addBtn.disabled = !canAdd;
    let hint = '';
    if (!v) hint = colorInStock(color) ? 'Επιλέξτε μέγεθος' : 'Δεν υπάρχει διαθέσιμο μέγεθος σε αυτό το χρώμα';
    else if (v.stock <= 0) hint = 'Αυτό το μέγεθος είναι εξαντλημένο';
    else if (rem <= 0) hint = 'Έχετε ήδη στο καλάθι όλη τη διαθέσιμη ποσότητα';
    hintEl.textContent = hint;
    hintEl.hidden = !hint;
  }

  // ---- interactions ----
  root.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-color]');
    if (cb) {
      color = cb.dataset.color;
      const keep = size != null && findVariant(variants, size, color)?.stock > 0;
      if (!keep) size = sizes.length === 1 && findVariant(variants, sizes[0], color)?.stock > 0 ? sizes[0] : null;
      qty = 1;
      update();
      syncUrl();
      return;
    }
    const sb = e.target.closest('[data-size]');
    if (sb && !sb.disabled) {
      size = sb.dataset.size;
      qty = 1;
      update();
      syncUrl();
    }
  });
  plus.addEventListener('click', () => { qty += 1; update(); });
  minus.addEventListener('click', () => { qty -= 1; update(); });
  qtyInput.addEventListener('change', () => {
    qty = Math.floor(Number(qtyInput.value)) || 1;
    update();
  });
  $('[data-size-chart-open]').addEventListener('click', () => {
    window.bootstrap.Modal.getOrCreateInstance(chartModal).show();
  });

  addBtn.addEventListener('click', async () => {
    const v = current();
    if (!v) return;
    addBtn.disabled = true;
    try {
      const r = await addLine(v.sku, qty);
      if (r.ok) {
        cart.lines = r.cart.lines;
        toast(`Προστέθηκε στο καλάθι: ${product.name} (${v.color}, ${sizeLabel(v.size)}) × ${qty}`);
        qty = 1;
      } else {
        const fresh = await getProduct(product.id);
        if (fresh) fresh.variants.forEach((nv) => { const i = variants.findIndex((x) => x.sku === nv.sku); if (i >= 0) variants[i] = nv; });
        cart.lines = (await getCartRecord()).lines;
        toast(r.reason === 'insufficient' && r.available > 0
          ? `Διατίθενται μόνο ${r.available} τεμάχια ακόμη για αυτό το μέγεθος.`
          : 'Το προϊόν δεν είναι διαθέσιμο σε αυτό το μέγεθος.', 'danger');
      }
    } catch {
      toast('Δεν ήταν δυνατή η προσθήκη στο καλάθι. Δοκιμάστε ξανά.', 'danger');
    }
    update();
  });

  // wishlist
  const wishBtn = $('[data-wish-btn]');
  const syncWish = () => {
    const on = wishIds.has(product.id);
    wishBtn.setAttribute('aria-pressed', String(on));
    wishBtn.setAttribute('aria-label', on ? 'Αφαίρεση από τα αγαπημένα' : 'Προσθήκη στα αγαπημένα');
    wishBtn.querySelector('i').className = `bi ${on ? 'bi-heart-fill' : 'bi-heart'}`;
  };
  wishBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wishlist:toggle', { detail: { productId: product.id } }));
  });
  let wasConnected = false;
  const onWish = () => {
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) { window.removeEventListener('wishlist:changed', onWish); return; }
    syncWish();
  };
  window.addEventListener('wishlist:changed', onWish);
  syncWish();

  // reviews
  const summaryEl = $('[data-review-summary]');
  const listEl = $('[data-review-list]');
  const ratingLink = $('[data-rating-link]');
  async function renderReviews() {
    const list = await listReviews(product.id);
    const s = summarizeReviews(list);
    ratingLink.innerHTML = s.count
      ? `${stars(s.average)} <span>${fmtAvg(s.average)}</span> <span class="text-body-secondary">(${s.count})</span>`
      : '<span class="text-body-secondary">Χωρίς κριτικές ακόμη</span>';
    ratingLink.setAttribute('aria-label', s.count ? `Βαθμολογία ${fmtAvg(s.average)} από 5, ${s.count} κριτικές` : 'Χωρίς κριτικές ακόμη');
    summaryEl.innerHTML = `<div class="rating-summary">
        <p class="rating-avg"><span data-avg>${s.count ? fmtAvg(s.average) : '—'}</span><span class="rating-of"> / 5</span></p>
        ${stars(s.average)}
        <p class="small text-body-secondary mb-3" data-review-count>${s.count} ${s.count === 1 ? 'κριτική' : 'κριτικές'}</p>
        <ul class="rating-dist list-unstyled">
          ${[5, 4, 3, 2, 1].map((n) => `<li><span>${n} <i class="bi bi-star-fill" aria-hidden="true"></i></span>
            <span class="rating-bar" aria-hidden="true"><span style="width:${s.count ? Math.round((s.distribution[n] / s.count) * 100) : 0}%"></span></span>
            <span class="rating-n">${s.distribution[n]}</span></li>`).join('')}
        </ul>
      </div>`;
    listEl.innerHTML = list.length
      ? list.map((r) => `<article class="review" data-review>
          <div class="d-flex align-items-center gap-2 flex-wrap">${stars(r.rating)}<span class="visually-hidden">Βαθμολογία ${r.rating} από 5</span>
            <h3 class="review-title">${esc(r.title)}</h3></div>
          <p class="review-body">${esc(r.body)}</p>
          <p class="review-meta">${esc(r.author)} · ${esc(fmtDate(r.createdAt))}${r.local ? ' · <span class="badge-elan">Δική σας κριτική</span>' : ''}</p>
        </article>`).join('')
      : '<p class="review-empty">Δεν υπάρχουν ακόμη κριτικές για αυτό το προϊόν. Γίνετε ο πρώτος που θα γράψει μία!</p>';
  }

  const form = $('#reviewForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const v = validateReview(data);
    form.querySelectorAll('[data-err]').forEach((n) => {
      const msg = v.errors[n.dataset.err];
      n.textContent = msg || '';
      n.classList.toggle('d-block', !!msg);
      const input = form.elements[n.dataset.err];
      if (input && input.classList) input.classList.toggle('is-invalid', !!msg);
    });
    if (!v.ok) {
      const first = Object.keys(v.errors)[0];
      const target = form.elements[first];
      (target instanceof RadioNodeList ? target[0] : target)?.focus();
      return;
    }
    await addReview({ productId: product.id, ...v.value });
    form.reset();
    await renderReviews();
    toast('Ευχαριστούμε! Η κριτική σας αποθηκεύτηκε σε αυτόν τον περιηγητή.');
  });

  // related
  const relatedEl = $('[data-related]');
  if (relatedEl) {
    related.forEach((p) => relatedEl.append(productCard(p, {
      onQuickView: (prod, btn) => quickViewModal(prod, { returnFocus: btn }),
    })));
  }

  update();
  if (query.color || query.size) syncUrl();
  await renderReviews();
  return root;
}
