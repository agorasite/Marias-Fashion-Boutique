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
  const t = window.bootstrap.Toast.getOrCreateInstance(el, { delay: kind === 'danger' ? 6000 : 3500 });
  el.addEventListener('hidden.bs.toast', () => {
    t.dispose();
    el.remove();
  });
  t.show();
  return el;
}
