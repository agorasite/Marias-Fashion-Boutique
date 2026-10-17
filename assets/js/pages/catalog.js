import { escapeHtml as esc, html, formatMoney } from '../ui.js';
import { buildHash, parseHash, onPageLeave } from '../router.js';
import { listCategories, listProducts, sizeLabel } from '../services/products.js';
import { productCard, productCardSkeleton } from '../components/product-card.js';
import { quickViewModal } from '../components/modals.js';
import { filtersHtml, syncFilterControls } from '../components/catalog-filters.js';

const PAGE_SIZE = 12;
const SORTS = [
  ['newest', 'Νεότερα'],
  ['popular', 'Δημοφιλέστερα'],
  ['price-asc', 'Τιμή: αύξουσα'],
  ['price-desc', 'Τιμή: φθίνουσα'],
];

const csv = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const num = (s) => {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : '';
};

function parseState(query) {
  const page = parseInt(query.page, 10);
  return {
    q: (query.q || '').trim(),
    sub: query.sub || '',
    min: num(query.min || ''),
    max: num(query.max || ''),
    sizes: csv(query.size),
    colors: csv(query.color),
    brands: csv(query.brand),
    stock: query.stock === '1',
    sort: SORTS.some(([k]) => k === query.sort) ? query.sort : 'newest',
    page: page > 0 ? page : 1,
  };
}

function stateToQuery(s) {
  return {
    q: s.q,
    sub: s.sub,
    min: s.min,
    max: s.max,
    size: s.sizes.join(','),
    color: s.colors.join(','),
    brand: s.brands.join(','),
    stock: s.stock ? '1' : '',
    sort: s.sort === 'newest' ? '' : s.sort,
    page: s.page > 1 ? String(s.page) : '',
  };
}

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const countLabel = (n) => `${n} ${n === 1 ? 'προϊόν' : 'προϊόντα'}`;

export default async function render(ctx) {
  // A previous page may have been replaced while its offcanvas was open.
  document.querySelectorAll('.offcanvas-backdrop').forEach((b) => b.remove());
  document.body.classList.remove('modal-open');
  if (document.body.style.overflow === 'hidden') document.body.style.removeProperty('overflow');

  const basePath = ctx.path;
  const root = html(`<section class="page catalog-page" data-page="catalog" data-route="/catalog">
    <div class="container-xl">
      <div class="catalog-head">
        <nav aria-label="Breadcrumb"><ol class="breadcrumb mb-2" data-crumbs><li class="breadcrumb-item"><a href="#/">Αρχική</a></li></ol></nav>
        <h1 class="catalog-title" data-title>Κατάλογος</h1>
        <nav class="catalog-pills" aria-label="Υποκατηγορίες" data-pills></nav>
      </div>
      <div class="catalog-toolbar">
        <div class="catalog-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <label class="visually-hidden" for="catalogSearch">Αναζήτηση στον κατάλογο</label>
          <input id="catalogSearch" class="form-control" type="search" placeholder="Αναζήτηση προϊόντων…" autocomplete="off" data-search>
        </div>
        <div class="catalog-toolbar-actions">
          <button type="button" class="btn btn-outline-dark catalog-filter-btn d-lg-none" data-bs-toggle="offcanvas" data-bs-target="#filtersOffcanvas" aria-controls="filtersOffcanvas" data-open-filters>
            <i class="bi bi-sliders me-1" aria-hidden="true"></i>Φίλτρα<span class="badge text-bg-dark ms-2" data-filter-count hidden>0</span>
          </button>
          <p class="catalog-count" role="status" aria-live="polite" data-count></p>
          <label class="catalog-sort-wrap">Ταξινόμηση
            <select class="form-select catalog-sort" data-sort>${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          </label>
        </div>
      </div>
      <div class="filter-chips" data-chips aria-label="Ενεργά φίλτρα"></div>
      <div class="catalog-layout">
        <aside class="filters-sidebar d-none d-lg-block" id="filtersSidebar" aria-labelledby="filtersSidebarTitle"><h2 class="visually-hidden" id="filtersSidebarTitle">Φίλτρα</h2><div data-filters></div></aside>
        <div>
          <div class="product-grid" data-grid aria-live="off">${Array.from({ length: 8 }, productCardSkeleton).join('')}</div>
          <div data-empty></div>
          <div class="catalog-more" data-more hidden>
            <button type="button" class="btn btn-outline-dark btn-lg" data-load-more>Φόρτωσε περισσότερα</button>
            <p class="small text-body-secondary mb-0" data-shown></p>
          </div>
        </div>
      </div>
    </div>
    <div class="offcanvas offcanvas-end offcanvas-elan" tabindex="-1" id="filtersOffcanvas" aria-labelledby="filtersOffcanvasLabel">
      <div class="offcanvas-header">
        <h2 class="offcanvas-title h5" id="filtersOffcanvasLabel">Φίλτρα</h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Κλείσιμο φίλτρων"></button>
      </div>
      <div class="offcanvas-body" data-filters></div>
      <div class="p-3 border-top d-flex gap-2">
        <button type="button" class="btn btn-outline-dark flex-fill" data-clear-all>Καθαρισμός</button>
        <button type="button" class="btn btn-dark flex-fill" data-bs-dismiss="offcanvas" data-apply>Εμφάνιση</button>
      </div>
    </div>
  </section>`);

  init(root, ctx, basePath).catch((e) => console.warn('Catalog init failed', e));
  return root;
}

