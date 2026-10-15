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
  hooks.afterRender?.({ ...current, isFirst });
}

/** Start listening. options: { outlet, beforeRender, afterRender, renderError }. */
export function start(options) {
  ({ outlet, ...hooks } = options);
  if (!started) {
    window.addEventListener('hashchange', () => render());
    started = true;
  }
  if (!location.hash || location.hash === '#') history.replaceState(history.state, '', '#/');
  return render();
}
