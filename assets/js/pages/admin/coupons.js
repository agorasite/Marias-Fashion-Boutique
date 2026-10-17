// Admin promotions (#/admin/promotions): coupon list with search + status filter, create/edit dialog with
// inline validation and a live discount preview, active toggle, delete (refused for used coupons, with a
// deactivate offer). Rules: services/coupon-rules.js. Data: services/coupons.js over the same `coupons`
// store the storefront cart and checkout read, so every change is effective in the shop immediately.
import { escapeHtml as esc, formatMoney, toast, confirmDialog } from '../../ui.js';
import { adminLayout } from './layout.js';
import { opt, followChanges } from './list-kit.js';
import {
  listCoupons, saveCoupon, setCouponActive, deleteCoupon, CouponError, couponStatus, previewDiscount, discountLabel,
  filterCoupons, validateCouponInput, localDateInput, STATUS_LABELS, SAMPLE_CART_CENTS,
} from '../../services/coupons.js';
import { centsToEuros } from '../../services/product-admin-rules.js';

const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS_ICON = { active: 'bi-check-circle', inactive: 'bi-pause-circle', expired: 'bi-calendar-x', exhausted: 'bi-slash-circle' };

// Kept at module level so the filters survive a visit elsewhere and back.
const DEFAULT_STATE = { q: '', status: '' };
let state = { ...DEFAULT_STATE };

const statusBadge = (s) => `<span class="admin-badge cp-${esc(s)}" data-status-badge="${esc(s)}"><i class="bi ${STATUS_ICON[s]}" aria-hidden="true"></i>${esc(STATUS_LABELS[s])}</span>`;
const eurosText = (cents) => centsToEuros(cents).replace('.', ',');

function toolbarHtml() {
  return `<div class="admin-card admin-cp-toolbar" data-coupons-toolbar>
    <div class="admin-toolbar-top">
      <div class="admin-search">
        <label class="visually-hidden" for="cl-q">Αναζήτηση κουπονιών</label>
        <i class="bi bi-search" aria-hidden="true"></i>
        <input class="form-control" id="cl-q" type="search" placeholder="Αναζήτηση με κωδικό" autocomplete="off" data-filter="q" value="${esc(state.q)}">
      </div>
      <div class="admin-cp-status">
        <label class="visually-hidden" for="cl-status">Κατάσταση κουπονιού</label>
        <select class="form-select" id="cl-status" data-filter="status">${opt('', 'Όλες οι καταστάσεις', state.status)}${Object.entries(STATUS_LABELS).map(([v, l]) => opt(v, l, state.status)).join('')}</select>
      </div>
      <button type="button" class="btn btn-dark" data-new-coupon><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Νέο κουπόνι</button>
    </div>
  </div>`;
}

function rowHtml(c, now) {
  const s = couponStatus(c, now);
  const used = Number(c.usedCount) || 0;
  const code = esc(c.code);
  const exp = c.expiresAt ? new Date(c.expiresAt) : null;
  return `<tr data-coupon-code="${code}" data-status="${s}" data-used="${used}">
    <td data-label="Κωδικός"><div><span class="admin-cp-code" data-cell="code">${code}</span></div></td>
    <td data-label="Έκπτωση" class="admin-num" data-cell="discount">${esc(discountLabel(c, formatMoney))}</td>
    <td data-label="Ελάχιστη αξία" class="admin-num" data-cell="min">${c.minSubtotalCents ? esc(formatMoney(c.minSubtotalCents)) : '<span class="admin-cp-none">Χωρίς ελάχιστο</span>'}</td>
    <td data-label="Λήξη" data-cell="expires">${exp && !Number.isNaN(exp.getTime()) ? `<time datetime="${esc(c.expiresAt)}">${esc(dateFmt.format(exp))}</time>` : '<span class="admin-cp-none">Χωρίς λήξη</span>'}</td>
    <td data-label="Χρήσεις" class="admin-num" data-cell="usage">${used} / ${c.maxUses == null ? '∞' : c.maxUses}</td>
    <td data-label="Κατάσταση"><div class="admin-badges">${statusBadge(s)}</div></td>
    <td data-label="Ενεργό"><button type="button" class="admin-switch${c.active ? ' is-on' : ''}" role="switch" aria-checked="${!!c.active}" data-action="toggle" aria-label="Ενεργό κουπόνι ${code}"><span class="admin-switch-knob" aria-hidden="true"></span></button></td>
    <td data-label="Ενέργειες"><div class="admin-actions">
      <button type="button" class="btn btn-sm btn-outline-dark" data-action="edit" aria-label="Επεξεργασία: ${code}" title="Επεξεργασία"><i class="bi bi-pencil" aria-hidden="true"></i><span class="admin-action-label">Επεξεργασία</span></button>
      <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" aria-label="Διαγραφή: ${code}" title="Διαγραφή"><i class="bi bi-trash3" aria-hidden="true"></i><span class="admin-action-label">Διαγραφή</span></button>
    </div></td>
  </tr>`;
}

