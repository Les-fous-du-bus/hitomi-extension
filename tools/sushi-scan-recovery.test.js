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


// Le vrai bridge rend aussi les corps HTML d’erreur sans champ `error`.
for (const status of [200, 502, 503, 504]) {
  test(`une fiche HTML Gateway échoue même sans erreur bridge (status ${status})`, async () => {
    const body = '<html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1></body></html>';
    const {ext}=chargerExtension(source, {'/catalogue/test/':{status,body}});
    await assert.rejects(ext.getMangaDetail('https://sushiscan.fr/catalogue/test/'), /SushiScan.*504/);
    await assert.rejects(ext.getChapterList('https://sushiscan.fr/catalogue/test/'), /SushiScan.*504/);
  });
}
for (const [code, label] of [[502,'Bad Gateway'],[503,'Service Unavailable'],[504,'Gateway Time-out']]) {
  test(`un chapitre HTML ${code} ne devient pas une erreur de parseur`, async () => {
    const {ext}=chargerExtension(source, {'/test-chapitre-1/':`<html><title>${code} ${label}</title><h1>${code} ${label}</h1></html>`});
    await assert.rejects(ext.getPageList('https://sushiscan.fr/test-chapitre-1/'), new RegExp('SushiScan.*'+code));
  });
}
test('recherche et nouveautés propagent les erreurs HTML du serveur', async () => {
  const body='<html><title>503 Service Unavailable</title></html>';
  const {ext}=chargerExtension(source, {'sushiscan.fr/':body});
  await assert.rejects(ext.search('Kingdom',1,[]), /SushiScan.*503/);
  await assert.rejects(ext.getLatestUpdates(1), /SushiScan.*503/);
});
test('un challenge Cloudflare reste distinct d’une fiche ou d’un sommaire vide', async () => {
  const body='<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>';
  const {ext}=chargerExtension(source, {'sushiscan.fr/':body});
  await assert.rejects(ext.getMangaDetail('https://sushiscan.fr/catalogue/test/'), /SushiScan.*Cloudflare/);
  await assert.rejects(ext.getChapterList('https://sushiscan.fr/catalogue/test/'), /SushiScan.*Cloudflare/);
  await assert.rejects(ext.getPageList('https://sushiscan.fr/test-chapitre-1/'), /SushiScan.*Cloudflare/);
});
test('un catalogue HTML504 conserve le recours unique à l’accueil, sans pagination fictive', async () => {
  const card='<div class="bsx"><a href="/catalogue/test/" title="Test"><img src="/test.jpg"></a></div>';
  const {ext,appels}=chargerExtension(source, {'/catalogue/?page=1':{status:504,body:'<h1>504 Gateway Time-out</h1>'},'sushiscan.fr/':card});
  const result=await ext.getPopular(1);
  assert.equal(result.list.length,1);assert.equal(result.hasNextPage,false);assert.equal(appels.length,2);
});
test('un catalogue page2 en panne ne revient pas aux mêmes titres d’accueil', async () => {
  const {ext,appels}=chargerExtension(source, {'/catalogue/?page=2':'<h1>502 Bad Gateway</h1>'});
  await assert.rejects(ext.getPopular(2), /SushiScan.*502/);assert.equal(appels.length,1);
});
test('la mention Bad Gateway dans un synopsis ne bloque pas une vraie fiche', async () => {
  const html='<html><title>Kingdom - SushiScan</title><h1 class="entry-title">Kingdom</h1><div class="entry-content" itemprop="description">Une histoire surnommée Bad Gateway par ses lecteurs.</div></html>';
  const {ext}=chargerExtension(source, {'/catalogue/test/':html});
  const detail=await ext.getMangaDetail('https://sushiscan.fr/catalogue/test/');assert.equal(detail.title,'Kingdom');
});


test('un script Cloudflare sur une fiche normale ne devient pas un challenge', async () => {
  const html='<html><title>Kingdom - SushiScan</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><h1 class="entry-title">Kingdom</h1><li data-num="1"><a href="/kingdom-chapitre-1/"><span class="chapternum">Chapitre 1</span></a></li><script>{"images":["https://cdn.example.test/a.jpg"]}</script></html>';
  const {ext}=chargerExtension(source, {'sushiscan.fr/':html});
  assert.equal((await ext.getMangaDetail('https://sushiscan.fr/catalogue/kingdom/')).title,'Kingdom');
  assert.equal((await ext.getChapterList('https://sushiscan.fr/catalogue/kingdom/')).length,1);
  assert.equal((await ext.getPageList('https://sushiscan.fr/kingdom-chapitre-1/')).length,1);
});
for (const id of ['cf-browser-verification','challenge-form']) {
  test(`un formulaire de challenge ${id} reste une validation requise sans titre standard`, async () => {
    const {ext}=chargerExtension(source, {'sushiscan.fr/':`<html><title>SushiScan</title><form id="${id}"></form></html>`});
    await assert.rejects(ext.getMangaDetail('https://sushiscan.fr/catalogue/kingdom/'), /SushiScan.*Cloudflare/);
  });
}


for (const [genres, expected] of [
  [['Action'],null],[['Horreur'],null],[['Yaoi'],null],[['Yuri'],null],
  [['18+'],'unknown'],[['R18'],'unknown'],[['Mature'],'unknown'],[['Adulte'],'unknown'],[['Non censuré'],'unknown'],
  [['Sexual Content'],'sexual'],[['Contenu sexuel'],'sexual'],[['Érotique'],'sexual'],[['Pornhwa'],'sexual'],[['Smut'],'sexual'],[['Hentai'],'sexual'],
  [['Gore'],'gore'],[['Violence'],'violence'],[['Ecchi'],'ecchi'],
  [['Asexual Content'],null],[[], 'unknown'],[['Mature','Gore'],'gore'],[['18+','Violence'],'violence'],
  [['Yaoi','Smut'],'sexual'],[['Gore','Érotique'],'sexual'],[['Érotique','Gore'],'sexual']
]) {
  test(`la classification précise ne confond pas âge, sexualité et violence: ${genres}`, async () => {
    const html='<h1 class="entry-title">Test</h1><div class="seriestugenre">'+genres.map(g=>'<a>'+g+'</a>').join('')+'</div>';
    const {ext}=chargerExtension(source, {'/catalogue/test/':html});
    const detail=await ext.getMangaDetail('https://sushiscan.fr/catalogue/test/');
    assert.equal(detail.matureType,expected);assert.equal(detail.isMature,expected!==null);
  });
}
test('les cartes sans métadonnées ne déduisent rien du titre', async () => {
  const card='<div class="bsx"><a href="/catalogue/test/" title="Mature Horror"><img src="/test.jpg"></a></div>';
  const {ext}=chargerExtension(source, {'/catalogue/?page=1':card});
  const result=await ext.getPopular(1);assert.equal(result.list[0].matureType,'unknown');assert.equal(result.list[0].isMature,true);
});
test('le fallback503 garde la classification inconnue et aucune pagination fictive', async () => {
  const card='<div class="bsx"><a href="/catalogue/test/" title="Test"><img src="/test.jpg"></a></div>';
  const {ext,appels}=chargerExtension(source, {'/catalogue/?page=1':{status:503,body:'<h1>503 Service Unavailable</h1>'},'sushiscan.fr/':card});
  const result=await ext.getPopular(1);assert.equal(result.list[0].matureType,'unknown');assert.equal(result.hasNextPage,false);assert.equal(appels.length,2);
});
