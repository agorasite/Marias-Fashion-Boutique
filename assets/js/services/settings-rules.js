// Pure store-settings rules (no DB, no DOM): form <-> stored settings and validation.
// The admin settings page feeds raw form strings to validateSettingsInput() and saves `value`.
// Importable in Node.
import { eurosToCents, centsToEuros, imageSourceError } from './product-admin-rules.js';

const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+\-().\s]{5,25}$/;
const VAT_NUMBER_RE = /^(EL)?\d{9}$/i;

export const SOCIAL_KEYS = ['instagram', 'facebook', 'tiktok', 'pinterest'];
export const IRIS_MIN = 20;
export const IRIS_MAX = 1000;
export const MAX_COURIER_CENTS = 100000; // 1.000 €
export const MAX_COD_CENTS = 100000;
export const MAX_THRESHOLD_CENTS = 10000000; // 100.000 €

const str = (v) => String(v ?? '').trim();

/** Honest default wording (identical to data/catalog-meta.json); used when a stored text fails the guard. */
export const DEFAULT_IRIS_INSTRUCTIONS = "Πρόκειται για προσομοίωση IRIS: δεν γίνεται καμία πραγματική χρέωση ή τραπεζική συναλλαγή. Η παραγγελία καταχωρείται με κατάσταση «Εκκρεμεί πληρωμή». Παρακάτω θα δείτε προσομοιωμένες οδηγίες και κωδικό πληρωμής· η πληρωμή σημειώνεται ως «Προσομοίωση: πληρώθηκε» μόνο όταν πατήσετε «Προσομοίωση πληρωμής IRIS».";

/**
 * Comparison form of IRIS text: NFD, invisible/format characters (zero-width, soft hyphen, BOM, word joiner…) and
 * combining marks removed, lowercased, final sigma folded, whitespace collapsed. Latin/Greek homoglyph mixes are out of scope.
 */
export function normalizeIrisText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\p{Cf}\p{M}\u00AD\u034F]/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalised (accent-free, lower-case, σ for ς) stems/phrases of claims that money was taken or moved:
// πληρώθηκε/πληρωθήκατε, πληρωμένη/-ο/-ες/-ος, εξοφλήθηκε/εξοφλημένη, χρεώθηκε/χρεωθήκατε, χρεώνεστε, πληρώσατε,
// «έγινε η πληρωμή» / «η πληρωμή (σας) έγινε», «η πληρωμή ολοκληρώθηκε» / «ολοκληρώθηκε η πληρωμή»,
// «επιτυχής πληρωμή» / «η πληρωμή ήταν επιτυχής», αφαιρέθηκαν/αφαιρούνται (χρήματα), εισπράχθηκε, «η είσπραξη έγινε».
// A deny-list can never be exhaustive: it stops the obvious dishonest wordings, while the settings hint
// (and the always-visible «προσομοίωση» requirement) remain the primary control.
const CLAIM_RE = new RegExp([
  'πληρωθ', 'πληρωμεν', 'εξοφλ', 'χρεωθ', 'χρεωνεστε', 'πληρωσατε',
  'ολοκληρωθηκ\\S*\\s+(?:η\\s+)?πληρωμ', 'εγινε\\s+(?:η\\s+)?πληρωμ', 'πληρωμη(?:\\s+\\S+){0,2}\\s+(?:εγινε|ολοκληρωθ)',
  'επιτυχ\\S*\\s+πληρωμ', 'πληρωμ\\S*(?:\\s+\\S+){0,3}\\s+επιτυχ',
  'αφαιρεθ', 'αφαιρουνται', 'εισπραχθ', 'εισπραξη(?:\\s+\\S+){0,2}\\s+εγινε',
].join('|'));
// The quoted status label «Προσομοίωση: πληρώθηκε» is allowed only when it stands alone: followed by a closing
// quote/bracket or the end of the text (so «… πληρώθηκε. Τα χρήματα …» or «… πληρώθηκε μετά την …» are claims).
const QUALIFIED_RE = /προσομοιωση: πληρωθηκε(?=\s*(?:[»"'”’)]|$))/g;

/** Greek error for the demo IRIS text, or '' when it is acceptable (length, says «προσομοίωση», claims no real payment, no HTML). */
export function irisInstructionsError(text) {
  const s = str(text);
  if (s.length < IRIS_MIN) return `Οι οδηγίες IRIS πρέπει να έχουν τουλάχιστον ${IRIS_MIN} χαρακτήρες.`;
  if (s.length > IRIS_MAX) return `Οι οδηγίες IRIS δεν μπορούν να ξεπερνούν τους ${IRIS_MAX} χαρακτήρες.`;
  if (/[<>]/.test(s)) return 'Το κείμενο δεν επιτρέπεται να περιέχει HTML ή τα σύμβολα < και >.';
  const f = normalizeIrisText(s);
  if (!f.includes('προσομοιωση')) return 'Το κείμενο πρέπει να αναφέρει ρητά ότι πρόκειται για «προσομοίωση» (δεν γίνεται πραγματική πληρωμή).';
  // The seeded wording quotes the simulated status label «Προσομοίωση: πληρώθηκε»; only that exact qualified form is allowed.
  if (CLAIM_RE.test(f.replace(QUALIFIED_RE, ''))) return 'Το κείμενο δεν επιτρέπεται να δηλώνει ότι η παραγγελία «πληρώθηκε», είναι «πληρωμένη» ή «εξοφλήθηκε» (εκτός από τη διατύπωση «Προσομοίωση: πληρώθηκε»).';
  return '';
}

/** «24» / «24,5» / «6.75» → 0.24 / 0.245 / 0.0675 (fraction with at most 4 decimals). NaN when invalid. */
export function vatPercentToRate(input) {
  const s = str(input);
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(s)) return NaN;
  const p = Number(s.replace(',', '.'));
  if (!(p >= 0 && p <= 100)) return NaN;
  return Math.round(p * 100) / 10000;
}

/** 0.245 → «24,5» (form text for a stored fraction). */
export function vatRateToPercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 10000) / 100).replace('.', ',');
}

