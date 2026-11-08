const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const source = path.join(__dirname, '../src/manga/sushi_scan.js');
test('le catalogue indisponible utilise le choix limité de la page d’accueil sans doublon', async () => {
  const card = '<div class="bsx"><a href="/catalogue/test/" title="Test"><img src="/test.jpg"></a></div>';
  const {ext} = chargerExtension(source, {'/catalogue/?page=1': {status: 504, error:'Gateway timeout'}, 'sushiscan.fr/': card+card});
  const result = await ext.getPopular(1);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0].title, 'Test');
  assert.equal(result.hasNextPage, false);
});
test('si les deux pages sont indisponibles le défaut reste visible', async () => {
  const {ext} = chargerExtension(source, {'/catalogue/?page=1': {status:504,error:'indisponible'},'sushiscan.fr/': {status:504,error:'indisponible'}});
  await assert.rejects(ext.getPopular(1));
});
test('un gabarit client ne devient pas un chapitre téléchargeable', async () => {
 const page='<li data-num="1"><a href="/kingdom-chapitre-1/"><span class="chapternum">Chapitre 1</span></a></li><li data-num="{{number}}"><a href="#/chapter-{{number}}"><span class="chapternum">Chapitre {{number}}</span></a></li>';
 const {ext}=chargerExtension(source,{'sushiscan.fr/catalogue/kingdom/':page});
 const chapters=await ext.getChapterList('https://sushiscan.fr/catalogue/kingdom/');
 assert.equal(chapters.length,1);
 assert.equal(chapters[0].url,'https://sushiscan.fr/kingdom-chapitre-1/');
});

test('une erreur serveur de chapitre reste visible', async () => {
  const { ext } = chargerExtension(source, { '/kingdom-chapitre-1/': { status: 504, error: 'Gateway timeout' } });
  await assert.rejects(ext.getPageList('https://sushiscan.fr/kingdom-chapitre-1/'), /Gateway timeout/);
});
test('une page sans images ne devient pas un chapitre vide silencieux', async () => {
  const { ext } = chargerExtension(source, { '/kingdom-chapitre-1/': '<html><body>Erreur du site</body></html>' });
  await assert.rejects(ext.getPageList('https://sushiscan.fr/kingdom-chapitre-1/'), /aucune page de lecture/);
});
test('les images en JSON restent lisibles', async () => {
  const { ext } = chargerExtension(source, { '/kingdom-chapitre-1/': '<script>{"images":["https://cdn.example.test/a.jpg","https://cdn.example.test/b.jpg"]}</script>' });
  const pages = await ext.getPageList('https://sushiscan.fr/kingdom-chapitre-1/');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].imageUrl, 'https://cdn.example.test/a.jpg');
});
test('une liste JSON vide peut encore se rabattre sur les images du lecteur', async () => {
  const html = '<script>{"images":[]}</script><div id="readerarea"><img src="https://cdn.example.test/a.jpg"></div><div>';
  const { ext } = chargerExtension(source, { '/kingdom-chapitre-1/': html });
  const pages = await ext.getPageList('https://sushiscan.fr/kingdom-chapitre-1/');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].imageUrl, 'https://cdn.example.test/a.jpg');
});

test('une erreur serveur de fiche reste visible au lieu de créer une fiche Error', async () => {
  const url = 'https://sushiscan.fr/catalogue/milf-exchange-plan/';
  const { ext } = chargerExtension(source, { '/catalogue/milf-exchange-plan/': { status: 504, error: 'Gateway timeout' } });
  await assert.rejects(ext.getMangaDetail(url), /Gateway timeout/);
});
test('une erreur serveur de sommaire reste visible au lieu de simuler zéro chapitre', async () => {
  const url = 'https://sushiscan.fr/catalogue/milf-exchange-plan/';
  const { ext } = chargerExtension(source, { '/catalogue/milf-exchange-plan/': { status: 504, error: 'Gateway timeout' } });
  await assert.rejects(ext.getChapterList(url), /Gateway timeout/);
});


test("un catalogue disponible conserve sa pagination et son ordre", async () => {
  const cards = Array.from({length: 10}, (_, i) => `<div class=\"bsx\"><a href=\"/catalogue/title-${i}/\" title=\"Title ${i}\"><img src=\"/cover.jpg\"></a></div>`).join("");
  const { ext } = chargerExtension(source, { "/catalogue/?page=1": cards });
  const result = await ext.getPopular(1);
  assert.equal(result.list.length, 10);
  assert.equal(result.list[0].title, "Title 0");
  assert.equal(result.hasNextPage, true);
});

test("une carte sans titre ne masque pas une carte suivante pour la même œuvre", async () => {
  const html = `<div class=\"bsx\"><a href=\"/catalogue/test/\" title=\"\"></a></div><div class=\"bsx\"><a href=\"/catalogue/test/\" title=\"Titre réel\"></a></div>`;
  const { ext } = chargerExtension(source, { "/catalogue/?page=1": html });
  const result = await ext.getPopular(1);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0].title, "Titre réel");
});
