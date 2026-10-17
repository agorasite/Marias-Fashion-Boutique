// Admin backups (#/admin/backup): (A) export every store as a local JSON file, (B) import a backup —
// validated immediately, previewed, and applied only after a typed confirmation, in ONE transaction —
// and (C) reset the demo to the original dataset after a typed confirmation.
// Rules: services/backup-rules.js (pure). Data: services/backup.js.
import { escapeHtml as esc, toast, confirmDialog } from '../../ui.js';
import { adminLayout } from './layout.js';
import { downloadBlob } from './orders.js';
import {
  exportAll, importAll, resetDemo, storeCounts, serializeBackup, validateImport, parseBackupText, backupSizeError, backupFileName,
  STORE_NAMES, STORE_LABELS,
} from '../../services/backup.js';

export const IMPORT_CONFIRM_TEXT = 'ΑΝΤΙΚΑΤΑΣΤΑΣΗ';
export const RESET_CONFIRM_TEXT = 'ΕΠΑΝΑΦΟΡΑ';
const IMPORT_FAILED = 'Η εισαγωγή απέτυχε — τα υπάρχοντα δεδομένα δεν άλλαξαν.';
const REFRESH_FAILED = 'Η εισαγωγή ολοκληρώθηκε αλλά η ανανέωση της προβολής απέτυχε — φορτώστε ξανά τη σελίδα.';
const RESET_ITEMS = [
  'Όλα τα προϊόντα, οι παραλλαγές και το απόθεμα όπως τα αλλάξατε',
  'Όλες οι παραγγελίες, οι πελάτες και οι κριτικές που δημιουργήθηκαν τοπικά',
  'Οι αλλαγές σε ρυθμίσεις, κουπόνια και περιεχόμενο αρχικής',
  'Το καλάθι, τα αγαπημένα και οι εγγραφές newsletter',
];

const nf = new Intl.NumberFormat('el-GR');
const n = (v) => nf.format(Number(v) || 0);

