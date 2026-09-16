// Comportement de novelfire, sur des reponses relevees sur le site le 2026-09-16.
//
// POURQUOI ces tests : novelfire sert DEUX formes de liste sous la meme classe
// `li.novel-item`, et elles ne se ressemblent pas.
//
//   - Le catalogue (/search-adv) met le lien DANS le titre :
//       <h4 class="novel-title"><a href="/book/x">X</a></h4>
//   - La recherche (/search) met le lien AUTOUR de toute la fiche, et le titre
//     n'a plus d'ancre du tout :
//       <a title="X" href="/book/x"> ... <h4 class="novel-title">X</h4> ... </a>
//
// L'extension ne lisait que la premiere forme, et son repli cherchait un
// conteneur `div` la ou le site rend un `li`. Les deux chemins rataient donc :
// la recherche rendait zero resultat pour n'importe quelle requete, alors que le
// catalogue marchait. Mesure du 2026-09-16 : « My House of Horrors » existe sur
// /book/my-house-of-horrors et la recherche de l'app ne le trouvait pas.
//
// Lancer : node --test tools/novelfire.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'novelfire.js');

// Forme CATALOGUE : ancre dans le titre, couverture paresseuse (data-src).
const PAGE_CATALOGUE = `
<ul class="novel-list grid col4">
  <li class="novel-item">
    <div class="cover-wrap"><a href="/book/shadow-slave"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlh" data-src="/server-1/shadow-slave.jpg"></figure></a></div>
    <div class="item-body">
      <h4 class="novel-title text1row"><a href="/book/shadow-slave">Shadow Slave</a></h4>
      <div class="novel-stats"><span><i class="icon-crown"></i> Rank 1</span></div>
    </div>
  </li>
  <li class="novel-item">
    <div class="cover-wrap"><a href="/book/reverend-insanity"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlh" data-src="/server-1/reverend-insanity.jpg"></figure></a></div>
    <div class="item-body">
      <h4 class="novel-title text1row"><a href="/book/reverend-insanity">Reverend Insanity</a></h4>
    </div>
  </li>
</ul>
<ul class="pagination"><li><a rel="next" href="/search-adv?page=2">2</a></li></ul>`;

// Forme RECHERCHE : ancre autour de la fiche, `title` AVANT `href`, titre sans
// ancre, couverture en `src` direct. Releve tel quel sur
// /search?keyword=my+house+of+horror.
const PAGE_RECHERCHE = `
<article id="latest-updates">
  <header id="header"><h1>&ldquo;my house of horror&rdquo; found on Novel Fire with 1 results...</h1></header>
  <ul class="novel-list horizontal col2 chapters">
    <li class="novel-item">
      <a title="My House of Horrors" href="/book/my-house-of-horrors">
        <div class="cover-wrap">
          <figure class="novel-cover">
            <img src="/server-1/my-house-of-horrors.jpg" alt="My House of Horrors">
          </figure>
        </div>
        <div class="item-body">
          <h4 class="novel-title text1row">My House of Horrors</h4>
          <div class="novel-stats"><strong><i class="icon-crown"></i> Rank 15</strong></div>
          <div class="novel-stats"><span><i class="icon-book-open"></i> 1215 Chapters</span></div>
        </div>
      </a>
    </li>
  </ul>
  <h2>Some Popular Novels</h2>
  <ul class="novel-list col6"><li class="novel-item"><a title="The Insane Regressor: Throne of Pride" href="/book/the-insane-regressor-throne-of-pride"><div class="cover-wrap"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlh" data-src="/server-1/the-insane-regressor-throne-of-pride.jpg" alt="The Insane Regressor: Throne of Pride"></figure></div><div class="item-body"><h4 class="novel-title text2row">The Insane Regressor: Throne of Pride</h4></div></a></li><li class="novel-item"><a title="Kill the Sun" href="/book/kill-the-sun"><div class="cover-wrap"><figure class="novel-cover"><img class="lazy" src="data:image/gif;base64,R0lGODlh" data-src="/server-1/kill-the-sun.jpg" alt="Kill the Sun"></figure></div><div class="item-body"><h4 class="novel-title text2row">Kill the Sun</h4></div></a></li>  </ul>
</article>`;

const PAGE_RECHERCHE_VIDE = `
<article id="latest-updates">
  <header id="header"><h1>&ldquo;zzzz&rdquo; found on Novel Fire with 0 results...</h1></header>
  <ul class="novel-list horizontal col2 chapters"></ul>
</article>`;

