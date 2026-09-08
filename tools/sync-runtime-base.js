#!/usr/bin/env node
// Recopie le socle d'execution depuis le code de l'app vers le harnais.
//
// POURQUOI ce generateur existe : le socle du harnais etait recopie a la main et
// avait perdu dix declarations sur douze, dont tout le substitut de DOMParser.
// Deux extensions saines etaient donc classees ROUGE. Une copie manuelle derive ;
// une copie generee ne peut pas.
//
// Le socle est ecrit TEL QUEL dans `runtime-base.jsbody`, un fichier texte sans
// aucune syntaxe autour. C'est deliberé : le stockage precedent etait une chaine
// a apostrophes inverses, et le JS de l'app en contient dix — la premiere
// terminait la chaine. Dans un fichier brut, aucun caractere n'a de sens
// particulier, donc la copie ne peut pas etre tronquee.
//
// Usage :
//   node tools/sync-runtime-base.js           regenere le socle
//   node tools/sync-runtime-base.js --check    sort en 1 si le socle a derive
//
// La source de l'app est cherchee dans ../Hitomi ; poser HITOMI_APP_DIR pour
// pointer ailleurs.

const fs = require('node:fs');
const path = require('node:path');

const NOM_METHODE = '_baseMProviderClass';
const FICHIER_SOCLE = path.join(__dirname, 'runtime-base.jsbody');

function cheminSourceDart() {
  const racineApp = process.env.HITOMI_APP_DIR ||
    path.resolve(__dirname, '..', '..', 'Hitomi');
  return path.join(racineApp, 'lib', 'data', 'extensions', 'runtime',
    'm_provider_wrapper.dart');
}

// Le socle vit dans une chaine brute Dart (r'''...'''). On la decoupe sur ses
// bornes exactes plutot que sur une expression gourmande : le fichier contient
// d'autres apostrophes triples potentielles, et une capture trop large ramenerait
// du Dart au milieu du JS.
function extraireSocleDepuisDart(chemin) {
  const source = fs.readFileSync(chemin, 'utf8');

  const ouverture = source.indexOf(`String ${NOM_METHODE}() => r'''`);
  if (ouverture === -1) {
    throw new Error(
      `methode ${NOM_METHODE} introuvable dans ${chemin} — ` +
      'le socle a peut-etre ete renomme cote app');
  }

  const debut = source.indexOf("r'''", ouverture) + 4;
  const fin = source.indexOf("''';", debut);
  if (fin === -1) {
    throw new Error(`chaine brute non refermee apres ${NOM_METHODE} dans ${chemin}`);
  }

  return source.slice(debut, fin);
}

function socleActuel() {
  if (!fs.existsSync(FICHIER_SOCLE)) return null;
  return fs.readFileSync(FICHIER_SOCLE, 'utf8');
}

function main() {
  const verifierSeulement = process.argv.includes('--check');
  const chemin = cheminSourceDart();

  if (!fs.existsSync(chemin)) {
    console.error(`[ERREUR] source de l'app introuvable : ${chemin}`);
    console.error("Poser HITOMI_APP_DIR sur le dossier du depot de l'app.");
    process.exit(2);
  }

  const attendu = extraireSocleDepuisDart(chemin);
  const actuel = socleActuel();

  if (verifierSeulement) {
    if (actuel !== null && actuel.trim() === attendu.trim()) {
      console.log(`socle a jour (${attendu.split('\n').length} lignes)`);
      process.exit(0);
    }
    console.error('[DERIVE] le socle du harnais differe de celui de l app.');
    console.error('Relancer : node tools/sync-runtime-base.js');
    process.exit(1);
  }

  fs.writeFileSync(FICHIER_SOCLE, attendu, 'utf8');
  const declarations = [...attendu.matchAll(/^\s*(?:class|function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  console.log(`socle recopie depuis ${path.relative(process.cwd(), chemin)}`);
  console.log(`  ${attendu.split('\n').length} lignes, ${attendu.length} caracteres`);
  console.log(`  declare : ${[...new Set(declarations)].sort().join(', ')}`);
}

if (require.main === module) main();

module.exports = { extraireSocleDepuisDart, cheminSourceDart, FICHIER_SOCLE };
