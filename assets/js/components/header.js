export const DEPARTMENTS = [
  { id: 'women', label: 'Γυναικεία' },
  { id: 'men', label: 'Ανδρικά' },
  { id: 'shoes', label: 'Παπούτσια' },
  { id: 'accessories', label: 'Αξεσουάρ' },
];

const searchForm = (cls, id) => `<form class="header-search ${cls}" role="search" action="#/catalog" data-search-form>
    <label class="visually-hidden" for="${id}">Αναζήτηση προϊόντων</label>
    <i class="bi bi-search header-search-icon" aria-hidden="true"></i>
    <input id="${id}" class="form-control" type="search" name="q" placeholder="Αναζήτηση προϊόντων…" autocomplete="off" enterkeyhint="search">
    <button class="visually-hidden" type="submit">Αναζήτηση</button>
  </form>`;

const icon = (href, ic, label, badge) => `<a class="header-icon" href="${href}" aria-label="${label}">
    <i class="bi ${ic}" aria-hidden="true"></i>
    ${badge ? `<span class="header-badge" data-badge="${badge}" hidden>0</span>` : ''}
  </a>`;

function offcanvasMarkup() {
  return `<div class="offcanvas offcanvas-start offcanvas-elan" tabindex="-1" id="navOffcanvas" aria-labelledby="navOffcanvasLabel">
    <div class="offcanvas-header">
      <p class="offcanvas-title brand-mark mb-0" id="navOffcanvasLabel">ÉLAN<span class="visually-hidden"> — Μενού</span></p>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Κλείσιμο μενού"></button>
    </div>
    <div class="offcanvas-body d-flex flex-column">
      <nav aria-label="Κατηγορίες">
        <p class="eyebrow mb-2">Κατάστημα</p>
        <ul class="offcanvas-nav list-unstyled">
          ${DEPARTMENTS.map((d) => `<li><a href="#/catalog/${d.id}">${d.label}<i class="bi bi-arrow-right" aria-hidden="true"></i></a></li>`).join('')}
          <li><a href="#/catalog">Όλα τα προϊόντα<i class="bi bi-arrow-right" aria-hidden="true"></i></a></li>
        </ul>
      </nav>
      <nav aria-label="Ο λογαριασμός μου" class="mt-4">
        <p class="eyebrow mb-2">Ο λογαριασμός μου</p>
        <ul class="offcanvas-subnav list-unstyled">
          <li><a href="#/account"><i class="bi bi-person" aria-hidden="true"></i>Λογαριασμός</a></li>
          <li><a href="#/account/orders"><i class="bi bi-box-seam" aria-hidden="true"></i>Οι παραγγελίες μου</a></li>
          <li><a href="#/account/wishlist"><i class="bi bi-heart" aria-hidden="true"></i>Αγαπημένα</a></li>
          <li><a href="#/cart"><i class="bi bi-bag" aria-hidden="true"></i>Καλάθι</a></li>
        </ul>
      </nav>
      <p class="offcanvas-note mt-auto mb-0">Δωρεάν αποστολή για αγορές άνω των 60 €</p>
    </div>
  </div>`;
}