// ------------------------------------------------------------------ create / edit dialog
let dialogSeq = 0;

function formDialog({ coupon, returnFocus }) {
  const editing = !!coupon;
  const id = `couponDialog${++dialogSeq}`;
  const c = coupon || { type: 'percent', value: '', minSubtotalCents: 0, expiresAt: null, maxUses: null, active: true, usedCount: 0 };
  const field = (key, label, control, hint = '') => `<div class="mb-3" data-field-wrap="${key}">
      <label class="form-label" for="${id}-${key}">${label}</label>
      ${control}
      ${hint ? `<div class="form-text" id="${id}-${key}-hint">${hint}</div>` : ''}
      <div class="invalid-feedback" id="${id}-${key}-err" data-error-for="${key}"></div>
    </div>`;
  const desc = (key, hint) => `${hint ? `${id}-${key}-hint ` : ''}${id}-${key}-err`;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="modal fade modal-elan" id="${id}" tabindex="-1" aria-labelledby="${id}-title" data-coupon-modal>
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <form class="modal-content" novalidate data-coupon-form>
        <div class="modal-header">
          <h2 class="modal-title h5" id="${id}-title">${editing ? `Επεξεργασία κουπονιού ${esc(c.code)}` : 'Νέο κουπόνι'}</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
        </div>
        <div class="modal-body">
          ${field('code', 'Κωδικός', `<input class="form-control text-uppercase" id="${id}-code" name="code" data-field="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="${desc('code', true)}" value="${esc(editing ? c.code : '')}"${editing ? ' readonly' : ''}>`,
    editing ? 'Ο κωδικός δεν αλλάζει μετά τη δημιουργία.' : '3–20 χαρακτήρες: λατινικά γράμματα, αριθμοί, παύλα ή κάτω παύλα.')}
          <div class="row g-3">
            <div class="col-12 col-sm-5">${field('type', 'Τύπος έκπτωσης', `<select class="form-select" id="${id}-type" name="type" data-field="type" aria-describedby="${desc('type')}">
              <option value="percent"${c.type === 'percent' ? ' selected' : ''}>Ποσοστό (%)</option><option value="fixed"${c.type === 'fixed' ? ' selected' : ''}>Σταθερό ποσό (€)</option></select>`)}</div>
            <div class="col-12 col-sm-7">${field('value', '<span data-value-label>Ποσοστό (1–100)</span>', `<input class="form-control" id="${id}-value" name="value" data-field="value" type="text" inputmode="decimal" autocomplete="off" aria-describedby="${desc('value')}" value="${esc(c.type === 'fixed' ? eurosText(c.value) : (c.value ?? ''))}">`)}</div>
          </div>
          <div class="admin-cp-preview mb-3" data-preview aria-live="polite"></div>
          ${field('minSubtotal', 'Ελάχιστη αξία καλαθιού (€)', `<input class="form-control" id="${id}-minSubtotal" name="minSubtotal" data-field="minSubtotal" type="text" inputmode="decimal" autocomplete="off" aria-describedby="${desc('minSubtotal', true)}" value="${esc(c.minSubtotalCents ? eurosText(c.minSubtotalCents) : '')}">`, 'Προαιρετικό. Κενό = χωρίς ελάχιστο.')}
          <div class="row g-3">
            <div class="col-12 col-sm-6">${field('expiresOn', 'Λήξη (έως και την ημέρα)', `<input class="form-control" id="${id}-expiresOn" name="expiresOn" data-field="expiresOn" type="date" aria-describedby="${desc('expiresOn', true)}" value="${esc(localDateInput(c.expiresAt))}">`, 'Προαιρετικό. Ισχύει μέχρι το τέλος της ημέρας.')}</div>
            <div class="col-12 col-sm-6">${field('maxUses', 'Μέγιστες χρήσεις', `<input class="form-control" id="${id}-maxUses" name="maxUses" data-field="maxUses" type="text" inputmode="numeric" autocomplete="off" aria-describedby="${desc('maxUses', true)}" value="${esc(c.maxUses ?? '')}">`, editing ? `Προαιρετικό. Έχουν γίνει ήδη ${Number(c.usedCount) || 0} χρήσεις.` : 'Προαιρετικό. Κενό = απεριόριστες.')}</div>
          </div>
          <div class="form-check form-switch mb-3" data-field-wrap="active">
            <input class="form-check-input" type="checkbox" role="switch" id="${id}-active" name="active" data-field="active"${c.active ? ' checked' : ''}>
            <label class="form-check-label" for="${id}-active">Ενεργό (μπορεί να χρησιμοποιηθεί στο κατάστημα)</label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-dark" data-bs-dismiss="modal">Άκυρο</button>
          <button type="submit" class="btn btn-dark" data-save>${editing ? 'Αποθήκευση αλλαγών' : 'Δημιουργία κουπονιού'}</button>
        </div>
      </form>
    </div>
  </div>`;
  const el = wrap.firstElementChild;
  document.body.append(el);
  const form = el.querySelector('form');
  const modal = window.bootstrap.Modal.getOrCreateInstance(el);
  const f = (k) => form.querySelector(`[data-field="${k}"]`);

  const read = () => ({
    code: f('code').value, type: f('type').value, value: f('value').value, minSubtotal: f('minSubtotal').value,
    expiresOn: f('expiresOn').value, maxUses: f('maxUses').value, active: f('active').checked,
  });
  const clearErrors = () => form.querySelectorAll('.is-invalid').forEach((x) => { x.classList.remove('is-invalid'); x.removeAttribute('aria-invalid'); });
  const showErrors = (errors) => {
    clearErrors();
    form.querySelectorAll('[data-error-for]').forEach((s) => { s.textContent = ''; s.classList.remove('d-block'); });
    const keys = Object.keys(errors);
    keys.forEach((k) => {
      const input = f(k);
      const slot = form.querySelector(`[data-error-for="${k}"]`);
      if (input) { input.classList.add('is-invalid'); input.setAttribute('aria-invalid', 'true'); }
      if (slot) { slot.textContent = errors[k]; slot.classList.add('d-block'); }
    });
    if (keys.length) {
      const first = ['code', 'type', 'value', 'minSubtotal', 'expiresOn', 'maxUses', 'active'].find((k) => errors[k]);
      f(first)?.focus();
    }
  };

  const syncLabels = () => {
    const pct = f('type').value === 'percent';
    form.querySelector('[data-value-label]').textContent = pct ? 'Ποσοστό (1–100)' : 'Ποσό έκπτωσης (€)';
    f('value').setAttribute('placeholder', pct ? 'π.χ. 10' : 'π.χ. 7,50');
  };
  const paintPreview = () => {
    const box = form.querySelector('[data-preview]');
    const d = read();
    // Run the REAL validation on the discount fields only, then the real pricing quote.
    const probe = validateCouponInput({ code: 'PREVIEW', type: d.type, value: d.value, minSubtotal: d.minSubtotal }, { existingCodes: [] });
    const cart = formatMoney(SAMPLE_CART_CENTS);
    if (!probe.ok && (probe.errors.type || probe.errors.value || probe.errors.minSubtotal)) {
      box.innerHTML = `<i class="bi bi-calculator" aria-hidden="true"></i><span>Συμπληρώστε έγκυρη έκπτωση για να δείτε προεπισκόπηση σε καλάθι ${esc(cart)}.</span>`;
      box.dataset.discountCents = '';
      return;
    }
    const p = previewDiscount(probe.value);
    box.dataset.discountCents = String(p.discountCents);
    box.innerHTML = p.error === 'min-spend'
      ? `<i class="bi bi-calculator" aria-hidden="true"></i><span>Παράδειγμα: σε καλάθι ${esc(cart)} το κουπόνι <strong>δεν εφαρμόζεται</strong> (ελάχιστη αξία ${esc(formatMoney(probe.value.minSubtotalCents))}).</span>`
      : `<i class="bi bi-calculator" aria-hidden="true"></i><span>Παράδειγμα: σε καλάθι ${esc(cart)} η έκπτωση είναι <strong data-preview-discount>${esc(formatMoney(p.discountCents))}</strong> και το νέο σύνολο ${esc(formatMoney(p.totalCents))}.</span>`;
  };
  syncLabels();
  paintPreview();

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('is-invalid')) { t.classList.remove('is-invalid'); t.removeAttribute('aria-invalid'); form.querySelector(`[data-error-for="${t.dataset.field}"]`)?.classList.remove('d-block'); }
    paintPreview();
  });
  form.addEventListener('change', (e) => { if (e.target === f('type')) { syncLabels(); paintPreview(); } });

  // Bootstrap ignores hide() while the show transition runs (a very fast Enter): close once it has finished.
  let shown = false;
  const close = () => { if (shown) modal.hide(); else el.addEventListener('shown.bs.modal', () => modal.hide(), { once: true }); };
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    form.querySelector('[data-save]').disabled = true;
    try {
      const saved = await saveCoupon({ ...read(), editingCode: editing ? c.code : undefined });
      close();
      toast(editing ? `Το κουπόνι ${saved.code} ενημερώθηκε.` : `Το κουπόνι ${saved.code} δημιουργήθηκε και ισχύει άμεσα στο κατάστημα.`, 'success');
    } catch (err) {
      if (err instanceof CouponError && err.code === 'invalid') showErrors(err.errors);
      else if (err instanceof CouponError) { toast('Το κουπόνι δεν βρέθηκε πλέον. Ανανεώστε τη σελίδα.', 'danger'); close(); } else {
        console.warn('Coupon save failed', err);
        toast('Η αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
      }
    } finally {
      busy = false;
      form.querySelector('[data-save]').disabled = false;
    }
  });

  // Keep Tab / Shift+Tab inside the dialog (Bootstrap's trap lets focus escape to the browser UI).
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...el.querySelectorAll('button:not([disabled]), input:not([readonly]), select, textarea, [href]')].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Bootstrap focuses the dialog when the fade ENDS; someone who already clicked into a field during the
  // fade keeps that field (otherwise their next keystrokes would land in the default field).
  let userFocus = null;
  el.addEventListener('focusin', (e) => { if (!shown && e.target !== el && e.target.matches('[data-field]')) userFocus = e.target; });
  el.addEventListener('shown.bs.modal', () => { shown = true; (userFocus?.isConnected ? userFocus : (editing ? f('value') : f('code'))).focus(); });
  el.addEventListener('hidden.bs.modal', () => {
    modal.dispose();
    el.remove();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  });
  modal.show();
}

// ------------------------------------------------------------------ page
export default async function render() {
  const { root, body } = adminLayout({
    active: 'promotions', title: 'Προωθήσεις', view: 'promotions', route: '/admin/promotions', crumbs: [{ label: 'Προωθήσεις' }],
    subtitle: 'Κουπόνια έκπτωσης: οι αλλαγές ισχύουν άμεσα στο καλάθι και στο checkout αυτού του περιηγητή.',
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';

  (async () => {
    let all;
    try { all = await listCoupons(); } catch (err) {
      console.warn('Coupon list load failed', err);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των κουπονιών. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.innerHTML = `${toolbarHtml()}<div class="admin-card admin-cp-results" data-results aria-live="polite"></div>`;
    body.removeAttribute('aria-busy');
    const results = body.querySelector('[data-results]');

    function paint() {
      const now = new Date();
      const rows = filterCoupons(all, state, now);
      const counts = `<p class="admin-count" data-count data-total="${all.length}" data-matching="${rows.length}"><strong>${rows.length}</strong> ${rows.length === 1 ? 'κουπόνι' : 'κουπόνια'}${rows.length !== all.length ? ` από ${all.length}` : ''}</p>`;
      if (!all.length) {
        results.innerHTML = '<div class="admin-empty" data-empty><i class="bi bi-ticket-perforated" aria-hidden="true"></i><p>Δεν υπάρχουν κουπόνια ακόμη.</p><button type="button" class="btn btn-dark btn-sm" data-new-coupon>Δημιουργήστε το πρώτο κουπόνι</button></div>';
        return;
      }
      if (!rows.length) {
        results.innerHTML = `${counts}<div class="admin-empty" data-empty><i class="bi bi-search" aria-hidden="true"></i><p>Κανένα κουπόνι δεν ταιριάζει με την αναζήτηση ή το φίλτρο.</p><button type="button" class="btn btn-outline-dark btn-sm" data-clear-filters>Καθαρισμός φίλτρων</button></div>`;
        return;
      }
      results.innerHTML = `${counts}<div class="admin-table-wrap admin-cp-wrap"><table class="table admin-table admin-table-stack admin-cp-table" data-coupons-table>
        <caption class="visually-hidden">Κουπόνια έκπτωσης</caption>
        <thead><tr><th scope="col">Κωδικός</th><th scope="col">Έκπτωση</th><th scope="col">Ελάχιστη αξία</th><th scope="col">Λήξη</th><th scope="col">Χρήσεις</th><th scope="col">Κατάσταση</th><th scope="col">Ενεργό</th><th scope="col"><span class="visually-hidden">Ενέργειες</span></th></tr></thead>
        <tbody>${rows.map((c) => rowHtml(c, now)).join('')}</tbody></table></div>`;
    }

    // Repaint from the database, keeping keyboard focus on the same row action.
    async function refresh() {
      const a = document.activeElement;
      const row = a && body.contains(a) && a.closest ? a.closest('tr[data-coupon-code]') : null;
      const keep = row && a.dataset.action ? `tr[data-coupon-code="${CSS.escape(row.dataset.couponCode)}"] [data-action="${a.dataset.action}"]` : null;
      all = await listCoupons();
      paint();
      if (keep) body.querySelector(keep)?.focus();
    }

    // Every save/toggle/delete dispatches coupons:changed; the list follows it (also from other pages).
    followChanges(body, ['coupons:changed'], refresh);

    let timer = null;
    body.addEventListener('input', (e) => {
      const el = e.target.closest('[data-filter="q"]');
      if (!el) return;
      state.q = el.value; // follows the input at once; only the repaint is debounced
      clearTimeout(timer);
      timer = setTimeout(paint, 150);
    });
    body.addEventListener('change', (e) => {
      const el = e.target.closest('[data-filter="status"]');
      if (!el) return;
      state.status = el.value;
      paint();
    });

    async function offerDeactivate(c) {
      const ok = await confirmDialog(
        `Το κουπόνι ${c.code} έχει χρησιμοποιηθεί σε παραγγελίες και δεν μπορεί να διαγραφεί, γιατί θα χαλούσε το ιστορικό τους. Μπορείτε να το απενεργοποιήσετε: δεν θα γίνεται πλέον δεκτό στο κατάστημα, ενώ οι παλιές παραγγελίες θα παραμείνουν ίδιες.`,
        { title: 'Η διαγραφή δεν είναι δυνατή', okLabel: 'Απενεργοποίηση', cancelLabel: 'Κλείσιμο' },
      );
      if (ok) {
        await setCouponActive(c.code, false);
        toast(`Το κουπόνι ${c.code} απενεργοποιήθηκε.`, 'success');
      }
      await refresh();
    }

    async function onDelete(c) {
      if ((Number(c.usedCount) || 0) > 0) { await offerDeactivate(c); return; }
      const ok = await confirmDialog(`Θα διαγραφεί οριστικά το κουπόνι ${c.code}. Η ενέργεια δεν αναιρείται.`, {
        title: 'Διαγραφή κουπονιού', okLabel: 'Διαγραφή', danger: true,
      });
      if (!ok) return;
      const r = await deleteCoupon(c.code);
      if (r.deleted) { toast(`Το κουπόνι ${c.code} διαγράφηκε.`, 'success'); await refresh(); body.querySelector('[data-new-coupon]')?.focus(); } else if (r.reason === 'used') { await refresh(); await offerDeactivate(c); } else { toast('Το κουπόνι δεν βρέθηκε πλέον.', 'danger'); await refresh(); }
    }

    body.addEventListener('click', async (e) => {
      const nw = e.target.closest('[data-new-coupon]');
      if (nw) { formDialog({ coupon: null, returnFocus: nw }); return; }
      if (e.target.closest('[data-clear-filters]')) {
        state = { ...DEFAULT_STATE };
        body.querySelector('[data-coupons-toolbar]').outerHTML = toolbarHtml();
        paint();
        body.querySelector('#cl-q').focus();
        return;
      }
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const code = btn.closest('tr[data-coupon-code]').dataset.couponCode;
      const c = all.find((x) => x.code === code);
      if (!c) return;
      try {
        if (btn.dataset.action === 'toggle') {
          await setCouponActive(code, !c.active);
          await refresh();
          toast(`Το κουπόνι ${code} ${c.active ? 'απενεργοποιήθηκε' : 'ενεργοποιήθηκε'}.`, 'success');
        } else if (btn.dataset.action === 'edit') {
          formDialog({ coupon: c, returnFocus: btn });
        } else if (btn.dataset.action === 'delete') {
          await onDelete(c);
        }
      } catch (err) {
        console.warn('Coupon action failed', err);
        toast('Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
        await refresh().catch(() => {});
      }
    });

    paint();
    view.dataset.ready = 'true';
  })();
  return root;
}
