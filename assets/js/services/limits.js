// Shared data limits (pure, importable from Node). ONE source for the editors/services that WRITE data
// and for the backup import that READS it back.
//
// Rule: a backup of data the app itself accepted must always import, so every import cap is >= the cap
// the app enforces when saving (tests/unit/backup-limits.test.mjs asserts it with an export at the maxima).
// Editors/services enforce the tight caps below; the import only enforces the generous IMPORT_* guards
// plus the same validators the editors use.

/** Product editor / validateProductInput. */
export const PRODUCT_NAME_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const ATTRIBUTE_MAX = 1000; // material / care / fit and any other attribute text
export const STOCK_MAX = 1000000; // editor cap; a restock after cancel/return may legitimately exceed it

/** Cart / checkout: quantity of ONE line (also the cap planRestock relies on). */
export const LINE_QTY_MAX = 10000;

/** Checkout / profile / admin customer edit (validateCheckoutForm). */
export const PERSON_NAME_MAX = 60;
export const COMPANY_MAX = 120;
export const ADDRESS_MAX = 120;
export const CITY_MAX = 60;
export const EMAIL_MAX = 254;

/** Backup import guards (deliberately far above every cap above). */
export const IMPORT_STRING_MAX = 20000;
export const IMPORT_RECORDS_MAX = 100000;

const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Greek «έως N χαρακτήρες» message used by every capped text field. */
export const tooLong = (max) => `Έως ${nf(max)} χαρακτήρες.`;
export const formatLimit = nf;
