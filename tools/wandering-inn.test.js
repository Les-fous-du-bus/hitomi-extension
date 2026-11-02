const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension, normaliser} = require('./ext-harness.js');
const file = path.join(__dirname, '../src/novel/wandering_inn.js');
const toc = `<meta property="og:image" content="https://wanderinginn.com/cover.png">
<a href="https://wanderinginn.com/2016/01/01/archive/">Archive navigation</a>
<div class="body-web table-cell"><a href="https://wanderinginn.com/2017/03/03/rw1-00/">1.00</a></div>
<div class="body-web table-cell"><a href="https://wanderinginn.com/2026/01/01/interlude/">Interlude &ndash; A Visit</a></div>
<div class="body-web table-cell"><a href="https://wanderinginn.com/2017/03/03/rw1-00/">duplicate mobile link</a></div>`;
test('single-work catalogue and search do not invent separate novels', async () => {
  const {ext} = chargerExtension(file, {'/table-of-contents/':toc});
  assert.equal((await ext.popularNovels(1)).list.length, 1);
  assert.equal((await ext.popularNovels(2)).list.length, 0);
  assert.equal((await ext.searchNovels('wandering',1)).list.length, 1);
  assert.equal((await ext.searchNovels('unknown work',1)).list.length, 0);
});
test('TOC preserves reading order, interludes and revised volume links without navigation/duplicates', async () => {
  const {ext} = chargerExtension(file, {'/table-of-contents/':toc,'/2026/01/01/interlude/':'<article class="twi-article"><p>Public text</p></article>'});
  const detail = await ext.parseNovelAndChapters('https://wanderinginn.com/table-of-contents/');
  assert.deepEqual(normaliser(detail.chapters.map(c=>[c.name,c.chapterNumber])),[['Interlude – A Visit',2],['1.00',1]]);
  assert.equal(detail.cover, 'https://wanderinginn.com/cover.png');
});
test('new Patreon previews are declared locked without bypassing access', async () => {
  const {ext}=chargerExtension(file,{'/table-of-contents/':toc,'/2026/01/01/interlude/':'<div class="patreon-protected-post">Members only</div>','/2017/03/03/rw1-00/':'<article class="twi-article">Story</article>'});
  const detail=await ext.parseNovelAndChapters('https://wanderinginn.com/table-of-contents/');
  assert.equal(detail.chapters[0].name,'[Locked] Interlude – A Visit');
});
test('reader takes the real article and rejects paywall/challenge/empty templates', async () => {
  const u = 'https://wanderinginn.com/2017/03/03/rw1-00/';
  const {ext} = chargerExtension(file, {[u]:`<aside>menu</aside><article class="twi-article"><p>${'Story '.repeat(100)}</p><script>bad()</script><p><a href="/next">Next Chapter</a></p></article><footer>comments</footer>`});
  const text = await ext.parseChapter(u);
  assert.match(text,/Story/);assert.doesNotMatch(text,/bad\(\)|Next Chapter|comments/);
  const missing=chargerExtension(file,{[u]:'<html><p>Subscribe to Patreon</p></html>'}).ext;
  await assert.rejects(missing.parseChapter(u),/indisponible/);
});
