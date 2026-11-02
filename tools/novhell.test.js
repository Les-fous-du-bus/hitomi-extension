const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/novhell.js');
test('Novhell catalogue does not invent novels from status links and legacy aliases',()=>{
  const {ext}=chargerExtension(file,{});
  const html='<figure><a href="https://novhell.org/tempest-of-the-battlefield/"><img src="https://novhell.org/cover.jpg"></a><figcaption>Tempest of the Battlefield</figcaption></figure><a href="https://novhell.org/tempest-of-the-battlefields/">Tempest of the Battlefield</a><a href="https://novhell.org/eoc/">En pause</a>';
  const list=ext._parseHomepageNovels(html).list;
  assert.equal(list.length,1);assert.equal(list[0].imageUrl,'https://novhell.org/cover.jpg');
});
test('Novhell TOC excludes valid chapters from other novels in side widgets',async()=>{
  const u='https://novhell.org/tempest-of-the-stellar-war/';
  const html='<article><div class="entry-content"><a href="https://novhell.org/tsw-chapitre-1/">Chapitre 1</a></div></article><aside><a href="https://novhell.org/srh-chapitre-451/">SRH - chapitres 451 à 453</a></aside>';
  const {ext}=chargerExtension(file,{[u]:html});assert.deepEqual(normaliser((await ext.getChapterList(u)).map(x=>x.url)),['https://novhell.org/tsw-chapitre-1/']);
});
