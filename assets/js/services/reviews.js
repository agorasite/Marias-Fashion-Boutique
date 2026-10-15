import { tx, reqP } from '../db.js';

/** Pure: { count, average (one decimal), distribution: {1..5} } for a list of reviews. */
export function summarizeReviews(reviews) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const r of reviews || []) {
    const n = Math.round(Number(r.rating));
    if (!(n >= 1 && n <= 5)) continue;
    distribution[n] += 1;
    sum += n;
    count += 1;
  }
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : 0, distribution };
}

/** Pure validation. Returns { ok, errors: { rating?, title?, body?, name? }, value } with trimmed values. */
export function validateReview(input) {
  const rating = Number(input && input.rating);
  const title = String((input && input.title) ?? '').trim();
  const body = String((input && input.body) ?? '').trim();
  const name = String((input && input.name) ?? '').trim();
  const errors = {};
  if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) errors.rating = 'Επιλέξτε βαθμολογία από 1 έως 5.';
  if (title.length < 3) errors.title = 'Ο τίτλος πρέπει να έχει τουλάχιστον 3 χαρακτήρες.';
  else if (title.length > 80) errors.title = 'Ο τίτλος μπορεί να έχει έως 80 χαρακτήρες.';
  if (body.length < 10) errors.body = 'Η κριτική πρέπει να έχει τουλάχιστον 10 χαρακτήρες.';
  else if (body.length > 1000) errors.body = 'Η κριτική μπορεί να έχει έως 1000 χαρακτήρες.';
  if (name.length < 2) errors.name = 'Συμπληρώστε το όνομά σας.';
  else if (name.length > 40) errors.name = 'Το όνομα μπορεί να έχει έως 40 χαρακτήρες.';
  return { ok: Object.keys(errors).length === 0, errors, value: { rating, title, body, name } };
}

export async function listReviews(productId) {
  const all = await tx(['reviews'], 'readonly', (t) => reqP(t.objectStore('reviews').getAll()));
  return all
    .filter((r) => r.productId === productId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function addReview({ productId, rating, title, body, name }) {
  const v = validateReview({ rating, title, body, name });
  if (!v.ok) throw Object.assign(new Error('Invalid review'), { code: 'invalid', errors: v.errors });
  const id = `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rec = {
    id,
    productId,
    rating: v.value.rating,
    title: v.value.title,
    body: v.value.body,
    author: v.value.name,
    createdAt: new Date().toISOString(),
    local: true,
  };
  await tx(['reviews'], 'readwrite', (t) => reqP(t.objectStore('reviews').put(rec)));
  return rec;
}
