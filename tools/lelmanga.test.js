const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const file = path.join(__dirname, '../src/manga/lelmanga.js');
const url = 'https://www.lelmanga.com/manga/test/';

test('la fiche décode les entités numériques sans casser les caractères invalides', async () => {
  const html = `<h1 class="entry-title">Test &#xE9;</h1>
    <div class="entry-content" itemprop="description"><p>La &#8220;piraterie&#8221;, &#x1F4DA; &amp; &#x110000;.</p></div>`;
  const { ext } = chargerExtension(file, { [url]: html });
  const detail = await ext.getMangaDetail(url);
  assert.equal(detail.title, 'Test é');
  assert.equal(detail.description, 'La “piraterie”, 📚 & &#x110000;.');
});
