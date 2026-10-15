import { escapeHtml as esc } from '../ui.js';

const smOf = (src) => src.replace(/\.webp$/, '-sm.webp');

/**
 * Product image gallery: main image, thumbnails and a keyboard-accessible lightbox.
 * Returns { el, lightbox } where `lightbox` is a modal element to append inside the page.
 */
export function createGallery({ images = [], name = '' }) {
  let index = 0;
  const el = document.createElement('div');
  el.className = 'pdp-gallery';
  const modalWrap = document.createElement('div');

  if (!images.length) {
    el.innerHTML = `<div class="pdp-main"><div class="product-card-fallback" role="img" aria-label="${esc(name)}"><span>ÉLAN</span></div></div>`;
    return { el, lightbox: modalWrap };
  }

  el.innerHTML = `<button type="button" class="pdp-main" data-lightbox-open aria-label="Μεγέθυνση εικόνας: ${esc(name)}" aria-haspopup="dialog">
      <img data-gallery-main src="${esc(images[0])}" width="800" height="1200" alt="${esc(name)}" loading="eager" fetchpriority="high" decoding="async">
      <span class="pdp-zoom" aria-hidden="true"><i class="bi bi-zoom-in"></i></span>
    </button>
    ${images.length > 1 ? `<ul class="pdp-thumbs list-unstyled" aria-label="Φωτογραφίες προϊόντος">${images.map((src, i) => `<li>
      <button type="button" class="pdp-thumb" data-thumb="${i}" aria-label="Φωτογραφία ${i + 1} από ${images.length}" aria-pressed="${i === 0}">
        <img src="${esc(smOf(src))}" width="96" height="144" alt="" loading="lazy" decoding="async">
      </button></li>`).join('')}</ul>` : ''}`;

  modalWrap.innerHTML = `<div class="modal fade modal-elan pdp-lightbox" id="lightboxModal" tabindex="-1" aria-label="Φωτογραφίες: ${esc(name)}" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <p class="modal-title small mb-0" data-lightbox-count aria-live="polite"></p>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Κλείσιμο"></button>
        </div>
        <div class="modal-body pdp-lightbox-body">
          ${images.length > 1 ? '<button type="button" class="pdp-lb-nav pdp-lb-prev" data-lightbox-prev aria-label="Προηγούμενη φωτογραφία"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>' : ''}
          <img data-lightbox-img src="${esc(images[0])}" alt="${esc(name)}">
          ${images.length > 1 ? '<button type="button" class="pdp-lb-nav pdp-lb-next" data-lightbox-next aria-label="Επόμενη φωτογραφία"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>' : ''}
        </div>
      </div>
    </div>
  </div>`;
  const lightbox = modalWrap.firstElementChild;

  const main = el.querySelector('[data-gallery-main]');
  const lbImg = lightbox.querySelector('[data-lightbox-img]');
  const lbCount = lightbox.querySelector('[data-lightbox-count]');
  const thumbs = [...el.querySelectorAll('[data-thumb]')];

  const show = (i) => {
    index = (i + images.length) % images.length;
    main.src = images[index];
    lbImg.src = images[index];
    lbCount.textContent = `${index + 1} / ${images.length}`;
    thumbs.forEach((t, n) => t.setAttribute('aria-pressed', String(n === index)));
  };
  lbCount.textContent = `1 / ${images.length}`;

  thumbs.forEach((t, n) => t.addEventListener('click', () => show(n)));
  el.querySelector('[data-lightbox-open]').addEventListener('click', () => {
    show(index);
    window.bootstrap.Modal.getOrCreateInstance(lightbox).show();
  });
  lightbox.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => show(index - 1));
  lightbox.querySelector('[data-lightbox-next]')?.addEventListener('click', () => show(index + 1));
  lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
  });
  main.addEventListener('error', () => {
    main.replaceWith(Object.assign(document.createElement('div'), { className: 'product-card-fallback', innerHTML: '<span>ÉLAN</span>' }));
  }, { once: true });

  return { el, lightbox, show };
}
