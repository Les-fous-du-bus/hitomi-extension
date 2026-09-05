/**
 * NovelDeGlace — Extension Hitomi Reader (Light Novel)
 * Source : https://noveldeglace.com
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : partiel (categories Adulte, Yaoi, Yuri)
 *
 * @author @khun — Extension Strategist
 * @version 1.0.1
 *
 * LIVE AUDIT 2026-04-19 (@khun)
 * - Probed /roman/ (mobile UA): 71 <article> cards.
 *   Each exposes `<h2> <a href="/roman/SLUG/"> + <img src>` -- selectors valid.
 * - Entry-title class still present (82 occurrences); theme unchanged.
 * - No selector refactor needed this cycle.
 */

var BASE_URL = "https://noveldeglace.com";

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "");
}

function decodeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, "...")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ndash;/g, "-");
}

// Extrait le contenu d'un <div> dont l'attribut class CONTIENT le nom donne.
//
// POURQUOI un compteur d'imbrication plutot qu'une regex : le corps d'un chapitre
// contient lui-meme des <div> (encarts, accordeons, illustrations). Une regex
// non-gourmande coupe au premier </div> venu, une regex gourmande avale le pied
// de page. Seul le comptage rend le bloc exact.
//
// POURQUOI "contient" et non "vaut" : le theme du site a fait passer l'attribut de
// class="chapter-content" a class="entry-content-chapitre chapter-inner chapter-content".
// Une correspondance exacte ne trouvait plus rien, et l'extension rendait son
// message d'indisponibilite sur tous les chapitres.
function extractDivByClass(html, className) {
  if (!html || !className) return "";
  var open = new RegExp('<div[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>', 'i');
  var m = open.exec(html);
  if (!m) return "";
  var start = m.index + m[0].length;
  var depth = 1;
  var tagRx = /<\/?div\b[^>]*>/gi;
  tagRx.lastIndex = start;
  var t;
  while ((t = tagRx.exec(html)) !== null) {
    if (t[0].charAt(1) === "/") {
      depth--;
      if (depth === 0) return html.substring(start, t.index);
    } else {
      depth++;
    }
  }
  return html.substring(start);
}

// Borne une section reperee par son data-title jusqu'au data-title suivant.
// POURQUOI : la table des matieres est suivie d'autres onglets. Sans borne haute
// on ramassait toute la page ; avec une regex non-gourmande on s'arretait au
// premier tome, d'ou 33 chapitres remontes sur 907 presents.
function sliceByDataTitle(html, title) {
  var anchor = 'data-title="' + title + '"';
  var start = html.indexOf(anchor);
  if (start === -1) return "";
  start += anchor.length;
  var next = html.indexOf('data-title="', start);
  return next === -1 ? html.substring(start) : html.substring(start, next);
}

var MATURE_CATEGORIES = ["adulte", "yaoi", "yuri", "roman pour adulte", "adult"];

class DefaultExtension extends MProvider {
  get name() { return "NovelDeGlace"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/roman/page/" + page;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      return this._parseNovelArticles(res, false);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/chapitre/page/" + page;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      return this._parseNovelArticles(res, true);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      // NovelDeGlace has no search API; fetch all novels and filter
      var url = BASE_URL + "/roman";
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      var all = this._parseNovelArticles(res, false);

      var normalizedQuery = query.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      var filtered = [];
      for (var i = 0; i < all.list.length; i++) {
        var normalizedTitle = all.list[i].title.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (normalizedTitle.indexOf(normalizedQuery) !== -1) {
          filtered.push(all.list[i]);
        }
      }

      return { list: filtered, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + "/" + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Title — complex: text node after strong in entry-content > div
      var titleMatch = res.match(/<div class="entry-content"[^>]*>[^]*?<div[^>]*>[^]*?<strong[^>]*>[^]*?<\/strong>\s*([^<]+)/s);
      var title = titleMatch ? titleMatch[1].trim() : "";
      if (!title) {
        var altTitle = res.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>(.*?)<\/h1>/s);
        if (altTitle) title = stripTags(altTitle[1]).trim();
      }
      if (!title) title = "Unknown";

      // Cover — .su-row img
      var coverMatch = res.match(/<div class="su-row"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Synopsis — div[data-title=Synopsis]
      var synopsisMatch = res.match(/<div[^>]*data-title="Synopsis"[^>]*>(.*?)<\/div>/s);
      var description = synopsisMatch ? stripTags(synopsisMatch[1]).trim() : "";

      // Author
      var authors = [];
      var authorMatch = res.match(/<strong>Auteur\s*:\s*<\/strong>[^]*?<\/p>/s) ||
                        res.match(/Auteur\s*:\s*([^<]+)/);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[0]).replace(/Auteur\s*:\s*/, "").trim();
        if (authorText) authors.push(authorText);
      }

      // Genres — .categorie and .genre
      var genres = [];
      var catMatch = res.match(/<[^>]*class="categorie"[^>]*>(.*?)<\/[^>]*>/s);
      if (catMatch) {
        var catText = stripTags(catMatch[1]).replace(/Cat.*?:\s*/i, "").trim();
        if (catText && catText !== "Autre") genres.push(catText);
      }
      var genreMatch = res.match(/<[^>]*class="genre"[^>]*>(.*?)<\/[^>]*>/s);
      if (genreMatch) {
        var genreText = stripTags(genreMatch[1]).replace(/Genre\s*:\s*/i, "").trim();
        if (genreText) {
          var parts = genreText.split(",");
          for (var i = 0; i < parts.length; i++) {
            var g = parts[i].trim();
            if (g) genres.push(g);
          }
        }
      }

