import { placeholderPage } from '../ui.js';

// Placeholder until a later task builds this page. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render(ctx) {
  return placeholderPage({
    route: '/catalog',
    title: ctx.params.categoryId ? 'Κατάλογος · ' + ({ women: 'Γυναικεία', men: 'Ανδρικά', shoes: 'Παπούτσια', accessories: 'Αξεσουάρ' }[ctx.params.categoryId] || ctx.params.categoryId) : 'Κατάλογος',
    text: ctx.query.q ? `Η αναζήτηση για «${ctx.query.q}» θα είναι διαθέσιμη μόλις ολοκληρωθεί ο κατάλογος.` : 'Ο κατάλογος προϊόντων με φίλτρα, ταξινόμηση και αναζήτηση ετοιμάζεται.',
  });
}
