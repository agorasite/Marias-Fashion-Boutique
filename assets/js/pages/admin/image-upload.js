// Local image handling for the static demo: a chosen file is resized client-side (canvas, max 1200px)
// and stored as a WebP (JPEG fallback) data URL inside the product's images[]. No server involved.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 1200;
export const IMAGE_QUALITY = 0.82;

/** Greek error message for a file that cannot be used, or '' when it is acceptable. */
export function imageFileError(file) {
  if (!file) return 'Δεν επιλέχθηκε αρχείο.';
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type || '')) return `Το αρχείο «${file.name}» δεν είναι εικόνα.`;
  if (file.size > MAX_IMAGE_BYTES) return `Το αρχείο «${file.name}» είναι μεγαλύτερο από 5 MB.`;
  return '';
}

/** Target size keeping the aspect ratio, longest side at most `max`. */
export function fitSize(w, h, max = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/** @returns {Promise<string>} data URL; rejects with an Error whose message is Greek and user-facing. */
export async function fileToDataUrl(file) {
  const bad = imageFileError(file);
  if (bad) throw new Error(bad);
  let img;
  try { img = await loadImage(file); } catch (e) { throw new Error(`Το αρχείο «${file.name}» δεν μπορεί να διαβαστεί ως εικόνα.`); }
  const { width, height } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Ο περιηγητής δεν υποστηρίζει επεξεργασία εικόνας.');
  ctx.fillStyle = '#ffffff'; // flatten transparency for the JPEG fallback
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  let url = canvas.toDataURL('image/webp', IMAGE_QUALITY);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
  if (!url.startsWith('data:image/')) throw new Error(`Η εικόνα «${file.name}» δεν μπόρεσε να μετατραπεί.`);
  return url;
}

/** Resolves true when `src` loads as an image within `timeoutMs`. */
export function probeImage(src, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (ok) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
}
