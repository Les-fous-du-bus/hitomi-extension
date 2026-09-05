/**
 * Xiaowaz — Extension Hitomi Reader (Light Novel)
 * Source : https://xiaowaz.fr
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.1
 *
 * LIVE AUDIT 2026-04-19 (@khun)
 * - Probed https://xiaowaz.fr/ (mobile UA): 20 novels reachable via
 *   `li.page_item > a[href]` pointing to /series-en-cours|/oeuvres-originales|
 *   /series-abandonnees.
 * - Former WordPress page /liste-des-projets/ is gone (404); code already
 *   scrapes the sidebar sub-menu, no change needed.
 * - Selectors validated -- kept as-is.
 */

var BASE_URL = "https://xiaowaz.fr";

// Extrait le contenu d'un <div> dont l'attribut class CONTIENT le nom donne.
// POURQUOI un compteur d'imbrication : le corps d'un chapitre contient lui-meme
// des <div>. Une regex non-gourmande coupe au premier </div>, une regex gourmande
// avale le pied de page. Seul le comptage rend le bloc exact — et il ne depend
// d'aucun encart optionnel, contrairement aux bornes de fin qui ont disparu du
// site en 2026.
function extractDivByClass(html, className) {
  if (!html || !className) return "";
  var open = new RegExp('<div[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>', "i");
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

// Retire un <div> entier (balises comprises) repere par une classe.
function removeDivByClass(html, className) {
  if (!html || !className) return html || "";
  var open = new RegExp('<div[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>', "i");
  var m = open.exec(html);
  if (!m) return html;
  var start = m.index;
  var after = m.index + m[0].length;
  var depth = 1;
  var tagRx = /<\/?div\b[^>]*>/gi;
  tagRx.lastIndex = after;
  var t;
  while ((t = tagRx.exec(html)) !== null) {
    if (t[0].charAt(1) === "/") {
      depth--;
      if (depth === 0) return html.substring(0, start) + html.substring(t.index + t[0].length);
    } else {
      depth++;
    }
  }
  return html.substring(0, start);
}

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
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&laquo;/g, '"')
    .replace(/&raquo;/g, '"');
}


