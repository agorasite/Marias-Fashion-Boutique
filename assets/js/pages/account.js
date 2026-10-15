import { placeholderPage } from '../ui.js';

// Placeholder until a later task builds this page. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  return placeholderPage({
    route: ctx.path.startsWith('/account/wishlist') ? '/account/wishlist' : '/account',
    title: ctx.path.startsWith('/account/wishlist') ? 'Αγαπημένα' : ctx.path.startsWith('/account/orders') ? 'Οι παραγγελίες μου' : 'Ο λογαριασμός μου',
    text: 'Ο λογαριασμός πελάτη, το ιστορικό παραγγελιών και τα αγαπημένα ετοιμάζονται. Τα στοιχεία θα αποθηκεύονται μόνο σε αυτόν τον περιηγητή.',
  });
}
