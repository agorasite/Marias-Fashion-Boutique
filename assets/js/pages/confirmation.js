import { placeholderPage } from '../ui.js';

// Placeholder until a later task builds this page. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  return placeholderPage({
    route: '/order',
    title: 'Επιβεβαίωση παραγγελίας',
    text: 'Η σελίδα επιβεβαίωσης παραγγελίας ετοιμάζεται.',
  });
}
