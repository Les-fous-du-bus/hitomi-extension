// Comportement de lightnovelvf, sur des reponses relevees sur le site.
//
// POURQUOI ces tests : deux choix de conception de cette extension meritent
// d'etre bloques par un test, parce qu'ils sont contre-intuitifs.
//
// 1. La liste de chapitres est DEDUITE du numero le plus haut, pas collectee
//    page par page. Mesure du 2026-09-08 : le site pagine les chapitres par 30
//    (`?page=N`), et « Ancient Godly Monarch » en compte 2053, soit 69 requetes
//    pour une seule liste. Les numeros sont des entiers strictement contigus de
//    1 au maximum (verifie sur deux oeuvres, pages 1, 2, 69 et 70), et la liste
//    du site ne porte AUCUN titre de chapitre — seulement le numero et la date.
//    Deduire ne perd donc aucune information et coute une requete au lieu de 69.
//    Si un jour le site introduit un chapitre 10.5, ce test doit etre revu.
//
// 2. La fiche est lue dans le JSON-LD schema.org, pas dans la mise en page. Le
//    site en pose un bloc `@type: Book` complet (titre, synopsis, auteur,
//    genres, couverture). Une refonte visuelle ne le casse pas.
//
// Lancer : node --test tools/lightnovelvf.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'lightnovelvf.js');

const CARTE = (slug, titre) => `
  <a href="/novel/${slug}" class="group relative block" aria-label="${titre}">
    <img width="200" height="300" alt="${titre}" class="lazyload"
         src="https://www.lightnovelvf.com/uploads/novel/${slug}/cover/${slug}.jpg">
  </a>`;

const PAGE_LISTE = `
  <div class="grid grid-cols-2">
    ${CARTE('ancient-godly-monarch', 'Ancient Godly Monarch')}
    ${CARTE('vrmmo-chaos-doctor', '[VRMMO] Chaos Doctor')}
  </div>
  <nav><ul>
    <li><span class="lnv-page lnv-page-active">1</span></li>
    <li><a href="https://www.lightnovelvf.com/novels-list?page=2" class="lnv-page">2</a></li>
  </ul></nav>`;

const LIEN_CHAPITRE = (slug, n) => `
  <li><a class="chapter_link flex items-center" data-num="${n}"
         href="https://www.lightnovelvf.com/novel/${slug}/${n}" rel="nofollow">
    <div class="w-10 h-10">${n}</div>
    <div class="text-[9px]">25 aout 2025</div>
  </a></li>`;

function pageOeuvre(slug, titre, numeros) {
  return `
  <script type="application/ld+json">${JSON.stringify({
    '@graph': [{
      '@type': 'Book',
      name: titre,
      inLanguage: 'fr-FR',
      description: "Dans l'immensite de la Province des Neuf Cieux.",
      author: [{ '@type': 'Person', name: '净无痕' }],
      genre: ['Action', 'Adventure', 'Xuanhuan'],
    }],
  })}</script>
  <meta property="og:image" content="https://www.lightnovelvf.com/uploads/novel/${slug}/cover/${slug}.jpg">
  <h1>${titre}</h1>
  <p>2,053 chapitres 6,754 vues Termine</p>
  <ul id="chapters-list">${numeros.map((n) => LIEN_CHAPITRE(slug, n)).join('')}</ul>`;
}

test('le catalogue se lit', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, { '/novels-list': PAGE_LISTE });
  const r = await ext.getPopular(1);

  await t.test('les deux oeuvres remontent', () => {
    assert.strictEqual(r.list.length, 2);
  });

  await t.test('le titre vient de aria-label, pas du slug', () => {
    // Le slug perdrait les crochets de « [VRMMO] Chaos Doctor ».
    assert.ok(r.list.some((o) => o.title === '[VRMMO] Chaos Doctor'));
  });

  await t.test('les adresses sont absolues', () => {
    assert.ok(r.list.every((o) => o.url.startsWith('https://www.lightnovelvf.com/novel/')));
  });

  await t.test('la couverture est renseignee', () => {
    assert.ok(r.list.every((o) => o.imageUrl.startsWith('https://')));
  });

  await t.test('la page suivante est detectee par la pagination du site', () => {
    assert.strictEqual(r.hasNextPage, true);
  });

  await t.test('une seule requete a suffi', () => {
    assert.strictEqual(appels.length, 1);
  });
});

test('la derniere page ne promet pas de suite', async () => {
  const sansSuivant = PAGE_LISTE.replace(
    /<li><a href="https:\/\/www\.lightnovelvf\.com\/novels-list\?page=2"[^]]*?<\/a><\/li>/s, '');
  const { ext } = chargerExtension(EXTENSION, { '/novels-list': sansSuivant });
  const r = await ext.getPopular(9);
  assert.strictEqual(r.hasNextPage, false);
});

