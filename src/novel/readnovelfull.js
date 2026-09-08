/**
 * ReadNovelFull — Extension Hitomi Reader
 * Source : https://readnovelfull.com
 * Type : Scraping HTML + une adresse interne rendant toute la liste de chapitres
 * Langue : EN
 * Cloudflare : NON (curl nu rend 200, aucun marqueur de defi)
 * Mature : partiel
 *
 * Architecture relevee le 2026-09-08, chaque point par un appel reel :
 *   - Catalogue  : /novel-list/most-popular-novel?page={N}   ~120 pages
 *   - Recents    : /novel-list/latest-release-novel?page={N}
 *   - Recherche  : /novel-list/search?keyword={q}&page={N}   (/search rend 404)
 *   - Fiche      : /{slug}-v1.html   (identifiant interne dans data-novel-id)
 *   - Chapitres  : /ajax/chapter-archive?novelId={id}   TOUS d'un coup
 *   - Chapitre   : /{slug}/chapter-{n}-{titre}-v1.html   texte dans #chr-content
 *
 * LE POINT QUI MERITE UNE EXPLICATION : `/ajax/chapter-archive`.
 * Cette adresse n'est ecrite nulle part dans les pages du site — elle a ete
 * trouvee a l'essai. Elle rend les 2053 chapitres d'« Ancient Godly Monarch »
 * en une seule requete de 570 ko, avec leurs vrais titres. L'alternative serait
 * de suivre la pagination de la fiche, qui n'en montre que 31 a la fois.
 * Elle depend d'un identifiant numerique interne (`data-novel-id`). Si cet
 * identifiant disparait, l'extension le DIT au lieu de rendre une liste vide :
 * un site qui change de forme doit se voir tout de suite.
 *
 * Le numero de chapitre est extrait de son titre, pas de sa position dans la
 * liste. La position dirait 1, 2, 3 pour trois chapitres echantillonnes ; le
 * recit dit 1, 2, 2053. Se tromper la casse la reprise de lecture.
 *
 * @version 1.0.0
 */

const BASE_URL = "https://readnovelfull.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
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

function urlAbsolue(href) {
  if (!href) return "";
  if (href.indexOf("data:") === 0) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.charAt(0) === "/") return BASE_URL + href;
  return BASE_URL + "/" + href;
}

class DefaultExtension extends MProvider {
  get id() { return "readnovelfull"; }
  get name() { return "ReadNovelFull"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }

  _page(page) {
    var n = parseInt(page || 1, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }

  _fetchText(chemin) {
    return fetchv2(BASE_URL + chemin, { headers: HEADERS });
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    return this._liste("/novel-list/most-popular-novel?page=" + this._page(page));
  }

  async getLatestUpdates(page) {
    return this._liste("/novel-list/latest-release-novel?page=" + this._page(page));
  }

  async search(query, page, _filters) {
    // Le chemin vient de l'attribut action du formulaire du site. « /search »
    // seul rend 404 : le prefixe /novel-list/ n'est pas decoratif.
    return this._liste("/novel-list/search?keyword=" + encodeURIComponent(query || "") +
      "&page=" + this._page(page));
  }

  async _liste(chemin) {
    var html = await this._fetchText(chemin);
    if (typeof html !== "string") return { list: [], hasNextPage: false };

    var list = [];
    var vues = {};

    // Chaque fiche est une ligne : la vignette d'abord, le titre ensuite. On
    // part du titre, qui est le seul element obligatoire, et on remonte a la
    // vignette dans ce qui precede.
    var motif = /<h3 class="novel-title"><a href="\/([^"]+)"\s+title="([^"]*)"/g;
    var m;
    while ((m = motif.exec(html)) !== null) {
      var chemin_oeuvre = m[1];
      if (vues[chemin_oeuvre]) continue;
      vues[chemin_oeuvre] = true;

      var avant = html.slice(Math.max(0, m.index - 900), m.index);
      var derniereVignette = avant.lastIndexOf('class="cover"');
      var couverture = "";
      if (derniereVignette !== -1) {
        var zone = avant.slice(Math.max(0, derniereVignette - 300), derniereVignette + 40);
        var img = zone.match(/<img[^>]+src="([^"]+)"[^>]*class="cover"/) ||
                  zone.match(/src="([^"]+)"/);
        if (img) couverture = urlAbsolue(img[1]);
      }

      var apres = html.slice(m.index, m.index + 700);
      var auteur = apres.match(/<span class="author">([\s\S]{0,160}?)<\/span>/);

      list.push({
        title: decodeHtml(m[2]),
        url: BASE_URL + "/" + chemin_oeuvre,
        imageUrl: couverture,
        isMature: false,
        genres: [],
        authors: auteur ? [decodeHtml(stripTags(auteur[1]))] : [],
      });
    }

    // La page suivante est lue dans la pagination du site : la derniere page
    // peut etre pleine sans qu'une suivante existe.
    var courante = this._pageCourante(chemin);
    var hasNextPage = new RegExp('[?&]page=' + (courante + 1) + '(?:"|&|\')').test(html);

