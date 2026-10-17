// Brand rendering shared by the storefront header/footer and the admin sidebar.
// Settings `logo` ({ text?, subtext?, image?, alt? }) overrides the default ÉLAN wordmark; unset keeps it.
import { escapeHtml as esc } from '../ui.js';

export const DEFAULT_WORDMARK = { text: 'ÉLAN', sub: 'Fashion Boutique' };

/** Resolve what to draw from the settings document. */
export function brandInfo(settings = {}) {
  const logo = settings && settings.logo && typeof settings.logo === 'object' ? settings.logo : null;
  const name = (settings && settings.storeName) || `${DEFAULT_WORDMARK.text} ${DEFAULT_WORDMARK.sub}`;
  if (!logo || (!logo.text && !logo.image)) return { text: DEFAULT_WORDMARK.text, sub: DEFAULT_WORDMARK.sub, image: '', alt: '', name, custom: false };
  return { text: logo.text || '', sub: logo.text ? (logo.subtext || '') : '', image: logo.image || '', alt: logo.alt || name, name, custom: true };
}

/**
 * Markup inside a `.brand` link. The link's accessible name is its visible text (logo alt / wordmark)
 * plus a visually hidden « — Αρχική», so the spoken name always contains the visible label (WCAG 2.5.3);
 * no aria-label that could drift from what is shown.
 */
export function brandInnerHtml(info) {
  return `${info.image ? `<img class="brand-logo" src="${esc(info.image)}" alt="${esc(info.alt)}" height="40">` : ''}${info.text ? ` <span class="brand-mark">${esc(info.text)}</span>` : ''}${info.sub ? ` <span class="brand-sub">${esc(info.sub)}</span>` : ''}<span class="visually-hidden"> — Αρχική</span>`;
}

/** Update every `a.brand` under `scope` (header, footer) and the offcanvas title. */
export function applyBrand(scope, settings) {
  if (!scope) return;
  const info = brandInfo(settings);
  scope.querySelectorAll('a.brand').forEach((a) => {
    a.removeAttribute('aria-label');
    a.innerHTML = brandInnerHtml(info);
    a.dataset.brand = info.custom ? 'custom' : 'default';
  });
  const title = scope.querySelector('.offcanvas-title.brand-mark');
  if (title) title.innerHTML = `${esc(info.text || info.name)}<span class="visually-hidden"> — Μενού</span>`;
}

/** Admin sidebar: round mark with the first letter (or the image) + «<name> Admin». */
export function applyAdminBrand(root, settings) {
  const info = brandInfo(settings);
  const mark = root.querySelector('.admin-brand-mark');
  const name = root.querySelector('.admin-brand-name');
  if (mark) {
    mark.innerHTML = info.image ? `<img class="admin-brand-img" src="${esc(info.image)}" alt="" width="28" height="28">` : esc(Array.from(info.text || info.name)[0] || 'É');
  }
  if (name) name.innerHTML = `${esc(info.text || info.name)} <span>Admin</span>`;
  const top = root.querySelector('.admin-topbar-name');
  if (top) top.textContent = info.name;
  const link = root.querySelector('.admin-brand');
  if (link) link.dataset.brand = info.custom ? 'custom' : 'default';
}
