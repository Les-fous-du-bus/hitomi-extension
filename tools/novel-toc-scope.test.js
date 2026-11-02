const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
for(const [id,work,chapter,foreign]of [
  ['xiaowaz','https://xiaowaz.fr/series-en-cours/a-monster-who-levels-up/','https://xiaowaz.fr/articles/mwlu-chapitre-1/','https://xiaowaz.fr/articles/og-chapitre-990/'],
  ['wuxialnscantrad','https://wuxialnscantrad.wordpress.com/abyss-domination/','https://wuxialnscantrad.wordpress.com/2018/08/09/ad-chapitre-1/','https://wuxialnscantrad.wordpress.com/2021/09/24/two-chapitre-372/'],
])test(id+' only includes the selected book TOC, not recent unrelated chapters',async()=>{
  const html='<article><div class="entry-content"><div><a href="'+chapter+'">Chapitre 1</a></div></div></article><aside><a href="'+foreign+'">Autre roman Chapitre 990</a></aside>';
  const{ext}=chargerExtension(path.join(__dirname,'../src/novel/'+id+'.js'),{[work]:html});
  assert.deepEqual(normaliser((await ext.getChapterList(work)).map(x=>x.url)),[chapter]);
});
