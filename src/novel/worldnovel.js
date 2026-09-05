/**
 * World Novel (Victorian Novel House) — Extension Hitomi Reader (Light Novel)
 * Source : https://world-novel.fr
 * Methode : lecture du flux de donnees embarque par le site (Next.js App Router)
 * Langue : fr
 * Cloudflare : OUI (defi gere, resolu par le navigateur embarque de l'app)
 * Mature : NON
 *
 * ── CE QUI A ETE MESURE LE 2026-09-05 ───────────────────────────────────────
 *
 * Le site est protege par un defi Cloudflare de type "managed" : en HTTP natif,
 * TOUS les chemins rendent 403 avec l'en-tete `cf-mitigated: challenge` — y
 * compris robots.txt et sitemap.xml. Ce n'est pas un blocage pour l'app :
 * CloudflareBypassService reconnait le defi et le resout dans un navigateur
 * sans fenetre, puis WebViewHttpProxy execute le fetch DANS ce navigateur pour
 * garder la meme empreinte TLS. Quatre extensions du catalogue vivent deja
 * ainsi. Mesure faite avec un vrai Chrome pilote : le defi tombe seul en
 * quelques secondes et le site rend "Accueil - Victorian Novel House".
 *
 * Le site est une application Next.js App Router. Ses donnees voyagent dans des
 * appels `self.__next_f.push([1,"..."])` a l'interieur de la page servie. C'est
 * la seule prise stable : les classes CSS sont hachees par le compilateur
 * (EvuDXc-XTcLQv, jhLoNs-lLxYkP...) et changent a chaque compilation du site.
 * Aucun selecteur ne doit s'y ancrer.
 *
 * ── LA LIMITE, MESUREE ET NON CONTOURNEE ────────────────────────────────────
 *
 * Le TEXTE des chapitres n'est PAS dans la page servie. La page de lecture ne
 * porte que 9 513 caracteres de donnees, dont le plus gros champ texte fait
 * 221 caracteres — un libelle, pas un chapitre. L'observation du reseau montre
 * d'ou il vient : Firestore, projet `victorian-novel-house`, appele en direct
 * par le navigateur (firestore.googleapis.com, hors Cloudflare).
 *
 * Cette base est FERMEE : une lecture anonyme avec la seule cle publique rend
 * 403 "Missing or insufficient permissions" sur toutes les collections
 * essayees. Le site ajoute par-dessus Firebase App Check, atteste par reCAPTCHA
 * (en-tete `x-firebase-appcheck` observe sur chaque appel). Autrement dit : le
 * texte demande une session signee, et il n'existe aucune porte laissee
 * ouverte. Le compte est gratuit — c'est donc la session de l'utilisateur qui
 * doit porter la lecture, pas un detournement.
 *
 * `parseChapter` en tient compte honnetement : il TENTE l'extraction (si une
 * session signee fait apparaitre le texte dans la page, elle marchera sans
 * modification), et a defaut explique en clair pourquoi la page est vide, au
 * lieu de rendre un chapitre blanc.
 *
 * ── ETENDUE ────────────────────────────────────────────────────────────────
 *
 * Le catalogue tient sur /home : 14 oeuvres avec leurs metadonnees completes.
 * Il n'existe pas d'index /oeuvres ni de route de recherche (/recherche,
 * /search et /oeuvres rendent 404), d'ou la recherche par filtrage local.
 * /classement est charge depuis Firestore et arrive vide cote serveur : il
 * n'est pas utilise. La fiche d'une oeuvre, elle, porte la liste COMPLETE de
 * ses chapitres (375 mesures sur the-mech-touch) — pas de pagination a
 * contourner.
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://world-novel.fr";

var HEADERS = {
  Referer: BASE_URL + "/",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

/**
 * Reassemble le flux de donnees Next.js App Router.
 *
 * POURQUOI ce format : l'App Router diffuse son etat en une suite de fragments
 * `self.__next_f.push([1,"<chaine echappee>"])`. Chaque fragment est une chaine
 * JSON echappee ; concatenes dans l'ordre, ils reforment la charge utile. Le
 * corps HTML, lui, est assemble par le navigateur et ne contient ni les titres
 * ni les listes.
 */
function nextPayload(html) {
  if (!html) return "";
  var out = "";
  var re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse('"' + m[1] + '"');
    } catch (e) {
      // Un fragment illisible ne doit pas emporter les autres.
    }
  }
  return out;
}

/**
 * Extrait l'objet JSON equilibre qui entoure la position donnee.
 *
 * POURQUOI pas une expression reguliere : la charge utile n'est pas un document
 * JSON unique mais un flux ou les objets sont imbriques et voisinent avec du
 * texte. Compter les accolades est la seule facon fiable de decouper un objet
 * complet sans avaler le suivant.
 */
function objectAround(s, index) {
  var depth = 0;
  var start = -1;
  for (var i = index; i >= 0; i--) {
    var c = s.charAt(i);
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return null;

  depth = 0;
  var inString = false;
  var escaped = false;
  for (var j = start; j < s.length; j++) {
    var ch = s.charAt(j);
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.substring(start, j + 1);
    }
  }
  return null;
}

