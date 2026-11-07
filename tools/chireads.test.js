const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/chireads.js');
const url='https://chireads.com/category/translatedtales/le-maitre-des-secrets/';
const base='https://chireads.com/translatedtales/le-maitre-des-secrets/';
const html=`
<figure class="refresh-detail-cover"><img src="https://chireads.com/cover.jpg"></figure>
<h1 class="refresh-detail-title">Le Maître des Secrets | Lord of the Mysteries</h1>
<dl><dt>Auteur</dt><dd>Auteur &#8217; test</dd></dl>
<div class="refresh-detail-summary-content"><p>Une histoire.</p></div>
<a href="${base}chapitre-1/2020/01/01/">Commencer la Lecture</a>
<ul class="refresh-detail-chapter-list">
<li><a href="${base}chapitre-1/2020/01/01/">Chapitre 1 &#8211; Début</a></li>
<li><a href="${base}chapitre-2/2020/01/02/">Chapitre 2 &#8211; Suite</a></li></ul>
<ol class="refresh-detail-chapter-list">
<li><a href="${base}tome-2-chapitre-1/2021/01/01/">Chapitre 1 &#8211; L&#8217;autre tome</a></li>
<li><a href="https://chireads.com/translatedtales/autre/chapter-2/">Autre œuvre</a></li></ol>
<aside><a href="${base}hors-sommaire/2022/01/01/">Hors sommaire</a></aside>`;
test('Chireads lit titre, couverture, auteur et synopsis du thème actuel',async()=>{
 const {ext}=chargerExtension(file,{[url]:html});const d=await ext.getMangaDetail(url);
 assert.equal(d.title,'Le Maître des Secrets');assert.equal(d.imageUrl,'https://chireads.com/cover.jpg');
 assert.equal(d.authors[0],'Auteur ’ test');assert.equal(d.description,'Une histoire.');
});
test('Chireads utilise seulement le sommaire et conserve l’ordre lorsque les tomes repartent à 1',async()=>{
 const {ext}=chargerExtension(file,{[url]:html});const c=normaliser(await ext.getChapterList(url));
 assert.deepEqual(c.map(x=>x.number),[1,2,3]);
 assert.deepEqual(c.map(x=>x.url),[base+'chapitre-1/2020/01/01/',base+'chapitre-2/2020/01/02/',base+'tome-2-chapitre-1/2021/01/01/']);
 assert.equal(c[2].title,'Chapitre 1 – L’autre tome');
});


test('Chireads conserve le repli ancien et les URL de chapitres',async()=>{
 const legacy=`<div class="chapitre-table"><a href="${base}chapitre-2/2020/01/02/">Chapitre 2 &#8211; Suite</a></div>`;
 const {ext}=chargerExtension(file,{[url]:legacy});const c=normaliser(await ext.getChapterList(url));
 assert.equal(c.length,1);assert.equal(c[0].url,base+'chapitre-2/2020/01/02/');assert.equal(c[0].number,2);assert.equal(c[0].title,'Chapitre 2 – Suite');
});
