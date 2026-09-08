// Tout fichier d'extension doit avoir une entree au catalogue, ou une raison.
//
// POURQUOI ce fichier existe : `tcbscans` a disparu d'index.json au commit
// de0f750 du 2026-05-27, un commit qui AJOUTAIT deux extensions et ne mentionne
// aucun retrait. Elle a ete perdue lors d'une reecriture en bloc du catalogue.
// Constate le 2026-09-08 : le fichier existe, il mesure VERT 3/3 contre le site
// (20 oeuvres, 84 resultats de recherche, 30 chapitres, 3/3 couvertures
// joignables), et personne ne pouvait l'installer depuis trois mois et demi.
//
// Rien ne le signalait : le triage parcourt `src/`, l'app lit `index.json`, et
// les deux n'etaient jamais compares. Un fichier hors catalogue est donc du
// travail invisible — teste par le harnais, inaccessible aux lecteurs.
//
// Ce controle compare les deux listes. Un fichier sans entree doit figurer dans
// la liste des retraits assumes, avec sa raison. Sinon il echoue.
//
// Lancer : node --test tools/index-coverage.test.js

const test = require('node:test');
const assert = require('node:assert');

const { auditerCouverture, RETRAITS_ASSUMES } = require('./index-coverage.js');

test('le catalogue et les fichiers se correspondent', async (t) => {
  const audit = auditerCouverture();

  await t.test('aucun fichier n est hors catalogue sans raison', () => {
    assert.deepStrictEqual(audit.orphelinsNonJustifies, [],
      'un fichier sans entree est invisible pour les lecteurs — ' +
      "l'ajouter a index.json, ou le declarer dans RETRAITS_ASSUMES avec sa raison");
  });

  await t.test('aucune entree ne pointe sur un fichier absent', () => {
    assert.deepStrictEqual(audit.entreesSansFichier, [],
      'une entree sans fichier fait echouer l installation chez tous les lecteurs');
  });

  await t.test('chaque retrait assume porte une raison', () => {
    const sansRaison = Object.entries(RETRAITS_ASSUMES)
      .filter(([, raison]) => !raison || raison.trim().length < 20)
      .map(([id]) => id);
    assert.deepStrictEqual(sansRaison, [],
      'une raison courte se relit dans six mois comme une decision oubliee');
  });

  await t.test('aucun retrait assume ne concerne un fichier absent', () => {
    // Un retrait qui nomme un fichier disparu est du bruit : la liste doit
    // rester une photographie de la realite, pas un cimetiere.
    assert.deepStrictEqual(audit.retraitsPerimes, []);
  });
});

test('l audit voit bien les deux cotes', async (t) => {
  const audit = auditerCouverture();

  await t.test('des fichiers sont trouves', () => {
    assert.ok(audit.fichiers.length > 40,
      `seulement ${audit.fichiers.length} fichiers trouves — le parcours est casse`);
  });

  await t.test('des entrees sont trouvees', () => {
    assert.ok(audit.entrees.length > 40,
      `seulement ${audit.entrees.length} entrees trouvees — la lecture est cassee`);
  });
});
