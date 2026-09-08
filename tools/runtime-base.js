// Socle d'execution des extensions — le meme que celui que l'app injecte.
//
// POURQUOI ce fichier existe : le harnais definissait autrefois son propre socle
// ou chaque methode levait "NI". L'app, elle, fournit un vrai pont entre les deux
// dialectes (MProvider <-> LNProvider) avec conversion des champs, plus un
// substitut de DOMParser et le decodage base64. Le harnais mesurait donc autre
// chose que ce que le telephone execute, et une extension pouvait passer ici puis
// rendre une page blanche sur l'appareil.
//
// POURQUOI le socle est dans un fichier a part : il etait recopie a la main dans
// une chaine a apostrophes inverses, et le JS de l'app en contient dix — la
// premiere terminait la chaine. La copie avait perdu dix declarations sur douze,
// dont tout le substitut de DOMParser, ce qui classait ROUGE avec zero oeuvre les
// deux extensions qui l'appellent (anime_sama, bato) sans qu'elles soient en
// cause. Dans un fichier texte brut, aucun caractere n'a de sens particulier.
//
// SOURCE DE VERITE : Hitomi/lib/data/extensions/runtime/m_provider_wrapper.dart,
// methode `_baseMProviderClass`. Ne pas modifier `runtime-base.jsbody` a la main :
//   node tools/sync-runtime-base.js           recopie depuis l'app
//   node tools/sync-runtime-base.js --check    signale une derive
// Le test `runtime-base.test.js` echoue si les deux ont diverge.

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_BASE_JS = fs.readFileSync(
  path.join(__dirname, 'runtime-base.jsbody'), 'utf8');

module.exports = { RUNTIME_BASE_JS };
