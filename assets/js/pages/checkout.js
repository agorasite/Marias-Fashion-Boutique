import { placeholderPage } from '../ui.js';

// Placeholder until a later task builds this page. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  return placeholderPage({
    route: '/checkout',
    title: 'Ολοκλήρωση παραγγελίας',
    text: 'Η ολοκλήρωση παραγγελίας (προσομοίωση) ετοιμάζεται.',
    links: [{ href: '#/cart', label: 'Επιστροφή στο καλάθι', primary: true }],
  });
}
