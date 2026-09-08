// Comportement de worldnovel face a un texte qui n'est pas dans la page servie.
//
// LE CONTEXTE, MESURE : le texte des chapitres de world-novel.fr ne voyage pas
// dans la page. Le site le charge depuis Firestore (projet
// `victorian-novel-house`), qui refuse toute lecture non signee, avec Firebase
// App Check atteste par reCAPTCHA par-dessus. La session Firebase n'est PAS un
// cookie : c'est un jeton du stockage du navigateur, envoye en en-tete par le
// JavaScript du site. Ni Dio ni un fetch() depuis Dart ne peuvent le rejouer.
//
// D'ou le canal `fetchRendered` : on laisse le site travailler avec la session
// de l'utilisateur, puis on lit le DOM obtenu.
//
// L'ORDRE COMPTE. `fetchRendered` occupe une instance de navigateur (environ 50
// a 100 Mo, trois au maximum). On tente donc d'abord la page servie, qui ne
// coute rien, et on ne paie le navigateur que si elle ne porte pas le texte.
//
// Lancer : node --test tools/worldnovel.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { chargerExtension } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'worldnovel.js');
const ADRESSE = 'https://world-novel.fr/lecture/une-oeuvre/chapitres/Chapitre%201';

// Une phrase quelconque, repetee : seule sa LONGUEUR compte pour ces tests.
const phrase = 'La lampe eclairait le seuil et rien ne bougeait encore. ';
const paragraphe = (n) => `<p>${phrase.repeat(n)}</p>`;

// Page servie sans le texte : c'est l'etat mesure sans session.
const PAGE_SANS_TEXTE =
  '<html><body><script>self.__next_f.push([1,"{\\"titre\\":\\"Chapitre 1\\"}"])' +
  '</script><div id="app"></div></body></html>';

// DOM obtenu apres execution du JavaScript avec une session : le site a rendu
// ses paragraphes.
const DOM_AVEC_TEXTE =
  `<html><body><article>${paragraphe(6)}${paragraphe(6)}${paragraphe(6)}` +
  `${paragraphe(6)}</article></body></html>`;

test('la page servie est essayee avant le navigateur', async (t) => {
  // Si une session signee faisait apparaitre le texte dans la page servie,
  // payer un navigateur serait du gaspillage.
  const paquet = JSON.stringify({ content: phrase.repeat(20) });
  const { ext, appels } = chargerExtension(EXTENSION, {
    'fetchv2:/lecture/': `<html><body><script>self.__next_f.push([1,${JSON.stringify(paquet)}])</script></body></html>`,
  });

  const html = await ext.parseChapter(ADRESSE);

  await t.test('le texte revient', () => {
    assert.ok(html.includes('La lampe eclairait'));
  });

  await t.test('aucun navigateur n a ete demande', () => {
    assert.ok(!appels.some((a) => a.canal === 'fetchRendered'),
      'la page servie suffisait, le navigateur ne devait pas etre ouvert');
  });
});

test('le navigateur prend le relais quand la page servie est muette', async (t) => {
  const { ext, appels } = chargerExtension(EXTENSION, {
    'fetchv2:/lecture/': PAGE_SANS_TEXTE,
    'fetchRendered:/lecture/': DOM_AVEC_TEXTE,
  });

  const html = await ext.parseChapter(ADRESSE);

  await t.test('la page servie a bien ete essayee en premier', () => {
    assert.strictEqual(appels[0].canal, 'fetchv2');
  });

  await t.test('le navigateur a ete sollicite ensuite', () => {
    assert.ok(appels.some((a) => a.canal === 'fetchRendered'));
  });

  await t.test('le texte du chapitre revient', () => {
    assert.ok(html.includes('La lampe eclairait'));
    assert.ok(html.length > 600);
  });
});

test('un DOM sans chapitre ne devient pas un faux chapitre', async (t) => {
  // POURQUOI ce test : la lecon des extensions reparees le 2026-09-04. Prendre
  // « le plus long texte de la page » attrape le SYNOPSIS de l'oeuvre et le
  // presente comme un chapitre. Un texte faux affiche comme vrai est pire qu'un
  // message d'attente. Un chapitre compte des dizaines de paragraphes ; un
  // synopsis en compte un ou deux, meme s'il est long.
  const domSynopsisSeul =
    `<html><body><section class="resume">${paragraphe(30)}</section></body></html>`;

  const { ext } = chargerExtension(EXTENSION, {
    'fetchv2:/lecture/': PAGE_SANS_TEXTE,
    'fetchRendered:/lecture/': domSynopsisSeul,
  });

  const html = await ext.parseChapter(ADRESSE);

  await t.test('le message d attente est rendu, pas le synopsis', () => {
    assert.match(html, /connecte/i);
  });
});

test('sans navigateur disponible, la raison reste lisible', async (t) => {
  // Le harnais n'a pas de navigateur : le pont rend une erreur. C'est aussi ce
  // qui arrive sur un appareil ou la session n'a pas pu s'ouvrir.
  const { ext } = chargerExtension(EXTENSION, {
    'fetchv2:/lecture/': PAGE_SANS_TEXTE,
  });

  const html = await ext.parseChapter(ADRESSE);

  await t.test('une page blanche n est jamais rendue', () => {
    assert.ok(html.length > 100);
  });

  await t.test('le message dit qu il faut se connecter', () => {
    assert.match(html, /connecte/i);
  });

  await t.test('le message indique ou le faire', () => {
    // Sans cette indication, l'utilisateur sait qu'il manque un compte mais pas
    // qu'il existe desormais une porte dans l'app.
    assert.match(html, /source|application|app\b/i);
  });

  await t.test('le message dit ce qui marche sans compte', () => {
    assert.match(html, /recherche|navigation|liste/i);
  });
});
