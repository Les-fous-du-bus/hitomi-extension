// Comportement de readnovelfull, sur des reponses relevees sur le site.
//
// POURQUOI ces tests : le choix de conception qui merite d'etre bloque est
// l'appel a `/ajax/chapter-archive?novelId=N`. Cette adresse n'est ecrite nulle
// part dans les pages du site — elle a ete trouvee a l'essai le 2026-09-08 — et
// elle rend les 2053 chapitres d'« Ancient Godly Monarch » en UNE requete, avec
// leurs vrais titres. Elle depend d'un identifiant numerique interne present
// dans la page de l'oeuvre. Si cet identifiant disparait, il faut le savoir tout
// de suite plutot que de rendre une liste vide.
//
// Lancer : node --test tools/readnovelfull.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'readnovelfull.js');

const FICHE_CATALOGUE = (slug, titre, auteur) => `
  <div class="row">
    <div class="col-xs-3"><div>
      <img src="https://img.readnovelfull.com/thumb/t-80x113/${slug}.jpg" class="cover" alt="${titre}">
    </div></div>
    <div class="col-xs-7"><div>
      <h3 class="novel-title"><a href="/${slug}-v1.html" title="${titre}">${titre}</a></h3>
      <span class="author"><span class="glyphicon glyphicon-pencil"></span> ${auteur}</span>
    </div></div>
  </div>`;

const PAGE_LISTE = `
  <div class="list list-novel col-xs-12">
    <div class="header-list"><h2>Most Popular Novels</h2></div>
    ${FICHE_CATALOGUE('world-defying-dan-god', 'World Defying Dan God', 'Ji Xiao Zei')}
    ${FICHE_CATALOGUE('ancient-godly-monarch', 'Ancient Godly Monarch', 'Jing Wu Hen')}
  </div>
  <ul class="pagination"><li><a href="/novel-list/most-popular-novel?page=2">2</a></li></ul>`;

const PAGE_OEUVRE = `
  <div class="books">
    <div class="book"><img src="https://img.readnovelfull.com/thumb/t-300x439/Ancient-Godly-Monarch.jpg" alt="Ancient Godly Monarch"></div>
    <h3 class="title">Ancient Godly Monarch</h3>
  </div>
  <ul class="info info-meta">
    <li><h3>Author:</h3><a href="/authors/jing-wu-hen">Jing Wu Hen</a></li>
    <li><h3>Genre:</h3><a href="/genres/action">Action</a><a href="/genres/xuanhuan">Xuanhuan</a></li>
    <li><h3>Status:</h3><a href="/novel-list/completed-novel">Completed</a></li>
  </ul>
  <div class="desc-text">In the Province of the Nine Skies, far above the heavens.</div>
  <div id="rating" data-novel-id="80"></div>`;

const ARCHIVE = `
  <ul class="list-chapter">
    <li><a href="/ancient-godly-monarch/chapter-1-cultivation-with-broken-meridians-v1.html"
           title="Chapter 1: Cultivation with Broken Meridians">
      <span class="nchr-text">Chapter 1: Cultivation with Broken Meridians</span></a></li>
    <li><a href="/ancient-godly-monarch/chapter-2-the-astral-soul-v1.html"
           title="Chapter 2: The Astral Soul">
      <span class="nchr-text">Chapter 2: The Astral Soul</span></a></li>
    <li><a href="/ancient-godly-monarch/chapter-2053-end-v1.html" title="Chapter 2053: End">
      <span class="nchr-text">Chapter 2053: End</span></a></li>
  </ul>`;

test('le catalogue se lit', async (t) => {
  const { ext } = chargerExtension(EXTENSION, { '/novel-list/': PAGE_LISTE });
  const r = await ext.getPopular(1);

  await t.test('les deux oeuvres remontent', () => {
    assert.strictEqual(r.list.length, 2);
  });

  await t.test('le titre vient de la balise du site', () => {
    assert.ok(r.list.some((o) => o.title === 'World Defying Dan God'));
  });

  await t.test('les adresses sont absolues', () => {
    assert.ok(r.list.every((o) => o.url.startsWith('https://readnovelfull.com/')));
  });

  await t.test('les couvertures sont deja absolues chez cet hote', () => {
    assert.ok(r.list.every((o) => o.imageUrl.startsWith('https://img.readnovelfull.com/')));
  });

  await t.test('la page suivante vient de la pagination', () => {
    assert.strictEqual(r.hasNextPage, true);
  });
});

test('la derniere page ne promet pas de suite', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novel-list/': PAGE_LISTE.replace(/<ul class="pagination">[\s\S]*?<\/ul>/, ''),
  });
  assert.strictEqual((await ext.getPopular(4)).hasNextPage, false);
});

