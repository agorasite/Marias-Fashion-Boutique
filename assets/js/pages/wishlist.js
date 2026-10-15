import { html } from '../ui.js';
import { list } from '../services/wishlist.js';
import { getProduct } from '../services/products.js';
import { productCard } from '../components/product-card.js';
import { quickViewModal } from '../components/modals.js';

const emptyHtml = () => `<div class="cart-empty" data-empty>
    <i class="bi bi-heart" aria-hidden="true"></i>
    <h2 class="h4">Δεν έχετε αγαπημένα ακόμη</h2>
    <p class="text-body-secondary">Πατήστε την καρδιά σε ένα προϊόν για να το αποθηκεύσετε εδώ.</p>
    <a class="btn btn-dark" href="#/catalog">Δείτε τον κατάλογο</a>
  </div>`;

// One live listener at a time: each render detaches the previous page's listener first.
let detach = null;

/** Simple wishlist grid. Task 10 embeds this inside the account area. */
export default async function render() {
  if (detach) detach();
  detach = null;
  const root = html(`<section class="page wishlist-page" data-page="wishlist" data-route="/account/wishlist">
    <div class="container-xl">
      <h1 class="display-title">Αγαπημένα</h1>
      <p class="text-body-secondary" data-count></p>
      <div data-body></div>
    </div>
  </section>`);
  const body = root.querySelector('[data-body]');
  const countEl = root.querySelector('[data-count]');
  const ids = await list();
  const products = (await Promise.all(ids.map((id) => getProduct(id).catch(() => null))))
    .filter((p) => p && (!p.status || p.status === 'active'));

  const grid = html('<div class="product-grid" data-grid></div>');
  const sync = () => {
    const n = grid.children.length;
    countEl.textContent = n ? `${n} ${n === 1 ? 'προϊόν' : 'προϊόντα'}` : '';
    if (!n) body.innerHTML = emptyHtml();
  };
  if (!products.length) {
    body.innerHTML = emptyHtml();
    return root;
  }
  products.forEach((p) => grid.append(productCard(p, {
    onQuickView: (prod, btn) => quickViewModal(prod, { returnFocus: btn }),
  })));
  body.append(grid);
  sync();

  // Un-hearting a card removes it from the page.
  let seen = 0;
  const onChange = (e) => {
    const d = e.detail || {};
    if (Number.isFinite(d.version)) {
      if (d.version < seen) return;
      seen = d.version;
    }
    const keep = Array.isArray(d.ids) ? new Set(d.ids) : null;
    [...grid.children].forEach((card) => {
      const gone = keep ? !keep.has(card.dataset.productId) : d.active === false && d.productId === card.dataset.productId;
      if (gone) card.remove();
    });
    sync();
  };
  window.addEventListener('wishlist:changed', onChange);
  detach = () => window.removeEventListener('wishlist:changed', onChange);
  return root;
}
