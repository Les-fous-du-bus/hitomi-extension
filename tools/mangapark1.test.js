// Comportement de mangapark1 quand une page de chapitre ne rend aucune image.
//
// POURQUOI ces tests : le site ANNONCE dans sa liste des chapitres qu'il
// n'heberge pas. Mesure du 2026-09-08 sur « Yuan Du Fu Shu » :
//
//   chapitre 61 -> 79002 octets, 60 adresses sur cdn2.holdingyouclose.xyz
//   chapitre 60 -> 76505 octets, 115 images
//   chapitre 58 -> 76505 octets, 115 images
//   chapitre 55 -> 78047 octets, 121 images
//   chapitre 51 -> 48161 octets, UNE adresse (la banniere du site)
//   chapitre 47 -> 75477 octets, 111 images
//   chapitre 42 -> 48161 octets, UNE adresse (la banniere du site)
//
// Ce ne sont donc pas les vieux chapitres qui manquent — 47 est plus ancien que
// 51 et fonctionne. Ce sont des trous isoles, et le harnais est tombe dessus sur
// deux de ses trois sondages, d'ou le verdict PARTIEL.
//
// Le message d'erreur d'origine accusait Cloudflare ou un changement de CDN. Les
// deux sont faux ici : aucune des pages ne porte de marqueur Cloudflare, et le
// CDN n'a pas bouge. Un message qui envoie chercher au mauvais endroit coute
// plus cher que pas de message.
//
// Lancer : node --test tools/mangapark1.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'manga', 'mangapark1.js');
const CDN = 'https://cdn2.holdingyouclose.xyz';

// La banniere du site est servie en data-src elle aussi : c'est ce qui empeche
// de conclure sur la seule presence d'un data-src.
const BANNIERE = `<img data-number='notice' data-src='/assets/banner/short_300.webp'>`;

const pageLecture = (slug, chap, nbPages) => {
  var pages = '';
  for (var i = 1; i <= nbPages; i++) {
    pages += `<img data-number='${i}' data-src='${CDN}/${slug}/${chap}/${i}.webp' ` +
             `data-fallback='${CDN}/${slug}/${chap}/${i}.webp'>`;
  }
  return `<html><body>${BANNIERE}<div class="pages">${pages}</div></body></html>`;
};

// Le gabarit servi pour un chapitre absent : l'echafaudage du lecteur est la
// (data-number apparait 64 fois) mais aucune adresse d'image.
const pageSansImage = `<html><body>${BANNIERE}
  <div class="pages">${'<div data-number="1"></div>'.repeat(64)}</div>
  <footer>Types Manga One-Shot Doujinshi Novel Manhwa</footer></body></html>`;

test('un chapitre heberge rend ses pages', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/read/yuan-du-fu-shu/chapter-61': pageLecture('yuan-du-fu-shu', 61, 60),
  });
  const pages = await ext.getPageList('https://mangapark1.com/read/yuan-du-fu-shu/chapter-61');

  await t.test('les soixante pages remontent', () => {
    assert.strictEqual(pages.length, 60);
  });

  await t.test('la banniere du site n est pas comptee comme une page', () => {
    assert.ok(pages.every((p) => p.imageUrl.indexOf('/assets/banner/') === -1));
  });

  await t.test('les pages sont numerotees a partir de zero', () => {
    assert.strictEqual(pages[0].index, 0);
    assert.strictEqual(pages.at(-1).index, 59);
  });
});

test('un chapitre absent du site est nomme comme tel', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/read/yuan-du-fu-shu/chapter-51': pageSansImage,
  });

  let erreur = null;
  try {
    await ext.getPageList('https://mangapark1.com/read/yuan-du-fu-shu/chapter-51');
  } catch (e) {
    erreur = e;
  }

  await t.test('l appel echoue', () => {
    assert.ok(erreur, 'rendre une liste vide afficherait une page blanche sans raison');
  });

  await t.test('le message dit que la source n a pas ce chapitre', () => {
    assert.match(erreur.message, /n\s*h[eé]berge\s+pas|pas\s+(disponible|h[eé]berg)/i);
  });

  await t.test('le message n accuse PAS Cloudflare', () => {
    // C'etait le defaut du message d'origine : il envoyait chercher un blocage
    // Cloudflare inexistant, et un changement de CDN qui n'a pas eu lieu.
    assert.doesNotMatch(erreur.message, /cloudflare/i);
  });

  await t.test('le message nomme le chapitre', () => {
    assert.match(erreur.message, /chapter-51/);
  });
});

test('un vrai blocage Cloudflare est distingue', async (t) => {
  const { ext } = chargerExtension(EXTENSION, {
    '/read/x/chapter-1': '<html><head><title>Just a moment...</title></head>' +
      '<body><div id="cf-browser-verification"></div></body></html>',
  });

  let erreur = null;
  try {
    await ext.getPageList('https://mangapark1.com/read/x/chapter-1');
  } catch (e) {
    erreur = e;
  }

  await t.test('l appel echoue', () => {
    assert.ok(erreur);
  });

  await t.test('le message nomme Cloudflare', () => {
    assert.match(erreur.message, /cloudflare/i);
  });
});

test('un changement de CDN nomme le nouvel hote', async (t) => {
  // Le cas le plus utile a diagnostiquer : les images sont la, sur un autre
  // hote. Nommer cet hote evite de le chercher a la main.
  const { ext } = chargerExtension(EXTENSION, {
    '/read/x/chapter-2': `<html><body>${BANNIERE}
      <img data-number='1' data-src='https://nouveau-cdn.exemple/x/2/1.webp'>
      <img data-number='2' data-src='https://nouveau-cdn.exemple/x/2/2.webp'>
      </body></html>`,
  });
  const pages = await ext.getPageList('https://mangapark1.com/read/x/chapter-2');

  await t.test('le repli generique recupere quand meme les pages', () => {
    // Un CDN qui change ne doit pas casser la lecture : le repli existant sert
    // exactement a ca. Le diagnostic ne se declenche donc que sur zero image.
    assert.strictEqual(pages.length, 2);
    assert.match(pages[0].imageUrl, /nouveau-cdn/);
  });
});
