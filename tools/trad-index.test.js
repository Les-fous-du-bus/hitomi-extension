// Comportement de trad-index, sur des reponses relevees sur le site.
//
// POURQUOI ces tests : trois choix de cette extension sont contre-intuitifs et
// meritent d'etre bloques.
//
// 1. Le titre d'une oeuvre n'est ni dans un attribut `title`, ni dans l'`alt` de
//    sa couverture (qui est vide), ni deductible du slug sans perdre accents et
//    ponctuation. Il vit dans un `<span>` du corps de la carte, entre le
//    compteur de chapitres et le nom de l'equipe de traduction.
//
// 2. La couverture passe par le mandataire d'images du site
//    (`/_next/image?url=<encode>`). On DECODE ce parametre pour aller chercher
//    l'image a sa source : sinon chaque vignette du catalogue fait travailler ce
//    mandataire, qui peut limiter la cadence.
//
// 3. La liste de chapitres est deduite du numero le plus haut. Mesure du
//    2026-09-08 sur trois oeuvres (155, 38 et 3 chapitres) : les numeros sont
//    contigus de 1 au maximum, sans un seul trou, et le maximum figure toujours
//    sur la premiere page grace au lien de navigation vers le dernier chapitre.
//    Une requete remplace donc quatre.
//
// Lancer : node --test tools/trad-index.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'trad-index.js');

const IMAGE_SOURCE = 'https://res.cloudinary.com/dq5cvfucc/image/upload/v1783778912/destiny.jpg';
const IMAGE_MANDATAIRE = '/_next/image?url=' + encodeURIComponent(IMAGE_SOURCE) + '&amp;w=828&amp;q=75';

const CARTE = (slug, titre, equipe, nbChapitres, image) => `
  <a class="group relative block aspect-[2/3] overflow-hidden rounded-book" href="/oeuvre/${slug}">
    <img alt="" decoding="async" data-nimg="fill" class="object-cover"
         src="${image || IMAGE_MANDATAIRE}"/>
    <span aria-hidden="true" class="absolute inset-0"></span>
    <span class="absolute right-2 top-2 rounded-md border px-1.5">${nbChapitres} ch.</span>
    <span class="line-clamp-3 font-display text-[13.5px] font-semibold">${titre}</span>
    <span class="truncate font-mono text-[10.5px] text-gold-500">${equipe}</span>
  </a>`;

const PAGE_CATALOGUE = `
  <div class="grid grid-cols-2 gap-3.5">
    ${CARTE('destiny-unchain-online', 'Destiny Unchain Online', 'Sanctuaire des Novels', 135)}
    ${CARTE('la-fille-a-l-epee-brisee', "La Fille à l'Épée Brisée", 'Team Aube', 12)}
  </div>
  <nav aria-label="Pagination"><a href="/catalogue?page=2">2</a><a href="/catalogue?page=24">24</a></nav>`;

const PAGE_OEUVRE = (slug, titre, numeros) => `
  <script type="application/ld+json">${JSON.stringify({
    '@type': 'Book',
    name: titre,
    inLanguage: 'fr',
    description: 'Un joueur se reveille dans le corps de son avatar.',
    author: { '@type': 'Person', name: 'Aikawa Keita' },
    genre: ['LitRPG', 'Aventure'],
  })}</script>
  <h1>${titre}</h1>
  <img alt="" src="${IMAGE_MANDATAIRE}">
  <div class="chapitres">
    ${numeros.map((n) => `<a href="/oeuvre/${slug}/chapitre/${n}">Chapitre ${n}</a>`).join('')}
  </div>`;

test('le catalogue se lit', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, { '/catalogue': PAGE_CATALOGUE });
  const r = await ext.getPopular(1);

  await t.test('les deux oeuvres remontent', () => {
    assert.strictEqual(r.list.length, 2);
  });

  await t.test('le titre vient du span, accents compris', () => {
    // Le slug rendrait « la fille a l epee brisee ».
    assert.ok(r.list.some((o) => o.title === "La Fille à l'Épée Brisée"));
  });

  await t.test('le compteur de chapitres n est pas pris pour un titre', () => {
    assert.ok(r.list.every((o) => !/^\d+\s*ch\.$/.test(o.title)));
  });

  await t.test('le nom de l equipe n est pas pris pour un titre', () => {
    assert.ok(r.list.every((o) => o.title !== 'Sanctuaire des Novels'));
  });

  await t.test('les adresses sont absolues', () => {
    assert.ok(r.list.every((o) => o.url.startsWith('https://trad-index.com/oeuvre/')));
  });

  await t.test('la page suivante vient de la pagination', () => {
    assert.strictEqual(r.hasNextPage, true);
  });

  await t.test('une seule requete', () => {
    assert.strictEqual(appels.length, 1);
  });
});

