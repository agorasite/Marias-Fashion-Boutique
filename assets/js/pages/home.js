// Editorial homepage. Sections come from the `content` store (services/content.js) and live
// product queries (services/home-rules.js). Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
import { html, escapeHtml as esc } from '../ui.js';
import { DEPARTMENTS } from '../components/header.js';
import { productCard, productCardSkeleton } from '../components/product-card.js';
import { quickViewModal } from '../components/modals.js';
import { openShopTheLook, DEMO_FEED_LABEL } from '../components/shop-the-look.js';
import { getContent, loadDefaults, fillTokens, subscribeNewsletter, validateNewsletterEmail, CONTENT_KEYS } from '../services/content.js';
import { getSettings } from '../services/settings.js';
import { listProducts } from '../services/products.js';
import { selectHomeSections } from '../services/home-rules.js';

const DEPT_COPY = {
  women: { eyebrow: 'Γυναικεία', title: 'Για εκείνη', more: 'Όλα τα γυναικεία' },
  men: { eyebrow: 'Ανδρικά', title: 'Για εκείνον', more: 'Όλα τα ανδρικά' },
  shoes: { more: 'Όλα τα παπούτσια' },
  accessories: { more: 'Όλα τα αξεσουάρ' },
};

// ------------------------------------------------------------------ helpers
/** -sm siblings are generated with a 480px longest side. */
const smWidth = (w, h) => Math.round((w * 480) / Math.max(w, h));

function picture(d, { cls = '', sizes = '100vw', eager = false, alt } = {}) {
  const w = d.width || 1200;
  const h = d.height || 800;
  const srcset = d.imageSm ? ` srcset="${esc(d.imageSm)} ${smWidth(w, h)}w, ${esc(d.image)} ${w}w" sizes="${esc(sizes)}"` : '';
  const prio = eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
  return `<img class="${cls}" src="${esc(d.image)}"${srcset} width="${w}" height="${h}" alt="${esc(alt ?? d.alt)}"${prio} decoding="async">`;
}

const arrow = '<i class="bi bi-arrow-right" aria-hidden="true"></i>';

function sectionHead({ eyebrow, title, text, href, more, center = false, id }) {
  return `<div class="home-head${center ? ' is-center' : ''}">
    <div class="home-head-copy">
      ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
      <h2 class="section-title"${id ? ` id="${id}"` : ''}>${esc(title)}</h2>
      ${text ? `<p class="home-head-text">${esc(text)}</p>` : ''}
    </div>
    ${href ? `<a class="home-more" href="${esc(href)}">${esc(more)}${arrow}</a>` : ''}
  </div>`;
}

const skeletons = (n) => Array.from({ length: n }, () => `<li>${productCardSkeleton()}</li>`).join('');

async function safeContent(keys) {
  try {
    const docs = await Promise.all(keys.map((k) => getContent(k)));
    return Object.fromEntries(keys.map((k, i) => [k, docs[i]]));
  } catch (e) {
    return loadDefaults();
  }
}

// ------------------------------------------------------------------ section markup
function heroMarkup(hero) {
  const focal = /^[\w% ]+$/.test(hero.focal || '') ? hero.focal : '65% center';
  return `<section class="home-hero" data-section="hero" style="--hero-focal: ${esc(focal)}">
    ${picture(hero, { cls: 'home-hero-img', sizes: '(max-width: 767px) 250vw, 100vw', eager: true })}
    <div class="home-hero-shade" aria-hidden="true"></div>
    <div class="container-xl home-hero-inner">
      <div class="home-hero-copy">
        ${hero.eyebrow ? `<p class="home-hero-eyebrow">${esc(hero.eyebrow)}</p>` : ''}
        <h1 class="home-hero-title">${esc(hero.title)}</h1>
        ${hero.subtitle ? `<p class="home-hero-text">${esc(hero.subtitle)}</p>` : ''}
        <div class="home-hero-actions">
          <a class="btn btn-light btn-lg" href="${esc(hero.ctaHref)}">${esc(hero.ctaLabel)}</a>
          ${hero.secondaryHref ? `<a class="btn btn-outline-light btn-lg" href="${esc(hero.secondaryHref)}">${esc(hero.secondaryLabel)}</a>` : ''}
        </div>
      </div>
    </div>
  </section>`;
}

