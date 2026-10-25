const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness');
const file=path.join(__dirname,'../src/manga/mangaread.js');
test('MangaRead garde la premiere image lorsque src precede class',async()=>{
 const html='<img src="https://cdn.test/1.jpg" class="wp-manga-chapter-img"><img src="https://cdn.test/2.jpg" class="wp-manga-chapter-img"><img class="wp-manga-chapter-img" src="https://cdn.test/3.jpg">';
 const {ext}=chargerExtension(file,{'/chapter-1':html});
 assert.deepEqual(normaliser(await ext.getPageList('https://www.mangaread.org/chapter-1')),[{index:0,imageUrl:'https://cdn.test/1.jpg'},{index:1,imageUrl:'https://cdn.test/2.jpg'},{index:2,imageUrl:'https://cdn.test/3.jpg'}]);
});
test('MangaRead privilegie data-src et ne ramasse ni icones ni doublons',async()=>{
 const html=`<img src="https://cdn.test/placeholder.jpg" class='wp-manga-chapter-img' data-src=' https://cdn.test/real.webp?a=1&amp;b=2 '><img class="logo" src="https://cdn.test/logo.png"><img class="wp-manga-chapter-img" src="https://cdn.test/real.webp?a=1&amp;b=2"><img src='/2.jpg' class='wp-manga-chapter-img'>`;
 const {ext}=chargerExtension(file,{'/chapter-1':html});
 const pages=normaliser(await ext.getPageList('https://www.mangaread.org/chapter-1'));
 assert.deepEqual(pages,[{index:0,imageUrl:'https://cdn.test/real.webp?a=1&b=2'},{index:1,imageUrl:'https://www.mangaread.org/2.jpg'}]);
});

test('un data-src non reseau ne cache pas le vrai src',async()=>{
 const {ext}=chargerExtension(file,{'/chapter-1':`<img data-src="data:image/gif;base64,x" src="https://cdn.test/real.jpg" class="wp-manga-chapter-img">`});
 assert.deepEqual(normaliser(await ext.getPageList('https://www.mangaread.org/chapter-1')),[{index:0,imageUrl:'https://cdn.test/real.jpg'}]);
});
