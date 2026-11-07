const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const source = path.join(__dirname, '../src/novel/noveldeglace.js');
const html = `<article><h2><a href="https://noveldeglace.com/roman/alpha/">Roman Alpha</a></h2><img src="a.jpg"></article>
<article><h2><a href="https://noveldeglace.com/roman/beta/">Roman Beta</a></h2><img src="b.jpg"></article>`;
const links = (result) => Array.from(result.list, (item) => item.url);
const expected = ['https://noveldeglace.com/roman/alpha/', 'https://noveldeglace.com/roman/beta/'];
test('catalogue et recherche conservent le lien propre a chaque titre', async () => {
  const { ext } = chargerExtension(source, { '/roman': html });
  assert.deepEqual(links(await ext.getPopular(1)), expected);
  assert.deepEqual(links(await ext.search('roman', 1, [])), expected);
});
test('nouveautes : un article sans lien Roman utilise son propre titre', async () => {
  const body = `<article><h2><a href="https://noveldeglace.com/roman/alpha/">Roman Alpha</a></h2><span class="Roman"><a href="https://noveldeglace.com/roman/alpha/">Alpha</a></span></article><article><h2><a href="https://noveldeglace.com/roman/beta/">Roman Beta</a></h2></article>`;
  const { ext } = chargerExtension(source, { '/chapitre': body });
  assert.deepEqual(links(await ext.getLatestUpdates(1)), expected);
});
