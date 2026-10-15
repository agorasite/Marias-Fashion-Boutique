import { html } from '../ui.js';

export default async function render() {
  return html(`<section class="page not-found-page" data-page="not-found" data-route="404">
    <div class="container-xl">
      <div class="placeholder-panel">
        <span class="eyebrow">Σφάλμα 404</span>
        <h1 class="display-title">Η σελίδα δεν βρέθηκε</h1>
        <p class="lead-text">Η διεύθυνση που ακολουθήσατε δεν υπάρχει ή έχει μετακινηθεί. Συνεχίστε την περιήγησή σας από την αρχική ή τον κατάλογο.</p>
        <div class="d-flex flex-wrap justify-content-center gap-2 mt-4">
          <a class="btn btn-dark" href="#/">Επιστροφή στην αρχική</a>
          <a class="btn btn-outline-dark" href="#/catalog">Δείτε τον κατάλογο</a>
        </div>
      </div>
    </div>
  </section>`);
}
