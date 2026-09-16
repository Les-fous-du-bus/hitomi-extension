// Comportement de la recherche NovelFrance (massnovel).
//
// POURQUOI ces tests : l'extension ne cherchait pas. Elle demandait UNE page de
// /api/novels?sort=popular (vingt titres) et filtrait ces vingt titres cote
// client. Une oeuvre absente du haut du classement etait donc introuvable, quoi
// qu'on tape. Mesure du 2026-09-16 : « My House of Horrors » existe bien sur
// novelfrance.fr (/api/novels/my-house-of-horrors, statut COMPLETED) et la
// recherche de l'app rendait zero.
//
// Le commentaire du code disait vrai sur un point : l'API n'a pas de recherche
// cote serveur. Verifie le 2026-09-16 — search=, q=, s=, title=, keyword= sont
// tous ignores et rendent la meme premiere page. Mais elle accepte limit=100
// (plafonne a 100), donc le catalogue entier tient en SEPT requetes au lieu de
// trente-deux : 637 titres. On le parcourt une fois, on le garde en memoire
// pour la session, et on filtre dessus.
//
// Lancer : node --test tools/massnovel.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'massnovel.js');

const pageApi = (titres, page, totalPages) => JSON.stringify({
  novels: titres.map((t) => ({
    title: t,
    slug: t.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    coverImage: '/covers/' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.jpg',
  })),
  total: 5,
  totalPages,
  page,
});

const CATALOGUE = {
  '/api/novels?limit=100&page=1': pageApi(['Shadow Slave', 'Le manoir'], 1, 3),
  '/api/novels?limit=100&page=2': pageApi(['Mille visages, un secret'], 2, 3),
  '/api/novels?limit=100&page=3': pageApi(['My House of Horrors', 'Horror Game Designer'], 3, 3),
};

test('la recherche trouve une oeuvre absente du haut du classement', async () => {
  const { ext } = chargerExtension(EXTENSION, CATALOGUE);

  const resultat = normaliser(await ext.search('my house of horror', 1, []));

  assert.strictEqual(resultat.list.length, 1);
  assert.strictEqual(resultat.list[0].title, 'My House of Horrors');
  assert.strictEqual(resultat.list[0].url,
    'https://novelfrance.fr/novel/my-house-of-horrors');
});

test('la recherche est insensible a la casse et rend toutes les correspondances', async () => {
  const { ext } = chargerExtension(EXTENSION, CATALOGUE);

  const resultat = normaliser(await ext.search('HORROR', 1, []));

  assert.deepStrictEqual(
    resultat.list.map((o) => o.title).sort(),
    ['Horror Game Designer', 'My House of Horrors']);
});

test('le catalogue n est parcouru qu une fois par session', async () => {
  const { ext, appels } = chargerExtension(EXTENSION, CATALOGUE);

  await ext.search('horror', 1, []);
  const apresPremiere = appels.length;
  await ext.search('manoir', 1, []);

  assert.strictEqual(apresPremiere, 3, 'les trois pages annoncees, pas une de plus');
  assert.strictEqual(appels.length, apresPremiere,
    'la seconde recherche relit la memoire, elle ne redemande pas le catalogue');
});

test('une recherche sans correspondance rend une liste vide', async () => {
  const { ext } = chargerExtension(EXTENSION, CATALOGUE);

  const resultat = normaliser(await ext.search('zzzzz', 1, []));

  assert.deepStrictEqual(resultat.list, []);
  assert.strictEqual(resultat.hasNextPage, false);
});

test('une requete vide rend le classement populaire, comme avant', async () => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    '/api/novels?page=1&sort=popular': pageApi(['Shadow Slave', 'Le manoir'], 1, 2),
  });

  const resultat = normaliser(await ext.search('', 1, []));

  assert.strictEqual(resultat.list.length, 2);
  assert.ok(appels.every((a) => a.url.includes('sort=popular')),
    'sans requete, on ne parcourt pas tout le catalogue');
});

// Le payload du site echappe ses caracteres en \uXXXX : <strong> y est ecrit
// \u003cstrong\u003e. L'unescape maison rendait la barre oblique inverse a
// l'oubli et gardait « u003c » tel quel, donc le lecteur affichait
// « u003cstrongu003eTraducteur : u003c/strongu003eLonelytree » au lieu du texte
// en gras. Mesure du 2026-09-16 sur My House of Horrors, chapitre 1.
//
// La reparation est de NE PAS toucher a \uXXXX : c'est une sequence JSON
// valide, et JSON.parse la decode correctement tout seul.
const PAGE_CHAPITRE = `<script>self.__next_f.push([1,"{\\"initialChapter\\":{\\"chapterNumber\\":1,\\"title\\":\\"Chapitre 1\\",\\"paragraphs\\":[{\\"index\\":0,\\"content\\":\\"\\u003cstrong\\u003eTraducteur : \\u003c/strong\\u003eLonelytree\\",\\"wordCount\\":6},{\\"index\\":1,\\"content\\":\\"La maison hantee n'effrayait personne.\\",\\"wordCount\\":5}]}}"])</script>`;

test('les caracteres echappes en \\uXXXX sont rendus, pas recopies', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/novel/my-house-of-horrors/chapter-1': PAGE_CHAPITRE,
  });

  const contenu = await ext.getContent(
    'https://novelfrance.fr/novel/my-house-of-horrors/chapter-1');

  assert.ok(!contenu.includes('u003c'),
    'aucun « u003c » ne doit rester dans le texte montre au lecteur');
  assert.ok(contenu.includes('<strong>Traducteur : </strong>'),
    'la balise doit etre une vraie balise');
  assert.ok(contenu.includes("La maison hantee n'effrayait personne."));
});
