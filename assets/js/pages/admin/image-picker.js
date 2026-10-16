// Image picker for the content and settings editors: choose an editorial image from the local library
// (assets/images/credits.json → assets/images/content/*), type a path / https URL, or upload a file
// (resized client-side by image-upload.js into a WebP data URL). The allow-list is the one used for
// product images (services/product-admin-rules.js imageSourceError), http:// is additionally refused.
import { escapeHtml as esc } from '../../ui.js';
import { fileToDataUrl, probeImage } from './image-upload.js';
import { imageSourceError } from '../../services/product-admin-rules.js';
import { libraryImages } from '../../services/content-admin-rules.js';

let libraryPromise = null;
/** Library images (cached). Resolves [] when credits.json cannot be read. */
export function loadLibrary() {
  if (!libraryPromise) {
    libraryPromise = fetch(new URL('../../../images/credits.json', import.meta.url))
      .then((r) => (r.ok ? r.json() : {}))
      .then(libraryImages)
      .catch(() => []);
  }
  return libraryPromise;
}

/** Greek error for a typed value, or '' when allowed. */
export function pickerSourceError(src) {
  const s = String(src ?? '').trim();
  if (!s) return '';
  if (/^http:\/\//i.test(s)) return 'Επιτρέπονται μόνο διευθύνσεις https:// (όχι http://).';
  return imageSourceError(s);
}

/** Natural size of an image source ({} when it cannot be measured). */
export function measure(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
    img.onerror = () => resolve({});
    img.src = src;
  });
}

const thumbHtml = (src) => (src
  ? `<img src="${esc(src)}" alt="" width="64" height="64" data-picker-img>`
  : '<i class="bi bi-image" aria-hidden="true"></i>');

/**
 * Markup of one picker. `bind` is the data-bind path of the text input ('image' or 'items.0.image'),
 * `altBind` the path of the alt text input (omit for settings, which keeps its own alt field).
 * `fieldAttr` lets settings use data-field instead of data-bind.
 */
export function imagePickerHtml({ id, label = 'Εικόνα', bind, value = '', altBind = null, alt = '', required = true, attr = 'data-bind', altLabel = 'Εναλλακτικό κείμενο (alt)' }) {
  return `<div class="img-picker" data-image-picker data-required="${required ? '1' : '0'}">
    <div class="img-picker-main">
      <span class="img-picker-thumb" data-picker-thumb>${thumbHtml(value)}</span>
      <div class="img-picker-fields">
        <label class="form-label" for="${esc(id)}">${esc(label)}${required ? ' <span class="admin-req" aria-hidden="true">*</span>' : ''}</label>
        <input class="form-control" id="${esc(id)}" type="text" ${attr}="${esc(bind)}" data-img-src value="${esc(value)}" autocomplete="off" spellcheck="false"
          placeholder="assets/images/… ή https://…" aria-describedby="err-${esc(id)}">
        <div class="img-picker-btns">
          <button type="button" class="btn btn-sm btn-outline-dark" data-picker-toggle aria-expanded="false" aria-controls="lib-${esc(id)}"><i class="bi bi-images me-1" aria-hidden="true"></i>Από τη βιβλιοθήκη</button>
          <label class="btn btn-sm btn-outline-dark mb-0" for="up-${esc(id)}"><i class="bi bi-upload me-1" aria-hidden="true"></i>Ανέβασμα αρχείου</label>
          <input class="visually-hidden-focusable img-picker-file" id="up-${esc(id)}" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-picker-file aria-label="Ανέβασμα αρχείου εικόνας">
          ${required ? '' : '<button type="button" class="btn btn-sm btn-link text-danger" data-picker-clear>Αφαίρεση εικόνας</button>'}
        </div>
      </div>
    </div>
    <div class="img-picker-lib" id="lib-${esc(id)}" data-picker-lib hidden role="group" aria-label="Εικόνες βιβλιοθήκης"></div>
    <p class="img-picker-status" data-picker-status hidden></p>
    <div class="invalid-feedback" id="err-${esc(id)}" data-error-for="${esc(bind)}"></div>
    ${altBind !== null ? `<div class="mt-2"><label class="form-label" for="${esc(id)}-alt">${esc(altLabel)}</label>
      <input class="form-control" id="${esc(id)}-alt" type="text" ${attr}="${esc(altBind)}" value="${esc(alt)}" maxlength="300" autocomplete="off" aria-describedby="err-${esc(id)}-alt">
      <div class="invalid-feedback" id="err-${esc(id)}-alt" data-error-for="${esc(altBind)}"></div></div>` : ''}
  </div>`;
}

function setStatus(el, msg, kind) {
  const st = el.querySelector('[data-picker-status]');
  st.hidden = !msg;
  st.textContent = msg || '';
  st.className = `img-picker-status${kind ? ` is-${kind}` : ''}`;
  if (kind === 'error') st.setAttribute('role', 'alert'); else st.removeAttribute('role');
}

