// Static worst-case contrast check for the Instagram photo overlay.
// Browser-based WCAG/axe coverage lives in e2e/a11y.spec.js.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const css = readFileSync(new URL('../../assets/css/home.css', import.meta.url), 'utf8');
function linear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(rgb) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

test('Instagram hover caption maintains 4.5:1 contrast even over a white photograph', () => {
  const rule = css.match(/\.insta-tile-overlay\s*\{([^}]+)\}/);
  assert.ok(rule, 'overlay rule is present');
  const color = rule[1].match(/background:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(color, 'photo overlay must have a solid translucent dark background');
  const [r, g, b, opacity] = color.slice(1).map(Number);
  assert.ok(opacity >= 0 && opacity <= 1);
  const worstBackground = [r, g, b].map((component) => component * opacity + 255 * (1 - opacity));
  const ratio = (luminance([255, 255, 255]) + 0.05) / (luminance(worstBackground) + 0.05);
  assert.ok(ratio >= 4.5, `Contrast on a white photo is only ${ratio.toFixed(2)}:1`);
});