/** Tous les objets de la charge utile qui portent la cle donnee. */
function objectsWithKey(payload, key) {
  var found = [];
  var seen = {};
  var re = new RegExp('"' + key + '"\\s*:', "g");
  var m;
  while ((m = re.exec(payload)) !== null) {
    var raw = objectAround(payload, m.index);
    if (!raw || seen[raw]) continue;
    seen[raw] = true;
    try {
      found.push(JSON.parse(raw));
    } catch (e) {
      // Objet tronque par un decoupage de fragment : on l'ignore.
    }
  }
  return found;
}

function splitGenres(genre) {
  if (!genre || typeof genre !== "string") return [];
  var out = [];
  var parts = genre.split(",");
  for (var i = 0; i < parts.length; i++) {
    var g = parts[i].trim();
    if (g) out.push(g);
  }
  return out;
}

function novelUrl(id) {
  return BASE_URL + "/oeuvres/" + id;
}

function toNovel(work) {
  var genres = splitGenres(work.genre);
  if (work.tags && work.tags.length) {
    for (var i = 0; i < work.tags.length; i++) {
      var t = work.tags[i];
      if (typeof t === "string" && t && genres.indexOf(t) === -1) genres.push(t);
    }
  }
  return {
    title: work.title || work.id || "",
    url: novelUrl(work.id),
    cover: work.image || "",
    isMature: false,
    genres: genres,
  };
}

/**
 * Les oeuvres du catalogue, lues depuis /home.
 *
 * Une oeuvre se reconnait a la cle `auteur` : c'est la seule presente sur les
 * fiches et absente du decor de la page. Mesure : 14 objets sur /home, autant
 * que d'oeuvres affichees.
 */
async function fetchCatalogue() {
  var html = await fetchv2(BASE_URL + "/home", { headers: HEADERS });
  var payload = nextPayload(html);
  var works = objectsWithKey(payload, "auteur");
  var out = [];
  var seen = {};
  for (var i = 0; i < works.length; i++) {
    var w = works[i];
    if (!w || !w.id || !w.title) continue;
    if (seen[w.id]) continue;
    seen[w.id] = true;
    out.push(w);
  }
  return out;
}

/** Compare sans accents ni casse — le catalogue est en francais. */
function normalize(s) {
  if (!s) return "";
  var out = s.toLowerCase();
  var from = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿ";
  var to = "aaaaaaceeeeiiiinooooouuuuyy";
  var res = "";
  for (var i = 0; i < out.length; i++) {
    var idx = from.indexOf(out.charAt(i));
    res += idx === -1 ? out.charAt(i) : to.charAt(idx);
  }
  return res;
}