test('une carte volumineuse est lue quand meme', async (t) => {
  // POURQUOI ce test : la premiere version bornait l'interieur d'une carte a 600
  // caracteres. Les cartes reelles du site en font plus de 600 — mesure du
  // 2026-09-08 : il faut depasser 3000 pour les attraper toutes — et la liste
  // revenait vide contre le site alors que tous les tests passaient, parce que
  // les cartes de ces tests etaient plus petites que la vraie. Un plafond en dur
  // sur du HTML d'autrui est un piege ; ce test le maintient ferme.
  const bourrage = ' '.repeat(400) +
    '<div class="image-overlay"></div><div class="image-shine"></div>' +
    '<span class="badge">Nouveau</span>' + ' '.repeat(1800);

  const grandeCarte = `
    <a href="/novel/reincarnation-of-the-strongest-sword-god"
       class="group relative block rounded-xl overflow-hidden aspect-[2/3] border border-white/[0.06] hover:border-brand/40 transition-colors no-underline"
       aria-label="Reincarnation of the Strongest Sword God">
      <div class="card-image-container">${bourrage}
        <img width="200" height="300" alt="Reincarnation of the Strongest Sword God"
             class="lazyload absolute inset-0"
             data-src="https://www.lightnovelvf.com/uploads/novel/rossg/cover/rossg.jpg">
      </div>
    </a>`;

  const { ext } = chargerExtension(EXTENSION, {
    '/novels-list': `<div class="grid">${grandeCarte}${CARTE('petite', 'Petite')}</div>`,
  });
  const r = await ext.getPopular(1);

  await t.test('les deux cartes remontent, grande comme petite', () => {
    assert.strictEqual(r.list.length, 2);
  });

  await t.test('la couverture de la grande carte est trouvee', () => {
    const grande = r.list.find((o) => o.title.startsWith('Reincarnation'));
    assert.match(grande.imageUrl, /rossg\.jpg$/);
  });
});

test('un lien vers une oeuvre sans aria-label n est pas une carte', async () => {
  // Les encarts « vous pourriez aimer » et le fil d'Ariane pointent vers des
  // oeuvres sans porter d'etiquette. Les compter gonflerait la liste de doublons
  // sans titre.
  const { ext } = chargerExtension(EXTENSION, {
    '/novels-list': `
      <div class="grid">${CARTE('vraie-carte', 'Vraie Carte')}</div>
      <aside><h3>Vous pourriez aimer</h3>
        <a href="/novel/suggestion-sans-etiquette">Suggestion</a>
      </aside>`,
  });
  const r = await ext.getPopular(1);
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].title, 'Vraie Carte');
});

test('les couvertures sont rendues joignables', async (t) => {
  // POURQUOI ce test : le site charge ses couvertures paresseusement. L'attribut
  // `src` porte un pixel transparent en base64 et la vraie adresse est dans
  // `data-src`, RELATIVE (« /uploads/novel/... »). Mesure du 2026-09-08 contre
  // le site : 30 adresses rendues, 30 relatives, zero joignable — l'ecran de
  // decouverte se serait affiche sans une seule couverture.
  const carteParesseuse = `
    <a href="/novel/vrmmo-chaos-doctor" class="group" aria-label="[VRMMO] Chaos Doctor">
      <img width="200" height="300" alt="[VRMMO] Chaos Doctor" class="lazyload"
           src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
           data-src="/uploads/novel/vrmmo-chaos-doctor/cover/vrmmo-chaos-doctor.jpg">
    </a>`;

  const { ext } = chargerExtension(EXTENSION, {
    '/novels-list': `<div class="grid">${carteParesseuse}</div>`,
  });
  const r = await ext.getPopular(1);

  await t.test('l adresse est absolue', () => {
    assert.strictEqual(r.list[0].imageUrl,
      'https://www.lightnovelvf.com/uploads/novel/vrmmo-chaos-doctor/cover/vrmmo-chaos-doctor.jpg');
  });

  await t.test('le pixel de remplacement n est jamais rendu', () => {
    assert.ok(!r.list[0].imageUrl.startsWith('data:'));
  });
});

