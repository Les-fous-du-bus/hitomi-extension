const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/kisswood.js');
test('KissWood TOC excludes other works and comment links in the sidebar',async()=>{
  const u='https://kisswood.eu/sigyn/sommaire-the-novels-extra/';
  const page='<div class="entry-content"><div><p><a href="https://kisswood.eu/sigyn/tne-chapitre-1/">Chapitre 1 : Cube</a></p></div><p><a href="https://kisswood.eu/sigyn/tne-chapitre-2/">Chapitre 2</a></p></div><aside><a href="https://kisswood.eu/farawaypain/tour-des-mondes-chapitre-427/#comment-20989">Tour des Mondes – Chapitre 427</a></aside>';
  const {ext}=chargerExtension(file,{[u]:page});
  assert.deepEqual(normaliser((await ext.getChapterList(u)).map(x=>x.url)),['https://kisswood.eu/sigyn/tne-chapitre-1/','https://kisswood.eu/sigyn/tne-chapitre-2/']);
});
test('KissWood reader keeps nested content and never saves whitespace/error placeholders',async()=>{
  const u='https://kisswood.eu/sigyn/tne-chapitre-1/';const {ext}=chargerExtension(file,{[u]:'<div class="entry-content"><hr><div><p>'+ 'A full story paragraph. '.repeat(30)+'</p></div><hr></div><aside>Sidebar</aside>'});
  const body=await ext.getContent(u);assert.match(body,/full story/);assert.doesNotMatch(body,/Sidebar/);
  const missing=chargerExtension(file,{[u]:'<div class="entry-content"><hr> <hr></div>'}).ext;
  await assert.rejects(missing.getContent(u),/indisponible/);
});
test('KissWood preserves an explicit chapter zero before chapter one',async()=>{
  const u='https://kisswood.eu/sigyn/sommaire-the-novels-extra/';
  const page='<div class="entry-content"><a href="https://kisswood.eu/novadil/chapter-0/">Chapitre 0</a><a href="https://kisswood.eu/novadil/chapter-1/">Chapitre 1</a></div>';
  const {ext}=chargerExtension(file,{[u]:page});assert.deepEqual(normaliser((await ext.getChapterList(u)).map(c=>c.number)),[0,1]);
});
