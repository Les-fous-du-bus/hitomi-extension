/**
 * LightNovelVF — Extension Hitomi Reader
 * Source : https://www.lightnovelvf.com
 * Type : Scraping HTML + JSON-LD schema.org
 * Langue : FR
 * Cloudflare : devant le site, mais aucun defi pose (curl nu rend 200)
 * Mature : partiel
 *
 * Architecture relevee le 2026-09-08, chaque point par un appel reel :
 *   - Catalogue  : /novels-list?page={N}     30 fiches par page, 48 pages
 *   - Recherche  : /novels-list?search={q}&page={N}
 *   - Fiche      : /novel/{slug}             JSON-LD @type Book + #chapters-list
 *   - Chapitre   : /novel/{slug}/{numero}    texte dans #read-novel
 *
 * DEUX CHOIX CONTRE-INTUITIFS, tous deux mesures :
 *
 * 1. La liste de chapitres est DEDUITE du numero le plus haut. Le site pagine
 *    les chapitres par 30 (`?page=N`) : « Ancient Godly Monarch » en compte
 *    2053, soit 69 requetes pour une seule liste. Or les numeros sont des
 *    entiers strictement contigus de 1 au maximum (verifie sur deux oeuvres,
 *    pages 1, 2, 69 et 70 : pas de 1, page 69 finit a 1, page 70 vide), et la
 *    liste du site ne porte AUCUN titre de chapitre — seulement le numero et la
 *    date. Deduire ne perd donc rien et coute une requete au lieu de 69.
 *    Si le site introduit un jour un chapitre 10.5, cette deduction casse : le
 *    test `la liste de chapitres est deduite du plus haut numero` est la pour
 *    forcer la relecture de ce choix.
 *
 * 2. La fiche est lue dans le JSON-LD, pas dans la mise en page. Le site pose un
 *    bloc `@type: Book` complet (nom, description, auteur, genres). Une refonte
 *    visuelle du theme ne le casse pas, alors qu'elle casserait des selecteurs.
 *
 * L'hote canonique porte `www.` : les liens absolus du site l'utilisent, et
 * l'omettre provoque une redirection a chaque appel.
 *
 * @version 1.0.0
 */

const BASE_URL = "https://www.lightnovelvf.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": BASE_URL + "/",
};

function decodeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&hellip;/g, "...")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&amp;/g, "&");
}

/**
 * Rend une adresse absolue, et refuse les images en ligne.
 *
 * POURQUOI le refus : le site charge ses couvertures paresseusement. L'attribut
 * `src` porte un pixel transparent en base64 et la vraie adresse vit dans
 * `data-src`. Rendre le pixel afficherait un catalogue de vignettes vides sans
 * qu'aucune erreur ne le signale.
 */
function urlAbsolue(href) {
  if (!href) return "";
  if (href.indexOf("data:") === 0) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.charAt(0) === "/") return BASE_URL + href;
  return BASE_URL + "/" + href;
}

