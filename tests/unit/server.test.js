const test = require('node:test');
const assert = require('node:assert');
const { mimeFor } = require('../server.js');

test('mimeFor maps known extensions', () => {
  assert.match(mimeFor('a.js'), /^text\/javascript/);
  assert.match(mimeFor('a.mjs'), /^text\/javascript/);
  assert.match(mimeFor('a.json'), /^application\/json/);
  assert.strictEqual(mimeFor('a.webp'), 'image/webp');
  assert.strictEqual(mimeFor('a.jpg'), 'image/jpeg');
  assert.strictEqual(mimeFor('a.png'), 'image/png');
  assert.match(mimeFor('a.svg'), /^image\/svg\+xml/);
  assert.match(mimeFor('a.css'), /^text\/css/);
  assert.match(mimeFor('a.html'), /^text\/html/);
  assert.strictEqual(mimeFor('a.woff2'), 'font/woff2');
  assert.strictEqual(mimeFor('a.xyz'), 'application/octet-stream');
});