function countsTable(counts, caption) {
  const rows = STORE_NAMES.map((s) => `<tr data-store="${s}"><th scope="row">${esc(STORE_LABELS[s])}</th><td class="admin-num text-end" data-count>${n(counts[s])}</td></tr>`).join('');
  return `<table class="table admin-table backup-counts"><caption class="visually-hidden">${esc(caption)}</caption>
    <thead><tr><th scope="col">Δεδομένα</th><th scope="col" class="text-end">Εγγραφές</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function previewTable(current, incoming) {
  const rows = STORE_NAMES.map((s) => {
    const a = Number(current[s]) || 0;
    const b = Number(incoming[s]) || 0;
    const diff = b === a ? '' : ` <span class="backup-diff ${b > a ? 'is-up' : 'is-down'}">(${b > a ? '+' : '−'}${n(Math.abs(b - a))})</span>`;
    return `<tr data-store="${s}"><th scope="row">${esc(STORE_LABELS[s])}</th><td class="admin-num text-end" data-current>${n(a)}</td>
      <td class="backup-arrow" aria-hidden="true">→</td><td class="admin-num text-end" data-incoming>${n(b)}${diff}</td></tr>`;
  }).join('');
  return `<table class="table admin-table backup-preview-table"><caption class="visually-hidden">Τρέχουσες εγγραφές και εγγραφές του αντιγράφου</caption>
    <thead><tr><th scope="col">Δεδομένα</th><th scope="col" class="text-end">Τώρα</th><th scope="col" aria-hidden="true"></th><th scope="col" class="text-end">Μετά</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const listHtml = (items, cls) => `<ul class="backup-list ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

function pageHtml(counts) {
  return `<div class="backup-page">
    <div class="admin-info-box backup-local-note" data-local-note>
      <p class="mb-0"><i class="bi bi-hdd me-1" aria-hidden="true"></i>Τα δεδομένα του demo υπάρχουν <strong>μόνο σε αυτόν τον περιηγητή</strong> (IndexedDB). Δεν υπάρχει server ούτε αντίγραφο cloud· αν καθαρίσετε τα δεδομένα του ιστότοπου, χάνονται.</p>
    </div>

    <section class="admin-card backup-card" aria-labelledby="bk-export-title" data-backup-export>
      <div class="admin-card-head"><div>
        <h2 class="admin-card-title" id="bk-export-title"><i class="bi bi-download me-2" aria-hidden="true"></i>Εξαγωγή αντιγράφου</h2>
        <p class="admin-card-sub">Αρχείο JSON με όλα τα δεδομένα του καταστήματος (${STORE_NAMES.length} χώροι δεδομένων).</p>
      </div></div>
      <p class="backup-text">Το αντίγραφο αποθηκεύεται στον υπολογιστή σας· δεν είναι αντίγραφο cloud. Τα δεδομένα του demo υπάρχουν μόνο σε αυτόν τον περιηγητή και μπορεί να χαθούν αν καθαρίσετε τα δεδομένα του ιστότοπου.</p>
      <p class="backup-text backup-muted"><i class="bi bi-person-lock me-1" aria-hidden="true"></i>Το αρχείο μπορεί να περιέχει στοιχεία πελατών του demo (ονόματα, email, διευθύνσεις) και εικόνες που ανεβάσατε. Φυλάξτε το όπως κάθε αρχείο με προσωπικά δεδομένα.</p>
      <div class="backup-counts-wrap" data-export-counts>${countsTable(counts, 'Εγγραφές ανά χώρο δεδομένων')}</div>
      <div class="backup-actions">
        <button type="button" class="btn btn-dark" data-export><i class="bi bi-filetype-json me-1" aria-hidden="true"></i>Λήψη αντιγράφου (.json)</button>
      </div>
    </section>

    <section class="admin-card backup-card" aria-labelledby="bk-import-title" data-backup-import>
      <div class="admin-card-head"><div>
        <h2 class="admin-card-title" id="bk-import-title"><i class="bi bi-upload me-2" aria-hidden="true"></i>Εισαγωγή αντιγράφου</h2>
        <p class="admin-card-sub">Αντικαθιστά <strong>όλα</strong> τα τρέχοντα δεδομένα με αυτά του αρχείου. Το αρχείο ελέγχεται πριν αλλάξει οτιδήποτε.</p>
      </div></div>
      <div class="backup-file">
        <label class="form-label" for="bk-file">Αρχείο αντιγράφου Marias (.json, έως 50 MB)</label>
        <input class="form-control" type="file" id="bk-file" accept=".json,application/json" data-import-file aria-describedby="bk-file-hint">
        <div class="form-text" id="bk-file-hint">Ο έλεγχος γίνεται αμέσως και μόνο μέσα στον περιηγητή σας.</div>
      </div>
      <div class="backup-status" data-import-status role="status" aria-live="polite"></div>
      <div data-import-result></div>
    </section>

    <section class="admin-card backup-card backup-card-danger" aria-labelledby="bk-reset-title" data-backup-reset>
      <div class="admin-card-head"><div>
        <h2 class="admin-card-title" id="bk-reset-title"><i class="bi bi-arrow-counterclockwise me-2" aria-hidden="true"></i>Επαναφορά demo στα αρχικά δεδομένα</h2>
        <p class="admin-card-sub">Επαναφέρει το κατάστημα όπως ήταν στην πρώτη επίσκεψη: 39 προϊόντα, δείγματα πελατών και παραγγελιών, αρχικές ρυθμίσεις και περιεχόμενο.</p>
      </div></div>
      <p class="backup-text mb-1">Θα διαγραφούν οριστικά από αυτόν τον περιηγητή:</p>
      ${listHtml(RESET_ITEMS, 'backup-erase-list')}
      <p class="backup-text backup-muted">Αν θέλετε να κρατήσετε τα τρέχοντα δεδομένα, κάντε πρώτα εξαγωγή αντιγράφου.</p>
      <div class="backup-actions">
        <button type="button" class="btn btn-outline-danger" data-reset-open><i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Επαναφορά demo…</button>
      </div>
    </section>
  </div>`;
}

export default async function render() {
  const { root, body } = adminLayout({
    active: 'backup', title: 'Αντίγραφα ασφαλείας', view: 'backup', route: '/admin/backup', crumbs: [{ label: 'Αντίγραφα' }],
    subtitle: 'Εξαγωγή, εισαγωγή και επαναφορά των τοπικών δεδομένων του demo.',
  });
  const view = root.querySelector('[data-admin-view]');
  view.dataset.ready = 'false';
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<div class="admin-card is-loading"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';
  (async () => {
    let counts;
    try { counts = await storeCounts(); } catch (err) {
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="alert alert-danger" role="alert">Δεν ήταν δυνατή η ανάγνωση των τοπικών δεδομένων. Ανανεώστε τη σελίδα.</div>';
      return;
    }
    body.removeAttribute('aria-busy');
    body.innerHTML = pageHtml(counts);
    mount(body, view);
    view.dataset.ready = 'true';
  })();
  return root;
}

function mount(body, view) {
  let busy = false; // one export / import / reset at a time (double-click guard)
  let pending = null; // parsed backup object that passed validation
  let readSeq = 0;
  const $ = (sel) => body.querySelector(sel);
  const status = $('[data-import-status]');
  const result = $('[data-import-result]');
  const fileInput = $('[data-import-file]');
  const exportBtn = $('[data-export]');
  const resetBtn = $('[data-reset-open]');

  // ---------------------------------------------------------------- export
  exportBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    exportBtn.disabled = true;
    try {
      const backup = await exportAll();
      downloadBlob(new Blob([serializeBackup(backup)], { type: 'application/json' }), backupFileName());
      $('[data-export-counts]').innerHTML = countsTable(backup.counts, 'Εγγραφές ανά χώρο δεδομένων');
      toast('Το αντίγραφο αποθηκεύτηκε στον υπολογιστή σας.', 'success');
      view.dataset.exported = String(Date.now());
    } catch (err) {
      console.warn('Backup export failed', err);
      toast('Η εξαγωγή δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', 'danger');
    } finally {
      busy = false;
      exportBtn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- import
  const setStatus = (text, kind = '') => {
    status.className = `backup-status${kind ? ` is-${kind}` : ''}`;
    status.textContent = text;
  };

  function showErrors(title, errors, warnings = []) {
    pending = null;
    view.dataset.importState = 'invalid';
    result.innerHTML = `<div class="backup-report is-error" data-import-errors>
        <p class="backup-report-title"><i class="bi bi-x-octagon me-1" aria-hidden="true"></i>${esc(title)}</p>
        <div class="backup-scroll" tabindex="0" role="region" aria-label="Σφάλματα ελέγχου αρχείου">${listHtml(errors, 'backup-errors')}</div>
        <p class="backup-report-foot">Τα υπάρχοντα δεδομένα δεν άλλαξαν. Διορθώστε το αρχείο ή επιλέξτε άλλο αντίγραφο.</p>
      </div>${warnings.length ? warningsHtml(warnings) : ''}`;
  }

  const warningsHtml = (warnings) => `<div class="backup-report is-warning" data-import-warnings>
      <p class="backup-report-title"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>Προειδοποιήσεις (${n(warnings.length)})</p>
      <div class="backup-scroll" tabindex="0" role="region" aria-label="Προειδοποιήσεις ελέγχου αρχείου">${listHtml(warnings, 'backup-warnings')}</div>
    </div>`;

  async function showReady(obj, v, file, seq) {
    let current = {};
    try { current = await storeCounts(); } catch (e) { /* preview without current counts */ }
    if (seq !== readSeq || busy) return; // a newer file was chosen while the counts were read
    pending = obj;
    view.dataset.importState = 'valid';
    const exported = obj.exportedAt && !Number.isNaN(new Date(obj.exportedAt).getTime())
      ? new Date(obj.exportedAt).toLocaleString('el-GR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    result.innerHTML = `<div class="backup-report is-ok" data-import-ok>
        <p class="backup-report-title"><i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Το αρχείο είναι έγκυρο αντίγραφο Marias.</p>
        <p class="backup-meta">Αρχείο: <span data-import-name></span> · Εξαγωγή: ${esc(exported)}</p>
      </div>
      ${v.warnings.length ? warningsHtml(v.warnings) : ''}
      <div class="backup-preview" data-import-preview>
        <p class="backup-text mb-2"><strong>Θα αντικαταστήσει</strong> όλα τα τρέχοντα δεδομένα:</p>
        <div class="backup-counts-wrap">${previewTable(current, v.summary.counts)}</div>
      </div>
      <div class="backup-confirm">
        <label class="form-label" for="bk-confirm">Για επιβεβαίωση πληκτρολογήστε <strong>${IMPORT_CONFIRM_TEXT}</strong></label>
        <input class="form-control" id="bk-confirm" data-import-confirm autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="bk-confirm-hint">
        <div class="form-text" id="bk-confirm-hint">Η ενέργεια δεν αναιρείται. Αν κάτι αποτύχει, τα υπάρχοντα δεδομένα μένουν ως έχουν.</div>
      </div>
      <div class="backup-actions">
        <button type="button" class="btn btn-danger" data-import-run disabled><i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>Αντικατάσταση δεδομένων</button>
      </div>`;
    result.querySelector('[data-import-name]').textContent = file.name;
    const confirmInput = result.querySelector('[data-import-confirm]');
    const runBtn = result.querySelector('[data-import-run]');
    const sync = () => { runBtn.disabled = busy || !pending || confirmInput.value.trim() !== IMPORT_CONFIRM_TEXT; };
    confirmInput.addEventListener('input', sync);
    confirmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!runBtn.disabled) runBtn.click(); } });
    runBtn.addEventListener('click', () => runImport(runBtn, confirmInput));
  }

  async function runImport(runBtn, confirmInput) {
    if (busy || !pending || confirmInput.value.trim() !== IMPORT_CONFIRM_TEXT) return;
    busy = true;
    runBtn.disabled = true;
    confirmInput.disabled = true;
    fileInput.disabled = true;
    exportBtn.disabled = true;
    resetBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Εισαγωγή…';
    setStatus('Γίνεται εισαγωγή των δεδομένων…');
    view.dataset.importState = 'importing';
    const done = (counts, refreshFailed) => {
      pending = null;
      view.dataset.importState = refreshFailed ? 'done-refresh-failed' : 'done';
      setStatus(refreshFailed ? REFRESH_FAILED : 'Η εισαγωγή ολοκληρώθηκε.', refreshFailed ? 'error' : 'ok');
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      result.innerHTML = `<div class="backup-report ${refreshFailed ? 'is-warning' : 'is-ok'}" data-import-success${refreshFailed ? ' data-refresh-failed' : ''}>
          <p class="backup-report-title"><i class="bi ${refreshFailed ? 'bi-exclamation-triangle' : 'bi-check2-circle'} me-1" aria-hidden="true"></i>${refreshFailed ? esc(REFRESH_FAILED) : `Τα δεδομένα αντικαταστάθηκαν (${n(total)} εγγραφές).`}</p>
          <p class="backup-text mb-2">${refreshFailed ? `Τα δεδομένα του αντιγράφου (${n(total)} εγγραφές) έχουν ήδη αποθηκευτεί.` : 'Η σελίδα θα φορτωθεί ξανά ώστε όλο το κατάστημα να εμφανίσει τα δεδομένα του αντιγράφου.'}</p>
          <button type="button" class="btn btn-dark" data-import-continue>Συνέχεια</button>
        </div>`;
      const cont = result.querySelector('[data-import-continue]');
      cont.addEventListener('click', () => { cont.disabled = true; window.location.reload(); });
      cont.focus();
    };
    try {
      const r = await importAll(pending);
      done(r.counts, false);
    } catch (err) {
      if (err && err.code === 'committed') {
        console.warn('Backup imported; view refresh failed', err.cause || err);
        done(err.counts || {}, true);
        return;
      }
      if (!(err && err.code === 'invalid')) console.warn('Backup import failed', err);
      const errors = err && err.code === 'invalid' ? err.errors
        : [err && err.name === 'QuotaExceededError' ? 'Δεν υπάρχει αρκετός χώρος αποθήκευσης στον περιηγητή.' : 'Σφάλμα κατά την εγγραφή στη βάση δεδομένων του περιηγητή.'];
      showErrors(IMPORT_FAILED, errors);
      setStatus(IMPORT_FAILED, 'error');
      fileInput.disabled = false;
      fileInput.value = '';
      busy = false;
      exportBtn.disabled = false;
      resetBtn.disabled = false;
    }
  }

  fileInput.addEventListener('change', async () => {
    if (busy) return;
    const seq = ++readSeq;
    pending = null;
    result.innerHTML = '';
    view.dataset.importState = 'reading';
    const file = fileInput.files && fileInput.files[0];
    if (!file) { setStatus(''); view.dataset.importState = ''; return; }
    const sizeErr = backupSizeError(file.size);
    if (sizeErr) { setStatus('Το αρχείο δεν μπορεί να ελεγχθεί.', 'error'); showErrors('Το αρχείο απορρίφθηκε.', [sizeErr]); return; }
    setStatus('Έλεγχος αρχείου…');
    let text;
    try { text = await file.text(); } catch (e) {
      if (seq !== readSeq) return;
      setStatus('Το αρχείο δεν διαβάστηκε.', 'error');
      showErrors('Το αρχείο απορρίφθηκε.', ['Δεν ήταν δυνατή η ανάγνωση του αρχείου.']);
      return;
    }
    if (seq !== readSeq) return; // a newer file was chosen meanwhile
    const parsed = parseBackupText(text);
    if (!parsed.ok) { setStatus('Το αρχείο απορρίφθηκε.', 'error'); showErrors('Το αρχείο απορρίφθηκε.', [parsed.error]); return; }
    const v = validateImport(parsed.value);
    if (!v.ok) {
      setStatus(`Το αρχείο απορρίφθηκε: ${v.errors.length > 1 ? 'βρέθηκαν σφάλματα' : 'βρέθηκε σφάλμα'}.`, 'error');
      showErrors('Το αρχείο δεν μπορεί να εισαχθεί:', v.errors, v.warnings);
      return;
    }
    setStatus('Το αρχείο ελέγχθηκε: έτοιμο για εισαγωγή.', 'ok');
    await showReady(parsed.value, v, file, seq);
  });

  // ---------------------------------------------------------------- reset
  resetBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    resetBtn.disabled = true;
    let ok = false;
    try {
      ok = await confirmDialog('Όλα τα τοπικά δεδομένα του demo θα διαγραφούν και θα επανέλθουν τα αρχικά δεδομένα. Η ενέργεια δεν αναιρείται.', {
        title: 'Επαναφορά demo', okLabel: 'Επαναφορά', cancelLabel: 'Άκυρο', danger: true, items: RESET_ITEMS, requireText: RESET_CONFIRM_TEXT,
      });
    } finally {
      if (!ok) { busy = false; resetBtn.disabled = false; }
    }
    if (!ok) { resetBtn.focus(); return; }
    exportBtn.disabled = true;
    fileInput.disabled = true;
    resetBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Επαναφορά…';
    view.dataset.resetState = 'resetting';
    try {
      await resetDemo();
      view.dataset.resetState = 'done';
      toast('Το demo επανήλθε στα αρχικά δεδομένα.', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      console.warn('Demo reset failed', err);
      view.dataset.resetState = 'failed';
      toast('Η επαναφορά απέτυχε — τα υπάρχοντα δεδομένα δεν άλλαξαν.', 'danger');
      resetBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Επαναφορά demo…';
      busy = false;
      resetBtn.disabled = false;
      exportBtn.disabled = false;
      fileInput.disabled = false;
    }
  });
}
