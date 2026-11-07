const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const file = path.join(__dirname, '../src/manga/mangatown.js');
const chapter = 'https://www.mangatown.com/manga/example/c1/';

test('les pages commencent au suffixe réel et conservent le Referer', async () => {
  const html = '<img src="//zjcdn.mangahere.org/store/series/h20190903_164925_158.jpg" id="image"><script>var total_pages = 3;</script>';
  const { ext } = chargerExtension(file, { [chapter]: html });
  const pages = await ext.getPageList(chapter);
  assert.deepEqual(Array.from(pages, p => p.imageUrl), [
    'https://zjcdn.mangahere.org/store/series/h20190903_164925_158.jpg',
    'https://zjcdn.mangahere.org/store/series/h20190903_164925_159.jpg',
    'https://zjcdn.mangahere.org/store/series/h20190903_164925_160.jpg',
  ]);
  assert.equal(pages[0].headers.Referer, 'https://www.mangatown.com/');
});

test('les suffixes à zéro initial restent remplis de zéros', async () => {
  const html = '<img id="image" src="https://zjcdn.mangahere.org/a001.jpg"><script>var total_pages = 2;</script>';
  const { ext } = chargerExtension(file, { [chapter]: html });
  const pages = await ext.getPageList(chapter);
  assert.deepEqual(Array.from(pages, p => p.imageUrl), ['https://zjcdn.mangahere.org/a001.jpg','https://zjcdn.mangahere.org/a002.jpg']);
});
