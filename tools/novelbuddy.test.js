const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/novelbuddy.js'),u='https://novelbuddy.me/test';
const html=m=>'<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{initialManga:m}}})+'</script>';
const chapter=n=>({url:'/test/chapter-'+n,name:'Chapter '+n,number:n,updated_at:'2026-11-02T00:00:00Z'});
test('NovelBuddy loads the official full chapter API when SSR only carries the latest slice',async()=>{
  const m={id:'1oYO1V2a',name:'Test',chapters:[chapter(3)],stats:{chaptersCount:3},firstChapter:chapter(1)};
  const {ext,appels}=chargerExtension(file,{[u]:html(m),'https://api.novelbuddy.me/titles/1oYO1V2a/chapters':JSON.stringify({success:true,data:{chapters:[chapter(3),chapter(2),chapter(1)]}})});
  const d=await ext.parseNovelAndChapters(u);assert.deepEqual(normaliser(d.chapters.map(c=>c.chapterNumber)),[1,2,3]);
  assert.equal(appels.length,2);assert.equal(d.chapters[0].releaseTime,'2026-11-02T00:00:00Z');
});
test('NovelBuddy refuses an advertised full API response that is missing chapters',async()=>{
  const m={id:'1oYO1V2a',name:'Test',chapters:[chapter(3)],stats:{chaptersCount:3}};
  const {ext}=chargerExtension(file,{[u]:html(m),'https://api.novelbuddy.me/titles/1oYO1V2a/chapters':JSON.stringify({success:true,data:{chapters:[chapter(3)]}})});
  await assert.rejects(ext.parseNovelAndChapters(u),/incomplet/);
});
test('NovelBuddy preserves complete SSR catalogues without an unnecessary API request',async()=>{
  const m={name:'Test',chapters:[chapter(2),chapter(1)],stats:{chaptersCount:2},firstChapter:chapter(1)};
  const {ext,appels}=chargerExtension(file,{[u]:html(m)});assert.equal((await ext.parseNovelAndChapters(u)).chapters.length,2);assert.equal(appels.length,1);
});
test('NovelBuddy duplicate rows cannot satisfy the advertised chapter total',async()=>{
  const m={id:'1oYO1V2a',name:'Test',chapters:[chapter(3)],stats:{chaptersCount:3}};
  const {ext}=chargerExtension(file,{[u]:html(m),'https://api.novelbuddy.me/titles/1oYO1V2a/chapters':JSON.stringify({success:true,data:{chapters:[chapter(3),chapter(3),chapter(1)]}})});
  await assert.rejects(ext.parseNovelAndChapters(u),/incomplet/);
});
