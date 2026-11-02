const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/webnovel.js');
const root='https://m.webnovel.com',bookId='22196546206090805',chapterId='59583457017254387';
const book={bookId,bookName:'Shadow Slave',authorName:'Guiltythree',description:'A test description',languageName:'en',actionStatus:30,categoryName:'Fantasy',chapterNum:2};
const html=entities=>'<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{initialState:{entities}}})+'</script>';
function catalog(){return {books:{[bookId]:book},catalog:{[bookId]:{volumeItems:['v1']}},volume:{v1:{chapterItems:[chapterId,'98765432109876543']}},chapter:{[chapterId]:{chapterId,chapterName:'Nightmare Begins',chapterIndex:1,isAuth:1,isVip:0},'98765432109876543':{chapterId:'98765432109876543',chapterName:'Reserved',chapterIndex:2,isAuth:0,isVip:2}}};}
test('catalogue uses the native-observed Next.js state without invented works',async()=>{
  const {ext}=chargerExtension(file,{[root+'/']:html({books:{[bookId]:book,'11111111':{bookId:'11111111',bookName:'Foreign',languageName:'th'}}})});
  const list=await ext.popularNovels(1);assert.equal(list.list.length,1);assert.equal(list.list[0].title,'Shadow Slave');assert.equal(list.hasNextPage,false);assert.equal((await ext.popularNovels(2)).list.length,0);
});
test('search encodes the real mobile search query and does not fall back to homepage',async()=>{
  const {ext,appels}=chargerExtension(file,{[root+'/search?keywords=shadow%20slave']:html({books:{[bookId]:book}})});
  assert.equal((await ext.searchNovels('shadow slave',1)).list[0].title,'Shadow Slave');assert.equal(appels[0].url,root+'/search?keywords=shadow%20slave');
});
test('mobile homepage denormalized ranking and recommendation blocks are deduplicated',async()=>{
  const state={bookcityBlock:{rank:{type:3011,contentItems:[{listTypeList:[{selected:true,items:[book]}]}]},recommend:{type:2011,contentItems:[book]}}};
  const {ext}=chargerExtension(file,{[root+'/']:html(state)});
  assert.equal((await ext.popularNovels(1)).list.length,1);
});
test('full TOC ordering is taken from volume references and reserved chapters are labelled',async()=>{
  const {ext}=chargerExtension(file,{[root+'/book/'+bookId+'/catalog']:html(catalog())});
  const detail=await ext.parseNovelAndChapters('https://www.webnovel.com/book/shadow-slave_'+bookId);
  assert.equal(detail.author,'Guiltythree');assert.deepEqual(normaliser(detail.chapters.map(c=>c.name)),['[Locked] Reserved','Nightmare Begins']);
  const broken=catalog();broken.volume.v1.chapterItems.push('missing');
  const bad=chargerExtension(file,{[root+'/book/'+bookId+'/catalog']:html(broken)}).ext;
  await assert.rejects(bad.parseNovelAndChapters(root+'/book/'+bookId),/incomplet/);
});
test('free chapter content is read by its matching id and locked previews are rejected',async()=>{
  const url=root+'/book/'+bookId+'/'+chapterId;
  const entities={chapter:{[chapterId]:{chapterId,isAuth:1,vipStatus:0,contents:[{content:'<p>'+ 'Readable chapter '.repeat(80)+'</p>'}]}}};
  const {ext}=chargerExtension(file,{[url]:html(entities)});assert.match(await ext.parseChapter(url),/Readable chapter/);
  entities.chapter[chapterId].isAuth=0;
  const locked=chargerExtension(file,{[url]:html(entities)}).ext;await assert.rejects(locked.parseChapter(url),/verrouillé/);
});
test('unknown URL or Cloudflare page fails explicitly, never as readable content',async()=>{
  const {ext}=chargerExtension(file,{[root+'/']:'<h1>Just a moment...</h1>'});
  await assert.rejects(ext.popularNovels(1),/navigateur/);
  await assert.rejects(ext.parseChapter('https://evil.invalid/book/'+bookId+'/'+chapterId),/invalide/);
});
