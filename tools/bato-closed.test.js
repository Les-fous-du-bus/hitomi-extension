const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chargerExtension}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/manga/bato.js');
test('une annonce de fermeture est signalée sur catalogue, fiche et lecteur',async()=>{
  const html='<html><head><title>THIS WEBSITE HAS BEEN CLOSED</title></head><body>External notice</body></html>';
  const {ext}=chargerExtension(file,{'bato.to':{status:200,body:html}});
  for(const fn of [()=>ext.getPopular(1),()=>ext.getLatestUpdates(1),()=>ext.search('test',1,[]),()=>ext.getMangaDetail('https://bato.to/series/1'),()=>ext.getChapterList('https://bato.to/series/1'),()=>ext.getPageList('https://bato.to/chapter/1')]) await assert.rejects(fn,/domaine affiche une annonce de fermeture/);
});
test('une mention de fermeture dans une page normale ne déclenche pas l’alerte',async()=>{
  const {ext}=chargerExtension(file,{'bato.to':'<html><title>Some manga</title><body>This website has been closed in a work of fiction</body></html>'});
  const out=await ext.getPopular(1);assert.equal(out.list.length,0);
});
