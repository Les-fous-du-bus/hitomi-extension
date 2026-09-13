// Regressions observees sur les chapitres longs de Hand Jumper.
//
// Le 2026-09-13, /auth/chapter-content renvoie encore les images sous la forme
// http://mangataro.yachts/... alors que le manifeste Android de Hitomi interdit
// le trafic non chiffre. Le CDN redirige ces memes adresses vers HTTPS :
// l'extension doit donc normaliser avant de remettre les pages a l'application.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension, normaliser } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'manga', 'roliascan.js');

test('les images HTTP de mangataro sont remises a Hitomi en HTTPS', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/auth/chapter-content?chapter_id=23087': JSON.stringify({
      success: true,
      images: [
        'http://mangataro.yachts/storage/chapters/abc/001.webp',
        'https://mangataro.yachts/storage/chapters/abc/002.webp',
      ],
    }),
  });

  const pages = await ext.getPageList(
    'https://roliascan.com/read/hand-jumper/ch97-23087/',
  );

  assert.deepStrictEqual(
    normaliser(pages.map((page) => page.imageUrl)),
    [
      'https://mangataro.yachts/storage/chapters/abc/001.webp',
      'https://mangataro.yachts/storage/chapters/abc/002.webp',
    ],
  );
});

test('une entree image invalide est ignoree sans produire une URL dangereuse', async () => {
  const { ext } = chargerExtension(EXTENSION, {
    '/auth/chapter-content?chapter_id=23088': JSON.stringify({
      success: true,
      images: [null, '', 'javascript:alert(1)', 'https://cdn.test/ok.webp'],
    }),
  });

  const pages = await ext.getPageList(
    'https://roliascan.com/read/hand-jumper/ch98-23088/',
  );

  assert.deepStrictEqual(normaliser(pages), [
    { index: 0, imageUrl: 'https://cdn.test/ok.webp' },
  ]);
});
