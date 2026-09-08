// Pont JS -> reseau du harnais : la contrepartie de ce que Dart branche sur
// `sendMessage` dans l'app.
//
// POURQUOI ce fichier existe : le socle de l'app definit `fetchv2` en termes de
// `sendMessage`. Tant que le harnais posait son propre `fetchv2`, il testait un
// chemin que le telephone n'emprunte pas — notamment la lecture des deux
// conventions d'en-tetes et la serialisation du corps, qui vivent cote Dart. En
// fournissant `sendMessage` a la place, le harnais execute le vrai socle.
//
// CE QUE CE PONT NE FAIT PAS, et c'est assume : il n'a pas de navigateur
// embarque, donc il ne franchit pas une page d'attente Cloudflare. Il la
// RECONNAIT et la signale, pour que le harnais distingue "site protege" de
// "extension fautive". Pour la meme raison, le canal `fetchRendered` — qui lit
// une page apres execution de son JavaScript, avec la session de l'utilisateur —
// rend un message nommant cette limite, et non un verdict. Il n'a pas non plus la protection contre les adresses
// privees de l'app (inutile ici : les adresses viennent de fichiers relus, pas
// d'un tiers).
//
// Formes de retour, relevees dans m_provider_wrapper.dart :
//   fetchv2      -> { status, headers, body, error? }
//   fetchBinary  -> { status, headers, base64, error? }
//   storage_get  -> la valeur, ou null
//   storage_set / storage_remove / storage_clear -> true

const IDENTITE_PAR_DEFAUT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const CLES_NON_ENTETES = new Set(['method', 'body', 'responseType', 'headers']);

// Une page d'attente Cloudflare rend souvent 200 : le code ne suffit pas a la
// reconnaitre, il faut lire le corps.
const MOTIFS_CLOUDFLARE =
  /Just a moment|cf-browser-verification|challenge-platform|Attention Required/i;

function estPageCloudflare(corps) {
  if (typeof corps !== 'string' || !corps) return false;
  return MOTIFS_CLOUDFLARE.test(corps.slice(0, 4000));
}

// Le pont Dart accepte les en-tetes imbriques dans `headers` ET poses a plat
// dans les options. Reproduire les deux ici, sinon une extension qui marche sur
// le telephone echoue dans le harnais (le cas de MangasOrigines).
function extraireEntetes(options) {
  const entetes = {};
  if (options && typeof options.headers === 'object' && options.headers) {
    Object.assign(entetes, options.headers);
  } else if (options) {
    for (const [cle, valeur] of Object.entries(options)) {
      if (!CLES_NON_ENTETES.has(cle) && typeof valeur === 'string') entetes[cle] = valeur;
    }
  }
  if (!Object.keys(entetes).some((k) => k.toLowerCase() === 'user-agent')) {
    entetes['User-Agent'] = IDENTITE_PAR_DEFAUT;
  }
  return entetes;
}

function preparerCorps(options, entetes) {
  let corps = options ? options.body : undefined;
  if (corps && typeof corps === 'object' && !(corps instanceof ArrayBuffer)) {
    corps = Object.entries(corps)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
      .join('&');
    if (!Object.keys(entetes).some((k) => k.toLowerCase() === 'content-type')) {
      entetes['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
  }
  return corps;
}

function lireArguments(charge) {
  if (typeof charge === 'string') return JSON.parse(charge);
  return charge;
}

function creerPont({ observer, timeoutMs = 25000 } = {}) {
  // Le stockage de l'app survit a la session ; ici il ne dure que l'essai. C'est
  // suffisant : on mesure qu'une extension sait ecrire et relire, pas la
  // persistance du telephone.
  const stockage = new Map();

  async function appelHttp(url, options, binaire) {
    const entetes = extraireEntetes(options);
    const corps = preparerCorps(options, entetes);
    const methode = ((options && options.method) || 'GET').toUpperCase();

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
    try {
      const reponse = await fetch(url, {
        method: methode,
        headers: entetes,
        body: corps || undefined,
        redirect: 'follow',
        signal: controleur.signal,
      });

      const entetesReponse = {};
      reponse.headers.forEach((v, k) => { entetesReponse[k] = v; });

      if (binaire) {
        const tampon = Buffer.from(await reponse.arrayBuffer());
        if (observer) {
          observer({ url, status: reponse.status, cloudflare: false, binaire: true });
        }
        return { status: reponse.status, headers: entetesReponse, base64: tampon.toString('base64') };
      }

      const texte = await reponse.text();
      const cloudflare = estPageCloudflare(texte) ||
        ((reponse.status === 403 || reponse.status === 503) &&
          Boolean(reponse.headers.get('cf-ray')));
      if (observer) observer({ url, status: reponse.status, cloudflare, binaire: false });
      return { status: reponse.status, headers: entetesReponse, body: texte };
    } catch (e) {
      // Le pont Dart ne leve pas : il met le probleme dans `error` et laisse le
      // socle decider. Se comporter autrement changerait le chemin teste.
      const message = String((e && e.message) || e).slice(0, 200);
      if (observer) observer({ url, status: 0, cloudflare: false, erreur: message });
      const vide = binaire ? { base64: '' } : { body: '' };
      return Object.assign({ status: 0, headers: {}, error: message }, vide);
    } finally {
      clearTimeout(minuteur);
    }
  }

  return async function sendMessage(canal, charge) {
    switch (canal) {
      case 'fetchv2': {
        const [url, options] = lireArguments(charge);
        return appelHttp(url, options || {}, false);
      }
      case 'fetchBinary': {
        const [url, options] = lireArguments(charge);
        return appelHttp(url, options || {}, true);
      }
      case 'fetchRendered': {
        // Le socle de l'app expose ce canal pour lire une page APRES execution
        // de son JavaScript, dans un navigateur portant la session de
        // l'utilisateur. Le harnais n'a pas de navigateur : il ne peut ni le
        // simuler, ni juger une extension qui l'appelle.
        //
        // On le dit franchement plutot que de rendre « canal inconnu », qui
        // remonterait jusqu'au verdict sous la forme « Render error: canal
        // inconnu » et ressemblerait a un defaut de l'extension testee.
        const [urlDemandee] = lireArguments(charge);
        if (observer) observer({ url: urlDemandee, status: 0, cloudflare: false, rendu: true });
        return {
          status: 0,
          headers: {},
          body: '',
          error: 'le harnais n a pas de navigateur : fetchRendered ne peut pas etre ' +
            'mesure ici. Cette page demande un rendu avec la session de l utilisateur, ' +
            'donc une verification dans l app.',
        };
      }
      case 'storage_get': {
        const { key } = lireArguments(charge);
        return stockage.has(key) ? stockage.get(key) : null;
      }
      case 'storage_set': {
        const { key, value } = lireArguments(charge);
        stockage.set(key, String(value));
        return true;
      }
      case 'storage_remove': {
        const { key } = lireArguments(charge);
        stockage.delete(key);
        return true;
      }
      case 'storage_clear':
        stockage.clear();
        return true;
      default:
        return { error: `canal inconnu: ${canal}` };
    }
  };
}

module.exports = { creerPont, estPageCloudflare, IDENTITE_PAR_DEFAUT };