/** «https://instagram.com/elan.boutique/» → «@elan.boutique»; '' when no handle can be derived. */
export function instagramHandleFromUrl(url) {
  const m = /^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i.exec(str(url));
  return m ? `@${m[1]}` : '';
}

const eur = (cents) => centsToEuros(cents).replace('.', ',');

/** Stored settings → form strings (the inverse of validateSettingsInput's normalisation). */
export function settingsToForm(s = {}) {
  const c = s.contact || {};
  const l = s.logo || {};
  const so = s.social || {};
  return {
    storeName: s.storeName ?? '',
    contactEmail: c.email ?? '', contactPhone: c.phone ?? '', contactAddress: c.address ?? '',
    vatNumber: c.vatNumber ?? '', openingHours: c.openingHours ?? '',
    logoText: l.text ?? '', logoSubtext: l.subtext ?? '', logoImage: l.image ?? '', logoAlt: l.alt ?? '',
    vatPercent: vatRateToPercent(s.vatRate), courier: eur(s.courierCents), freeShippingThreshold: eur(s.freeShippingThresholdCents),
    pickupNote: s.pickupNote ?? '', codFee: eur(s.codFeeCents), irisInstructions: s.irisInstructions ?? '',
    instagram: so.instagram ?? '', facebook: so.facebook ?? '', tiktok: so.tiktok ?? '', pinterest: so.pinterest ?? '',
  };
}

