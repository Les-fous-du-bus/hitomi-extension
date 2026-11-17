const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension} = require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/novelfull.js');
const page=(id)=>`<div><img src="/cover-${id}.jpg" class="cover"></div><h3 class="truyen-title"><span class="glyphicon glyphicon-book"></span><a\n href="/story-${id}.html" title="Story ${id}">Story ${id}</a></h3>`;
const filters=[{type:'SelectFilter',name:'Genre',state:1,value:'Horror',values:[{displayName:'All',value:''},{displayName:'Horror',value:'Horror'}]}];
test('NovelFull propose Horreur via le genre officiel Horror',()=>{
 const {ext}=chargerExtension(file,{});const f=ext.getFilterList().find(f=>f.name==='Genre');assert.ok(f);assert.ok(f.values.some(v=>v.value==='Horror'));
});
test('le gabarit h3 avec icone ne supprime pas les œuvres',async()=>{
 const {ext}=chargerExtension(file,{'/most-popular':page(1)});const r=await ext.popularNovels(1);assert.equal(r.list.length,1);assert.equal(r.list[0].title,'Story 1');
});
test('la pagination conserve genre et tags, sans fausse recherche par titre',async()=>{
 const {ext,appels}=chargerExtension(file,{'/genre/Horror?page=2':page(2),'/genre/Horror':page(1)+'<a rel="next" href="/genre/Horror?page=2">Next</a>'});
 const a=await ext.searchNovels('',1,filters);const b=await ext.searchNovels('',2,filters);
 assert.equal(appels[0].url,'https://novelfull.com/genre/Horror');assert.equal(appels[1].url,'https://novelfull.com/genre/Horror?page=2');
 assert.equal(a.list.length,1);assert.equal(b.list.length,1);assert.notEqual(a.list[0].url,b.list[0].url);assert.ok(a.list[0].genres.includes('Horror'));assert.equal(a.list[0].matureType,'unknown');assert.equal(a.hasNextPage,true);
});
test('la sélection via state sans value reste compatible',async()=>{
 const {ext,appels}=chargerExtension(file,{'/genre/Horror':page(1)});const f=JSON.parse(JSON.stringify(filters));delete f[0].value;await ext.searchNovels('',1,f);assert.match(appels[0].url,/\/genre\/Horror$/);
});
test('titre et genre ne deviennent pas une fausse recherche exhaustive',async()=>{
 const {ext}=chargerExtension(file,{});await assert.rejects(ext.searchNovels('Ghost',1,filters),/titre.*genre/i);
});
test('la recherche historique sans genre est conservée',async()=>{
 const {ext,appels}=chargerExtension(file,{'/search?keyword=Ghost&page=2':page(3)});const r=await ext.searchNovels('Ghost',2);assert.equal(r.list.length,1);assert.equal(appels[0].url,'https://novelfull.com/search?keyword=Ghost&page=2');
});
test('un genre arbitraire non déclaré est rejeté',async()=>{
 const {ext}=chargerExtension(file,{});await assert.rejects(ext.searchNovels('',1,[{type:'SelectFilter',name:'Genre',value:'../../private'}]),/genre.*invalide/i);
});
test('la dernière page avec suivant désactivé termine la pagination',async()=>{
 const {ext}=chargerExtension(file,{'/genre/Horror?page=2':page(2)+'<ul class="pagination pagination-sm"><li class="next disabled"><span>Next</span></li></ul>'});
 const r=await ext.searchNovels('',2,filters);assert.equal(r.hasNextPage,false);
});
