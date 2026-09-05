/**
 * WarriorLegendTrad — Extension Hitomi Reader (Light Novel)
 * Source : https://warriorlegendtrad.wordpress.com
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.1
 *
 * LIVE AUDIT 2026-04-19 (@khun)
 * - Probed /light-novel (mobile UA): 14 novels via
 *   `h2.entry-title > a[href="https://warriorlegendtrad.wordpress.com/YYYY/..."]`.
 * - Page 2 (/crea) retained for original works.
 * - Theme unchanged since v1.0.0 -- selectors kept.
 */

var BASE_URL = "https://warriorlegendtrad.wordpress.com";

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
// liste=14, couvertures=0. L'application affichait donc autant de cadres vides.
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
  get name() { return "WarriorLegendTrad"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 2) return { list: [], hasNextPage: false };

      // Page 1: /light-novel, Page 2: /crea
      var url = page === 1 ? BASE_URL + "/light-novel" : BASE_URL + "/crea";
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      var result = this._parseNovelList(res);
      result.hasNextPage = (page === 1);
      await enrichCovers(this, result.list);
      return result;
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

      // Search across both pages
      var page1 = await this.getPopular(1);
      var page2 = await this.getPopular(2);
      var allNovels = page1.list.concat(page2.list);

      var normalizedQuery = query.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      var filtered = [];
      for (var i = 0; i < allNovels.length; i++) {
        var normalizedTitle = allNovels[i].title.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (normalizedTitle.indexOf(normalizedQuery) !== -1) {
          filtered.push(allNovels[i]);
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

      // Title from entry-title h1 or site-main article header h1
      var titleMatch = res.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(decodeHtml(titleMatch[1])).trim() : "Unknown";

      // Cover: figure img in the article
      var coverMatch = res.match(/<figure[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Get text from entry-content for metadata
      var entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var entryText = entryMatch ? stripTags(entryMatch[1]) : "";

      // Author
      var authors = [];
      var authorMatch = entryText.match(/Auteur\s*\u00A0?:\s*([^\n]+)/i);
      if (authorMatch) {
        var a = authorMatch[1].trim();
        if (a) authors.push(a);
      }

      // Genres
      var genres = [];
      var genreMatch = entryText.match(/Genre\s*:\s*([^\n]+)/i);
      if (genreMatch) {
        var genreText = genreMatch[1].trim();
        if (genreText) genres = genreText.split(/[,]/).map(function(g) { return g.trim(); }).filter(Boolean);
      }

      // Synopsis
      var description = "";
      var synMatch = entryText.match(/Synopsis\s*\u00A0?:\s*([\s\S]*?)index chapitre\s*:/i);
      if (synMatch) {
        description = synMatch[1].trim();
      }

      // Status
      var status = "ongoing";
      var statusPatterns = [
        /[EeÉé]tat sur le site\s*:?\s*([^\n]+)/i,
      ];
      for (var si = 0; si < statusPatterns.length; si++) {
        var sm = entryText.match(statusPatterns[si]);
        if (sm) {
          var st = sm[1].trim().toLowerCase();
          if (st.indexOf("en cours") !== -1) status = "ongoing";
          else if (st.indexOf("pause") !== -1) status = "hiatus";
          else if (st.indexOf("termin") !== -1) status = "completed";
          else if (st.indexOf("abandonn") !== -1) status = "cancelled";
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

      // Chapters are in h2.entry-title a or h3 a elements
      var linkMatches = res.match(/<h[23][^>]*class="entry-title"[^>]*>\s*<a[^>]*href="(https?:\/\/warriorlegendtrad\.wordpress\.com\/\d{4}\/[^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>((?:(?!<\/a>).)*)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(decodeHtml(textMatch[1])).replace(/\u00A0/g, " ").trim();

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
          title: chapTitle,
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: dateUpload,
        });
      }

      // Sort by date then by name for stability
      chapters.sort(function(a, b) {
        var dateDiff = a.dateUpload - b.dateUpload;
        if (dateDiff !== 0) return dateDiff;
        return a.title.localeCompare(b.title);
      });

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

  _parseNovelList(html) {
    var list = [];

    // Novels are listed as article entries with h2.entry-title containing links
    var articlePattern = /<h2[^>]*class="entry-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    var match;

    while ((match = articlePattern.exec(html)) !== null) {
      var novelUrl = match[1];
      var novelTitle = stripTags(decodeHtml(match[2])).replace(/\u00A0/g, " ").trim();

      if (novelTitle && novelUrl) {
        // Try to get cover from the article context
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
