const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chargerExtension}=require('./ext-harness');const source=path.join(__dirname,'../src/manga/manhwaz.js');
const parking='<html><a href="https://www.namecheap.com/">Namecheap</a><h2>Domain registration has expired.</h2></html>';
for(const method of ['getPopular','getLatestUpdates','search','getMangaDetail','getChapterList','getPageList']){
 test(`${method}: domaine expire signale sans faux catalogue`,async()=>{
  const {ext}=chargerExtension(source,{'manhwaz.com':parking});
  const call=method==='search'?ext.search('Test',1,[]):method==='getPopular'||method==='getLatestUpdates'?ext[method](1):ext[method]('https://manhwaz.com/webtoon/test');
  await assert.rejects(call,/ManhwaZ.*domaine.*expir/i);
 });
}
test('les mots du synopsis ne suffisent pas pour déclarer un domaine expiré',async()=>{
 const html='<div class="post-title"><h1>Expired domain</h1></div><div class="summary__content">Domain registration has expired.</div>';
 const {ext}=chargerExtension(source,{'manhwaz.com':html});
 assert.equal((await ext.getMangaDetail('https://manhwaz.com/webtoon/test')).title,'Expired domain');
});

for (const method of ['getPopular','getLatestUpdates','search','getMangaDetail','getChapterList','getPageList']) {
  test(`${method}: une page404 ne devient pas un catalogue ou chapitre vide`, async () => {
    const {ext}=chargerExtension(source, {'manhwaz.com':{status:404,body:'<html><head><title>404 Not Found</title></head><h1>404 Not Found</h1></html>'}});
    const call=method==='search'?ext.search('one piece',1,[]):method==='getPopular'||method==='getLatestUpdates'?ext[method](1):ext[method]('https://manhwaz.com/webtoon/test');
    await assert.rejects(call,/ManhwaZ.*404/);
  });
}
