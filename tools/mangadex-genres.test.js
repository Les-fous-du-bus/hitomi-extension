const test = require('node:test');
const assert = require('node:assert/strict');
const { chargerExtension } = require('./ext-harness.js');
const file = process.env.HITOMI_MANGADEX_TEST_PATH || require('node:path').join(__dirname,'../src/manga/mangadex.js');
const horror = 'cdad7e68-1419-41dd-bdce-27753074a640';
function prepare() { return chargerExtension(file, {'/manga?': JSON.stringify({result:'ok',total:0,data:[]})}); }
test('MangaDex expose Horreur dans ses genres', () => {
  const {ext} = prepare();
  const genre = ext.getFilterList().find(f=>f.name==='Genre');
  assert.ok(genre);
  assert.ok(genre.values.some(v=>v.displayName==='Horreur' && v.value===horror));
});
for (const lang of ['fr','en']) test(`Horreur + ${lang} reste appliqué en page 2`, async()=>{
  const {ext,appels} = prepare();
  const filters=ext.getFilterList();
  const genre=filters.find(f=>f.name==='Genre'); assert.ok(genre);
  genre.state=genre.values.findIndex(v=>v.value===horror);
  const language=filters.find(f=>f.name==='Langue');
  language.state=language.values.findIndex(v=>v.value===lang);
  await ext.search('',2,filters);
  const u=new URL(appels[0].url);
  assert.equal(u.searchParams.get('includedTags[]'),horror);
  assert.equal(u.searchParams.get('availableTranslatedLanguage[]'),lang);
  assert.equal(u.searchParams.get('offset'),'20');
  assert.equal(u.searchParams.has('title'),false);
});
test('Tous les genres ne transmet aucun tag de genre',async()=>{
 const {ext,appels}=prepare(); await ext.search('',1,ext.getFilterList());
 assert.equal(new URL(appels[0].url).searchParams.has('includedTags[]'),false);
});
test('les cartes portent leurs genres et le classement précis de l API',async()=>{
 const {ext}=chargerExtension(file,{'/manga?':JSON.stringify({result:'ok',total:1,data:[{id:'example',attributes:{title:{en:'Example'},contentRating:'erotica',tags:[{attributes:{name:{en:'Horror'}}}]}}]})});
 const result=await ext.search('',1,[]);
 assert.ok(result.list[0].genres?.includes('Horror'));
 assert.equal(result.list[0].matureType,'sexual');
});