function stripTags(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class DefaultExtension extends MProvider {
  get id() { return "lightnovelvf"; }
  get name() { return "LightNovelVF"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  // Cloudflare est devant le site mais ne pose aucun defi. On le declare quand
  // meme : le jour ou il en pose un, l'app saura passer par son navigateur.
  get hasCloudflare() { return true; }

  _fetchText(chemin) {
    return fetchv2(BASE_URL + chemin, { headers: HEADERS });
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    return this._liste("/novels-list?page=" + this._page(page));
  }

  async getLatestUpdates(page) {
    return this._liste("/novels-list?sort=update&sort_dir=desc&page=" + this._page(page));
  }

  async search(query, page, _filters) {
    return this._liste("/novels-list?search=" + encodeURIComponent(query || "") +
      "&page=" + this._page(page));
  }

  _page(page) {
    var n = parseInt(page || 1, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }

  async _liste(chemin) {
    var html = await this._fetchText(chemin);
    if (typeof html !== "string") return { list: [], hasNextPage: false };

    var vues = {};
    var list = [];

    // Une carte de catalogue porte le titre dans aria-label ET dans l'alt de sa
    // couverture. On prend aria-label : le slug perdrait la ponctuation, et
    // « [VRMMO] Chaos Doctor » deviendrait « vrmmo chaos doctor ».
    //
    // On ne capture QUE la balise ouvrante, puis on va chercher la couverture
    // dans ce qui suit, borne par la carte suivante. Une premiere version
    // bornait l'interieur a 600 caracteres : les cartes reelles en font plus de
    // 600 et la liste revenait vide. Un plafond en dur sur du HTML d'autrui est
    // un piege — la borne est ici la carte suivante, qui existe toujours.
    var motif = /<a\s+href="(?:https:\/\/www\.lightnovelvf\.com)?\/novel\/([^"\/?#]+)"([^>]*)>/g;
    var m;
    while ((m = motif.exec(html)) !== null) {
      var attributs = m[2] || "";
      var etiquette = attributs.match(/aria-label="([^"]*)"/);
      // Sans aria-label, ce n'est pas une carte de catalogue mais un lien de
      // navigation vers la meme oeuvre (fil d'Ariane, « vous pourriez aimer »).
      if (!etiquette) continue;

      var slug = m[1];
      if (vues[slug]) continue;
      vues[slug] = true;

      var suite = html.slice(motif.lastIndex);
      var prochaine = suite.search(/<a\s+href="(?:https:\/\/www\.lightnovelvf\.com)?\/novel\//);
      var interieur = prochaine === -1 ? suite : suite.slice(0, prochaine);

      // La couverture est chargee paresseusement : l'adresse peut etre dans src
      // ou dans data-src selon l'etat du chargement.
      var lazy = interieur.match(/<img[^>]*?\sdata-src="([^"]+)"/);
      var direct = interieur.match(/<img[^>]*?\ssrc="([^"]+)"/);
      var couverture = urlAbsolue(lazy ? lazy[1] : "");
      if (!couverture) couverture = urlAbsolue(direct ? direct[1] : "");

      list.push({
        title: decodeHtml(etiquette[1]) || slug.replace(/-/g, " "),
        url: BASE_URL + "/novel/" + slug,
        imageUrl: couverture,
        isMature: false,
        genres: [],
      });
    }

    // La page suivante est lue dans la pagination du site plutot que deduite du
    // nombre de fiches : la derniere page en contient moins de 30 mais rien ne
    // garantit qu'une page pleine soit suivie d'une autre.
    var courante = this._pageCourante(chemin);
    var hasNextPage = html.indexOf('novels-list?') !== -1 &&
      new RegExp('novels-list\\?[^"]*page=' + (courante + 1) + '(?:"|&)').test(html);

    return { list: list, hasNextPage: hasNextPage };
  }

  _pageCourante(chemin) {
    var m = chemin.match(/[?&]page=(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  // ─────────────────────────────────────────────
  // FICHE
  // ─────────────────────────────────────────────

  _slug(url) {
    var m = String(url || "").match(/\/novel\/([^/?#]+)/);
    return m ? m[1] : "";
  }

  /**
   * Extrait le bloc Book du JSON-LD. Le site pose un @graph contenant plusieurs
   * types (Book, WebPage, BreadcrumbList) ; on ne garde que Book.
   */
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
    if (!slug) throw new Error("LightNovelVF: adresse sans slug d'oeuvre: " + url);

    var html = await this._fetchText("/novel/" + slug);
    if (typeof html !== "string" || !html) {
      throw new Error("LightNovelVF: page vide pour " + slug);
    }
    return this._detailDepuisHtml(slug, html);
  }

  _detailDepuisHtml(slug, html) {
    var livre = this._livreJsonLd(html) || {};

    var titre = livre.name || "";
    if (!titre) {
      var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      titre = h1 ? decodeHtml(stripTags(h1[1])) : slug.replace(/-/g, " ");
    }

    var couverture = "";
    var og = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (og) couverture = urlAbsolue(og[1]);
    if (!couverture && livre.image && typeof livre.image === "string") {
      couverture = urlAbsolue(livre.image);
    }
    if (!couverture) {
      var lazy = html.match(/<img[^>]*?\sdata-src="([^"]*\/uploads\/[^"]+)"/);
      if (lazy) couverture = urlAbsolue(lazy[1]);
    }

    var auteurs = [];
    var brutAuteurs = livre.author;
    if (Array.isArray(brutAuteurs)) {
      for (var i = 0; i < brutAuteurs.length; i++) {
        var a = brutAuteurs[i];
        var nom = typeof a === "string" ? a : (a && a.name);
        if (nom) auteurs.push(decodeHtml(nom));
      }
    } else if (brutAuteurs && brutAuteurs.name) {
      auteurs.push(decodeHtml(brutAuteurs.name));
    }

    var genres = Array.isArray(livre.genre) ? livre.genre.slice()
      : (livre.genre ? [livre.genre] : []);

    return {
      title: decodeHtml(titre),
      url: BASE_URL + "/novel/" + slug,
      imageUrl: couverture,
      description: decodeHtml(livre.description || ""),
      status: this._statut(html),
      genres: genres,
      authors: auteurs,
      isMature: false,
    };
  }

  /**
   * Le statut n'est pas dans le JSON-LD. Il apparait en clair pres du compteur
   * de chapitres. Attention : le site embarque un dictionnaire de traduction qui
   * contient les memes mots, donc on ne cherche que dans la zone du compteur.
   */
  _statut(html) {
    var zone = html.match(/([\d,\s]+chapitres[\s\S]{0,220})/);
    var texte = zone ? stripTags(zone[1]) : "";
    if (/\bTerminé\b|\bTermine\b/i.test(texte)) return "completed";
    if (/\bAbandonné\b|\bAbandonne\b/i.test(texte)) return "canceled";
    if (/\bEn cours\b/i.test(texte)) return "ongoing";
    return "unknown";
  }

  // ─────────────────────────────────────────────
  // CHAPITRES
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    var slug = this._slug(url);
    if (!slug) throw new Error("LightNovelVF: adresse sans slug d'oeuvre: " + url);

    var html = await this._fetchText("/novel/" + slug);
    if (typeof html !== "string") return [];
    return this._chapitresDepuisHtml(slug, html);
  }

  _chapitresDepuisHtml(slug, html) {
    // La page servie ne contient que la premiere tranche de 30 chapitres, la
    // plus recente. Son numero le plus haut est donc le total.
    var numeros = [];
    var motif = /data-num="(\d+)"/g;
    var m;
    while ((m = motif.exec(html)) !== null) numeros.push(parseInt(m[1], 10));
    if (!numeros.length) return [];

    var dernier = Math.max.apply(null, numeros);
    var chapitres = [];
    for (var n = dernier; n >= 1; n--) {
      chapitres.push({
        title: "Chapitre " + n,
        url: BASE_URL + "/novel/" + slug + "/" + n,
        number: n,
        dateUpload: Date.now(),
        scanlator: "LightNovelVF",
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
      throw new Error("LightNovelVF: page de chapitre vide: " + url);
    }

    var debut = html.indexOf('id="read-novel"');
    if (debut === -1) {
      throw new Error("LightNovelVF: conteneur #read-novel absent de " + url +
        " — mise en page changee, ou chapitre indisponible");
    }
    // Depuis l'ouverture de la balise jusqu'a la barre de navigation de chapitre,
    // qui suit immediatement le texte. Decouper sur le </div> correspondant
    // demanderait de compter les imbrications pour rien : la borne est stable.
    var apres = html.slice(html.indexOf(">", debut) + 1);
    var fin = apres.indexOf("lnv-chap-nav");
    var corps = fin === -1 ? apres : apres.slice(0, fin);

    // On garde les paragraphes, on jette le reste : la zone contient aussi des
    // boutons et des encarts que le lecteur n'a pas a afficher.
    var paragraphes = corps.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || [];
    var utiles = [];
    for (var i = 0; i < paragraphes.length; i++) {
      if (stripTags(paragraphes[i]).length > 0) utiles.push(paragraphes[i]);
    }
    if (!utiles.length) {
      throw new Error("LightNovelVF: aucun paragraphe dans #read-novel pour " + url);
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
