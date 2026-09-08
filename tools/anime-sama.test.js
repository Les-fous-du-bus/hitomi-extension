// Comportement d'anime_sama sur les reponses que le site rend vraiment.
//
// POURQUOI ce fichier existe : le catalogue d'anime-sama annonce des oeuvres dans
// la categorie Scans que son arriere-plan de scans ne connait pas. Mesure du
// 2026-09-08 : `/catalogue/?type[]=Scans` liste « 07 Ghost », sa page
// `/catalogue/07-ghost/scan/vf/` rend 200 avec un `#titreOeuvre` valide, et
// l'interface de chapitres repond `{"error":"Oeuvre '07 Ghost' not found"}` avec
// un code 200.
//
// L'extension traversait ce cas en silence : `JSON.parse` reussit, la seule cle
// est "error", `parseFloat("error")` vaut NaN, la cle est ignoree, et la liste
// revient vide sans que personne sache pourquoi. Une liste vide se lit comme
// « pas encore de chapitre » alors que c'est une erreur du site.
//
// Lancer : node --test tools/anime-sama.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'manga', 'anime_sama.js');

// Page de scans reduite a ce que l'extension y cherche.
const PAGE_SCAN = (nom) =>
  `<html><body><h1 id="titreOeuvre" class="text-2xl uppercase font-bold ">${nom}</h1></body></html>`;

test('un chapitre reel est bien decoupe', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/catalogue/100-jours-avant-ta-mort/scan/vf/': PAGE_SCAN('100 Jours Avant Ta Mort'),
    'get_nb_chap_et_img.php': JSON.stringify({ 1: 19, 2: 22, '2.5': 10 }),
  });

  const chapitres = await ext.getChapterList(
    'https://anime-sama.to/catalogue/100-jours-avant-ta-mort/');

  await t.test('tous les chapitres remontent', () => {
    assert.strictEqual(chapitres.length, 3);
  });

  await t.test('l ordre de lecture est decroissant', () => {
    assert.deepStrictEqual(normaliser(chapitres.map((c) => c.number)), [2.5, 2, 1]);
  });

  await t.test('un numero decimal survit', () => {
    // Un chapitre 2.5 est courant (bonus, hors-serie). Arrondir le perdrait.
    assert.ok(chapitres.some((c) => c.title === 'Chapitre 2.5'));
  });

  await t.test('le nombre de pages voyage avec le chapitre', () => {
    const premier = chapitres.find((c) => c.number === 1);
    assert.match(premier.url, /n=19/);
  });
});

test('une erreur du site ne se deguise pas en liste vide', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/catalogue/07-ghost/scan/vf/': PAGE_SCAN('07 Ghost'),
    // Le site rend 200 avec ce corps : c'est la forme exacte relevee.
    'get_nb_chap_et_img.php': JSON.stringify({ error: "Oeuvre '07 Ghost' not found" }),
  });

  await t.test('la liste de chapitres signale le probleme', async () => {
    await assert.rejects(
      () => ext.getChapterList('https://anime-sama.to/catalogue/07-ghost/'),
      /07 Ghost/,
      "le message doit nommer l'oeuvre, sinon on cherche a l'aveugle");
  });

  await t.test('la lecture d une page signale le meme probleme', async () => {
    await assert.rejects(
      () => ext.getPageList('https://anime-sama.to/catalogue/07-ghost/scan/vf/#ch=1'),
      /07 Ghost/);
  });
});

test('les autres formes de reponse cassee sont distinguees', async (t) => {
  await t.test('une page de scans sans titre est signalee', async () => {
    const { ext } = chargerExtension(EXTENSION, {
      '/scan/vf/': '<html><body>page de maintenance</body></html>',
    });
    await assert.rejects(
      () => ext.getChapterList('https://anime-sama.to/catalogue/quelque-chose/'),
      /titreOeuvre/);
  });

  await t.test('une reponse qui n est pas du JSON est signalee', async () => {
    const { ext } = chargerExtension(EXTENSION, {
      '/scan/vf/': PAGE_SCAN('Une Oeuvre'),
      'get_nb_chap_et_img.php': '<html>erreur 500 du serveur</html>',
    });
    await assert.rejects(
      () => ext.getChapterList('https://anime-sama.to/catalogue/une-oeuvre/'),
      /JSON|illisible/i);
  });

  await t.test('un JSON valide mais vide reste une liste vide, pas une erreur', async () => {
    // Une oeuvre annoncee sans chapitre encore publie est un etat legitime :
    // c'est le seul cas ou la liste vide dit la verite.
    const { ext } = chargerExtension(EXTENSION, {
      '/scan/vf/': PAGE_SCAN('Toute Neuve'),
      'get_nb_chap_et_img.php': '{}',
    });
    const chapitres = await ext.getChapterList('https://anime-sama.to/catalogue/toute-neuve/');
    assert.deepStrictEqual(normaliser(chapitres), []);
  });

  await t.test('un chapitre annonce a zero page est ecarte', async () => {
    const { ext } = chargerExtension(EXTENSION, {
      '/scan/vf/': PAGE_SCAN('Une Oeuvre'),
      'get_nb_chap_et_img.php': JSON.stringify({ 1: 20, 2: 0, 3: 18 }),
    });
    const chapitres = await ext.getChapterList('https://anime-sama.to/catalogue/une-oeuvre/');
    assert.deepStrictEqual(normaliser(chapitres.map((c) => c.number)), [3, 1]);
  });
});

test('le catalogue se lit malgre les adresses absolues', async (t) => {
  // Le site est passe aux adresses absolues avec et sans barre finale. La
  // lecture ne doit dependre ni de l'une ni de l'autre.
  const { ext } = chargerExtension(EXTENSION, {
    '/catalogue/?': `
      <div id="list_catalog">
        <div class="catalog-card">
          <a href="https://anime-sama.to/catalogue/07-ghost">
            <img class="card-image" src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/07-ghost.webp">
            <h2 class="card-title">07 Ghost</h2>
          </a>
        </div>
        <div class="catalog-card">
          <a href="https://anime-sama.to/catalogue/100-jours-avant-ta-mort/">
            <img class="card-image" src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/100-jours.webp">
            <h2 class="card-title">100 Jours Avant Ta Mort</h2>
          </a>
        </div>
        <div class="catalog-card">
          <a href="https://anime-sama.to/catalogue/07-ghost/scan/vf/">lien profond a ignorer</a>
        </div>
      </div>`,
  });

  const resultat = await ext.getPopular(1);

  await t.test('les deux fiches sont trouvees', () => {
    assert.strictEqual(resultat.list.length, 2);
  });

  await t.test('les liens profonds ne creent pas de doublon', () => {
    const adresses = resultat.list.map((o) => o.url);
    assert.strictEqual(new Set(adresses).size, 2);
    assert.ok(adresses.every((u) => /\/catalogue\/[^/]+\/$/.test(u)),
      'chaque adresse doit finir sur la fiche, pas sur une sous-page');
  });

  await t.test('les titres viennent du bon element', () => {
    assert.deepStrictEqual(normaliser(resultat.list.map((o) => o.title)).sort(),
      ['07 Ghost', '100 Jours Avant Ta Mort']);
  });

  await t.test('les couvertures sont recuperees', () => {
    assert.ok(resultat.list.every((o) => o.imageUrl.startsWith('https://')));
  });
});
