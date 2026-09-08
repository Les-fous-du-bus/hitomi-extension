// Charge une extension avec des reponses en boite, pour la tester sans reseau.
//
// POURQUOI ce fichier existe : les trois harnais existants interrogent le site
// en ligne. C'est indispensable pour savoir si une source repond aujourd'hui,
// mais inutilisable pour verifier un comportement precis — un site qui rend une
// erreur, un champ absent, une reponse tronquee. Ces cas-la n'arrivent pas sur
// commande. On les pose donc a la main.
//
// Le socle charge est celui de l'app, le meme que les harnais reseau : une
// extension testee ici s'execute dans les memes conditions que sur le telephone,
// seul le reseau change.

const fs = require('node:fs');
const vm = require('node:vm');
const { RUNTIME_BASE_JS } = require('./runtime-base.js');

// Les reponses sont decrites par motif d'adresse. Le motif le plus long gagne,
// pour qu'une adresse precise prime sur une adresse generique. Un motif peut
// etre prefixe du canal (« fetchRendered:/lecture/ ») quand une meme adresse
// doit repondre differemment selon le chemin emprunte.
function trouverReponse(reponses, url, canal) {
  const motifs = Object.keys(reponses).sort((a, b) => b.length - a.length);
  // Un motif portant un canal ne repond qu'a ce canal ; les autres repondent a
  // tout, pour que les tests existants restent ecrits sans prefixe.
  for (const motif of motifs) {
    const sep = motif.indexOf(':');
    const prefixe = sep > 0 ? motif.slice(0, sep) : '';
    if (prefixe === 'fetchv2' || prefixe === 'fetchRendered' || prefixe === 'fetchBinary') {
      if (prefixe === canal && url.includes(motif.slice(sep + 1))) return reponses[motif];
      continue;
    }
    if (url.includes(motif)) return reponses[motif];
  }
  return null;
}

// Un tableau ou un objet cree DANS le contexte vm n'a pas le meme prototype que
// son equivalent cote hote : `deepStrictEqual` les declare differents alors que
// leur contenu est identique. Ce passage par JSON les ramene aux prototypes de
// l'hote. A utiliser sur tout ce qu'une extension rend avant de le comparer.
function normaliser(valeur) {
  return JSON.parse(JSON.stringify(valeur));
}

function chargerExtension(cheminExtension, reponses) {
  const appels = [];

  async function sendMessage(canal, charge) {
    if (canal === 'storage_get') return null;
    if (canal.startsWith('storage_')) return true;

    const [url, options] = typeof charge === 'string' ? JSON.parse(charge) : charge;
    // Le canal est retenu : une extension peut lire la meme adresse par
    // `fetchv2` ou par `fetchRendered`, et ces deux chemins n'ont pas le meme
    // cout. Un test doit pouvoir affirmer lequel a servi.
    appels.push({ canal, url, options: options || {} });

    const reponse = trouverReponse(reponses, url, canal);
    if (reponse === null) {
      return { status: 404, headers: {}, body: '', error: `aucune reponse posee pour ${url}` };
    }
    // Une reponse peut etre une simple chaine (le corps, code 200) ou un objet
    // decrivant status/body/error, pour tester les cas d'echec.
    if (typeof reponse === 'string') {
      return { status: 200, headers: {}, body: reponse };
    }
    return Object.assign({ status: 200, headers: {}, body: '' }, reponse);
  }

  const sandbox = {
    sendMessage, console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
    RegExp, Error, Object, Array, String, Number, Boolean, Symbol, Map, Set,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    parseInt, parseFloat, isNaN, isFinite, URL, URLSearchParams, Buffer,
  };
  vm.createContext(sandbox);
  vm.runInContext(RUNTIME_BASE_JS, sandbox);
  vm.runInContext(
    fs.readFileSync(cheminExtension, 'utf8') +
    "\n;globalThis.__ext = (typeof DefaultExtension!=='undefined' ? DefaultExtension : " +
    "(typeof Extension!=='undefined' ? Extension : null));",
    sandbox, { filename: cheminExtension });

  if (!sandbox.__ext) {
    throw new Error(`aucune classe DefaultExtension dans ${cheminExtension}`);
  }
  return { ext: new sandbox.__ext(), appels };
}

module.exports = { chargerExtension, normaliser };
