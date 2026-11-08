const test=require('node:test');
const assert=require('node:assert/strict');
const {chargerExtension}=require('./ext-harness.js');
const targets=[['astral_manga','astral-manga.fr'],['manga_scantrad','manga-scantrad.io'],['mangafire','mangafire.to']];
for (const [name,host] of targets) {
  for (const status of [403,200]) test(`${name}: interstitiel HTTP ${status} est signalé`,async()=>{
    const {ext}=chargerExtension(require('node:path').join(__dirname, '../src/manga/'+name+'.js'),{
      [host]:{status,body:'<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>'}
    });
    for(const f of [()=>ext.getPopular(1),()=>ext.getLatestUpdates(1),()=>ext.search('test',1,[])]) await assert.rejects(f,/verification du site/);
  });
  test(`${name}: une mention ordinaire de Cloudflare ne déclenche pas l'alerte`,async()=>{
    const {ext}=chargerExtension(require('node:path').join(__dirname, '../src/manga/'+name+'.js'),{[host]:'<html><body>Site protected by Cloudflare</body></html>'});
    const result=await ext.getPopular(1); assert.equal(result.list.length,0);
  });
}