function departmentsMarkup(collections) {
  const tiles = new Map((collections.departments || []).map((d) => [d.id, d]));
  return `<section class="home-section container-xl reveal" data-section="departments" aria-labelledby="home-depts">
    ${sectionHead({ eyebrow: 'Κατηγορίες', title: 'Αγοράστε ανά κατηγορία', id: 'home-depts' })}
    <ul class="dept-cards list-unstyled">
      ${DEPARTMENTS.map((d) => {
        const t = tiles.get(d.id);
        return `<li><a class="dept-card" href="#/catalog/${d.id}">
          <span class="dept-card-media">${t ? picture(t, { sizes: '(min-width: 992px) 25vw, 50vw', alt: '' }) : ''}</span>
          <span class="dept-card-label"><span class="dept-card-name">${esc(d.label)}</span><span class="dept-card-count" data-dept-count="${d.id}"></span></span>
          <span class="dept-card-cta" aria-hidden="true">${arrow}</span>
        </a></li>`;
      }).join('')}
    </ul>
  </section>`;
}

function newCollectionMarkup() {
  return `<section class="home-section reveal" data-section="new-collection" aria-labelledby="home-new">
    <div class="container-xl">
      <div class="home-head">
        <div class="home-head-copy">
          <p class="eyebrow">Φθινόπωρο 2026</p>
          <h2 class="section-title" id="home-new">Νέα Συλλογή</h2>
        </div>
        <div class="home-head-tools">
          <a class="home-more" href="#/catalog?sort=newest">Όλη η νέα συλλογή${arrow}</a>
          <div class="scroller-nav" aria-hidden="false">
            <button type="button" class="scroller-btn" data-scroll-prev aria-label="Προηγούμενα προϊόντα"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
            <button type="button" class="scroller-btn" data-scroll-next aria-label="Επόμενα προϊόντα"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
          </div>
        </div>
      </div>
    </div>
    <div class="container-xl home-scroller-wrap">
      <ul class="home-scroller list-unstyled" data-scroller data-products tabindex="0" role="region" aria-label="Νέα Συλλογή: προϊόντα (κύλιση με τα βέλη)">${skeletons(4)}</ul>
      <div class="scroller-progress" aria-hidden="true"><span></span></div>
    </div>
  </section>`;
}

function promoMarkup(banners, promos, settings) {
  const items = (banners.items || []).filter((b) => b.placement === 'promo' && b.active !== false);
  const strip = promos.items || [];
  if (!items.length && !strip.length) return '';
  return `<section class="home-section home-promo reveal" data-section="promo" aria-label="Προνόμια και προσφορές">
    <div class="container-xl">
      ${items.map((b) => `<article class="promo-banner">
        ${b.image ? `<div class="promo-banner-media">${picture(b, { sizes: '(min-width: 992px) 58vw, 100vw' })}</div>` : ''}
        <div class="promo-banner-copy">
          ${b.eyebrow ? `<p class="eyebrow">${esc(b.eyebrow)}</p>` : ''}
          <h2 class="promo-banner-title" data-banner-title>${esc(fillTokens(b.title, settings))}</h2>
          ${b.text ? `<p class="promo-banner-text">${esc(fillTokens(b.text, settings))}</p>` : ''}
          ${b.ctaHref ? `<a class="btn btn-dark" href="${esc(b.ctaHref)}">${esc(b.ctaLabel)}</a>` : ''}
        </div>
      </article>`).join('')}
      ${strip.length ? `<ul class="promo-strip list-unstyled">
        ${strip.map((p) => `<li class="promo-item" data-promo-item="${esc(p.id)}">
          ${p.icon ? `<i class="bi bi-${esc(p.icon)}" aria-hidden="true"></i>` : ''}
          <span><strong>${esc(fillTokens(p.title, settings))}</strong>${p.text ? `<span>${esc(fillTokens(p.text, settings))}</span>` : ''}</span>
        </li>`).join('')}
      </ul>` : ''}
    </div>
  </section>`;
}

