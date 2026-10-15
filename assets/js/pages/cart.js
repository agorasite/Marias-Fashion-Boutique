import { html, escapeHtml as esc, formatMoney, toast } from '../ui.js';
import { getCart, getQuoteForCart, setQty, changeVariant, removeLine, applyCoupon, removeCoupon } from '../services/cart.js';
import { getAll } from '../db.js';
import { sizeLabel, compareSizes } from '../services/products.js';
import { couponMessage, freeShippingProgress } from '../services/cart-rules.js';

const smOf = (src) => src.replace(/\.webp$/, '-sm.webp');
const PROBLEM_TEXT = {
  'out-of-stock': 'Το προϊόν είναι προσωρινά εξαντλημένο. Αφαιρέστε το ή αλλάξτε επιλογή.',
  archived: 'Το προϊόν δεν είναι πλέον διαθέσιμο. Αφαιρέστε το από το καλάθι.',
  unknown: 'Το προϊόν δεν βρέθηκε. Αφαιρέστε το από το καλάθι.',
};

// Shipping choice survives re-renders and navigation within the session.
let shipMethod = 'courier';

const lineHtml = (l, openPanel, variantsByProduct) => {
  const sizeTxt = l.size == null ? '' : sizeLabel(l.size);
  const problem = l.problem;
  const atMax = l.available > 0 && l.qty >= l.available;
  const variantOptions = (variantsByProduct.get(l.productId) || [])
    .filter((v) => v.stock > 0 && v.sku !== l.sku)
    .sort((a, b) => a.color.localeCompare(b.color, 'el') || compareSizes(a.size, b.size));
  const insufficient = problem === 'insufficient';
  return `<li class="cart-line${problem ? ' has-problem' : ''}" data-sku="${esc(l.sku)}">
    <a class="cart-line-media" href="#/product/${esc(l.slug || '')}" tabindex="-1" aria-hidden="true">
      ${l.image ? `<img src="${esc(smOf(l.image))}" alt="" width="120" height="160" loading="lazy">` : '<span class="cart-line-fallback">ÉLAN</span>'}
    </a>
    <div class="cart-line-main">
      <p class="cart-line-brand">${esc(l.brand)}</p>
      <h3 class="cart-line-name">${l.slug ? `<a href="#/product/${esc(l.slug)}">${esc(l.name)}</a>` : esc(l.name)}</h3>
      <p class="cart-line-variant" data-variant>
        ${l.color ? `<span class="swatch" style="background:${esc(l.colorHex || '#ccc')}" aria-hidden="true"></span><span data-color>${esc(l.color)}</span>` : ''}
        ${sizeTxt ? `<span class="cart-line-sep" aria-hidden="true">·</span><span data-size>${esc(sizeTxt)}</span>` : ''}
      </p>
      <p class="cart-line-price">
        <span data-unit>${esc(formatMoney(l.unitCents))}</span>
        ${l.compareAtCents && l.compareAtCents > l.unitCents ? `<span class="price-old">${esc(formatMoney(l.compareAtCents))}</span>` : ''}
      </p>
      ${problem ? `<div class="cart-problem" role="alert" data-problem="${esc(problem)}">
        <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
        <div>
          <span>${insufficient ? `Διατίθενται μόνο ${l.available} τεμάχια.` : esc(PROBLEM_TEXT[problem])}</span>
          ${insufficient ? `<button type="button" class="btn btn-sm btn-dark mt-2" data-fix-qty>Ρύθμιση σε ${l.available} τεμ.</button>` : ''}
        </div>
      </div>` : ''}
      <div class="cart-line-actions">
        ${problem && !insufficient ? '' : `<div class="qty-stepper cart-stepper" role="group" aria-label="Ποσότητα: ${esc(l.name)}">
          <button type="button" class="qty-btn" data-qty-minus aria-label="Μείωση ποσότητας" ${l.qty <= 1 ? 'disabled' : ''}><i class="bi bi-dash" aria-hidden="true"></i></button>
          <input class="qty-input" type="number" inputmode="numeric" min="1" max="${l.available}" value="${l.qty}" data-qty-input aria-label="Ποσότητα" ${l.available <= 0 ? 'disabled' : ''}>
          <button type="button" class="qty-btn" data-qty-plus aria-label="Αύξηση ποσότητας" ${atMax || l.available <= 0 || insufficient ? 'disabled' : ''}><i class="bi bi-plus" aria-hidden="true"></i></button>
        </div>`}
        <button type="button" class="btn btn-link cart-link-btn" data-change-variant aria-expanded="${openPanel}" ${variantOptions.length ? '' : 'disabled'}>Αλλαγή επιλογής</button>
        <button type="button" class="btn btn-link cart-link-btn text-danger" data-remove aria-label="Αφαίρεση: ${esc(l.name)}"><i class="bi bi-trash3" aria-hidden="true"></i> Αφαίρεση</button>
      </div>
      ${atMax && !problem ? `<p class="cart-line-note" data-line-msg>Μέγιστη διαθέσιμη ποσότητα: ${l.available}.</p>` : ''}
      ${openPanel && variantOptions.length ? `<div class="cart-variant-panel" data-variant-panel role="group" aria-label="Διαθέσιμες επιλογές">
        <p class="small mb-2">Επιλέξτε νέο μέγεθος ή χρώμα:</p>
        <div class="d-flex flex-wrap gap-2">
          ${variantOptions.map((v) => `<button type="button" class="btn btn-outline-dark btn-sm cart-variant-opt" data-pick-sku="${esc(v.sku)}">
            <span class="swatch" style="background:${esc(v.colorHex || '#ccc')}" aria-hidden="true"></span>${esc(v.color)} · ${esc(sizeLabel(v.size))}</button>`).join('')}
        </div>
      </div>` : ''}
    </div>
    <p class="cart-line-total"><span class="visually-hidden">Σύνολο γραμμής: </span><span data-line-total>${esc(formatMoney(problem === 'archived' || problem === 'unknown' ? 0 : l.unitCents * l.qty))}</span></p>
  </li>`;
};