function showThumb(el, src) {
  const thumb = el.querySelector('[data-picker-thumb]');
  thumb.classList.remove('is-error');
  thumb.innerHTML = thumbHtml(src);
  const img = thumb.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      thumb.classList.add('is-error');
      thumb.innerHTML = '<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>';
      setStatus(el, 'Η εικόνα δεν φορτώνει. Ελέγξτε τη διεύθυνση.', 'error');
    }, { once: true });
    img.addEventListener('load', () => { if (el.querySelector('[data-picker-status]').classList.contains('is-error')) setStatus(el, '', ''); }, { once: true });
  }
}

/**
 * Wire every picker under `container` (delegated, so re-rendered markup keeps working).
 * `apply(pickerEl, patch)` receives { image, imageSm?, width?, height? } (image '' = cleared) after the picker
 * has written the text input; the caller stores it in its own state and marks the form dirty.
 */
export function bindImagePickers(container, { apply }) {
  const input = (el) => el.querySelector('[data-img-src]');
  const commit = async (el, src, { sm } = {}) => {
    input(el).value = src;
    showThumb(el, src);
    const patch = { image: src, imageSm: sm };
    if (src) Object.assign(patch, await measure(src));
    apply(el, patch);
  };
  container.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-image-picker]');
    if (!el || !container.contains(el)) return;
    const toggle = e.target.closest('[data-picker-toggle]');
    if (toggle) {
      const lib = el.querySelector('[data-picker-lib]');
      const open = lib.hidden;
      if (open && !lib.dataset.ready) {
        const items = await loadLibrary();
        lib.innerHTML = items.length
          ? items.map((i) => `<button type="button" class="img-picker-opt" data-lib="${esc(i.path)}" data-lib-sm="${esc(i.sm)}" aria-label="${esc(i.name)}" aria-pressed="false"><img src="${esc(i.sm)}" alt="" width="72" height="72" loading="lazy"><span>${esc(i.name)}</span></button>`).join('')
          : '<p class="img-picker-empty">Η βιβλιοθήκη δεν είναι διαθέσιμη. Χρησιμοποιήστε διαδρομή ή URL.</p>';
        lib.dataset.ready = '1';
      }
      lib.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      const cur = input(el).value;
      lib.querySelectorAll('[data-lib]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lib === cur)));
      if (open) lib.querySelector('button')?.focus();
      return;
    }
    const opt = e.target.closest('[data-lib]');
    if (opt) {
      setStatus(el, '', '');
      await commit(el, opt.dataset.lib, { sm: opt.dataset.libSm });
      const lib = el.querySelector('[data-picker-lib]');
      lib.hidden = true;
      el.querySelector('[data-picker-toggle]').setAttribute('aria-expanded', 'false');
      el.querySelector('[data-picker-toggle]').focus();
      return;
    }
    if (e.target.closest('[data-picker-clear]')) {
      setStatus(el, '', '');
      await commit(el, '');
      input(el).focus();
    }
  });
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const lib = e.target.closest?.('[data-picker-lib]');
    const el = e.target.closest?.('[data-image-picker]');
    if (lib && el && !lib.hidden) {
      e.stopPropagation();
      lib.hidden = true;
      const t = el.querySelector('[data-picker-toggle]');
      t.setAttribute('aria-expanded', 'false');
      t.focus();
    }
  });
  container.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-image-picker]');
    if (!el || !container.contains(el)) return;
    if (e.target.matches('[data-img-src]')) {
      const src = e.target.value.trim();
      e.target.value = src;
      const err = pickerSourceError(src);
      if (err) { showThumb(el, ''); setStatus(el, err, 'error'); apply(el, { image: src }); return; }
      setStatus(el, '', '');
      showThumb(el, src);
      // A hand-typed path/URL: no -sm sibling is assumed.
      const patch = { image: src, imageSm: undefined };
      if (src) {
        setStatus(el, 'Έλεγχος εικόνας…', 'loading');
        const ok = await probeImage(src);
        setStatus(el, ok ? '' : 'Η εικόνα δεν φορτώνει. Ελέγξτε τη διεύθυνση.', ok ? '' : 'error');
        if (ok) Object.assign(patch, await measure(src));
      }
      apply(el, patch);
    } else if (e.target.matches('[data-picker-file]')) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      setStatus(el, 'Επεξεργασία εικόνας…', 'loading');
      try {
        const url = await fileToDataUrl(file);
        const err = pickerSourceError(url);
        if (err) throw new Error(err);
        setStatus(el, '', '');
        await commit(el, url);
      } catch (ex) {
        setStatus(el, ex.message || 'Η εικόνα δεν μπόρεσε να φορτωθεί.', 'error');
      }
    }
  });
}