function deptSectionMarkup(id) {
  const c = DEPT_COPY[id];
  return `<section class="home-duo-col reveal" data-section="${id}" aria-labelledby="home-${id}">
    ${sectionHead({ eyebrow: c.eyebrow, title: c.title, href: `#/catalog/${id}`, more: c.more, id: `home-${id}` })}
    <ul class="product-grid home-grid-2 list-unstyled" data-products>${skeletons(4)}</ul>
  </section>`;
}

function featureMarkup(id, banner, flip) {
  const c = DEPT_COPY[id];
  const label = DEPARTMENTS.find((d) => d.id === id)?.label || id;
  return `<section class="home-section home-feature${flip ? ' is-flipped' : ''} reveal" data-section="${id}" aria-labelledby="home-${id}">
    <div class="container-xl home-feature-grid">
      <div class="home-feature-media">
        ${banner?.image ? picture(banner, { sizes: '(min-width: 992px) 42vw, 100vw' }) : ''}
        <div class="home-feature-copy">
          <p class="eyebrow">${esc(banner?.eyebrow || label)}</p>
          <h2 class="home-feature-title" id="home-${id}">${esc(banner?.title || label)}</h2>
          ${banner?.text ? `<p>${esc(banner.text)}</p>` : ''}
          <a class="btn btn-light" href="${esc(banner?.ctaHref || `#/catalog/${id}`)}">${esc(banner?.ctaLabel || c.more)}</a>
        </div>
      </div>
      <ul class="product-grid home-grid-4 list-unstyled" data-products>${skeletons(4)}</ul>
    </div>
  </section>`;
}

function gridSectionMarkup(name, { eyebrow, title, text, href, more, tone }) {
  return `<section class="home-section${tone ? ` home-tone-${tone}` : ''} reveal" data-section="${name}" aria-labelledby="home-${name}">
    <div class="container-xl">
      ${sectionHead({ eyebrow, title, text, href, more, id: `home-${name}` })}
      <ul class="product-grid home-grid-4 list-unstyled" data-products>${skeletons(4)}</ul>
    </div>
  </section>`;
}

function collectionsMarkup(collections) {
  const items = collections.items || [];
  if (!items.length) return '';
  return `<section class="home-section reveal" data-section="collections" aria-labelledby="home-collections">
    <div class="container-xl">
      ${sectionHead({ eyebrow: 'Επιμέλεια ÉLAN', title: 'Προτεινόμενες συλλογές', id: 'home-collections' })}
      <ul class="collection-grid list-unstyled">
        ${items.map((c) => `<li><a class="collection-card" href="${esc(c.href)}">
          <span class="collection-card-media">${picture(c, { sizes: '(min-width: 768px) 50vw, 100vw', alt: '' })}</span>
          <span class="collection-card-copy">
            <span class="collection-card-title">${esc(c.title)}</span>
            ${c.text ? `<span class="collection-card-text">${esc(c.text)}</span>` : ''}
            <span class="collection-card-cta">Ανακαλύψτε${arrow}</span>
          </span>
        </a></li>`).join('')}
      </ul>
    </div>
  </section>`;
}

function instagramMarkup(ig, profileUrl) {
  const posts = ig.posts || [];
  if (!posts.length) return '';
  return `<section class="home-section home-insta reveal" data-section="instagram" aria-labelledby="home-insta">
    <div class="container-xl">
      <div class="home-head is-center">
        <div class="home-head-copy">
          <p class="eyebrow"><i class="bi bi-instagram me-1" aria-hidden="true"></i>${esc(ig.handle)}</p>
          <h2 class="section-title" id="home-insta">${esc(ig.title || 'Instagram')}</h2>
          ${ig.text ? `<p class="home-head-text">${esc(ig.text)}</p>` : ''}
          <p class="insta-demo-note"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${DEMO_FEED_LABEL}</p>
        </div>
      </div>
      <ul class="insta-grid list-unstyled">
        ${posts.map((p) => `<li><button type="button" class="insta-tile" data-insta-tile="${esc(p.id)}" aria-haspopup="dialog" aria-label="Shop the look: ${esc(p.alt)}">
          ${picture(p, { sizes: '(min-width: 1200px) 380px, 33vw', alt: '' })}
          <span class="insta-tile-overlay" aria-hidden="true"><i class="bi bi-bag"></i><span>Shop the look</span></span>
        </button></li>`).join('')}
      </ul>
      ${profileUrl ? `<div class="text-center mt-4 mt-lg-5">
        <a class="btn btn-outline-dark" href="${esc(profileUrl)}" target="_blank" rel="noopener" data-insta-profile>
          <i class="bi bi-instagram" aria-hidden="true"></i>Ακολουθήστε το <span class="insta-handle">${esc(ig.handle)}</span><span class="visually-hidden"> στο Instagram (νέα καρτέλα)</span>
        </a>
      </div>` : ''}
    </div>
  </section>`;
}

function newsletterMarkup(nl) {
  if (nl.enabled === false) return '';
  return `<section class="home-newsletter reveal" data-section="newsletter" aria-labelledby="home-nl">
    <div class="container-xl home-newsletter-grid">
      <div>
        ${nl.eyebrow ? `<p class="eyebrow">${esc(nl.eyebrow)}</p>` : ''}
        <h2 class="home-newsletter-title" id="home-nl">${esc(nl.title)}</h2>
        ${nl.text ? `<p class="home-newsletter-text">${esc(nl.text)}</p>` : ''}
      </div>
      <form class="home-newsletter-form" data-newsletter-form novalidate>
        <label class="form-label" for="newsletterEmail">Email</label>
        <div class="nl-row">
          <input class="form-control" type="email" id="newsletterEmail" name="email" autocomplete="email" inputmode="email"
            placeholder="maria@example.gr" aria-describedby="newsletterHelp" aria-invalid="false">
          <button class="btn btn-light" type="submit">${esc(nl.buttonLabel)}</button>
        </div>
        <div class="invalid-feedback" id="newsletterError"></div>
        <p class="nl-help" id="newsletterHelp"><i class="bi bi-shield-check me-1" aria-hidden="true"></i>Demo: δεν αποστέλλεται κανένα πραγματικό email. Η εγγραφή αποθηκεύεται μόνο στον περιηγητή σας.</p>
        ${nl.privacyNote ? `<p class="nl-help" data-newsletter-privacy>${esc(nl.privacyNote)}</p>` : ''}
        <p class="nl-status" data-newsletter-status role="status" aria-live="polite"></p>
      </form>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ behaviour
function fillGrid(root, name, items, onQuick) {
  const sec = root.querySelector(`[data-section="${name}"]`);
  if (!sec) return;
  const list = sec.querySelector('[data-products]');
  if (!items.length) {
    sec.hidden = true;
    list.replaceChildren();
    return;
  }
  list.replaceChildren(...items.map((p) => {
    const li = document.createElement('li');
    li.append(productCard(p, { onQuickView: onQuick }));
    return li;
  }));
}

function bindScroller(root) {
  const sec = root.querySelector('[data-section="new-collection"]');
  if (!sec) return;
  const sc = sec.querySelector('[data-scroller]');
  const bar = sec.querySelector('.scroller-progress span');
  const prev = sec.querySelector('[data-scroll-prev]');
  const next = sec.querySelector('[data-scroll-next]');
  const update = () => {
    const max = sc.scrollWidth - sc.clientWidth;
    const ratio = max > 0 ? sc.clientWidth / sc.scrollWidth : 1;
    bar.style.width = `${Math.max(12, ratio * 100)}%`;
    bar.style.transform = `translateX(${max > 0 ? (sc.scrollLeft / max) * ((1 / ratio) - 1) * 100 : 0}%)`;
    prev.disabled = sc.scrollLeft <= 2;
    next.disabled = sc.scrollLeft >= max - 2;
  };
  const page = (dir) => sc.scrollBy({ left: dir * sc.clientWidth * 0.9, behavior: 'smooth' });
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(1));
  sc.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  sc.addEventListener('keydown', (e) => {
    if (e.target !== sc) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      sc.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * Math.max(160, sc.clientWidth * 0.5), behavior: 'smooth' });
    }
  });
  update();
  return update;
}

