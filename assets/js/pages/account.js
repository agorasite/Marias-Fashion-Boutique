import { placeholderPage } from '../ui.js';

// Account area placeholder (Task 10 builds it). The wishlist view is already functional.
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  if (ctx.path.startsWith('/account/wishlist')) return (await import('./wishlist.js')).default(ctx);
  return placeholderPage({
    route: '/account',
    title: ctx.path.startsWith('/account/orders') ? 'Οι παραγγελίες μου' : 'Ο λογαριασμός μου',
    text: 'Ο λογαριασμός πελάτη και το ιστορικό παραγγελιών ετοιμάζονται. Τα στοιχεία θα αποθηκεύονται μόνο σε αυτόν τον περιηγητή.',
  });
}
