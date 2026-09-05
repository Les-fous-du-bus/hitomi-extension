#!/usr/bin/env node
/**
 * Verifie une extension contre des pages CAPTUREES, sans reseau.
 *
 * POURQUOI cet outil en plus du harnais. `ext-test.js` mesure une extension en
 * conditions reelles, ce qui est le bon test — sauf quand le site est protege
 * par un defi Cloudflare. Dans ce cas le harnais rend BLOCKED-CF et ne dit
 * RIEN de la qualite du decoupage : l'extension peut etre juste comme elle peut
 * etre completement fausse, on ne le sait pas. C'est exactement la situation ou
 * les six extensions LN reparees le 2026-09-04 avaient derive sans que personne
 * ne le voie.
 *
 * Ici, on sert a l'extension les pages telles que le site les a reellement
 * rendues (capturees une fois via un navigateur qui a resolu le defi), et on
 * verifie ce qu'elle en tire. Le reseau est remplace, le decoupage est reel.
 *
 * Limite assumee : une capture vieillit. Elle prouve que le decoupage est juste
 * AU JOUR de la capture, pas que le site n'a pas change depuis. C'est un test
 * de non-regression du code, pas une surveillance du site.
 *
 * Usage :
 *   node tools/fixture-test.js <extension.js> <table-de-correspondance.json>
 *
 * La table associe un motif d'URL a un fichier de capture :
 *   { "/home": "fixtures/world-novel-home.html", ... }
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { RUNTIME_BASE_JS } = require('./runtime-base.js');

const extFile = process.argv[2];
const mapFile = process.argv[3];
if (!extFile || !mapFile) {
  console.error('usage: node tools/fixture-test.js <extension.js> <map.json>');
  process.exit(2);
}

const root = path.dirname(mapFile);
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const served = [];

function fixtureFor(url) {
  // Le motif le plus long gagne : "/oeuvres/x" prime sur "/oeuvres".
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (url.includes(k)) return path.resolve(root, map[k]);
  }
  return null;
}

async function fetchv2(url) {
  const f = fixtureFor(url);
  served.push({ url, fixture: f ? path.basename(f) : null });
  if (!f) throw new Error(`aucune capture pour ${url}`);
  return fs.readFileSync(f, 'utf8');
}

const sandbox = {
  fetchv2, fetchBinary: fetchv2, console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
  RegExp, Error, Object, Array, String, Number, Boolean, Symbol, Map, Set,
  encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, parseInt, parseFloat, isNaN, isFinite,
  URL, URLSearchParams,
};
vm.createContext(sandbox);
vm.runInContext(RUNTIME_BASE_JS, sandbox);
vm.runInContext(
  fs.readFileSync(extFile, 'utf8') +
  `\n;globalThis.__ext = (typeof DefaultExtension!=='undefined'?DefaultExtension:null);`,
  sandbox, { filename: extFile });

const ext = new sandbox.__ext();

// ── Verifications ──────────────────────────────────────────────────────────

let failures = 0;
function check(label, ok, detail) {
  const mark = ok ? 'OK  ' : 'ECHEC';
  console.log(`  [${mark}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function textLength(html) {
  if (typeof html !== 'string') return 0;
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

(async () => {
  console.log(`\n=== ${path.basename(extFile)} contre captures ===\n`);

  // 1. Liste populaire
  const pop = await ext.popularNovels(1);
  const list = pop.list || [];
  check('populaire rend des oeuvres', list.length > 0, `${list.length} entrees`);
  check('chaque oeuvre a un titre', list.every(n => n.title && n.title.length > 1));
  check('chaque oeuvre a une adresse absolue',
    list.every(n => /^https?:\/\//.test(n.url || '')));
  check('chaque oeuvre a une couverture',
    list.every(n => /^https?:\/\//.test(n.cover || '')),
    `${list.filter(n => /^https?:\/\//.test(n.cover || '')).length}/${list.length}`);
  check('aucun doublon', new Set(list.map(n => n.url)).size === list.length);
  check('les adresses pointent une fiche',
    list.every(n => (n.url || '').includes('/oeuvres/')));

  // 2. Page 2 vide (catalogue sur une seule page)
  const pop2 = await ext.popularNovels(2);
  check('page 2 rend une liste vide', (pop2.list || []).length === 0);

  // 3. Recherche
  const hit = await ext.searchNovels(list[0].title.split(' ')[0], 1);
  check('la recherche trouve le titre cherche',
    (hit.list || []).some(n => n.title === list[0].title),
    `${(hit.list || []).length} resultats`);
  const miss = await ext.searchNovels('zzzzz-inexistant-zzzzz', 1);
  check('la recherche ne rend rien sur un terme absent',
    (miss.list || []).length === 0);

  // 4. Fiche d'oeuvre + chapitres
  const detail = await ext.parseNovelAndChapters(
    'https://world-novel.fr/oeuvres/the-mech-touch');
  const chaps = detail.chapters || [];
  check('la fiche rend un titre', !!detail.title, detail.title);
  check('la fiche rend un auteur', !!detail.author, detail.author);
  check('la fiche rend un synopsis', (detail.description || '').length > 40,
    `${(detail.description || '').length} caracteres`);
  check('la fiche rend des genres', (detail.genres || []).length > 0,
    `${(detail.genres || []).length}`);
  check('la liste de chapitres est complete', chaps.length > 300,
    `${chaps.length} chapitres`);
  check('aucun chapitre en double',
    new Set(chaps.map(c => c.url)).size === chaps.length);
  check('chaque chapitre a un nom', chaps.every(c => c.name && c.name.length > 2));
  check('chaque chapitre a une adresse de lecture',
    chaps.every(c => (c.url || '').includes('/lecture/')));
  check('les adresses sont encodees (pas d espace brut)',
    chaps.every(c => !/ /.test(c.url || '')));
  check('les chapitres sont en ordre de lecture croissant',
    chaps.every((c, i) => i === 0 || c.chapterNumber >= chaps[i - 1].chapterNumber));
  check('les numeros de chapitre sont renseignes',
    chaps.filter(c => c.chapterNumber > 0).length > chaps.length * 0.9,
    `${chaps.filter(c => c.chapterNumber > 0).length}/${chaps.length}`);
  check('une date de parution est remontee',
    chaps.filter(c => c.releaseTime).length > chaps.length * 0.9);

  // 5. Chapitre — la limite mesuree doit etre DITE, pas silencieuse
  const content = await ext.parseChapter(chaps[chaps.length - 1].url);
  const len = textLength(content);
  check('le chapitre ne rend jamais une page vide', len > 60, `${len} caracteres de texte`);
  check('la raison est expliquee en clair quand le texte manque',
    len > 60 && /connect/i.test(content),
    'message d attente de connexion');

  console.log(`\n  captures servies : ${served.length}`);
  for (const s of served) console.log(`    ${s.url} -> ${s.fixture}`);
  console.log(failures === 0
    ? `\n=== tout passe (${failures} echec) ===\n`
    : `\n=== ${failures} ECHEC(S) ===\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('erreur:', e && e.stack || e);
  process.exit(1);
});
