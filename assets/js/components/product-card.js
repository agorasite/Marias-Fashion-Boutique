import { escapeHtml as esc, formatMoney } from '../ui.js';

// Wishlist visual state is driven only by `wishlist:changed` events (Task 8 owns persistence).
export const wishIds = new Set();
let wishBound = false;
let seenVersion = 0;

function syncWishButtons() {
  document.querySelectorAll('[data-wish]').forEach((b) => {
    const on = wishIds.has(b.dataset.wish);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', `${on ? 'Αφαίρεση από τα αγαπημένα' : 'Προσθήκη στα αγαπημένα'}: ${b.dataset.name}`);
    b.querySelector('i').className = `bi ${on ? 'bi-heart-fill' : 'bi-heart'}`;
  });
}

export function bindWishlistEvents() {
  if (wishBound) return;
  wishBound = true;
  // Hydrate hearts from the persisted wishlist (events only carry changes).
  import('../services/wishlist.js').then((m) => m.snapshot()).then(({ ids, version }) => {
    window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { ids, productId: null, active: null, version } }));
  }).catch(() => {});
  window.addEventListener('wishlist:changed', (e) => {
    const d = e.detail || {};
    if (Number.isFinite(d.version)) {
      if (d.version < seenVersion) return; // stale snapshot
      seenVersion = d.version;
    }
    if (Array.isArray(d.ids)) {
      wishIds.clear();
      d.ids.forEach((i) => wishIds.add(i));
    } else if (d.productId) {
      if (d.active === false) wishIds.delete(d.productId);
      else wishIds.add(d.productId);
    }
    syncWishButtons();
  });
}

export const productSizes = (p) => [...new Set((p.variants || []).map((v) => v.size))];
export function productColors(p) {
  const m = new Map();
  (p.variants || []).forEach((v) => { if (!m.has(v.color)) m.set(v.color, v.colorHex); });
  return [...m].map(([name, hex]) => ({ name, hex }));
}

export function discountPercent(p) {
  return p.compareAtCents && p.compareAtCents > p.priceCents
    ? Math.round((1 - p.priceCents / p.compareAtCents) * 100)
    : 0;
}

export function priceHtml(p, large = false) {
  const pct = discountPercent(p);
  return `<span class="price${large ? ' price-lg' : ''}${pct ? ' price-sale' : ''}">
    <span>${esc(formatMoney(p.priceCents))}</span>${pct ? `<span class="price-old">${esc(formatMoney(p.compareAtCents))}</span>` : ''}
  </span>`;
}

export function fallbackTile(name) {
  const d = document.createElement('div');
  d.className = 'product-card-fallback';
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', name);
  d.innerHTML = '<span>ÉLAN</span>';
  return d;
}

import { smOf, hasSm } from '../services/image-path.js';

/**
 * Build a product card element.
 * opts.onQuickView(product) is called from the quick-view button.
 */
export function productCard(p, { onQuickView } = {}) {
  bindWishlistEvents();
  const pct = discountPercent(p);
  const av = p.availability || { inStock: true, lowStock: false };
  const badges = [];
  if (!av.inStock) badges.push('<span class="badge-elan badge-soldout">Εξαντλημένο</span>');
  if (p.flags?.new) badges.push('<span class="badge-elan badge-new">Νέο</span>');
  if (pct) badges.push('<span class="badge-elan badge-sale">Προσφορά</span>');
  const colors = productColors(p);
  const src = p.images?.[0] || '';
  const wished = wishIds.has(p.id);
  const el = document.createElement('article');
  el.className = `product-card${av.inStock ? '' : ' is-soldout'}`;
  el.dataset.productId = p.id;
  el.dataset.slug = p.slug;
  el.dataset.price = String(p.priceCents);
  el.innerHTML = `<div class="product-card-media">
      ${src ? `<img src="${esc(smOf(src))}"${hasSm(src) ? ` srcset="${esc(smOf(src))} 320w, ${esc(src)} 800w" sizes="(min-width: 1200px) 25vw, (min-width: 768px) 33vw, 50vw"` : ''}
        width="320" height="480" loading="lazy" decoding="async" alt="${esc(p.name)}">` : ''}
      <div class="product-card-badges">${badges.join('')}</div>
      <button type="button" class="product-card-wish" data-wish="${esc(p.id)}" data-name="${esc(p.name)}"
        aria-pressed="${wished}" aria-label="${wished ? 'Αφαίρεση από τα αγαπημένα' : 'Προσθήκη στα αγαπημένα'}: ${esc(p.name)}">
        <i class="bi ${wished ? 'bi-heart-fill' : 'bi-heart'}" aria-hidden="true"></i>
      </button>
      <button type="button" class="product-card-quick" data-quick aria-label="Γρήγορη προβολή: ${esc(p.name)}">
        <i class="bi bi-eye" aria-hidden="true"></i><span>Γρήγορη προβολή</span>
      </button>
    </div>
    <div class="product-card-body">
      <p class="product-card-brand">${esc(p.brand)}</p>
      <h3 class="product-card-title"><a href="#/product/${esc(p.slug)}">${esc(p.name)}</a></h3>
      <div class="product-card-price">${priceHtml(p)}${pct ? `<span class="badge-elan badge-discount">-${pct}%</span>` : ''}</div>
      ${colors.length ? `<div class="product-card-swatches" aria-label="Διαθέσιμα χρώματα: ${esc(colors.map((c) => c.name).join(', '))}">
        ${colors.slice(0, 6).map((c) => `<span class="swatch" style="background:${esc(c.hex)}" title="${esc(c.name)}"></span>`).join('')}
        ${colors.length > 6 ? `<span class="swatch-more">+${colors.length - 6}</span>` : ''}
      </div>` : ''}
    </div>`;
  const img = el.querySelector('img');
  if (img) {
    img.addEventListener('error', () => img.replaceWith(fallbackTile(p.name)), { once: true });
  }
  el.querySelector('[data-wish]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wishlist:toggle', { detail: { productId: p.id } }));
  });
  el.querySelector('[data-quick]').addEventListener('click', () => onQuickView?.(p, el.querySelector('[data-quick]')));
  return el;
}

export function productCardSkeleton() {
  return `<div class="product-card" aria-hidden="true">
    <span class="skeleton skeleton-media"></span>
    <div class="product-card-body"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>
  </div>`;
}