    return { list: list, hasNextPage: hasNextPage };
  }

  _pageCourante(chemin) {
    var m = chemin.match(/[?&]page=(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  // ─────────────────────────────────────────────
  // FICHE
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    var html = await fetchv2(url, { headers: HEADERS });
    if (typeof html !== "string" || !html) {
      throw new Error("ReadNovelFull: page vide pour " + url);
    }

    var titre = "";
    var h3 = html.match(/<h3 class="title"[^>]*>([\s\S]*?)<\/h3>/);
    if (h3) titre = decodeHtml(stripTags(h3[1]));
    if (!titre) {
      var og = html.match(/property="og:title"\s+content="([^"]+)"/);
      if (og) titre = decodeHtml(og[1]);
    }

    // La fiche porte deux images : la vignette du menu et la grande couverture
    // en t-300x439. On veut la grande.
    var couverture = "";
    var grande = html.match(/src="([^"]*t-300x439[^"]*)"/);
    if (grande) couverture = urlAbsolue(grande[1]);
    if (!couverture) {
      var ogImg = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogImg) couverture = urlAbsolue(ogImg[1]);
    }

    var description = "";
    var desc = html.match(/class="desc-text"[^>]*>([\s\S]*?)<\/div>/);
    if (desc) description = decodeHtml(stripTags(desc[1]));

    var genres = [];
    var motifGenre = /href="\/genres\/[^"]*"[^>]*>([^<]+)</g;
    var g;
    while ((g = motifGenre.exec(html)) !== null) {
      var nom = decodeHtml(g[1]).trim();
      if (nom && genres.indexOf(nom) === -1) genres.push(nom);
    }

    var auteurs = [];
    var motifAuteur = /href="\/authors\/[^"]*"[^>]*>([^<]+)</g;
    var a;
    while ((a = motifAuteur.exec(html)) !== null) {
      var an = decodeHtml(a[1]).trim();
      if (an && auteurs.indexOf(an) === -1) auteurs.push(an);
    }

    return {
      title: titre,
      url: url,
      imageUrl: couverture,
      description: description,
      status: this._statut(html),
      genres: genres,
      authors: auteurs,
      isMature: false,
    };
  }

  _statut(html) {
    // Le statut suit l'intitule « Status: ». Chercher les mots seuls ailleurs
    // dans la page attraperait les liens du menu de filtrage.
    var zone = html.match(/Status:?<\/h3>([\s\S]{0,220})/);
    var texte = zone ? stripTags(zone[1]) : "";
    if (/\bCompleted\b/i.test(texte)) return "completed";
    if (/\bOngoing\b/i.test(texte)) return "ongoing";
    if (/\bHiatus\b|\bDropped\b/i.test(texte)) return "canceled";
    return "unknown";
  }

  // ─────────────────────────────────────────────
  // CHAPITRES
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    var html = await fetchv2(url, { headers: HEADERS });
    if (typeof html !== "string") {
      throw new Error("ReadNovelFull: page d'oeuvre illisible: " + url);
    }

    var id = html.match(/data-novel-id="(\d+)"/) || html.match(/novelId["\s:=]+["']?(\d+)/);
    if (!id) {
      throw new Error("ReadNovelFull: identifiant interne de l'oeuvre introuvable dans " +
        url + " — la fiche a change de forme, la liste de chapitres passe par cet identifiant");
    }

    var archive = await fetchv2(
      BASE_URL + "/ajax/chapter-archive?novelId=" + id[1],
      { headers: Object.assign({}, HEADERS, {
          "X-Requested-With": "XMLHttpRequest",
          "Referer": url,
        }) });
    if (typeof archive !== "string") return [];

    return this._chapitresDepuisArchive(archive);
  }

  _chapitresDepuisArchive(archive) {
    var chapitres = [];
    var motif = /<a href="\/([^"]+)"\s+title="([^"]*)"/g;
    var m;
    while ((m = motif.exec(archive)) !== null) {
      var titre = decodeHtml(m[2]);
      chapitres.push({
        title: titre,
        url: BASE_URL + "/" + m[1],
        number: this._numeroDeChapitre(titre, m[1]),
        dateUpload: Date.now(),
        scanlator: "ReadNovelFull",
      });
    }
    chapitres.sort(function (x, y) { return y.number - x.number; });
    return chapitres;
  }

  /**
   * Extrait le numero du titre, avec l'adresse en secours. On ne prend PAS la
   * position dans la liste : un extrait de trois chapitres pris au debut, au
   * milieu et a la fin donnerait 1, 2, 3 alors que le recit dit 1, 2, 2053.
   */
  _numeroDeChapitre(titre, chemin) {
    var m = titre.match(/chapter\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!m) m = chemin.match(/chapter-([0-9]+(?:-[0-9]+)?)/i);
    if (!m) return 0;
    return parseFloat(String(m[1]).replace("-", "."));
  }

  // ─────────────────────────────────────────────
  // LECTURE
  // ─────────────────────────────────────────────

  async getContent(url) {
    var html = await fetchv2(url, { headers: HEADERS });
    if (typeof html !== "string" || !html) {
      throw new Error("ReadNovelFull: page de chapitre vide: " + url);
    }

    var debut = html.indexOf('id="chr-content"');
    if (debut === -1) {
      throw new Error("ReadNovelFull: conteneur #chr-content absent de " + url +
        " — mise en page changee, ou chapitre indisponible");
    }
    var apres = html.slice(html.indexOf(">", debut) + 1);
    var fin = apres.indexOf('id="chr-nav-bot"');
    var corps = fin === -1 ? apres : apres.slice(0, fin);

    // Seuls les paragraphes : la zone contient aussi des encarts publicitaires
    // qui n'ont rien a faire dans le lecteur.
    var paragraphes = corps.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || [];
    var utiles = [];
    for (var i = 0; i < paragraphes.length; i++) {
      if (stripTags(paragraphes[i]).length > 0) utiles.push(paragraphes[i]);
    }
    if (!utiles.length) {
      throw new Error("ReadNovelFull: aucun paragraphe dans #chr-content pour " + url);
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
