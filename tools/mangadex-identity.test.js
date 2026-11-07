const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const file = path.join(__dirname, '../src/manga/mangadex.js');
const ok = (x) => JSON.stringify({ result: 'ok', ...x });

test('les requetes API identifient Hitomi sans emprunter l agent WebView', async () => {
  const { ext, appels } = chargerExtension(file, {
    '/manga/id/feed': ok({ total: 1, data: [{ id: 'chapter', attributes: { pages: 1, chapter: '1' } }] }),
    '/manga/id?': ok({ data: { attributes: { title: { en: 'Title' } }, relationships: [] } }),
    '/at-home/server/chapter': ok({ baseUrl: 'https://img.example', chapter: { hash: 'abc', data: ['1.jpg'] } }),
    '/manga?': ok({ total: 0, data: [] }),
  });
  await ext.getPopular(1);
  await ext.getLatestUpdates(1);
  await ext.search('Title', 1, []);
  await ext.getMangaDetail('https://api.mangadex.org/manga/id');
  await ext.getChapterList('https://api.mangadex.org/manga/id');
  const pages = await ext.getPageList('https://api.mangadex.org/chapter/chapter');
  assert.match(pages[0].headers['User-Agent'], /^Hitomi\//);
  assert.equal(appels.length, 6);
  for (const call of appels) assert.match(call.options.headers['User-Agent'], /^Hitomi\//);
});

test('une page HTML en reponse API reste une erreur explicite', async () => {
  const { ext } = chargerExtension(file, { '/manga?': '<html>challenge</html>' });
  await assert.rejects(ext.getPopular(1), /MangaDex.*illisible ou bloquée/);
});