async function init(root, ctx, basePath) {
  const $ = (sel) => root.querySelector(sel);
  const panels = [...root.querySelectorAll('[data-filters]')];
  const grid = $('[data-grid]');
  let cats = [];
  try {
    cats = await listCategories();
  } catch (e) {
    grid.innerHTML = '';
    $('[data-empty]').innerHTML = '<div class="catalog-empty"><p class="mb-0">Δεν ήταν δυνατή η φόρτωση του καταλόγου.</p></div>';
    return root;
  }

  // Resolve the route category (a subcategory id in the path is tolerated).
  let categoryId = ctx.params.categoryId || '';
  let state = parseState(ctx.query);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const routeCat = categoryId ? catById.get(categoryId) : null;
  if (routeCat && routeCat.parentId) {
    state.sub = routeCat.id;
    categoryId = routeCat.parentId;
  }
  const category = categoryId ? catById.get(categoryId) : null;
  const unknownCategory = Boolean(categoryId && !category);
  const subs = category ? cats.filter((c) => c.parentId === category.id) : [];
  if (state.sub && !subs.some((c) => c.id === state.sub)) state.sub = '';
  // Unknown `sub` or a malformed `page` in the URL: keep the canonical form (no history entry).
  const badPage = ctx.query.page !== undefined && String(state.page) !== ctx.query.page;
  const badSub = ctx.query.sub !== undefined && ctx.query.sub !== state.sub;
  if ((badPage || badSub) && root.isConnected) history.replaceState(history.state, '', buildHash(basePath, stateToQuery(state)));

  // ---- static header parts
  $('[data-title]').textContent = unknownCategory ? 'Η κατηγορία δεν βρέθηκε' : (category ? category.name : 'Όλα τα προϊόντα');
  const crumbs = $('[data-crumbs]');
  const addCrumb = (label, href) => {
    const li = document.createElement('li');
    li.className = 'breadcrumb-item';
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      li.append(a);
    } else {
      li.textContent = label;
      li.classList.add('active');
      li.setAttribute('aria-current', 'page');
    }
    crumbs.append(li);
  };
  if (category) {
    addCrumb('Κατάλογος', '#/catalog');
    addCrumb(category.name, null);
  } else {
    addCrumb('Κατάλογος', null);
  }
  if (unknownCategory) {
    $('[data-empty]').innerHTML = '<div class="catalog-empty"><p>Η κατηγορία που ζητήσατε δεν υπάρχει.</p><a class="btn btn-dark" href="#/catalog">Δες όλα τα προϊόντα</a></div>';
    grid.innerHTML = '';
    return root;
  }

  const search = $('[data-search]');
  const sortSel = $('[data-sort]');
  search.value = state.q;
  sortSel.value = state.sort;

  const pillsEl = $('[data-pills]');
  const pillLink = (label, href, current, sub) => {
    const a = document.createElement('a');
    a.className = 'catalog-pill';
    a.href = href;
    a.textContent = label;
    if (current) a.setAttribute('aria-current', 'true');
    if (sub !== undefined) a.dataset.sub = sub;
    return a;
  };
  function renderPills() {
    pillsEl.replaceChildren();
    if (category) {
      pillsEl.append(pillLink('Όλα', buildHash(basePath, stateToQuery({ ...state, sub: '', page: 1 })), !state.sub, ''));
      subs.forEach((c) => pillsEl.append(pillLink(c.name, buildHash(basePath, stateToQuery({ ...state, sub: c.id, page: 1 })), state.sub === c.id, c.id)));
    } else {
      pillsEl.append(pillLink('Όλα', '#/catalog', true));
      cats.filter((c) => !c.parentId).forEach((c) => pillsEl.append(pillLink(c.name, `#/catalog/${c.id}`, false)));
    }
    pillsEl.hidden = false;
  }

  // ---- state / URL
  const currentHash = () => buildHash(basePath, stateToQuery(state));
  // The page is still the routed one (not replaced by a navigation). Late callbacks (debounce, slow
  // queries) must never write a stale catalog URL over the page the user moved to.
  const alive = () => root.isConnected && parseHash(location.hash).path === basePath;
  function commit({ replace = false } = {}) {
    if (!alive()) return;
    const target = currentHash();
    if (target !== location.hash) {
      if (replace) history.replaceState(history.state, '', target);
      else history.pushState(history.state, '', target);
    }
  }
  function setState(patch, { replace = false } = {}) {
    state = { ...state, page: 1, ...patch };
    commit({ replace });
    refresh();
  }

  const chipsEl = $('[data-chips]');
  function chipList() {
    const out = [];
    if (state.q) out.push([`Αναζήτηση: «${state.q}»`, { q: '' }]);
    if (state.sub) out.push([`Κατηγορία: ${catById.get(state.sub)?.name || state.sub}`, { sub: '' }]);
    if (state.min || state.max) {
      const lo = state.min ? formatMoney(Number(state.min) * 100) : '';
      const hi = state.max ? formatMoney(Number(state.max) * 100) : '';
      const label = lo && hi ? `Τιμή: ${lo} – ${hi}` : (lo ? `Τιμή: από ${lo}` : `Τιμή: έως ${hi}`);
      out.push([label, { min: '', max: '' }]);
    }
    state.sizes.forEach((s) => out.push([`Μέγεθος: ${sizeLabel(s)}`, { sizes: state.sizes.filter((x) => x !== s) }]));
    state.colors.forEach((c) => out.push([`Χρώμα: ${c}`, { colors: state.colors.filter((x) => x !== c) }]));
    state.brands.forEach((b) => out.push([`Μάρκα: ${b}`, { brands: state.brands.filter((x) => x !== b) }]));
    if (state.stock) out.push(['Μόνο διαθέσιμα', { stock: false }]);
    return out;
  }
  function renderChips() {
    const list = chipList();
    chipsEl.replaceChildren();
    list.forEach(([label, patch]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-chip';
      b.dataset.chip = '';
      b.setAttribute('aria-label', `Αφαίρεση φίλτρου: ${label}`);
      b.innerHTML = `<span>${esc(label)}</span><i class="bi bi-x-lg" aria-hidden="true"></i>`;
      b.addEventListener('click', () => setState(patch));
      chipsEl.append(b);
    });
    if (list.length > 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-chip filter-chip-clear';
      b.dataset.clearAll = '';
      b.textContent = 'Καθαρισμός όλων';
      chipsEl.append(b);
    }
    const n = list.length;
    const badge = $('[data-filter-count]');
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  const clearAll = () => setState({ q: '', sub: '', min: '', max: '', sizes: [], colors: [], brands: [], stock: false });

  // ---- data
  const wanted = () => ({
    categoryId: categoryId || undefined,
    subcategoryId: state.sub || undefined,
    q: state.q || undefined,
    minCents: state.min ? Number(state.min) * 100 : undefined,
    maxCents: state.max ? Number(state.max) * 100 : undefined,
    sizes: state.sizes,
    colors: state.colors,
    brands: state.brands,
    inStockOnly: state.stock,
    sort: state.sort,
  });

  let seq = 0;
  let facetSig = '';
  let loadedPages = 0;
  let lastTotal = 0;

  const emptyEl = $('[data-empty]');
  const moreEl = $('[data-more]');

  function renderFacets(facets) {
    const sig = JSON.stringify(facets);
    if (sig === facetSig) return;
    facetSig = sig;
    // Re-rendering the panels would drop keyboard focus to <body>: put it back on the same control.
    const a = document.activeElement;
    const panel = a && panels.find((p) => p.contains(a));
    const attr = panel && [...a.attributes].find((x) => x.name.startsWith('data-f-'));
    panels.forEach((p) => { p.innerHTML = filtersHtml(facets, state); });
    if (attr) {
      const sel = `[${attr.name}${attr.value ? `="${CSS.escape(attr.value)}"` : ''}]`;
      (panel.querySelector(sel) || panel.querySelector('button, input'))?.focus({ preventScroll: true });
    }
  }

  function updateMeta(total, shown) {
    $('[data-count]').textContent = countLabel(total);
    $('[data-shown]').textContent = `Εμφάνιση ${shown} από ${total}`;
    moreEl.hidden = shown >= total;
    emptyEl.innerHTML = '';
    if (total === 0) {
      emptyEl.innerHTML = `<div class="catalog-empty" data-empty-state>
        <i class="bi bi-search" aria-hidden="true"></i>
        <h2 class="h4 mt-2">Δεν βρέθηκαν προϊόντα</h2>
        <p class="text-body-secondary">Δοκιμάστε διαφορετικά φίλτρα ή αναζήτηση.</p>
        <button type="button" class="btn btn-dark" data-reset>Καθαρισμός φίλτρων</button>
      </div>`;
    }
  }

  const onQuick = (p, btn) => quickViewModal(p, { returnFocus: btn });

  // `seq` is the generation of the result set: a refresh starts a new one; «load more» only APPENDS to
  // the current generation and never starts one, so it can no longer cancel an in-flight refresh.
  let refreshing = false;
  let loadingMore = false;
  const moreBtn = $('[data-load-more]');
  async function refresh() {
    const my = ++seq;
    refreshing = true;
    moreBtn.disabled = true;
    renderPills();
    renderChips();
    syncFilterControls(root, state);
    sortSel.value = state.sort;
    if (document.activeElement !== search) search.value = state.q;
    grid.setAttribute('aria-busy', 'true');
    try {
      const res = await listProducts({ ...wanted(), page: 1, pageSize: PAGE_SIZE * state.page });
      if (my !== seq) return;
      renderFacets(res.facets);
      syncFilterControls(root, state);
      grid.replaceChildren(...res.items.map((p) => productCard(p, { onQuickView: onQuick })));
      lastTotal = res.total;
      // ?page=99 on a 4-page result: show everything and keep the URL honest
      const lastPage = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
      if (state.page > lastPage) {
        state = { ...state, page: lastPage };
        commit({ replace: true });
      }
      loadedPages = state.page;
      updateMeta(res.total, res.items.length);
    } catch (e) {
      if (my !== seq) return;
      console.warn('Catalog load failed', e);
      grid.replaceChildren();
      emptyEl.innerHTML = '<div class="catalog-empty"><p class="mb-0">Δεν ήταν δυνατή η φόρτωση των προϊόντων.</p></div>';
    } finally {
      if (my === seq) {
        refreshing = false;
        moreBtn.disabled = false;
        grid.removeAttribute('aria-busy');
      }
    }
  }

  async function loadMore() {
    if (refreshing || loadingMore) return; // the button is disabled meanwhile; guard double activation
    const gen = seq;
    const next = loadedPages + 1;
    loadingMore = true;
    moreBtn.disabled = true;
    try {
      const res = await listProducts({ ...wanted(), page: next, pageSize: PAGE_SIZE });
      if (gen !== seq || !alive()) return; // a refresh replaced the list meanwhile: drop this page
      const cards = res.items.map((p) => productCard(p, { onQuickView: onQuick }));
      grid.append(...cards);
      loadedPages = next;
      state = { ...state, page: next };
      commit({ replace: true });
      updateMeta(res.total, grid.querySelectorAll('.product-card[data-product-id]').length);
      cards[0]?.querySelector('a')?.focus({ preventScroll: false });
    } catch (e) {
      console.warn('Catalog load more failed', e);
    } finally {
      loadingMore = false;
      if (!refreshing) moreBtn.disabled = false;
    }
  }

  // ---- events (delegated)
  let debounce = 0;
  onPageLeave(() => clearTimeout(debounce)); // a pending search must not fire on the next page
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!alive()) return;
      const q = search.value.trim();
      if (q !== state.q) setState({ q }, { replace: true });
    }, 200);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  sortSel.addEventListener('change', () => setState({ sort: sortSel.value }));

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t || !root.contains(t)) return;
    if (t.dataset.fSize !== undefined) setState({ sizes: toggle(state.sizes, t.dataset.fSize) });
    else if (t.dataset.fColor !== undefined) setState({ colors: toggle(state.colors, t.dataset.fColor) });
    else if (t.hasAttribute('data-load-more')) loadMore();
    else if (t.hasAttribute('data-reset') || t.hasAttribute('data-clear-all')) clearAll();
    else if (t.classList.contains('catalog-pill') && t.dataset.sub !== undefined) {
      e.preventDefault();
      setState({ sub: t.dataset.sub });
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-f-brand]')) setState({ brands: toggle(state.brands, t.dataset.fBrand) });
    else if (t.matches('[data-f-stock]')) setState({ stock: t.checked });
    else if (t.matches('[data-f-min]')) setState({ min: num(t.value) });
    else if (t.matches('[data-f-max]')) setState({ max: num(t.value) });
  });

  renderPills();
  renderChips();
  await refresh();
  return root;
}