test('la recherche rend les oeuvres trouvees', async () => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    '/search?keyword=': PAGE_RECHERCHE,
  });

  const resultat = normaliser(await ext.searchNovels('my house of horror', 1));

  assert.strictEqual(resultat.list.length, 1,
    'seuls les resultats comptent : les recommandations « Some Popular Novels » ne sont pas des trouvailles');
  assert.deepStrictEqual(resultat.list[0], {
    title: 'My House of Horrors',
    url: 'https://novelfire.net/book/my-house-of-horrors',
    cover: 'https://novelfire.net/server-1/my-house-of-horrors.jpg',
  });
  assert.ok(appels.some((a) => a.url.includes('keyword=my%20house%20of%20horror')
    || a.url.includes('keyword=my+house+of+horror')), 'la requete doit partir encodee');
});

test('une recherche sans resultat rend une liste vide, pas une erreur', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/search?keyword=': PAGE_RECHERCHE_VIDE,
  });

  const resultat = normaliser(await ext.searchNovels('zzzz', 1));

  assert.deepStrictEqual(resultat.list, []);
});

test('le catalogue continue de rendre ses oeuvres', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/search-adv': PAGE_CATALOGUE,
  });

  const resultat = normaliser(await ext.popularNovels(1));

  assert.strictEqual(resultat.list.length, 2);
  assert.deepStrictEqual(resultat.list[0], {
    title: 'Shadow Slave',
    url: 'https://novelfire.net/book/shadow-slave',
    cover: 'https://novelfire.net/server-1/shadow-slave.jpg',
  });
  assert.strictEqual(resultat.hasNextPage, true);
});

// La pagination du site n'a pas de classe « next » : elle numerote ses pages.
const FICHE_OEUVRE = `
<div class="novel-title"><h1 class="novel-title text2row">My House of Horrors</h1></div>
<div class="cover"><img src="/server-1/my-house-of-horrors.jpg"></div>
<div class="author"><span class="property-item"><span>I Fix Air-conditioner</span></span></div>
<div class="summary"><div class="content">Une maison hantee qui ne fait peur a personne.</div></div>
<div class="completed"></div>
<div class="categories"><a class="property-item">Horror</a><a class="property-item">Mystery</a></div>`;

const pageChapitres = (debut, fin, dernierePage) => {
  var items = '';
  for (var n = debut; n <= fin; n++) {
    items += `<li><a href="/book/my-house-of-horrors/chapter-${n}" title="Chapter ${n}">Chapter ${n}</a></li>`;
  }
  var nav = '';
  for (var p = 1; p <= dernierePage; p++) {
    nav += `<li class="page-item"><a class="page-link" href="https://novelfire.net/book/my-house-of-horrors/chapters?page=${p}">${p}</a></li>`;
  }
  return `<ul class="chapter-list">${items}</ul>
    <div class="pagenav"><ul class="pagination">${nav}
      <li class="page-item"><a class="page-link" aria-label="Next &raquo;">&rsaquo;</a></li>
    </ul></div>`;
};

test('la liste de chapitres parcourt toutes les pages, pas seulement la premiere', async () => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    '/book/my-house-of-horrors/chapters?page=1': pageChapitres(1, 100, 3),
    '/book/my-house-of-horrors/chapters?page=2': pageChapitres(101, 200, 3),
    '/book/my-house-of-horrors/chapters?page=3': pageChapitres(201, 250, 3),
    '/book/my-house-of-horrors': FICHE_OEUVRE,
  });

  const fiche = normaliser(
    await ext.parseNovelAndChapters('https://novelfire.net/book/my-house-of-horrors'));

  assert.strictEqual(fiche.chapters.length, 250,
    'les trois pages annoncees par la pagination doivent etre lues');
  assert.strictEqual(fiche.chapters[0].chapterNumber, 1);
  assert.strictEqual(fiche.chapters[249].chapterNumber, 250);
  assert.strictEqual(fiche.title, 'My House of Horrors');
  assert.strictEqual(fiche.status, 'completed');

  const pagesLues = appels.filter((a) => a.url.includes('/chapters?page=')).length;
  assert.strictEqual(pagesLues, 3, 'ni page manquante, ni page lue en trop');
});

test('un chapitre deja vu ne compte pas deux fois', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    // Les deux pages se recouvrent sur le chapitre 100, comme le fait le site.
    '/book/my-house-of-horrors/chapters?page=1': pageChapitres(1, 100, 2),
    '/book/my-house-of-horrors/chapters?page=2': pageChapitres(100, 150, 2),
    '/book/my-house-of-horrors': FICHE_OEUVRE,
  });

  const fiche = normaliser(
    await ext.parseNovelAndChapters('https://novelfire.net/book/my-house-of-horrors'));

  assert.strictEqual(fiche.chapters.length, 150);
});