test('la couverture est ramenee a sa source', async (t) => {
  const { ext } = chargerExtension(EXTENSION, { '/catalogue': PAGE_CATALOGUE });
  const r = await ext.getPopular(1);

  await t.test('le mandataire d images est contourne', () => {
    assert.strictEqual(r.list[0].imageUrl, IMAGE_SOURCE);
  });

  await t.test('rien ne reste du chemin interne', () => {
    assert.ok(r.list.every((o) => o.imageUrl.indexOf('/_next/image') === -1));
  });
});

test('une couverture posee directement est gardee telle quelle', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/catalogue': `<div class="grid">${CARTE('directe', 'Directe', 'Team', 4,
      'https://exemple.test/couverture.jpg')}</div>`,
  });
  const r = await ext.getPopular(1);
  assert.strictEqual(r.list[0].imageUrl, 'https://exemple.test/couverture.jpg');
});

test('la derniere page ne promet pas de suite', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/catalogue': PAGE_CATALOGUE.replace(/<nav aria-label="Pagination">[\s\S]*?<\/nav>/, ''),
  });
  assert.strictEqual((await ext.getPopular(24)).hasNextPage, false);
});

test('la fiche est lue dans le JSON-LD', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/oeuvre/destiny-unchain-online': PAGE_OEUVRE(
      'destiny-unchain-online', 'Destiny Unchain Online', [1, 2, 155]),
  });
  const d = await ext.getMangaDetail('https://trad-index.com/oeuvre/destiny-unchain-online');

  await t.test('titre, synopsis, auteur, genres', () => {
    assert.strictEqual(d.title, 'Destiny Unchain Online');
    assert.match(d.description, /avatar/);
    assert.deepStrictEqual(normaliser(d.authors), ['Aikawa Keita']);
    assert.deepStrictEqual(normaliser(d.genres), ['LitRPG', 'Aventure']);
  });

  await t.test('la couverture est ramenee a sa source', () => {
    assert.strictEqual(d.imageUrl, IMAGE_SOURCE);
  });
});

test('la liste de chapitres est deduite du plus haut numero', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    '/oeuvre/destiny-unchain-online': PAGE_OEUVRE(
      'destiny-unchain-online', 'Destiny Unchain Online', [1, 2, 3, 154, 155]),
  });
  const ch = await ext.getChapterList('https://trad-index.com/oeuvre/destiny-unchain-online');

  await t.test('les 155 chapitres sont la', () => {
    assert.strictEqual(ch.length, 155);
  });

  await t.test('une seule requete, pas quatre', () => {
    assert.strictEqual(appels.length, 1);
  });

  await t.test('l ordre de lecture est decroissant', () => {
    assert.strictEqual(ch[0].number, 155);
    assert.strictEqual(ch.at(-1).number, 1);
  });

  await t.test('les adresses sont coherentes', () => {
    assert.strictEqual(ch.at(-1).url,
      'https://trad-index.com/oeuvre/destiny-unchain-online/chapitre/1');
  });
});

test('une oeuvre sans chapitre ne fabrique rien', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/oeuvre/vide': PAGE_OEUVRE('vide', 'Vide', []),
  });
  assert.deepStrictEqual(normaliser(await ext.getChapterList(
    'https://trad-index.com/oeuvre/vide')), []);
});

test('le texte du chapitre est isole', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/chapitre/56': `
      <nav>Accueil Catalogue Teams Connexion</nav>
      <h1>Chapitre 56 : Le chaton qui detestait son nom</h1>
      <div class="chapter-content">
        <p>Le soleil se levait sur la vallee endormie.</p>
        <p>Elle serra son epee brisee contre elle.</p>
      </div>
      <footer>Signaler une erreur Discord Twitter</footer>`,
  });
  const html = await ext.getContent('https://trad-index.com/oeuvre/x/chapitre/56');

  await t.test('le texte du recit est present', () => {
    assert.match(html, /vallee endormie/);
    assert.match(html, /epee brisee/);
  });

  await t.test('menu et pied de page sont ecartes', () => {
    assert.doesNotMatch(html, /Connexion/);
    assert.doesNotMatch(html, /Discord/);
  });
});

test('un chapitre sans conteneur est signale', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/chapitre/9': '<html><body><nav>menu</nav><p>maintenance</p></body></html>',
  });
  await assert.rejects(() => ext.getContent('https://trad-index.com/oeuvre/x/chapitre/9'),
    /chapter-content|conteneur/i);
});

test('la recherche passe par le catalogue', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, { '/catalogue': PAGE_CATALOGUE });
  await ext.search('epee', 2, []);

  await t.test('le terme part dans la requete', () => {
    // POURQUOI le test nomme q et rien d'autre : recherche, search et titre
    // rendent le catalogue ENTIER, non filtre — ce qui passerait pour un succes.
    // Mesure du 2026-09-08 : q=destiny rend 2 fiches, q=zzzznexistepas rend 0.
    assert.match(appels[0].url, /[?&]q=epee/);
  });

  await t.test('la page suit', () => {
    assert.match(appels[0].url, /page=2/);
  });
});
