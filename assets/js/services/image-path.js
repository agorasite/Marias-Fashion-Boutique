// Image path helpers. Seeded photos live at assets/images/**/<name>.webp with a `-sm.webp` sibling;
// anything else (admin-added http(s) URLs, data: URLs from local uploads) has no sibling and must be
// used as-is.
const SEEDED_RE = /^assets\/images\/products\/[a-z0-9-]+-\d+\.webp$/;

/** True when `src` is a seeded local photo that has a `-sm.webp` sibling. */
export const hasSm = (src) => SEEDED_RE.test(String(src ?? ''));

/** Small variant of an image; the same URL when no sibling exists (data:, remote, custom). */
export const smOf = (src) => (hasSm(src) ? String(src).replace(/\.webp$/, '-sm.webp') : String(src ?? ''));

// Content library photos wider than 1200px (only the hero today) also ship a 1200w `-md.webp` sibling,
// so phones (which crop the hero to ~2.5× the viewport width) do not download the 1920w original.
const CONTENT_RE = /^assets\/images\/content\/[a-z0-9-]+\.webp$/;
const MD_MIN_WIDTH = 1600;
export const MD_WIDTH = 1200;

/** True when `src` is a content library photo of `width` px that has a 1200w `-md.webp` sibling. */
export const hasMd = (src, width) => CONTENT_RE.test(String(src ?? '')) && !/-(sm|md)\.webp$/.test(src) && Number(width) >= MD_MIN_WIDTH;

/** The 1200w sibling (only meaningful when hasMd()). */
export const mdOf = (src) => String(src).replace(/\.webp$/, '-md.webp');
