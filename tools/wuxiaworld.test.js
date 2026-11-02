const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension, normaliser} = require('./ext-harness.js');
const file = path.join(__dirname, '../src/novel/wuxiaworld.js');
const root = 'https://lite.wuxiaworld.com';
const cell = '<td class="novel-cell"><a class="cover" href="/novel/test"><img src="https://cdn.wuxiaworld.com/test.jpg"></a><p class="title"><a href="/novel/test">Test &amp; One</a></p></td>';
test('catalogue parsing and cursor pagination retain the requested query',async()=>{
  const {ext,appels}=chargerExtension(file,{
    '/novels?q=test&after=42':cell,
    '/novels?q=test':cell+'<a class="btn next" href="/novels?q=test&amp;after=42">Next</a>',
  });
  const first=await ext.searchNovels('test',1);assert.equal(first.list[0].title,'Test & One');assert.equal(first.hasNextPage,true);
  const second=await ext.searchNovels('test',2);assert.equal(second.list.length,1);
  assert.equal(appels[1].url,root+'/novels?q=test&after=42');
});
test('detail follows full paginated TOC and labels locked chapters',async()=>{
  const first='<h1>Test</h1><p class="muted small">Ongoing · Author: Writer · Translator: Team</p><div class="cover"><img src="https://cdn.wuxiaworld.com/test.jpg"></div><h2>Synopsis</h2><div class="chapter-body"><p>Intro</p></div><ul class="toc"><li><a href="/novel/test/ch1">Chapter 1</a></li></ul><a class="btn next" href="/novel/test?toc=2">Next</a>';
  const second='<ul class="toc"><li><a class="locked" href="/novel/test/ch2">Chapter 2</a></li></ul>';
  const {ext}=chargerExtension(file,{'/novel/test?toc=2':second,'/novel/test/ch2':'This chapter requires an account','/novel/test':first});
  const detail=await ext.parseNovelAndChapters(root+'/novel/test');
  assert.equal(detail.author,'Writer');assert.equal(detail.description,'Intro');
  assert.deepEqual(normaliser(detail.chapters.map(x=>x.name)),['[Locked] Chapter 2','Chapter 1']);
});
test('official truncated teasers are not accepted as offline chapters',async()=>{
  const u=root+'/novel/test/ch1';const {ext}=chargerExtension(file,{[u]:'<div id="chapter-body" class="chapter-body"><p>'+ 'Preview '.repeat(100)+'...</p></div>'});
  await assert.rejects(ext.parseChapter(u),/aperçu/);
});
test('reader refuses locked bodies instead of returning a sign-in screen',async()=>{
  const u=root+'/novel/test/ch1';const story='<div id="chapter-body" class="chapter-body"><p>'+ 'Readable '.repeat(100)+'</p></div><script>not content</script>';
  const {ext}=chargerExtension(file,{[u]:story});assert.match(await ext.parseChapter(u),/Readable/);
  const locked=chargerExtension(file,{[u]:'<h1>Chapter</h1><p>Unlock this chapter to continue</p>'}).ext;
  await assert.rejects(locked.parseChapter(u),/verrouillé/);
});
test('an advertised TOC page without chapters cannot silently truncate the book',async()=>{
  const first='<h1>Test</h1><ul class="toc"><li><a href="/novel/test/ch1">Chapter 1</a></li></ul><a class="btn next" href="/novel/test?toc=2">Next</a>';
  for(const suffix of ['', '<span>Page 1 of 2</span>']){
    const {ext}=chargerExtension(file,{'/novel/test?toc=2':'<html>Unavailable</html>','/novel/test':first+suffix});
    await assert.rejects(ext.parseNovelAndChapters(root+'/novel/test'),/sommaire vide/);
  }
});
