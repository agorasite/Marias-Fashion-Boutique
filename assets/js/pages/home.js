import { html } from '../ui.js';
import { DEPARTMENTS } from '../components/header.js';

// Placeholder until the homepage task builds the editorial homepage. Keep the signature:
// export default async function render(ctx: { params, query, path }): Promise<HTMLElement>
export default async function render() {
  return html(`<section class="page home-placeholder" data-page="placeholder" data-route="/">
    <div class="hero-simple">
      <img src="assets/images/content/hero-1-sm.webp" srcset="assets/images/content/hero-1-sm.webp 480w, assets/images/content/hero-1.webp 1200w" sizes="(min-width: 992px) 50vw, 100vw" alt="Γυναίκα με μπεζ μακριά καμπαρντίνα περπατά δίπλα σε ηλιόλουστο μπεζ τοίχο" width="1200" height="800" fetchpriority="high">
      <div class="hero-simple-copy container-xl">
        <span class="eyebrow">Νέα συλλογή · Φθινόπωρο</span>
        <h1 class="display-title">Διαχρονική κομψότητα, κάθε μέρα</h1>
        <p class="lead-text">Ρούχα, παπούτσια και αξεσουάρ με καθαρές γραμμές και ποιοτικά υλικά.</p>
        <div class="d-flex flex-wrap gap-2">
          <a class="btn btn-dark btn-lg" href="#/catalog">Ανακαλύψτε τη συλλογή</a>
          <a class="btn btn-outline-dark btn-lg" href="#/catalog/women">Γυναικεία</a>
        </div>
      </div>
    </div>
    <div class="container-xl section">
      <div class="section-head">
        <span class="eyebrow">Κατηγορίες</span>
        <h2 class="section-title">Αγοράστε ανά κατηγορία</h2>
      </div>
      <ul class="dept-grid list-unstyled">
        ${DEPARTMENTS.map((d) => `<li><a class="dept-tile" href="#/catalog/${d.id}"><span>${d.label}</span><i class="bi bi-arrow-right" aria-hidden="true"></i></a></li>`).join('')}
      </ul>
      <p class="placeholder-note"><i class="bi bi-hourglass-split me-1" aria-hidden="true"></i>Σύντομα διαθέσιμο: η πλήρης αρχική σελίδα με προτεινόμενα προϊόντα, συλλογές και Instagram.</p>
    </div>
  </section>`);
}
