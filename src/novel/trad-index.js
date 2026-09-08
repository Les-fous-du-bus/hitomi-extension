/**
 * Trad-Index — Extension Hitomi Reader
 * Source : https://trad-index.com
 * Type : Scraping HTML rendu cote serveur + JSON-LD schema.org
 * Langue : FR
 * Cloudflare : NON
 * Mature : partiel
 *
 * Architecture relevee le 2026-09-08, chaque point par un appel reel :
 *   - Catalogue  : /catalogue?page={N}          24 fiches par page, 24 pages
 *   - Recherche  : /catalogue?q={terme}&page={N}
 *   - Fiche      : /oeuvre/{slug}               JSON-LD @type Book + liens chapitre
 *   - Chapitre   : /oeuvre/{slug}/chapitre/{n}  texte dans .chapter-content
 *
 * Le site est un index de traductions francaises, mais il HEBERGE les chapitres :
 * verifie a l'appel, /chapitre/56 rend 9720 caracteres de francais sans renvoyer
 * vers un site tiers. C'est ce qui le distingue de Novel-Index, qui redirige.
 *
 * TROIS CHOIX CONTRE-INTUITIFS, tous mesures :
 *
 * 1. Le titre vient d'un <span> du corps de la carte. Il n'est ni dans un
 *    attribut title, ni dans l'alt de la couverture (vide), et le deduire du
 *    slug perdrait accents et apostrophes : « la-fille-a-l-epee-brisee » ne
 *    redonne pas « La Fille à l'Épée Brisée ». La carte contient trois <span> —
 *    le compteur de chapitres, le titre, le nom de l'equipe — et il faut prendre
 *    le bon.
 *
 * 2. La couverture passe par le mandataire d'images du site
 *    (/_next/image?url=<encode>). On decode ce parametre pour aller a la source.
 *    Sinon chaque vignette du catalogue fait travailler ce mandataire, qui peut
 *    limiter la cadence, et l'adresse depend d'un chemin interne au site.
 *
 * 3. La liste de chapitres est DEDUITE du numero le plus haut. Mesure sur trois
 *    oeuvres (155, 38 et 3 chapitres) : les numeros sont contigus de 1 au
 *    maximum, sans un seul trou, et le maximum figure toujours sur la premiere
 *    page grace au lien de navigation vers le dernier chapitre. Une requete
 *    remplace donc les quatre pages de l'onglet des chapitres.
 *
 * Le parametre de recherche est `q`. Il est declare par le formulaire du site, et
 * c'est le seul qui filtre : `recherche`, `search` et `titre` sont ignores et
 * rendent le catalogue entier, ce qui ressemble a un succes.
 *
 * @version 1.0.0
 */

const BASE_URL = "https://trad-index.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": BASE_URL + "/",
};

function decodeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&#0?39;|&apos;|&rsquo;|&#x27;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&hellip;/g, "...")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
    .replace(/&ndash;|&#8211;|&#x2013;/gi, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&amp;/g, "&");
}

