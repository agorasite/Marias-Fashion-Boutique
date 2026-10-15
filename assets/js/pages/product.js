import { placeholderPage } from '../ui.js';

// Placeholder until a later task builds this page. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  return placeholderPage({
    route: '/product',
    title: 'Σελίδα προϊόντος',
    text: 'Η σελίδα προϊόντος με επιλογή μεγέθους και χρώματος ετοιμάζεται.',
    links: [{ href: '#/catalog', label: 'Στον κατάλογο', primary: true }, { href: '#/', label: 'Αρχική' }],
  });
}
