/**
 * WuxiaLnScantrad — Extension Hitomi Reader (Light Novel)
 * Source : https://wuxialnscantrad.wordpress.com
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.1
 *
 * LIVE AUDIT 2026-04-19 (@khun)
 * - Probed https://wuxialnscantrad.wordpress.com/ (mobile UA).
 * - Menu structure refreshed: `menu-item-2210` (Lightnovels, 5 entries)
 *   still present. `menu-item-3960` (WuxiaProjets) added as secondary
 *   slug source to widen the catalogue (projets hors-ln).
 * - Novel link pattern: <li><a href="https://wuxialnscantrad.wordpress.com/SLUG/">.
 * - Sub-menu regex preserved, now iterated over both menu IDs.
 */

var BASE_URL = "https://wuxialnscantrad.wordpress.com";

// Extrait le contenu d'un <div> dont l'attribut class CONTIENT le nom donne.
// POURQUOI un compteur d'imbrication : le corps d'un chapitre commence ici par un
// encart (widget de notation, barre de boutons). Une regex non-gourmande
// "([\s\S]*?)</div>" se fermait donc sur cet encart et rendait 76 a 303 caracteres
// de decor au lieu du texte. Seul le comptage rend le bloc exact.
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


// Remplit les couvertures manquantes de la liste.
//
// POURQUOI c'est necessaire ici : la liste de ce site est batie sur des liens
// qui ne portent aucune image. Le harnais l'a mesure le 2026-09-05 —
// liste=5, couvertures=0. L'application affichait donc autant de cadres vides.
//
// POURQUOI passer par la fiche plutot que de recopier une expression : la fiche
// sait DEJA extraire la couverture, et elle est la seule page du site a la
// porter. Reutiliser sa logique evite une deuxieme regle a maintenir, et si la
// fiche est corrigee un jour, la liste en profite sans rien changer.
//
// POURQUOI par groupes de quatre : une requete par oeuvre, en file indienne,
// ferait attendre l'utilisateur le temps de toutes les additionner. Quatre de
// front ramenent l'attente au quart sans marteler un petit site.
//
// Un echec n'est jamais fatal : l'oeuvre garde une couverture vide, la liste
// reste complete et juste.
async function enrichCovers(ext, list) {
  var GROUP = 4;
  for (var start = 0; start < list.length; start += GROUP) {
    var slice = list.slice(start, start + GROUP);
    var jobs = [];
    for (var i = 0; i < slice.length; i++) {
      jobs.push(
        (function (item) {
          return ext
            .getMangaDetail(item.url)
            .then(function (d) {
              if (d && d.imageUrl) item.imageUrl = d.imageUrl;
            })
            .catch(function () {});
        })(slice[i])
      );
    }
    await Promise.all(jobs);
  }
  return list;
}