function stripTags(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ramene une couverture a sa source.
 *
 * Le site sert ses images a travers /_next/image?url=<adresse encodee>. Garder
 * cette forme ferait passer chaque vignette par ce mandataire et lierait
 * l'extension a un chemin interne du site. On decode donc le parametre.
 */
function couvertureSource(href) {
  if (!href) return "";
  var propre = decodeHtml(href);
  if (propre.indexOf("/_next/image") !== -1) {
    var m = propre.match(/[?&]url=([^&]+)/);
    if (m) {
      var source = decodeURIComponent(m[1]);
      if (source.indexOf("http") === 0) return source;
      if (source.charAt(0) === "/") return BASE_URL + source;
    }
  }
  if (propre.indexOf("data:") === 0) return "";
  if (propre.indexOf("http") === 0) return propre;
  if (propre.indexOf("//") === 0) return "https:" + propre;
  if (propre.charAt(0) === "/") return BASE_URL + propre;
  return "";
}

class DefaultExtension extends MProvider {
  get id() { return "trad-index"; }
  get name() { return "Trad-Index"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }

  _page(page) {
    var n = parseInt(page || 1, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    return this._liste("/catalogue?page=" + this._page(page));
  }

  async getLatestUpdates(page) {
    return this._liste("/catalogue?tri=recent&page=" + this._page(page));
  }

  async search(query, page, _filters) {
    // `q` est le seul parametre qui filtre. Les autres rendent le catalogue
    // entier, ce qui passerait pour un succes.
    return this._liste("/catalogue?q=" + encodeURIComponent(query || "") +
      "&page=" + this._page(page));
  }

  async _liste(chemin) {
    var html = await fetchv2(BASE_URL + chemin, { headers: HEADERS });
    if (typeof html !== "string") return { list: [], hasNextPage: false };

    var list = [];
    var vues = {};

    var motif = /<a\s+class="[^"]*"\s+href="\/oeuvre\/([^"\/?#]+)"\s*>/g;
    var m;
    while ((m = motif.exec(html)) !== null) {
      var slug = m[1];
      if (vues[slug]) continue;

      var suite = html.slice(motif.lastIndex);
      var ferme = suite.indexOf("</a>");
      var carte = ferme === -1 ? suite.slice(0, 3000) : suite.slice(0, ferme);

      var titre = this._titreDeLaCarte(carte);
      if (!titre) continue;
      vues[slug] = true;

      var img = carte.match(/<img[^>]*?\ssrc="([^"]+)"/);
      list.push({
        title: titre,
        url: BASE_URL + "/oeuvre/" + slug,
        imageUrl: couvertureSource(img ? img[1] : ""),
        isMature: false,
        genres: [],
      });
    }

    var courante = this._pageCourante(chemin);
    var hasNextPage = new RegExp('catalogue\\?[^"]*page=' + (courante + 1) + '(?:"|&)').test(html);

    return { list: list, hasNextPage: hasNextPage };
  }

  /**
   * Choisit le titre parmi les <span> d'une carte.
   *
   * Une carte porte trois textes : le compteur de chapitres (« 135 ch. »), le
   * titre, et le nom de l'equipe de traduction. On ecarte le compteur par sa
   * forme, et on prend le premier texte restant : le titre precede toujours
   * l'equipe dans le balisage.
   */
  _titreDeLaCarte(carte) {
    var textes = [];
    var motif = /<span\b[^>]*>([^<]{1,160})<\/span>/g;
    var m;
    while ((m = motif.exec(carte)) !== null) {
      var t = decodeHtml(m[1]).trim();
      if (!t) continue;
      if (/^\d+\s*ch\.?$/i.test(t)) continue;
      textes.push(t);
    }
    return textes.length ? textes[0] : "";
  }

  _pageCourante(chemin) {
    var m = chemin.match(/[?&]page=(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  // ─────────────────────────────────────────────
  // FICHE
  // ─────────────────────────────────────────────

  _slug(url) {
    var m = String(url || "").match(/\/oeuvre\/([^/?#]+)/);
    return m ? m[1] : "";
  }

  _livreJsonLd(html) {
    var blocs = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
    for (var i = 0; i < blocs.length; i++) {
      var brut = blocs[i].replace(/^[\s\S]*?>/, "").replace(/<\/script>$/, "");
      var donnees;
      try {
        donnees = JSON.parse(brut);
      } catch (_) {
        continue;
      }
      var noeuds = donnees["@graph"] || (Array.isArray(donnees) ? donnees : [donnees]);
      for (var j = 0; j < noeuds.length; j++) {
        if (noeuds[j] && noeuds[j]["@type"] === "Book") return noeuds[j];
      }
    }
    return null;
  }

  async getMangaDetail(url) {
    var slug = this._slug(url);
    if (!slug) throw new Error("Trad-Index: adresse sans slug d'oeuvre: " + url);

    var html = await fetchv2(BASE_URL + "/oeuvre/" + slug, { headers: HEADERS });
    if (typeof html !== "string" || !html) {
      throw new Error("Trad-Index: page vide pour " + slug);
    }

    var livre = this._livreJsonLd(html) || {};

    var titre = livre.name || "";
    if (!titre) {
      var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      titre = h1 ? decodeHtml(stripTags(h1[1])) : slug.replace(/-/g, " ");
    }

    var couverture = "";
    var img = html.match(/<img[^>]*?\ssrc="([^"]*_next\/image[^"]*)"/) ||
              html.match(/property="og:image"\s+content="([^"]+)"/);
    if (img) couverture = couvertureSource(img[1]);

    var auteurs = [];
    var a = livre.author;
    if (Array.isArray(a)) {
      for (var i = 0; i < a.length; i++) {
        var nom = typeof a[i] === "string" ? a[i] : (a[i] && a[i].name);
        if (nom) auteurs.push(decodeHtml(nom));
      }
    } else if (a && a.name) {
      auteurs.push(decodeHtml(a.name));
    }

    return {
      title: decodeHtml(titre),
      url: BASE_URL + "/oeuvre/" + slug,
      imageUrl: couverture,
      description: decodeHtml(livre.description || ""),
      status: "unknown",
      genres: Array.isArray(livre.genre) ? livre.genre.slice() : (livre.genre ? [livre.genre] : []),
      authors: auteurs,
      isMature: false,
    };
  }

  // ─────────────────────────────────────────────
  // CHAPITRES
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    var slug = this._slug(url);
    if (!slug) throw new Error("Trad-Index: adresse sans slug d'oeuvre: " + url);

    var html = await fetchv2(BASE_URL + "/oeuvre/" + slug, { headers: HEADERS });
    if (typeof html !== "string") return [];

    var numeros = [];
    var motif = new RegExp('/oeuvre/' + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      '/chapitre/(\\d+)"', "g");
    var m;
    while ((m = motif.exec(html)) !== null) numeros.push(parseInt(m[1], 10));
    if (!numeros.length) return [];

    var dernier = Math.max.apply(null, numeros);
    var chapitres = [];
    for (var n = dernier; n >= 1; n--) {
      chapitres.push({
        title: "Chapitre " + n,
        url: BASE_URL + "/oeuvre/" + slug + "/chapitre/" + n,
        number: n,
        dateUpload: Date.now(),
        scanlator: "Trad-Index",
      });
    }
    return chapitres;
  }

  // ─────────────────────────────────────────────
  // LECTURE
  // ─────────────────────────────────────────────

  async getContent(url) {
    var html = await fetchv2(url, { headers: HEADERS });
    if (typeof html !== "string" || !html) {
      throw new Error("Trad-Index: page de chapitre vide: " + url);
    }

    var debut = html.indexOf('class="chapter-content"');
    if (debut === -1) {
      throw new Error("Trad-Index: conteneur .chapter-content absent de " + url +
        " — mise en page changee, ou chapitre indisponible");
    }
    var apres = html.slice(html.indexOf(">", debut) + 1);

    var paragraphes = apres.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || [];
    var utiles = [];
    for (var i = 0; i < paragraphes.length; i++) {
      if (stripTags(paragraphes[i]).length > 0) utiles.push(paragraphes[i]);
    }
    if (!utiles.length) {
      throw new Error("Trad-Index: aucun paragraphe dans .chapter-content pour " + url);
    }
    return utiles.join("\n");
  }

  async getHtmlContent(_name, url) {
    return this.getContent(url);
  }

  getFilterList() {
    return [];
  }
}
