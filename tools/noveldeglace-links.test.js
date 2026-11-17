const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const source = path.join(__dirname, '../src/novel/noveldeglace.js');
const html = `<article><h2><a href="https://noveldeglace.com/roman/alpha/">Roman Alpha</a></h2><img src="a.jpg"></article>
<article><h2><a href="https://noveldeglace.com/roman/beta/">Roman Beta</a></h2><img src="b.jpg"></article>`;
const links = (result) => Array.from(result.list, (item) => item.url);
const expected = ['https://noveldeglace.com/roman/alpha/', 'https://noveldeglace.com/roman/beta/'];
test('catalogue et recherche conservent le lien propre a chaque titre', async () => {
  const { ext } = chargerExtension(source, { '/roman': html });
  assert.deepEqual(links(await ext.getPopular(1)), expected);
  assert.deepEqual(links(await ext.search('roman', 1, [])), expected);
});
test('nouveautes : un article sans lien Roman utilise son propre titre', async () => {
  const body = `<article><h2><a href="https://noveldeglace.com/roman/alpha/">Roman Alpha</a></h2><span class="Roman"><a href="https://noveldeglace.com/roman/alpha/">Alpha</a></span></article><article><h2><a href="https://noveldeglace.com/roman/beta/">Roman Beta</a></h2></article>`;
  const { ext } = chargerExtension(source, { '/chapitre': body });
  assert.deepEqual(links(await ext.getLatestUpdates(1)), expected);
});


test('les métadonnées utilisent les classes composées et ignorent les infobulles', async () => {
  const html=`<h1 class="entry-title">Roman Test</h1><div class="line_roman"><div class="type categorie"><strong>Catégorie :</strong><span class="label-categorie"><a href="/categorie_roman/seinen/">Seinen</a></span></div></div><div class="type genre"><strong>Genre :</strong><span title="Descriptions adulte, violence, sexe"><a href="/genre/action/">Action</a></span>,<span><a href="/genre/horreur/">Horreur</a></span></div>`;
  const {ext}=chargerExtension(source, {'/roman/test/':html});
  const detail=await ext.getMangaDetail('https://noveldeglace.com/roman/test/');
  assert.deepEqual(Array.from(detail.genres),['Seinen','Action','Horreur']);assert.equal(detail.isMature,false);
});
test('les classes simples et les entités des liens restent prises en compte', async () => {
  const html='<h1 class="entry-title">Test</h1><div class="categorie"><strong>Catégorie :</strong><a href="/cat/">Autre</a></div><div class="genre"><a href="/genre/">Action &amp; aventure</a></div>';
  const {ext}=chargerExtension(source, {'/roman/test/':html});
  assert.deepEqual(Array.from((await ext.getMangaDetail('https://noveldeglace.com/roman/test/')).genres),['Action & aventure']);
});

test('les anciens blocs de métadonnées sans liens restent lisibles', async () => {
  const html='<h1 class="entry-title">Test</h1><div class="categorie">Catégorie : Seinen</div><div class="genre">Genre : Action, Horreur</div>';
  const {ext}=chargerExtension(source, {'/roman/test/':html});
  assert.deepEqual(Array.from((await ext.getMangaDetail('https://noveldeglace.com/roman/test/')).genres),['Seinen','Action','Horreur']);
});

test('les classes taxonomiques genre-action du conteneur ne deviennent pas le bloc genre', async () => {
  const html='<div class="roman genre-action genre-aventure"><h1 class="entry-title">Test</h1><div class="type categorie"><a href="/categorie_roman/seinen/">Seinen</a></div><div class="type genre"><a href="/genre/action/">Action</a><a href="/genre/horreur/">Horreur</a></div><div data-title="Tomes"><a href="/chapitre/test/">Chapitre 1</a></div></div>';
  const {ext}=chargerExtension(source, {'/roman/test/':html});
  assert.deepEqual(Array.from((await ext.getMangaDetail('https://noveldeglace.com/roman/test/')).genres),['Seinen','Action','Horreur']);
});

test('le contenu de chapitre exige un vrai token de classe et conserve les div imbriquées', async () => {
  const html='<div class="chapter-content-wrapper"><div class="entry-content-chapitre chapter-inner chapter-content"><p>Texte</p><div>Suite</div></div><a>Navigation extérieure</a></div>';
  const {ext}=chargerExtension(source, {'/chapitre/test/':html});
  assert.equal(await ext.getContent('https://noveldeglace.com/chapitre/test/'),'<p>Texte</p><div>Suite</div>');
});

test('les espaces HTML des genres deviennent des espaces normaux pour les filtres', async () => {
  const html='<h1 class="entry-title">Test</h1><div class="type genre"><a>Arts&nbsp;Martiaux</a><a>Tranche&#160;de&#xA0;vie</a></div>';
  const {ext}=chargerExtension(source, {'/roman/test/':html});
  assert.deepEqual(Array.from((await ext.getMangaDetail('https://noveldeglace.com/roman/test/')).genres),['Arts Martiaux','Tranche de vie']);
});
