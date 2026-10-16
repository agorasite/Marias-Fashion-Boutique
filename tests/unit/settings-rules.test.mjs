import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSettingsInput, irisInstructionsError, settingsToForm, instagramHandleFromUrl, vatPercentToRate } from '../../assets/js/services/settings-rules.js';
import { quote } from '../../assets/js/services/pricing.js';

const meta = JSON.parse(readFileSync(new URL('../../data/catalog-meta.json', import.meta.url), 'utf8'));
const SEED = meta.settings;
const base = () => ({
  storeName: 'ÉLAN Fashion Boutique', contactEmail: 'info@elan.example', contactPhone: '+30 210 0000000', contactAddress: 'Ερμού 10, Αθήνα',
  vatNumber: '', openingHours: '', logoText: '', logoSubtext: '', logoImage: '', logoAlt: '',
  vatPercent: '24', courier: '3,90', freeShippingThreshold: '60', pickupNote: '', codFee: '2', irisInstructions: SEED.irisInstructions,
  instagram: 'https://instagram.com/elan', facebook: '', tiktok: '', pinterest: '',
});
const run = (over = {}) => validateSettingsInput({ ...base(), ...over });

test('seed defaults round-trip through the form and validate', () => {
  const r = validateSettingsInput(settingsToForm(SEED));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.vatRate, 0.24);
  assert.equal(r.value.courierCents, 390);
  assert.equal(r.value.freeShippingThresholdCents, 6000);
  assert.equal(r.value.codFeeCents, 200);
  assert.equal(r.value.irisInstructions, SEED.irisInstructions);
  assert.deepEqual(r.value.contact.email, 'info@elan.example');
});

test('money parsing accepts comma and dot, trims € and spaces', () => {
  for (const [txt, cents] of [['3,90', 390], ['3.9', 390], [' 12 € ', 1200], ['0', 0], ['0,00', 0]]) {
    const r = run({ courier: txt });
    assert.equal(r.ok, true, txt);
    assert.equal(r.value.courierCents, cents, txt);
  }
});
test('thousands separators work on the threshold field', () => {
  const r = run({ freeShippingThreshold: '1.234,56' });
  assert.equal(r.value.freeShippingThresholdCents, 123456);
});
test('money rejects negative, NaN, empty, text and 3 decimals', () => {
  for (const bad of ['-1', 'abc', '', '  ', '1,234', '1e3', '--2', '1,2,3']) {
    for (const f of ['courier', 'codFee', 'freeShippingThreshold']) {
      const r = run({ [f]: bad });
      assert.equal(r.ok, false, `${f}=${bad}`);
      assert.ok(r.errors[f], `${f}=${bad}`);
    }
  }
});
test('threshold 0 is allowed (always free) and cod 0 allowed', () => {
  const r = run({ freeShippingThreshold: '0', codFee: '0' });
  assert.equal(r.ok, true);
  assert.equal(r.value.freeShippingThresholdCents, 0);
  assert.equal(r.value.codFeeCents, 0);
});
test('money has an upper bound', () => {
  assert.equal(run({ courier: '1000,01' }).ok, false);
  assert.equal(run({ courier: '1000' }).ok, true);
});

test('VAT percent 0-100 stored as a fraction', () => {
  for (const [p, f] of [['24', 0.24], ['13', 0.13], ['0', 0], ['100', 1], ['24,5', 0.245], ['6.75', 0.0675], ['17,5', 0.175]]) {
    const r = run({ vatPercent: p });
    assert.equal(r.ok, true, p);
    assert.equal(r.value.vatRate, f, p);
  }
  assert.equal(vatPercentToRate('24'), 0.24);
});
test('VAT rejects out of range, NaN, 3 decimals, empty', () => {
  for (const bad of ['-1', '100,01', '101', 'x', '', '24,123', '1e1']) assert.equal(run({ vatPercent: bad }).ok, false, bad);
  assert.match(run({ vatPercent: '120' }).errors.vatPercent, /0.*100/);
});
test('VAT fraction feeds the shared quote function', () => {
  const r = run({ vatPercent: '13' });
  const q = quote({ lines: [{ unitCents: 11300, qty: 1 }], shipping: { method: 'pickup' }, payment: 'iris', settings: { ...SEED, ...r.value } });
  assert.equal(q.vatIncludedCents, 1300);
});

