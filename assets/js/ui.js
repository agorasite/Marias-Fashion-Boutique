// Shared UI helpers for pages and components.
export { toast } from './components/toast.js';
export { confirmDialog } from './components/modals.js';

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Create an element from an HTML string (first element child). */
export function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export { formatMoney } from './services/pricing.js';

/** Move focus to the page heading (made programmatically focusable). */
export function focusHeading(root = document.getElementById('app')) {
  const h1 = root && root.querySelector('h1');
  if (!h1) return;
  h1.setAttribute('tabindex', '-1');
  h1.focus({ preventScroll: true });
}

/**
 * Neutral page for sections not built yet. Wrapped in [data-route] so tests and
 * later code can identify the view.
 */
export function placeholderPage({ route, title, text, eyebrow = 'Σύντομα διαθέσιμο', links = [] }) {
  const el = html(`<section class="page placeholder-page" data-page="placeholder" data-route="${escapeHtml(route)}">
    <div class="container-xl">
      <div class="placeholder-panel">
        <span class="eyebrow"><i class="bi bi-hourglass-split me-1" aria-hidden="true"></i>${escapeHtml(eyebrow)}</span>
        <h1 class="display-title"></h1>
        <p class="lead-text"></p>
        <div class="d-flex flex-wrap justify-content-center gap-2 mt-4"></div>
      </div>
    </div>
  </section>`);
  el.querySelector('h1').textContent = title;
  el.querySelector('p').textContent = text || 'Αυτή η ενότητα του καταστήματος ετοιμάζεται και θα είναι διαθέσιμη σύντομα.';
  const actions = el.querySelector('.d-flex');
  const all = links.length ? links : [{ href: '#/', label: 'Επιστροφή στην αρχική', primary: true }];
  for (const l of all) {
    const a = document.createElement('a');
    a.href = l.href;
    a.className = `btn ${l.primary ? 'btn-dark' : 'btn-outline-dark'}`;
    a.textContent = l.label;
    actions.append(a);
  }
  return el;
}

/** Skeleton block markup for loading states (styles in storefront.css). */
export const skeleton = (lines = 3) =>
  `<div class="skeleton-stack" aria-hidden="true">${'<span class="skeleton skeleton-line"></span>'.repeat(lines)}</div>`;
