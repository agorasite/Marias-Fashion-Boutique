const ICONS = { success: 'bi-check2-circle', danger: 'bi-exclamation-octagon', info: 'bi-info-circle' };

function container() {
  let c = document.getElementById('toastStack');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toastStack';
    c.className = 'toast-container toast-stack position-fixed p-3';
    document.body.append(c);
  }
  return c;
}

/** Show a short, auto-dismissing notification. type: 'success' | 'danger' | 'info'. */
export function toast(msg, type = 'success') {
  const kind = ICONS[type] ? type : 'info';
  const el = document.createElement('div');
  el.className = `toast toast-elan toast-${kind}`;
  el.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  el.setAttribute('aria-live', kind === 'danger' ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.innerHTML = `<div class="d-flex align-items-center gap-2">
      <i class="bi ${ICONS[kind]} toast-icon" aria-hidden="true"></i>
      <div class="toast-body flex-grow-1"></div>
      <button type="button" class="btn-close me-2" data-bs-dismiss="toast" aria-label="Κλείσιμο"></button>
    </div>`;
  el.querySelector('.toast-body').textContent = msg;
  container().append(el);
  // Auto-hide is managed here (not by Bootstrap's autohide): its hover/focus rescheduling can call hide() twice
  // during the fade-out, and the second callback then runs on a disposed toast (TypeError on a null element).
  const delay = kind === 'danger' ? 6000 : 3500;
  const t = window.bootstrap.Toast.getOrCreateInstance(el, { autohide: false });
  let timer = null;
  let hiding = false;
  const arm = () => { clearTimeout(timer); timer = setTimeout(hide, delay); };
  const hide = () => { if (hiding || !el.isConnected) return; hiding = true; clearTimeout(timer); t.hide(); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { if (!hiding) arm(); });
  el.addEventListener('focusout', () => { if (!hiding && !el.matches(':hover')) arm(); });
  el.querySelector('[data-bs-dismiss]').addEventListener('click', () => { hiding = true; clearTimeout(timer); });
  el.addEventListener('hidden.bs.toast', () => {
    clearTimeout(timer);
    t.dispose();
    el.remove();
  });
  t.show();
  arm();
  return el;
}