class DefaultExtension extends LNProvider {
  get id() { return "worldnovel"; }
  get name() { return "World Novel"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return BASE_URL + "/favicon.ico"; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  async popularNovels(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };
      var works = await fetchCatalogue();
      // POURQUOI trier ici et ne pas lire /classement : la page de classement
      // est remplie depuis Firestore cote navigateur et arrive VIDE dans le
      // HTML servi (mesure du 2026-09-05 : 9 507 caracteres de donnees, zero
      // oeuvre). La note portee par chaque fiche donne le meme ordre sans
      // dependre d'un appel que l'extension ne peut pas faire.
      works.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
      var list = [];
      for (var i = 0; i < works.length; i++) list.push(toNovel(works[i]));
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async latestNovels(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };
      var works = await fetchCatalogue();
      works.sort(function (a, b) { return (b.dateMaj || 0) - (a.dateMaj || 0); });
      var list = [];
      for (var i = 0; i < works.length; i++) list.push(toNovel(works[i]));
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async searchNovels(searchTerm, page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };
      // Filtrage local : le site n'a pas de route de recherche. /recherche,
      // /search et /oeuvres rendent tous 404 (mesure du 2026-09-05). Sur un
      // catalogue de 14 oeuvres, filtrer la seule page /home couvre tout.
      var works = await fetchCatalogue();
      var q = normalize(searchTerm || "");
      if (!q) {
        var all = [];
        for (var k = 0; k < works.length; k++) all.push(toNovel(works[k]));
        return { list: all, hasNextPage: false };
      }
      var list = [];
      for (var i = 0; i < works.length; i++) {
        var w = works[i];
        var haystack = normalize(
          [w.title, w.auteur, w.genre, (w.tags || []).join(" ")].join(" ")
        );
        if (haystack.indexOf(q) !== -1) list.push(toNovel(w));
      }
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async parseNovelAndChapters(url) {
    var fullUrl = url.indexOf("http") === 0 ? url : BASE_URL + url;
    var slug = fullUrl.replace(/^.*\/oeuvres\//, "").replace(/[/?#].*$/, "");

    var html = await fetchv2(fullUrl, { headers: HEADERS });
    var payload = nextPayload(html);

    var works = objectsWithKey(payload, "totalChapters");
    var meta = null;
    for (var i = 0; i < works.length; i++) {
      if (works[i] && works[i].id === slug) { meta = works[i]; break; }
    }
    if (!meta && works.length) meta = works[0];

    // Les chapitres vivent dans des volumes : chaque volume porte volumeId,
    // volumeDisplayName et sa liste. Un volume unique nomme "Chapitres" est le
    // cas courant, mais plusieurs tomes existent sur d'autres oeuvres — d'ou le
    // parcours de tous les volumes plutot que du premier.
    var volumes = objectsWithKey(payload, "volumeDisplayName");
    var chapters = [];
    var seen = {};
    for (var v = 0; v < volumes.length; v++) {
      var vol = volumes[v];
      if (!vol || !vol.chapters || !vol.chapters.length) continue;
      for (var c = 0; c < vol.chapters.length; c++) {
        var ch = vol.chapters[c];
        if (!ch || !ch.id) continue;
        var volId = ch.volumeId || vol.volumeId || "Chapitres";
        var chapUrl =
          BASE_URL +
          "/lecture/" + slug +
          "/volumes/" + encodeURIComponent(volId) +
          "/chapitres/" + encodeURIComponent(ch.id);
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;
        var num = 0;
        var nm = String(ch.title || ch.id).match(/(\d+(?:\.\d+)?)/);
        if (nm) num = parseFloat(nm[1]);
        chapters.push({
          name: ch.title || ch.id,
          url: chapUrl,
          chapterNumber: num,
          releaseTime: ch.date || "",
        });
      }
    }
    // Le site liste du plus recent au plus ancien ; l'app attend l'ordre de
    // lecture.
    chapters.sort(function (a, b) { return a.chapterNumber - b.chapterNumber; });

    var genres = meta ? splitGenres(meta.genre) : [];
    if (meta && meta.tags) {
      for (var t = 0; t < meta.tags.length; t++) {
        var tag = meta.tags[t];
        if (typeof tag === "string" && tag && genres.indexOf(tag) === -1) {
          genres.push(tag);
        }
      }
    }

    return {
      title: meta ? meta.title || slug : slug,
      url: fullUrl,
      cover: meta ? meta.image || "" : "",
      author: meta ? meta.auteur || "" : "",
      // POURQUOI accepter deux noms : l'accueil sert le synopsis sous `desc`,
      // la fiche sous `description`. Mesure du 2026-09-05 sur les deux pages.
      // N'en lire qu'un rendait une fiche sans synopsis sans que rien ne le
      // signale.
      description: meta ? meta.description || meta.desc || "" : "",
      // Le statut ne vit pas a la racine de la fiche mais dans son bloc `seo`.
      status: meta ? (meta.status || (meta.seo && meta.seo.status) || "") : "",
      genres: genres,
      isMature: false,
      chapters: chapters,
    };
  }

  async parseChapter(url) {
    try {
      var fullUrl = url.indexOf("http") === 0 ? url : BASE_URL + url;
      var html = await fetchv2(fullUrl, { headers: HEADERS });
      var payload = nextPayload(html);

      // On TENTE l'extraction avant de conclure : si une session signee fait
      // apparaitre le texte dans la page servie, cette extension le lira sans
      // modification.
      //
      // POURQUOI ancrer sur des cles precises et NON prendre la plus longue
      // chaine de la page : le test contre captures a montre le piege en
      // grandeur nature. Sur une page ou le chapitre est absent, "la plus
      // longue chaine" tombe sur le SYNOPSIS de l'oeuvre et le presente comme
      // un chapitre. Un texte faux affiche comme vrai est pire qu'un message
      // d'attente : c'est la lecon des six extensions LN reparees le
      // 2026-09-04, ou un widget de notation passait pour du contenu.
      var best = "";
      var keys = ["content", "contenu", "text", "texte", "chapterContent", "html"];
      for (var k = 0; k < keys.length; k++) {
        var re = new RegExp('"' + keys[k] + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.){600,}?)"', "g");
        var m;
        while ((m = re.exec(payload)) !== null) {
          var candidate;
          try {
            candidate = JSON.parse('"' + m[1] + '"');
          } catch (e) {
            continue;
          }
          if (candidate.length > best.length) best = candidate;
        }
      }
      if (best.length >= 600) {
        return best.charAt(0) === "<" ? best : "<p>" + best + "</p>";
      }

      return (
        "<p><strong>Ce chapitre demande d'etre connecte.</strong></p>" +
        "<p>Le texte de World Novel n'est pas dans la page : le site le charge " +
        "depuis sa base Firebase, qui refuse toute lecture non authentifiee " +
        "(erreur 403, permissions insuffisantes). Le compte est gratuit sur " +
        "world-novel.fr — une fois connecte dans le navigateur de " +
        "l'application, la lecture pourra suivre la session.</p>" +
        "<p>La navigation, la recherche et la liste des chapitres, elles, " +
        "fonctionnent sans compte.</p>"
      );
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [];
  }
}
