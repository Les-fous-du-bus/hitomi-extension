/**
 * ValirScans — Extension Hitomi Reader (comics / manhwa)
 * Source : https://valirscans.org
 * Methode : Next.js App Router — lecture du flux RSC rendu serveur (self.__next_f.push)
 *           + sitemap XML officiel pour le catalogue et la recherche
 * Langue : en
 * Cloudflare : NON (aucun defi sur un client navigateur ordinaire)
 * Mature : false (le site expose un drapeau isMature par serie, remonte tel quel)
 *
 * @author @khun — Extension Strategist
 * @version 1
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CARTOGRAPHIE — chaque point verifie sur le HTML REELLEMENT SERVI le 2026-08-24
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le site est un Next.js App Router. Il n'y a PAS de <script id="__NEXT_DATA__">.
 * Les donnees arrivent dans des `self.__next_f.push([1,"...JSON echappe..."])`,
 * ou les guillemets du JSON sont echappes en \". D'ou `decodeRsc()` : on retire
 * cet echappement UNE fois, puis on decoupe le JSON avec un compteur de
 * parentheses (`sliceJson`) et non une expression reguliere. POURQUOI : les
 * objets series contiennent des tableaux imbriques (aliases, genres, tags), et
 * une regex du type /"key":\[(.*?)\]/ s'arrete au premier ] rencontre, donc au
 * milieu du premier tableau imbrique. C'est la panne classique de ce socle.
 *
 *   Catalogue      : GET /series?page=N
 *                    -> cle "initialSeries" : 24 series/page, resultCount=631
 *                    Chaque entree porte slug, urlSlug, title, coverImage, type.
 *   Nouveautes     : GET /series-sitemap-1.xml  (UNE requete, ~631 entrees)
 *                    Le sitemap porte <lastmod> (trie du plus recent au plus
 *                    ancien), <image:loc> (couverture absolue) et <image:title>
 *                    (titre reel, apostrophes comprises). C'est la source la
 *                    plus riche et la moins couteuse du site.
 *   Recherche      : meme sitemap, filtre localement sur <image:title>.
 *                    POURQUOI pas /search?q= : cette page existe (elle est
 *                    declaree dans le balisage schema.org du site) mais elle ne
 *                    rend AUCUN resultat cote serveur — la liste est peuplee en
 *                    JavaScript via /api/, que le robots.txt du site interdit.
 *                    Le sitemap donne une couverture complete des 631 series
 *                    pour une seule requete : c'est mieux, pas un pis-aller.
 *   Detail         : GET /series/comic/<urlSlug>
 *                    -> cle "series" : title, description, coverImage, status,
 *                       type, aliases[], genres[{name,slug}], tags[{name,slug}],
 *                       isMature, chapterCount, totalPages, currentPage
 *   Chapitres      : GET /series/comic/<urlSlug>?page=N
 *                    -> cle "chapters" : 100 chapitres/page, ordre croissant.
 *                    `chapterCount` du payload sert de controle de coherence.
 *   Pages images   : GET /series/comic/<urlSlug>/chapter/<number>
 *                    -> URL directes https://media.valirscans.org/series/
 *                       <urlSlug>/<NNNN>/p-<uuid>.webp  (NNNN = numero sur 4
 *                       chiffres). Presentes dans le HTML rendu serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * slug CONTRE urlSlug — le piege qui casse 5 % du catalogue
 * ─────────────────────────────────────────────────────────────────────────────
 * Le payload expose DEUX identifiants par serie. Seul `urlSlug` est un chemin
 * valide. Mesure sur 120 series du catalogue : 6 divergences (5 %). Exemple
 * verifie : slug="the-forgotten-field-novel" contre urlSlug="the-forgotten-field".
 * Or le sitemap publie `slug`, donc ~5 % de ses <loc> ne repondent pas.
 * Une URL fausse ne renvoie pas 404 : elle renvoie 200 avec une coquille vide
 * (~132 Ko au lieu de ~250 Ko, aucune cle "series"), ce qui donnerait une liste
 * vide silencieuse. PARADE : la coquille porte tout de meme le bon
 * <link rel="canonical">. `_fetchSeriesPage` detecte l'absence de donnees, lit
 * le canonical et refait UNE seule requete. Ne pas retirer ce repli.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SITE PARTIELLEMENT PAYANT — ce que cette extension ne fait pas
 * ─────────────────────────────────────────────────────────────────────────────
 * Certains chapitres (en pratique les plus recents) sont payants : le payload
 * les marque isLocked=true, hasAccess=false, coinPrice=100. Mesure sur 16
 * series : 14 en avaient au moins un.
 *
 * Choix assume, et AUCUN contournement :
 *  1. Les chapitres verrouilles RESTENT dans la liste. Les omettre ferait croire
 *     a l'application que l'oeuvre s'arrete au dernier chapitre gratuit.
 *  2. Leur titre est prefixe par "[Locked] ". Le depot n'a aucun champ dedie au
 *     verrouillage (aucune extension existante ne traite ce cas), donc le titre
 *     est le seul canal visible par l'utilisateur. Choix documente ici faute de
 *     mecanisme maison.
 *  3. `getPageList` sur un chapitre verrouille LEVE une exception. Verifie : la
 *     page d'un chapitre verrouille servie a un visiteur anonyme contient ZERO
 *     URL media. Le paywall est applique cote serveur ; il n'y a rien a
 *     contourner et cette extension n'essaie pas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AGENT UTILISATEUR OBLIGATOIRE
 * ─────────────────────────────────────────────────────────────────────────────
 * Ce n'est pas Cloudflare, c'est une liste noire d'agents utilisateur.
 * Mesure : agent "Python-urllib/3.13" -> HTTP 403 ; agent Firefox, agent Chrome
 * mobile, et meme AUCUN agent -> HTTP 200. Un agent navigateur est donc requis,
 * mais aucun cookie ni resolution de defi ne l'est. D'ou cloudflare:false.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LISTE VIDE = ECHEC
 * ─────────────────────────────────────────────────────────────────────────────
 * Regle du depot : on ne rend jamais une liste vide en faisant croire au succes.
 * Chaque etage leve une exception explicite s'il ne parse rien, pour que la
 * panne soit visible au lieu d'etre prise pour un catalogue vide.
 */

