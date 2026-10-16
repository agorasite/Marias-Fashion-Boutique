// Shared admin form building blocks: card sections, labelled controls with error slots, the
// inline error + summary controller and the sticky save bar. Used by the product editor and by the
// settings / content editors.
import { escapeHtml as esc } from '../../ui.js';

export const idKey = (key) => String(key).replace(/\W+/g, '-').replace(/^-|-$/g, '');

export function section(title, sub, inner, key) {
  return `<section class="admin-card admin-form-section" aria-labelledby="sec-${key}" data-section="${key}">
    <div class="admin-card-head"><div><h2 class="admin-card-title" id="sec-${key}">${esc(title)}</h2>${sub ? `<p class="admin-card-sub">${esc(sub)}</p>` : ''}</div></div>
    ${inner}</section>`;
}

/** Text-like control with label, optional hint and an error slot wired through aria-describedby. */
export function ctl({ key, label, control, hint = '', col = 'col-12', required = false, idPrefix = 'f' }) {
  const id = `${idPrefix}-${idKey(key)}`;
  const desc = `${hint ? `hint-${idKey(key)} ` : ''}err-${idKey(key)}`;
  return `<div class="${col}"><label class="form-label" for="${id}">${esc(label)}${required ? ' <span class="admin-req" aria-hidden="true">*</span>' : ''}</label>
    ${control(id, desc)}
    ${hint ? `<div class="form-text" id="hint-${idKey(key)}">${esc(hint)}</div>` : ''}
    <div class="invalid-feedback" id="err-${idKey(key)}" data-error-for="${esc(key)}"></div></div>`;
}

export const input = (key, value = '', attrs = '') => (id, desc) => `<input class="form-control" id="${id}" name="${key}" data-field="${key}" aria-describedby="${desc}" value="${esc(value)}" ${attrs}>`;

export const errorSummaryHtml = () => '<div class="alert alert-danger admin-error-summary" role="alert" tabindex="-1" data-error-summary hidden></div>';

/** Sticky bar: dirty note + extra buttons + Save. */
export function formBarHtml({ saveLabel = 'Αποθήκευση', extra = '' } = {}) {
  return `<div class="admin-formbar" data-formbar>
    <p class="admin-dirty" data-dirty-note hidden role="status"><i class="bi bi-dot" aria-hidden="true"></i>Μη αποθηκευμένες αλλαγές</p>
    <div class="admin-formbar-btns">${extra}<button type="submit" class="btn btn-dark" data-save>${esc(saveLabel)}</button></div>
  </div>`;
}

/**
 * Inline errors + summary for a form. `fieldEl(key)` locates the control of a key, `[data-error-for="key"]` is
 * its message slot, `labelFor(key)` names it in the summary.
 */
export function createErrorUi(scope, { fieldEl, labelFor = (k) => k }) {
  const summary = () => scope.querySelector('[data-error-summary]');
  function clear() {
    scope.querySelectorAll('.is-invalid').forEach((el) => { el.classList.remove('is-invalid'); el.removeAttribute('aria-invalid'); });
    scope.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; el.classList.remove('d-block'); });
    const sum = summary();
    if (sum) { sum.hidden = true; sum.innerHTML = ''; }
  }
  function clearField(el) {
    if (!el || !el.classList || !el.classList.contains('is-invalid')) return;
    el.classList.remove('is-invalid');
    el.removeAttribute('aria-invalid');
    const key = el.dataset.field || el.dataset.bind;
    const slot = key && scope.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
    if (slot) { slot.textContent = ''; slot.classList.remove('d-block'); }
  }
  /** errors: { key: message } (insertion order = summary order). */
  function show(errors, { focus = true } = {}) {
    clear();
    const keys = Object.keys(errors);
    keys.forEach((key) => {
      const el = fieldEl(key);
      const slot = scope.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
      if (slot) { slot.textContent = errors[key]; slot.classList.add('d-block'); }
      if (el) {
        el.classList.add('is-invalid');
        el.setAttribute('aria-invalid', 'true');
        if (slot && slot.id) {
          const cur = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
          if (!cur.includes(slot.id)) el.setAttribute('aria-describedby', [...cur, slot.id].join(' '));
        }
      }
    });
    const sum = summary();
    if (sum) {
      sum.innerHTML = `<p class="fw-semibold mb-1">Διορθώστε ${keys.length} ${keys.length === 1 ? 'πεδίο' : 'πεδία'} πριν την αποθήκευση:</p>
        <ul class="mb-0">${keys.map((k) => `<li><button type="button" class="btn btn-link p-0 admin-error-link" data-focus-field="${esc(k)}">${esc(labelFor(k))}</button>: ${esc(errors[k])}</li>`).join('')}</ul>`;
      sum.hidden = false;
      if (focus) {
        const first = keys.map(fieldEl).find(Boolean);
        if (first) first.focus(); else sum.focus();
      }
    }
  }
  scope.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-focus-field]');
    if (b) fieldEl(b.dataset.focusField)?.focus();
  });
  return { clear, clearField, show };
}
