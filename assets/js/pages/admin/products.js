// Admin product list: search, filters, sort, pagination, quick actions (feature toggle, archive,
// delete). The editor lives in product-editor.js. Everything is read from / written to IndexedDB
// through services/product-admin.js, the same records the storefront uses.
import { escapeHtml as esc, formatMoney, toast, confirmDialog } from '../../ui.js';
import { adminLayout } from './layout.js';
import { pagerHtml, followChanges } from './list-kit.js';
import { smOf } from '../../services/image-path.js';
import { LOW_STOCK_TOTAL } from '../../services/products.js';
import {
  loadAdminCatalog, filterAdminProducts, discountPercent, archiveProduct, unarchiveProduct, setProductFlag,
  deleteProduct, productHasOrders, ADMIN_PAGE_SIZE,
} from '../../services/product-admin.js';

const SORTS = [
  ['newest', 'Νεότερα πρώτα'],
  ['name', 'Όνομα (Α–Ω)'],
  ['price-asc', 'Τιμή: αύξουσα'],
  ['price-desc', 'Τιμή: φθίνουσα'],
  ['stock-asc', 'Απόθεμα: χαμηλότερο'],
  ['stock-desc', 'Απόθεμα: υψηλότερο'],
];

// Kept at module level so the filters survive a visit to the editor and back.
const DEFAULT_STATE = { q: '', categoryId: '', status: '', lowStock: false, featured: false, sort: 'newest', page: 1 };
let state = { ...DEFAULT_STATE };

const categoryOptions = (cats, selected) => {
  const tops = cats.filter((c) => !c.parentId);
  return `<option value="">Όλες οι κατηγορίες</option>${tops.map((t) => `<option value="${esc(t.id)}"${selected === t.id ? ' selected' : ''}>${esc(t.name)} (όλα)</option>${
    cats.filter((c) => c.parentId === t.id).map((c) => `<option value="${esc(c.id)}"${selected === c.id ? ' selected' : ''}>${esc(t.name)} › ${esc(c.name)}</option>`).join('')}`).join('')}`;
};

