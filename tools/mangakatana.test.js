const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness');
const file=path.join(__dirname,'../src/manga/mangakatana.js');
const a='https://mangakatana.com/manga/alpha.1',b='https://mangakatana.com/manga/beta.2';
test('covers stay associated with their own series, not parallel link and image positions',async()=>{
 const html='<a href="'+b+'">Beta title</a><a href="'+a+'"><img src="https://mangakatana.com/imgs/cover/a.jpg"></a><a href="'+a+'">Alpha &amp; One</a><a href="'+b+'"><img data-src="https://mangakatana.com/imgs/cover/b.jpg" src="placeholder.gif"></a>';
 const {ext}=chargerExtension(file,{'mangakatana.com':html});const r=await ext.getPopular(1);
 assert.deepEqual(normaliser(r.list.map(x=>[x.url,x.imageUrl])),[[a,'https://mangakatana.com/imgs/cover/a.jpg'],[b,'https://mangakatana.com/imgs/cover/b.jpg']]);
 assert.equal(r.list[0].title,'Alpha & One');
});
test('decimal chapter and first-chapter shortcuts never become catalogue series',async()=>{
 const html='<a href="'+a+'"><img src="https://mangakatana.com/imgs/cover/a.jpg"></a><a href="'+a+'/c1.5">Chapter 1.5</a><a href="'+a+'/fc">First chapter</a>';
 const {ext}=chargerExtension(file,{'mangakatana.com':html});const r=await ext.getPopular(1);assert.equal(r.list.length,1);assert.equal(r.list[0].url,a);
});
