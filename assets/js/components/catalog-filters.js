import { escapeHtml as esc, formatMoney } from '../ui.js';
import { sizeLabel } from '../services/products.js';

/**
 * Markup for one filter panel (used verbatim in the desktop sidebar and the
 * mobile offcanvas). Interaction is handled by delegation in pages/catalog.js
 * through the data-f-* attributes.
 */
export function filtersHtml(facets, state) {
  const { sizes, colors, brands, priceRange } = facets;
  const phMin = priceRange.maxCents ? Math.floor(priceRange.minCents / 100) : '';
  const phMax = priceRange.maxCents ? Math.ceil(priceRange.maxCents / 100) : '';
  return `<div class="filter-group">
      <h3 class="filter-group-title">Διαθεσιμότητα</h3>
      <label class="filter-check"><input type="checkbox" data-f-stock ${state.stock ? 'checked' : ''}> Μόνο διαθέσιμα προϊόντα</label>
    </div>
    <div class="filter-group">
      <h3 class="filter-group-title">Τιμή (€)</h3>
      <div class="filter-price">
        <input class="form-control" type="number" inputmode="numeric" min="0" step="1" data-f-min placeholder="${esc(phMin)}" value="${esc(state.min)}" aria-label="Ελάχιστη τιμή σε ευρώ">
        <span aria-hidden="true">–</span>
        <input class="form-control" type="number" inputmode="numeric" min="0" step="1" data-f-max placeholder="${esc(phMax)}" value="${esc(state.max)}" aria-label="Μέγιστη τιμή σε ευρώ">
      </div>
      ${priceRange.maxCents ? `<p class="small text-body-secondary mt-2 mb-0">${esc(formatMoney(priceRange.minCents))} – ${esc(formatMoney(priceRange.maxCents))}</p>` : ''}
    </div>
    ${sizes.length ? `<div class="filter-group">
      <h3 class="filter-group-title">Μέγεθος</h3>
      <div class="filter-sizes">${sizes.map((s) => `<button type="button" class="filter-size" data-f-size="${esc(s)}" aria-pressed="${state.sizes.includes(s)}">${esc(sizeLabel(s))}</button>`).join('')}</div>
    </div>` : ''}
    ${colors.length ? `<div class="filter-group">
      <h3 class="filter-group-title">Χρώμα</h3>
      <div class="filter-colors">${colors.map((c) => `<button type="button" class="filter-color" data-f-color="${esc(c.name)}" aria-pressed="${state.colors.includes(c.name)}" aria-label="${esc(c.name)}" title="${esc(c.name)}"><span class="swatch" style="background:${esc(c.hex)}"></span></button>`).join('')}</div>
    </div>` : ''}
    ${brands.length ? `<div class="filter-group">
      <h3 class="filter-group-title">Μάρκα</h3>
      ${brands.map((b) => `<label class="filter-check"><input type="checkbox" data-f-brand="${esc(b)}" ${state.brands.includes(b) ? 'checked' : ''}> ${esc(b)}</label>`).join('')}
    </div>` : ''}`;
}

/** Update existing controls in place so focus is never lost. */
export function syncFilterControls(root, state) {
  root.querySelectorAll('[data-f-size]').forEach((b) => b.setAttribute('aria-pressed', String(state.sizes.includes(b.dataset.fSize))));
  root.querySelectorAll('[data-f-color]').forEach((b) => b.setAttribute('aria-pressed', String(state.colors.includes(b.dataset.fColor))));
  root.querySelectorAll('[data-f-brand]').forEach((i) => { i.checked = state.brands.includes(i.dataset.fBrand); });
  root.querySelectorAll('[data-f-stock]').forEach((i) => { i.checked = state.stock; });
  root.querySelectorAll('[data-f-min]').forEach((i) => { if (document.activeElement !== i) i.value = state.min; });
  root.querySelectorAll('[data-f-max]').forEach((i) => { if (document.activeElement !== i) i.value = state.max; });
}