      // Mature check
      var isMature = false;
      for (var k = 0; k < genres.length; k++) {
        if (MATURE_CATEGORIES.indexOf(genres[k].toLowerCase()) !== -1) {
          isMature = true;
          break;
        }
      }

      // Status — strong:contains('Statut') parent class
      var status = "unknown";
      var statusMatch = res.match(/<[^>]*class="type (etat\d+)"[^>]*>[^]*?Statut/s);
      if (statusMatch) {
        var etat = statusMatch[1];
        if (etat === "etat0" || etat === "etat1") status = "ongoing";
        else if (etat === "etat4") status = "hiatus";
        else if (etat === "etat5") status = "completed";
        else if (etat === "etat6") status = "abandoned";
      }

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: status,
        genres: genres,
        authors: authors,
        isMature: isMature,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + "/" + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      var chapters = [];

      // La table des matieres vit dans la section data-title="Tomes". On la borne
      // sur le data-title suivant plutot que sur une suite de </div> : les tomes
      // sont des accordeons imbriques, et la borne par </div></div></div>
      // s'arretait au premier tome (33 chapitres remontes sur 907 presents).
      var tomesHtml = sliceByDataTitle(res, "Tomes");
      if (!tomesHtml) return [];

      // Tous les chapitres vivent sous /chapitre/. On prend les liens dans l'ordre
      // du document, sans passer par les blocs .chpt : leur decoupage variait d'un
      // tome a l'autre et faisait perdre des entrees.
      var linkRx = /<a[^>]*href="([^"]+\/chapitre\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      var seen = {};
      var chapterIndex = 0;
      var lm;
      while ((lm = linkRx.exec(tomesHtml)) !== null) {
        var chapUrl = lm[1];
        var chapTitle = decodeHtml(stripTags(lm[2])).trim();
        if (!chapUrl || !chapTitle) continue;
        // Un meme chapitre peut etre liste deux fois (raccourci de tome et entree
        // de partie) ; on garde la premiere occurrence.
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Date eventuelle, entre parentheses juste apres le lien.
        var dateUpload = Date.now();
        var afterLink = tomesHtml.substring(linkRx.lastIndex, linkRx.lastIndex + 100);
        var dateMatch = afterLink.match(/\(([^)]+)\)/);
        if (dateMatch) {
          var d = new Date(dateMatch[1]);
          if (!isNaN(d.getTime())) dateUpload = d.getTime();
        }

        chapterIndex++;
        chapters.push({
          title: chapTitle,
          url: chapUrl,
          number: chapterIndex,
          dateUpload: dateUpload,
        });
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + "/" + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Le corps du chapitre porte plusieurs classes depuis la refonte du theme :
      // class="entry-content-chapitre chapter-inner chapter-content". On cherche
      // donc la classe PRESENTE dans l'attribut, pas un attribut qui lui soit egal.
      var html = extractDivByClass(res, "chapter-content");
      if (!html) html = extractDivByClass(res, "entry-content-chapitre");
      if (!html) html = extractDivByClass(res, "entry-content");
      if (!html) return "<p>Contenu non disponible</p>";

      // Coupe ce qui suit le texte : navigation, signalement de coquille, commentaires.
      var endMarkers = ["<footer", '<div class="comment', '<div class="mistape', '<div class="post-nav', "<nav"];
      for (var i = 0; i < endMarkers.length; i++) {
        var idx = html.indexOf(endMarkers[i]);
        if (idx !== -1) html = html.substring(0, idx);
      }

      return html.substring(0, 200000);
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Categorie/Genre",
        values: [
          { displayName: "Tous", value: "all" },
          { displayName: "Shonen", value: "c_shonen" },
          { displayName: "Seinen", value: "c_seinen" },
          { displayName: "Fille", value: "c_fille" },
          { displayName: "Original", value: "c_original" },
          { displayName: "Action", value: "g_action" },
          { displayName: "Aventure", value: "g_aventure" },
          { displayName: "Comedie", value: "g_comedie" },
          { displayName: "Fantastique", value: "g_fantastique" },
          { displayName: "Harem", value: "g_harem" },
          { displayName: "Romance", value: "g_romance" },
          { displayName: "Sci-fi", value: "g_sci-fi" },
          { displayName: "Drame", value: "g_drame" },
        ],
        default: 0,
      },
    ];
  }

  _parseNovelArticles(html, isLatest) {
    var list = [];

    var articleMatches = html.match(/<article[^>]*>(.*?)<\/article>/gs);
    if (articleMatches) {
      for (var i = 0; i < articleMatches.length; i++) {
        var article = articleMatches[i];

        // Title from h2
        var h2Match = article.match(/<h2[^>]*>(.*?)<\/h2>/s);
        var title = h2Match ? stripTags(h2Match[1]).trim() : "";

        // Image
        var imgMatch = article.match(/<img[^>]*src="([^"]+)"/);
        var imageUrl = imgMatch ? imgMatch[1] : "";

        // Link — depends on latest vs popular
        var linkMatch;
        if (isLatest) {
          linkMatch = article.match(/<span class="Roman"[^>]*>[^]*?<a[^>]*href="([^"]+)"/s);
        }
        if (!linkMatch) {
          linkMatch = article.match(/<h2[^>]*>[^]*?<a[^>]*href="([^"]+)"/s);
        }
        if (!linkMatch) {
          linkMatch = article.match(/<a[^>]*href="([^"]+)"/);
        }

        var novelUrl = linkMatch ? linkMatch[1] : "";

        if (title && novelUrl) {
          list.push({
            title: decodeHtml(title),
            url: novelUrl,
            imageUrl: imageUrl,
            isMature: false,
          });
        }
      }
    }

    return { list: list, hasNextPage: list.length > 0 };
  }
}
