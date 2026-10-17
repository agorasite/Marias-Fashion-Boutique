// Shared bits of the admin list pages (products, orders, customers, coupons): pager markup, <option>
// helper and "follow data changes while mounted" subscription with guaranteed teardown.
import { escapeHtml as esc } from '../../ui.js';
import { onPageLeave } from '../../router.js';

/** <option> with the current value pre-selected. */
export const opt = (value, label, selected) => `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(label)}</option>`;

/**
 * Pager for a paginate() result { page, pageSize, pageCount, total }. `label` is the nav's accessible
 * name (e.g. «Σελίδες παραγγελιών»). Buttons carry data-goto; the page owner handles the click.
 */
export function pagerHtml(r, label) {
  if (r.total === 0) return '';
  const from = (r.page - 1) * r.pageSize + 1;
  const to = Math.min(r.total, r.page * r.pageSize);
  return `<nav class="admin-pager" aria-label="${esc(label)}">
    <p class="admin-pager-info" data-range>Εμφάνιση ${from}–${to} από ${r.total}</p>
    <div class="admin-pager-btns">
      <button type="button" class="btn btn-sm btn-outline-dark" data-goto="${r.page - 1}"${r.page <= 1 ? ' disabled' : ''}><i class="bi bi-chevron-left" aria-hidden="true"></i> Προηγούμενη</button>
      <span class="admin-pager-page" aria-live="polite" data-page-info>Σελίδα ${r.page} από ${r.pageCount}</span>
      <button type="button" class="btn btn-sm btn-outline-dark" data-goto="${r.page + 1}"${r.page >= r.pageCount ? ' disabled' : ''}>Επόμενη <i class="bi bi-chevron-right" aria-hidden="true"></i></button>
    </div>
  </nav>`;
}

/**
 * Re-run `refresh` whenever one of the window `events` fires while `el` is mounted. Unsubscribes on the
 * next navigation (router onPageLeave) — and, as a fallback, the first time an event arrives after `el`
 * left the DOM — so revisiting a list never stacks listeners. Overlapping events coalesce into one
 * refresh at a time (a trailing one if more arrived meanwhile).
 */
export function followChanges(el, events, refresh) {
  let running = false;
  let again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; await refresh(); } while (again && el.isConnected);
    } catch (err) {
      console.warn('List refresh failed', err);
    } finally {
      running = false;
    }
  };
  const stop = () => events.forEach((t) => window.removeEventListener(t, onEvent));
  function onEvent() {
    if (!el.isConnected) { stop(); return; }
    run();
  }
  events.forEach((t) => window.addEventListener(t, onEvent));
  onPageLeave(stop);
  return stop;
}