test('une carte sans data-src retombe sur src, sauf si c est un pixel', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novels-list': `<div class="grid">
      <a href="/novel/avec-src" class="g" aria-label="Avec src">
        <img src="/uploads/novel/avec-src/cover.jpg"></a>
      <a href="/novel/pixel-seul" class="g" aria-label="Pixel seul">
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="></a>
    </div>`,
  });
  const r = await ext.getPopular(1);

  await t.test('src relatif devient absolu', () => {
    const o = r.list.find((x) => x.title === 'Avec src');
    assert.strictEqual(o.imageUrl, 'https://www.lightnovelvf.com/uploads/novel/avec-src/cover.jpg');
  });

  await t.test('une carte sans vraie couverture rend une chaine vide', () => {
    const o = r.list.find((x) => x.title === 'Pixel seul');
    assert.strictEqual(o.imageUrl, '');
  });
});

test('la fiche est lue dans le JSON-LD', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novel/ancient-godly-monarch': pageOeuvre(
      'ancient-godly-monarch', 'Ancient Godly Monarch', [2053, 2052, 2051]),
  });
  const d = await ext.getMangaDetail('https://www.lightnovelvf.com/novel/ancient-godly-monarch');

  await t.test('titre, synopsis, auteur et genres', () => {
    assert.strictEqual(d.title, 'Ancient Godly Monarch');
    assert.match(d.description, /Neuf Cieux/);
    assert.deepStrictEqual(normaliser(d.authors), ['净无痕']);
    assert.deepStrictEqual(normaliser(d.genres), ['Action', 'Adventure', 'Xuanhuan']);
  });

  await t.test('la couverture vient de og:image', () => {
    assert.match(d.imageUrl, /ancient-godly-monarch\.jpg$/);
  });

  await t.test('le statut est lu en francais', () => {
    assert.strictEqual(d.status, 'completed');
  });
});

test('la liste de chapitres est deduite du plus haut numero', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    '/novel/ancient-godly-monarch': pageOeuvre(
      'ancient-godly-monarch', 'Ancient Godly Monarch', [2053, 2052, 2051]),
  });
  const ch = await ext.getChapterList('https://www.lightnovelvf.com/novel/ancient-godly-monarch');

  await t.test('les 2053 chapitres sont la', () => {
    assert.strictEqual(ch.length, 2053);
  });

  await t.test('une seule requete, pas soixante-neuf', () => {
    assert.strictEqual(appels.length, 1);
  });

  await t.test('l ordre de lecture est decroissant', () => {
    assert.strictEqual(ch[0].number, 2053);
    assert.strictEqual(ch.at(-1).number, 1);
  });

  await t.test('chaque chapitre a une adresse coherente', () => {
    assert.strictEqual(ch.at(-1).url, 'https://www.lightnovelvf.com/novel/ancient-godly-monarch/1');
    assert.strictEqual(ch[0].url, 'https://www.lightnovelvf.com/novel/ancient-godly-monarch/2053');
  });

  await t.test('le nom du chapitre porte son numero', () => {
    assert.strictEqual(ch.at(-1).title, 'Chapitre 1');
  });
});

test('une oeuvre sans chapitre ne fabrique rien', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novel/toute-neuve': pageOeuvre('toute-neuve', 'Toute Neuve', []),
  });
  const ch = await ext.getChapterList('https://www.lightnovelvf.com/novel/toute-neuve');
  assert.deepStrictEqual(normaliser(ch), []);
});

test('le texte du chapitre est isole du reste de la page', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novel/ancient-godly-monarch/1': `
      <nav>Accueil Catalogue Pantheon Bibliotheque</nav>
      <h1>Chapitre 1 — Cultivation avec des Meridiens Brises</h1>
      <div id="read-novel" class="lnv-reader-content">
        <p>Au sein de la Province des Neuf Cieux, bien au-dessus des cieux.</p>
        <p>Pour les Cultivateurs Martiaux, ces astres ne sont pas de simples points.</p>
      </div>
      <div class="lnv-chap-nav">Chapitre suivant</div>
      <section>Aucun commentaire pour le moment. Soyez le premier !</section>`,
  });
  const html = await ext.getContent('https://www.lightnovelvf.com/novel/ancient-godly-monarch/1');

  await t.test('le texte du recit est present', () => {
    assert.match(html, /Province des Neuf Cieux/);
    assert.match(html, /Cultivateurs Martiaux/);
  });

  await t.test('le menu et les commentaires sont ecartes', () => {
    assert.doesNotMatch(html, /Bibliotheque/);
    assert.doesNotMatch(html, /Aucun commentaire/);
    assert.doesNotMatch(html, /Chapitre suivant/);
  });
});

test('un chapitre sans conteneur de lecture est signale', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novel/x/1': '<html><body><nav>menu</nav><p>page de maintenance</p></body></html>',
  });
  await assert.rejects(() => ext.getContent('https://www.lightnovelvf.com/novel/x/1'),
    /read-novel|conteneur/i);
});

test('la recherche passe par le parametre du site', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, { '/novels-list': PAGE_LISTE });
  await ext.search('sword', 1, []);

  await t.test('le terme est envoye dans search', () => {
    assert.match(appels[0].url, /[?&]search=sword/);
  });

  await t.test('la page est envoyee aussi', () => {
    assert.match(appels[0].url, /[?&]page=1/);
  });
});