var BASE_URL = "https://valirscans.org";
var MEDIA_URL = "https://media.valirscans.org";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "en-US,en;q=0.9",
};

// Types renvoyes par le site pour du texte et non de l'image. Ces series sont
// servies par l'extension roman, pas par celle-ci.
var NOVEL_TYPES = ["WEB_NOVEL", "NOVEL", "LIGHT_NOVEL"];

// Nombre d'entrees par page de catalogue, aligne sur les 24 du site.
var PAGE_SIZE = 24;

// Garde-fou : une serie tres longue ne doit pas declencher 50 requetes.
var MAX_CHAPTER_PAGES = 30;

function absoluteUrl(href) {
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.charAt(0) === "/") return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Le flux RSC echappe les guillemets du JSON en \". On retire cet echappement
 * une seule fois pour obtenir du JSON lisible par sliceJson/JSON.parse.
 */
function decodeRsc(text) {
  if (!text) return "";
  return text.replace(/\\"/g, '"');
}

function decodeEscapes(text) {
  if (!text) return "";
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function stripHtml(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/**
 * Decoupe un litteral JSON complet a partir de son crochet ouvrant, en comptant
 * les niveaux et en ignorant ce qui est entre guillemets.
 * POURQUOI pas une regex : les objets de ce site contiennent des tableaux
 * imbriques ; une regex non gloutonne s'arreterait au premier crochet fermant.
 */
function sliceJson(text, start) {
  var open = text.charAt(start);
  var close = open === "[" ? "]" : "}";
  var depth = 0;
  var inStr = false;
  var esc = false;
  for (var i = start; i < text.length; i++) {
    var c = text.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Retrouve la valeur JSON associee a une cle dans le flux deja desechappe.
 * `wanted` vaut "[" ou "{" pour lever l'ambiguite quand la meme cle existe sous
 * les deux formes ailleurs dans la page.
 */
function findJson(decoded, key, wanted) {
  var needle = '"' + key + '":';
  var from = 0;
  while (true) {
    var i = decoded.indexOf(needle, from);
    if (i === -1) return null;
    var j = i + needle.length;
    while (j < decoded.length && /\s/.test(decoded.charAt(j))) j++;
    var c = decoded.charAt(j);
    if ((c === "[" || c === "{") && (!wanted || c === wanted)) {
      var raw = sliceJson(decoded, j);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch (e) {
          // Bloc tronque par le decoupage du flux : on tente l'occurrence suivante.
        }
      }
    }
    from = i + needle.length;
  }
}

function findNumber(decoded, key) {
  var m = decoded.match(new RegExp('"' + key + '":\\s*(-?\\d+)'));
  return m ? parseInt(m[1], 10) : null;
}

function isNovelType(type) {
  return NOVEL_TYPES.indexOf(String(type || "").toUpperCase()) !== -1;
}

function mapStatus(raw) {
  var s = String(raw || "").toUpperCase();
  if (s === "ONGOING") return "ongoing";
  if (s === "COMPLETED" || s === "FINISHED") return "completed";
  if (s === "HIATUS" || s === "ON_HOLD") return "hiatus";
  if (s === "DROPPED" || s === "CANCELLED" || s === "CANCELED") return "abandoned";
  return "unknown";
}

/**
 * Le payload rend les couvertures en chemin relatif "/uploads/series/...".
 * Verifie : ce chemin repond sur le site (valirscans.org/uploads/...) et le
 * meme fichier repond sur l'hote media SANS le segment /uploads
 * (media.valirscans.org/series/...). On garde la forme du site, la seule que
 * l'on puisse deduire du champ sans reecriture hasardeuse.
 */
function coverUrl(coverImage) {
  if (!coverImage) return "";
  return absoluteUrl(coverImage);
}

/** Numero de chapitre tel que le site l'attend dans l'URL et sur 4 chiffres. */
function chapterSegment(num) {
  var n = Number(num);
  if (!isFinite(n)) return String(num);
  return String(n);
}

function padChapter(num) {
  var n = Math.floor(Number(num));
  var s = String(n);
  while (s.length < 4) s = "0" + s;
  return s;
}

class DefaultExtension extends MProvider {
  get name() {
    return "ValirScans";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get supportsLatest() {
    return true;
  }
  get isMature() {
    return false;
  }
  get hasCloudflare() {
    return false;
  }

  // ---------------------------------------------------------------------------
  // SOURCE CATALOGUE : le sitemap officiel
  // ---------------------------------------------------------------------------

  /**
   * Lit /series-sitemap-1.xml et rend la liste complete des series avec titre
   * reel, couverture absolue et segment de type. Mis en cache sur l'instance :
   * une recherche ne doit pas retelecharger le sitemap a chaque page.
   */
  async _catalogue() {
    if (this._cat) return this._cat;

    var xml = await fetchv2(BASE_URL + "/series-sitemap-1.xml", { headers: HEADERS });
    var entries = [];
    var blockRe = /<url>([\s\S]*?)<\/url>/g;
    var m;
    while ((m = blockRe.exec(xml)) !== null) {
      var block = m[1];
      var loc = block.match(/<loc>([^<]+)<\/loc>/);
      if (!loc) continue;
      var url = loc[1].trim();
      var kindMatch = url.match(/\/series\/(comic|novel)\//);
      if (!kindMatch) continue;
      var title = block.match(/<image:title>([^<]*)<\/image:title>/);
      var cover = block.match(/<image:loc>([^<]+)<\/image:loc>/);
      var lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/);
      entries.push({
        url: url,
        kind: kindMatch[1],
        title: title ? stripHtml(title[1]) : "",
        cover: cover ? cover[1].trim() : "",
        lastmod: lastmod ? Date.parse(lastmod[1]) || 0 : 0,
      });
    }

    if (entries.length === 0) {
      throw new Error(
        "ValirScans : sitemap /series-sitemap-1.xml illisible (0 entree). " +
          "Le format a change ou la requete a ete refusee."
      );
    }

    this._cat = entries;
    return entries;
  }

  /** Series de type image uniquement (segment /series/comic/). */
  async _comics() {
    var all = await this._catalogue();
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].kind === "comic") out.push(all[i]);
    return out;
  }

  _slice(entries, page) {
    var p = Math.max(1, parseInt(page, 10) || 1);
    var start = (p - 1) * PAGE_SIZE;
    var slice = entries.slice(start, start + PAGE_SIZE);
    var list = [];
    for (var i = 0; i < slice.length; i++) {
      var e = slice[i];
      list.push({
        title: e.title || e.url.split("/").pop().replace(/-/g, " "),
        url: e.url,
        imageUrl: e.cover,
      });
    }
    return { list: list, hasNextPage: start + PAGE_SIZE < entries.length };
  }

  // ---------------------------------------------------------------------------
  // CATALOGUE / NOUVEAUTES / RECHERCHE
  // ---------------------------------------------------------------------------

  /**
   * Catalogue du site : /series?page=N. On prefere cette route au sitemap pour
   * le parcours principal parce qu'elle rend `urlSlug`, donc des chemins
   * toujours valides (le sitemap, lui, publie `slug`).
   */
  async getPopular(page) {
    var p = Math.max(1, parseInt(page, 10) || 1);
    var html = await fetchv2(BASE_URL + "/series?page=" + p, { headers: HEADERS });
    var decoded = decodeRsc(html);

    var series = findJson(decoded, "initialSeries", "[");
    if (!Array.isArray(series) || series.length === 0) {
      throw new Error(
        "ValirScans : cle 'initialSeries' absente de /series?page=" +
          p +
          ". Le catalogue rendu serveur a change."
      );
    }

    var total = findNumber(decoded, "resultCount") || 0;
    var list = [];
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      if (!s || !s.title) continue;
      if (isNovelType(s.type)) continue; // sert l'extension roman
      var slug = s.urlSlug || s.slug;
      if (!slug) continue;
      list.push({
        title: s.title,
        url: BASE_URL + "/series/comic/" + slug,
        imageUrl: coverUrl(s.coverImage),
        isMature: s.isMature === true,
      });
    }

    if (list.length === 0) {
      throw new Error(
        "ValirScans : /series?page=" + p + " n'a rendu aucune serie exploitable."
      );
    }

    return { list: list, hasNextPage: total > p * PAGE_SIZE };
  }

  /** Nouveautes : le sitemap est deja trie du lastmod le plus recent au plus ancien. */
  async getLatestUpdates(page) {
    var comics = await this._comics();
    var sorted = comics.slice().sort(function (a, b) {
      return b.lastmod - a.lastmod;
    });
    var res = this._slice(sorted, page);
    if (res.list.length === 0) {
      throw new Error("ValirScans : aucune nouveaute extraite du sitemap.");
    }
    return res;
  }

  async search(query, page, filters) {
    var q = String(query || "").toLowerCase().trim();
    var comics = await this._comics();

    if (!q) return this._slice(comics, page);

    // Correspondance sur tous les mots de la requete, dans le titre ou le slug.
    var words = q.split(/\s+/);
    var matches = [];
    for (var i = 0; i < comics.length; i++) {
      var e = comics[i];
      var hay = (e.title + " " + e.url).toLowerCase();
      var ok = true;
      for (var w = 0; w < words.length; w++) {
        if (hay.indexOf(words[w]) === -1) {
          ok = false;
          break;
        }
      }
      if (ok) matches.push(e);
    }

    return this._slice(matches, page);
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------

  /**
   * Recupere une page serie et rend {decoded, url}. Si la page ne porte aucune
   * donnee (cas slug/urlSlug decrit en tete de fichier), suit le
   * <link rel="canonical"> et refait UNE seule requete.
   */
  async _fetchSeriesPage(url, suffix) {
    var target = url + (suffix || "");
    var html = await fetchv2(target, { headers: HEADERS });
    var decoded = decodeRsc(html);

    if (decoded.indexOf('"chapterCount":') !== -1 || findJson(decoded, "series", "{")) {
      return { decoded: decoded, url: url };
    }

    var canon = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
    if (canon) {
      var fixed = canon[1].replace(/\/$/, "");
      if (fixed && fixed !== url) {
        var retryHtml = await fetchv2(fixed + (suffix || ""), { headers: HEADERS });
        return { decoded: decodeRsc(retryHtml), url: fixed };
      }
    }

    return { decoded: decoded, url: url };
  }

  async getMangaDetail(url) {
    var full = url.indexOf("http") === 0 ? url : absoluteUrl(url);
    var res = await this._fetchSeriesPage(full);
    var s = findJson(res.decoded, "series", "{");

    if (!s || !s.title) {
      throw new Error(
        "ValirScans : cle 'series' absente de " + full + ". Page serie non parsable."
      );
    }

    var genres = [];
    var pushAll = function (arr) {
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        var g = arr[i];
        var name = g && (g.name || (g.genre && g.genre.name)) ? g.name || g.genre.name : null;
        if (name && genres.indexOf(name) === -1) genres.push(name);
      }
    };
    pushAll(s.genres);
    pushAll(s.tags);
    if (s.type && genres.indexOf(s.type) === -1) genres.push(s.type);

    // Le site n'expose pas de champ auteur/artiste sur la page serie : seule
    // l'equipe de traduction est publiee. On la remonte plutot que rien.
    var authors = [];
    if (s.team && s.team.name) authors.push(s.team.name);

    var description = decodeEscapes(s.description || "");
    if (Array.isArray(s.aliases) && s.aliases.length) {
      description += "\n\nAlternative titles: " + s.aliases.join(", ");
    }

    return {
      title: s.title,
      url: res.url,
      imageUrl: coverUrl(s.coverImage),
      description: stripHtml(description),
      status: mapStatus(s.status),
      genres: genres,
      authors: authors,
      isMature: s.isMature === true,
    };
  }

  // ---------------------------------------------------------------------------
  // CHAPITRES
  // ---------------------------------------------------------------------------

  async getChapterList(url) {
    var full = url.indexOf("http") === 0 ? url : absoluteUrl(url);
    var first = await this._fetchSeriesPage(full);
    var seriesUrl = first.url;

    var expected = findNumber(first.decoded, "chapterCount");
    var totalPages = findNumber(first.decoded, "totalPages") || 1;

    var collected = findJson(first.decoded, "chapters", "[") || [];

    // Le site pagine a 100 chapitres. On suit sa propre valeur totalPages.
    var pages = Math.min(totalPages, MAX_CHAPTER_PAGES);
    for (var p = 2; p <= pages; p++) {
      var next = await fetchv2(seriesUrl + "?page=" + p, { headers: HEADERS });
      var more = findJson(decodeRsc(next), "chapters", "[");
      if (Array.isArray(more) && more.length) collected = collected.concat(more);
    }

    // Une serie sans chapitre publie est un etat legitime du site : chapterCount
    // vaut alors 0 et totalPages 0, tout est coherent. Ce n'est pas une panne.
    if (collected.length === 0) {
      if (expected === 0) return [];
      throw new Error(
        "ValirScans : 0 chapitre extrait de " +
          seriesUrl +
          " alors que chapterCount=" +
          expected +
          ". Le parseur de chapitres est casse."
      );
    }

    var seen = {};
    var out = [];
    for (var i = 0; i < collected.length; i++) {
      var ch = collected[i];
      if (!ch || ch.number === undefined || ch.number === null) continue;
      var num = ch.number;
      if (seen[num]) continue;
      seen[num] = true;

      var title = ch.title && String(ch.title).trim() ? String(ch.title).trim() : "Chapter " + num;

      // Chapitre payant : conserve dans la liste et signale par son titre.
      // Voir l'en-tete du fichier : aucun champ dedie n'existe dans ce depot.
      if (ch.isLocked === true) title = "[Locked] " + title;

      out.push({
        title: title,
        url: seriesUrl + "/chapter/" + chapterSegment(num),
        number: Number(num),
        dateUpload: ch.publishedAt ? Date.parse(ch.publishedAt) || 0 : 0,
      });
    }

    if (out.length === 0) {
      throw new Error(
        "ValirScans : chapitres trouves mais aucun exploitable sur " + seriesUrl + "."
      );
    }

    // Convention du depot : le plus recent en tete.
    out.reverse();
    return out;
  }

  // ---------------------------------------------------------------------------
  // PAGES IMAGES
  // ---------------------------------------------------------------------------

  async getPageList(url) {
    var full = url.indexOf("http") === 0 ? url : absoluteUrl(url);
    var html = await fetchv2(full, { headers: HEADERS });

    // Les URL sont rendues serveur, en clair, sur l'hote media.
    var re = new RegExp(MEDIA_URL.replace(/\./g, "\\.") + "/series/[^\"'\\\\\\s)]+", "g");
    var found = html.match(re) || [];

    var seen = {};
    var pages = [];
    for (var i = 0; i < found.length; i++) {
      var u = found[i];
      // Ne garder que les planches : /series/<slug>/<NNNN>/p-<uuid>.<ext>
      if (!/\/\d{4}\/p-[0-9a-f-]+\.(webp|jpg|jpeg|png|avif)$/i.test(u)) continue;
      if (seen[u]) continue;
      seen[u] = true;
      pages.push({
        index: pages.length,
        imageUrl: u,
        headers: { Referer: BASE_URL + "/", "User-Agent": HEADERS["User-Agent"] },
      });
    }

    if (pages.length === 0) {
      var decoded = decodeRsc(html);
      // Verifie : la page d'un chapitre payant ne contient AUCUNE URL media pour
      // un visiteur anonyme. On le dit clairement au lieu de rendre une liste vide.
      if (decoded.indexOf('"isLocked":true') !== -1 || decoded.indexOf('"hasAccess":false') !== -1) {
        throw new Error(
          "ValirScans : chapitre payant (isLocked). Aucune image n'est servie a un " +
            "visiteur anonyme ; cette extension ne contourne pas le paiement."
        );
      }
      throw new Error(
        "ValirScans : aucune image trouvee sur " +
          full +
          ". Le motif media.valirscans.org/series/<slug>/<NNNN>/p-<uuid>.webp a change."
      );
    }

    return pages;
  }

  getFilterList() {
    return [];
  }
}