function logoImageError(src) {
  const s = str(src);
  if (/^http:\/\//i.test(s)) return 'Η εικόνα λογοτύπου πρέπει να είναι διαδρομή assets/…, https:// ή τοπικό αρχείο (όχι http://).';
  return imageSourceError(s);
}

/**
 * Validate the settings form. `input` holds raw strings (see settingsToForm for the field names).
 * @returns {{ok:boolean, errors:Object<string,string>, value:object|null}} value = patch for saveSettings.
 */
export function validateSettingsInput(input) {
  const d = input || {};
  const errors = {};
  const text = (field, label, { required = false, max }) => {
    const v = str(d[field]);
    if (required && !v) errors[field] = `Συμπληρώστε ${label}.`;
    else if (v.length > max) errors[field] = `Έως ${max} χαρακτήρες.`;
    return v;
  };
  const money = (field, label, maxCents) => {
    if (!str(d[field])) { errors[field] = `Συμπληρώστε ${label} (π.χ. 3,90· 0 για καμία).`; return null; }
    const cents = eurosToCents(d[field]);
    if (cents === null) { errors[field] = 'Μη έγκυρο ποσό: χρησιμοποιήστε αριθμό σε ευρώ, χωρίς αρνητικό πρόσημο (π.χ. 3,90).'; return null; }
    if (cents > maxCents) { errors[field] = `Το ποσό δεν μπορεί να ξεπερνά τα ${eur(maxCents)} €.`; return null; }
    return cents;
  };

  const storeName = text('storeName', 'την επωνυμία του καταστήματος', { required: true, max: 60 });

  let email = str(d.contactEmail).toLowerCase();
  if (!email) errors.contactEmail = 'Συμπληρώστε το email επικοινωνίας.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.contactEmail = 'Το email δεν είναι έγκυρο (π.χ. info@elan.gr).';
  const phone = str(d.contactPhone);
  if (!phone) errors.contactPhone = 'Συμπληρώστε το τηλέφωνο.';
  else if (!PHONE_RE.test(phone) || phone.replace(/\D/g, '').length < 5) errors.contactPhone = 'Μη έγκυρο τηλέφωνο: επιτρέπονται ψηφία, +, -, ( ), τελεία και κενά.';
  const address = text('contactAddress', 'τη διεύθυνση', { required: true, max: 120 });
  const openingHours = text('openingHours', 'το ωράριο', { max: 120 });
  const vatNumber = str(d.vatNumber).replace(/\s/g, '');
  if (vatNumber && !VAT_NUMBER_RE.test(vatNumber)) errors.vatNumber = 'Το ΑΦΜ αποτελείται από 9 ψηφία.';

  // logo
  const logoText = text('logoText', 'το κείμενο λογοτύπου', { max: 24 });
  const logoSubtext = text('logoSubtext', 'τον υπότιτλο', { max: 40 });
  const logoImage = str(d.logoImage);
  const logoAlt = text('logoAlt', 'το εναλλακτικό κείμενο', { max: 120 });
  if (logoImage) {
    const e = logoImageError(logoImage);
    if (e) errors.logoImage = e;
    if (!logoAlt && !errors.logoAlt) errors.logoAlt = 'Συμπληρώστε εναλλακτικό κείμενο για την εικόνα λογοτύπου.';
  }
  let logo = null;
  if (logoText || logoImage) {
    logo = {};
    if (logoText) { logo.text = logoText; if (logoSubtext) logo.subtext = logoSubtext; }
    if (logoImage) { logo.image = logoImage; logo.alt = logoAlt; }
  }

  // VAT
  let vatRate = vatPercentToRate(d.vatPercent);
  if (Number.isNaN(vatRate)) { errors.vatPercent = 'Συμπληρώστε ποσοστό ΦΠΑ από 0 έως 100 με έως 2 δεκαδικά (π.χ. 24 ή 13,5).'; vatRate = null; }

  // shipping + payments
  const courierCents = money('courier', 'τα έξοδα courier', MAX_COURIER_CENTS);
  const freeShippingThresholdCents = money('freeShippingThreshold', 'το όριο δωρεάν αποστολής', MAX_THRESHOLD_CENTS);
  const pickupNote = text('pickupNote', 'τη σημείωση παραλαβής', { max: 200 });
  const codFeeCents = money('codFee', 'την επιβάρυνση αντικαταβολής', MAX_COD_CENTS);
  const irisInstructions = str(d.irisInstructions);
  const irisErr = irisInstructionsError(irisInstructions);
  if (irisErr) errors.irisInstructions = irisErr;

  // social
  const social = {};
  for (const k of SOCIAL_KEYS) {
    const v = str(d[k]);
    if (!v) continue;
    if (v.length > 200) errors[k] = 'Έως 200 χαρακτήρες.';
    else if (!HTTPS_RE.test(v)) errors[k] = 'Ο σύνδεσμος πρέπει να ξεκινά με https://';
    else social[k] = v;
  }

  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: {},
    value: {
      storeName, logo,
      contact: { email, phone, address, vatNumber, openingHours },
      vatRate, courierCents, freeShippingThresholdCents, pickupNote, codFeeCents, irisInstructions, social,
    },
  };
}
