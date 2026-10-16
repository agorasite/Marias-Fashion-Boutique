// Admin overview dashboard. Every number is computed by services/stats.js (computeStats) from the
// orders, products, variants and customers stored in IndexedDB — nothing here is hardcoded.
import { tx, reqP } from '../../db.js';
import { html, escapeHtml, formatMoney } from '../../ui.js';
import { computeStats, FULFILLMENT_STATUSES, LOW_VARIANT_STOCK, SALES_DAYS } from '../../services/stats.js';
import { fulfillmentLabel, paymentStatusLabel } from '../../services/account-rules.js';
import { adminLayout } from './layout.js';

const LOW_STOCK_THRESHOLD = 5;
const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('el-GR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat('el-GR', { weekday: 'short', day: 'numeric', month: 'short' });
const intFmt = new Intl.NumberFormat('el-GR');
const axisMoney = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const localDate = (key) => new Date(`${key}T12:00:00`);

export const STAT_CARDS = [
  { key: 'totalOrders', label: 'Σύνολο παραγγελιών', icon: 'bi-receipt', short: 'Σε όλες τις καταστάσεις', hint: 'Όλες οι αποθηκευμένες παραγγελίες, σε κάθε κατάσταση.' },
  { key: 'revenueCents', label: 'Έσοδα demo', icon: 'bi-cash-stack', money: true, short: 'Χωρίς ακυρωμένες/επιστραμμένες', hint: 'Άθροισμα των συνόλων όλων των παραγγελιών εκτός από τις ακυρωμένες και τις επιστραμμένες (προσομοίωση, χωρίς πραγματικές πληρωμές).' },
  { key: 'pending', label: 'Εκκρεμείς', icon: 'bi-hourglass-split', short: 'Σε κατάσταση «Παραλήφθηκε»', hint: 'Παραγγελίες σε κατάσταση «Παραλήφθηκε», που δεν έχουν επιβεβαιωθεί ακόμη.' },
  { key: 'completed', label: 'Ολοκληρωμένες', icon: 'bi-check2-circle', short: 'Παραδομένες στον πελάτη', hint: 'Παραγγελίες που έχουν παραδοθεί στον πελάτη.' },
  { key: 'activeProducts', label: 'Προϊόντα', icon: 'bi-bag', short: 'Ενεργά, χωρίς αρχειοθετημένα', hint: 'Ενεργά προϊόντα του καταλόγου (χωρίς τα αρχειοθετημένα).' },
  { key: 'lowStockProducts', label: 'Χαμηλό απόθεμα', icon: 'bi-exclamation-triangle', count: true, short: 'Συνολικό απόθεμα έως 5 τεμ.', hint: `Ενεργά προϊόντα με συνολικό απόθεμα έως ${LOW_STOCK_THRESHOLD} τεμάχια σε όλες τις παραλλαγές.` },
  { key: 'customers', label: 'Τοπικοί πελάτες', icon: 'bi-people', short: 'Αποθηκευμένοι σε αυτόν τον περιηγητή', hint: 'Πελάτες demo αποθηκευμένοι σε αυτόν τον περιηγητή.' },
];

async function loadData() {
  return tx(['orders', 'products', 'variants', 'customers'], 'readonly', async (t) => {
    const all = (s) => reqP(t.objectStore(s).getAll());
    const [orders, products, variants, customers] = await Promise.all([all('orders'), all('products'), all('variants'), all('customers')]);
    return { orders, products, variants, customers };
  });
}

const STATUS_ICON = {
  pending: 'bi-inbox', confirmed: 'bi-check2', processing: 'bi-box-seam', shipped: 'bi-truck',
  delivered: 'bi-house-check', cancelled: 'bi-x-circle', returned: 'bi-arrow-counterclockwise',
};
const PAY_ICON = { pending: 'bi-clock', 'simulated-paid': 'bi-check2-circle', refunded: 'bi-arrow-return-left' };
export const fulfillmentBadge = (s) => `<span class="admin-badge st-${escapeHtml(s)}"><i class="bi ${STATUS_ICON[s] || 'bi-question-circle'}" aria-hidden="true"></i>${escapeHtml(fulfillmentLabel(s))}</span>`;
export const paymentBadge = (s) => `<span class="admin-badge pay-${escapeHtml(s)}"><i class="bi ${PAY_ICON[s] || 'bi-question-circle'}" aria-hidden="true"></i>${escapeHtml(paymentStatusLabel(s))}</span>`;

const thumb = (src, alt = '') => (src
  ? `<img class="admin-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="44" height="58" loading="lazy">`
  : '<span class="admin-thumb admin-thumb-empty" aria-hidden="true">É</span>');

// ------------------------------------------------------------------ skeleton
function skeletonHtml() {
  const card = '<div class="admin-card admin-stat is-loading"><span class="skeleton skeleton-line w-50"></span><span class="skeleton skeleton-line"></span></div>';
  const block = (h) => `<div class="admin-card is-loading" style="min-height:${h}px"><span class="skeleton skeleton-line w-25"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>`;
  return `<div data-admin-loading aria-hidden="true">
    <div class="admin-stats">${card.repeat(STAT_CARDS.length)}</div>
    <div class="admin-grid admin-grid-chart">${block(280)}${block(280)}</div>
    ${block(320)}
  </div>
  <p class="visually-hidden" role="status">Φόρτωση στατιστικών…</p>`;
}

// ------------------------------------------------------------------ stat cards
function statsHtml(s) {
  return `<div class="admin-stats">${STAT_CARDS.map((c) => {
    const raw = c.count ? s[c.key].length : s[c.key];
    const shown = c.money ? formatMoney(raw) : intFmt.format(raw);
    const id = `stat-hint-${c.key}`;
    return `<div class="admin-card admin-stat" title="${escapeHtml(c.hint)}">
      <div class="admin-stat-top"><span class="admin-stat-label">${escapeHtml(c.label)}</span><span class="admin-stat-icon" aria-hidden="true"><i class="bi ${c.icon}"></i></span></div>
      <p class="admin-stat-value" data-stat="${c.key}" data-value="${raw}" aria-describedby="${id}">${escapeHtml(shown)}</p>
      <p class="admin-stat-hint" aria-hidden="true">${escapeHtml(c.short)}</p>
      <span class="visually-hidden" id="${id}">${escapeHtml(c.hint)}</span>
    </div>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ sales chart (inline SVG, no library)
function niceMax(v) {
  if (v <= 0) return 10000; // 100 € scale for an empty chart
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function chartLabel(days) {
  const rev = days.reduce((n, d) => n + d.revenueCents, 0);
  const cnt = days.reduce((n, d) => n + d.orders, 0);
  const span = `${dayFmt.format(localDate(days[0].date))} – ${dayFmt.format(localDate(days[days.length - 1].date))}`;
  if (!cnt) return `Έσοδα demo ανά ημέρα, τελευταίες ${SALES_DAYS} ημέρες (${span}): δεν υπάρχουν παραγγελίες.`;
  const best = days.reduce((a, b) => (b.revenueCents > a.revenueCents ? b : a), days[0]);
  return `Έσοδα demo ανά ημέρα, τελευταίες ${SALES_DAYS} ημέρες (${span}): σύνολο ${formatMoney(rev)} από ${cnt} παραγγελίες. `
    + `Υψηλότερη ημέρα ${longDayFmt.format(localDate(best.date))} με ${formatMoney(best.revenueCents)}.`;
}

/** Draw the bar chart into `box` at its current pixel width (redrawn on resize). */
export function drawSalesChart(box, days) {
  const W = Math.max(260, Math.round(box.clientWidth || 600));
  const H = W < 480 ? 200 : 290;
  const m = { l: W < 480 ? 46 : 58, r: 6, t: 12, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = niceMax(Math.max(...days.map((d) => d.revenueCents)));
  const step = iw / days.length;
  const bw = Math.max(2, step - (step > 8 ? 3 : 1.5));
  const y = (v) => m.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const grid = ticks.map((v) => `<g class="chart-tick"><line x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line>
    <text x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(axisMoney.format(v / 100))}</text></g>`).join('');
  const bars = days.map((d, i) => {
    const x = m.l + i * step + (step - bw) / 2;
    const h = d.revenueCents > 0 ? Math.max(2, (d.revenueCents / max) * ih) : 0;
    const r = Math.min(3, bw / 2);
    // rounded top, square base (anchored to the baseline)
    const path = h > 0
      ? `M${x.toFixed(1)},${(m.t + ih).toFixed(1)}V${(m.t + ih - h + r).toFixed(1)}q0,-${r} ${r},-${r}h${(bw - 2 * r).toFixed(1)}q${r},0 ${r},${r}V${(m.t + ih).toFixed(1)}Z`
      : '';
    return `<g class="chart-col" data-i="${i}">${path ? `<path class="chart-bar" d="${path}"></path>` : ''}
      <rect class="chart-hit" x="${(m.l + i * step).toFixed(1)}" y="${m.t}" width="${step.toFixed(1)}" height="${ih}"></rect></g>`;
  }).join('');
  const labelEvery = W < 480 ? 10 : 7;
  const xl = days.map((d, i) => ((days.length - 1 - i) % labelEvery === 0
    ? `<text x="${(m.l + i * step + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${escapeHtml(dayFmt.format(localDate(d.date)))}</text>` : '')).join('');
  box.querySelector('svg')?.remove();
  box.insertAdjacentHTML('afterbegin', `<svg class="sales-svg" role="img" aria-label="${escapeHtml(chartLabel(days))}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" focusable="false">
    <g class="chart-grid">${grid}</g>
    <line class="chart-base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"></line>
    <g class="chart-bars">${bars}</g>
    <g class="chart-x">${xl}</g>
  </svg>`);
  const svg = box.querySelector('svg');
  const tip = box.querySelector('[data-chart-tip]');
  const show = (e) => {
    const col = e.target.closest('.chart-col');
    if (!col) return;
    const d = days[Number(col.dataset.i)];
    svg.querySelectorAll('.chart-col.is-hover').forEach((c) => c.classList.remove('is-hover'));
    col.classList.add('is-hover');
    tip.innerHTML = `<strong>${escapeHtml(longDayFmt.format(localDate(d.date)))}</strong><span>${escapeHtml(formatMoney(d.revenueCents))}</span><span>${d.orders} ${d.orders === 1 ? 'παραγγελία' : 'παραγγελίες'}</span>`;
    tip.hidden = false;
    const cx = m.l + Number(col.dataset.i) * step + step / 2;
    const left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
    tip.style.left = `${left}px`;
  };
  svg.addEventListener('pointerover', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    svg.querySelectorAll('.chart-col.is-hover').forEach((c) => c.classList.remove('is-hover'));
  });
}

function chartCardHtml(days) {
  const rev = days.reduce((n, d) => n + d.revenueCents, 0);
  const cnt = days.reduce((n, d) => n + d.orders, 0);
  const rows = days.map((d) => `<tr><th scope="row">${escapeHtml(longDayFmt.format(localDate(d.date)))}</th><td>${d.orders}</td><td>${escapeHtml(formatMoney(d.revenueCents))}</td></tr>`).join('');
  return `<section class="admin-card admin-chart-card" aria-labelledby="salesTitle">
    <div class="admin-card-head">
      <div>
        <h2 class="admin-card-title" id="salesTitle">Πωλήσεις · τελευταίες ${SALES_DAYS} ημέρες</h2>
        <p class="admin-card-sub">Έσοδα demo ανά ημέρα (χωρίς ακυρωμένες/επιστραμμένες)</p>
      </div>
      <dl class="admin-chart-totals">
        <div><dt>Έσοδα</dt><dd data-sales-total>${escapeHtml(formatMoney(rev))}</dd></div>
        <div><dt>Παραγγελίες</dt><dd>${cnt}</dd></div>
      </dl>
    </div>
    <div class="admin-chart" data-sales-chart>
      <div class="admin-chart-tip" data-chart-tip hidden aria-hidden="true"></div>
      ${cnt ? '' : '<p class="admin-chart-empty">Δεν υπάρχουν παραγγελίες τις τελευταίες 30 ημέρες.</p>'}
    </div>
    <div class="visually-hidden"><table data-sales-table>
      <caption>Πωλήσεις ανά ημέρα, τελευταίες ${SALES_DAYS} ημέρες</caption>
      <thead><tr><th scope="col">Ημέρα</th><th scope="col">Παραγγελίες</th><th scope="col">Έσοδα demo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

// ------------------------------------------------------------------ status distribution
function statusHtml(s) {
  const total = s.totalOrders || 0;
  const rows = FULFILLMENT_STATUSES.map((k) => {
    const n = s.statusCounts[k];
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<li class="admin-status-row st-${k}">
      <div class="admin-status-meta"><span class="admin-status-name"><i class="bi ${STATUS_ICON[k]}" aria-hidden="true"></i>${escapeHtml(fulfillmentLabel(k))}</span>
        <span class="admin-status-num"><strong data-status-count="${k}" data-value="${n}">${n}</strong> <span>· ${pct}%</span></span></div>
      <div class="admin-status-track" aria-hidden="true"><span style="width:${pct}%"></span></div>
    </li>`;
  }).join('');
  return `<section class="admin-card" aria-labelledby="statusTitle">
    <div class="admin-card-head"><div><h2 class="admin-card-title" id="statusTitle">Κατάσταση παραγγελιών</h2>
      <p class="admin-card-sub">Κατανομή όλων των ${intFmt.format(total)} παραγγελιών</p></div></div>
    <ul class="admin-status-list">${rows}</ul>
  </section>`;
}

// ------------------------------------------------------------------ recent orders
function recentHtml(s) {
  const body = s.recent.length
    ? `<div class="admin-table-wrap"><table class="table admin-table admin-table-stack">
        <thead><tr><th scope="col">Παραγγελία</th><th scope="col">Πελάτης</th><th scope="col">Ημερομηνία</th><th scope="col" class="text-end">Σύνολο</th><th scope="col">Κατάσταση</th></tr></thead>
        <tbody>${s.recent.map((o) => {
          const d = new Date(o.createdAt);
          const name = `${o.customer?.firstName || ''} ${o.customer?.lastName || ''}`.trim() || '—';
          return `<tr data-recent-order="${escapeHtml(o.id)}">
            <td data-label="Παραγγελία"><a class="admin-order-link" href="#/admin/orders/${encodeURIComponent(o.id)}">${escapeHtml(o.id)}</a></td>
            <td data-label="Πελάτης"><div><span class="admin-cust">${escapeHtml(name)}</span><span class="admin-cust-mail">${escapeHtml(o.customer?.email || '')}</span></div></td>
            <td data-label="Ημερομηνία"><div><time datetime="${escapeHtml(o.createdAt)}">${escapeHtml(dateFmt.format(d))}<span class="admin-time"> ${escapeHtml(timeFmt.format(d))}</span></time></div></td>
            <td data-label="Σύνολο" class="text-lg-end admin-num">${escapeHtml(formatMoney(o.totals?.totalCents || 0))}</td>
            <td data-label="Κατάσταση"><div class="admin-badges">${fulfillmentBadge(o.fulfillmentStatus)}${paymentBadge(o.paymentStatus)}</div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
    : `<div class="admin-empty" data-recent-empty><i class="bi bi-receipt" aria-hidden="true"></i><p>Δεν υπάρχουν ακόμη παραγγελίες.</p>
        <a class="btn btn-outline-dark btn-sm" href="#/catalog">Δοκιμαστική αγορά στο κατάστημα</a></div>`;
  return `<section class="admin-card" aria-labelledby="recentTitle">
    <div class="admin-card-head"><div><h2 class="admin-card-title" id="recentTitle">Πρόσφατες παραγγελίες</h2>
      <p class="admin-card-sub">Οι ${s.recent.length || ''} νεότερες παραγγελίες</p></div>
      <a class="admin-card-link" href="#/admin/orders">Όλες οι παραγγελίες <i class="bi bi-arrow-right" aria-hidden="true"></i></a></div>
    ${body}
  </section>`;
}

// ------------------------------------------------------------------ top products / low stock
function topHtml(s) {
  const body = s.topProducts.length
    ? `<ol class="admin-rank">${s.topProducts.map((p, i) => `<li data-top-product="${escapeHtml(p.productId)}">
        <span class="admin-rank-n">${i + 1}</span>${thumb(p.image)}
        <span class="admin-rank-name">${escapeHtml(p.name)}</span>
        <span class="admin-rank-val"><strong>${p.qty} τεμ.</strong><span>${escapeHtml(formatMoney(p.revenueCents))}</span></span>
      </li>`).join('')}</ol>`
    : '<div class="admin-empty" data-top-empty><i class="bi bi-bar-chart" aria-hidden="true"></i><p>Δεν υπάρχουν ακόμη πωλήσεις.</p></div>';
  return `<section class="admin-card" aria-labelledby="topTitle">
    <div class="admin-card-head"><div><h2 class="admin-card-title" id="topTitle">Δημοφιλέστερα προϊόντα</h2>
      <p class="admin-card-sub">Τεμάχια που πωλήθηκαν (χωρίς ακυρωμένες/επιστραμμένες)</p></div></div>
    ${body}
  </section>`;
}

function lowStockHtml(s) {
  const body = s.lowStockProducts.length
    ? `<ul class="admin-rank admin-low">${s.lowStockProducts.map((p) => `<li data-low-stock-item="${escapeHtml(p.productId)}">
        ${thumb(p.image)}
        <span class="admin-rank-name">${escapeHtml(p.name)}</span>
        <span class="admin-stock ${p.totalStock === 0 ? 'is-out' : ''}">${p.totalStock === 0 ? 'Εξαντλήθηκε' : `${p.totalStock} τεμ.`}</span>
        <a class="admin-row-link" href="#/admin/products" aria-label="Διαχείριση αποθέματος: ${escapeHtml(p.name)}"><i class="bi bi-chevron-right" aria-hidden="true"></i></a>
      </li>`).join('')}</ul>`
    : '<div class="admin-empty" data-low-empty><i class="bi bi-check2-circle" aria-hidden="true"></i><p>Όλα τα ενεργά προϊόντα έχουν επαρκές απόθεμα.</p></div>';
  return `<section class="admin-card" aria-labelledby="lowTitle">
    <div class="admin-card-head"><div><h2 class="admin-card-title" id="lowTitle">Χαμηλό απόθεμα</h2>
      <p class="admin-card-sub">Συνολικό απόθεμα έως ${LOW_STOCK_THRESHOLD} τεμάχια</p></div>
      <a class="admin-card-link" href="#/admin/products">Προϊόντα <i class="bi bi-arrow-right" aria-hidden="true"></i></a></div>
    ${body}
    <p class="admin-card-foot" data-low-variants="${s.lowStockVariants.length}"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${s.lowStockVariants.length} παραλλαγές (μέγεθος/χρώμα) έχουν μόνο 1–${LOW_VARIANT_STOCK} τεμάχια.</p>
  </section>`;
}

// ------------------------------------------------------------------ page
export default async function render() {
  const { root, body } = adminLayout({
    active: 'overview', title: 'Επισκόπηση', view: 'overview', route: '/admin', crumbs: [{ label: 'Επισκόπηση' }],
    subtitle: 'Στατιστικά υπολογισμένα από τα δεδομένα IndexedDB αυτού του περιηγητή.',
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = skeletonHtml();

  (async () => {
    let s;
    try {
      const d = await loadData();
      s = computeStats(d.orders, d.products, d.variants, d.customers, { now: new Date(), lowStockThreshold: LOW_STOCK_THRESHOLD });
    } catch (err) {
      console.warn('Overview load failed', err);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των δεδομένων. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.innerHTML = `${statsHtml(s)}
      <div class="admin-grid admin-grid-chart">${chartCardHtml(s.salesByDay)}${statusHtml(s)}</div>
      ${recentHtml(s)}
      <div class="admin-grid admin-grid-half">${topHtml(s)}${lowStockHtml(s)}</div>
      <p class="admin-footnote"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Υπολογίστηκε στις ${escapeHtml(timeFmt.format(new Date()))}. Demo κατάστημα: οι πληρωμές είναι προσομοίωση και τα δεδομένα δεν συγχρονίζονται με άλλους περιηγητές.</p>`;
    body.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'admin-thumb admin-thumb-empty', textContent: 'É' }));
    }, true);
    const box = body.querySelector('[data-sales-chart]');
    drawSalesChart(box, s.salesByDay);
    let lastW = box.clientWidth;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (!box.isConnected) { ro.disconnect(); return; }
        if (Math.abs(box.clientWidth - lastW) < 4) return;
        lastW = box.clientWidth;
        drawSalesChart(box, s.salesByDay);
      });
      ro.observe(box);
    }
    body.removeAttribute('aria-busy');
    view.dataset.ready = 'true';
  })();
  return root;
}
