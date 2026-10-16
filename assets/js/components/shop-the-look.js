// «Shop the look» dialog for a curated Instagram post: large image, caption and tagged products.
import { escapeHtml as esc, formatMoney } from '../ui.js';
import { getProduct } from '../services/products.js';

export const DEMO_FEED_LABEL = 'Επιλεγμένο περιεχόμενο — demo, όχι ζωντανή σύνδεση με Instagram';

const smOf = (src) => String(src).replace(/\.webp$/, '-sm.webp');

function productRow(p) {
  const img = p.images?.[0];
  const sale = p.compareAtCents && p.compareAtCents > p.priceCents;
  return `<li class="stl-item">
    <a class="stl-link" href="#/product/${esc(p.slug)}">
      <span class="stl-thumb">${img ? `<img src="${esc(smOf(img))}" alt="" width="320" height="480" loading="lazy" decoding="async">` : ''}</span>
      <span class="stl-info">
        <span class="product-card-brand">${esc(p.brand)}</span>
        <span class="stl-name">${esc(p.name)}</span>
        <span class="price${sale ? ' price-sale' : ''}"><span>${esc(formatMoney(p.priceCents))}</span>${sale ? `<span class="price-old">${esc(formatMoney(p.compareAtCents))}</span>` : ''}</span>
      </span>
      <i class="bi bi-arrow-right stl-arrow" aria-hidden="true"></i>
    </a>
  </li>`;
}

/**
 * Open the dialog for `post` ({ id, image, alt, caption, permalink?, productIds }).
 * Focus returns to `returnFocus` (the tile) when the dialog closes.
 */
export function openShopTheLook(post, { handle = '', returnFocus } = {}) {
  document.querySelectorAll('[data-insta-modal]').forEach((m) => m.remove());
  const id = `stl-${post.id}`;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="modal fade modal-elan stl-modal" id="${esc(id)}" tabindex="-1" aria-labelledby="${esc(id)}-title" data-insta-modal>
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
      <div class="modal-content">
        <button type="button" class="btn-close stl-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
        <div class="stl-grid">
          <div class="stl-media">
            <img class="insta-modal-img" src="${esc(post.image)}" alt="${esc(post.alt)}" width="${post.width || 800}" height="${post.height || 1200}" decoding="async">
          </div>
          <div class="stl-body">
            <p class="eyebrow mb-1"><i class="bi bi-instagram me-1" aria-hidden="true"></i>${esc(handle)}</p>
            <h2 class="stl-title" id="${esc(id)}-title">Shop the look</h2>
            <p class="stl-caption" data-insta-caption>${esc(post.caption || post.alt)}</p>
            <p class="stl-demo"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${DEMO_FEED_LABEL}</p>
            <h3 class="stl-sub">Τα κομμάτια της εμφάνισης</h3>
            <ul class="stl-list list-unstyled" data-stl-list aria-busy="true">
              <li class="stl-item" aria-hidden="true"><span class="skeleton" style="height:96px"></span></li>
            </ul>
            ${post.permalink ? `<a class="btn btn-link px-0" href="${esc(post.permalink)}" target="_blank" rel="noopener">Δείτε την ανάρτηση<span class="visually-hidden"> (νέα καρτέλα)</span> <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>` : ''}
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const el = wrap.firstElementChild;
  document.body.append(el);
  const modal = window.bootstrap.Modal.getOrCreateInstance(el);
  const list = el.querySelector('[data-stl-list]');
  Promise.all((post.productIds || []).map((pid) => getProduct(pid).catch(() => null)))
    .then((items) => {
      const found = items.filter((p) => p && p.status !== 'archived');
      list.innerHTML = found.length
        ? found.map(productRow).join('')
        : '<li class="stl-empty">Τα κομμάτια αυτής της εμφάνισης δεν είναι πλέον διαθέσιμα. <a href="#/catalog">Δείτε τον κατάλογο</a></li>';
      list.removeAttribute('aria-busy');
      list.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => im.remove(), { once: true }));
    });
  el.addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) modal.hide(); });
  el.addEventListener('hidden.bs.modal', () => {
    modal.dispose();
    el.remove();
    if (returnFocus && returnFocus.isConnected && !document.querySelector('.modal.show')) returnFocus.focus();
  });
  modal.show();
  return modal;
}