test('IRIS instructions: seeded text accepted', () => {
  assert.equal(irisInstructionsError(SEED.irisInstructions), '');
});
test('IRIS instructions must say προσομοίωση (case and accent insensitive)', () => {
  assert.equal(irisInstructionsError('Αυτό είναι ΠΡΟΣΟΜΟΙΩΣΗ και δεν γίνεται χρέωση καμία.'), '');
  assert.equal(irisInstructionsError('Αυτό είναι προσομοιωση χωρίς τόνο και δεν γίνεται χρέωση.'), '');
  assert.match(irisInstructionsError('Πληρώστε με IRIS στον αριθμό που θα δείτε παρακάτω σε λίγο.'), /προσομοίωση/);
});
test('IRIS instructions reject claims of real payment', () => {
  assert.match(irisInstructionsError('Προσομοίωση IRIS. Η παραγγελία πληρώθηκε με επιτυχία.'), /πληρώθηκε|πληρωμένη/);
  assert.match(irisInstructionsError('Προσομοίωση IRIS. Η παραγγελία είναι ΠΛΗΡΩΜΕΝΗ τώρα.'), /πληρώθηκε|πληρωμένη/);
  assert.notEqual(irisInstructionsError('Προσομοίωση IRIS. Πληρωθηκε χωρίς τόνο στο κείμενο.'), '');
});
test('IRIS instructions length 20-1000', () => {
  assert.notEqual(irisInstructionsError('προσομοίωση'), '');
  assert.notEqual(irisInstructionsError(`προσομοίωση ${'α'.repeat(1000)}`), '');
  assert.equal(irisInstructionsError(`προσομοίωση ${'α'.repeat(100)}`), '');
  const r = run({ irisInstructions: 'κάτι σύντομο' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.irisInstructions);
});

test('socials: https only, optional, max length', () => {
  assert.equal(run({ facebook: 'http://facebook.com/x' }).ok, false);
  assert.equal(run({ tiktok: 'javascript:alert(1)' }).ok, false);
  assert.equal(run({ pinterest: 'ftp://x.y' }).ok, false);
  assert.equal(run({ instagram: 'instagram.com/elan' }).ok, false);
  assert.equal(run({ facebook: `https://f.com/${'a'.repeat(300)}` }).ok, false);
  const r = run({ facebook: 'https://facebook.com/elan', pinterest: 'https://pinterest.com/elan', tiktok: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.social, { instagram: 'https://instagram.com/elan', facebook: 'https://facebook.com/elan', pinterest: 'https://pinterest.com/elan' });
});
test('instagram handle is derived from the profile URL', () => {
  assert.equal(instagramHandleFromUrl('https://instagram.com/elan.boutique/'), '@elan.boutique');
  assert.equal(instagramHandleFromUrl('https://www.instagram.com/elan.boutique?hl=el'), '@elan.boutique');
  assert.equal(instagramHandleFromUrl('https://instagram.com/'), '');
  assert.equal(instagramHandleFromUrl(''), '');
});

test('email and phone', () => {
  for (const bad of ['', 'abc', 'a@b', 'a b@c.gr', 'a@@b.gr']) assert.equal(run({ contactEmail: bad }).ok, false, bad);
  assert.equal(run({ contactEmail: ' Info@Elan.GR ' }).value.contact.email, 'info@elan.gr');
  for (const bad of ['', 'abc', '12', '+30 210 abc', '1'.repeat(30)]) assert.equal(run({ contactPhone: bad }).ok, false, bad);
  for (const ok of ['+30 210 0000000', '(210) 123-4567', '2101234567']) assert.equal(run({ contactPhone: ok }).ok, true, ok);
});

test('names and max lengths', () => {
  assert.equal(run({ storeName: '   ' }).ok, false);
  assert.equal(run({ storeName: 'x'.repeat(61) }).ok, false);
  assert.equal(run({ contactAddress: '' }).ok, false);
  assert.equal(run({ openingHours: 'x'.repeat(121) }).ok, false);
  assert.equal(run({ pickupNote: 'x'.repeat(201) }).ok, false);
  assert.equal(run({ vatNumber: '12345' }).ok, false);
  assert.equal(run({ vatNumber: '123456789' }).ok, true);
});

test('logo: empty = default wordmark (null); image uses the product image allow-list', () => {
  assert.equal(run().value.logo, null);
  const w = run({ logoText: 'MAISON', logoSubtext: 'Athens' });
  assert.deepEqual(w.value.logo, { text: 'MAISON', subtext: 'Athens' });
  const ok = run({ logoImage: 'assets/images/content/hero-1.webp', logoAlt: 'Λογότυπο' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.logo.image, 'assets/images/content/hero-1.webp');
  assert.equal(run({ logoImage: 'https://x.y/logo.png', logoAlt: 'a' }).ok, true);
  assert.equal(run({ logoImage: 'data:image/png;base64,AAAA', logoAlt: 'a' }).ok, true);
  for (const bad of ['javascript:alert(1)', 'http://x.y/l.png', 'data:image/svg+xml;base64,AAAA', '../x.png', 'assets/../x.png']) {
    const r = run({ logoImage: bad, logoAlt: 'a' });
    assert.equal(r.ok, false, bad);
    assert.ok(r.errors.logoImage, bad);
  }
  assert.ok(run({ logoImage: 'assets/images/content/hero-1.webp', logoAlt: '' }).errors.logoAlt);
  assert.equal(run({ logoText: 'x'.repeat(25) }).ok, false);
});

test('errors are keyed by form field and nothing leaks into value when invalid', () => {
  const r = run({ courier: 'x', vatPercent: '500', contactEmail: 'no' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['contactEmail', 'courier', 'vatPercent']);
});

// ---------------------------------------------------------------- Task 16 fix round: IRIS honesty guard hardening
import { DEFAULT_IRIS_INSTRUCTIONS, normalizeIrisText } from '../../assets/js/services/settings-rules.js';
const honest = (extra) => `Προσομοίωση IRIS, καμία πραγματική χρέωση. ${extra}`;
test('IRIS guard: default constant equals the seed text and passes', () => {
  assert.equal(DEFAULT_IRIS_INSTRUCTIONS, SEED.irisInstructions);
  assert.equal(irisInstructionsError(DEFAULT_IRIS_INSTRUCTIONS), '');
});
test('IRIS guard: claims of payment are rejected in every spelling', () => {
  const bad = [
    'Η παραγγελία πληρώθηκε', 'Η παραγγελία πληρωθηκε', 'Η ΠΑΡΑΓΓΕΛΙΑ ΠΛΗΡΩΘΗΚΕ', 'ΠΛΗΡΩΘΗΚΕ', 'πληρωθήκατε',
    'είναι πληρωμένη', 'είναι πληρωμένο', 'είναι πληρωμένες', 'ο πελάτης είναι πληρωμένος', 'ΠΛΗΡΩΜΕΝΗ',
    'εξοφλήθηκε', 'εξοφλημένη', 'χρεώθηκε η κάρτα', 'χρεωθήκατε', 'ολοκληρώθηκε η πληρωμή',
  ];
  for (const b of bad) assert.notEqual(irisInstructionsError(honest(b)), '', b);
});
test('IRIS guard: zero-width and soft-hyphen characters cannot hide a claim', () => {
  const bad = ['πληρώ​θηκε', 'πληρω­μένη', 'πλη‌ρώθηκε', 'πληρώ‍θηκε', 'πλη⁠ρωμένη', 'πλη﻿ρώθηκε', 'ε​ξοφλήθηκε'];
  for (const b of bad) assert.notEqual(irisInstructionsError(honest(b)), '', JSON.stringify(b));
  // the word itself may also be disguised when it is required
  assert.equal(irisInstructionsError('προσο​μοίωση IRIS, χωρίς πραγματική χρέωση σε αυτό το demo.'), '');
});
test('IRIS guard: final sigma and combining accents are normalised', () => {
  assert.equal(normalizeIrisText('ΠΡΟΣΟΜΟΊΩΣΗΣ'), 'προσομοιωσησ');
  assert.equal(normalizeIrisText('Πληρώθηκε'), 'πληρωθηκε');
  assert.equal(irisInstructionsError('Αυτό είναι ΠΡΟΣΟΜΟΊΩΣΗΣ και δεν γίνεται χρέωση καμία.'), '');
});
test('IRIS guard: only the exact qualified phrase «Προσομοίωση: πληρώθηκε» is allowed', () => {
  assert.equal(irisInstructionsError('Προσομοίωση IRIS, δεν γίνεται χρέωση. Η κατάσταση γίνεται «Προσομοίωση: πληρώθηκε» μόνο μετά το κουμπί.'), '');
  assert.notEqual(irisInstructionsError('Προσομοίωση IRIS, δεν γίνεται χρέωση. Η κατάσταση γίνεται «Προσομοίωση – πληρώθηκε» μετά το κουμπί.'), '');
  assert.notEqual(irisInstructionsError('Προσομοίωση IRIS, δεν γίνεται χρέωση. Η κατάσταση γίνεται «Προσομοίωση: πληρώθηκε» και μετά πληρώθηκε πραγματικά.'), '');
  assert.notEqual(irisInstructionsError('Προσομοίωση IRIS, δεν γίνεται χρέωση. «Προσομοίωση: πληρωμένη» στην οθόνη σας.'), '');
});
test('IRIS guard: HTML angle brackets are rejected', () => {
  assert.match(irisInstructionsError('Προσομοίωση IRIS, <b>καμία</b> πραγματική χρέωση σε αυτό το demo.'), /<|>|HTML/);
  assert.notEqual(irisInstructionsError('Προσομοίωση IRIS, a > b πραγματική χρέωση σε αυτό το demo.'), '');
});
// Out of scope (documented): Latin/Greek homoglyph mixes such as «πλήρωθηκε» typed with a Latin letter are not detected.

// ---------------------------------------------------------------- Task 17 fix round: more real-payment claims
test('IRIS guard: claims that money moved are rejected (phrases beyond the past-tense stems)', () => {
  const bad = [
    'Πληρωμή έγινε με επιτυχία.', 'Έγινε η πληρωμή σας.', 'Η πληρωμή σας έγινε άμεσα.', 'Η πληρωμή ολοκληρώθηκε.',
    'Η πληρωμή σας ολοκληρώθηκε επιτυχώς.', 'Επιτυχής πληρωμή!', 'Η πληρωμή ήταν επιτυχής.',
    'Τα χρήματα αφαιρέθηκαν από τον λογαριασμό σας.', 'Τα χρήματα αφαιρούνται αυτόματα.', 'Το ποσό εισπράχθηκε.',
    'Η είσπραξη έγινε κανονικά.', 'Χρεώνεστε με το ποσό της παραγγελίας.', 'Χρεωθήκατε 50 €.', 'Πληρώσατε με IRIS.',
  ];
  for (const b of bad) assert.notEqual(irisInstructionsError(honest(b)), '', b);
});
test('IRIS guard: the qualified phrase is exempt only when it stands alone (closing quote or end)', () => {
  for (const b of [
    'Προσομοίωση: πληρώθηκε. Τα χρήματα αφαιρέθηκαν από τον λογαριασμό σας.',
    'Η κατάσταση γίνεται Προσομοίωση: πληρώθηκε μετά την έγκριση της τράπεζας.',
    '«Προσομοίωση: πληρώθηκε μετά την μεταφορά».',
  ]) assert.notEqual(irisInstructionsError(honest(b)), '', b);
});
test('IRIS guard: benign wording still passes', () => {
  for (const ok of [
    DEFAULT_IRIS_INSTRUCTIONS,
    honest('Η πληρωμή σημειώνεται ως «Προσομοίωση: πληρώθηκε» μόνο όταν πατήσετε το κουμπί.'),
    honest('Η παραγγελία καταχωρείται με κατάσταση «Εκκρεμεί πληρωμή».'),
    honest('Δεν γίνεται καμία πραγματική χρέωση ή συναλλαγή.'),
    honest('Η κατάσταση γίνεται «Προσομοίωση: πληρώθηκε»'),
    'Προσομοίωση IRIS: δεν θα γίνει πληρωμή και δεν αφαιρείται κανένα ποσό από τον λογαριασμό σας.',
  ]) assert.equal(irisInstructionsError(ok), '', ok);
});
