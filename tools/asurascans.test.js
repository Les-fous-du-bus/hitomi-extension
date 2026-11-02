const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension, normaliser } = require('./ext-harness.js');
const file = path.join(__dirname, '../src/manga/asurascans.js');

test('Astro conserve les parametres et exclut la couverture des pages', async () => {
  const props = JSON.stringify({pages:[1,[[0,{url:[0,'https://cdn.test/1.webp?v=42&token=abc']}],[0,{url:[0,'/2.jpg?v=43']}]]],cover:[0,{url:[0,'https://cdn.test/cover.jpg']}]});
  const html = '<astro-island props="' + props.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '"></astro-island>';
  const { ext } = chargerExtension(file, {'/chapter/1':html});
  const pages = normaliser(await ext.getPageList('https://asurascans.com/chapter/1'));
  assert.deepEqual(pages.map(p => p.imageUrl), ['https://cdn.test/1.webp?v=42&token=abc','https://asurascans.com/2.jpg?v=43']);
  assert.deepEqual(pages.map(p => p.index), [0,1]);
});

test('le repli decode les guillemets et separe deux URL CDN', async () => {
  const html = '<div data-pages="https://cdn.asurascans.com/asura-images/chapters/x/1/a.webp?v=7&quot;, &quot;https://cdn.asurascans.com/asura-images/chapters/x/1/b.jpg?v=8"></div>';
  const { ext } = chargerExtension(file, {'/chapter/1':html});
  const pages = normaliser(await ext.getPageList('https://asurascans.com/chapter/1'));
  assert.deepEqual(pages.map(p => p.imageUrl), ['https://cdn.asurascans.com/asura-images/chapters/x/1/a.webp?v=7','https://cdn.asurascans.com/asura-images/chapters/x/1/b.jpg?v=8']);
});

test('catalogue and search use current browse routes instead of returning the comics homepage',async()=>{
 const card=(slug,title)=>'<a href="/comics/'+slug+'"><img src="https://cdn.asurascans.com/'+slug+'.webp" alt="'+title+'"></a>';
 const {ext,appels}=chargerExtension(file,{'/browse?order=rating&page=1':card('popular','Popular')+'<a href="/browse?order=rating&amp;page=2">Next</a>','/browse?order=update&page=1':card('latest','Latest'),'/browse?q=solo%20leveling&page=1':card('solo-leveling','Solo Leveling')});
 assert.equal((await ext.getPopular(1)).hasNextPage,true);
 assert.equal((await ext.getLatestUpdates(1)).list[0].title,'Latest');
 const results=await ext.search('solo leveling',1,[]);assert.deepEqual(normaliser(results.list.map(x=>x.title)),['Solo Leveling']);assert.equal(results.hasNextPage,false);
 assert.ok(appels.every(x=>x.url.includes('/browse?')));
});
