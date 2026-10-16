// Hash router. Pure helpers (matchRoute, parseHash) are safe to import in Node:
// nothing here touches `window` until start() is called.

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const segments = (p) => String(p || '').split('/').filter(Boolean);

/**
 * Match a route pattern ('/', '/catalog/:categoryId', '/admin/*') against a path.
 * Returns a params object on match, otherwise null. A trailing '/*' matches the
 * base path and any sub-path; the remainder is exposed as params['*'].
 */
export function matchRoute(pattern, path) {
  const pat = segments(pattern);
  const parts = segments(path);
  const wildcard = pat[pat.length - 1] === '*';
  if (wildcard) pat.pop();
  if (wildcard ? parts.length < pat.length : parts.length !== pat.length) return null;
  const params = {};
  for (let i = 0; i < pat.length; i += 1) {
    const seg = pat[i];
    if (seg.startsWith(':')) params[seg.slice(1)] = safeDecode(parts[i]);
    else if (seg !== parts[i]) return null;
  }
  if (wildcard) params['*'] = parts.slice(pat.length).map(safeDecode).join('/');
  return params;
}

/** Split '#/catalog?sort=price-asc' into { path: '/catalog', query: { sort: 'price-asc' } }. */
export function parseHash(hash) {
  let h = String(hash || '').replace(/^#/, '');
  const qi = h.indexOf('?');
  const qs = qi >= 0 ? h.slice(qi + 1) : '';
  h = qi >= 0 ? h.slice(0, qi) : h;
  if (!h.startsWith('/')) h = `/${h}`;
  const path = h.length > 1 ? h.replace(/\/+$/, '') || '/' : '/';
  const query = {};
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  return { path, query };
}

/** Build a hash from a path and a query object, dropping empty values. */
export function buildHash(path, query = {}) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

const routes = [];
let notFoundHandler = null;
let outlet = null;
let hooks = {};
let renderSeq = 0;
let current = null;
let started = false;
let guard = null; // optional page-owned leave check: (targetHash) => boolean | Promise<boolean>
let committedHash = null; // location.hash of the page currently rendered

/** Let the current page veto navigation (unsaved changes). Cleared automatically by the next render. */
// History bookkeeping for guarded navigation. Every committed page stamps its history entry with an
// index (history.state.elanIdx). When the guard must undo a URL change we can then restore the
// committed page WITHOUT destroying entries: a fresh push (no index yet) is popped with history.back();
// a back/forward jump is undone with history.go(delta). If the user confirms, a push is re-issued with
// navigate() and a jump is replayed with history.go(-delta), so back/forward stay consistent.
let currentIdx = null;
let restoring = null; // resolver while we wait for our own restoring hashchange
let guardPending = false;

function trackHistoryIndex() {
  const st = history.state;
  if (st && typeof st.elanIdx === 'number') { currentIdx = st.elanIdx; return; }
  currentIdx = currentIdx === null ? 0 : currentIdx + 1;
  history.replaceState({ ...(st && typeof st === 'object' ? st : {}), elanIdx: currentIdx }, '', location.href);
}

function restoreCommitted(targetIdx) {
  return new Promise((resolve) => {
    restoring = resolve;
    if (typeof targetIdx === 'number' && targetIdx !== currentIdx) history.go(currentIdx - targetIdx);
    else history.back();
  });
}

function onHashChange() {
  if (restoring) { const done = restoring; restoring = null; done(); return; } // our own undo
  if (guard && committedHash !== null && location.hash === committedHash) return; // late echo of an undo
  // In-page anchors (skip link '#app') are not navigations: never consult or clear the guard for them.
  if (guard && committedHash !== null && location.hash.startsWith('#/') && location.hash !== committedHash) {
    const target = location.hash;
    const st = history.state;
    const targetIdx = st && typeof st.elanIdx === 'number' ? st.elanIdx : null;
    const delta = targetIdx === null ? null : currentIdx - targetIdx;
    if (guardPending) { restoreCommitted(targetIdx); return; } // one dialog at a time: extra attempts are just undone
    let answer;
    try { answer = guard(target); } catch (err) { console.warn('Navigation guard failed', err); answer = false; }
    if (answer === true) { guard = null; render(); return; } // nothing to protect: no undo/redo round trip
    const restored = restoreCommitted(targetIdx);
    guardPending = true;
    Promise.resolve(answer)
      .catch((err) => { console.warn('Navigation guard failed', err); return false; })
      .then(async (ok) => {
        guardPending = false;
        if (!ok) return;
        await restored;
        guard = null;
        if (delta === null) navigate(target); else history.go(-delta);
      });
    return;
  }
  render();
}

const leaveCallbacks = [];
/** Run `fn` once when the current page is replaced by a real navigation (teardown of global listeners). */
export function onPageLeave(fn) { leaveCallbacks.push(fn); }
function runLeaveCallbacks() { leaveCallbacks.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); }

