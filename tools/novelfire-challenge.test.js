const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chargerExtension}=require('./ext-harness.js');
const extension=path.join(__dirname,'../src/novel/novelfire.js');
// Minimalisation de la structure observee sur deux reponses Android du 8 novembre.
const challenge='<html><head><title>Loading...</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head></html>';
test('signale le challenge HTML a la place du chapitre, du catalogue et de la fiche',async()=>{
 const {ext}=chargerExtension(extension,{'novelfire.net/':challenge});
 await assert.rejects(ext.parseChapter('https://novelfire.net/book/test/chapter-1'),/verification Cloudflare/);
 await assert.rejects(ext.popularNovels(1),/verification Cloudflare/);
 await assert.rejects(ext.parseNovelAndChapters('https://novelfire.net/book/test'),/verification Cloudflare/);
});
test('le script Cloudflare seul dans une vraie page de chapitre ne bloque pas sa lecture',async()=>{
 const page='<html><head><title>Chapter 1</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body><div id="content"><p>Texte de test.</p></div></body></html>';
 const {ext}=chargerExtension(extension,{'/book/test/chapter-1':page});
 assert.match(await ext.parseChapter('https://novelfire.net/book/test/chapter-1'),/Texte de test/);
});
