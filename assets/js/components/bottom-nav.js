const ITEMS = [
  { href: '#/', icon: 'bi-house', label: 'Αρχική', match: (p) => p === '/' },
  { href: '#/catalog', icon: 'bi-grid', label: 'Κατάλογος', match: (p) => p === '/catalog' || p.startsWith('/catalog/') || p.startsWith('/product/') },
  { search: true, icon: 'bi-search', label: 'Αναζήτηση' },
  { href: '#/account/wishlist', icon: 'bi-heart', label: 'Αγαπημένα', badge: 'wishlist', match: (p) => p === '/account/wishlist' },
  { href: '#/cart', icon: 'bi-bag', label: 'Καλάθι', badge: 'cart', match: (p) => p === '/cart' || p === '/checkout' },
];

/** Mobile bottom navigation (hidden from 992px up via CSS). */
export function renderBottomNav({ onSearch }) {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Γρήγορη πλοήγηση');
  nav.innerHTML = `<ul class="list-unstyled">${ITEMS.map((it, i) => {
    const inner = `<span class="bottom-nav-icon"><i class="bi ${it.icon}" aria-hidden="true"></i>${it.badge ? `<span class="header-badge" data-badge="${it.badge}" hidden>0</span>` : ''}</span><span class="bottom-nav-label">${it.label}</span>`;
    return `<li>${it.search
      ? `<button type="button" class="bottom-nav-item" data-i="${i}" aria-controls="mobileSearch" aria-expanded="false">${inner}</button>`
      : `<a class="bottom-nav-item" data-i="${i}" href="${it.href}"${it.badge ? ` data-label="${it.label}"` : ''}>${inner}</a>`}</li>`;
  }).join('')}</ul>`;
  nav.querySelector('button').addEventListener('click', onSearch);
  return {
    nav,
    setActive(path) {
      nav.querySelectorAll('a.bottom-nav-item').forEach((a) => {
        const on = ITEMS[a.dataset.i].match(path);
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    },
  };
}