function summaryHtml(data) {
  const { quote: q, settings, couponCode, coupon } = data;
  const afterDiscount = q.subtotalCents - q.discountCents;
  const prog = freeShippingProgress(afterDiscount, settings.freeShippingThresholdCents);
  const couponErr = q.couponError ? couponMessage(q.couponError, coupon, formatMoney) : '';
  return `<div class="cart-summary-card">
    <h2 class="cart-summary-title">Σύνοψη παραγγελίας</h2>
    ${shipMethod === 'courier' ? `<div class="freeship" data-freeship>
      <p class="freeship-msg" data-freeship-msg>${prog.free
        ? '<i class="bi bi-truck" aria-hidden="true"></i> Έχετε δωρεάν μεταφορικά'
        : `Σας λείπουν <strong>${esc(formatMoney(prog.remainingCents))}</strong> για δωρεάν μεταφορικά`}</p>
      <div class="freeship-bar" role="progressbar" aria-label="Πρόοδος προς δωρεάν μεταφορικά" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${prog.pct}" data-freeship-bar>
        <span style="width:${prog.pct}%"></span>
      </div>
    </div>` : ''}
    <form class="cart-coupon" data-coupon-form novalidate>
      <label class="form-label" for="couponInput">Κωδικός κουπονιού</label>
      ${couponCode && !q.couponError
        ? `<div class="coupon-applied" data-coupon-applied><i class="bi bi-tag-fill" aria-hidden="true"></i>
            <span><strong>${esc(couponCode)}</strong> εφαρμόστηκε</span>
            <button type="button" class="btn btn-link cart-link-btn" data-coupon-remove>Αφαίρεση</button></div>`
        : `<div class="d-flex gap-2">
            <input class="form-control" id="couponInput" name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="π.χ. WELCOME10" data-coupon-input aria-describedby="couponMsg" value="">
            <button class="btn btn-outline-dark" type="submit" data-coupon-apply>Εφαρμογή</button>
          </div>`}
      <div id="couponMsg" class="coupon-msg" aria-live="polite" data-coupon-msg></div>
    </form>
    ${couponCode && q.couponError ? `<p class="coupon-warn" role="status" data-coupon-warning><i class="bi bi-exclamation-circle" aria-hidden="true"></i>
      Ο κωδικός <strong>${esc(couponCode)}</strong> δεν εφαρμόζεται πλέον: ${esc(couponMessage(q.couponError, coupon, formatMoney))}
      <button type="button" class="btn btn-link cart-link-btn" data-coupon-remove>Αφαίρεση κωδικού</button></p>` : ''}
    <fieldset class="cart-ship">
      <legend class="cart-ship-legend">Τρόπος παράδοσης</legend>
      <label class="ship-opt"><input type="radio" name="ship" value="courier" data-ship="courier" ${shipMethod === 'courier' ? 'checked' : ''}>
        <span>Courier στο σπίτι</span><span class="ship-opt-price">${esc(formatMoney(settings.courierCents))}</span></label>
      <label class="ship-opt"><input type="radio" name="ship" value="pickup" data-ship="pickup" ${shipMethod === 'pickup' ? 'checked' : ''}>
        <span>Παραλαβή από το κατάστημα</span><span class="ship-opt-price">Δωρεάν</span></label>
    </fieldset>
    <dl class="cart-totals">
      <div><dt>Υποσύνολο</dt><dd data-sum-subtotal>${esc(formatMoney(q.subtotalCents))}</dd></div>
      ${q.discountCents ? `<div class="is-discount"><dt>Έκπτωση${couponCode ? ` (${esc(couponCode)})` : ''}</dt><dd data-sum-discount>−${esc(formatMoney(q.discountCents))}</dd></div>` : ''}
      <div><dt>Μεταφορικά (εκτίμηση)</dt><dd data-sum-shipping>${q.shippingCents ? esc(formatMoney(q.shippingCents)) : 'Δωρεάν'}</dd></div>
      <div class="cart-total-row"><dt>Σύνολο</dt><dd data-sum-total>${esc(formatMoney(q.totalCents))}</dd></div>
      <div class="cart-vat"><dt>Συμπεριλαμβάνεται ΦΠΑ ${Math.round(settings.vatRate * 100)}%</dt><dd data-sum-vat>${esc(formatMoney(q.vatIncludedCents))}</dd></div>
    </dl>
    ${data.hasProblems
      ? `<button type="button" class="btn btn-dark btn-lg w-100" data-checkout disabled aria-describedby="checkoutNote">Ολοκλήρωση παραγγελίας</button>
         <p class="cart-checkout-note" id="checkoutNote" data-checkout-note>Διορθώστε τα προβλήματα διαθεσιμότητας στο καλάθι για να συνεχίσετε.</p>`
      : `<a class="btn btn-dark btn-lg w-100" href="#/checkout" data-checkout>Ολοκλήρωση παραγγελίας</a>`}
    <a class="btn btn-link w-100 mt-2" href="#/catalog" data-continue>Συνέχεια αγορών</a>
    <p class="cart-fine-print">Το κόστος αντικαταβολής (αν επιλεγεί) υπολογίζεται στο checkout.</p>
  </div>`;
}

