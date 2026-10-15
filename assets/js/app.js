import { onDbError } from './db.js';
import { ensureSeeded } from './seed.js';

const app = document.getElementById('app');

function showError(err) {
  const blocked = err && err.code === 'blocked';
  app.innerHTML = `<div class="container py-5 text-center">
    <h1 class="h3">Σφάλμα βάσης δεδομένων</h1>
    <p>${blocked
      ? 'Η βάση δεδομένων είναι κλειδωμένη. Κλείστε τις άλλες καρτέλες της εφαρμογής και ανανεώστε τη σελίδα.'
      : 'Δεν είναι δυνατή η χρήση του IndexedDB στον περιηγητή σας. Ελέγξτε ότι δεν βρίσκεστε σε ιδιωτική περιήγηση και ανανεώστε τη σελίδα.'}</p>
  </div>`;
}

onDbError(showError);

(async () => {
  try {
    await ensureSeeded();
    app.innerHTML = '<div class="container py-5 text-center"><h1 class="h3">ÉLAN Fashion Boutique</h1></div>';
  } catch (e) {
    showError(e);
  }
})();