function bindNewsletter(root, nl) {
  const form = root.querySelector('[data-newsletter-form]');
  if (!form) return;
  const input = form.querySelector('input');
  const err = form.querySelector('.invalid-feedback');
  const status = form.querySelector('[data-newsletter-status]');
  const btn = form.querySelector('button[type="submit"]');
  const setError = (msg) => {
    input.classList.toggle('is-invalid', Boolean(msg));
    input.setAttribute('aria-invalid', String(Boolean(msg)));
    input.setAttribute('aria-describedby', msg ? 'newsletterError newsletterHelp' : 'newsletterHelp');
    err.textContent = msg || '';
  };
  input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') setError(''); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    status.className = 'nl-status';
    const v = validateNewsletterEmail(input.value);
    if (!v.ok) {
      setError(v.error);
      input.focus();
      return;
    }
    setError('');
    btn.disabled = true;
    try {
      const r = await subscribeNewsletter(v.email);
      if (r.status === 'invalid') {
        setError(r.error);
        input.focus();
      } else if (r.status === 'duplicate') {
        status.textContent = `Το ${r.email} είναι ήδη εγγεγραμμένο στο newsletter μας. Ευχαριστούμε που μας ακολουθείτε!`;
        status.classList.add('is-info');
      } else {
        status.textContent = `${nl.successText || 'Ευχαριστούμε! Η εγγραφή σας καταχωρήθηκε.'} (Demo: δεν αποστέλλεται email· η εγγραφή αποθηκεύτηκε τοπικά στον περιηγητή σας.)`;
        status.classList.add('is-success');
        input.value = '';
      }
    } catch (ex) {
      status.textContent = 'Η εγγραφή δεν ολοκληρώθηκε. Δοκιμάστε ξανά.';
      status.classList.add('is-error');
    } finally {
      btn.disabled = false;
    }
  });
}

