// Image path helpers. Seeded photos live at assets/images/**/<name>.webp with a `-sm.webp` sibling;
// anything else (admin-added http(s) URLs, data: URLs from local uploads) has no sibling and must be
// used as-is.
const SEEDED_RE = /^assets\/images\/.+(?<!-sm)\.webp$/;

/** True when `src` is a seeded local photo that has a `-sm.webp` sibling. */
export const hasSm = (src) => SEEDED_RE.test(String(src ?? ''));

/** Small variant of an image; the same URL when no sibling exists (data:, remote, custom). */
export const smOf = (src) => (hasSm(src) ? String(src).replace(/\.webp$/, '-sm.webp') : String(src ?? ''));
