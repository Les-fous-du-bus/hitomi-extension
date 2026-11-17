const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension,normaliser} = require('./ext-harness');
const file = path.join(__dirname,'../src/novel/novelbin.js');
const list = '<img data-src="/cover.jpg"><h3 class="novel-title"><a href="/b/fixture" title="Fixture Novel">Fixture Novel</a></h3>';
const detail = '<h3 class="title" itemprop="name">Fixture Novel</h3><ul class="list-chapter"><li><a href="/b/fixture/chapter-1" title="Chapter 1">Chapter 1</a></li></ul>';
const methods = [
  ['catalogue', ext=>ext.popularNovels(1)],
  ['recherche', ext=>ext.searchNovels('fixture',1)],
  ['fiche', ext=>ext.parseNovelAndChapters('https://novelbin.com/b/fixture')],
  ['chapitre', ext=>ext.parseChapter('https://novelbin.com/b/fixture/chapter-1')],
];
for (const [name,call] of methods) {
  test(`NovelBin ${name}: HTTP503 sans challenge est une erreur de source, même sans champ error`,async()=>{
    const {ext,appels}=chargerExtension(file,{'novelbin.com':{status:503,headers:{'cf-ray':'edge-id'},body:'Service Unavailable'}});
    await assert.rejects(call(ext),error=>/NovelBin.*HTTP 503/.test(error.message)&&!/Cloudflare|challenge|verification/i.test(error.message));
    assert.equal(appels.length,1);
  });
}
for (const [status,body,expected] of [
  [403,'Forbidden',/HTTP 403/],
  [200,'<title>Just a moment...</title><script>window._cf_chl_opt={}</script>',/Cloudflare/],
  [503,'<title>Just a moment...</title>',/Cloudflare/],
  [200,'<title>Just a moment...</title>',/Cloudflare/],
  [200,'<title>Attention Required! | Cloudflare</title>',/Cloudflare/],
]) {
  test(`NovelBin distingue le blocage explicite: ${status} ${body.slice(0,20)}`,async()=>{
    const {ext}=chargerExtension(file,{'novelbin.com':{status,body}});
    await assert.rejects(ext.popularNovels(1),expected);
  });
}
for (const body of ['', '<html><title>Maintenance</title><body>Temporarily unavailable</body></html>',
  '<html><script>const message="No results found";</script><div id="app-root"></div></html>']) {
  test(`NovelBin refuse un faux catalogue vide: ${body.slice(0,35)}`,async()=>{
    const {ext}=chargerExtension(file,{'novelbin.com':body});
    await assert.rejects(ext.popularNovels(1),/NovelBin.*(?:vide|indisponible|format)/i);
  });
}
test('NovelBin accepte une recherche explicitement sans résultat',async()=>{
  const {ext}=chargerExtension(file,{'novelbin.com':'<h1>Search results</h1><div class="alert">No results found.</div>'});
  assert.deepEqual(normaliser(await ext.searchNovels('nothing',1)),{list:[],hasNextPage:false});
});
test('NovelBin ne prend pas le script de mesure Cloudflare pour un challenge sur un vrai catalogue',async()=>{
  const {ext}=chargerExtension(file,{'novelbin.com':list+'<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'});
  const result=await ext.popularNovels(1);
  assert.equal(result.list.length,1);assert.equal(result.list[0].title,'Fixture Novel');
});
test('NovelBin conserve une fiche et un chapitre valides',async()=>{
  const {ext}=chargerExtension(file,{'/b/fixture/chapter-1':'<div id="chr-content"><p>Readable chapter body.</p></div>','/b/fixture':detail});
  const novel=await ext.parseNovelAndChapters('https://novelbin.com/b/fixture');
  assert.equal(novel.title,'Fixture Novel');assert.equal(novel.chapters.length,1);
  assert.match(await ext.parseChapter(novel.chapters[0].url),/Readable chapter body/);
});
test('NovelBin ne rend pas une fiche Untitled vide pour une page inconnue',async()=>{
  const {ext}=chargerExtension(file,{'novelbin.com':'<title>Service unavailable</title>'});
  await assert.rejects(ext.parseNovelAndChapters('https://novelbin.com/b/fixture'),/NovelBin.*(?:fiche|format|indisponible)/i);
});

test('NovelBin ne confond pas un titre ordinaire avec le titre complet du challenge',async()=>{
  const {ext}=chargerExtension(file,{'novelbin.com':'<title>Just a moment - NovelBin</title>'+list+'<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'});
  assert.equal((await ext.popularNovels(1)).list.length,1);
});