export function setNavigationGuard(fn) {
  guard = typeof fn === 'function' ? fn : null;
}

/** Register (or replace) a route. Later registrations of the same pattern win. */
export function route(pattern, handler, options = {}) {
  const existing = routes.findIndex((r) => r.pattern === pattern);
  const entry = { pattern, handler, layout: options.layout || (pattern.startsWith('/admin') ? 'admin' : 'store'), title: options.title };
  if (existing >= 0) routes[existing] = entry;
  else routes.push(entry);
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

/** Resolve a path to its route entry + params; static segments beat params by registration order. */
export function resolve(path) {
  for (const r of routes) {
    const params = matchRoute(r.pattern, path);
    if (params) return { entry: r, params };
  }
  return null;
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (replace) {
    history.replaceState(history.state, '', target);
    render();
  } else if (location.hash === target) {
    render();
  } else {
    location.hash = target;
  }
}

export function currentRoute() {
  return current;
}

function toNode(result) {
  if (result instanceof Node) return result;
  if (typeof result === 'string') {
    const t = document.createElement('template');
    t.innerHTML = result;
    return t.content;
  }
  return null;
}

async function render() {
  const raw = location.hash;
  // Non-route fragments (e.g. '#app' from a skip link) are not navigations.
  if (raw && !raw.startsWith('#/')) return;
  const seq = ++renderSeq;
  guard = null;
  runLeaveCallbacks();
  const { path, query } = parseHash(raw);
  const found = resolve(path);
  const entry = found ? found.entry : null;
  const params = found ? found.params : {};
  const ctx = { params, query, path, outlet };
  const layout = entry ? entry.layout : (path.startsWith('/admin') ? 'admin' : 'store');
  const isFirst = current === null;
  hooks.beforeRender?.({ path, query, layout });
  outlet.setAttribute('aria-busy', 'true');
  let result;
  try {
    result = await (entry ? entry.handler(ctx) : notFoundHandler?.(ctx));
  } catch (err) {
    if (seq !== renderSeq) return;
    result = hooks.renderError ? hooks.renderError(err, ctx) : null;
  }
  if (seq !== renderSeq) return; // a newer navigation superseded this one
  const node = toNode(result);
  if (node) outlet.replaceChildren(node);
  outlet.removeAttribute('aria-busy');
  current = { path, query, params, pattern: entry ? entry.pattern : null, layout };
  committedHash = raw;
  trackHistoryIndex();
  hooks.afterRender?.({ ...current, isFirst });
}

/** Start listening. options: { outlet, beforeRender, afterRender, renderError }. */
export function start(options) {
  ({ outlet, ...hooks } = options);
  if (!started) {
    window.addEventListener('hashchange', onHashChange);
    started = true;
  }
  if (!location.hash || location.hash === '#') history.replaceState(history.state, '', '#/');
  return render();
}
