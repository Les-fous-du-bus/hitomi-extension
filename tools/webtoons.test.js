const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/manga/webtoons.js');
const work='https://www.webtoons.com/fr/thriller/test/list?title_no=123';
const episode=n=>`<li class="_episodeItem" id="episode_${n}" data-episode-no="${n}"><a href="/fr/thriller/test/ep${n}/viewer?title_no=123&amp;episode_no=${n}"><span class="subj"><span>Épisode ${n}</span></span></a></li>`;

test('all chapter list pages are followed, URLs decoded and episodes deduplicated',async()=>{
  const {ext,appels}=chargerExtension(file,{
    'page=1':episode(3)+episode(2)+'<div class="paginate"><a href="/fr/thriller/test/list?title_no=123&amp;page=2">2</a></div>',
    'page=2':episode(2)+episode(1)+'<div class="paginate"><a href="/fr/thriller/test/list?title_no=123&page=1">1</a></div>'
  });
  const list=await ext.getChapterList(work);
  assert.deepEqual(normaliser(list.map(x=>x.number)),[3,2,1]);
  assert.equal(list[2].url,'https://www.webtoons.com/fr/thriller/test/ep1/viewer?title_no=123&episode_no=1');
  assert.equal(appels.length,2);
});
test('language filter selects English and search does not repeat its first page forever',async()=>{
  const card='<a class="card" href="/en/fantasy/example/list?title_no=42"><strong class="title">Example</strong><img src="//cdn.example/cover.jpg"></a>';
  const {ext,appels}=chargerExtension(file,{'/en/search?keyword=Example':card});
  const filters=[{type:'SelectFilter',name:'Langue',state:1,values:[{value:'fr'},{value:'en'}]}];
  const r=await ext.search('Example',1,filters);
  assert.equal(r.list.length,1);assert.equal(r.list[0].url,'https://www.webtoons.com/en/fantasy/example/list?title_no=42');
  assert.equal(r.hasNextPage,false);
  const next=await ext.search('Example',2,filters);assert.equal(next.list.length,0);assert.equal(appels.length,1);
});
test('images accept attribute order and quote variants without nav thumbnails or duplicates',async()=>{
  const html=`<div id='_imageList'><img data-url='//cdn.example/one.jpg?a=1&amp;b=2' class='_images' />
    <img class='_thumbnailImages' data-url='https://cdn.example/thumb.jpg'/>
    <img class='_images' data-url='//cdn.example/one.jpg?a=1&amp;b=2'/>
    <img class='_images' data-url='https://cdn.example/two.jpg'/></div>`;
  const {ext}=chargerExtension(file,{'/viewer':html});
  const pages=await ext.getPageList('https://m.webtoons.com/fr/test/viewer?title_no=123&episode_no=1');
  assert.deepEqual(normaliser(pages.map(x=>x.imageUrl)),['https://cdn.example/one.jpg?a=1&b=2','https://cdn.example/two.jpg']);
  assert.deepEqual(normaliser(pages.map(x=>x.index)),[0,1]);
});
test('upstream chapter failure stays visible instead of a successful empty list',async()=>{
  const {ext}=chargerExtension(file,{'page=1':{status:403,body:'Access denied',error:'HTTP 403'}});
  await assert.rejects(ext.getChapterList(work),/403/);
});

test('a failed later chapter page cannot be advertised as a complete first page',async()=>{
  const {ext}=chargerExtension(file,{
    'page=1':episode(3)+'<div class="paginate"><a href="/fr/thriller/test/list?title_no=123&page=2">2</a></div>',
    'page=2':'<html>Source temporarily unavailable</html>'
  });
  await assert.rejects(ext.getChapterList(work),/incomplète|indisponible/);
});

test('catalogue and detail transport failures are propagated to Android', async()=>{
  const {ext}=chargerExtension(file,{'/originals':{error:'network unavailable'},'page=1':{error:'network unavailable'}});
  await assert.rejects(ext.getPopular(1),/network unavailable/);
  await assert.rejects(ext.getMangaDetail(work),/network unavailable/);
});