function toolbarHtml(cats) {
  return `<div class="admin-card admin-prod-toolbar">
    <div class="admin-toolbar-top">
      <div class="admin-search">
        <label class="visually-hidden" for="pl-q">Αναζήτηση προϊόντων</label>
        <i class="bi bi-search" aria-hidden="true"></i>
        <input class="form-control" id="pl-q" type="search" placeholder="Όνομα, brand ή SKU" autocomplete="off" data-filter="q" value="${esc(state.q)}">
      </div>
      <a class="btn btn-dark" href="#/admin/products/new" data-new-product><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Νέο προϊόν</a>
    </div>
    <div class="admin-filters">
      <div><label class="form-label" for="pl-cat">Κατηγορία</label>
        <select class="form-select form-select-sm" id="pl-cat" data-filter="categoryId">${categoryOptions(cats, state.categoryId)}</select></div>
      <div><label class="form-label" for="pl-status">Κατάσταση</label>
        <select class="form-select form-select-sm" id="pl-status" data-filter="status">
          ${[['', 'Όλες'], ['active', 'Ενεργά'], ['archived', 'Αρχειοθετημένα']].map(([v, l]) => `<option value="${v}"${state.status === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select></div>
      <div><label class="form-label" for="pl-sort">Ταξινόμηση</label>
        <select class="form-select form-select-sm" id="pl-sort" data-filter="sort">${SORTS.map(([v, l]) => `<option value="${v}"${state.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="admin-filter-checks">
        <div class="form-check"><input class="form-check-input" type="checkbox" id="pl-low" data-filter="lowStock"${state.lowStock ? ' checked' : ''}><label class="form-check-label" for="pl-low">Χαμηλό απόθεμα (≤ ${LOW_STOCK_TOTAL})</label></div>
        <div class="form-check"><input class="form-check-input" type="checkbox" id="pl-feat" data-filter="featured"${state.featured ? ' checked' : ''}><label class="form-check-label" for="pl-feat">Προβεβλημένα</label></div>
      </div>
    </div>
  </div>`;
}

function stockChip(total) {
  if (total <= 0) return '<span class="admin-stock is-out" data-stock-state="out">Εξαντλημένο</span>';
  if (total <= LOW_STOCK_TOTAL) return `<span class="admin-stock" data-stock-state="low">${total} τεμ. · χαμηλό</span>`;
  return `<span class="admin-stock-ok" data-stock-state="ok">${total} τεμ.</span>`;
}

function rowHtml(p, catName) {
  const pct = discountPercent(p.priceCents, p.compareAtCents);
  const archived = p.status === 'archived';
  const img = p.images && p.images[0];
  const name = esc(p.name);
  return `<tr data-product-id="${esc(p.id)}" data-status="${archived ? 'archived' : 'active'}" data-sku-count="${p.skuCount}" data-total-stock="${p.totalStock}">
    <td data-label="Προϊόν"><div class="admin-prod">
      ${img ? `<img class="admin-thumb" src="${esc(smOf(img))}" alt="" width="40" height="52" loading="lazy">` : '<span class="admin-thumb admin-thumb-empty">É</span>'}
      <div class="admin-prod-text"><a class="admin-prod-name" href="#/admin/products/${esc(p.id)}">${name}</a><span class="admin-prod-meta">${esc(p.brand)} · ${esc(p.slug)}</span></div>
    </div></td>
    <td data-label="SKU" class="admin-num" data-cell="skus">${p.skuCount}</td>
    <td data-label="Κατηγορία">${esc(catName(p.subcategoryId) || catName(p.categoryId))}</td>
    <td data-label="Τιμή" class="admin-num" data-cell="price"><span>${esc(formatMoney(p.priceCents))}</span>${pct ? `<s class="admin-old-price">${esc(formatMoney(p.compareAtCents))}</s><span class="admin-badge st-sale">-${pct}%</span>` : ''}</td>
    <td data-label="Απόθεμα" data-cell="stock">${stockChip(p.totalStock)}</td>
    <td data-label="Κατάσταση"><span class="admin-badge ${archived ? 'st-archived' : 'st-active'}">${archived ? 'Αρχειοθετημένο' : 'Ενεργό'}</span></td>
    <td data-label="Προβεβλημένο"><button type="button" class="admin-star${p.flags && p.flags.featured ? ' is-on' : ''}" data-action="feature" aria-pressed="${!!(p.flags && p.flags.featured)}" aria-label="Προβεβλημένο: ${name}" title="Προβεβλημένο στην αρχική">
      <i class="bi ${p.flags && p.flags.featured ? 'bi-star-fill' : 'bi-star'}" aria-hidden="true"></i></button></td>
    <td data-label="Ενέργειες"><div class="admin-actions">
      <a class="btn btn-sm btn-outline-dark" href="#/admin/products/${esc(p.id)}" data-action="edit" aria-label="Επεξεργασία: ${name}" title="Επεξεργασία"><i class="bi bi-pencil" aria-hidden="true"></i><span class="admin-action-label">Επεξεργασία</span></a>
      <button type="button" class="btn btn-sm btn-outline-dark" data-action="${archived ? 'restore' : 'archive'}" aria-label="${archived ? 'Επαναφορά' : 'Αρχειοθέτηση'}: ${name}" title="${archived ? 'Επαναφορά' : 'Αρχειοθέτηση'}"><i class="bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-archive'}" aria-hidden="true"></i><span class="admin-action-label">${archived ? 'Επαναφορά' : 'Αρχειοθέτηση'}</span></button>
      <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" aria-label="Διαγραφή: ${name}" title="Διαγραφή"><i class="bi bi-trash3" aria-hidden="true"></i><span class="admin-action-label">Διαγραφή</span></button>
    </div></td>
  </tr>`;
}

export default async function render() {
  const { root, body } = adminLayout({
    active: 'products', title: 'Προϊόντα', view: 'products', route: '/admin/products', crumbs: [{ label: 'Προϊόντα' }],
    subtitle: 'Διαχείριση καταλόγου: οι αλλαγές εμφανίζονται άμεσα στο κατάστημα αυτού του περιηγητή.',
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';

  (async () => {
    let data;
    try { data = await loadAdminCatalog(); } catch (err) {
      console.warn('Product list load failed', err);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση του καταλόγου. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    const catName = (id) => (data.categories.find((c) => c.id === id) || {}).name || '';
    body.innerHTML = `${toolbarHtml(data.categories)}<div class="admin-card admin-prod-results" data-results aria-live="polite"></div>`;
    body.removeAttribute('aria-busy');
    const results = body.querySelector('[data-results]');

    function paint() {
      const r = filterAdminProducts(data.products, data.variants, data.categories, { ...state, pageSize: ADMIN_PAGE_SIZE });
      state.page = r.page;
      const activeN = data.products.filter((p) => p.status !== 'archived').length;
      const counts = `<p class="admin-count" data-count data-total="${data.products.length}" data-matching="${r.total}"><strong>${r.total}</strong> ${r.total === 1 ? 'προϊόν' : 'προϊόντα'}${
        r.total !== data.products.length ? ` από ${data.products.length}` : ''} <span>· ${activeN} ενεργά, ${data.products.length - activeN} αρχειοθετημένα</span></p>`;
      if (!data.products.length) {
        results.innerHTML = `<div class="admin-empty" data-empty><i class="bi bi-bag" aria-hidden="true"></i><p>Ο κατάλογος είναι άδειος.</p><a class="btn btn-dark btn-sm" href="#/admin/products/new">Προσθέστε το πρώτο προϊόν</a></div>`;
        return;
      }
      if (!r.total) {
        results.innerHTML = `${counts}<div class="admin-empty" data-empty><i class="bi bi-search" aria-hidden="true"></i><p>Κανένα προϊόν δεν ταιριάζει με την αναζήτηση ή τα φίλτρα.</p><button type="button" class="btn btn-outline-dark btn-sm" data-clear-filters>Καθαρισμός φίλτρων</button></div>`;
        return;
      }
      results.innerHTML = `${counts}<div class="admin-table-wrap admin-prod-wrap"><table class="table admin-table admin-table-stack admin-prod-table" data-products-table>
        <thead><tr><th scope="col">Προϊόν</th><th scope="col">SKU</th><th scope="col">Κατηγορία</th><th scope="col">Τιμή</th><th scope="col">Απόθεμα</th><th scope="col">Κατάσταση</th><th scope="col">Προβολή</th><th scope="col"><span class="visually-hidden">Ενέργειες</span></th></tr></thead>
        <tbody>${r.items.map((p) => rowHtml(p, catName)).join('')}</tbody></table></div>${pagerHtml(r, 'Σελίδες προϊόντων')}`;
    }

    // Repaint from the database, keeping keyboard focus on the same row action (a change event and the
    // action's own refresh may both repaint).
    async function refresh() {
      const a = document.activeElement;
      const tr = a && results.contains(a) ? a.closest('tr[data-product-id]') : null;
      const keep = tr && a.dataset.action ? `tr[data-product-id="${CSS.escape(tr.dataset.productId)}"] [data-action="${a.dataset.action}"]` : null;
      data = await loadAdminCatalog();
      paint();
      if (keep) results.querySelector(keep)?.focus();
    }

    // filters
    let timer = null;
    body.addEventListener('input', (e) => {
      const el = e.target.closest('[data-filter="q"]');
      if (!el) return;
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = el.value; state.page = 1; paint(); }, 150);
    });
    body.addEventListener('change', (e) => {
      const el = e.target.closest('[data-filter]');
      if (!el || el.dataset.filter === 'q') return;
      state[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
      state.page = 1;
      paint();
    });
    results.addEventListener('click', async (e) => {
      const clear = e.target.closest('[data-clear-filters]');
      if (clear) {
        state = { ...DEFAULT_STATE, sort: state.sort };
        body.querySelector('.admin-prod-toolbar').outerHTML = toolbarHtml(data.categories);
        paint();
        return;
      }
      const pg = e.target.closest("[data-goto]");
      if (pg && !pg.disabled) { state.page = Number(pg.dataset.goto); paint(); results.scrollIntoView({ block: 'start' }); return; }
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr[data-product-id]');
      const id = tr.dataset.productId;
      const p = data.products.find((x) => x.id === id);
      if (!p) return;
      try {
        if (btn.dataset.action === 'feature') {
          await setProductFlag(id, 'featured', !(p.flags && p.flags.featured));
          await refresh();
          body.querySelector(`tr[data-product-id="${CSS.escape(id)}"] [data-action="feature"]`)?.focus();
        } else if (btn.dataset.action === 'archive') {
          await archiveProduct(id);
          toast(`Το «${p.name}» αρχειοθετήθηκε και δεν εμφανίζεται πλέον στο κατάστημα.`, 'success');
          await refresh();
        } else if (btn.dataset.action === 'restore') {
          await unarchiveProduct(id);
          toast(`Το «${p.name}» επαναφέρθηκε και εμφανίζεται ξανά στο κατάστημα.`, 'success');
          await refresh();
        } else if (btn.dataset.action === 'delete') {
          await onDelete(p);
        }
      } catch (err) {
        console.warn('Product action failed', err);
        toast('Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
      }
    });

    async function onDelete(p) {
      if (await productHasOrders(p.id)) {
        const ok = await confirmDialog(
          `Το «${p.name}» εμφανίζεται σε παραγγελίες και δεν μπορεί να διαγραφεί, γιατί θα χαλούσε το ιστορικό τους. Μπορείτε να το αρχειοθετήσετε: θα κρυφτεί από το κατάστημα και οι παλιές παραγγελίες θα παραμείνουν ίδιες.`,
          { title: 'Η διαγραφή δεν είναι δυνατή', okLabel: 'Αρχειοθέτηση', cancelLabel: 'Κλείσιμο' },
        );
        if (ok) { await archiveProduct(p.id); toast(`Το «${p.name}» αρχειοθετήθηκε.`, 'success'); await refresh(); }
        return;
      }
      const ok = await confirmDialog(
        `Θα διαγραφεί οριστικά το «${p.name}», μαζί με τις παραλλαγές, τις κριτικές και τις αναφορές του στα αγαπημένα και στο καλάθι. Η ενέργεια δεν αναιρείται.`,
        { title: 'Διαγραφή προϊόντος', okLabel: 'Διαγραφή', danger: true },
      );
      if (!ok) return;
      const r = await deleteProduct(p.id);
      if (r.deleted) toast(`Το «${p.name}» διαγράφηκε.`, 'success');
      else if (r.reason === 'has-orders') toast('Το προϊόν εμφανίζεται σε παραγγελίες και δεν διαγράφηκε. Αρχειοθετήστε το.', 'danger');
      await refresh();
    }

    body.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'admin-thumb admin-thumb-empty', textContent: 'É' }));
    }, true);

    // saves/archives/deletes from the editor, restocks from cancelled orders, imports, other code paths
    followChanges(body, ['catalog:changed'], refresh);

    paint();
    view.dataset.ready = 'true';
  })();
  return root;
}
