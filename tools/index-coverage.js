// Compare les fichiers d'extension et les entrees du catalogue.
//
// POURQUOI ce controle existe : `tcbscans` a disparu d'index.json au commit
// de0f750 du 2026-05-27 — un commit qui AJOUTAIT deux extensions et ne mentionne
// aucun retrait. Elle a ete perdue lors d'une reecriture en bloc du catalogue.
// Constate le 2026-09-08, trois mois et demi plus tard : le fichier etait la, il
// mesurait VERT contre le site, et personne ne pouvait l'installer.
//
// Rien ne le signalait. Le triage parcourt `src/`, l'app lit `index.json`, et
// les deux listes n'etaient jamais comparees. Un fichier hors catalogue est du
// travail invisible : teste par le harnais, inaccessible aux lecteurs.
//
// Usage :
//   node tools/index-coverage.js            affiche l'audit
//   node tools/index-coverage.js --check     sort en 1 si un ecart n'est pas justifie

const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const ESPACES = { manga: 'src/manga', novel: 'src/novel' };

/**
 * Fichiers volontairement absents du catalogue, avec la raison du retrait.
 *
 * Une entree ici est une DECISION, pas un oubli. C'est ce qui distingue un
 * retrait assume d'une perte silencieuse. Toute raison doit dire ce qui a ete
 * mesure, pour qu'elle se relise dans six mois.
 */
const RETRAITS_ASSUMES = {
  light_novel_fr:
    "Domaine novel-fr.net sans enregistrement DNS. Le site a ete repris sous le " +
    "nom NovelFrance (novelfrance.fr), deja couvert par l'extension massnovel " +
    "(verdict vert 3/3, 3178 chapitres). Retiree du catalogue le 2026-09-05, " +
    "commit 85780b8. Reparer ce fichier creerait une seconde source sur le meme site.",

  allnovel:
    "Doublon strict de novelfull : meme moteur, meme structure, meme contenu. " +
    "Retiree du catalogue le 2026-09-05, commit 85780b8. Publier les deux " +
    "donnerait deux fois la meme source dans la liste du lecteur.",

  bentomanga:
    "Defi Cloudflare reel sur www.bentomanga.com (403 avec page de defi verifiee " +
    "le 2026-09-08), donc sa lecture n'est pas verifiable hors de l'app. Ses " +
    "reperes datent du 2026-05-26 et n'ont jamais ete revalides. Le precedent " +
    "lightnovelpub montre que le navigateur embarque franchit ce blocage, mais " +
    "cela ne dit rien de la justesse des reperes. A publier apres une validation " +
    "dans l'app, pas avant.",
};

function fichiersExtensions() {
  const trouves = [];
  for (const [espace, dossier] of Object.entries(ESPACES)) {
    const chemin = path.join(RACINE, dossier);
    if (!fs.existsSync(chemin)) continue;
    for (const nom of fs.readdirSync(chemin)) {
      if (!nom.endsWith('.js')) continue;
      trouves.push({ id: path.basename(nom, '.js'), espace, chemin: `${dossier}/${nom}` });
    }
  }
  return trouves.sort((a, b) => a.id.localeCompare(b.id));
}

function entreesCatalogue() {
  const brut = JSON.parse(fs.readFileSync(path.join(RACINE, 'index.json'), 'utf8'));
  return (brut.extensions || []).map((e) => ({
    id: e.id, jsUrl: e.jsUrl, status: e.status || 'active',
  }));
}

function auditerCouverture() {
  const fichiers = fichiersExtensions();
  const entrees = entreesCatalogue();

  const idsFichiers = new Set(fichiers.map((f) => f.id));
  const idsEntrees = new Set(entrees.map((e) => e.id));

  const orphelins = fichiers.filter((f) => !idsEntrees.has(f.id)).map((f) => f.id);

  return {
    fichiers,
    entrees,
    orphelins,
    // Un orphelin justifie est une decision ; un orphelin nu est une perte.
    orphelinsNonJustifies: orphelins.filter((id) => !RETRAITS_ASSUMES[id]),
    entreesSansFichier: entrees.filter((e) => !idsFichiers.has(e.id)).map((e) => e.id),
    // Un retrait qui nomme un fichier disparu est du bruit a nettoyer.
    retraitsPerimes: Object.keys(RETRAITS_ASSUMES).filter((id) => !idsFichiers.has(id)),
  };
}

function main() {
  const verifier = process.argv.includes('--check');
  const a = auditerCouverture();

  console.log(`fichiers : ${a.fichiers.length}   entrees au catalogue : ${a.entrees.length}`);
  if (a.orphelins.length) {
    console.log(`\nhors catalogue (${a.orphelins.length}) :`);
    for (const id of a.orphelins) {
      const raison = RETRAITS_ASSUMES[id];
      console.log(`  ${raison ? 'retrait assume' : 'NON JUSTIFIE '} ${id}`);
      if (raison) console.log(`      ${raison.slice(0, 120)}...`);
    }
  }
  if (a.entreesSansFichier.length) {
    console.log(`\nentrees sans fichier : ${a.entreesSansFichier.join(', ')}`);
  }
  if (a.retraitsPerimes.length) {
    console.log(`\nretraits perimes (fichier disparu) : ${a.retraitsPerimes.join(', ')}`);
  }

  const ecarts = a.orphelinsNonJustifies.length + a.entreesSansFichier.length +
    a.retraitsPerimes.length;
  if (!ecarts) {
    console.log('\nOK : chaque fichier a une entree, ou un retrait justifie.');
    process.exit(0);
  }
  console.error(`\n${ecarts} ecart(s) non justifie(s).`);
  if (a.orphelinsNonJustifies.length) {
    console.error("Ajouter l'entree a index.json, ou declarer le retrait dans " +
      'RETRAITS_ASSUMES avec ce qui a ete mesure.');
  }
  process.exit(verifier ? 1 : 0);
}

if (require.main === module) main();

module.exports = { auditerCouverture, fichiersExtensions, entreesCatalogue, RETRAITS_ASSUMES };