function emptyHtml() {
  return `<div class="cart-empty" data-empty>
    <i class="bi bi-bag" aria-hidden="true"></i>
    <h2 class="h4">Το καλάθι σας είναι άδειο</h2>
    <p class="text-body-secondary">Ανακαλύψτε τις νέες αφίξεις και προσθέστε τα αγαπημένα σας κομμάτια.</p>
    <a class="btn btn-dark" href="#/catalog">Συνέχεια αγορών</a>
  </div>`;
}

export default async function render() {
  const root = html(`<section class="page cart-page" data-page="cart" data-route="/cart">
    <div class="container-xl">
      <h1 class="display-title cart-title">Καλάθι αγορών</h1>
      <div class="visually-hidden" role="status" aria-live="polite" data-announce></div>
      <div data-cart-body aria-busy="true">
        <div class="cart-skeleton" aria-hidden="true">
          <span class="skeleton cart-skel-line"></span><span class="skeleton cart-skel-line"></span><span class="skeleton cart-skel-line"></span>
        </div>
      </div>
    </div>
  </section>`);
  const body = root.querySelector('[data-cart-body]');
  const announce = root.querySelector('[data-announce]');
  let openSku = null; // line whose variant panel is open
  let couponNote = null; // { text, kind }
  let variantsByProduct = new Map();
  let busy = false;

  async function loadVariants() {
    const all = await getAll('variants');
    variantsByProduct = new Map();
    all.forEach((v) => {
      if (!variantsByProduct.has(v.productId)) variantsByProduct.set(v.productId, []);
      variantsByProduct.get(v.productId).push(v);
    });
  }

  async function paint(focusSel) {
    await loadVariants();
    const data = await getQuoteForCart(shipMethod, 'none');
    body.removeAttribute('aria-busy');
    if (!data.lines.length) {
      body.innerHTML = emptyHtml();
      return;
    }
    if (openSku && !data.lines.some((l) => l.sku === openSku)) openSku = null;
    body.innerHTML = `<div class="cart-grid">
      <div class="cart-items">
        ${data.hasProblems ? `<div class="cart-banner" role="alert" data-cart-problems>
          <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
          <span>Κάποια προϊόντα στο καλάθι σας δεν είναι διαθέσιμα στην ποσότητα που επιλέξατε. Διορθώστε τα για να συνεχίσετε στην ολοκλήρωση.</span>
        </div>` : ''}
        <ul class="cart-lines list-unstyled" data-lines>${data.lines.map((l) => lineHtml(l, l.sku === openSku, variantsByProduct)).join('')}</ul>
      </div>
      <aside class="cart-summary" aria-label="Σύνοψη παραγγελίας" data-summary>${summaryHtml(data)}</aside>
    </div>`;
    if (couponNote) {
      const msg = body.querySelector('[data-coupon-msg]');
      if (msg) {
        msg.textContent = couponNote.text;
        msg.className = `coupon-msg is-${couponNote.kind}`;
      }
    }
    if (focusSel) {
      const el = body.querySelector(focusSel);
      if (el && !el.disabled) el.focus();
      else body.querySelector('h2, [data-lines]')?.focus?.();
    }
  }

  const lineSelector = (sku, sel) => `.cart-line[data-sku="${CSS.escape(sku)}"] ${sel}`;

  async function run(fn, focusSel, keepNote = false) {
    if (busy) return;
    busy = true;
    if (!keepNote) couponNote = null;
    try {
      await fn();
    } catch (e) {
      console.warn('cart action failed', e);
      toast('Κάτι πήγε στραβά. Δοκιμάστε ξανά.', 'danger');
    } finally {
      busy = false;
      try { await paint(focusSel); } catch (e) { console.warn(e); }
    }
  }

  body.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t || !body.contains(t)) return;
    const line = t.closest('.cart-line');
    const sku = line && line.dataset.sku;
    if (t.matches('[data-qty-plus],[data-qty-minus]')) {
      const input = line.querySelector('[data-qty-input]');
      const next = Number(input.value) + (t.matches('[data-qty-plus]') ? 1 : -1);
      run(async () => {
        const r = await setQty(sku, next);
        if (!r.ok && r.reason === 'insufficient') announce.textContent = `Διατίθενται μόνο ${r.available} τεμάχια.`;
      }, lineSelector(sku, t.matches('[data-qty-plus]') ? '[data-qty-plus]' : '[data-qty-minus]'));
    } else if (t.matches('[data-remove]')) {
      const name = line.querySelector('.cart-line-name').textContent.trim();
      run(async () => {
        await removeLine(sku);
        announce.textContent = `Αφαιρέθηκε: ${name}`;
      }, 'h2');
    } else if (t.matches('[data-fix-qty]')) {
      run(async () => {
        const cur = (await getCart()).lines.find((l) => l.sku === sku);
        if (cur && cur.available > 0) await setQty(sku, cur.available);
      });
    } else if (t.matches('[data-change-variant]')) {
      openSku = openSku === sku ? null : sku;
      paint(lineSelector(sku, '[data-change-variant]'));
    } else if (t.matches('[data-pick-sku]')) {
      const newSku = t.dataset.pickSku;
      run(async () => {
        const r = await changeVariant(sku, newSku);
        openSku = null;
        if (!r.ok) toast('Η επιλογή δεν είναι διαθέσιμη.', 'danger');
        else if (r.merged) announce.textContent = 'Η επιλογή ενώθηκε με υπάρχουσα γραμμή του καλαθιού.';
        else if (r.clipped) announce.textContent = `Η ποσότητα προσαρμόστηκε στο διαθέσιμο απόθεμα (${r.qty}).`;
      }, lineSelector(newSku, '[data-change-variant]'));
    } else if (t.matches('[data-coupon-remove]')) {
      run(() => removeCoupon(), '#couponInput');
    }
  });

  body.addEventListener('change', (e) => {
    const input = e.target.closest('[data-qty-input]');
    if (input) {
      const sku = input.closest('.cart-line').dataset.sku;
      const v = Number(input.value);
      run(async () => {
        const r = await setQty(sku, Number.isFinite(v) && v >= 1 ? v : 1);
        if (!r.ok && r.reason === 'insufficient') announce.textContent = `Διατίθενται μόνο ${r.available} τεμάχια.`;
      }, lineSelector(sku, '[data-qty-input]'));
      return;
    }
    const ship = e.target.closest('[data-ship]');
    if (ship) {
      shipMethod = ship.value === 'pickup' ? 'pickup' : 'courier';
      paint(`[data-ship="${shipMethod}"]`);
    }
  });

  body.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-coupon-form]');
    if (!form) return;
    e.preventDefault();
    const code = form.querySelector('[data-coupon-input]')?.value || '';
    run(async () => {
      const r = await applyCoupon(code);
      if (r.ok) {
        couponNote = { text: `Ο κωδικός ${r.coupon.code} εφαρμόστηκε.`, kind: 'ok' };
      } else {
        couponNote = { text: couponMessage(r.reason, r.coupon, formatMoney), kind: 'error' };
      }
    }, '[data-coupon-input], [data-coupon-remove]', true);
  });

  await paint();
  return root;
}
