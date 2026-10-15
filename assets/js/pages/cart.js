import { placeholderPage } from '../ui.js';

// Placeholder until a later task builds this page. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  return placeholderPage({
    route: '/cart',
    title: 'Καλάθι αγορών',
    text: 'Το καλάθι αγορών ετοιμάζεται και θα είναι διαθέσιμο σύντομα.',
    links: [{ href: '#/catalog', label: 'Συνέχεια αγορών', primary: true }],
  });
}