test('la fiche est complete', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/ancient-godly-monarch-v1.html': PAGE_OEUVRE,
  });
  const d = await ext.getMangaDetail('https://readnovelfull.com/ancient-godly-monarch-v1.html');

  await t.test('titre, synopsis, auteur, genres, statut', () => {
    assert.strictEqual(d.title, 'Ancient Godly Monarch');
    assert.match(d.description, /Nine Skies/);
    assert.deepStrictEqual(normaliser(d.authors), ['Jing Wu Hen']);
    assert.deepStrictEqual(normaliser(d.genres), ['Action', 'Xuanhuan']);
    assert.strictEqual(d.status, 'completed');
  });

  await t.test('la couverture est la grande, pas la vignette', () => {
    assert.match(d.imageUrl, /t-300x439/);
  });
});

test('toute la liste de chapitres vient en une requete', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    '/ancient-godly-monarch-v1.html': PAGE_OEUVRE,
    '/ajax/chapter-archive': ARCHIVE,
  });
  const ch = await ext.getChapterList('https://readnovelfull.com/ancient-godly-monarch-v1.html');

  await t.test('les chapitres remontent avec leurs vrais titres', () => {
    assert.strictEqual(ch.length, 3);
    assert.ok(ch.some((c) => c.title === 'Chapter 1: Cultivation with Broken Meridians'));
  });

  await t.test('l identifiant interne est bien passe a l adresse', () => {
    const ajax = appels.find((a) => a.url.includes('chapter-archive'));
    assert.match(ajax.url, /novelId=80/);
  });

  await t.test('deux requetes en tout : la fiche puis l archive', () => {
    assert.strictEqual(appels.length, 2);
  });

  await t.test('l ordre de lecture est decroissant', () => {
    assert.strictEqual(ch[0].number, 2053);
    assert.strictEqual(ch.at(-1).number, 1);
  });

  await t.test('le numero est extrait du titre, pas de la position', () => {
    // La position dirait 3, 2, 1 ; le recit dit 2053, 2, 1. Se tromper la
    // casserait la reprise de lecture.
    assert.deepStrictEqual(normaliser(ch.map((c) => c.number)), [2053, 2, 1]);
  });
});

test('une fiche sans identifiant interne le dit', async () => {
  // POURQUOI : l adresse d archive n existe nulle part dans les pages du site.
  // Elle depend d un identifiant numerique que rien ne garantit. S il disparait,
  // il faut un message, pas une liste vide.
  const { ext } = chargerExtension(EXTENSION, {
    '/sans-id-v1.html': PAGE_OEUVRE.replace('data-novel-id="80"', ''),
  });
  await assert.rejects(() => ext.getChapterList('https://readnovelfull.com/sans-id-v1.html'),
    /identifiant/i);
});

test('une archive vide le dit aussi', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/ancient-godly-monarch-v1.html': PAGE_OEUVRE,
    '/ajax/chapter-archive': '<ul class="list-chapter"></ul>',
  });
  const ch = await ext.getChapterList('https://readnovelfull.com/ancient-godly-monarch-v1.html');
  assert.deepStrictEqual(normaliser(ch), []);
});

test('le texte du chapitre est isole', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/chapter-1': `
      <nav class="navbar">Home Genres Latest</nav>
      <div class="chr-nav-top"><a>Prev</a><a>Next</a></div>
      <div id="chr-content" class="chr-c" style="font-family: Arial;">
        <p>Dans la Province des Neuf Cieux, bien au-dessus des cieux.</p>
        <p>Pour les Cultivateurs Martiaux, ces astres comptent.</p>
        <div class="ads">Publicite</div>
      </div>
      <div id="chr-nav-bot">Next Chapter</div>`,
  });
  const html = await ext.getContent('https://readnovelfull.com/chapter-1');

  await t.test('le texte du recit est present', () => {
    assert.match(html, /Neuf Cieux/);
    assert.match(html, /Cultivateurs Martiaux/);
  });

  await t.test('menu, navigation et publicite sont ecartes', () => {
    assert.doesNotMatch(html, /Genres/);
    assert.doesNotMatch(html, /Next Chapter/);
    assert.doesNotMatch(html, /Publicite/);
  });
});

test('un chapitre sans conteneur est signale', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/chapter-x': '<html><body><nav>menu</nav><p>maintenance</p></body></html>',
  });
  await assert.rejects(() => ext.getContent('https://readnovelfull.com/chapter-x'),
    /chr-content|conteneur/i);
});

test('la recherche passe par le chemin du site', async (t) => {
  // POURQUOI ce test nomme le chemin en entier : « /search?keyword= » parait
  // evident et rend 404. Le formulaire du site declare
  // action="/novel-list/search". Mesure du 2026-09-08 : /search -> 404 et zero
  // fiche, /novel-list/search -> 200 et 20 fiches.
  const { ext, appels } = chargerExtension(EXTENSION, { '/novel-list/search': PAGE_LISTE });
  const r = await ext.search('sword god', 2, []);

  await t.test('le chemin complet est utilise', () => {
    assert.match(appels[0].url, /\/novel-list\/search\?/);
  });

  await t.test('le terme est encode', () => {
    assert.match(appels[0].url, /keyword=sword(\+|%20)god/);
  });

  await t.test('la page suit', () => {
    assert.match(appels[0].url, /page=2/);
  });

  await t.test('des resultats reviennent', () => {
    assert.strictEqual(r.list.length, 2);
  });
});