class DefaultExtension extends MProvider {
  get name() { return "WuxiaLnScantrad"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var res = await fetchv2(BASE_URL, { "Accept-Encoding": "deflate" });
      var parsed = this._parseNavNovels(res);
      await enrichCovers(this, parsed.list);
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

      // Title from entry-title
      var titleMatch = res.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover: img in entry-content (strong img or p img)
      var coverMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>[\s\S]*?<p[^>]*>[\s\S]*?<strong[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
      if (!coverMatch) {
        coverMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>[\s\S]*?<img[^>]*class="[^"]*wp-image[^"]*"[^>]*src="([^"]+)"/);
      }
      if (!coverMatch) {
        coverMatch = res.match(/<img[^>]*class="[^"]*alignleft[^"]*"[^>]*src="([^"]+)"/);
      }
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Get text content for metadata extraction
      var entryContentMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var entryText = entryContentMatch ? stripTags(entryContentMatch[1]) : "";

      // Author
      var authors = [];
      var authorMatch = entryText.match(/Auteur\(s\)\s*:\s*(.*)/);
      if (authorMatch) {
        var a = authorMatch[1].trim();
        if (a) authors.push(a);
      }

      // Genres
      var genres = [];
      var genreMatch = entryText.match(/Genres?\s*:\s*(.*)/);
      if (genreMatch) {
        var genreText = genreMatch[1].trim();
        if (genreText) genres = genreText.split(/[,]/).map(function(g) { return g.trim(); }).filter(Boolean);
      }

      // Status
      var status = "ongoing";
      var statusMatch = entryText.match(/Statut\s*:\s*(.*)/i);
      if (statusMatch) {
        var statusText = statusMatch[1].trim().toLowerCase();
        if (statusText.indexOf("termin") !== -1) status = "completed";
        else if (statusText.indexOf("arr") !== -1) status = "cancelled";
      }

      // Synopsis
      var description = "";
      var synopsisPatterns = [
        /Synopsis\s*:\s*([\s\S]*?)Chapitres disponibles/i,
        /Sypnopsis\s*([\s\S]*?)Sypnopsis officiel/i,
        /Synopsis\s*([\s\S]*?)Chapitres disponibles/i,
      ];
      for (var si = 0; si < synopsisPatterns.length; si++) {
        var synMatch = entryText.match(synopsisPatterns[si]);
        if (synMatch) {
          description = synMatch[1].trim();
          break;
        }
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
      var seen = {};

      // Chapter links in entry-content ul li a
      var linkMatches = res.match(/<a[^>]*href="(https?:\/\/wuxialnscantrad\.wordpress\.com\/\d{4}\/[^"]*)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(textMatch[1]).replace(/\u00A0/g, " ").trim();

        if (!chapTitle) continue;
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Extract date from URL: /YYYY/MM/DD/slug/
        var dateMatch = chapUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        var dateUpload = Date.now();
        if (dateMatch) {
          dateUpload = new Date(dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3]).getTime();
        }

        var chapNum = 0;
        var numMatch = chapTitle.match(/[Cc]hapitre\s+(\d+)/i) || chapTitle.match(/(\d+)/);
        if (numMatch) chapNum = parseInt(numMatch[1]);

        chapters.push({
          title: decodeHtml(chapTitle),
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: dateUpload,
        });
      }

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

      // POURQUOI cette reecriture (2026-09-04) : le decoupage precedent fermait le
      // conteneur sur "([\s\S]*?)</div>", donc sur le PREMIER </div> rencontre. Le
      // contenu commencant par un encart (notation, boutons de partage), le texte
      // du chapitre n'etait jamais atteint : l'extension rendait le decor, et le
      // harnais le comptait pour un succes puisqu'il n'etait pas vide.
      var content = extractDivByClass(res, "entry-content");
      if (!content) return "<p>Contenu non disponible</p>";

      // Encarts a retirer, ou qu'ils soient dans le bloc.
      var strip = ["cs-rating", "pd-rating", "sharedaddy", "wp-block-buttons", "jp-relatedposts", "wpcnt"];
      for (var s = 0; s < strip.length; s++) {
        var before;
        do { before = content; content = removeDivByClass(content, strip[s]); } while (content !== before);
      }

      // Bornes de fin ancrees sur des attributs, jamais sur un mot nu.
      var endMarkers = ['<div id="comments"', '<div class="comments', 'id="respond"', "<footer"];
      for (var i = 0; i < endMarkers.length; i++) {
        var idx = content.indexOf(endMarkers[i]);
        if (idx !== -1) content = content.substring(0, idx);
      }

      content = content.replace(/<script[\s\S]*?<\/script>/g, "");
      content = content.replace(/<hr[^>]*\/?>/g, "");
      content = content.replace(/<p>&nbsp;<\/p>/g, "");
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

    // 2026-04-19: iterate both Lightnovels (2210) and WuxiaProjets (3960) sub-menus
    var menuIds = ["2210", "3960"];
    for (var mi = 0; mi < menuIds.length; mi++) {
      var re = new RegExp("menu-item-" + menuIds[mi] + "[\\s\\S]*?<ul[^>]*class=\"sub-menu\"[^>]*>([\\s\\S]*?)<\\/ul>");
      var menuMatch = html.match(re);
      if (!menuMatch) continue;

      var menuContent = menuMatch[1];
      var novelPattern = /<li[^>]*><a href="(https?:\/\/wuxialnscantrad\.wordpress\.com\/[^"]+)"[^>]*>([^<]+)<\/a><\/li>/g;
      var match;

      while ((match = novelPattern.exec(menuContent)) !== null) {
        var novelUrl = match[1];
        if (seen[novelUrl]) continue;
        seen[novelUrl] = true;

        var novelTitle = decodeHtml(match[2]).trim();
        if (!novelTitle) continue;

        list.push({
          title: novelTitle,
          url: novelUrl,
          imageUrl: "",
          isMature: false,
        });
      }
    }

    return { list: list, hasNextPage: false };
  }
}