// Cle de correspondance : le menu et l'API n'ecrivent pas toujours l'adresse a
// l'identique (barre oblique finale, casse). On compare sur une forme reduite.
function urlKey(u) {
  if (!u) return "";
  return String(u).toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// Les couvertures des oeuvres, par adresse de page.
//
// POURQUOI passer par l'API du site et non par la page d'accueil : l'accueil ne
// porte que des vignettes d'articles de chapitre et l'image generique du site
// (og.jpg, repetee). Les associer aux oeuvres donnerait la MEME image a toutes
// — silencieusement faux, donc pire qu'un cadre vide.
//
// POURQUOI deux requetes et non `_embed=1` : avec `_embed`, la reponse fait
// 2 Mo car elle embarque toutes les tailles derivees de chaque image. Demander
// les seuls champs utiles puis resoudre les identifiants ramene l'ensemble a
// environ 5 Ko — mesure du 2026-09-05, 39 pages dont 21 avec couverture.
//
// Deux requetes pour toute la liste, contre une par oeuvre si on ouvrait chaque
// fiche. Un echec ne coute rien : la liste part sans couvertures, elle n'est
// jamais fausse ni vide.
var _coverMapCache = null;

async function fetchCoverMap() {
  if (_coverMapCache) return _coverMapCache;
  var map = {};
  try {
    var pagesRaw = await fetchv2(
      BASE_URL + "/wp-json/wp/v2/pages?per_page=100&_fields=link,featured_media",
      { "Accept-Encoding": "deflate" }
    );
    var pages = JSON.parse(pagesRaw);

    var byId = {};
    var ids = [];
    for (var i = 0; i < pages.length; i++) {
      var mediaId = pages[i] && pages[i].featured_media;
      if (!mediaId) continue;
      byId[mediaId] = byId[mediaId] || [];
      byId[mediaId].push(urlKey(pages[i].link));
      if (ids.indexOf(mediaId) === -1) ids.push(mediaId);
    }
    if (!ids.length) { _coverMapCache = map; return map; }

    var mediaRaw = await fetchv2(
      BASE_URL + "/wp-json/wp/v2/media?include=" + ids.join(",") +
        "&per_page=100&_fields=id,source_url",
      { "Accept-Encoding": "deflate" }
    );
    var media = JSON.parse(mediaRaw);
    for (var j = 0; j < media.length; j++) {
      var m = media[j];
      if (!m || !m.source_url || !byId[m.id]) continue;
      for (var k = 0; k < byId[m.id].length; k++) map[byId[m.id][k]] = m.source_url;
    }
  } catch (e) {
    // Site sans API, reponse illisible, reseau coupe : on rend ce qu'on a.
  }
  _coverMapCache = map;
  return map;
}

class DefaultExtension extends MProvider {
  get name() { return "Xiaowaz"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var url = BASE_URL;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      var parsed = this._parseNavNovels(res);

      // Le menu ne porte aucune image : la liste sortait donc sans une seule
      // couverture, et l'application affichait vingt cadres vides. Mesure du
      // 2026-09-05 par le harnais : liste=20, couvertures=0.
      var covers = await fetchCoverMap();
      for (var i = 0; i < parsed.list.length; i++) {
        var hit = covers[urlKey(parsed.list[i].url)];
        if (hit) parsed.list[i].imageUrl = hit;
      }
      return parsed;
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var popular = await this.getPopular(1);
      var normalizedQuery = query.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      var filtered = [];
      for (var i = 0; i < popular.list.length; i++) {
        var normalizedTitle = popular.list[i].title.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (normalizedTitle.indexOf(normalizedQuery) !== -1) {
          filtered.push(popular.list[i]);
        }
      }
      return { list: filtered, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Title from h1.card_title or og:title
      var titleMatch = res.match(/<h1[^>]*class="card_title"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "";
      if (!title) {
        var ogMatch = res.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
        title = ogMatch ? ogMatch[1].replace(/\s*\|\s*Xiaowaz$/i, "").trim() : "Unknown";
      }
      // Remove completion marker
      title = title.replace(/\s*\u2714\s*$/, "").trim();

      // Cover image: img with fetchpriority="high" or img.aligncenter
      var coverMatch = res.match(/<img[^>]*fetchpriority="high"[^>]*src="([^"]+)"/);
      if (!coverMatch) {
        coverMatch = res.match(/<img[^>]*class="[^"]*aligncenter[^"]*"[^>]*src="([^"]+)"/);
      }
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Author: "Ecrit par" pattern
      var authors = [];
      var authorPatterns = [
        /[EeÉé]crit par([^\n<]*?)\.?\s*Traduction/i,
        /[EeÉé]crit par\s*:?\s*([^\n<.]+)/i,
        /Auteur\s*(?:\u00A0)?:\s*([^\n<]+)/i,
      ];
      for (var ai = 0; ai < authorPatterns.length; ai++) {
        var am = res.match(authorPatterns[ai]);
        if (am) {
          var authorText = stripTags(am[1]).trim();
          if (authorText) { authors.push(authorText); break; }
        }
      }

      // Genres
      var genres = [];
      var genreMatch = res.match(/Genre[s]?\s*(?:\u00A0)?:?\s*<\/(?:strong|span|h4)>(.*?)(?:<h4|<strong|Synopsis)/s);
      if (!genreMatch) {
        genreMatch = res.match(/Genre[s]?\s*(?:\u00A0)?:?\s*(.*?)Synopsis/s);
      }
      if (genreMatch) {
        var genreText = stripTags(genreMatch[1]).trim();
        if (genreText) {
          genres = genreText.split(/[,\n]/).map(function(g) { return g.trim(); }).filter(Boolean);
        }
      }

      // Synopsis: text after "Synopsis" heading
      var description = "";
      var descMatch = res.match(/Synopsis\s*<\/(?:strong|span|h4)>(.*?)(?:<h[1-4]|Table des mati)/s);
      if (descMatch) {
        var descParts = descMatch[1].match(/<p[^>]*>(.*?)<\/p>/gs);
        if (descParts) {
          var descTexts = [];
          for (var di = 0; di < descParts.length; di++) {
            var t = stripTags(descParts[di]).trim();
            if (t && t.indexOf("Genre") === -1 && t.indexOf("crit par") === -1) {
              descTexts.push(t);
            }
          }
          description = descTexts.join("\n");
        }
      }

      // Status: check for completion marker
      var status = "ongoing";
      if (fullUrl.indexOf("series-abandonnees") !== -1) {
        status = "cancelled";
      } else if (res.indexOf("\u2714") !== -1) {
        status = "completed";
      }

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: status,
        genres: genres,
        authors: authors,
        isMature: false,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      var chapters = [];

      // Chapter links are in entry-content, pointing to xiaowaz.fr/articles/
      // Try ul li a first, then p a
      var linkMatches = res.match(/<a[^>]*href="(https?:\/\/xiaowaz\.fr\/articles\/[^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      var seen = {};
      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(textMatch[1]).replace(/\u00A0/g, " ").trim();

        if (!chapTitle) continue;
        // Skip non-chapter nav links
        if (chapUrl.indexOf("/category/") !== -1) continue;
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Extract chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/[Cc]hapitre\s+(\d+)/i) || chapTitle.match(/(\d+)/);
        if (numMatch) chapNum = parseInt(numMatch[1]);

        chapters.push({
          title: decodeHtml(chapTitle),
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: Date.now(),
        });
      }

      // Sort by chapter number
      chapters.sort(function(a, b) { return a.number - b.number; });

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // POURQUOI cette reecriture (2026-09-04) : le decoupage precedent bornait le
      // texte entre wp-post-navigation et l'un de abh_box / ko-fi / sharedaddy. Les
      // TROIS marqueurs de fin ont disparu du site, donc la regex ne fermait plus
      // son bloc et l'extension rendait son message d'indisponibilite sur tous les
      // chapitres. On part maintenant du conteneur entry-content, ferme par
      // comptage d'imbrication, ce qui ne depend d'aucun encart optionnel.
      var content = extractDivByClass(res, "entry-content");
      if (!content) return "<p>Contenu non disponible</p>";

      // La barre de navigation entre chapitres est EN TETE du conteneur : elle
      // ferait passer les titres voisins pour le debut du texte.
      content = removeDivByClass(content, "wp-post-navigation");
      content = removeDivByClass(content, "post-navigation");

      // Bornes de fin — ancrees sur des attributs, jamais sur un mot nu. Couper sur
      // la chaine "comment" amputait le chapitre des sa premiere occurrence du mot
      // francais "comment".
      var endMarkers = ['<div id="comments"', '<div class="comments', 'id="respond"', "<footer"];
      for (var i = 0; i < endMarkers.length; i++) {
        var idx = content.indexOf(endMarkers[i]);
        if (idx !== -1) content = content.substring(0, idx);
      }

      content = content.replace(/<p>&nbsp;<\/p>/g, "");

      // Les notes de bas de page sont replacees a la fin, apres le texte.
      var footnoteMatch = content.match(/<div[^>]*class="[^"]*footnote_container_prepare[^"]*"[^>]*>[\s\S]*?<\/div>/);
      if (footnoteMatch) {
        content = content.replace(footnoteMatch[0], "") + footnoteMatch[0];
      }

      return content;
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [];
  }

  _parseNavNovels(html) {
    var list = [];
    var seen = {};

    // Novels are in page_item li elements with links to series-en-cours, oeuvres-originales, series-abandonnees
    var novelPattern = /<li class="page_item[^"]*"><a href="(https:\/\/xiaowaz\.fr\/(?:series-en-cours|oeuvres-originales|series-abandonnees)\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    var match;
    while ((match = novelPattern.exec(html)) !== null) {
      var novelUrl = match[1];
      var novelTitle = decodeHtml(stripTags(match[2])).replace(/\u00A0/g, " ").replace(/\s*\u2714\s*/, "").trim();

      // Skip Douluo Dalu (category link, not a novel page)
      if (novelUrl.indexOf("/category/") !== -1) continue;
      if (!novelTitle || seen[novelUrl]) continue;
      seen[novelUrl] = true;

      list.push({
        title: novelTitle,
        url: novelUrl,
        imageUrl: "",
        isMature: false,
      });
    }

    return { list: list, hasNextPage: false };
  }
}
