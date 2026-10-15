// Pure size-chart selection. Values are demo guidance in centimetres.

const CLOTHING_ROWS = [
  ['XS', '80–84', '62–66', '86–90'],
  ['S', '84–88', '66–70', '90–94'],
  ['M', '88–92', '70–74', '94–98'],
  ['L', '92–98', '74–80', '98–104'],
  ['XL', '98–104', '80–86', '104–110'],
  ['XXL', '104–110', '86–92', '110–116'],
];

const SHOE_ROWS = Array.from({ length: 11 }, (_, i) => [
  String(36 + i),
  (22.8 + i * 0.67).toFixed(1).replace('.', ','),
]);

const JEANS_ROWS = [
  ['30', '76', '94'],
  ['32', '81', '99'],
  ['34', '86', '104'],
  ['36', '91', '109'],
  ['38', '96', '114'],
];

const BELT_ROWS = [
  ['S', '75–85'],
  ['M', '85–95'],
  ['L', '95–105'],
];

/**
 * Choose the chart for a product. Returns { kind, title, headers, rows, note } where
 * kind is 'clothing' | 'shoes' | 'jeans' | 'belts' | 'single'.
 */
export function sizeChartFor(product) {
  const sizes = new Set((product.variants || []).map((v) => String(v.size)));
  if (product.categoryId === 'shoes') {
    return {
      kind: 'shoes',
      title: 'Πίνακας μεγεθών υποδημάτων',
      headers: ['Μέγεθος EU', 'Μήκος πέλματος (cm)'],
      rows: SHOE_ROWS,
      note: 'Μετρήστε το πέλμα σας και επιλέξτε το αντίστοιχο μέγεθος. Αν βρίσκεστε ανάμεσα σε δύο, προτιμήστε το μεγαλύτερο.',
    };
  }
  if (product.subcategoryId === 'jeans') {
    return {
      kind: 'jeans',
      title: 'Πίνακας μεγεθών τζιν',
      headers: ['Μέγεθος (μέση)', 'Μέση (cm)', 'Γοφοί (cm)'],
      rows: JEANS_ROWS,
      note: 'Το μήκος εσωτερικής ραφής είναι περίπου 82 cm σε όλα τα μεγέθη.',
    };
  }
  if (product.categoryId === 'accessories') {
    if (product.subcategoryId === 'belts' && !sizes.has('ONE')) {
      return {
        kind: 'belts',
        title: 'Πίνακας μεγεθών ζωνών',
        headers: ['Μέγεθος', 'Περιφέρεια μέσης (cm)'],
        rows: BELT_ROWS,
        note: 'Επιλέξτε το μέγεθος που αντιστοιχεί στη θέση που φοράτε τη ζώνη.',
      };
    }
    return { kind: 'single', title: 'Μέγεθος', headers: [], rows: [], note: 'Ενιαίο μέγεθος' };
  }
  return {
    kind: 'clothing',
    title: 'Πίνακας μεγεθών ρούχων',
    headers: ['Μέγεθος', 'Στήθος (cm)', 'Μέση (cm)', 'Γοφοί (cm)'],
    rows: sizes.has('XXL') ? CLOTHING_ROWS : CLOTHING_ROWS.filter((r) => r[0] !== 'XXL'),
    note: 'Οι μετρήσεις αφορούν το σώμα, όχι το ρούχο. Είναι ενδεικτικές για το demo.',
  };
}
