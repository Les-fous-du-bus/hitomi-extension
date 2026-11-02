const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension, normaliser} = require('./ext-harness.js');
const FILE = path.join(__dirname, '../src/manga/celestial_scan.js');
const BASE = 'https://www.celestial-scan.com';
const work = BASE+'/projects/test';

test('Celestial catalogue uses card titles/covers and advertises real next page', async()=>{
  const html=`<link rel="next" href="/catalogue?page=2"><article class="card"><a href="/projects/test"><img src="/img/covers/test.webp"></a><a href="/projects/test/chapitre/12">Last chapter</a><h3 class="card__title"><a href="/projects/test">A &amp; B</a></h3></article>`;
  const {ext,appels}=chargerExtension(FILE,{'/catalogue':html});
  assert.deepEqual(normaliser(await ext.getPopular(1)),{list:[{title:'A & B',url:work,imageUrl:BASE+'/img/covers/test.webp'}],hasNextPage:true});
  await ext.search('A & B',2,[]);
  assert.match(appels[1].url,/search=A%20%26%20B/);
  assert.match(appels[1].url,/page=2/);
});
test('Celestial chapter list excludes navigation, keeps decimal numbers and chronology',async()=>{
  const html=`<h1 id="pj-title" class="pj__title">Test</h1><div class="pj__cover"><img src="/img/covers/test.webp"></div><span class="status status--completed">Terminé</span><dt>Auteur</dt><dd>Auteur</dd><div id="synopsis"><p>Résumé.</p></div><ol id="chap-list"><li data-num="16.2"><a class="ch-row" href="/projects/test/chapitre/16.2"><span class="ch-row__num">Chapitre 16.2</span><span class="ch-row__title">Deuxième partie</span></a></li><li data-num="15"><a class="ch-row" href="/projects/test/chapitre/15"><span class="ch-row__num">Chapitre 15</span><span class="ch-row__title">Début</span></a></li></ol><a href="/projects/other/chapitre/5">Other</a>`;
  const {ext}=chargerExtension(FILE,{'/projects/test':html});const value=normaliser(await ext.getMangaDetail(work));
  assert.equal(value.title,'Test');assert.equal(value.status,'completed');assert.deepEqual(value.authors,['Auteur']);
  assert.deepEqual(value.chapters.map(x=>x.number),[16.2,15]);
  assert.deepEqual(value.chapters.map(x=>x.title),['Chapitre 16.2 — Deuxième partie','Chapitre 15 — Début']);
});
test('Celestial reader accepts only chapter images, not logos, and preserves order',async()=>{
  const html=`<img src="/picture/logo.png"><div id="reader-container" data-pages="2"><figure class="reader__page"><img src="/img/chapters/test/1/001.webp"></figure><figure class="reader__page"><img src="/img/chapters/test/1/002.webp"></figure></div>`;
  const {ext}=chargerExtension(FILE,{'/chapitre/1':html});
  assert.deepEqual(normaliser(await ext.getPageList(work+'/chapitre/1')),[{index:0,imageUrl:BASE+'/img/chapters/test/1/001.webp'},{index:1,imageUrl:BASE+'/img/chapters/test/1/002.webp'}]);
});
test('Celestial incomplete/empty reader is an error, never a successful download',async()=>{
  for(const html of ['<div id="reader-container" data-pages="2"><img src="/img/chapters/test/1/001.webp"></div>','<html>Source unavailable</html>']){
    const {ext}=chargerExtension(FILE,{'/chapitre/1':html});
    await assert.rejects(ext.getPageList(work+'/chapitre/1'),/pages|lecture|lecteur/i);
  }
});
test('Celestial refuses off-source work links and propagates network errors',async()=>{
  const {ext}=chargerExtension(FILE,{'/catalogue':{error:'offline'}});
  await assert.rejects(ext.getPopular(1),/offline/);
  await assert.rejects(ext.getMangaDetail('https://evil.invalid/projects/test'),/source|adresse/i);
});
