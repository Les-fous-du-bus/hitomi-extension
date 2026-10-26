const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness');
const file=path.join(__dirname,'../src/manga/mangahere.js');
const url='https://www.mangahere.cc/manga/seoul/c003/1.html';

test('newImgs direct garde les pages et leurs parametres dans l ordre',async()=>{
 const {ext,appels}=chargerExtension(file,{'/c003/1.html':`<script>var newImgs=['//cdn.test/1.jpg?x=1&amp;y=2','https://cdn.test/2.png'];</script>`});
 const pages=normaliser(await ext.getPageList(url));
 assert.deepEqual(pages,[{index:0,imageUrl:'https://cdn.test/1.jpg?x=1&y=2',headers:{Referer:'https://www.mangahere.cc/'}},{index:1,imageUrl:'https://cdn.test/2.png',headers:{Referer:'https://www.mangahere.cc/'}}]);
 assert.equal(appels.length,1);
});

test('newImgs packed est decode sans evaluer le code du site',async()=>{
 const html=`<script>eval(function(p,a,c,k,e,d){throw new Error('ne pas executer')}(\'0 1=["//2.3/4.5","//2.3/6.5"];\',7,7,\'var|newImgs|cdn|test|one|jpg|two\'.split('|'),0,{}))</script>`;
 const {ext,appels}=chargerExtension(file,{'/c003/1.html':html});
 const pages=normaliser(await ext.getPageList(url));
 assert.deepEqual(pages.map(p=>p.imageUrl),['https://cdn.test/one.jpg','https://cdn.test/two.jpg']);
 assert.equal(appels.length,1);
});

test('le format historique chapterfun reste pris en charge',async()=>{
 const {ext,appels}=chargerExtension(file,{'/c003/1.html':'<script>var chapterid=42;var imagecount=2;</script>','/chapterfun.ashx?cid=42&page=1':`var pix="//cdn.test/";var pvalue=["one.jpg","two.jpg"];`});
 const pages=normaliser(await ext.getPageList(url));
 assert.deepEqual(pages.map(p=>p.imageUrl),['https://cdn.test/one.jpg','https://cdn.test/two.jpg']);
 assert.equal(appels.length,2);
});

test('la capture reelle de Seoul chapitre 3 rend ses 23 images en une requete',async()=>{
 const html=require('node:fs').readFileSync(path.join(__dirname,'fixtures/mangahere-seoul-c003-reader.html'),'utf8');
 const {ext,appels}=chargerExtension(file,{'/c003/1.html':html});
 const pages=normaliser(await ext.getPageList(url));
 assert.equal(pages.length,23);
 assert.ok(pages[0].imageUrl.startsWith('https://zjcdn.mangahere.org/store/manga/40851/003.0/compressed/e001-'));
 assert.deepEqual(pages.map(p=>p.index),Array.from({length:23},(_,i)=>i));
 assert.equal(appels.length,1);
});

test('une image declaree deux fois conserve ses deux positions',async()=>{
 const {ext}=chargerExtension(file,{'/c003/1.html':`<script>var newImgs=['//cdn.test/repeated.jpg','//cdn.test/repeated.jpg'];</script>`});
 const pages=normaliser(await ext.getPageList(url));
 assert.equal(pages.length,2);assert.deepEqual(pages.map(p=>p.index),[0,1]);
});