export function renderHeader() {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="container-xl header-row">
      <div class="header-start">
        <button class="header-icon header-menu-btn" type="button" data-bs-toggle="offcanvas" data-bs-target="#navOffcanvas" aria-controls="navOffcanvas" aria-label="Μενού">
          <i class="bi bi-list" aria-hidden="true"></i>
        </button>
        <a class="brand" href="#/" aria-label="ÉLAN Fashion Boutique — Αρχική">
          <span class="brand-mark">ÉLAN</span><span class="brand-sub">Fashion Boutique</span>
        </a>
      </div>
      <nav class="header-nav d-none d-lg-flex" aria-label="Κύρια πλοήγηση">
        ${DEPARTMENTS.map((d) => `<a href="#/catalog/${d.id}" data-nav="/catalog/${d.id}">${d.label}</a>`).join('')}
      </nav>
      <div class="header-end">
        ${searchForm('header-search-desktop d-none d-lg-flex', 'headerSearchDesktop')}
        <button class="header-icon d-lg-none" type="button" data-search-toggle aria-controls="mobileSearch" aria-expanded="false" aria-label="Αναζήτηση">
          <i class="bi bi-search" aria-hidden="true"></i>
        </button>
        <span class="d-none d-sm-inline-flex">${icon('#/account', 'bi-person', 'Λογαριασμός')}</span>
        ${icon('#/account/wishlist', 'bi-heart', 'Αγαπημένα', 'wishlist')}
        ${icon('#/cart', 'bi-bag', 'Καλάθι', 'cart')}
      </div>
    </div>
    <div class="mobile-search collapse d-lg-none" id="mobileSearch">
      <div class="container-xl pb-3">${searchForm('header-search-mobile', 'headerSearchMobile')}</div>
    </div>`;

  const offcanvasHost = document.createElement('div');
  offcanvasHost.innerHTML = offcanvasMarkup();
  const offcanvas = offcanvasHost.firstElementChild;

  header.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-search-form]');
    if (!form) return;
    e.preventDefault();
    const q = form.q.value.trim();
    form.q.blur();
    mobileSearch().hide();
    location.hash = q ? `#/catalog?${new URLSearchParams({ q })}` : '#/catalog';
  });

  const collapseEl = header.querySelector('#mobileSearch');
  const mobileSearch = () => window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false });
  const toggleBtn = header.querySelector('[data-search-toggle]');
  toggleBtn.addEventListener('click', () => mobileSearch().toggle());
  collapseEl.addEventListener('shown.bs.collapse', () => {
    toggleBtn.setAttribute('aria-expanded', 'true');
    collapseEl.querySelector('input').focus();
  });
  collapseEl.addEventListener('hidden.bs.collapse', () => toggleBtn.setAttribute('aria-expanded', 'false'));

  return {
    header,
    offcanvas,
    openSearch() {
      if (collapseEl.classList.contains('show')) collapseEl.querySelector('input').focus();
      else mobileSearch().show();
      window.scrollTo({ top: 0 });
    },
    closeOverlays() {
      window.bootstrap.Offcanvas.getInstance(offcanvas)?.hide();
      if (collapseEl.classList.contains('show')) mobileSearch().hide();
    },
    setActive(path) {
      header.querySelectorAll('[data-nav]').forEach((a) => {
        const on = path === a.dataset.nav || path.startsWith(`${a.dataset.nav}/`);
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    },
    syncSearch(query) {
      header.querySelectorAll('input[name="q"]').forEach((i) => {
        if (document.activeElement !== i) i.value = query.q || '';
      });
    },
  };
}

/** Set a badge count everywhere it is shown (header + bottom nav). */
export function setBadge(name, count) {
  const n = Math.max(0, Number(count) || 0);
  document.querySelectorAll(`[data-badge="${name}"]`).forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n === 0;
    const link = b.closest('a');
    if (link) {
      link.dataset.label ||= link.getAttribute('aria-label') || '';
      if (link.dataset.label) link.setAttribute('aria-label', n ? `${link.dataset.label} (${n})` : link.dataset.label);
    }
  });
}

/**
 * Keep header/bottom-nav badges in sync with cart:changed / wishlist:changed events.
 * Events may carry { detail: { count } }; otherwise the count is read through the
 * optional loaders, e.g. { cart: async () => (await import('../services/cart.js')).getCartCount() }.
 * Loaders are only passed once those services exist (requesting a missing module
 * would log a 404), and any loader failure falls back to 0.
 */
export function bindBadges(loaders = {}) {
  for (const name of ['cart', 'wishlist']) {
    const read = async () => {
      if (typeof loaders[name] !== 'function') return 0;
      try {
        return (await loaders[name]()) || 0;
      } catch {
        return 0;
      }
    };
    let seq = 0;
    const refresh = async (e) => {
      const mine = ++seq;
      const detailCount = e && e.detail && Number.isFinite(e.detail.count) ? e.detail.count : null;
      const n = detailCount ?? (await read());
      if (mine === seq) setBadge(name, n); // ignore results superseded by a newer event
    };
    window.addEventListener(`${name}:changed`, refresh);
    refresh();
  }
}