function bindInstagram(root, ig) {
  root.querySelectorAll('[data-insta-tile]').forEach((tile) => {
    tile.addEventListener('click', () => {
      const post = (ig.posts || []).find((p) => p.id === tile.dataset.instaTile);
      if (post) openShopTheLook(post, { handle: ig.handle, returnFocus: tile });
    });
  });
}

function bindReveal(root) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  root.classList.add('motion-ok');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  root.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

function bindImageFallbacks(root) {
  root.querySelectorAll('img:not(.home-hero-img)').forEach((img) => {
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
  });
}

// ------------------------------------------------------------------ render
export default async function render() {
  const [content, settings] = await Promise.all([
    safeContent(CONTENT_KEYS),
    getSettings().catch(() => ({})),
  ]);
  const { hero, banners, collections, instagram, promos, newsletter } = content;
  const placed = (p) => (banners.items || []).find((b) => b.placement === p && b.active !== false);
  const profileUrl = /^https:\/\//.test(instagram.profileUrl || '') ? instagram.profileUrl
    : (/^https:\/\//.test(settings.social?.instagram || '') ? settings.social.instagram : '');

  const root = html(`<div class="page home" data-page="home" data-route="/">
    ${heroMarkup(hero)}
    ${departmentsMarkup(collections)}
    ${newCollectionMarkup()}
    ${promoMarkup(banners, promos, settings)}
    <div class="home-section">
      <div class="container-xl home-duo">
        ${deptSectionMarkup('women')}
        ${deptSectionMarkup('men')}
      </div>
    </div>
    ${featureMarkup('shoes', placed('shoes'), false)}
    ${featureMarkup('accessories', placed('accessories'), true)}
    ${gridSectionMarkup('best-sellers', { eyebrow: 'Οι αγαπημένες σας επιλογές', title: 'Best Sellers', text: 'Τα κομμάτια που επιστρέφουν ξανά και ξανά στις παραγγελίες σας.', href: '#/catalog?sort=popular', more: 'Δείτε τα δημοφιλή', tone: 'sand' })}
    ${gridSectionMarkup('new-arrivals', { eyebrow: 'Μόλις έφτασαν', title: 'Νέες Αφίξεις', href: '#/catalog?sort=newest', more: 'Όλες οι αφίξεις' })}
    ${collectionsMarkup(collections)}
    ${instagramMarkup(instagram, profileUrl)}
    ${newsletterMarkup(newsletter)}
  </div>`);

  const onQuick = (p, btn) => quickViewModal(p, { returnFocus: btn });
  const updateScroller = bindScroller(root);
  bindNewsletter(root, newsletter);
  bindInstagram(root, instagram);
  bindImageFallbacks(root);
  requestAnimationFrame(() => bindReveal(root));

  // Product sections fill after the shell (and hero) are in place; skeletons show meanwhile.
  listProducts({ pageSize: 10000 })
    .then(({ items }) => {
      const s = selectHomeSections(items);
      fillGrid(root, 'new-collection', s.newCollection, onQuick);
      for (const d of ['women', 'men', 'shoes', 'accessories']) fillGrid(root, d, s.departments[d], onQuick);
      fillGrid(root, 'best-sellers', s.bestSellers, onQuick);
      fillGrid(root, 'new-arrivals', s.newArrivals, onQuick);
      const duo = root.querySelector('.home-duo');
      if (duo && ![...duo.children].some((c) => !c.hidden)) duo.parentElement.hidden = true;
      for (const d of DEPARTMENTS) {
        const n = items.filter((p) => p.categoryId === d.id).length;
        const el = root.querySelector(`[data-dept-count="${d.id}"]`);
        if (el && n) el.textContent = `${n} κομμάτια`;
      }
      updateScroller?.();
    })
    .catch(() => {
      root.querySelectorAll('[data-products]').forEach((ul) => { ul.closest('[data-section]').hidden = true; });
    })
    .finally(() => { root.dataset.ready = 'true'; });

  return root;
}
